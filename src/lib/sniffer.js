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

  // Débuts d'appels /api/* récents (chemin + heure), pour détecter un clic qui n'a rien déclenché.
  WMX.apiStarts = [];
  window.addEventListener('wmx:start', (e) => {
    WMX.apiStarts.push({ path: new URL(e.detail.url, location.origin).pathname, t: Date.now() });
    if (WMX.apiStarts.length > 60) WMX.apiStarts.shift();
  });

  window.addEventListener('wmx:api', async (e) => {
    const { url, method, status, data, req } = e.detail;
    const path = new URL(url, location.origin).pathname;
    // Les fonctions sont prévenues TOUT DE SUITE, pendant l'événement : la page du jeu relit sa liste juste après une écriture (étiquette,
    // favori, défausse) ; servie par la vue étendue, cette relecture doit déjà voir la copie à jour (avant : après l'enregistrement de la
    // forme ci-dessous, trop tard : les cartes étiquetées restaient dans « Sans étiquette »).
    listeners.forEach((cb) => { try { cb({ url, path, method, status, data, req }); } catch (_) {} }); // req : corps envoyé (écritures)
    try { // après coup, sans retenir les fonctions : la page a pu être fermée entre-temps
      const shapes = await WMX.store.get('apiShapes', {});
      // On ne garde que la FORME (clés et types), jamais les valeurs ; `request` = forme du corps envoyé.
      shapes[`${method} ${path}`] = { status, shape: shapeOf(data), request: req ? shapeOf(req) : undefined, seen: Date.now() };
      await WMX.store.set('apiShapes', shapes);
      document.documentElement.dataset.wmxShapes = JSON.stringify(shapes); // debug : lisible depuis la page
    } catch (_) { /* page fermée */ }
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
