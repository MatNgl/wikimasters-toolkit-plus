// Tourne dans le monde MAIN, au tout début du chargement, dans TOUS les cadres du jeu. Il n'agit que dans les cadres
// créés par l'extension pour annuler une enchère (adresse marquée « #wmx-auto ») : les alertes de confirmation du jeu
// (« Annuler cette enchère et récupérer votre carte ? ») y répondent « oui » d'elles-mêmes. Il note aussi, pour le journal,
// la réponse du serveur aux requêtes d'écriture du cadre (la mise en vente) : le script de l'extension la lit dans
// <html data-wmx-net>. Rien ne change dans la page principale, ni dans les autres cadres.
// Dans la page Collection invisible de la défausse (« #wmx-discard »), il ne répond à aucune confirmation : il note seulement le blocage
// « automatisation » du jeu (réponse 403 automation_limit, de n'importe quelle requête) dans <html data-wmx-blocked> (date), pour que la défausse
// se mette en pause puis réessaie (discard.js).
// Dans la page Paquets invisible de l'ouverture en parallèle (« #wmx-pulls »), il relaie à la page principale (postMessage, texte JSON) le début
// de chaque requête du jeu et la réponse à l'ouverture d'un paquet : l'extension y lit les cartes tirées, comme dans la page principale.
(() => {
  const auto = location.hash.includes('wmx-auto');
  if (window !== window.top && location.hash.includes('wmx-pulls')) {
    const post = (msg) => { try { window.top.postMessage(JSON.stringify({ wmx: 'pulls', ...msg }), location.origin); } catch (_) { /* page principale partie */ } };
    const fetch0 = window.fetch;
    window.fetch = function wmxPullsFetch(input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : input.url; } catch (_) { /* adresse illisible */ }
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (url && url.includes('/api/')) post({ t: 'start', url });
      return fetch0.apply(this, arguments).then((res) => {
        if (url && url.includes('/api/') && method !== 'GET') res.clone().json().then((data) => post({ t: 'api', url, method, status: res.status, data })).catch(() => post({ t: 'api', url, method, status: res.status, data: null }));
        return res;
      }, (err) => { if (url && url.includes('/api/') && method !== 'GET') post({ t: 'api', url, method, status: 0, data: null }); throw err; });
    };
    return;
  }
  if (window === window.top || (!auto && !location.hash.includes('wmx-discard'))) return;
  if (auto) {
    window.confirm = () => true;
    window.alert = () => {};
  }
  const watchBlock = (res) => {
    if (res && res.status === 403) {
      res.clone().text().then((t) => { if (/automation_limit/.test(t)) { try { document.documentElement.dataset.wmxBlocked = String(Date.now()); } catch (_) { /* document pas prêt */ } } }).catch(() => {});
    }
    return res;
  };
  const log = [];
  const note = (line) => {
    log.push(line);
    if (log.length > 4) log.shift();
    note.flush();
  };
  note.flush = () => { try { document.documentElement.dataset.wmxNet = log.join(' ; '); } catch (_) { /* document pas encore prêt */ } };
  // L'extension remet le relevé à zéro avant chaque mise en vente : sans cela, les réponses des cartes précédentes y resteraient.
  document.addEventListener('wmx-net-reset', () => { log.length = 0; try { delete document.documentElement.dataset.wmxNet; } catch (_) { /* document pas prêt */ } });
  const realFetch = window.fetch;
  // --- Défausse : vue étendue dans la page invisible ---------------------------------------------------------------------------------
  // Quand la vue étendue est activée (localStorage « wmxCollView » = on, partagé avec la page principale), la liste de cette page Collection
  // invisible est servie par la copie de la collection, via la page principale (page-hook.js) : 500 cartes par page, comme la défausse le
  // demande. La page principale dit d'abord si la copie est prête ; sinon, la page garde le fonctionnement du jeu pour toute la visite.
  const discard = !auto && location.hash.includes('wmx-discard');
  const PARAMS = new Set(['sort', 'q', 'rarity', 'tag_id', 'untagged', 'page', 'stats']);
  const waiters = new Map();
  let askN = 0;
  let visit = null; // 'serve' | 'raw', décidé à la première lecture
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || typeof e.data !== 'string' || !e.data.startsWith('{"wmx":"coll-reply"')) return;
    let d = null;
    try { d = JSON.parse(e.data); } catch (_) { return; }
    const w = waiters.get(d.id);
    if (w) { waiters.delete(d.id); w(d.body ?? null); }
  });
  const askTop = (msg, ms = 4000) => new Promise((resolve) => {
    const id = ++askN;
    const timer = setTimeout(() => { waiters.delete(id); resolve(null); }, ms);
    waiters.set(id, (b) => { clearTimeout(timer); resolve(b); });
    try { window.top.postMessage(JSON.stringify({ ...msg, id }), location.origin); } catch (_) { clearTimeout(timer); waiters.delete(id); resolve(null); }
  });
  const target = (input) => {
    try { if (localStorage.getItem('wmxCollView') !== 'on') return null; } catch (_) { return null; }
    let u;
    try { u = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (_) { return null; }
    if (u.origin !== location.origin) return null;
    const kind = u.pathname === '/api/my-collection' ? 'list' : u.pathname === '/api/my-collection/stats' ? 'stats' : null;
    if (!kind) return null;
    for (const k of u.searchParams.keys()) if (!PARAMS.has(k)) return null;
    return { kind, url: u.pathname + u.search };
  };
  const json = (body) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  async function served(self, args) {
    const t = target(args[0]);
    if (!t) return null;
    if (!visit) visit = (await askTop({ wmx: 'coll-ready?' }, 3000)) === 'on' ? 'serve' : 'raw';
    if (visit !== 'serve') return null;
    if (t.kind === 'stats') { // les étiquettes et leurs nombres viennent du jeu ; le total (nombre de pages) vient de la copie
      const r = await realFetch.apply(self, args);
      const real = r.ok ? await r.clone().json().catch(() => null) : null;
      if (!real) return r;
      const body = await askTop({ wmx: 'coll-ask', kind: 'stats', url: t.url, real });
      return body == null ? r : json(body);
    }
    const body = await askTop({ wmx: 'coll-ask', kind: 'list', url: t.url });
    return body == null ? null : json(body);
  }
  window.fetch = function wmxFetch(input, init) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'GET' && discard) {
      const self = this;
      const args = arguments;
      return served(self, args).catch(() => null).then((r) => r || realFetch.apply(self, args).then(watchBlock));
    }
    if (method === 'GET') return realFetch.apply(this, arguments).then(watchBlock);
    if (discard) { // écriture de la page invisible (défausse, favoris, étiquettes) : relayée à la page principale pour tenir la copie à jour
      let url = '';
      let req = null;
      try { url = new URL(typeof input === 'string' ? input : input.url, location.href).href; } catch (_) { /* adresse illisible */ }
      try { req = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (_) { req = null; }
      return realFetch.apply(this, arguments).then((res) => {
        watchBlock(res);
        res.clone().json().catch(() => null).then((data) => { try { window.top.postMessage(JSON.stringify({ wmx: 'coll-api', url, method, status: res.status, data, req }), location.origin); } catch (_) { /* page principale partie */ } });
        return res;
      });
    }
    let path = '';
    try { path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname; } catch (_) { /* adresse illisible */ }
    return realFetch.apply(this, arguments).then(
      (res) => {
        watchBlock(res);
        note(`${method} ${path} → ${res.status}`);
        if (!res.ok) { // un refus : on garde de quoi savoir QUI refuse (le jeu, ou un pare-feu devant lui) et pourquoi
          const mine = log[log.length - 1];
          const h = (n) => res.headers.get(n);
          const meta = [h('server') && `serveur ${h('server')}`, h('cf-mitigated') && `cf-mitigated ${h('cf-mitigated')}`, h('retry-after') && `retry-after ${h('retry-after')}`].filter(Boolean).join(', ');
          res.clone().text().then((t) => {
            const body = String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
            const i = log.indexOf(mine);
            if (i >= 0) { log[i] += ` [${meta}${meta && body ? ' · ' : ''}${body ? `« ${body} »` : ''}]`; note.flush(); }
          }).catch(() => {});
        }
        return res;
      },
      (err) => { note(`${method} ${path} → réseau (${(err && err.message) || err})`); throw err; });
  };
})();
