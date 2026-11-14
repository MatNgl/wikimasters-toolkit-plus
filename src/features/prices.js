// Prix par carte : moyenne du marché lue via l'appel « résumé » du jeu
// (GET /api/marketplace/cards/{id}/sales?scope=summary, le même que le formulaire « Mettre aux enchères »,
// sans compte Pro). Réponse : { summary: { RARETÉ: { average, count, latest } } } — un prix par rareté.
//
// Toutes les requêtes passent par UN ordonnanceur : une seule à la fois, espacées, avec une pause qui s'allonge à chaque
// refus du jeu (429 ou 403 par rafales) puis repart de zéro. Ordre de service :
//  1. les cartes de la PAGE AFFICHÉE (Marché, échange, collection, profil, « Toutes les cartes », clic ⚡), dans l'ordre de l'écran ;
//  2. les besoins de fond (bulle des enchères, plafond des mises automatiques, assistant, cartes tirées) ;
//  3. les cartes d'une page qu'on a quittée (encore utiles, mais plus à l'écran) ;
//  4. le chargement par lots demandé depuis la collection.
// Une moyenne de plus de 24 h est relue, sur toutes les pages (l'ancienne reste affichée en attendant).
(() => {
  const { sleep } = WMX.dom;
  const L = WMX.logic;          // validité 24 h (voir L.priceTtl), pauses et écarts : voir lib/logic.js
  const BASE_GAP = 600;         // écart de base entre deux requêtes ; il grandit après un refus du jeu et se resserre très lentement
  let gap = BASE_GAP;
  let lastStatus = 0;           // dernier code d'échec (pour le message d'erreur)
  let cache = null;             // card_id -> { t, s: { RARETÉ: { average, count, latest } } }
  let saveTimer = null;
  const listeners = new Set();
  const job = { running: false, paused: false, done: 0, total: 0, failed: 0, token: 0 };
  const sched = { hi: [], lo: [], slots: [false, false, false, false], blocks: 0, penaltyUntil: 0, pending: new Map() };
  const EXTRA_AT = [0, 1500, 4000, 8000]; // un ouvrier de plus à chaque palier de lenteur du jeu (latence moyenne en ms)
  const TIMEOUT = 30000;        // une requête sans réponse au bout de 30 s est coupée puis réessayée
  let lat = 0;                  // latence moyenne des réponses (ms) : quand le jeu est lent, un second ouvrier travaille en parallèle
  let ticker = null;
  const fresh = { want: new Map(), asked: new Map(), timer: null }; // actualisation des moyennes du marché (keepFresh)

  const slow = () => lat; // latence moyenne observée (ms), exposée pour l'affichage
  const waitLeft = () => Math.max(0, Math.ceil((sched.penaltyUntil - Date.now()) / 1000));
  const snapshot = () => ({ running: job.running, paused: job.paused, done: job.done, total: job.total, wait: waitLeft(), failed: job.failed });
  const emit = () => listeners.forEach((cb) => { try { cb(snapshot()); } catch (_) { /* écouteur obsolète */ } });
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => WMX.store.set('priceCache', cache), 1500);
  };
  /** Pendant une pause imposée par le jeu, on prévient l'affichage chaque seconde. */
  function ensureTicker() {
    if (ticker) return;
    ticker = setInterval(() => {
      emit();
      if (!waitLeft()) { clearInterval(ticker); ticker = null; }
    }, 1000);
  }

  async function load() {
    if (!cache) cache = await WMX.store.get('priceCache', {});
    return cache;
  }

  async function fetchSummary(cardId) {
    const u = new URL(`/api/marketplace/cards/${cardId}/sales`, location.origin);
    u.searchParams.set('scope', 'summary');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT); // sans cela, une requête restée suspendue bloquerait un ouvrier indéfiniment
    try {
      const res = await fetch(u, { signal: ctl.signal });
      // Le jeu freine par rafales : 429, mais aussi 403 sur ce point d'accès. On attend puis on réessaie.
      if (res.status === 429 || res.status === 403) {
        // Qui refuse (le jeu ou un pare-feu devant lui) et pourquoi : serveur, message — gardé pour le journal.
        let who = '';
        try {
          const body = (await res.clone().text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
          who = [res.headers.get('server') && `serveur ${res.headers.get('server')}`, res.headers.get('cf-mitigated') && `cf-mitigated ${res.headers.get('cf-mitigated')}`, body && `« ${body} »`].filter(Boolean).join(' · ');
        } catch (_) { /* corps illisible */ }
        return { limited: true, status: res.status, retryAfter: Number(res.headers.get('retry-after')) || 0, who };
      }
      if (!res.ok) return { error: res.status };
      const j = await res.json();
      return { summary: j.summary || {} };
    } finally { clearTimeout(timer); }
  }

  const queued = () => sched.hi.length || sched.lo.length;
  /** Prochaine carte à servir (ordre ci-dessus) : la page affichée d'abord, puis le fond, puis les pages quittées, puis les lots. */
  function take() {
    const here = location.pathname;
    let i = sched.hi.findIndex((x) => x.front && x.page === here);
    if (i < 0) i = sched.hi.findIndex((x) => !x.front);
    if (i < 0 && sched.hi.length) i = 0;
    return i >= 0 ? sched.hi.splice(i, 1)[0] : sched.lo.shift();
  }
  /** Un ouvrier traite la file ; les suivants (idx 1 à 3) n'interviennent que si le jeu est lent (paliers EXTRA_AT) et qu'aucun refus n'est en cours. */
  async function worker(idx) {
    await load();
    while (queued() && WMX.alive()) {
      if (idx > 0 && (lat < EXTRA_AT[idx] || sched.blocks > 0 || waitLeft() > 0)) { await sleep(500); continue; }
      const item = take();
      if (!item) continue;
      const left = Math.max(sched.penaltyUntil, WMX.gameBlockedUntil || 0) - Date.now(); // le jeu refuse aussi les mises en vente : on ne l'interroge plus
      if (left > 0) await sleep(left);
      let r;
      const t0 = Date.now();
      try { r = await fetchSummary(item.cardId); } catch (_) { r = { error: 0 }; }
      lat = lat ? Math.round(lat * 0.7 + (Date.now() - t0) * 0.3) : Date.now() - t0;
      if (r.limited) {
        sched.blocks += 1;
        if (sched.blocks === 1) WMX.journal?.add('Prix', `le jeu limite les requêtes (erreur ${r.status || 429}${r.who ? ` · ${r.who}` : ''}) : pause avant de reprendre`, 'warn');
        item.tries += 1;
        gap = L.nextGap(gap, true, BASE_GAP);
        lastStatus = r.status || 429;
        if (item.tries > 12) { sched.pending.delete(item.cardId); item.resolve({ limited: true }); continue; }
        sched.penaltyUntil = Math.max(sched.penaltyUntil, Date.now() + L.limitWait(sched.blocks, r.retryAfter) * 1000); // 6, 12, 18… s (60 s au plus)
        (item.high ? sched.hi : sched.lo).unshift(item);
        ensureTicker();
        emit();
        continue;
      }
      // Erreur du serveur (5xx), délai dépassé ou réseau : le jeu est surchargé, pas de refus. On remet la carte au bout de la file et on réessaie
      // (5 essais) au lieu de l'abandonner : sinon le prix manquait pour toujours.
      if (r.error != null && (r.error === 0 || r.error === 408 || r.error >= 500)) {
        item.soft = (item.soft || 0) + 1;
        lastStatus = r.error;
        if (item.soft < 5) { (item.high ? sched.hi : sched.lo).push(item); await sleep(Math.max(gap, 1500 * item.soft)); continue; }
        WMX.journal?.add('Prix', `prix abandonné après ${item.soft} essais (${r.error ? 'erreur ' + r.error : 'pas de réponse'}) : le jeu est surchargé`, 'warn');
      }
      sched.blocks = 0; // un succès : la pause repart de sa valeur de base
      gap = L.nextGap(gap, false, BASE_GAP);
      if (r.error != null) lastStatus = r.error;
      if (r.summary) { cache[item.cardId] = { t: Date.now(), s: r.summary }; scheduleSave(); }
      sched.pending.delete(item.cardId);
      item.resolve(r);
      emit();
      await sleep(gap);
    }
  }
  function pump() {
    sched.slots.forEach((busy, idx) => {
      if (busy || !queued()) return;
      sched.slots[idx] = true;
      worker(idx).catch(() => {}).finally(() => { sched.slots[idx] = false; if (queued() && WMX.alive()) pump(); });
    });
  }

  /**
   * front : la carte est sur la page affichée (ou l'utilisateur attend ce prix précis, clic ⚡) : elle est servie avant le reste, tant que cette page
   * reste affichée. Une carte déjà en file, de nouveau demandée par la page affichée, remonte en tête et passe à cette page.
   */
  function schedule(cardId, high, front = false) {
    if (high && sched.pending.has(cardId)) { // déjà demandée : on la fait passer devant si la page affichée l'attend
      if (front) { const i = sched.hi.findIndex((x) => x.cardId === cardId); if (i >= 0) { const [it] = sched.hi.splice(i, 1); it.front = true; it.page = location.pathname; sched.hi.unshift(it); } }
      return sched.pending.get(cardId);
    }
    const p = new Promise((resolve) => {
      const item = { cardId, high, resolve, tries: 0, front: !!front, page: location.pathname };
      if (high && front) sched.hi.unshift(item); else (high ? sched.hi : sched.lo).push(item);
    });
    if (high) sched.pending.set(cardId, p);
    pump();
    return p;
  }

  async function run(items, token, opts = {}) {
    // La jauge compte aussi les cartes dont le prix est déjà connu (opts.base) : elle part de là, sans les recharger.
    Object.assign(job, { running: true, paused: false, done: opts.base || 0, total: opts.total || items.length, failed: 0 });
    emit();
    for (const it of items) {
      if (token !== job.token || !WMX.alive()) break;
      while (job.paused && token === job.token) await sleep(300);
      if (token !== job.token) break;
      const r = await schedule(it.card_id, false);
      if (r.limited || r.error) job.failed += 1;
      job.done += 1;
      emit();
    }
    if (token === job.token) job.running = false;
    emit();
    scheduleSave();
    if (token === job.token && job.failed) WMX.reportError?.('prices', lastStatus, `${job.failed} prix à réessayer`);
  }

  WMX.prices = {
    load,
    onProgress(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    /** Moyenne, dernière vente et nombre de ventes pour la rareté donnée de la carte, ou null si inconnus. */
    get(cardId, rarity) {
      const e = cache?.[cardId];
      const s = e?.s?.[rarity];
      return s ? { avg: s.average, last: s.latest, count: s.count, t: e.t } : null;
    },
    /** Un prix (ou « sans vente ») a déjà été chargé pour cette carte, même ancien. */
    has(cardId) { return !!cache?.[cardId]; },
    fresh(cardId) {
      return L.isFresh(cache?.[cardId]);
    },
    /** Icône de fraîcheur de la moyenne (✓ à jour, ! en retard, ↻ actualisation) ; la ligne d'explication est dans `title`. */
    icon(cardId) { const f = WMX.prices.freshness(cardId); return WMX.dom.el('i', { class: `wmx-age ${f.state}`, title: f.line, 'aria-label': f.line }, f.icon); },
    /** Fraîcheur de la moyenne de cette carte : { state: 'fresh' | 'stale' | 'loading', icon, line } (voir logic.priceFreshness). */
    freshness(cardId) { return L.priceFreshness(WMX.prices.age(cardId), sched.pending.has(cardId)); },
    /**
     * Marché : garde la moyenne de cette carte à jour. Jamais chargée ou de plus de 24 h : relue (l'ancienne reste affichée en attendant).
     * Les demandes sont regroupées puis servies dans l'ordre de `order` (fin de l'enchère, ou position à l'écran) ; une carte n'est pas
     * redemandée plus d'une fois toutes les 10 minutes (si le jeu ne répond pas, on ne boucle pas).
     * opts.front : la carte est À L'ÉCRAN (liste du Marché, page d'une enchère) : elle passe devant toutes les autres demandes (bulle des enchères,
     * collection…), et une carte déjà en file remonte en tête quand on la regarde.
     */
    keepFresh(cardId, order = Infinity, opts = {}) {
      if (!cardId) return;
      const age = WMX.prices.age(cardId);
      if (age != null && age < L.MARKET_TTL) return;
      if (sched.pending.has(cardId)) { if (opts.front) schedule(cardId, true, true); return; }
      if (Date.now() - (fresh.asked.get(cardId) || 0) < 10 * 60000) return;
      const prev = fresh.want.get(cardId);
      fresh.want.set(cardId, { k: Math.min(Number.isFinite(order) ? order : Infinity, prev?.k ?? Infinity), front: !!(opts.front || prev?.front) });
      if (fresh.timer) return; // regroupement : départ peu après la PREMIÈRE demande (une rafale de repeintures ne le repousse plus)
      fresh.timer = setTimeout(async () => {
        fresh.timer = null;
        await load();
        const list = [...fresh.want.entries()].sort((a, b) => a[1].k - b[1].k);
        fresh.want.clear();
        for (const [id] of list.filter(([, w]) => !w.front)) { fresh.asked.set(id, Date.now()); schedule(id, true, false); }
        for (const [id] of list.filter(([, w]) => w.front).reverse()) { fresh.asked.set(id, Date.now()); schedule(id, true, true); } // en tête, dans l'ordre de l'écran
        emit(); // les moyennes concernées passent à « actualisation en cours »
      }, 120);
    },
    /** Âge du prix chargé pour cette carte (ms), ou null s'il n'a jamais été chargé. */
    age(cardId) { const t = cache?.[cardId]?.t; return Number.isFinite(t) ? Date.now() - t : null; },
    /** Vrai pendant qu'une lecture de ce prix est en file ou en cours (actualisation). */
    loading(cardId) { return sched.pending.has(cardId); },
    /**
     * Actualise le prix d'une carte (file prioritaire, sans passer devant les clics ⚡ de l'utilisateur) : l'ancien prix reste affiché en attendant.
     * Rien n'est redemandé si une lecture de cette carte est déjà en cours.
     */
    async refresh(cardId) {
      await load();
      return schedule(cardId, true, false);
    },
    /** Prix d'UNE carte tout de suite (enchère rapide), prioritaire sur le chargement par lots. */
    async fetchOne(cardId) {
      await load();
      return schedule(cardId, true, true);
    },
    /**
     * Cartes qu'on vient de tirer (réponse de /api/packs/open) : leur prix est récupéré en arrière-plan, pendant la pause
     * entre deux paquets ou après un paquet normal, pour l'afficher dans le résultat et l'avoir déjà en cache.
     */
    async prefetch(cards) {
      await load();
      for (const c of cards || []) {
        const r = WMX.normRarity(c?.rarity);
        if (c?.id && r && !WMX.prices.fresh(c.id)) schedule(c.id, true); // rien à faire si le prix a moins de 24 h (même « sans vente »)
      }
    },
    /** Charge les prix de ces cartes par lots (celles dont le prix est déjà à jour sont ignorées). */
    /** Charge UNIQUEMENT les prix des cartes données (à l'appelant de n'y mettre que les prix manquants). */
    start(items, opts = {}) {
      job.token += 1;
      run(items, job.token, opts);
      return items.length;
    },
    pause() { job.paused = true; emit(); },
    resume() { job.paused = false; emit(); },
    stop() { job.token += 1; job.running = false; job.paused = false; emit(); },
    state: snapshot,
    latency: slow,
  };

  // Une moyenne chargée dans un autre onglet du jeu (page d'une enchère ouverte à part, par exemple) vaut aussitôt ici : sans cela, chaque onglet
  // gardait sa propre copie et la liste du Marché affichait encore « Moy. … » pour une carte déjà chargée ailleurs.
  WMX.onStorage?.((c) => {
    const nv = c.priceCache?.newValue;
    if (!nv || !cache) return;
    let changed = false;
    for (const id in nv) {
      const e = nv[id];
      if (e && Number.isFinite(e.t) && (!cache[id] || e.t > cache[id].t)) { cache[id] = e; changed = true; }
    }
    if (changed) emit();
  });
})();
