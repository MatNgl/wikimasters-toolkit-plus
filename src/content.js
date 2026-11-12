// Amorçage : lance les features selon la route, y compris lors des navigations SPA (Next.js).
(() => {
  const started = new Set();
  const run = () => {
    document.documentElement.dataset.wmxRoute = location.pathname; // permet de masquer le panneau hors /pulls
    for (const f of WMX.features) {
      if (started.has(f.name)) continue;
      if (f.match && !f.match.test(location.pathname)) continue;
      started.add(f.name);
      try { f.init(); } catch (e) { console.warn('[WMX]', f.name, e); }
    }
  };
  run();
  // Deux copies de l'extension actives dans Chrome (par ex. celle du Chrome Web Store et celle de développement) : chacune a sa propre mémoire
  // (prix, réglages), d'où deux barres de prix aux chiffres différents, et des actions faites deux fois (assistant de vente, mises automatiques).
  // Chaque copie signe la page ; une copie qui voit une autre signature prévient l'utilisateur (une fois).
  const myId = (() => { try { return chrome.runtime.id; } catch (_) { return ''; } })();
  let warnedTwin = false;
  const checkTwin = () => {
    const root = document.documentElement;
    const ids = new Set(String(root.dataset.wmxCopies || '').split(',').filter(Boolean));
    if (myId && !ids.has(myId)) { ids.add(myId); root.dataset.wmxCopies = [...ids].join(','); }
    WMX.twin = ids.size > 1 || !!WMX.twinBar; // ou barre de prix posée par une autre copie (anciennes versions : sans signature)
    if (WMX.twin && !warnedTwin) {
      warnedTwin = true;
      WMX.journal?.add('Extension', 'Deux copies de WikiMasters Toolkit+ sont actives dans Chrome', 'warn');
      WMX.notify?.({ kind: 'warn', key: 'twin', ms: 0, title: 'Deux copies de l’extension sont actives',
        text: 'WikiMasters Toolkit+ est installée deux fois dans Chrome (par exemple la version du Chrome Web Store et une version de développement). Chacune a ses propres prix et réglages : la valeur estimée s’affiche en double, et l’assistant de vente ou les mises automatiques peuvent agir deux fois. Ouvrez chrome://extensions et désactivez l’une des deux.' });
    }
  };
  setTimeout(checkTwin, 1500);
  setInterval(checkTwin, 10000);
  setInterval(() => { // attribut remis si le jeu réinitialise <html> après le chargement
    if (WMX.alive?.() && document.documentElement.dataset.wmxRoute !== location.pathname) document.documentElement.dataset.wmxRoute = location.pathname;
  }, 1000);
  let last = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== last) { last = location.pathname; run(); }
  }).observe(document.body, { childList: true, subtree: true });
})();
