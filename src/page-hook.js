// Tourne dans le monde MAIN : observe les appels fetch de /api/* et relaie requête (corps JSON) et
// réponse au content script via un CustomEvent. N'envoie ni ne modifie aucune requête.
(() => {
  if (window.__wmxHooked) return;
  window.__wmxHooked = true;
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
          window.dispatchEvent(new CustomEvent('wmx:api', { detail: { url, method, status: res.status, data, req } }));
        }).catch(() => {});
      }
    } catch (_) {}
    return res;
  };
})();
