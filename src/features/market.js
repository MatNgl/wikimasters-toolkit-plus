// Marché : sous chaque enchère de la liste, la moyenne du marché de la carte (même source que la collection) et un verdict
// « bonne affaire / prix correct / trop cher » comparant la mise (ou le prix de départ) à cette moyenne. Sur MES ventes : pas de
// bouton de mise, et le verdict devient « bénéfice / prix du marché / à perte ».
//
// Les enchères affichées sont reconnues par leur identifiant (lien /marketplace/{id}) grâce aux réponses de /api/marketplace
// déjà demandées par le jeu ; à défaut, une requête identique est faite une fois. La moyenne n'est demandée que pour les
// cartes réellement visibles à l'écran (file prioritaire de prices.js, une requête à la fois).
// Les moyennes bougent vite : une moyenne de plus de 24 h reste affichée mais est relue (enchères qui finissent le plus tôt d'abord),
// et une petite icône dit si elle est à jour (✓), en retard (!) ou en cours d'actualisation (↻) ; au survol : « à jour / non à jour depuis X ».
(() => {
  const { el } = WMX.dom;
  /** Icône de fraîcheur de la moyenne (✓ à jour, ! en retard, ↻ actualisation) ; la ligne d'explication est dans `title`. */
  const freshIcon = (f) => el('i', { class: `wmx-age ${f.state}`, title: f.line, 'aria-label': f.line }, f.icon);
  /** Signature de fraîcheur : change quand l'état change (et une fois par heure pour l'âge affiché au survol). */
  const freshSig = (cardId, f) => `${f.state}|${Math.floor((WMX.prices.age(cardId) ?? -1) / 3600000)}`;
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

  const BID_LABEL = { none: 'Miser', outbid: 'Surenchérir', leading: '✓ En tête', queued: '⏳ En file', betting: 'Mise…' };
  const BID_TITLE = { none: 'Miser le minimum maintenant', outbid: 'Surenchérir du minimum maintenant', leading: 'Vous menez cette enchère', queued: 'Mise en file d’attente', betting: 'Mise en cours' };
  const WATCH_HINT = 'Surveiller : vous ne misez pas maintenant. L’extension miserait au dernier moment, seulement si le prix reste sous votre plafond (réglages dans Paramètres → Mises automatiques).';
  /** Deux boutons côte à côte : « Miser » (le minimum proposé par le jeu, sans ouvrir la page ; page préchargée au survol) et « Surveiller » (mise au dernier moment). */
  function ensureBid(a, info) {
    const id = idOf(a);
    let row = a.querySelector(':scope > .wmx-mk-acts');
    if (!row) {
      const btn = el('button', { class: 'wmx-btn wmx-mk-bid', type: 'button' });
      btn.addEventListener('pointerenter', () => WMX.auctions?.warm(id));
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); // le bouton est dans un lien : pas de navigation
        if (!WMX.auctions) return;
        WMX.auctions.bidById(id, info.title); // mis en file : on peut cliquer sur d'autres cartes sans attendre
        paintBid(a);
      });
      const watch = el('button', { class: 'wmx-btn wmx-btn--ghost wmx-mk-watch', type: 'button' });
      watch.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!WMX.auctions || watch.dataset.busy) return; // clics répétés : une seule demande à la fois
        watch.dataset.busy = '1';
        const p = WMX.auctions.toggleWatch(id, info.title);
        paintBid(a); // la règle est posée avant le premier await : « Surveillée » s'affiche aussitôt
        try { await p; } finally { delete watch.dataset.busy; paintBid(a); }
      });
      row = el('div', { class: 'wmx-mk-acts' }, btn, watch);
      a.append(row);
    }
    paintBid(a);
  }
  function paintBid(a) {
    const btn = a.querySelector(':scope .wmx-mk-bid');
    if (!btn || !WMX.auctions) return;
    const id = idOf(a);
    const st = WMX.auctions.stateOf(id);
    if (btn.dataset.s !== st) { // jamais d'écriture inutile : réécrire un texte identique relance tous les observateurs de la page
      btn.dataset.s = st;
      btn.textContent = BID_LABEL[st];
      btn.title = BID_TITLE[st];
      btn.classList.toggle('ok', st === 'leading');
      btn.disabled = st === 'leading' || st === 'queued' || st === 'betting';
    }
    const watch = a.querySelector(':scope .wmx-mk-watch');
    if (watch) {
      const w = WMX.auctions.watchState(id);
      const sig = w === 'watch' ? `watch|${WMX.auctions.watchInfo(id)}` : w;
      if (watch.dataset.s !== sig) {
        watch.dataset.s = sig;
        watch.textContent = w === 'watch' ? 'Surveillée' : w === 'auto' ? 'Mise auto' : 'Surveiller';
        watch.classList.toggle('on', w === 'watch');
        watch.disabled = w === 'auto';
        watch.title = w === 'watch' ? `Veille active (${WMX.auctions.watchInfo(id)}) : cliquer pour l’arrêter` : w === 'auto' ? 'Une mise automatique est déjà réglée sur cette enchère (voir « Mes enchères »)' : WATCH_HINT;
      }
    }
  }

  // --- Page d'UNE enchère : bouton « Surveiller », au-dessus de la ligne « Miser » du jeu ---------------------------------------------
  function paintDetailWatch() {
    if (!isDetail() || !WMX.auctions) return;
    const id = location.pathname.split('/').filter(Boolean)[1];
    const miser = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Miser' && !b.closest('.wmx-bubble, .wmx-panel, .wmx-modal-backdrop'));
    const mine = document.querySelector('.wmx-dw');
    if (!miser) { mine?.remove(); return; } // enchère terminée ou la mienne : pas de mise, donc pas de veille
    const row = miser.parentElement; // la ligne « champ de mise + Miser »
    let box = mine;
    if (!box || !box.isConnected || box.nextElementSibling !== row) {
      box?.remove();
      const btn = el('button', { class: 'wmx-btn wmx-dw-btn', type: 'button' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const title = byAuction.get(id)?.title || document.querySelector('h1')?.textContent?.trim() || '';
        try { await WMX.auctions.toggleWatch(id, title); } finally { paintDetailWatch(); }
      });
      box = el('div', { class: 'wmx-dw' }, btn, el('p', { class: 'wmx-dw-note' }));
      row.before(box);
    }
    const w = WMX.auctions.watchState(id);
    const btn = box.querySelector('.wmx-dw-btn');
    const dsig = w === 'watch' ? `watch|${WMX.auctions.watchInfo(id)}` : w;
    if (btn.dataset.s === dsig) return; // rien n'a changé : on ne touche pas à la page
    btn.dataset.s = dsig;
    btn.textContent = w === 'watch' ? `Surveillée · ${WMX.auctions.watchInfo(id)} — arrêter` : w === 'auto' ? 'Mise automatique déjà réglée' : 'Surveiller (mise au dernier moment)';
    btn.classList.toggle('on', w === 'watch');
    btn.disabled = w === 'auto';
    box.querySelector('.wmx-dw-note').textContent = w === 'watch'
      ? 'Vous ne misez pas maintenant : l’extension misera au dernier moment, sauf si le prix dépasse votre plafond.'
      : w === 'auto' ? 'Modifiez-la dans la bulle « Mes enchères ».' : 'Rien n’est misé tout de suite : cela évite de faire monter les enchères. Plafond et délai : Paramètres → Mises automatiques.';
  }

  function paint(a) {
    const info = byAuction.get(idOf(a));
    if (!info) return;
    const role = roleOf(idOf(a), info);
    if (role === 'buy') ensureBid(a, info); else a.querySelector(':scope > .wmx-mk-acts')?.remove(); // pas de mise sur mes ventes ni sur une enchère terminée
    let b = a.querySelector(':scope > .wmx-mk');
    if (!b) { b = el('div', { class: 'wmx-mk' }); a.append(b); }
    const p = WMX.prices.get(info.card_id, info.rarity);
    if (!p && !WMX.prices.has(info.card_id)) { if (b.dataset.sig !== 'wait') { b.dataset.sig = 'wait'; b.className = 'wmx-mk wait'; b.textContent = 'Moy. …'; } return; } // jamais chargée : on attend
    const f = WMX.prices.freshness(info.card_id);
    const v = role === 'sale' ? WMX.logic.saleVerdict(info.price, p?.avg, p?.count) : WMX.logic.dealVerdict(info.price, p?.avg, p?.count);
    const vsig = [role, p ? Math.round(p.avg) : 'x', p?.count, p ? Math.round(p.last) : '', v.kind, v.pct, info.price, freshSig(info.card_id, f)].join('|');
    if (b.dataset.sig === vsig) return; // même verdict : pas de réécriture
    b.dataset.sig = vsig;
    b.className = `wmx-mk ${v.kind}`;
    b.replaceChildren(
      el('span', { class: 'wmx-mk-avg' }, p ? `Moy. ${Math.round(p.avg).toLocaleString('fr-FR')} W` : 'Sans vente', freshIcon(f)),
      el('b', {}, v.kind === 'unknown' ? v.label : `${v.pct > 0 ? '+' : ''}${v.pct} % · ${v.label}`));
    b.title = `${f.line}\n` + (role === 'sale' ? 'Votre vente comparée à la moyenne du marché (bénéfice ou vente sous la moyenne). ' : '') + (p ? `Moyenne de ${p.count} vente${p.count > 1 ? 's' : ''} de cette rareté · dernière vente ${Math.round(p.last).toLocaleString('fr-FR')} W${v.low ? ' · peu de ventes : estimation fragile' : ''}` : 'Aucune vente de cette rareté sur le marché');
  }

  /** Une carte devient visible : on récupère sa moyenne si elle manque, puis on affiche le verdict. */
  async function onVisible(a) {
    const info = byAuction.get(idOf(a));
    if (!info) { delete a.dataset.wmxMk; return; } // liste pas encore connue : sera reprise au prochain passage
    paint(a);
    WMX.prices.keepFresh(info.card_id, info.endAt ?? Infinity); // jamais chargée ou de plus de 24 h : relue (repeinte à l'arrivée du prix)
  }

  // --- Page d'UNE enchère (/marketplace/{id}) : moyenne du marché et verdict sous « Mise actuelle » ---------------------------
  const isDetail = () => /^\/marketplace\/[0-9a-f-]{8,}\/?$/i.test(location.pathname);
  let detailAsked = null;
  async function paintDetail() {
    if (!isDetail()) return;
    const id = location.pathname.split('/').filter(Boolean)[1];
    const label = [...document.querySelectorAll('span, div')].find((e) => e.children.length === 0 && !e.closest('.wmx-bubble, .wmx-panel, .wmx-dk, .wmx-overlay, .wmx-modal-backdrop, .wmx-toast, .wmx-qchip') && /^(mise actuelle|prix de départ|mise de départ)$/i.test(e.textContent.trim()));
    const row = label?.parentElement;
    if (!row) return; // page pas encore affichée : repris au prochain passage
    let info = byAuction.get(id);
    if (!info && detailAsked !== id) {
      detailAsked = id; // la réponse du jeu n'a pas été vue : même lecture que lui, une seule fois
      try { const res = await fetch('/api/marketplace/' + id); if (res.ok) learn([(await res.json())?.auction], 'detail'); } catch (err) { WMX.reportError?.('marché', 0, String(err?.message || err)); }
      info = byAuction.get(id);
    }
    if (!info) return;
    const shownPrice = Number((row.textContent.replace(label.textContent, '').match(/[\d\s\u00a0\u202f]+/) || [''])[0].replace(/\D/g, '')); // mise affichée (elle bouge en direct)
    const price = shownPrice > 0 ? shownPrice : info.price;
    const role = roleOf(id, info) === 'sale' ? 'sale' : 'buy';
    const p = WMX.prices.get(info.card_id, info.rarity);
    const waiting = !p && !WMX.prices.has(info.card_id);
    WMX.prices.keepFresh(info.card_id, info.endAt ?? Infinity); // jamais chargée ou de plus de 24 h : relue, l'ancienne reste affichée
    const f = WMX.prices.freshness(info.card_id);
    const n = waiting ? null : WMX.logic.priceNote(role, price, p);
    const sig = waiting ? 'wait' : [n.kind, n.avg, n.verdict, freshSig(info.card_id, f)].join('|');
    let chip = row.parentElement.querySelector(':scope > .wmx-dk');
    if (chip && chip.dataset.sig === sig) return; // rien n'a changé : on ne touche pas à la page (évite de se rappeler soi-même)
    if (!chip) { chip = el('div', { class: 'wmx-dk' }); row.after(chip); }
    chip.dataset.sig = sig;
    if (waiting) { chip.className = 'wmx-dk wait'; chip.title = ''; chip.replaceChildren(el('span', {}, 'Moyenne du marché…')); }
    else { chip.className = 'wmx-dk ' + n.kind; chip.title = `${f.line}\n${n.title}`; chip.replaceChildren(el('span', { class: 'wmx-mk-avg' }, n.avg, freshIcon(f)), el('b', {}, n.verdict)); }
  }

  async function scan() {
    if (isDetail()) { paintDetail(); paintDetailWatch(); return; }
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
      WMX.onApi(({ path, data }) => {
        if (/^\/api\/marketplace\/?$/.test(path)) { learnAll(data); schedule(); }
        else if (/^\/api\/marketplace\/[0-9a-f-]{8,}\/?$/i.test(path) && data?.auction) { learn([data.auction], 'detail'); schedule(); } // page d'une enchère : le jeu la relit en direct
      });
      io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); onVisible(e.target); }
      }, { rootMargin: '200px' });
      const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 250); };
      new MutationObserver((muts) => { if (WMX.dom.foreign(muts)) schedule(); }).observe(document.body, { childList: true, subtree: true }); // seulement ce que fait le jeu, pas nos propres écritures
      // Repeintures regroupées : une rafale d'événements (prix qui arrivent, mises) ne repeint la page qu'une fois.
      const later = (fn, ms) => { let t = null; return () => { if (t) return; t = setTimeout(() => { t = null; try { fn(); } catch (_) { /* page fermée */ } }, ms); }; };
      window.addEventListener('wmx:bids', later(() => { anchors().forEach(paintBid); paintDetailWatch(); }, 200));
      WMX.prices.onProgress(later(() => { anchors().forEach((a) => { if (a.querySelector(':scope > .wmx-mk')) paint(a); }); if (isDetail()) paintDetail(); }, 500));
      schedule();
    },
  });
  WMX.market = { learnAll, scan };
})();
