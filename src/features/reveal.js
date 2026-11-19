// Révélation façon gacha, dans le style des cartes du jeu (couleurs/bordures relevées sur le marché).
// 1) pendant l'ouverture : chaque paquet ajoute 5 cartes face cachée neutres, avec le nombre de paquets restants ;
// 2) à la fin : tri du plus commun au plus rare, secousse + aura de rareté, retournement une par une.
(() => {
  const { el, sleep } = WMX.dom;
  const ORDER = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  // Couleurs relevées sur les cartes du jeu (rgb) et rayon de halo.
  const RGB = { C: '183 193 206', PC: '110 231 173', R: '100 191 255', SR: '244 114 182', UR: '255 159 67', L: '255 212 90' };
  const GLOW = { C: 8, PC: 13, R: 17, SR: 22, UR: 28, L: 32 };
  const NAMES = { C: 'Commune', PC: 'Peu commune', R: 'Rare', SR: 'Super rare', UR: 'Ultra rare', L: 'Légendaire' };
  WMX.RARITY_RGB = RGB;
  const rar = (c) => WMX.normRarity(c.rarity) || 'C';
  WMX.sortCards = (cards) => [...cards].sort((a, b) => ORDER.indexOf(rar(a)) - ORDER.indexOf(rar(b)));

  // Image + description courte depuis Wikipédia (comme le jeu), avec cache. Respecte hide_image / nsfw_image.
  const infoCache = new Map();
  // Wikipédia refuse les rafales (429) : 4 requêtes à la fois au plus, et jusqu'à 4 essais espacés avant d'abandonner une image.
  let wikiBusy = 0;
  const wikiQueue = [];
  const wikiSlot = () => new Promise((go) => { const run = () => { wikiBusy += 1; go(); }; if (wikiBusy < 4) run(); else wikiQueue.push(run); });
  const wikiFree = () => { wikiBusy -= 1; wikiQueue.shift()?.(); };
  async function fetchWiki(url) {
    for (let t = 0; t < 4; t++) {
      await wikiSlot();
      let res = null;
      try { res = await fetch(url); } catch (_) { /* réseau */ } finally { wikiFree(); }
      if (res?.ok) return res.json();
      if (res && res.status !== 429 && res.status < 500) return null; // 404 : pas d'article, inutile de réessayer
      await sleep(1500 * (t + 1));
    }
    return null;
  }
  function loadInfo(c) {
    if (WMX.settings?.images === false) return Promise.resolve({});
    const key = `${c.lang || 'fr'}:${c.wikipedia_title}`;
    if (!infoCache.has(key)) {
      infoCache.set(key, (async () => {
        try {
          const url = `https://${c.lang || 'fr'}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(c.wikipedia_title).replace(/ /g, '_'))}`;
          const j = await fetchWiki(url);
          if (!j) { infoCache.delete(key); return {}; } // échec : rien n'est mémorisé, la prochaine demande réessaiera
          return { img: c.hide_image || c.nsfw_image ? null : j.thumbnail?.source, desc: j.description };
        } catch (_) { infoCache.delete(key); return {}; }
      })());
    }
    return infoCache.get(key);
  }

  const styleVars = (r) => `--rgb:${RGB[r]};--wmx-rgb:${RGB[r]};--glow:${GLOW[r]}px`;

  function realTile(c) {
    const r = rar(c);
    const art = el('div', { class: 'wmx-art' });
    const desc = el('small', { class: 'wmx-desc' });
    const priceChip = el('span', { class: 'wmx-ct-price' });
    // Deux boutons à droite de la carte : favori, et enchère rapide (mêmes réglages que dans la collection).
    const item = { card_id: c.id, title: c.wikipedia_title, rarity: r, starred: false };
    const acts = el('div', { class: 'wmx-ct-acts' });
    const paintBtns = () => {
      const q = WMX.quick;
      if (!q) { acts.replaceChildren(); return; }
      const starred = q.isStarred(item);
      const fav = el('button', {
        class: `wmx-bolt wmx-fav${starred ? ' on' : ''}${q.favState(c.id) === 'working' ? ' busy' : ''}`,
        title: starred ? 'Retirer des favoris' : 'Ajouter aux favoris (verrouille la carte : ni défausse, ni vente, ni échange)',
        'aria-label': 'Favori',
      }, starred ? '★' : '☆');
      fav.addEventListener('click', (e) => { e.stopPropagation(); q.toggleFavorite(item); });
      const st = q.stateOf(c.id);
      const glyph = { queued: '⏳', working: '…', cancelling: '…' }[st] || '⚡';
      const bolt = el('button', {
        class: `wmx-bolt${st === 'live' ? ' live' : ''}${st === 'queued' ? ' queued' : ''}${st === 'working' || st === 'cancelling' ? ' busy' : ''}`,
        title: q.hint(item),
        'aria-label': 'Enchère rapide',
      }, glyph);
      if (starred && st === 'idle') bolt.disabled = true;
      bolt.addEventListener('click', (e) => { e.stopPropagation(); q.toggle(item); });
      acts.replaceChildren(fav, bolt);
    };
    paintBtns();
    const styled = WMX.settings?.cardStyle !== false; // mêmes ornements que les cartes du jeu (card-style.js) : cadre lumineux, vagues, reflet
    const face = el('div', { class: `wmx-face${styled ? ' wmx-sty-rv' : ''}` },
      art, el('div', { class: 'wmx-shade' }),
      ...(styled ? [el('span', { class: 'wmx-sty-waves' }), el('span', { class: 'wmx-sty-sheen' })] : []),
      el('span', { class: 'wmx-rar' }, r),
      acts,
      el('div', { class: 'wmx-meta' }, el('strong', {}, c.wikipedia_title || '?'), priceChip, desc));
    // Moyenne du marché : « … » tant qu'elle n'est pas arrivée (chargée en arrière-plan pendant l'ouverture des paquets).
    const paintPrice = () => {
      const p = WMX.prices.get(c.id, r);
      priceChip.textContent = p ? `Moy. ${Math.round(p.avg).toLocaleString('fr-FR')} W` : (WMX.prices.fresh(c.id) ? 'Sans vente' : 'Moy. …');
    };
    paintPrice();
    loadInfo(c).then((i) => {
      if (i.img) WMX.dom.artLayers(i.img, face);
      if (i.desc) desc.textContent = i.desc;
    });
    const tile = el('div', { class: 'wmx-tile', 'data-r': r, style: styleVars(r) },
      el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'), face));
    // Une fois retournée, un clic ouvre la fiche du jeu (étiquette, enchère…).
    tile.addEventListener('click', () => { if (tile.classList.contains('flip')) WMX.openCardDetail?.(c); });
    tile.title = 'Cliquer pour ouvrir la fiche dans le jeu';
    tile._paint = paintPrice;
    tile._paintBtns = paintBtns;
    tile._card = c;
    return tile;
  }

  /** Valeur du lot ajoutée aux statistiques (moyenne par paquet) : seulement si tous les prix sont connus, et une seule fois par lot. */
  async function recordValue(tiles) {
    const cards = tiles.map((t) => t._card);
    if (!cards.length || cards.length % 5) return;
    if (cards.some((c) => !WMX.prices.fresh(c.id))) return; // un prix manque encore : la moyenne serait fausse
    const prices = cards.map((c) => WMX.prices.get(c.id, WMX.normRarity(c.rarity) || 'C'));
    const sig = cards.map((c) => c.id).sort().join(',');
    if (await WMX.store.get('lastValueSig', '') === sig) return;
    await WMX.store.set('lastValueSig', sig);
    WMX.stats.addValue(prices.reduce((s, p) => s + (p?.avg || 0), 0), cards.length / 5); // « sans vente » compte pour 0
  }

  WMX.loadCardInfo = (c) => loadInfo(c); // image + description Wikipédia (cache partagé avec la collection)
  WMX.revealSession = function revealSession({ stoppable = false } = {}) {
    let skip = false;
    let stopped = false; // « Passer » pendant l'ouverture (stoppable) : plus aucun paquet ouvert, les cartes déjà tirées sont montrées d'un coup
    const all = [];
    const title = el('h2', {}, 'Ouverture en cours…');
    const remaining = el('div', { class: 'wmx-remaining' });
    const lot = el('div', { class: 'wmx-lot' });
    let unsub = () => {};
    let remBase = '';
    let remNote = '';
    const grid = el('div', { class: 'wmx-grid' });
    // Cartes tirées mais pas encore vues : conservées si la page du jeu se recharge en cours de route.
    const cont = el('button', { class: 'wmx-btn', disabled: '', onclick: () => { WMX.store.set('pendingCards', []); unsub(); overlay.remove(); } }, 'Continuer');
    const skipBtn = el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => {
      skip = true;
      if (!stoppable || finishing || stopped) return;
      stopped = true;
      skipBtn.textContent = 'Arrêt…';
      skipBtn.disabled = true;
      title.textContent = `${all.length} cartes tirées — arrêt de l’ouverture…`;
    } }, 'Passer');
    if (stoppable) skipBtn.title = 'Arrête l’ouverture (les paquets restants sont gardés) et montre tout de suite les cartes déjà tirées';
    let finishing = false;
    const overlay = el('div', { class: 'wmx-overlay' }, title, remaining, lot, grid, el('div', { class: 'wmx-actions' }, skipBtn, cont));
    document.body.append(overlay);

    /**
     * Valeur du lot : uniquement pour les cartes DÉJÀ RÉVÉLÉES (retournées), pour ne rien spoiler d'une grosse carte à venir.
     * Les prix sont connus à l'avance, mais ne sont montrés qu'au moment où chaque carte se retourne.
     */
    const updateLot = () => {
      const flipped = [...grid.querySelectorAll('.wmx-tile.flip')].filter((t) => t._card);
      if (!flipped.length) { lot.textContent = ''; return; }
      let v = 0;
      let n = 0;
      let none = 0; // prix chargé, mais aucune vente sur le marché pour cette rareté
      for (const t of flipped) {
        const p = WMX.prices.get(t._card.id, WMX.normRarity(t._card.rarity) || 'C');
        if (p) { v += p.avg; n += 1; } else if (WMX.prices.fresh(t._card.id)) none += 1;
      }
      const done = flipped.length === all.length;
      lot.textContent = `${done ? 'Valeur estimée du lot' : 'Valeur des cartes révélées'} : ${Math.round(v).toLocaleString('fr-FR')} W · prix connus : ${n}/${flipped.length}${none ? ` (+ ${none} sans vente sur le marché)` : ''}`;
    };
    let finished = false;
    let recorded = false;
    /** Couronnes sur les cartes les plus chères du lot (1 à 3 selon le nombre de cartes), une fois la révélation terminée. */
    const markCrowns = () => {
      if (!finished) return;
      const tiles = [...grid.querySelectorAll('.wmx-tile')].filter((t) => t._card);
      // Tant qu'un prix manque encore, un classement serait faux : les couronnes n'apparaissent que lorsque tous les prix sont connus.
      if (tiles.some((t) => !WMX.prices.fresh(t._card.id))) return;
      if (!recorded) { recorded = true; recordValue(tiles); } // valeur du lot → moyenne par paquet des statistiques
      grid.querySelectorAll('.wmx-crown').forEach((c) => c.remove());
      const values = tiles.map((t) => WMX.prices.get(t._card.id, WMX.normRarity(t._card.rarity) || 'C')?.avg || 0);
      WMX.logic.crownIndexes(values).forEach((idx, rank) => {
        const c = el('span', { class: 'wmx-crown', 'data-rank': String(rank + 1), title: rank ? `N°${rank + 1} du lot en valeur` : 'Carte la plus chère du lot' });
        c.innerHTML = '<svg viewBox="0 0 24 22" width="100%" height="100%" aria-hidden="true"><path d="M2 18 0.8 5.5 7.2 10.8 12 2.5l4.8 8.3 6.4-5.3L22 18z" fill="currentColor"/><rect x="2" y="18.6" width="20" height="2.4" rx="1.2" fill="currentColor" opacity=".8"/></svg>';
        tiles[idx].append(c);
      });
    };
    const offPrices = WMX.prices.onProgress(() => { grid.querySelectorAll('.wmx-tile').forEach((t) => t._paint?.()); updateLot(); markCrowns(); });
    const repaintBtns = () => grid.querySelectorAll('.wmx-tile').forEach((t) => t._paintBtns?.());
    const offQuick = WMX.quick?.onChange(repaintBtns);
    window.addEventListener('wmx:fav', repaintBtns);
    // Prix manquants (jeu surchargé, requêtes perdues) : on les redemande toutes les 20 s tant que l'écran est ouvert.
    const heal = setInterval(() => {
      if (!overlay.isConnected) { clearInterval(heal); return; }
      const missing = all.filter((c) => !WMX.prices.fresh(c.id));
      if (missing.length) WMX.prices.prefetch?.(missing);
    }, 20000);
    unsub = () => { clearInterval(heal); offPrices(); offQuick?.(); window.removeEventListener('wmx:fav', repaintBtns); };
    WMX.prepareCardSheets?.(); // précharge la fiche du jeu pendant que les cartes se tirent

    return {
      get stopped() { return stopped; },
      addPack(cards) {
        all.push(...cards);
        WMX.store.set('pendingCards', all);
        WMX.prices.prefetch?.(cards); // sans effet si déjà demandés par l'ouverture du paquet
        for (let i = 0; i < cards.length; i++) grid.append(el('div', { class: 'wmx-tile wmx-neutral' },
          el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'))));
        title.textContent = stopped ? `${all.length} cartes tirées — arrêt de l’ouverture…` : `${all.length} cartes tirées…`;
      },
      setRemaining(n, total) {
        // Numéro du paquet ouvert sur le total (1/9, 2/9…) : lisible d'un coup d'œil.
        remBase = n > 0 ? `Paquet ${total - n}/${total}` : `Tous les paquets sont ouverts (${total}/${total})`;
        remaining.textContent = remBase + remNote;
      },
      setNote(t) {
        remNote = t ? ` · ${t}` : '';
        remaining.textContent = remBase + remNote;
      },
      /** Laisse passer les clics vers la vérification du jeu (jamais touchée par l'extension). */
      yield(b) { overlay.classList.toggle('wmx-yield', b); },
      close() { unsub(); overlay.remove(); },
      async finish() {
        finishing = true;
        skipBtn.disabled = false;
        skipBtn.textContent = 'Passer';
        if (!all.length) { unsub(); overlay.remove(); return; }
        const cfg = WMX.settings || {};
        const f = cfg.speed === 'fast' ? 0.4 : 1; // facteur de durée des animations
        if (cfg.speed === 'instant') skip = true;
        const byRarity = cfg.order !== 'draw';
        const sorted = byRarity ? WMX.sortCards(all) : all;
        title.textContent = `${sorted.length} cartes — ${byRarity ? 'des plus communes aux plus rares' : 'dans l’ordre du tirage'}`;
        remaining.textContent = stopped ? remNote.replace(/^ · /, 'Ouverture ') : '';
        const tiles = sorted.map(realTile);
        grid.replaceChildren(...tiles);
        // Style d'ouverture choisi dans les Paramètres (Classique, Pile lumineuse, Vœu) ; « Passer » termine tout de suite.
        await WMX.revealPlay(cfg.revealStyle || 'classic', { root: overlay, grid, tiles, f, skip: () => skip, onFlip: updateLot });
        tiles.forEach((t) => t.classList.add('flip'));
        skipBtn.remove();
        cont.removeAttribute('disabled');
        remaining.textContent = (stopped && remNote ? `${remNote.replace(/^ · a/, 'Ouverture a')} · ` : '') + 'Cliquez sur une carte pour ouvrir sa fiche (étiquette, enchère…)';
        updateLot();
        finished = true;
        markCrowns();
      },
    };
  };

  // --- Styles d'ouverture ------------------------------------------------------------------------------------------------------------
  // Chaque style révèle les cartes (déjà dans la grille, face cachée) une par une et doit respecter skip() (« Passer ») et f (vitesse).
  // La couleur d'une carte n'apparaît qu'au moment de SA révélation (pas de spoil), sauf dans « Vœu », où, comme dans les jeux gacha,
  // l'étoile filante annonce la meilleure rareté du tirage et les cartes brillent de leur couleur avant d'être retournées.
  const RANKS = { C: 0, PC: 1, R: 2, SR: 3, UR: 4, L: 5 };
  WMX.REVEAL_STYLES = [
    ['classic', 'Classique', 'Chaque carte tremble, s’illumine de sa rareté puis se retourne.'],
    ['stack', 'Pile lumineuse', 'Les cartes s’empilent ; celle du dessus brille de sa rareté avant d’être retournée et posée.'],
    ['wish', 'Vœu', 'Une étoile filante de la couleur de la meilleure carte, puis toutes les cartes brillent avant de se retourner.'],
  ];
  /** Attente interrompue par « Passer ». */
  const waitFor = async (ms, skip) => { const end = Date.now() + ms; while (!skip() && Date.now() < end) await sleep(Math.min(50, end - Date.now())); };

  async function playClassic({ tiles, f, skip, onFlip }) {
    for (const t of tiles) {
      if (!skip()) {
        t.classList.add('shake');
        const ticks = { C: 5, PC: 6, R: 8, SR: 11, UR: 16, L: 30 }[t.dataset.r] || 5;
        for (let i = 0; i < ticks && !skip(); i++) await sleep(90 * f);
        t.classList.remove('shake');
      }
      t.classList.add('flip');
      onFlip?.();
      if (!skip()) await sleep(({ UR: 900, L: 2200 }[t.dataset.r] || 280) * f);
    }
  }

  // Pile lumineuse : la pile au centre ; la carte du dessus brille (plus longtemps et plus fort selon sa rareté), se retourne, puis se pose.
  async function playStack({ grid, tiles, f, skip, onFlip }) {
    const slots = tiles.map((t) => { const h = el('div', { class: 'wmx-rv-slot' }); t.replaceWith(h); return h; });
    const count = el('b', { class: 'wmx-rv-count' });
    const deck = el('div', { class: 'wmx-rv-deck' }, el('i'), el('i'), el('i'), count);
    const spot = el('div', { class: 'wmx-rv-spot' });
    const stage = el('div', { class: 'wmx-rv-stage' }, deck, spot);
    grid.before(stage);
    const GLOWMS = { C: 260, PC: 380, R: 650, SR: 950, UR: 1500, L: 2400 };
    let i = 0;
    for (; i < tiles.length && !skip(); i++) {
      const t = tiles[i];
      count.textContent = String(tiles.length - i - 1);
      deck.classList.toggle('empty', tiles.length - i - 1 === 0);
      t.classList.add('wmx-rv-top');
      spot.replaceChildren(t);
      await sleep(30);
      t.classList.add('wmx-rv-glow');
      await waitFor((GLOWMS[t.dataset.r] || 300) * f, skip);
      t.classList.remove('wmx-rv-glow');
      t.classList.add('flip');
      onFlip?.();
      await waitFor((RANKS[t.dataset.r] >= 4 ? 1100 : RANKS[t.dataset.r] >= 2 ? 520 : 300) * f, skip);
      t.classList.remove('wmx-rv-top');
      slots[i].replaceWith(t);
      t.classList.add('wmx-rv-land');
    }
    for (let k = i; k < tiles.length; k++) { slots[k].replaceWith(tiles[k]); tiles[k].classList.remove('wmx-rv-top', 'wmx-rv-glow'); }
    if (spot.firstChild && !spot.firstChild.isConnected) spot.replaceChildren();
    stage.remove();
  }

  // Vœu (inspiré des tirages gacha) : étoile filante de la couleur de la meilleure carte ; puis les cartes apparaissent face cachée en
  // brillant de leur rareté, et se retournent une à une (éclat pour les super rares et au-delà).
  async function playWish({ root, grid, tiles, f, skip, onFlip }) {
    const best = tiles.reduce((b, t) => (RANKS[t.dataset.r] > RANKS[b] ? t.dataset.r : b), 'C');
    const sky = el('div', { class: `wmx-rv-wish r-${best}`, style: styleVars(best) }, el('i', { class: 'wmx-rv-comet' }), el('i', { class: 'wmx-rv-flash' }));
    grid.classList.add('wmx-rv-hidden');
    root.append(sky);
    await waitFor(2000 * f, skip);
    sky.classList.add('out');
    await waitFor(260, skip);
    sky.remove();
    grid.classList.remove('wmx-rv-hidden');
    tiles.forEach((t, k) => { t.style.setProperty('--d', `${Math.min(k, 30) * 45 * f}ms`); t.classList.add('wmx-rv-aura'); });
    await waitFor((600 + Math.min(tiles.length, 30) * 45) * f, skip);
    for (const t of tiles) {
      if (skip()) break;
      const r = RANKS[t.dataset.r];
      if (r >= 3) { t.classList.add('wmx-rv-burst'); await waitFor((r >= 5 ? 900 : 500) * f, skip); }
      t.classList.add('flip');
      onFlip?.();
      await waitFor((r >= 4 ? 900 : r >= 2 ? 360 : 170) * f, skip);
    }
    tiles.forEach((t) => t.classList.remove('wmx-rv-aura'));
  }

  /** Joue un style d'ouverture sur des cartes déjà posées face cachée dans `grid` (dans `root`). */
  WMX.revealPlay = async function revealPlay(style, o) {
    const run = { stack: playStack, wish: playWish }[style] || playClassic; // style inconnu (ou retiré, comme « Décryptage ») : Classique
    try { await run(o); } catch (e) { console.warn('[WMX] style d’ouverture', style, e); }
    o.tiles.forEach((t) => t.classList.add('flip'));
  };

  // --- Aperçu (Paramètres → Paquets) : cinq cartes d'exemple, l'animation du style choisi en boucle --------------------------------
  const DEMO = [['C', 'Bouton'], ['PC', 'Saturne'], ['R', 'Jazz'], ['SR', 'Tour Eiffel'], ['L', 'Mozart']];
  function demoTile(r, name) {
    const face = el('div', { class: 'wmx-face wmx-rv-demoface' }, el('span', { class: 'wmx-rar' }, r), el('div', { class: 'wmx-rv-demoart' }, name.charAt(0)), el('div', { class: 'wmx-meta' }, el('strong', {}, name), el('small', { class: 'wmx-desc' }, NAMES[r])));
    const t = el('div', { class: 'wmx-tile', 'data-r': r, 'data-name': name, style: styleVars(r) }, el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'), face));
    return t;
  }
  /** Aperçu animé du style dans `box` ; rend une fonction d'arrêt. Relancé en boucle tant que la boîte est affichée. */
  WMX.revealPreview = function revealPreview(box, style) {
    let stopped = false;
    const loop = async () => {
      while (!stopped && box.isConnected) {
        const grid = el('div', { class: 'wmx-grid wmx-rv-demogrid' });
        const tiles = DEMO.map(([r, n]) => demoTile(r, n));
        grid.append(...tiles);
        const stage = el('div', { class: 'wmx-rv-demo' }, grid);
        box.replaceChildren(stage);
        await WMX.revealPlay(style, { root: stage, grid, tiles, f: 0.55, skip: () => stopped || !box.isConnected });
        await waitFor(1800, () => stopped || !box.isConnected);
      }
    };
    loop();
    return () => { stopped = true; };
  };

  WMX.reveal = async (cards) => {
    if (!cards.length) return;
    const s = WMX.revealSession();
    s.addPack(cards);
    await s.finish();
  };
})();
