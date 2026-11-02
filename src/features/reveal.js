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
    if (WMX.settings?.images === false) return Promise.resolve({});
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
    const priceChip = el('span', { class: 'wmx-ct-price' });
    // Deux boutons à droite de la carte : favori, et enchère rapide (mêmes réglages que dans Collection+).
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
    const face = el('div', { class: 'wmx-face' },
      art, el('div', { class: 'wmx-shade' }),
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
    const prices = cards.map((c) => WMX.prices.get(c.id, WMX.normRarity(c.rarity) || 'C'));
    if (prices.some((p) => !p)) return;
    const sig = cards.map((c) => c.id).sort().join(',');
    if (await WMX.store.get('lastValueSig', '') === sig) return;
    await WMX.store.set('lastValueSig', sig);
    WMX.stats.addValue(prices.reduce((s, p) => s + p.avg, 0), cards.length / 5);
  }

  WMX.loadCardInfo = (c) => loadInfo(c); // image + description Wikipédia (cache partagé avec Collection+)
  WMX.revealSession = function revealSession() {
    let skip = false;
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
    const skipBtn = el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { skip = true; } }, 'Passer');
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
      for (const t of flipped) {
        const p = WMX.prices.get(t._card.id, WMX.normRarity(t._card.rarity) || 'C');
        if (p) { v += p.avg; n += 1; }
      }
      const done = flipped.length === all.length;
      lot.textContent = `${done ? 'Valeur estimée du lot' : 'Valeur des cartes révélées'} : ${Math.round(v).toLocaleString('fr-FR')} W · prix connus : ${n}/${flipped.length}`;
    };
    let finished = false;
    /** Couronnes sur les cartes les plus chères du lot (1 à 3 selon le nombre de cartes), une fois la révélation terminée. */
    const markCrowns = () => {
      if (!finished) return;
      const tiles = [...grid.querySelectorAll('.wmx-tile')].filter((t) => t._card);
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
    unsub = () => { offPrices(); offQuick?.(); window.removeEventListener('wmx:fav', repaintBtns); };
    WMX.prepareCardSheets?.(); // précharge la fiche du jeu pendant que les cartes se tirent

    return {
      addPack(cards) {
        all.push(...cards);
        WMX.store.set('pendingCards', all);
        WMX.prices.prefetch?.(cards); // sans effet si déjà demandés par l'ouverture du paquet
        for (let i = 0; i < cards.length; i++) grid.append(el('div', { class: 'wmx-tile wmx-neutral' },
          el('div', { class: 'wmx-inner' }, el('div', { class: 'wmx-back' }, 'W'))));
        title.textContent = `${all.length} cartes tirées…`;
      },
      setRemaining(n, total) {
        remBase = n > 0 ? `${n} paquet${n > 1 ? 's' : ''} restant${n > 1 ? 's' : ''} sur ${total}` : 'Tous les paquets sont ouverts';
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
        if (!all.length) { unsub(); overlay.remove(); return; }
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
          updateLot(); // le total grandit au fil des cartes révélées
          if (!skip) await sleep(({ UR: 900, L: 2200 }[t.dataset.r] || 280) * f);
        }
        tiles.forEach((t) => t.classList.add('flip'));
        skipBtn.remove();
        cont.removeAttribute('disabled');
        remaining.textContent = 'Cliquez sur une carte pour ouvrir sa fiche (étiquette, enchère…)';
        updateLot();
        finished = true;
        markCrowns();
        recordValue(tiles);
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
