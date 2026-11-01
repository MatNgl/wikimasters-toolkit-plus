// Écoute les réponses API relayées par page-hook.js, mémorise la FORME de chaque
// endpoint (clés seulement, pas les données) pour documenter l'API, et diffuse
// les réponses aux features via WMX.onApi(cb).
(() => {
  const listeners = [];
  WMX.onApi = (cb) => listeners.push(cb);

  const shapeOf = (v, depth = 0) => {
    if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1)] : [];
    if (v && typeof v === 'object') {
      if (depth > 3) return '{…}';
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
    }
    return v === null ? 'null' : typeof v;
  };

  window.addEventListener('wmx:api', async (e) => {
    const { url, method, status, data } = e.detail;
    const path = new URL(url, location.origin).pathname;
    const shapes = await WMX.store.get('apiShapes', {});
    shapes[`${method} ${path}`] = { status, shape: shapeOf(data), seen: Date.now() };
    await WMX.store.set('apiShapes', shapes);
    document.documentElement.dataset.wmxShapes = JSON.stringify(shapes); // debug : lisible depuis la page
    listeners.forEach((cb) => { try { cb({ url, path, method, status, data }); } catch (_) {} });
  });

  /** Retrouve récursivement les objets "carte" (ayant un champ rarity) dans une réponse. */
  WMX.findCards = (node, acc = []) => {
    if (Array.isArray(node)) node.forEach((n) => WMX.findCards(n, acc));
    else if (node && typeof node === 'object') {
      if (typeof node.rarity === 'string') acc.push(node);
      else Object.values(node).forEach((n) => WMX.findCards(n, acc));
    }
    return acc;
  };
})();
