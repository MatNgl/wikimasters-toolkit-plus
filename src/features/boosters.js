// Ouverture groupée / automatique. Pilote le bouton natif « Ouvrir » (le flux du jeu, y compris
// sa vérification humaine, reste intact) et capte les cartes dans la réponse /api/packs/open.
// La vérification humaine n'est JAMAIS touchée : on attend qu'elle disparaisse.
(() => {
  const { el, findExact, sleep } = WMX.dom;
  const state = { busy: false, auto: false, buffer: [], opened: 0 };
  let lastCards = null;
  const ui = {};

  WMX.settings = { ...WMX.DEFAULTS };
  // Réglages enregistrés : chargés sur toutes les pages (le bouton ⚡ de la collection lit le coefficient d'enchère, par exemple).
  WMX.store.get('wmxSettings', {}).then((s) => Object.assign(WMX.settings, s));
  const rank = (r) => WMX.RARITIES.length - 1 - WMX.RARITIES.indexOf(r); // C = 0 … L = 5

  let openError = null; // dernière réponse d'erreur (ex. 429) à l'ouverture d'un paquet
  let dailyLimit = false;
  WMX.onApi(({ path, method, status, data }) => {
    if (method !== 'POST' || path !== '/api/packs/open') return;
    if (data?.cards) { lastCards = data.cards; WMX.prices.prefetch?.(data.cards); } // prix récupérés pendant la pause entre paquets
    else if (status === 429 || data?.rate_limited) openError = { t: Date.now(), data };
  });

  const COOLDOWN_S = 3; // pause obligatoire entre deux paquets : le jeu refuse les ouvertures trop rapprochées
  let blocks = 0;       // refus consécutifs : la pause s'allonge d'1 s à chaque refus, puis repart de COOLDOWN_S au premier succès

  /** Indication `retry_after` du jeu en secondes (nombre, « 5 s », « 2 min » ou date), ou null si illisible. */
  const retryHint = (v) => {
    const s = String(v ?? '');
    const n = Number(s.match(/\d+(\.\d+)?/)?.[0]);
    if (/^\s*\d+(\.\d+)?\s*(s|sec|secondes?)?\s*$/i.test(s)) return n;
    if (/min/i.test(s) && n) return n * 60;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : Math.max(1, (t - Date.now()) / 1000);
  };

  // --- Lecture de l'état du jeu --------------------------------------------------------------
  const packInfo = () => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)\s*paquets?/i);
    return m ? { packs: Number(m[1]), max: Number(m[2]) } : { packs: 0, max: 10 };
  };
  const packsLeft = () => packInfo().packs;
  const nextPackIn = () => {
    const m = document.body.innerText.match(/Prochain dans\s*(\d+):(\d{2})/i);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const humanCheck = () => /vérification rapide/i.test(document.body.innerText);
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Durée de régénération d'un paquet, déduite du compteur « Prochain dans » à chaque redémarrage (10 min par défaut).
  let regen = 600;
  let lastNext = null;
  const trackRegen = (n) => {
    if (n == null) return;
    if (lastNext != null && n > lastNext + 30 && n <= 3600) regen = n;
    lastNext = n;
  };

  const setStatus = (t) => { if (ui.status) ui.status.textContent = t; };
  /** Compteur rouge sur la bulle « W » : nombre de paquets ouverts pendant l'auto. */
  const setBadge = () => {
    ui.fabCount.hidden = !state.auto;
    ui.fabCount.textContent = String(state.opened);
  };
  const setAutoBtn = () => {
    // Boutons côte à côte : libellés courts.
    ui.autoBtn.textContent = state.auto ? 'Arrêter' : 'Ouvrir auto';
    ui.autoBtn.classList.toggle('wmx-btn--danger', state.auto);
  };

  // --- Ouverture d'un paquet via l'interface native ------------------------------------------
  /** Revient à l'écran « Ouvrir » : flèche ronde pour passer les cartes, puis « Continuer ». */
  async function dismissResult() {
    // On ignore notre interface, dont l'image figée (qui contient une copie du bouton « Ouvrir »).
    const outside = (e) => !e.closest('.wmx-panel, .wmx-overlay, .wmx-cover');
    const nativeOpen = () => [...document.querySelectorAll('button')].find((b) => outside(b) && b.textContent.trim().toLowerCase() === 'ouvrir');
    for (let i = 0; i < 250; i++) {
      if (nativeOpen()) return true; // même désactivé : après le dernier paquet il reste grisé
      const cont = findExact('continuer', 'button');
      if (cont && !cont.disabled && outside(cont)) cont.click();
      else {
        const arrows = [...document.querySelectorAll('button')]
          .filter((b) => outside(b) && !b.textContent.trim() && /w-12/.test(b.className) && /rounded-full/.test(b.className) && !b.disabled);
        arrows.at(-1)?.click();
      }
      await sleep(120);
    }
    return false;
  }

  /**
   * Pendant l'ouverture, on masque l'écran de résultat natif (pour ne pas spoiler les cartes) avec une
   * image figée de la page « Paquets » plutôt qu'un écran noir ; le compteur y est décrémenté dès que
   * le paquet est consommé.
   */
  function makeSnapshot(btn, packs) {
    const cover = document.querySelector('.wmx-cover');
    let root = btn;
    while (root && !/\bflex-1\b[^]*\bp-4\b/.test(String(root.className))) root = root.parentElement;
    if (!root || !cover) return null;
    const clone = root.cloneNode(true);
    clone.setAttribute('inert', '');
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    clone.style.cssText = 'width:100%;pointer-events:none';
    cover.replaceChildren(clone);
    return { clone, packs };
  }
  function consumeInSnapshot(snap) {
    if (!snap) return;
    const n = String(snap.packs);
    const leaf = [...snap.clone.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === n
      && /\d+\s*\/\s*\d+/.test(e.parentElement?.textContent || '') && /paquets?/i.test(e.parentElement?.parentElement?.textContent || ''));
    if (leaf) leaf.textContent = String(Math.max(0, snap.packs - 1));
  }

  async function openOne(session) {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
    if (!btn) return null;
    lastCards = null;
    const snap = makeSnapshot(btn, packsLeft());
    document.documentElement.classList.add('wmx-opening');
    btn.click();
    let clickedAt = Date.now();
    openError = null;
    const end = Date.now() + 180000; // laisse le temps à la vérification humaine, faite par l'utilisateur
    while (!lastCards && Date.now() < end) {
      // Le jeu refuse l'ouverture (limite de débit) : on attend le délai indiqué puis on réessaie, ou on s'arrête.
      if (openError && openError.t >= clickedAt) {
        const d = openError.data || {};
        openError = null;
        if (d.rate_limit_daily) { dailyLimit = true; setStatus('Limite quotidienne d’ouvertures atteinte'); break; }
        blocks += 1;
        if (blocks > 15) { setStatus('Le jeu refuse l’ouverture : arrêt'); break; }
        // Attente = pause de base + 1 s par refus consécutif (4, 5, 6… s), au moins ce que demande le jeu.
        const waitS = Math.min(120, Math.max(COOLDOWN_S + blocks, retryHint(d.retry_after) ?? 0));
        for (let s = Math.ceil(waitS); s > 0 && !lastCards; s--) {
          setStatus(`Ouverture trop rapide : nouvel essai dans ${s} s`);
          session?.setNote(`attente ${s} s`);
          await sleep(1000);
        }
        session?.setNote('');
        const retry = [...document.querySelectorAll('button')]
          .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
        if (retry) retry.click();
        clickedAt = Date.now();
        continue;
      }
      const hc = humanCheck();
      session?.yield(hc); // l'écran de révélation s'efface pour laisser la vérification du jeu cliquable
      setStatus(hc ? 'Vérification du jeu : cliquez-la si besoin…' : 'Ouverture…');
      // Clic perdu (le jeu n'était pas encore prêt) : aucune requête d'ouverture n'est partie et le bouton est
      // toujours là, on recommence au lieu d'attendre indéfiniment.
      if (!hc && Date.now() - clickedAt > 2500 && !(WMX.apiStarts || []).some((a) => a.t >= clickedAt && /human-check|packs\/open/.test(a.path))) {
        const again = [...document.querySelectorAll('button')]
          .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
        if (again) again.click();
        clickedAt = Date.now();
      }
      await sleep(100);
    }
    session?.yield(false);
    const cards = lastCards;
    if (cards) { blocks = 0; consumeInSnapshot(snap); } // succès : la pause repart de sa valeur de base
    const ok = !cards || (await dismissResult());
    if (ok && cards) await sleep(300); // laisse l'écran « Ouvrir » du jeu se remettre en place avant le clic suivant
    document.documentElement.classList.remove('wmx-opening');
    document.querySelector('.wmx-cover')?.replaceChildren();
    if (!ok) { setStatus('Écran de résultat inattendu : arrêt'); state.busy = false; state.auto = false; }
    return cards;
  }

  /** Pause obligatoire entre deux paquets, visible dans le panneau et sur l'écran de révélation. */
  async function cooldown(session) {
    for (let s = COOLDOWN_S; s > 0 && (state.busy || state.auto); s--) {
      session?.setNote(`pause ${s} s`);
      setStatus(`Pause de ${s} s avant le paquet suivant`);
      await sleep(1000);
    }
    session?.setNote('');
  }

  // --- « Tout ouvrir » -----------------------------------------------------------------------
  async function openAll() {
    if (state.auto) { setStatus('Arrêtez d’abord l’ouverture auto'); return; }
    if (state.busy) return;
    const total = packsLeft();
    if (!total) { setStatus('Aucun paquet disponible'); return; }
    state.busy = true;
    const session = WMX.revealSession();
    session.setRemaining(total, total);
    try {
      for (let done = 0; done < total && state.busy; done++) {
        const cards = await openOne(session);
        if (!cards) break;
        session.addPack(cards);
        session.setRemaining(total - done - 1, total);
        if (done < total - 1) await cooldown(session);
      }
    } finally { state.busy = false; setStatus(''); }
    await session.finish();
  }

  // --- Ouverture automatique ------------------------------------------------------------------
  /** Ouvre `n` paquets et les met de côté ; s'arrête si une carte atteint le seuil choisi. */
  async function openBatch(n) {
    for (let i = 0; i < n && state.auto; i++) {
      if (i > 0) await cooldown();
      if (!state.auto) return;
      state.busy = true;
      const cards = await openOne();
      state.busy = false;
      if (!cards) {
        if (dailyLimit) { stopAuto(); setStatus('Limite quotidienne d’ouvertures atteinte'); }
        return;
      }
      state.buffer.push(...cards);
      state.opened += 1;
      setBadge();
      const stop = WMX.settings.stopOn;
      if (stop !== 'off' && cards.some((c) => rank(WMX.normRarity(c.rarity)) >= rank(stop))) { stopAuto(); return; }
    }
  }

  async function autoLoop() {
    const interval = () => rand(Number(ui.min.value), Number(ui.max.value)) * 60000;
    let nextAt = Date.now() + interval();
    while (state.auto) {
      await sleep(1000);
      if (!WMX.alive()) { // extension rechargée : ce script orphelin s'arrête et retire son interface
        state.auto = false;
        document.querySelectorAll('.wmx-panel, .wmx-cover').forEach((e) => e.remove());
        break;
      }
      if (!state.auto) break;
      if (state.busy) continue;
      const { packs, max } = packInfo();
      const nextIn = nextPackIn();
      trackRegen(nextIn);
      const cfg = WMX.settings;
      const reserve = Math.min(cfg.reserve, max - 1);
      const wait = (nextAt - Date.now()) / 1000;
      let toOpen = 0;
      let why = '';
      // À chaque échéance : on ouvre TOUS les paquets disponibles au-dessus de la réserve, pour ne jamais atteindre le maximum.
      const ready = Math.max(0, packs - reserve);
      if (packs >= max && cfg.fullStockOpen) { toOpen = ready; why = 'stock plein'; }
      else if (ready > 0) {
        if (wait <= 0) toOpen = ready;
        else if (cfg.anticipate && nextIn != null && nextIn + (max - packs - 1) * regen <= wait + 60) { toOpen = ready; why = 'avant blocage du stock'; }
      }
      if (toOpen > 0) {
        setStatus(why ? `Ouverture anticipée (${why})` : 'Ouverture…');
        await openBatch(toOpen);
        nextAt = Date.now() + interval();
      } else if (state.auto) {
        setStatus(`Prochaine ouverture dans ${mmss(Math.max(0, wait))} · ${packs} paquet${packs > 1 ? 's' : ''} en attente${ready === 0 && packs > 0 ? ' (réserve)' : ''}`);
      }
    }
  }

  function startAuto() {
    if (state.busy) return;
    state.auto = true;
    setBadge(); setAutoBtn();
    WMX.prepareCardSheets?.(); // fiche des cartes prête quand la révélation s'affichera
    autoLoop();
  }

  function stopAuto() {
    state.auto = false;
    const cards = state.buffer;
    state.buffer = []; state.opened = 0;
    setBadge(); setAutoBtn(); setStatus('');
    WMX.reveal(cards);
  }

  // --- Panneau --------------------------------------------------------------------------------
  const field = (label, control, title) => el('label', title ? { title } : {}, label, control);

  async function buildPanel() {
    Object.assign(WMX.settings, await WMX.store.get('wmxSettings', {}));
    const ap = await WMX.store.get('autoPrefs', { min: 5, max: 10 });

    ui.status = el('div', { class: 'wmx-status' });
    ui.stats = el('div', { class: 'wmx-pstats' });
    ui.min = el('input', { class: 'wmx-input', type: 'number', min: '1', max: '60', step: '1', value: ap.min });
    ui.max = el('input', { class: 'wmx-input', type: 'number', min: '1', max: '60', step: '1', value: ap.max });
    const clamp = () => {
      const a = Math.min(60, Math.max(1, Math.round(Number(ui.min.value) || 1)));
      const b = Math.min(60, Math.max(a, Math.round(Number(ui.max.value) || a)));
      ui.min.value = a; ui.max.value = b;
      WMX.store.set('autoPrefs', { min: a, max: b });
    };
    ui.min.addEventListener('change', clamp);
    ui.max.addEventListener('change', clamp);
    clamp();

    ui.autoBtn = el('button', { class: 'wmx-btn wmx-btn--wide', onclick: () => (state.auto ? stopAuto() : startAuto()) });
    ui.fabCount = el('span', { class: 'wmx-fab-count', hidden: '' });
    // Bulle « W » : simple logo quand le menu est ouvert ; en mode réduit c'est le bouton pour l'agrandir.
    const fab = el('button', { class: 'wmx-fab', title: 'Agrandir le menu', onclick: () => { if (panel.classList.contains('wmx-collapsed')) setCollapsed(false); } },
      'W', ui.fabCount, el('span', { class: 'wmx-fab-hint' }, '›'));
    const fold = el('button', { class: 'wmx-icon wmx-fold', title: 'Réduire le menu', 'aria-label': 'Réduire le menu', onclick: () => setCollapsed(true) }, '«');

    const body = el('div', { class: 'wmx-body' },
      el('div', { class: 'wmx-btnrow' }, el('button', { class: 'wmx-btn wmx-btn--wide', onclick: openAll }, 'Tout ouvrir'), ui.autoBtn),
      ui.status,
      el('h4', {}, 'Intervalle de l’ouverture auto'),
      field('Minimum (min)', ui.min, 'Entre 1 et 60 minutes. Un intervalle court = plus de requêtes envoyées au jeu.'),
      field('Maximum (min)', ui.max, 'Jusqu’à 60 minutes.'),
      el('h4', {}, 'Statistiques'),
      ui.stats,
      el('button', { class: 'wmx-settings-btn', onclick: () => WMX.openSettings() }, el('span', {}, '⚙'), 'Paramètres'),
      el('div', { class: 'wmx-ver' }, (() => { try { return `v${chrome.runtime.getManifest().version_name}`; } catch (_) { return ''; } })()));

    const panel = el('aside', { class: 'wmx-panel' },
      el('div', { class: 'wmx-head' }, fab, el('h3', {}, 'WikiMasters Toolkit+'), fold), body);

    /** Réduit le menu à la seule bulle (avec son compteur) ou le rouvre, avec animation. */
    function setCollapsed(c, animate = true) {
      if (!animate) panel.style.transition = 'none';
      if (c) {
        panel.style.maxHeight = `${panel.offsetHeight}px`;
        void panel.offsetWidth; // fixe la hauteur de départ avant l'animation
        panel.classList.add('wmx-collapsed');
        panel.style.maxHeight = '44px';
        if (animate) setTimeout(() => panel.classList.add('wmx-folded'), 380);
        else panel.classList.add('wmx-folded');
      } else {
        panel.classList.remove('wmx-folded');
        panel.classList.remove('wmx-collapsed');
        panel.style.maxHeight = `${panel.scrollHeight}px`;
        setTimeout(() => { panel.style.maxHeight = ''; }, 450);
      }
      if (!animate) { void panel.offsetWidth; panel.style.transition = ''; }
      fab.title = c ? 'Agrandir le menu' : 'WikiMasters Toolkit+';
      WMX.store.set('panelCollapsed', c);
    }

    const cover = el('div', { class: 'wmx-cover' });
    document.body.append(panel, cover);

    // La barre latérale du jeu s'élargit selon l'écran : le menu se cale à sa droite au lieu d'une position fixe.
    const place = () => {
      const edges = [...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect().right).filter((x) => x > 100 && x < 700);
      const x = edges.length ? Math.max(...edges) : 256;
      const w = panel.classList.contains('wmx-collapsed') ? 44 : (panel.offsetWidth || 300);
      panel.style.left = `${Math.max(8, Math.min(Math.round(x + 16), innerWidth - w - 8))}px`; // reste toujours dans l'écran
      cover.style.left = `${Math.round(x)}px`;
    };
    place();
    window.addEventListener('resize', place);
    new ResizeObserver(place).observe(document.documentElement);
    setTimeout(place, 600); setTimeout(place, 2500); // après le rendu du jeu (polices, mise en page)
    setBadge(); setAutoBtn();
    setTimeout(() => WMX.prepareCardSheets?.('view'), 3000); // fiche du jeu prête avant le premier clic sur une carte tirée
    // Petit écran : le menu démarre réduit à sa bulle « W » (visible, jamais masqué) ; on le déplie d'un clic.
    if ((await WMX.store.get('panelCollapsed', false)) || innerWidth < 1250) setCollapsed(true, false);

    // Statistiques : anneau coloré par rareté + légende, avec le nombre de cartes uniquement.
    const render = async () => {
      const s = await WMX.stats.get();
      const RGB = WMX.RARITY_RGB;
      const pct = (r) => (s.cards ? (s.rarity[r] / s.cards) * 100 : 0);
      let acc = 0;
      const stops = WMX.RARITIES.map((r) => { const a = acc; acc += pct(r); return `rgb(${RGB[r]}) ${a}% ${acc}%`; }).join(',');
      const fmt = (r) => `${pct(r).toFixed(1).replace('.', ',')} %`;
      ui.stats.replaceChildren(el('div', { class: 'wmx-sbox' },
        el('div', { class: 'wmx-donutrow' },
          el('div', { class: 'wmx-donut', style: `background:conic-gradient(${s.cards ? stops : '#1a2a24 0 100%'})` },
            el('div', { class: 'wmx-donut-c' }, el('b', {}, String(s.cards)), el('small', {}, s.cards > 1 ? 'cartes' : 'carte'))),
          el('div', { class: 'wmx-legend' }, ...WMX.RARITIES.map((r) => el('div', { style: `--rgb:${RGB[r]}` },
            el('i'), el('b', {}, r), el('span', { class: 'wmx-lp' }, fmt(r)), el('span', { class: 'wmx-ln' }, String(s.rarity[r])))))),
        (() => {
          const avg = WMX.logic.packAverage(s.value || 0, s.valuedPacks || 0);
          return avg == null ? '' : el('div', { class: 'wmx-avgpack', title: 'Somme des moyennes du marché des cartes tirées, divisée par le nombre de paquets (lots dont tous les prix étaient connus).' },
            el('small', {}, 'Valeur moyenne d’un paquet'), el('b', {}, `${avg.toLocaleString('fr-FR')} W`), el('small', {}, `sur ${s.valuedPacks} paquet${s.valuedPacks > 1 ? 's' : ''}`));
        })()));
    };
    WMX.applySettings = render;
    render();
    WMX.onStorage((c) => { if (c.stats) render(); });

    // Reprise : cartes tirées avant un rechargement de la page et jamais révélées.
    const pending = await WMX.store.get('pendingCards', []);
    if (pending.length) WMX.reveal(pending);
  }

  WMX.register({ name: 'boosters', match: /^\/pulls/, init: buildPanel });
})();
