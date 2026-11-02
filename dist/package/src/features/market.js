// Marché : sous chaque enchère de la liste, la moyenne du marché de la carte (même source que la collection) et un verdict
// « bonne affaire / prix correct / trop cher » comparant la mise (ou le prix de départ) à cette moyenne. Sur MES ventes : pas de
// bouton de mise, et le verdict devient « bénéfice / prix du marché / à perte ».
//
// Les enchères affichées sont reconnues par leur identifiant (lien /marketplace/{id}) grâce aux réponses de /api/marketplace
// déjà demandées par le jeu ; à défaut, une requête identique est faite une fois. La moyenne n'est demandée que pour les
// cartes réellement visibles à l'écran (file prioritaire de prices.js, une requête à la fois).
(() => {
  const { el } = WMX.dom;
  const byAuction = new Map(); // id d'enchère -> { card_id, rarity, price }
  let io = null;
  let timer = null;
  let fetched = false;

  const learn = (list, kind) => {
    for (const a of Array.isArray(list) ? list : []) {
      if (a?.id && a.card_id) {
        byAuction.set(a.id, { kind, seller: a.seller_id, endAt: a.end_at ? new Date(a.end_at).getTime() : null, status: a.status,
          title: a.card?.wikipedia_title || '', card_id: a.card_id, rarity: WMX.normRarity(a.snapshot_rarity || a.card?.rarity) || 'C', price: a.current_bid || a.base_amount });
      }
    }
  };
  // Du moins prioritaire au plus prioritaire : une enchère présente dans plusieurs listes garde le rôle le plus précis.
  const KINDS = [['auctions', 'browse'], ['history', 'history'], ['won', 'won'], ['bidding', 'bidding'], ['selling', 'selling']];
  const learnAll = (data) => { for (const [k, kind] of KINDS) learn(data?.[k], kind); };

  /** « sale » : une de MES ventes (ni mise ni verdict d'achat) ; « ended » : terminée ; « buy » : enchère sur laquelle je peux miser. */
  function roleOf(id, info) {
    const st = WMX.auctions?.state?.();
    if (st?.selling?.some((x) => x.id === id) || info.kind === 'selling' || (st?.me && info.seller === st.me)) return 'sale';
    if (info.kind === 'history' || info.kind === 'won' || (info.status && info.status !== 'active') || (info.endAt && info.endAt < Date.now())) return 'ended';
    return 'buy';
  }

  const anchors = () => [...document.querySelectorAll('a.card-frame[href^="/marketplace/"]')];
  const idOf = (a) => a.getAttribute('href').split('/').pop().split(/[?#]/)[0];

  const BID_LABEL = { none: 'Miser le minimum', outbid: 'Surenchérir (minimum)', leading: '✓ Vous menez', queued: '⏳ En file d’attente', betting: 'Mise en cours…' };
  /** Bouton de mise : pose le minimum proposé par le jeu sans ouvrir la page de l'enchère (page préchargée au survol). */
  function ensureBid(a, info) {
    const id = idOf(a);
    let btn = a.querySelector(':scope > .wmx-mk-bid');
    if (!btn) {
      btn = el('button', { class: 'wmx-btn wmx-mk-bid', type: 'button' });
      btn.addEventListener('pointerenter', () => WMX.auctions?.warm(id));
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); // le bouton est dans un lien : pas de navigation
        if (!WMX.auctions) return;
        WMX.auctions.bidById(id, info.title); // mis en file : on peut cliquer sur d'autres cartes sans attendre
        paintBid(a);
      });
      a.append(btn);
    }
    paintBid(a);
  }
  function paintBid(a) {
    const btn = a.querySelector(':scope > .wmx-mk-bid');
    if (!btn || !WMX.auctions) return;
    const st = WMX.auctions.stateOf(idOf(a));
    btn.textContent = BID_LABEL[st];
    btn.classList.toggle('ok', st === 'leading');
    btn.disabled = st === 'leading' || st === 'queued' || st === 'betting';
  }

  function paint(a) {
    const info = byAuction.get(idOf(a));
    if (!info) return;
    const role = roleOf(idOf(a), info);
    if (role === 'buy') ensureBid(a, info); else a.querySelector(':scope > .wmx-mk-bid')?.remove(); // pas de mise sur mes ventes ni sur une enchère terminée
    let b = a.querySelector(':scope > .wmx-mk');
    if (!b) { b = el('div', { class: 'wmx-mk' }); a.append(b); }
    const p = WMX.prices.get(info.card_id, info.rarity);
    if (!p && !WMX.prices.fresh(info.card_id)) { b.className = 'wmx-mk wait'; b.textContent = 'Moy. …'; return; }
    const v = role === 'sale' ? WMX.logic.saleVerdict(info.price, p?.avg, p?.count) : WMX.logic.dealVerdict(info.price, p?.avg, p?.count);
    b.className = `wmx-mk ${v.kind}`;
    b.replaceChildren(
      el('span', {}, p ? `Moy. ${Math.round(p.avg).toLocaleString('fr-FR')} W` : 'Sans vente'),
      el('b', {}, v.kind === 'unknown' ? v.label : `${v.pct > 0 ? '+' : ''}${v.pct} % · ${v.label}`));
    b.title = (role === 'sale' ? 'Votre vente comparée à la moyenne du marché (bénéfice ou vente sous la moyenne). ' : '') + (p ? `Moyenne de ${p.count} vente${p.count > 1 ? 's' : ''} de cette rareté · dernière vente ${Math.round(p.last).toLocaleString('fr-FR')} W${v.low ? ' · peu de ventes : estimation fragile' : ''}` : 'Aucune vente de cette rareté sur le marché');
  }

  /** Une carte devient visible : on récupère sa moyenne si elle manque, puis on affiche le verdict. */
  async function onVisible(a) {
    const info = byAuction.get(idOf(a));
    if (!info) { delete a.dataset.wmxMk; return; } // liste pas encore connue : sera reprise au prochain passage
    paint(a);
    if (!WMX.prices.get(info.card_id, info.rarity) && !WMX.prices.fresh(info.card_id)) {
      await WMX.prices.fetchOne(info.card_id);
      if (a.isConnected) paint(a);
    }
  }

  async function scan() {
    if (!/^\/marketplace\/?$/.test(location.pathname)) return;
    const list = anchors();
    if (!list.length) return;
    if (!list.some((a) => byAuction.has(idOf(a))) && !fetched) { // le jeu n'a pas (encore) transmis la liste : même requête que lui
      fetched = true;
      try {
        const u = new URL('/api/marketplace', location.origin);
        u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent');
        const res = await fetch(u);
        if (res.ok) learnAll(await res.json());
      } catch (err) { WMX.reportError?.('marché', 0, String(err?.message || err)); }
    }
    for (const a of list) {
      if (a.dataset.wmxMk) continue;
      a.dataset.wmxMk = '1';
      io.observe(a);
    }
  }

  WMX.register({
    name: 'market',
    match: /^\/marketplace/,
    init() {
      WMX.onApi(({ path, data }) => { if (/^\/api\/marketplace\/?$/.test(path)) { learnAll(data); schedule(); } });
      io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); onVisible(e.target); }
      }, { rootMargin: '200px' });
      const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 250); };
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('wmx:bids', () => anchors().forEach(paintBid));
      WMX.prices.onProgress(() => anchors().forEach((a) => { if (a.querySelector(':scope > .wmx-mk')) paint(a); }));
      schedule();
    },
  });
  WMX.market = { learnAll, scan };
})();
