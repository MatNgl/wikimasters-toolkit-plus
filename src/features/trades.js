// Échanges : sur chaque offre (reçues, envoyées, historique), un bilan visible tout de suite, vu de MON côté : « Vous donnez X W » / « Vous recevez Y W »,
// une barre d'équilibre et un verdict (avantageux, désavantageux, équilibré, estimation en cours). Détail des cartes, déplié d'office (repliable) : chaque carte avec sa moyenne
// du marché (icône de fraîcheur : relue au-delà de 24 h, comme sur le Marché), les wikibidous, et pour les cartes que je recevrais, si je les ai déjà.
// Les offres viennent de GET /api/trades (déjà demandé par le jeu) ; les moyennes de la même source que la collection.
(() => {
  const { el } = WMX.dom;
  const trades = new Map();
  const closed = new Set(); // offres dont l'utilisateur a replié le détail (déplié par défaut)
  let timer = null;
  let me = null; // mon identifiant de joueur (déduit, puis mémorisé)
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

  function mapTrade(raw) {
    if (!raw?.id || !raw.initiator_id || !raw.recipient_id) return null;
    const items = (raw.items || []).map((it) => {
      const card = it?.card;
      const id = it?.card_id || card?.id;
      if (!id || !card?.wikipedia_title) return null;
      return { by: it.offered_by, id, title: card.wikipedia_title, rarity: WMX.normRarity(it.snapshot_rarity || card.rarity) || 'C' };
    }).filter(Boolean);
    return {
      id: raw.id, items,
      sides: [
        { uid: raw.initiator_id, name: raw.initiator?.username || 'Initiateur', w: Number(raw.initiator_wikibidous) || 0 },
        { uid: raw.recipient_id, name: raw.recipient?.username || 'Destinataire', w: Number(raw.recipient_wikibidous) || 0 },
      ],
    };
  }

  const cardEls = () => [...document.querySelectorAll('.card-frame')].filter((c) =>
    [...c.querySelectorAll('button[aria-label]')].some((b) => norm(b.getAttribute('aria-label')) === 'voir le détail de l’échange' || norm(b.getAttribute('aria-label')) === "voir le détail de l'échange"));

  /** Offre correspondant à une carte affichée : titres des cartes présents dans l'élément, puis noms des joueurs. */
  function matchTrade(elm, used) {
    if (elm.dataset.wmxTrade && trades.has(elm.dataset.wmxTrade)) return trades.get(elm.dataset.wmxTrade);
    const titled = new Set([...elm.querySelectorAll('[title]')].map((n) => norm(n.getAttribute('title'))));
    const text = norm(elm.textContent);
    let best = null;
    let bestScore = 0;
    for (const t of trades.values()) {
      if (used.has(t.id)) continue;
      const titles = t.items.map((i) => norm(i.title));
      const hit = titles.filter((x) => titled.has(x)).length;
      let score = hit * 30 + (titles.length && hit === titles.length ? 100 : 0) - (titles.length - hit) * 20;
      for (const s of t.sides) if (norm(s.name) && text.includes(norm(s.name))) score += 12;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  /**
   * Mon côté de l'échange : mon identifiant s'il est connu (enchères, ou déjà déduit), sinon le joueur présent dans toutes mes offres,
   * sinon le texte de l'offre (« À X » : c'est moi qui propose ; « De X » : c'est X qui propose). Null si rien ne permet de le dire.
   */
  function mySide(t, elm) {
    const known = me || WMX.auctions?.state?.()?.me || null;
    if (known && t.sides.some((s) => s.uid === known)) return t.sides.findIndex((s) => s.uid === known);
    const all = [...trades.values()];
    if (all.length > 1) {
      const common = t.sides.map((s) => s.uid).filter((uid) => all.every((x) => x.sides.some((s) => s.uid === uid)));
      if (common.length === 1) { remember(common[0]); return t.sides.findIndex((s) => s.uid === common[0]); }
    }
    const head = norm(elm?.textContent || '').slice(0, 80);
    const to = /^à\s+(.+?)(\s|·|$)/.exec(head);
    const from = /^de\s+(.+?)(\s|·|$)/.exec(head);
    if (to && head.startsWith(`à ${norm(t.sides[1].name)}`)) { remember(t.sides[0].uid); return 0; }
    if (from && head.startsWith(`de ${norm(t.sides[0].name)}`)) { remember(t.sides[1].uid); return 1; }
    return -1;
  }
  function remember(uid) { if (uid && uid !== me) { me = uid; WMX.store.set('myUserId', uid); } }

  /** Valeur d'une carte : moyenne, « sans vente » (prix chargé, aucune vente) ou pas encore chargée ; fraîcheur (✓ / ! / ↻). */
  function cardValue(i) {
    const p = WMX.prices.get(i.id, i.rarity);
    return { avg: p?.avg ?? null, priced: WMX.prices.has(i.id), fresh: WMX.prices.freshness ? WMX.prices.freshness(i.id) : null };
  }
  const sideOf = (t, k) => ({ ...t.sides[k], items: t.items.filter((i) => i.by === t.sides[k].uid) });

  function balanceOf(t, mine) {
    const give = sideOf(t, mine < 0 ? 0 : mine);
    const get = sideOf(t, mine < 0 ? 1 : 1 - mine);
    const b = WMX.logic.tradeBalance(
      { w: give.w, cards: give.items.map((i) => { const v = cardValue(i); return { avg: v.avg, priced: v.priced }; }) },
      { w: get.w, cards: get.items.map((i) => { const v = cardValue(i); return { avg: v.avg, priced: v.priced }; }) });
    return { give, get, b };
  }

  /** Bilan toujours visible : deux montants, barre d'équilibre, verdict. Sans « mon côté » connu : les deux joueurs nommés. */
  function summary(t, mine) {
    const { give, get, b } = balanceOf(t, mine);
    const total = b.give + b.get;
    const share = total > 0 ? Math.round((b.give / total) * 100) : 50;
    const who = (s, mineSide) => (mine < 0 ? `${s.name} donne` : mineSide ? 'Vous donnez' : 'Vous recevez');
    let label = b.label;
    if (mine < 0 && (b.kind === 'win' || b.kind === 'loss')) label = `Écart : ${fmt(Math.abs(b.diff))} W en faveur de ${b.diff > 0 ? give.name : get.name}`; // vu de nulle part : on nomme le gagnant
    const notes = [b.noSale ? `${b.noSale} carte${b.noSale > 1 ? 's' : ''} sans vente sur le marché, comptée${b.noSale > 1 ? 's' : ''} 0 W` : '',
      mine < 0 ? 'côté de l’échange non déterminé : montants des deux joueurs' : ''].filter(Boolean);
    return el('div', { class: 'wmx-tv-sum', 'data-kind': mine < 0 && b.kind !== 'pending' && b.kind !== 'even' ? 'neutral' : b.kind },
      el('div', { class: 'wmx-tv-amounts' },
        el('div', { class: 'wmx-tv-amt give' }, el('small', {}, who(give, true)), el('b', {}, `${b.missing ? '≈ ' : ''}${fmt(b.give)} W`)),
        el('div', { class: 'wmx-tv-bar', title: `${fmt(b.give)} W donnés · ${fmt(b.get)} W reçus` }, el('i', { class: 'give', style: `width:${share}%` }), el('i', { class: 'get', style: `width:${100 - share}%` })),
        el('div', { class: 'wmx-tv-amt get' }, el('small', {}, mine < 0 ? `${get.name} donne` : 'Vous recevez'), el('b', {}, `${b.missing ? '≈ ' : ''}${fmt(b.get)} W`))),
      el('div', { class: 'wmx-tv-verdict' }, el('b', {}, label), notes.length ? el('small', {}, notes.join(' · ')) : ''));
  }

  /** Détail : les deux côtés, chaque carte avec sa valeur ; pour les cartes reçues, « déjà possédée » ou « nouvelle ». */
  function detail(t, mine) {
    const col = (k, receiving) => {
      const s = sideOf(t, k);
      let sum = s.w;
      const rows = s.items.map((i) => {
        const v = cardValue(i);
        if (v.avg) sum += v.avg;
        const owned = receiving ? WMX.inventory?.find?.(i.title, i.rarity) : null;
        return el('div', { class: 'wmx-tv-row', style: `--rgb:${WMX.RARITY_RGB?.[i.rarity] || '160 175 168'}` },
          el('b', {}, i.rarity),
          el('span', { title: i.title }, i.title, receiving && mine >= 0 ? el('small', { class: `wmx-tv-own ${owned ? 'dup' : 'new'}` }, owned ? `déjà ×${owned.count || 1}` : 'nouvelle') : ''),
          el('em', {}, v.avg ? `${fmt(v.avg)} W` : v.priced ? 'sans vente' : '…', v.fresh ? el('i', { class: `wmx-age ${v.fresh.state}`, title: v.fresh.line, 'aria-label': v.fresh.line }, v.fresh.icon) : ''));
      });
      if (s.w) rows.push(el('div', { class: 'wmx-tv-row' }, el('b', {}, 'W'), el('span', {}, 'Wikibidous'), el('em', {}, `${fmt(s.w)} W`)));
      if (!rows.length) rows.push(el('div', { class: 'wmx-tv-row wmx-tv-none' }, el('span', {}, 'Rien')));
      const title = mine < 0 ? `${s.name} donne` : receiving ? `Vous recevez (de ${s.name})` : 'Vous donnez';
      return el('div', { class: 'wmx-tv-side' }, el('h5', {}, title), ...rows, el('div', { class: 'wmx-tv-total' }, el('span', {}, 'Total'), el('b', {}, `${fmt(sum)} W`)));
    };
    const giveK = mine < 0 ? 0 : mine;
    return el('div', { class: 'wmx-tv' }, col(giveK, false), col(1 - giveK, true),
      el('p', { class: 'wmx-tv-note' }, 'Valeur = moyenne des ventes du marché pour la rareté de la carte (relue si elle a plus de 24 h) ; 1 wikibidou = 1 W.'));
  }

  function render(elm, t) {
    const mine = mySide(t, elm);
    t.items.forEach((i, k) => WMX.prices.keepFresh(i.id, k, { front: true })); // carte de la page affichée : jamais chargée ou de plus de 24 h, relue avant les tâches de fond
    let wrap = elm.querySelector(':scope > .wmx-tv-wrap');
    if (!wrap) {
      const btn = el('button', { class: 'wmx-btn wmx-btn--ghost wmx-tv-btn', type: 'button' }, 'Détail des cartes');
      wrap = el('div', { class: 'wmx-tv-wrap' }, el('div', { class: 'wmx-tv-slot' }), btn);
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = trades.get(elm.dataset.wmxTrade);
        if (!cur) return;
        if (closed.has(cur.id)) closed.delete(cur.id); else closed.add(cur.id);
        render(elm, cur);
      });
      elm.append(wrap);
    }
    const isOpen = !closed.has(t.id);
    const sig = [mine, isOpen, ...t.items.map((i) => { const v = cardValue(i); return `${v.avg ?? ''}|${v.priced ? 1 : 0}|${v.fresh?.state || ''}`; })].join(',');
    if (wrap.dataset.sig === sig) return; // rien n'a changé : pas de reconstruction (évite une boucle avec l'observateur)
    wrap.dataset.sig = sig;
    wrap.querySelector('.wmx-tv-slot').replaceChildren(summary(t, mine));
    wrap.querySelector('.wmx-tv-btn').textContent = isOpen ? 'Masquer le détail' : 'Détail des cartes';
    wrap.querySelector(':scope > .wmx-tv')?.remove();
    if (isOpen) wrap.append(detail(t, mine));
  }

  function scan() {
    if (!/^\/trades/.test(location.pathname)) return;
    const used = new Set();
    for (const elm of cardEls()) {
      const t = matchTrade(elm, used);
      if (!t) continue;
      used.add(t.id);
      elm.dataset.wmxTrade = t.id;
      render(elm, t);
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 250); };

  WMX.register({
    name: 'trades',
    match: /^\/trades/,
    async init() {
      me = await WMX.store.get('myUserId', null);
      WMX.onApi(({ path, data }) => {
        if (path !== '/api/trades') return;
        for (const raw of data?.trades || []) { const t = mapTrade(raw); if (t) trades.set(t.id, t); }
        schedule();
      });
      new MutationObserver((muts) => { if (WMX.dom.foreign(muts)) schedule(); }).observe(document.body, { childList: true, subtree: true });
      WMX.prices.onProgress(() => schedule());
      schedule();
    },
  });
  WMX.tradeValues = { mapTrade, scan };
})();
