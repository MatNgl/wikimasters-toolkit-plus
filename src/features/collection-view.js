// Vue étendue de la Collection : la page du jeu reste celle du jeu (mêmes cartes, filtres, sélection, défausse, favoris, étiquettes, fiches),
// mais ses LECTURES de liste sont servies depuis la copie de la collection (inventory.js) au lieu du serveur (relais : page-hook.js) :
//  - 50, 100, 200 ou 500 cartes par page (le serveur du jeu en renvoie toujours 50) ;
//  - un tri de plus dans le menu du jeu : « Moyenne (plus chères) » ;
//  - navigation instantanée (aucune requête par page ou par filtre, sauf les nombres des étiquettes, demandés au jeu).
// La copie reste exacte : nouvelles cartes (paquets, achats, échanges) relues à chaque visite et toutes les minutes (tri « Date d'ajout » du jeu),
// défausses, favoris et étiquettes appliqués dès que la page du jeu les envoie, relecture complète si le nombre de cartes du jeu diffère.
(() => {
  const { el, sleep } = WMX.dom;
  const RANK = { L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0 };
  const SIZES = [50, 100, 200, 500];
  const S = {
    on: false, size: 100, price: false, loaded: false,
    memo: { key: '', ver: -1, list: [] }, tagOptions: [], pending: [],
    syncing: false, syncAt: 0, fullAt: 0, readySent: null, lastReal: null, stale: false,
  };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const isPage = () => /^\/collection\/?$/.test(location.pathname);
  // stale : la copie compte nettement moins (ou plus) de cartes que le jeu ; la page du jeu reprend la main jusqu'à la fin de la relecture complète.
  const ready = () => !!WMX.inventory?.extReady?.() && !S.stale;
  const avg = (it) => WMX.prices?.get?.(it.card_id, it.rarity)?.avg ?? -1;

  // --- Préférences (et leur copie dans localStorage, lue par page-hook.js dès le début du chargement de la page) -----------------------
  async function loadPrefs() {
    const p = await WMX.store.get('collView', {});
    S.on = !!p.on;
    S.size = SIZES.includes(p.size) ? p.size : 100;
    S.price = !!p.price;
    S.loaded = true;
    mirror();
  }
  const savePrefs = () => { WMX.store.set('collView', { on: S.on, size: S.size, price: S.price }); mirror(); };
  function mirror() { try { localStorage.setItem('wmxCollView', S.on ? 'on' : 'off'); } catch (_) { /* stockage de la page indisponible */ } }

  // --- Requête du jeu → liste filtrée et triée depuis la copie ----------------------------------------------------------------------
  function parse(url) {
    const u = new URL(url, location.origin);
    const p = u.searchParams;
    return {
      sort: p.get('sort') || 'rarity', q: norm(p.get('q')), rar: new Set(p.getAll('rarity').map((r) => WMX.normRarity(r) || r)),
      tags: new Set(p.getAll('tag_id')), untagged: ['1', 'true'].includes(p.get('untagged') || ''), page: Math.max(0, Number(p.get('page')) || 0),
      stats: p.get('stats'),
    };
  }
  const match = (f, it, withRarity = true) => (!withRarity || !f.rar.size || f.rar.has(it.rarity))
    && (!f.tags.size || it.tags.some((t) => f.tags.has(t.id)))
    && (!f.untagged || !it.tags.length)
    && (!f.q || norm(it.title).includes(f.q) || norm(it.x?.cat).includes(f.q));
  // Ordres du jeu (relevés sur ses réponses) : rareté puis date d'obtention ; nom ; favoris puis date ; date d'ajout. Plus : moyenne.
  const byAt = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  const SORTS = {
    rarity: (a, b) => RANK[b.rarity] - RANK[a.rarity] || byAt(a, b),
    name: (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }) || byAt(a, b),
    starred: (a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || byAt(a, b),
    added: byAt,
  };
  // --- Tri par moyenne toujours juste -------------------------------------------------------------------------------------------------
  // Une moyenne relue après l'affichage (carte à l'écran, moyenne de plus de 24 h ou d'avant la mise à jour du marché) peut changer beaucoup :
  // la page affichée n'était plus dans l'ordre. Quand les moyennes de la page 1 ne sont plus décroissantes, la page est relancée (nouvel ordre),
  // au plus une fois toutes les 10 s (même si des moyennes arrivent sans arrêt). Les autres pages sont retriées à la navigation.
  let priceVer = 0;
  let orderTimer = null;
  let lastReorder = 0;
  const inOrder = (items) => { let prev = Infinity; for (const it of items) { const a = avg(it); if (a > prev) return false; prev = a; } return true; };
  function watchOrder() {
    priceVer += 1;
    if (orderTimer || !S.on || !S.price || !S.served || S.served.page !== 0 || !isPage()) return;
    // Vérification au plus toutes les 10 s, même si des moyennes arrivent sans arrêt (cartes à l'écran relues une à une).
    orderTimer = setTimeout(() => {
      orderTimer = null;
      if (!S.on || !S.price || !S.served || S.served.page !== 0 || !isPage() || inOrder(S.served.items)) return;
      if (Date.now() - lastReorder < 10000) { watchOrder(); return; }
      lastReorder = Date.now();
      S.memo.key = ''; // nouvel ordre avec les moyennes à jour
      nudge();
    }, 2500);
  }
  WMX.prices?.onProgress?.(watchOrder);

  function list(f, fresh) {
    const key = JSON.stringify([f.sort, f.q, [...f.rar].sort(), [...f.tags].sort(), f.untagged, S.price]);
    const ver = WMX.inventory.version();
    // Même recherche (changement de page) : même ordre, même si des moyennes sont arrivées entre-temps (sinon des cartes sauteraient d'une page à
    // l'autre). L'ordre par moyenne est recalculé à chaque nouvelle recherche (fresh : demande des nombres de la page, au changement de tri ou de filtre).
    // Tri par moyenne : les moyennes arrivent après coup (cartes à l'écran relues) ; l'ordre est recalculé avec les dernières connues dès
    // qu'une a changé (pv), à chaque page ou filtre. Les autres tris gardent leur ordre tant que la copie ne change pas.
    if (!fresh && S.memo.key === key && S.memo.ver === ver && (!S.price || S.memo.pv === priceVer)) return S.memo.list;
    const rows = WMX.inventory.items().filter((it) => match(f, it));
    if (S.price) {
      const v = new Map(rows.map((it) => [it, avg(it)]));
      rows.sort((a, b) => v.get(b) - v.get(a) || RANK[b.rarity] - RANK[a.rarity] || byAt(a, b));
    } else rows.sort(SORTS[f.sort] || SORTS.rarity);
    S.memo = { key, ver, pv: priceVer, list: rows };
    return rows;
  }
  /** Réponse à la page du jeu (chaîne JSON), ou null pour la laisser demander au serveur. */
  function serve(kind, url, real) {
    if (!S.on || !ready()) return null;
    const f = parse(url);
    if (kind === 'stats') {
      // Nombre de cartes du jeu (sans filtre) comparé à la copie AVANT de servir : une copie abîmée n'est jamais montrée.
      if (!f.q && !f.rar.size && !f.tags.size && !f.untagged && Number.isFinite(real?.total)) reconcile(real.total);
      if (!ready()) return null;
      const rows = list(f, true);
      const counts = Object.fromEntries(WMX.RARITIES.map((r) => [r, 0]));
      for (const it of WMX.inventory.items()) if (match(f, it, false)) counts[it.rarity] += 1;
      if (Array.isArray(real?.tagOptions)) { S.tagOptions = real.tagOptions; nameTags(); }
      if (f.tags.size === 1 && Array.isArray(real?.tagOptions)) checkTag([...f.tags][0]);
      // La page du jeu compte ses pages par 50 : le total annoncé donne le bon nombre de pages pour la taille choisie.
      const pages = Math.ceil(rows.length / S.size);
      return JSON.stringify({ ...(real || {}), total: S.size === 50 ? rows.length : pages * 50, rarityCounts: counts });
    }
    if (f.stats === '1') return null; // lecture avec les nombres : laissée au jeu
    const rows = list(f, false);
    const slice = rows.slice(f.page * S.size, (f.page + 1) * S.size);
    S.servedAt = Date.now(); S.lastPage = f.page; // page servie (voir sync : nouvelles cartes arrivées après l'affichage)
    S.served = S.price ? { page: f.page, items: slice } : null; // page affichée, triée par moyenne : surveillée (voir watchOrder)
    const page = slice.map(WMX.inventory.toRow);
    return JSON.stringify({ collection: page, total: null, rarityCounts: {}, tagOptions: [], pendingTradeCardIds: S.pending });
  }

  window.addEventListener('wmx:coll-ask', async (e) => {
    let d = null;
    try { d = JSON.parse(String(e.detail || 'null')); } catch (_) { return; }
    if (!d?.id) return;
    // Nouvelle recherche (nombres de la page demandés) : les nouvelles cartes (paquets, achats, échanges) sont d'abord relues, au plus une fois par
    // minute et sans faire attendre la page plus de 1,5 s, pour qu'une carte tout juste obtenue apparaisse déjà.
    if (d.kind === 'stats' && S.on && ready()) await Promise.race([sync(), sleep(1500)]);
    let body = null;
    try { body = serve(d.kind, d.url, d.real); } catch (err) { console.warn('[WMX] vue étendue', err); body = null; }
    window.dispatchEvent(new CustomEvent('wmx:coll-answer', { detail: JSON.stringify({ id: d.id, body }) }));
  });
  /** Annonce à page-hook.js si la copie peut servir la page (et à chaque changement). */
  function announce(byUser = false) {
    const ok = S.on && ready();
    if (S.readySent === ok) return;
    const was = S.readySent;
    S.readySent = ok;
    window.dispatchEvent(new CustomEvent('wmx:coll-ready', { detail: JSON.stringify({ ok }) }));
    if (ok && was === false && isPage() && !byUser) { window.dispatchEvent(new CustomEvent('wmx:coll-reset')); nudge(); WMX.toast?.('Vue étendue prête : la collection s’affiche depuis la copie.', 5000); }
    paintTools();
  }

  // --- Copie toujours à jour --------------------------------------------------------------------------------------------------------
  /** Nouvelles cartes (paquets, achats, échanges) : le tri « Date d'ajout » du jeu les donne en tête ; on lit jusqu'à retrouver une carte connue. */
  async function sync(force = false) {
    // Aussi pendant une relecture complète (qui peut durer longtemps quand le jeu la freine) : les cartes reçues entre-temps sont gardées à la fin
    // de la relecture (inventory : addedAt). Au plus toutes les 20 s.
    if (S.syncing || !ready() || (!force && Date.now() - S.syncAt < 20000)) return;
    S.syncing = true;
    S.syncAt = Date.now();
    try {
      const known = new Set(WMX.inventory.items().map((it) => it.id));
      const fresh = [];
      for (let p = 0; p < 20; p++) {
        const r = await fetch(`/api/my-collection?sort=added&page=${p}&stats=0`);
        if (!r.ok) break;
        const j = await r.json();
        if (p === 0 && Array.isArray(j.pendingTradeCardIds)) S.pending = j.pendingTradeCardIds; // cartes engagées dans un échange en cours
        const rows = j.collection || [];
        const news = rows.filter((x) => x?.id && !known.has(x.id));
        fresh.push(...news);
        if (!rows.length || news.length < rows.length) break;
        await sleep(400);
      }
      if (fresh.length) {
        const n = WMX.inventory.upsertRows(fresh);
        if (n) WMX.journal?.add('Collection', `vue étendue : ${n} nouvelle${n > 1 ? 's' : ''} carte${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à la copie`);
        // Page 1 affichée AVANT l'arrivée de ces cartes (lecture de la minute, ou trop lente pour la page) : relancée pour les montrer ; les
        // autres pages les verront à la navigation.
        if (n) { const t = Date.now(); setTimeout(() => { if (S.on && (S.servedAt || 0) < t && S.lastPage === 0 && isPage()) { S.memo.key = ''; nudge(); } }, 1600); }
      }
      if (S.lastReal != null) reconcile(S.lastReal);
    } catch (_) { /* jeu injoignable : nouvel essai à la prochaine visite */ } finally { S.syncing = false; }
  }
  /** Nombre de cartes annoncé par le jeu ≠ copie (cartes parties ailleurs : vendues, échangées…) : relecture complète, au plus toutes les 30 min. */
  function reconcile(realTotal) {
    S.lastReal = realTotal;
    if (S.syncing) return; // les nouvelles cartes sont peut-être en cours de lecture : on compare après
    const mine = WMX.inventory.items().length;
    // Grand écart (copie abîmée, ou très en retard) : la vue rend la main à la page du jeu le temps de tout relire.
    if (Math.abs(mine - realTotal) > Math.max(50, realTotal * 0.02) && !S.stale) {
      S.stale = true;
      WMX.journal?.add('Collection', `vue étendue suspendue : la copie compte ${mine} cartes, le jeu ${realTotal} ; reprise après la relecture complète`, 'warn');
      window.dispatchEvent(new CustomEvent('wmx:coll-reset'));
      announce();
    }
    // Petit écart (1 à 3 cartes : vente, achat en cours de lecture…) : les lectures légères (nouvelles cartes, cartes en vente) s'en chargent ;
    // une relecture complète (plusieurs minutes, freinée par le jeu) seulement au-delà, au plus toutes les 30 min.
    if (Math.abs(mine - realTotal) <= 3 || WMX.inventory.isLoading() || Date.now() - S.fullAt < 30 * 60000) return;
    S.fullAt = Date.now();
    WMX.journal?.add('Collection', `vue étendue : la copie compte ${mine} cartes, le jeu ${realTotal} : relecture complète en arrière-plan`);
    WMX.inventory.reload();
  }

  /**
   * Vue d'une étiquette : la copie compte-t-elle autant de cartes que le jeu (« #TEST (2) ») ? Sinon (étiquette posée pendant une relecture
   * complète, qui l'a écrasée ; posée dans un autre onglet…), les cartes de cette étiquette sont relues auprès du jeu, puis la page relancée.
   */
  const tagSynced = new Map(); // id d'étiquette -> heure de la dernière relecture
  function checkTag(id) {
    const opt = S.tagOptions.find((o) => o.id === id);
    if (!opt || !Number.isFinite(opt.cardCount) || Date.now() - (tagSynced.get(id) || 0) < 60000) return;
    const mine = WMX.inventory.items().filter((it) => it.tags.some((t) => t.id === id)).length;
    if (mine === opt.cardCount) return;
    tagSynced.set(id, Date.now());
    WMX.journal?.add('Collection', `vue étendue : étiquette « ${opt.name} » : ${mine} carte(s) dans la copie, ${opt.cardCount} pour le jeu : relue`);
    WMX.inventory.refreshTagged?.([opt.name], new Map([[String(opt.name).trim().toLowerCase(), id]])).then((ok) => { if (ok && isPage()) { S.memo.key = ''; nudge(); } }).catch(() => {});
  }

  /** Étiquettes posées sans nom connu (« … », étiquette pas encore dans la liste du jeu) : nommées dès que le jeu donne sa liste d'étiquettes. */
  const unnamed = new Set();
  let scanned = false;
  function nameTags() {
    if (!scanned) { scanned = true; for (const it of WMX.inventory.items()) for (const t of it.tags) if (t.name === '…') unnamed.add(t.id); } // anciennes étiquettes sans nom
    if (!unnamed.size) return;
    const byId = new Map(S.tagOptions.map((o) => [o.id, o]));
    const ids = [...unnamed].filter((id) => byId.has(id));
    if (!ids.length) return;
    ids.forEach((id) => unnamed.delete(id));
    const want = new Set(ids);
    const rows = WMX.inventory.items().filter((it) => it.tags.some((t) => want.has(t.id))).map((it) => it.id);
    WMX.inventory.patch(rows, (it) => { it.tags = it.tags.map((t) => { const o = want.has(t.id) && byId.get(t.id); return o ? { id: o.id, name: o.name, color: o.color, user_id: o.user_id, created_at: o.created_at } : t; }); });
  }

  // Écritures de la page du jeu : appliquées à la copie dès leur succès (la page relit ensuite sa liste, servie à jour).
  const okStatus = (s) => s >= 200 && s < 300;
  const idsOf = (v) => { const m = String(v || '').match(/^(?:eq\.(.+)|in\.\((.*)\))$/); return m ? (m[1] != null ? [m[1]] : m[2].split(',')).map((x) => x.replace(/^"|"$/g, '').trim()).filter(Boolean) : []; };
  function discarded(ids) {
    const items = WMX.inventory.items();
    const rowIds = new Set(items.map((it) => it.id));
    const asRows = ids.filter((id) => rowIds.has(id));
    if (asRows.length) { WMX.inventory.removeIds(asRows, { discarded: true }); return; }
    // Identifiants de carte (et non de ligne) : sans ambiguïté seulement si la carte n'est qu'une fois dans la collection ; sinon relecture.
    const rows = items.filter((it) => ids.includes(it.card_id));
    const dup = rows.length !== new Set(rows.map((it) => it.card_id)).size;
    if (dup) { S.fullAt = 0; WMX.inventory.reload(); } else WMX.inventory.removeIds(rows.map((it) => it.id), { discarded: true });
  }
  /**
   * Cartes en vente (réponse de /api/marketplace?mine=1, lue par le jeu ou l'extension) : le jeu les retire de la collection le temps de l'enchère.
   * Retirées de la copie quand c'est sans ambiguïté : autant (ou plus) d'enchères en cours que d'exemplaires de la carte dans la copie, chacun
   * obtenu avant la mise en vente. Sinon (un autre exemplaire gardé) la copie est laissée : la relecture complète tranchera.
   */
  function listed(selling) {
    const active = (selling || []).filter((a) => a?.card_id && a.status === 'active' && !a.settled_at);
    if (!active.length || !ready()) return;
    const byCard = new Map();
    for (const a of active) { const k = `${a.card_id}|${WMX.normRarity(a.snapshot_rarity) || ''}`; const o = byCard.get(k) || { n: 0, at: '' }; o.n += 1; if (!o.at || a.created_at < o.at) o.at = a.created_at || ''; byCard.set(k, o); }
    const gone = [];
    const items = WMX.inventory.items();
    for (const [k, o] of byCard) {
      const [cid, rar] = k.split('|');
      const rows = items.filter((it) => it.card_id === cid && (!rar || it.rarity === rar));
      const copies = rows.reduce((n, it) => n + (it.count || 1), 0);
      if (rows.length && copies <= o.n && rows.every((it) => !it.at || !o.at || it.at <= o.at)) gone.push(...rows.map((it) => it.id));
    }
    const n = WMX.inventory.removeIds(gone);
    if (n) WMX.journal?.add('Collection', `vue étendue : ${n} carte${n > 1 ? 's' : ''} en vente retirée${n > 1 ? 's' : ''} de la copie`);
  }
  WMX.onApi?.(({ url, path, method, status, data, req }) => {
    if (path === '/api/marketplace' && method === 'GET' && okStatus(status) && Array.isArray(data?.selling)) { try { listed(data.selling); } catch (_) { /* réponse inattendue */ } return; }
    if (!okStatus(status) || method === 'GET') return;
    try {
      if (path === '/api/user-cards/bulk-discard' && Array.isArray(req?.card_ids)) discarded(req.card_ids);
      else if (/^\/api\/user-cards\/[^/]+\/discard$/.test(path)) discarded([path.split('/')[3]]);
      else if (/\/rest\/v1\/user_cards$/.test(path) && method === 'PATCH' && req && 'starred' in req) {
        const ids = idsOf(new URL(url).searchParams.get('id'));
        WMX.inventory.patch(ids, (it) => { it.starred = !!req.starred; });
      } else if (/\/rest\/v1\/user_card_tags$/.test(path) && method === 'POST') {
        for (const x of [].concat(req || [])) {
          if (!x?.user_card_id || !x.tag_id) continue;
          const t = S.tagOptions.find((o) => o.id === x.tag_id) || WMX.inventory.items().flatMap((it) => it.tags).find((o) => o.id === x.tag_id && o.name !== '…') || { id: x.tag_id, name: '…', color: null };
          if (t.name === '…') unnamed.add(x.tag_id); // nommée à la prochaine lecture des nombres du jeu (nameTags)
          WMX.inventory.patch([x.user_card_id], (it) => { if (!it.tags.some((o) => o.id === x.tag_id)) it.tags = [...it.tags, { id: t.id, name: t.name, color: t.color, user_id: t.user_id, created_at: t.created_at }]; });
        }
      } else if (/\/rest\/v1\/user_card_tags$/.test(path) && method === 'DELETE') {
        const p = new URL(url).searchParams;
        const ids = idsOf(p.get('user_card_id'));
        const tagIds = new Set(idsOf(p.get('tag_id')));
        WMX.inventory.patch(ids, (it) => { it.tags = tagIds.size ? it.tags.filter((o) => !tagIds.has(o.id)) : []; });
      } else if (/\/rest\/v1\/rpc\/delete_tag$/.test(path)) {
        const id = Object.values(req || {}).find((v) => typeof v === 'string');
        if (id) WMX.inventory.patch(WMX.inventory.items().filter((it) => it.tags.some((o) => o.id === id)).map((it) => it.id), (it) => { it.tags = it.tags.filter((o) => o.id !== id); });
      } else if (/\/rest\/v1\/tags$/.test(path) && method === 'PATCH' && req) { // étiquette renommée ou recolorée
        const id = idsOf(new URL(url).searchParams.get('id'))[0];
        if (id) WMX.inventory.patch(WMX.inventory.items().filter((it) => it.tags.some((o) => o.id === id)).map((it) => it.id), (it) => { it.tags = it.tags.map((o) => (o.id === id ? { ...o, ...('name' in req ? { name: req.name } : {}), ...('color' in req ? { color: req.color } : {}) } : o)); });
      }
    } catch (err) { console.warn('[WMX] vue étendue : écriture du jeu', err); }
  });

  // Cartes refusées par le jeu à l'étiquetage (page-hook.js) : elles ne sont plus dans la collection (mises en vente, vendues…). Retirées de la
  // copie, sauf celles engagées dans un échange en cours (toujours à vous).
  window.addEventListener('wmx:coll-gone', (e) => {
    let ids = [];
    try { ids = JSON.parse(String(e.detail || '{}')).ids || []; } catch (_) { return; }
    const trade = new Set(S.pending);
    const rows = WMX.inventory.items().filter((it) => ids.includes(it.id) && !trade.has(it.card_id)).map((it) => it.id);
    const n = WMX.inventory.removeIds(rows);
    if (n) WMX.journal?.add('Collection', `étiquette : ${n} carte${n > 1 ? 's' : ''} ignorée${n > 1 ? 's' : ''} (plus dans la collection : en vente ou vendue${n > 1 ? 's' : ''}), retirée${n > 1 ? 's' : ''} de la vue étendue`);
  });

  // --- Relance de la liste de la page du jeu (après un changement de taille, de tri par moyenne ou de mode) -------------------------
  // Un filtre de rareté coché puis décoché : la page du jeu relit ses nombres et sa liste (servis depuis la copie : instantané) et revient
  // sur la première page, sans rien changer d'autre. Sans pastille de rareté : rechargement de la page.
  async function nudge() {
    if (!isPage()) return;
    const chip = [...document.querySelectorAll('main button')].find((b) => /^(L|UR|SR|R|PC|C)$/.test(b.textContent.trim()) && !b.closest('h3, [class*="rounded-2xl"][class*="cursor-pointer"]') && b.getBoundingClientRect().top < 420);
    if (!chip) { location.reload(); return; }
    chip.click();
    await sleep(250);
    chip.click();
  }

  // --- Contrôles dans la barre du jeu -------------------------------------------------------------------------------------------------
  const sortBtn = () => document.querySelector('button[aria-label="Trier la collection"]');
  let tools = null;
  let sizeMenu = null;
  function setOn(v) {
    S.on = v;
    savePrefs();
    if (v && !ready()) { WMX.inventory.ensure(); WMX.inventory.upgrade(); }
    window.dispatchEvent(new CustomEvent('wmx:coll-reset')); // page-hook.js redécide (copie ou serveur) à la prochaine lecture
    announce(true);
    paintTools();
    nudge();
  }
  function paintTools() {
    if (!tools) return;
    const [toggle, size] = tools.children;
    toggle.setAttribute('aria-pressed', String(S.on));
    toggle.classList.toggle('wmx-cv-on', S.on);
    const loading = S.on && !ready();
    // Première activation : toute la collection est relue (quelques minutes) ; l'avancement s'affiche sur le bouton.
    const read = WMX.inventory.loaded?.() || 0;
    const of = S.lastReal || WMX.inventory.items().length || 0;
    const pct = loading && of ? Math.min(99, Math.floor((read / of) * 100)) : null;
    toggle.querySelector('.wmx-cv-label').textContent = loading ? (pct != null && read ? `Vue étendue… ${pct} %` : 'Vue étendue…') : 'Vue étendue';
    toggle.title = S.on
      ? (loading ? `Lecture de toute la collection pour la vue étendue (${(WMX.inventory.loaded?.() || 0).toLocaleString('fr-FR')} cartes lues, une seule fois) : la page reste celle du jeu en attendant.` : 'Vue étendue activée : collection affichée depuis la copie de l’extension (pages de 50 à 500 cartes, tri par moyenne). Cliquer pour revenir à la page du jeu.')
      : 'Activer la vue étendue : pages de 50 à 500 cartes, tri par moyenne, navigation instantanée (même page, mêmes fonctions).';
    size.hidden = !S.on;
    size.querySelector('.wmx-cv-label').textContent = `${S.size} / page`;
    paintSortLabel();
  }
  function ensureTools() {
    if (!isPage()) return;
    const sb = sortBtn();
    const bar = sb?.parentElement?.parentElement; // rangée des menus (étiquettes, tri) à côté de la recherche
    if (!bar) return;
    if (tools?.isConnected && tools.parentElement === bar) { paintSortLabel(); return; }
    tools?.remove();
    const tpl = sb.className; // même apparence que les menus du jeu
    const mk = (label, cls) => el('button', { type: 'button', class: `${tpl} wmx-cv-btn ${cls}` }, el('span', { class: 'wmx-cv-label' }, label));
    const toggle = mk('Vue étendue', 'wmx-cv-toggle');
    toggle.prepend(WMX.dom.logo(18)); // icône de l'extension ; activée : contour vert (comme un bouton enfoncé), sinon comme les menus du jeu
    toggle.addEventListener('click', () => setOn(!S.on));
    const size = mk(`${S.size} / page`, 'wmx-cv-size');
    size.setAttribute('aria-haspopup', 'listbox');
    size.title = 'Nombre de cartes par page';
    size.addEventListener('click', (e) => { e.stopPropagation(); openSize(size); });
    tools = el('div', { class: 'wmx-cv-tools' }, toggle, size);
    bar.prepend(tools);
    paintTools();
  }
  function openSize(anchor) {
    closeSize();
    const r = anchor.getBoundingClientRect();
    sizeMenu = el('div', { class: 'wmx-cv-menu', role: 'listbox', style: `left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px;min-width:${Math.round(r.width)}px` },
      ...SIZES.map((n) => {
        const b = el('button', { type: 'button', role: 'option', 'aria-selected': String(n === S.size), class: n === S.size ? 'on' : '' }, `${n} cartes`);
        b.addEventListener('click', () => { closeSize(); if (n !== S.size) { S.size = n; savePrefs(); paintTools(); nudge(); } });
        return b;
      }));
    document.body.append(sizeMenu);
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  const outside = (e) => { if (sizeMenu && !sizeMenu.contains(e.target)) closeSize(); };
  function closeSize() { sizeMenu?.remove(); sizeMenu = null; document.removeEventListener('mousedown', outside, true); }

  // Tri « Moyenne » ajouté au menu du jeu (Rareté, Nom, Favoris, Date d'ajout), seulement en vue étendue.
  const PRICE_LABEL = 'Moyenne (plus chères)';
  function paintSortLabel() {
    const span = sortBtn()?.querySelector('span');
    if (!span) return;
    const want = S.on && S.price && ready() ? 'Moyenne' : null;
    if (want && span.textContent !== want) { span.dataset.wmxNative = span.textContent; span.textContent = want; }
    if (!want && span.dataset.wmxNative) { span.textContent = span.dataset.wmxNative; delete span.dataset.wmxNative; }
  }
  function patchSortMenu() {
    if (!S.on || !ready()) return;
    const opts = [...document.querySelectorAll('button[role="option"]')].filter((b) => /^(Rareté|Nom|Favoris|Date d.ajout)$/.test(b.textContent.trim()));
    if (opts.length < 3) return;
    const list = opts[0].closest('li')?.parentElement;
    if (!list || list.querySelector('.wmx-cv-price')) return;
    const selCls = opts.find((b) => b.getAttribute('aria-selected') === 'true')?.className;
    const offCls = opts.find((b) => b.getAttribute('aria-selected') !== 'true')?.className || opts[0].className;
    if (S.price && selCls) for (const b of opts) if (b.getAttribute('aria-selected') === 'true') { b.className = offCls; b.setAttribute('aria-selected', 'false'); }
    const mine = el('button', { type: 'button', role: 'option', 'aria-selected': String(S.price), class: `${S.price && selCls ? selCls : offCls} wmx-cv-price`, title: 'Les cartes les plus chères d’abord (moyenne du marché chargée ; les cartes sans moyenne à la fin)' }, el('span', {}, PRICE_LABEL));
    mine.addEventListener('click', () => {
      S.price = true; savePrefs();
      // Referme le menu du jeu comme un clic à côté (Échap en plus).
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      paintSortLabel();
      nudge();
    });
    // Un tri du jeu choisi : fin du tri par moyenne (et relance si c'était déjà le tri du jeu, que la page ne relirait pas d'elle-même).
    for (const b of opts) b.addEventListener('click', () => { if (!S.price) return; S.price = false; savePrefs(); setTimeout(() => { paintSortLabel(); nudge(); }, 300); }, { once: true });
    list.append(el('li', { role: 'none' }, mine));
  }

  let obs = null;
  function watch() {
    if (obs) return;
    let t = null;
    obs = new MutationObserver(() => { if (t) return; t = setTimeout(() => { t = null; if (!WMX.alive()) return; ensureTools(); patchSortMenu(); paintSortLabel(); }, 60); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  WMX.collView = { serve, parse, sync, listed, ready, /* copie prête : la vue étendue peut servir la page */ state: () => ({ ...S, memo: undefined }), setOn, setSize: (n, reload = false) => { if (!SIZES.includes(n)) return; S.size = n; savePrefs(); paintTools(); if (reload) nudge(); }, /* reload : la page du jeu relit sa liste */ setPrice: (v) => { S.price = !!v; savePrefs(); } };

  WMX.register({
    name: 'collection-view',
    async init() {
      await loadPrefs();
      if (S.on) { await WMX.inventory.ensure(); if (!ready()) WMX.inventory.upgrade(); }
      WMX.inventory.onChange(() => {
        // Relecture complète terminée après une suspension : la vue reprend.
        if (S.stale && WMX.inventory.extReady() && !WMX.inventory.isLoading() && (S.lastReal == null || Math.abs(WMX.inventory.items().length - S.lastReal) <= Math.max(50, S.lastReal * 0.02))) S.stale = false;
        announce(); paintTools();
      });
      announce();
      watch();
      ensureTools();
      setInterval(() => { if (WMX.alive() && S.on && isPage() && !document.hidden) sync(); }, 60000);
      setInterval(() => { if (WMX.alive() && S.on && !ready() && tools?.isConnected) paintTools(); }, 2000); // avancement de la première lecture
    },
  });
})();
