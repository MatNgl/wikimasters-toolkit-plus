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
    // Cartes tirées mais pas encore vues : conservées si la page du jeu se recharge en cours de route.
    const cont = el('button', { class: 'wmx-btn', disabled: '', onclick: () => { WMX.store.set('pendingCards', []); overlay.remove(); } }, 'Continuer');
    const skipBtn = el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { skip = true; } }, 'Passer');
    const overlay = el('div', { class: 'wmx-overlay' }, title, remaining, grid, el('div', { class: 'wmx-actions' }, skipBtn, cont));
    document.body.append(overlay);

    return {
      addPack(cards) {
        all.push(...cards);
        WMX.store.set('pendingCards', all);
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
        const cfg = WMX.settings || {};
        const f = cfg.speed === 'fast' ? 0.4 : 1; // facteur de durée des animations
        if (cfg.speed === 'instant') skip = true;
        const byRarity = cfg.order !== 'draw';
        const sorted = byRarity ? WMX.sortCards(all) : all;
        title.textContent = `${sorted.length} cartes — ${byRarity ? 'des plus communes aux plus rares' : 'dans l’ordre du tirage'}`;
        remaining.textContent = '';
        const tiles = sorted.map(realTile);
        grid.replaceChildren(...tiles);
        for (const t of tiles) {
          if (!skip) {
            // La couleur n'apparaît qu'au moment où CETTE carte se révèle : pas de spoil des suivantes.
            t.classList.add('shake');
            const ticks = { C: 5, PC: 6, R: 8, SR: 11, UR: 16, L: 30 }[t.dataset.r] || 5;
            for (let i = 0; i < ticks && !skip; i++) await sleep(90 * f);
            t.classList.remove('shake');
          }
          t.classList.add('flip');
          if (!skip) await sleep(({ UR: 900, L: 2200 }[t.dataset.r] || 280) * f);
        }
        tiles.forEach((t) => t.classList.add('flip'));
        skipBtn.remove();
        cont.removeAttribute('disabled');
      },
    };
  };

  WMX.reveal = async (cards) => {
    if (!cards.length) return;
    const s = WMX.revealSession();
    s.addPack(cards);
    await s.finish();
  };
})();
