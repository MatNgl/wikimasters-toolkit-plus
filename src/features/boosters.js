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
    const re = /^(encore \d+ cartes?|continuer|fermer|terminer|passer|suivant)$/i;
    for (let i = 0; i < 40; i++) {
      if (findExact('ouvrir', 'button')) return true;
      const n = [...document.querySelectorAll('button, [role=button], a, div')]
        .find((e) => e.children.length <= 2 && re.test(e.textContent.trim()) && !e.closest('.wmx-panel, .wmx-overlay'));
      if (n) n.click();
      await sleep(300);
    }
    return false;
  }

  async function openOne() {
    const btn = findExact('ouvrir', 'button');
    if (!btn) return null;
    lastCards = null;
    document.documentElement.classList.add('wmx-opening');
    btn.click();
    const end = Date.now() + 180000; // laisse le temps à la vérification humaine, faite par l'utilisateur
    while (!lastCards && Date.now() < end) {
      setStatus(humanCheck() ? 'Vérification du jeu : cliquez-la si besoin…' : 'Ouverture…');
      await sleep(250);
    }
    const cards = lastCards;
    if (cards && !(await dismissResult())) { setStatus('Écran de résultat inattendu : rechargement'); location.reload(); }
    document.documentElement.classList.remove('wmx-opening');
    return cards;
  }

  async function openAll() {
    if (state.busy) return;
    state.busy = true;
    const delay = Number(ui.delay.value) * 1000 || 1000;
    const got = [];
    try {
      for (let n = packsLeft(); n > 0 && state.busy; n--) {
        const cards = await openOne();
        if (!cards) break;
        got.push(...cards);
        setStatus(`${got.length / 5} paquet(s) ouvert(s)`);
        await sleep(delay);
      }
    } finally { state.busy = false; setStatus(''); }
    WMX.reveal(got);
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
    const p = await WMX.store.get('openPrefs', { min: 20, max: 60, delay: 1 });
    const save = () => WMX.store.set('openPrefs', { min: ui.min.value, max: ui.max.value, delay: ui.delay.value });
    ui.badge = el('div', { class: 'wmx-badge', hidden: '' });
    ui.status = el('div', { class: 'wmx-status' });
    ui.stats = el('div', { class: 'wmx-pstats' });
    ui.min = el('input', { class: 'wmx-input', type: 'number', min: '5', value: p.min });
    ui.max = el('input', { class: 'wmx-input', type: 'number', min: '5', value: p.max });
    ui.delay = el('input', { class: 'wmx-input', type: 'number', min: '0.5', step: '0.5', value: p.delay });
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
      ui.stats.replaceChildren(el('div', {}, `${s.packs} paquets · ${s.cards} cartes`),
        ...WMX.RARITIES.map((r) => el('div', { class: 'wmx-row' }, el('b', {}, r),
          `${s.rarity[r]}  (${s.cards ? ((s.rarity[r] / s.cards) * 100).toFixed(1) : 0} %)`)));
    };
    render();
    chrome.storage.onChanged.addListener((c) => { if (c.stats) render(); });
  }

  WMX.register({ name: 'boosters', match: /^\/pulls/, init: buildPanel });
})();
