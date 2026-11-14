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
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    let url = null;
    try {
      url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      // Début d'appel : permet à l'extension de savoir si un clic a bien déclenché une requête.
      if (url && url.includes('/api/')) window.dispatchEvent(new CustomEvent('wmx:start', { detail: { url } }));
    } catch (_) {}
    const res = await origFetch.apply(this, args);
    try {
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
        }).catch(() => {});
      }
    } catch (_) {}
    return res;
  };
})();
