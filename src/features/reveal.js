// Révélation façon gacha, dans le style des cartes du jeu (couleurs/bordures relevées sur le marché).
// 1) pendant l'ouverture : chaque paquet ajoute 5 cartes face cachée neutres, avec le nombre de paquets restants ;
// 2) à la fin : tri du plus commun au plus rare, secousse + aura de rareté, retournement une par une.
(() => {
  const { el, sleep } = WMX.dom;
  const ORDER = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  // Couleurs relevées sur les cartes du jeu (rgb) et rayon de halo.
  const RGB = { C: '183 193 206', PC: '110 231 173', R: '100 191 255', SR: '201 140 255', UR: '255 159 67', L: '255 212 90' };
  const GLOW = { C: 8, PC: 13, R: 17, SR: 22, UR: 28, L: 32 };
  const NAMES = { C: 'Commune', PC: 'Peu commune', R: 'Rare', SR: 'Super rare', UR: 'Ultra rare', L: 'Légendaire' };
  WMX.RARITY_RGB = RGB;
  const rar = (c) => WMX.normRarity(c.rarity) || 'C';
  WMX.sortCards = (cards) => [...cards].sort((a, b) => ORDER.indexOf(rar(a)) - ORDER.indexOf(rar(b)));

  // Image + description courte depuis Wikipédia (comme le jeu), avec cache. Respecte hide_image / nsfw_image.
  const infoCache = new Map();
  function loadInfo(c) {
    const key = `${c.lang || 'fr'}:${c.wikipedia_title}`;
    if (!infoCache.has(key)) {
      infoCache.set(key, (async () => {
        try {
          const url = `https://${c.lang || 'fr'}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(c.wikipedia_title).replace(/ /g, '_'))}`;
          const res = await fetch(url);
          if (!res.ok) return {};
          const j = await res.json();
          return { img: c.hide_image || c.nsfw_image ? null : j.thumbnail?.source, desc: j.description };
        } catch (_) { return {}; }
      })());
    }
    return infoCache.get(key);
  }

  const styleVars = (r) => `--rgb:${RGB[r]};--glow:${GLOW[r]}px`;

  function realTile(c) {
    const r = rar(c);
    const art = el('div', { class: 'wmx-art' });
    const desc = el('small', { class: 'wmx-desc' });
    const face = el('div', { class: 'wmx-face' },
      art, el('div', { class: 'wmx-shade' }),
      el('span', { class: 'wmx-rar' }, r),
      el('div', { class: 'wmx-meta' }, el('strong', {}, c.wikipedia_title || '?'), desc));
    loadInfo(c).then((i) => {
      if (i.img) art.style.backgroundImage = `url("${i.img}")`;
      if (i.desc) desc.textContent = i.desc;
    });
    return el('div', { class: 'wmx-tile', 'data-r': r, style: styleVars(r) },
      el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'), face));
  }

  WMX.revealSession = function revealSession() {
    let skip = false;
    const all = [];
    const title = el('h2', {}, 'Ouverture en cours…');
    const remaining = el('div', { class: 'wmx-remaining' });
    const grid = el('div', { class: 'wmx-grid' });
    const cont = el('button', { class: 'wmx-btn', disabled: '', onclick: () => overlay.remove() }, 'Continuer');
    const skipBtn = el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { skip = true; } }, 'Passer');
    const overlay = el('div', { class: 'wmx-overlay' }, title, remaining, grid, el('div', { class: 'wmx-actions' }, skipBtn, cont));
    document.body.append(overlay);

    return {
      addPack(cards) {
        all.push(...cards);
        for (let i = 0; i < cards.length; i++) grid.append(el('div', { class: 'wmx-tile wmx-neutral' },
          el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'))));
        title.textContent = `${all.length} cartes tirées…`;
      },
      setRemaining(n, total) {
        remaining.textContent = n > 0 ? `${n} paquet${n > 1 ? 's' : ''} restant${n > 1 ? 's' : ''} sur ${total}` : 'Tous les paquets sont ouverts';
      },
      /** Laisse passer les clics vers la vérification du jeu (jamais touchée par l'extension). */
      yield(b) { overlay.classList.toggle('wmx-yield', b); },
      close() { overlay.remove(); },
      async finish() {
        if (!all.length) { overlay.remove(); return; }
        const sorted = WMX.sortCards(all);
        title.textContent = `${sorted.length} cartes — des plus communes aux plus rares`;
        remaining.textContent = '';
        const tiles = sorted.map(realTile);
        grid.replaceChildren(...tiles);
        for (const t of tiles) {
          if (!skip) {
            t.classList.add('shake');
            const big = ['UR', 'L'].includes(t.dataset.r);
            for (let i = 0; i < (big ? 12 : 5) && !skip; i++) await sleep(90);
            t.classList.remove('shake');
          }
          t.classList.add('flip');
          if (!skip) await sleep(big(t) ? 700 : 280);
        }
        tiles.forEach((t) => t.classList.add('flip'));
        skipBtn.remove();
        cont.removeAttribute('disabled');
      },
    };
    function big(t) { return ['UR', 'L'].includes(t.dataset.r); }
  };

  WMX.reveal = async (cards) => {
    if (!cards.length) return;
    const s = WMX.revealSession();
    s.addPack(cards);
    await s.finish();
  };
})();
