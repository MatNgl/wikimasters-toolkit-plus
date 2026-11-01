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
    ui.autoBtn.textContent = state.auto ? 'Arrêter l’ouverture auto' : 'Ouvrir automatiquement';
    ui.autoBtn.classList.toggle('wmx-btn--danger', state.auto);
  };

  // --- Ouverture d'un paquet via l'interface native ------------------------------------------
  /** Revient à l'écran « Ouvrir » : flèche ronde pour passer les cartes, puis « Continuer ». */
  async function dismissResult() {
    const outside = (e) => !e.closest('.wmx-panel, .wmx-overlay');
    const nativeOpen = () => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === 'ouvrir');
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

  async function openOne(session) {
    const btn = findExact('ouvrir', 'button');
    if (!btn) return null;
    lastCards = null;
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
    const ok = !cards || (await dismissResult());
    document.documentElement.classList.remove('wmx-opening');
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
      if (packs >= max && cfg.fullStockOpen) { toOpen = packs - reserve; why = 'stock plein'; }
      else if (packs > reserve) {
        if (wait <= 0) toOpen = 1;
        else if (cfg.anticipate && nextIn != null && nextIn + (max - packs - 1) * regen <= wait + 60) { toOpen = 1; why = 'avant blocage du stock'; }
      }
      if (toOpen > 0) {
        setStatus(why ? `Ouverture anticipée (${why})` : 'Ouverture…');
        await openBatch(toOpen);
        nextAt = Date.now() + interval();
      } else if (state.auto) {
        setStatus(`Prochaine ouverture dans ${mmss(Math.max(0, wait))}${packs <= reserve ? ' (réserve atteinte)' : ''}`);
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

    const body = el('div', { class: 'wmx-body' },
      el('button', { class: 'wmx-btn wmx-btn--wide', onclick: openAll }, 'Tout ouvrir'),
      ui.autoBtn,
      ui.status,
      el('h4', {}, 'Intervalle de l’ouverture auto'),
      field('Minimum (min)', ui.min, 'Entre 1 et 60 minutes. Un intervalle court = plus de requêtes envoyées au jeu.'),
      field('Maximum (min)', ui.max, 'Jusqu’à 60 minutes.'),
      el('h4', {}, 'Statistiques'),
      ui.stats,
      el('button', { class: 'wmx-link', onclick: () => WMX.stats.reset() }, 'Réinitialiser les statistiques'));

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

    const render = async () => {
      const s = await WMX.stats.get();
      const pct = (r) => (s.cards ? (s.rarity[r] / s.cards) * 100 : 0);
      const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
      ui.stats.replaceChildren(el('div', { class: 'wmx-sbox' },
        el('div', { class: 'wmx-shead' }, el('span', {}, 'Vos statistiques'), el('span', {}, `${plural(s.packs, 'paquet')} · ${plural(s.cards, 'carte')}`)),
        ...WMX.RARITIES.map((r) => el('div', { class: 'wmx-srow', style: `--rgb:${WMX.RARITY_RGB[r]}` },
          el('b', {}, r),
          el('div', { class: 'wmx-bar' }, el('i', { style: `width:${pct(r).toFixed(1)}%` })),
          el('span', {}, `${pct(r).toFixed(1).replace('.', ',')} %`),
          el('span', {}, String(s.rarity[r]))))));
    };
    render();
    chrome.storage.onChanged.addListener((c) => { if (c.stats) render(); });

    // Reprise : cartes tirées avant un rechargement de la page et jamais révélées.
    const pending = await WMX.store.get('pendingCards', []);
    if (pending.length) WMX.reveal(pending);
  }

  WMX.register({ name: 'boosters', match: /^\/pulls/, init: buildPanel });
})();
