// Ouverture groupée / automatique. Pilote le bouton natif « Ouvrir » (le flux du jeu, y compris
// sa vérification humaine, reste intact) et capte les cartes dans la réponse /api/packs/open.
// La vérification humaine n'est JAMAIS touchée : on attend qu'elle disparaisse.
(() => {
  const { el, findExact, sleep } = WMX.dom;
  const state = { busy: false, auto: false, buffer: [], opened: 0 };
  let lastCards = null;
  const ui = {};

  WMX.onApi(({ path, method, data }) => {
    if (method === 'POST' && path === '/api/packs/open' && data?.cards) lastCards = data.cards;
  });

  const packsLeft = () => Number((document.body.innerText.match(/(\d+)\s*\/\s*10\s*paquets?/i) || [])[1] || 0);
  const humanCheck = () => /vérification rapide/i.test(document.body.innerText);
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const setStatus = (t) => { if (ui.status) ui.status.textContent = t; };
  const setBadge = () => {
    ui.badge.hidden = !state.auto;
    ui.badge.textContent = `Auto : ${state.opened} paquet(s) ouvert(s)`;
  };

  /** Étapes natives pour revenir à l'écran « Ouvrir » après un paquet (à confirmer en conditions réelles). */
  async function dismissResult() {
    // Observé : flèche ronde sans texte pour passer les cartes ; « Encore N cartes » reste inactif
    // jusqu'à la dernière, puis le bouton devient « Continuer ».
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

  async function openAll() {
    if (state.busy) return;
    const total = packsLeft();
    if (!total) { setStatus('Aucun paquet disponible'); return; }
    state.busy = true;
    const delay = Number(ui.delay.value) * 1000 || 300;
    const session = WMX.revealSession();
    session.setRemaining(total, total);
    try {
      for (let done = 0; done < total && state.busy; done++) {
        const cards = await openOne(session);
        if (!cards) break;
        session.addPack(cards);
        session.setRemaining(total - done - 1, total);
        await sleep(delay);
      }
    } finally { state.busy = false; setStatus(''); }
    await session.finish();
  }

  async function autoLoop() {
    while (state.auto) {
      const ms = rand(Number(ui.min.value), Number(ui.max.value)) * 1000;
      for (let t = 0; t < ms && state.auto; t += 250) await sleep(250);
      if (!state.auto) break;
      if (!state.busy && packsLeft() > 0) {
        state.busy = true;
        const cards = await openOne();
        state.busy = false;
        if (cards) { state.buffer.push(...cards); state.opened += 1; setBadge(); }
      }
    }
  }

  function stopAuto() {
    state.auto = false;
    const cards = state.buffer;
    state.buffer = []; state.opened = 0;
    setBadge(); setStatus('');
    WMX.reveal(cards);
  }

  async function buildPanel() {
    const p = await WMX.store.get('openPrefs', { min: 20, max: 60, delay: 0.3 });
    const save = () => WMX.store.set('openPrefs', { min: ui.min.value, max: ui.max.value, delay: ui.delay.value });
    ui.badge = el('div', { class: 'wmx-badge', hidden: '' });
    ui.status = el('div', { class: 'wmx-status' });
    ui.stats = el('div', { class: 'wmx-pstats' });
    ui.min = el('input', { class: 'wmx-input', type: 'number', min: '5', value: p.min });
    ui.max = el('input', { class: 'wmx-input', type: 'number', min: '5', value: p.max });
    ui.delay = el('input', { class: 'wmx-input', type: 'number', min: '0', step: '0.1', value: p.delay });
    [ui.min, ui.max, ui.delay].forEach((i) => i.addEventListener('change', save));
    const autoBtn = el('button', { class: 'wmx-btn', onclick: () => {
      if (state.auto) { stopAuto(); autoBtn.textContent = 'Ouvrir automatiquement'; }
      else { state.auto = true; autoBtn.textContent = 'Arrêter'; setBadge(); autoLoop(); }
    } }, 'Ouvrir automatiquement');
    const panel = el('aside', { class: 'wmx-panel' },
      ui.badge,
      el('h3', {}, 'WikiMasters Toolkit+'),
      el('button', { class: 'wmx-btn wmx-btn--wide', onclick: openAll }, 'Tout ouvrir'),
      ui.status,
      el('h4', {}, 'Ouverture auto'),
      el('label', {}, 'Intervalle min (s)', ui.min),
      el('label', {}, 'Intervalle max (s)', ui.max),
      autoBtn,
      el('h4', {}, 'Réglages'),
      el('label', {}, 'Pause entre paquets (s)', ui.delay),
      el('h4', {}, 'Statistiques'),
      ui.stats,
      el('button', { class: 'wmx-link', onclick: () => WMX.stats.reset() }, 'Réinitialiser'));
    document.body.append(panel, el('div', { class: 'wmx-cover' }));
    const render = async () => {
      const s = await WMX.stats.get();
      const pct = (r) => (s.cards ? (s.rarity[r] / s.cards) * 100 : 0);
      ui.stats.replaceChildren(el('div', { class: 'wmx-sbox' },
        el('div', { class: 'wmx-shead' }, el('span', {}, 'Vos statistiques'), el('span', {}, `${s.packs} paquets · ${s.cards} cartes`)),
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
