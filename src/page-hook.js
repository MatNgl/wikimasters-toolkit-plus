// Tourne dans le monde MAIN : observe les appels fetch de /api/* et relaie requête (corps JSON) et
// réponse au content script via un CustomEvent. N'envoie ni ne modifie aucune requête.
(() => {
  if (window.__wmxHooked) return;
  window.__wmxHooked = true;
  // Navigation interne demandée par l'extension (monde isolé → MAIN) : routeur du jeu, sinon chargement classique.
  window.addEventListener('wmx:navigate', (e) => {
    const url = String(e.detail || '');
    if (!url.startsWith('/')) return;
    try { if (window.next?.router?.push) return window.next.router.push(url); } catch (_) {}
    location.assign(url);
  });
  // Rattrapage : les réponses de LECTURE (GET) récentes sont gardées (15 au plus). Le jeu demande souvent ses données avant que l'extension
  // n'écoute (chargement direct d'une page, changement de page) : à sa demande (« wmx:replay »), celles de moins de 30 s lui sont renvoyées.
  // Jamais une écriture (mise, ouverture de paquet…) : elle ne doit être traitée qu'une fois.
  const recent = [];
  window.addEventListener('wmx:replay', () => {
    const now = Date.now();
    for (const r of recent) if (now - r.t < 30000) window.dispatchEvent(new CustomEvent('wmx:api', { detail: { ...r.detail, replay: true } }));
  });
  // --- Vue étendue de la Collection (collection-view.js) ----------------------------------------------------------------------------
  // Quand elle est activée (localStorage « wmxCollView » = on), les lectures de la liste de la Collection (/api/my-collection et /stats) sont
  // servies par l'extension depuis sa copie de la collection : la page du jeu affiche ainsi 50 à 500 cartes par page, triées aussi par moyenne,
  // instantanément, avec toutes ses fonctions (sélection, défausse, favoris, étiquettes, fiche). Rien n'est envoyé au jeu à sa place : seules les
  // LECTURES de la liste sont servies, toutes les écritures partent au jeu normalement. Si l'extension ne répond pas (copie pas prête), la page
  // garde le fonctionnement du jeu pour toute la visite (jamais un mélange des deux).
  const COLL = { ok: false, seen: false, visit: null, n: 0, waiters: new Map() };
  const COLL_PARAMS = new Set(['sort', 'q', 'rarity', 'tag_id', 'untagged', 'page', 'stats']);
  let collReady;
  const collReadyP = new Promise((r) => { collReady = r; });
  window.addEventListener('wmx:coll-ready', (e) => {
    let d = {};
    try { d = JSON.parse(String(e.detail || '{}')); } catch (_) { /* annonce illisible */ }
    COLL.ok = !!d.ok; COLL.seen = true; collReady();
  });
  window.addEventListener('wmx:coll-answer', (e) => {
    let d = null;
    try { d = JSON.parse(String(e.detail || 'null')); } catch (_) { return; }
    const w = d && COLL.waiters.get(d.id);
    if (w) { COLL.waiters.delete(d.id); w(d.body ?? null); }
  });
  // Nouvelle visite de la Collection (navigation interne du jeu) : le mode est redécidé à la première lecture.
  for (const k of ['pushState', 'replaceState']) {
    const o = history[k];
    history[k] = function (...a) { const before = location.pathname; const r = o.apply(this, a); if (location.pathname !== before) COLL.visit = null; return r; };
  }
  window.addEventListener('popstate', () => { COLL.visit = null; });
  window.addEventListener('wmx:coll-reset', () => { COLL.visit = null; }); // l'extension change de mode (activée, désactivée, copie prête)
  const collTarget = (url, method) => {
    try { if (method !== 'GET' || !/^\/collection\/?$/.test(location.pathname) || localStorage.getItem('wmxCollView') !== 'on') return null; } catch (_) { return null; }
    let u;
    try { u = new URL(url, location.origin); } catch (_) { return null; }
    if (u.origin !== location.origin) return null;
    const kind = u.pathname === '/api/my-collection' ? 'list' : u.pathname === '/api/my-collection/stats' ? 'stats' : null;
    if (!kind) return null;
    for (const k of u.searchParams.keys()) if (!COLL_PARAMS.has(k)) return null; // autre usage (collection d'un ami, liste de souhaits…) : jamais servi
    return { kind, url: u.pathname + u.search };
  };
  const collAsk = (t, real) => new Promise((resolve) => {
    const id = ++COLL.n;
    const timer = setTimeout(() => { COLL.waiters.delete(id); resolve(null); }, 3000);
    COLL.waiters.set(id, (body) => { clearTimeout(timer); resolve(body); });
    window.dispatchEvent(new CustomEvent('wmx:coll-ask', { detail: JSON.stringify({ id, kind: t.kind, url: t.url, real }) }));
  });
  const collJson = (body) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

  // --- Actions de masse par lots de 100 cartes ------------------------------------------------------------------------------------
  // Le jeu refuse plus de 100 cartes par demande (« Maximum 100 cartes par requête »). Avec la vue étendue, une page peut en compter 500 :
  // une défausse en lot, ou une écriture directe dans la base du jeu (favoris, étiquettes) sur plus de 100 cartes, part donc en lots de 100,
  // l'un après l'autre (0,4 s entre deux), avec la même requête du jeu. La page reçoit UNE réponse : les nombres additionnés, les listes mises
  // bout à bout ; au premier refus, on s'arrête et la page reçoit ce refus (les lots déjà passés restent faits). Chaque lot est relayé à
  // l'extension comme une requête normale (la copie de la collection reste exacte).
  const LOT = 100;
  const lots = (a) => { const out = []; for (let i = 0; i < a.length; i += LOT) out.push(a.slice(i, i + LOT)); return out; };
  const relay = (url, method, status, data, req) => { try { window.dispatchEvent(new CustomEvent('wmx:api', { detail: { url, method, status, data, req } })); } catch (_) { /* relais facultatif */ } };
  function merge(parts) {
    if (parts.every((x) => Array.isArray(x))) return parts.flat();
    const out = { ...(parts[parts.length - 1] || {}) };
    for (const k of Object.keys(out)) {
      const vals = parts.map((x) => x?.[k]);
      if (vals.every((v) => typeof v === 'number')) out[k] = vals.reduce((n, v) => n + v, 0);
      else if (vals.every((v) => Array.isArray(v))) out[k] = vals.flat();
    }
    return out;
  }
  /** Rend une réponse unique si la demande a dû être découpée, sinon null (demande normale). */
  async function inLots(self, args) {
    const [input, init] = args;
    if (typeof input !== 'string' || !init || typeof init.body !== 'string' && !/\.supabase\.co\/rest\/v1\//.test(input)) return null;
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'GET') return null;
    let u;
    try { u = new URL(input, location.origin); } catch (_) { return null; }
    const jobs = []; // [{ url, body }]
    let body = null;
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (_) { body = null; }
    if (u.origin === location.origin && u.pathname === '/api/user-cards/bulk-discard' && method === 'POST' && Array.isArray(body?.card_ids) && body.card_ids.length > LOT) {
      for (const ids of lots(body.card_ids)) jobs.push({ url: input, body: { ...body, card_ids: ids } });
    } else if (/\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith('/rest/v1/')) {
      if (Array.isArray(body) && body.length > LOT) for (const part of lots(body)) jobs.push({ url: input, body: part }); // ajout d'étiquettes à plusieurs cartes
      else {
        const key = [...u.searchParams.keys()].find((k) => /^in\.\(/.test(u.searchParams.get(k) || '') && u.searchParams.get(k).slice(4, -1).split(',').length > LOT);
        if (key) { // favoris ou étiquettes de plusieurs cartes : id=in.(…), user_card_id=in.(…)
          const ids = u.searchParams.get(key).slice(4, -1).split(',');
          for (const part of lots(ids)) { const v = new URL(u); v.searchParams.set(key, `in.(${part.join(',')})`); jobs.push({ url: v.toString(), body }); }
        }
      }
    }
    if (jobs.length < 2) return null;
    const parts = [];
    let last = null;
    for (let i = 0; i < jobs.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 400));
      const j = jobs[i];
      const res = await origFetch.call(self, j.url, { ...init, body: j.body == null ? init.body : JSON.stringify(j.body) });
      let data = null;
      try { data = await res.clone().json(); } catch (_) { data = null; }
      relay(j.url, method, res.status, data, j.body);
      if (!res.ok) return res; // refus : la page l'affiche, les lots suivants ne partent pas
      parts.push(data);
      last = res;
    }
    if (parts.some((x) => x == null)) return last; // réponses sans corps (204) : la dernière suffit
    return new Response(JSON.stringify(merge(parts)), { status: last.status, headers: { 'content-type': 'application/json' } });
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    try { const r = await inLots(this, args); if (r) return r; } catch (_) { /* en cas de doute : la demande telle quelle */ }
    let url = null;
    try {
      const u0 = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      const t = u0 && collTarget(u0, (args[1]?.method || args[0]?.method || 'GET').toUpperCase());
      if (t) {
        if (!COLL.visit) {
          if (!COLL.seen) await Promise.race([collReadyP, new Promise((r) => setTimeout(r, 5000))]); // l'extension charge encore : on l'attend un peu
          COLL.visit = COLL.ok ? 'serve' : 'raw';
        }
        if (COLL.visit === 'serve') {
          if (t.kind === 'stats') { // les étiquettes et leurs nombres viennent du jeu ; le total (qui fixe le nombre de pages) vient de la copie
            const r = await origFetch.apply(this, args);
            const real = r.ok ? await r.clone().json().catch(() => null) : null;
            if (!real) return r;
            const body = await collAsk(t, real);
            return body == null ? r : collJson(body);
          }
          const body = await collAsk(t, null);
          if (body != null) return collJson(body);
        }
      }
    } catch (_) { /* en cas de doute : le fonctionnement normal du jeu */ }
    try {
      url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      // Début d'appel : permet à l'extension de savoir si un clic a bien déclenché une requête.
      if (url && url.includes('/api/')) window.dispatchEvent(new CustomEvent('wmx:start', { detail: { url } }));
    } catch (_) {}
    let res;
    try { res = await origFetch.apply(this, args); } catch (err) {
      // Requête échouée (réseau coupé, serveur injoignable) : signalée avec le statut 0, puis l'erreur suit son cours normal.
      try { if (url && url.includes('/api/')) window.dispatchEvent(new CustomEvent('wmx:api', { detail: { url, method: (args[1]?.method || args[0]?.method || 'GET').toUpperCase(), status: 0, data: null, req: null } })); } catch (_) {}
      throw err;
    }
    try {
      // Écritures de la page directement dans la base du jeu (favoris, étiquettes) : relayées comme les autres, pour tenir la copie à jour.
      const sbWrite = url && /\.supabase\.co\/rest\/v1\//.test(url) && (args[1]?.method || 'GET').toUpperCase() !== 'GET';
      if (sbWrite) {
        let req = null;
        try { req = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : null; } catch (_) { /* corps non JSON */ }
        window.dispatchEvent(new CustomEvent('wmx:api', { detail: { url, method: args[1].method.toUpperCase(), status: res.status, data: null, req } }));
      }
      if (url && url.includes('/api/')) {
        const method = (args[1]?.method || args[0]?.method || 'GET').toUpperCase();
        let req = null;
        if (method !== 'GET' && typeof args[1]?.body === 'string') {
          try { req = JSON.parse(args[1].body); } catch (_) { /* corps non JSON */ }
        }
        res.clone().json().then((data) => {
          const detail = { url, method, status: res.status, data, req };
          if (method === 'GET' && res.ok) { recent.push({ t: Date.now(), detail }); if (recent.length > 15) recent.shift(); }
          window.dispatchEvent(new CustomEvent('wmx:api', { detail }));
        }).catch(() => { // réponse non JSON (page d'erreur du serveur) : signalée sans données
          if (!res.ok) window.dispatchEvent(new CustomEvent('wmx:api', { detail: { url, method, status: res.status, data: null, req } }));
        });
      }
    } catch (_) {}
    return res;
  };
})();
