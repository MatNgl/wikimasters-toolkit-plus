// Prix par carte : moyenne du marché lue via l'appel « résumé » du jeu
// (GET /api/marketplace/cards/{id}/sales?scope=summary, le même que le formulaire « Mettre aux enchères »,
// sans compte Pro). Réponse : { summary: { RARETÉ: { average, count, latest } } } — un prix par rareté.
//
// Toutes les requêtes passent par UN ordonnanceur : une seule à la fois, espacées, avec une pause qui s'allonge à chaque
// refus du jeu (429 ou 403 par rafales) puis repart de zéro. Deux files : « haute » (cartes qu'on vient de tirer, enchère
// rapide) servie avant la file « basse » (chargement par lots de Collection+).
(() => {
  const { sleep } = WMX.dom;
  const TTL = 48 * 3600 * 1000; // une réponse « sans vente » reste valable 2 jours ; une moyenne connue n'est jamais rechargée par lots
  const GAP_MS = 450;           // pause entre deux requêtes
  let cache = null;             // card_id -> { t, s: { RARETÉ: { average, count, latest } } }
  let saveTimer = null;
  const listeners = new Set();
  const job = { running: false, paused: false, done: 0, total: 0, failed: 0, token: 0 };
  const sched = { hi: [], lo: [], pumping: false, blocks: 0, penaltyUntil: 0, pending: new Map() };
  let ticker = null;

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
    const res = await fetch(u);
    // Le jeu freine par rafales : 429, mais aussi 403 sur ce point d'accès. On attend puis on réessaie.
    if (res.status === 429 || res.status === 403) return { limited: true };
    if (!res.ok) return { error: res.status };
    const j = await res.json();
    return { summary: j.summary || {} };
  }

  async function pump() {
    if (sched.pumping) return;
    sched.pumping = true;
    try {
      await load();
      while ((sched.hi.length || sched.lo.length) && WMX.alive()) {
        const item = sched.hi.shift() || sched.lo.shift();
        const left = sched.penaltyUntil - Date.now();
        if (left > 0) await sleep(left);
        let r;
        try { r = await fetchSummary(item.cardId); } catch (_) { r = { error: 0 }; }
        if (r.limited) {
          sched.blocks += 1;
          item.tries += 1;
          if (item.tries > 8) { sched.pending.delete(item.cardId); item.resolve({ limited: true }); continue; }
          sched.penaltyUntil = Date.now() + Math.min(120, 3 + sched.blocks) * 1000; // 4, 5, 6… s
          (item.high ? sched.hi : sched.lo).unshift(item);
          ensureTicker();
          emit();
          continue;
        }
        sched.blocks = 0; // un succès : la pause repart de sa valeur de base
        if (r.summary) { cache[item.cardId] = { t: Date.now(), s: r.summary }; scheduleSave(); }
        sched.pending.delete(item.cardId);
        item.resolve(r);
        emit();
        await sleep(GAP_MS);
      }
    } finally {
      sched.pumping = false;
      if ((sched.hi.length || sched.lo.length) && WMX.alive()) pump();
    }
  }

  function schedule(cardId, high) {
    if (high && sched.pending.has(cardId)) return sched.pending.get(cardId); // déjà demandée
    const p = new Promise((resolve) => { (high ? sched.hi : sched.lo).push({ cardId, high, resolve, tries: 0 }); });
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
    fresh(cardId) {
      const e = cache?.[cardId];
      return !!e && Date.now() - e.t < TTL;
    },
    /** Prix d'UNE carte tout de suite (enchère rapide), prioritaire sur le chargement par lots. */
    async fetchOne(cardId) {
      await load();
      return schedule(cardId, true);
    },
    /**
     * Cartes qu'on vient de tirer (réponse de /api/packs/open) : leur prix est récupéré en arrière-plan, pendant la pause
     * entre deux paquets ou après un paquet normal, pour l'afficher dans le résultat et l'avoir déjà en cache.
     */
    async prefetch(cards) {
      await load();
      for (const c of cards || []) {
        const r = WMX.normRarity(c?.rarity);
        if (c?.id && r && !WMX.prices.get(c.id, r)) schedule(c.id, true);
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
  };
})();
