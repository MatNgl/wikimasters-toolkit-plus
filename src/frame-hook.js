// Tourne dans le monde MAIN, au tout début du chargement, dans TOUS les cadres du jeu. Il n'agit que dans les cadres
// créés par l'extension pour annuler une enchère (adresse marquée « #wmx-auto ») : les alertes de confirmation du jeu
// (« Annuler cette enchère et récupérer votre carte ? ») y répondent « oui » d'elles-mêmes. Il note aussi, pour le journal,
// la réponse du serveur aux requêtes d'écriture du cadre (la mise en vente) : le script de l'extension la lit dans
// <html data-wmx-net>. Rien ne change dans la page principale, ni dans les autres cadres.
(() => {
  if (window === window.top || !location.hash.includes('wmx-auto')) return;
  window.confirm = () => true;
  window.alert = () => {};
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
  window.fetch = function wmxFetch(input, init) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'GET') return realFetch.apply(this, arguments);
    let path = '';
    try { path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname; } catch (_) { /* adresse illisible */ }
    return realFetch.apply(this, arguments).then(
      (res) => {
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
