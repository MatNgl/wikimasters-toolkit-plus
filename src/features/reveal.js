// Révélation façon gacha : cartes face cachée triées du plus commun au plus rare,
// secousse + aura aux couleurs de la rareté, retournement, bouton « Passer ».
(() => {
  const { el, sleep } = WMX.dom;
  const ORDER = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  const COLORS = { C: '#9ca3af', PC: '#86efac', R: '#60a5fa', SR: '#c084fc', UR: '#fb923c', L: '#facc15' };
  const NAMES = { C: 'Commune', PC: 'Peu commune', R: 'Rare', SR: 'Super rare', UR: 'Ultra rare', L: 'Légendaire' };
  const rar = (c) => WMX.normRarity(c.rarity) || 'C';
  WMX.sortCards = (cards) => [...cards].sort((a, b) => ORDER.indexOf(rar(a)) - ORDER.indexOf(rar(b)));

  const face = (c) => {
    const r = rar(c);
    return el('div', { class: 'wmx-face' },
      el('span', { class: 'wmx-rar' }, r),
      el('strong', {}, c.wikipedia_title || '?'),
      el('small', {}, NAMES[r]),
      el('div', { class: 'wmx-stat' }, `⚔ ${c.atk ?? '-'}   🛡 ${c.def ?? '-'}`),
      el('div', { class: 'wmx-stat' }, `👁 ${c.pageviews ?? '-'}`));
  };

  WMX.reveal = async function reveal(cards) {
    if (!cards.length) return;
    const sorted = WMX.sortCards(cards);
    let skip = false;
    const grid = el('div', { class: 'wmx-grid' });
    const cont = el('button', { class: 'wmx-btn', disabled: '', onclick: () => overlay.remove() }, 'Continuer');
    const skipBtn = el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { skip = true; } }, 'Passer');
    const overlay = el('div', { class: 'wmx-overlay' },
      el('h2', {}, `${sorted.length} cartes — des plus communes aux plus rares`),
      grid, el('div', { class: 'wmx-actions' }, skipBtn, cont));
    const tiles = sorted.map((c) => {
      const r = rar(c);
      const t = el('div', { class: 'wmx-tile', 'data-r': r, style: `--c:${COLORS[r]}` },
        el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'), face(c)));
      grid.append(t);
      return t;
    });
    document.body.append(overlay);

    for (const t of tiles) {
      if (!skip) {
        t.classList.add('shake');
        const big = ['UR', 'L'].includes(t.dataset.r);
        for (let i = 0; i < (big ? 14 : 8) && !skip; i++) await sleep(100);
        t.classList.remove('shake');
      }
      t.classList.add('flip');
      if (!skip) await sleep(450);
    }
    tiles.forEach((t) => t.classList.add('flip'));
    skipBtn.remove();
    cont.removeAttribute('disabled');
  };
})();
