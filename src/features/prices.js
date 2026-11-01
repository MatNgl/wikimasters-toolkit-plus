// Prix par carte : moyenne du marché lue via l'appel « résumé » du jeu
// (GET /api/marketplace/cards/{id}/sales?scope=summary, le même que le formulaire « Mettre aux enchères »,
// sans compte Pro). Réponse : { summary: { RARETÉ: { average, count, latest } } } — un prix par rareté.
// Chargement par lots, espacé, avec reprise automatique et pause allongée à chaque refus (429) du jeu.
(() => {
  const { sleep } = WMX.dom;
  const TTL = 24 * 3600 * 1000; // un prix est considéré à jour pendant 24 h
  const GAP_MS = 450;           // pause entre deux requêtes
  let cache = null;             // card_id -> { t, s: { RARETÉ: { average, count, latest } } }
  let saveTimer = null;
  const listeners = new Set();
  const job = { running: false, paused: false, done: 0, total: 0, blocks: 0, wait: 0, token: 0 };

  const snapshot = () => ({ running: job.running, paused: job.paused, done: job.done, total: job.total, wait: job.wait });
  const emit = () => listeners.forEach((cb) => { try { cb(snapshot()); } catch (_) { /* écouteur obsolète */ } });
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => WMX.store.set('priceCache', cache), 1500);
  };

  async function fetchSummary(cardId) {
    const u = new URL(`/api/marketplace/cards/${cardId}/sales`, location.origin);
    u.searchParams.set('scope', 'summary');
    const res = await fetch(u);
    if (res.status === 429) return { limited: true };
    if (!res.ok) return { error: res.status };
    const j = await res.json();
    return { summary: j.summary || {} };
  }

  async function run(items, token) {
    Object.assign(job, { running: true, paused: false, done: 0, total: items.length, blocks: 0, wait: 0 });
    emit();
    for (const it of items) {
      if (token !== job.token || !WMX.alive()) break;
      while (job.paused && token === job.token) await sleep(300);
      for (;;) {
        if (token !== job.token) break;
        let r;
        try { r = await fetchSummary(it.card_id); } catch (_) { r = { error: 0 }; }
        if (r.limited) { // le jeu freine : on attend de plus en plus longtemps (4, 5, 6… s) puis on réessaie
          job.blocks += 1;
          for (let s = Math.min(120, 3 + job.blocks); s > 0 && token === job.token; s--) { job.wait = s; emit(); await sleep(1000); }
          job.wait = 0;
          continue;
        }
        if (r.summary) { cache[it.card_id] = { t: Date.now(), s: r.summary }; scheduleSave(); }
        job.blocks = 0;
        break;
      }
      job.done += 1;
      emit();
      await sleep(GAP_MS);
    }
    if (token === job.token) job.running = false;
    emit();
    scheduleSave();
  }

  WMX.prices = {
    async load() {
      if (!cache) cache = await WMX.store.get('priceCache', {});
      return cache;
    },
    onProgress(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    /** Moyenne, dernière vente et nombre de ventes pour la rareté actuelle de la carte, ou null si inconnus. */
    get(cardId, rarity) {
      const e = cache?.[cardId];
      const s = e?.s?.[rarity];
      return s ? { avg: s.average, last: s.latest, count: s.count, t: e.t } : null;
    },
    fresh(cardId) {
      const e = cache?.[cardId];
      return !!e && Date.now() - e.t < TTL;
    },
    /** Charge les prix de ces cartes (celles dont le prix est déjà à jour sont ignorées). */
    start(items) {
      const todo = items.filter((it) => !this.fresh(it.card_id));
      job.token += 1;
      run(todo, job.token);
      return todo.length;
    },
    pause() { job.paused = true; emit(); },
    resume() { job.paused = false; emit(); },
    stop() { job.token += 1; job.running = false; job.paused = false; job.wait = 0; emit(); },
    state: snapshot,
  };
})();
