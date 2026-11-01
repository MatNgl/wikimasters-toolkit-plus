// Ouverture groupée / automatique. Pilote le bouton natif « Ouvrir » (le flux du jeu, y compris
// sa vérification humaine, reste intact) et capte les cartes dans la réponse /api/packs/open.
// La vérification humaine n'est JAMAIS touchée : on attend qu'elle disparaisse.
(() => {
  const { el, findExact, sleep } = WMX.dom;
  const state = { busy: false, auto: false, buffer: [], opened: 0 };
  let lastCards = null;
  const ui = {};

  WMX.settings = { ...WMX.DEFAULTS };
  const rank = (r) => WMX.RARITIES.length - 1 - WMX.RARITIES.indexOf(r); // C = 0 … L = 5

  WMX.onApi(({ path, method, data }) => {
    if (method === 'POST' && path === '/api/packs/open' && data?.cards) lastCards = data.cards;
  });

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
    const short = WMX.settings.theme === 'blue'; // boutons côte à côte : libellés courts
    ui.autoBtn.textContent = state.auto ? (short ? 'Arrêter' : 'Arrêter l’ouverture auto') : (short ? 'Auto' : 'Ouvrir automatiquement');
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
    const end = Date.now() + 180000; // laisse le temps à la vérification humaine, faite par l'utilisateur
    while (!lastCards && Date.now() < end) {
      const hc = humanCheck();
      session?.yield(hc); // l'écran de révélation s'efface pour laisser la vérification du jeu cliquable
      setStatus(hc ? 'Vérification du jeu : cliquez-la si besoin…' : 'Ouverture…');
      await sleep(100);
    }
    session?.yield(false);
    const cards = lastCards;
    if (cards) consumeInSnapshot(snap);
    const ok = !cards || (await dismissResult());
    document.documentElement.classList.remove('wmx-opening');
    document.querySelector('.wmx-cover')?.replaceChildren();
    if (!ok) { setStatus('Écran de résultat inattendu : arrêt'); state.busy = false; state.auto = false; }
    return cards;
  }

  // --- « Tout ouvrir » : aucun délai ajouté, on suit le rythme du jeu ------------------------
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
      }
    } finally { state.busy = false; setStatus(''); }
    await session.finish();
  }

  // --- Ouverture automatique ------------------------------------------------------------------
  /** Ouvre `n` paquets et les met de côté ; s'arrête si une carte atteint le seuil choisi. */
  async function openBatch(n) {
    for (let i = 0; i < n && state.auto; i++) {
      state.busy = true;
      const cards = await openOne();
      state.busy = false;
      if (!cards) return;
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
    const gear = el('button', { class: 'wmx-icon', title: 'Paramètres', onclick: () => WMX.openSettings() }, '⚙');
    const fold = el('button', { class: 'wmx-icon', title: 'Réduire le menu', onclick: () => setCollapsed(true) }, '«');

    ui.swatches = [['green', 'Vert : classique'], ['blue', 'Bleu : verre et anneau'], ['red', 'Rouge : arcade']].map(([t, label]) =>
      el('button', { class: 'wmx-swatch', 'data-t': t, title: label, 'aria-label': label, onclick: () => {
        WMX.settings.theme = t;
        WMX.store.set('wmxSettings', WMX.settings);
        applyTheme();
      } }));

    const body = el('div', { class: 'wmx-body' },
      el('div', { class: 'wmx-btnrow' }, el('button', { class: 'wmx-btn wmx-btn--wide', onclick: openAll }, 'Tout ouvrir'), ui.autoBtn),
      ui.status,
      el('h4', {}, 'Intervalle de l’ouverture auto'),
      field('Minimum (min)', ui.min, 'Entre 1 et 60 minutes. Un intervalle court = plus de requêtes envoyées au jeu.'),
      field('Maximum (min)', ui.max, 'Jusqu’à 60 minutes.'),
      el('h4', {}, 'Statistiques'),
      ui.stats,
      el('button', { class: 'wmx-link', onclick: () => WMX.stats.reset() }, 'Réinitialiser les statistiques'),
      el('div', { class: 'wmx-themes' }, el('span', {}, 'Style de l’interface'), ...ui.swatches));

    const panel = el('aside', { class: 'wmx-panel' },
      el('div', { class: 'wmx-head' }, fab, el('h3', {}, 'WikiMasters Toolkit+'), gear, fold), body);

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

    document.body.append(panel, el('div', { class: 'wmx-cover' }));
    setBadge(); setAutoBtn();
    if (await WMX.store.get('panelCollapsed', false)) setCollapsed(true, false);

    // Trois présentations des statistiques : barres (vert), anneau + légende (bleu), barre empilée + pastilles (rouge).
    const render = async () => {
      const s = await WMX.stats.get();
      const RGB = WMX.RARITY_RGB;
      const pct = (r) => (s.cards ? (s.rarity[r] / s.cards) * 100 : 0);
      const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
      const head = el('div', { class: 'wmx-shead' }, el('span', {}, 'Vos statistiques'), el('span', {}, `${plural(s.packs, 'paquet')} · ${plural(s.cards, 'carte')}`));
      const theme = WMX.settings.theme || 'green';
      let box;
      if (theme === 'blue') {
        let acc = 0;
        const stops = WMX.RARITIES.map((r) => { const a = acc; acc += pct(r); return `rgb(${RGB[r]}) ${a}% ${acc}%`; }).join(',');
        box = el('div', { class: 'wmx-sbox' }, head, el('div', { class: 'wmx-donutrow' },
          el('div', { class: 'wmx-donut', style: `background:conic-gradient(${s.cards ? stops : '#1a2230 0 100%'})` },
            el('div', { class: 'wmx-donut-c' }, el('b', {}, String(s.cards)), el('small', {}, 'cartes'))),
          el('div', { class: 'wmx-legend' }, ...WMX.RARITIES.map((r) => el('div', { style: `--rgb:${RGB[r]}` }, el('i'), el('b', {}, r), String(s.rarity[r]))))));
      } else if (theme === 'red') {
        box = el('div', { class: 'wmx-sbox' }, head,
          el('div', { class: 'wmx-stack' }, ...WMX.RARITIES.map((r) => el('i', { style: `flex:${s.rarity[r] || 0.0001};background:rgb(${RGB[r]})` }))),
          el('div', { class: 'wmx-chips' }, ...WMX.RARITIES.map((r) => el('span', { class: 'wmx-chip', style: `--rgb:${RGB[r]}` }, el('b', {}, r), String(s.rarity[r])))));
      } else {
        box = el('div', { class: 'wmx-sbox' }, head,
          ...WMX.RARITIES.map((r) => el('div', { class: 'wmx-srow', style: `--rgb:${RGB[r]}` },
            el('b', {}, r),
            el('div', { class: 'wmx-bar' }, el('i', { style: `width:${pct(r).toFixed(1)}%` })),
            el('span', {}, `${pct(r).toFixed(1).replace('.', ',')} %`),
            el('span', {}, String(s.rarity[r])))));
      }
      ui.stats.replaceChildren(box);
    };
    function applyTheme() {
      const t = WMX.settings.theme || 'green';
      document.documentElement.dataset.wmxTheme = t;
      ui.swatches.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
      setAutoBtn();
      render();
    }
    WMX.applySettings = applyTheme; // appelé par la fenêtre de paramètres après « Appliquer »
    applyTheme();
    WMX.onStorage((c) => { if (c.stats) render(); });

    // Reprise : cartes tirées avant un rechargement de la page et jamais révélées.
    const pending = await WMX.store.get('pendingCards', []);
    if (pending.length) WMX.reveal(pending);
  }

  WMX.register({ name: 'boosters', match: /^\/pulls/, init: buildPanel });
})();
