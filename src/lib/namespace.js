window.WMX = window.WMX || { features: [], RARITIES: ['L', 'UR', 'SR', 'R', 'PC', 'C'] };
WMX.register = (feature) => WMX.features.push(feature);

/**
 * Verrou partagé entre les onglets (Web Locks), utilisable sous Chrome ET Firefox : WMX.lock(nom, [options], fn) → promesse du résultat de fn.
 * Sous Firefox, un script d'extension ne peut pas passer sa propre fonction à navigator.locks : le navigateur (côté page) n'a pas le droit de lire
 * la promesse qu'elle rend (« Permission denied to access property "then" »), la demande échoue et rien ne s'exécute (la file des mises en vente
 * restait bloquée, les mises ne partaient pas). On lui donne donc une fonction et une promesse de la page (exportFunction, wrappedJSObject), qui
 * attendent fn ; le comportement est le même : attente du verrou, exclusivité, ifAvailable (fn reçoit null si le verrou est pris), steal.
 * Sans Web Locks : fn est exécutée tout de suite (comme si le verrou était obtenu).
 */
WMX.lock = function lock(name, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const L = navigator.locks;
  if (!L || typeof L.request !== 'function') return Promise.resolve().then(() => fn({ name, local: true })); // pas de Web Locks : comme si le verrou était obtenu
  // Chrome (et tout navigateur sans le cloisonnement de Firefox) : appel direct.
  if (typeof exportFunction !== 'function' || !window.wrappedJSObject) return L.request(name, opts || {}, fn);
  return new Promise((resolveOuter, rejectOuter) => {
    let result;
    let error;
    let failed = false;
    const PagePromise = window.wrappedJSObject.Promise;
    const cb = exportFunction((granted) => new PagePromise(exportFunction((done) => {
      Promise.resolve().then(() => fn(granted ? { name } : null)).then((v) => { result = v; }, (e) => { failed = true; error = e; }).finally(() => done());
    }, window)), window);
    let pr;
    try { pr = L.request(name, cloneInto(opts || {}, window), cb); } catch (e) { rejectOuter(e); return; }
    pr.then(exportFunction(() => { if (failed) rejectOuter(error); else resolveOuter(result); }, window), exportFunction((e) => {
      const err = new Error(String(e?.message || e)); // DOMException de la page (AbortError quand un autre onglet prend le verrou avec steal)
      err.name = String(e?.name || 'Error');
      rejectOuter(err);
    }, window));
  });
};
WMX.lock.available = !!(navigator.locks && typeof navigator.locks.request === 'function');
