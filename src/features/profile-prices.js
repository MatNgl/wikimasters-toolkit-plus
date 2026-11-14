// Collection des autres joueurs (page /profile/{pseudo}, onglets « Vitrine » et « Collection ») et page « Toutes les cartes » (/global-collection) :
// la moyenne du marché sur chaque carte, comme dans ma collection (« Moy. X W » + icône de fraîcheur), et au-dessus de la grille la valeur des cartes
// affichées. Les cartes sont reconnues grâce aux réponses que le jeu demande lui-même : GET /api/profile/{pseudo}/collection et /showcase (card_id,
// titre, rareté, exemplaires, « owned_by_viewer ») ; GET /api/cards (« Toutes les cartes » : id, titre, rareté, et la liste ownedCardIds).
// Les moyennes viennent de la même source que la collection ; seules les cartes à l'écran sont demandées (relues au-delà de 24 h, comme sur le Marché).
(() => {
  const { el } = WMX.dom;
  const known = new Map(); // « titre|rareté » -> { card_id, rarity, count, mine }
  let io = null;
  let timer = null;
  let order = 0;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const keyOf = (title, rarity) => `${norm(title).toLowerCase()}|${rarity}`;
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const isPage = () => /^\/(profile\/[^/]+|global-collection)\/?$/.test(location.pathname);
  const isProfile = () => /^\/profile\//.test(location.pathname);
  let owned = new Set(); // « Toutes les cartes » : cartes que j'ai (liste donnée par le jeu)

  /** Lignes de carte d'une réponse du jeu (collection ou vitrine) : tout objet portant card_id et card.wikipedia_title. */
  function learn(data, depth = 0) {
    if (!data || depth > 4) return;
    if (Array.isArray(data)) { for (const x of data) learn(x, depth + 1); return; }
    if (typeof data !== 'object') return;
    const card = data.card;
    const id = data.card_id || card?.id;
    if (id && card?.wikipedia_title) {
      const rarity = WMX.normRarity(data.snapshot_rarity || card.rarity) || 'C';
      known.set(keyOf(card.wikipedia_title, rarity), { card_id: id, rarity, count: Number(data.count) || 1, mine: data.owned_by_viewer === true || !!WMX.inventory?.find?.(card.wikipedia_title, rarity) });
      return;
    }
    if (!card && data.id && data.wikipedia_title && data.rarity) { // carte seule (« Toutes les cartes »)
      const rarity = WMX.normRarity(data.rarity) || 'C';
      known.set(keyOf(data.wikipedia_title, rarity), { card_id: data.id, rarity, count: 1, mine: owned.has(data.id) || !!WMX.inventory?.find?.(data.wikipedia_title, rarity), global: true });
      return;
    }
    for (const v of Object.values(data)) if (v && typeof v === 'object') learn(v, depth + 1);
  }

  const cards = () => [...document.querySelectorAll('main h3')].map((h3) => h3.closest('[class*="rounded-2xl"]')).filter((c) => c && c.querySelector('div.absolute.top-2.left-2'));
  function infoOf(card) {
    const title = norm(card.querySelector('h3')?.textContent);
    const rarity = WMX.normRarity(norm(card.querySelector('div.absolute.top-2.left-2')?.textContent)) || '';
    return title && rarity ? known.get(keyOf(title, rarity)) || null : null;
  }

  /** Pastille « Moy. X W » sur une carte (mêmes règles d'affichage que la collection), avec la fraîcheur et « vous l'avez » au survol. */
  function paint(card) {
    const info = infoOf(card);
    let chip = card.querySelector(':scope > .wmx-nt-price');
    if (!info) { chip?.remove(); return; }
    if (!chip) { chip = el('span', { class: 'wmx-nt-price wmx-pp-price' }); card.append(chip); }
    const p = WMX.prices.get(info.card_id, info.rarity);
    const f = WMX.prices.freshness?.(info.card_id);
    const text = p ? `Moy. ${fmt(p.avg)} W` : WMX.prices.has(info.card_id) ? 'Sans vente' : 'Moy. …';
    const title = [f?.line, info.mine ? 'Vous avez aussi cette carte' : 'Vous n’avez pas cette carte', isProfile() && info.count > 1 ? `${info.count} exemplaires chez ce joueur` : ''].filter(Boolean).join('\n');
    const sig = `${text}|${f?.state || ''}|${info.mine}`;
    if (chip.dataset.sig === sig) return; // rien n'a changé : pas de réécriture
    chip.dataset.sig = sig;
    chip.dataset.state = f?.state || '';
    chip.replaceChildren(text, ...(WMX.prices.has(info.card_id) ? [' ', WMX.prices.icon(info.card_id)] : []));
    chip.title = title;
    chip.classList.toggle('wmx-pp-mine', info.mine);
  }

  /** Ligne au-dessus de la grille : valeur des cartes affichées (exemplaires compris) et nombre de prix encore attendus. */
  function paintBar() {
    const list = cards();
    const grid = list[0]?.closest('[class*="flex-wrap"]') || list[0]?.parentElement?.parentElement;
    let bar = document.querySelector('.wmx-pp-bar');
    if (!list.length || !grid) { bar?.remove(); return; }
    let sum = 0; let priced = 0; let n = 0; let mine = 0;
    for (const c of list) {
      const info = infoOf(c);
      if (!info) continue;
      n += 1;
      if (info.mine) mine += 1;
      const p = WMX.prices.get(info.card_id, info.rarity);
      if (p) { sum += p.avg * info.count; priced += 1; } else if (WMX.prices.has(info.card_id)) priced += 1;
    }
    if (!n) { bar?.remove(); return; }
    if (!bar || bar.nextElementSibling !== grid) { bar?.remove(); bar = el('div', { class: 'wmx-pp-bar', role: 'status' }); grid.before(bar); }
    const text = `Valeur des cartes affichées : ${priced < n ? '≈ ' : ''}${fmt(sum)} W · ${n} carte${n > 1 ? 's' : ''}${priced < n ? ` · ${n - priced} prix en cours de chargement` : ''}${mine ? ` · ${mine} que vous avez aussi` : ''}`;
    if (bar.textContent !== text) bar.textContent = text;
  }

  // « Toutes les cartes » chargée directement : le jeu livre sa première page déjà rendue par son serveur, sans requête à lire. Si des cartes sont
  // à l'écran sans être reconnues, on fait UNE fois la même lecture que lui (première page, tri par rareté), comme le Marché le fait déjà.
  let selfAsked = false;
  async function readFirstPage() {
    if (selfAsked) return;
    selfAsked = true;
    try { const res = await fetch('/api/cards?page=0&sort=rarity'); if (res.ok) { const j = await res.json(); if (Array.isArray(j?.ownedCardIds)) owned = new Set(j.ownedCardIds); learn(j?.cards || []); schedule(); } } catch (_) { /* jeu injoignable : les pages suivantes seront lues au passage */ }
  }

  function scan() {
    if (!isPage()) { document.querySelector('.wmx-pp-bar')?.remove(); return; }
    if (/^\/global-collection/.test(location.pathname) && cards().length && !cards().some((c) => infoOf(c))) readFirstPage();
    for (const c of cards()) {
      paint(c);
      if (!c.dataset.wmxPp && infoOf(c)) { c.dataset.wmxPp = '1'; io.observe(c); }
    }
    paintBar();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 200); };

  WMX.register({
    name: 'profile-prices', // profils des autres joueurs et « Toutes les cartes »
    match: /^\/(profile|global-collection)/,
    init() {
      WMX.onApi(({ path, data }) => {
        if (!/^\/api\/profile\/[^/]+\/(collection|showcase)\/?$/.test(path) && !/^\/api\/cards\/?$/.test(path)) return;
        if (Array.isArray(data?.ownedCardIds)) owned = new Set(data.ownedCardIds);
        learn(data?.cards || data);
        document.querySelectorAll('main [data-wmx-pp]').forEach((c) => { delete c.dataset.wmxPp; }); // nouvelle page de cartes : elles seront reprises
        schedule();
      });
      // Carte à l'écran : sa moyenne est demandée (jamais chargée, ou de plus de 24 h), dans l'ordre de la page, devant les chargements en arrière-plan.
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          const info = infoOf(e.target);
          if (info) WMX.prices.keepFresh(info.card_id, order++, { front: true });
        }
      }, { rootMargin: '200px' });
      new MutationObserver((muts) => { if (WMX.dom.foreign(muts)) schedule(); }).observe(document.body, { childList: true, subtree: true });
      let t = null;
      WMX.prices.onProgress(() => { if (t || !isPage()) return; t = setTimeout(() => { t = null; scan(); }, 500); });
      schedule();
    },
  });
  WMX.profilePrices = { learn, scan, known };
})();
