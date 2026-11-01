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
  let last = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== last) { last = location.pathname; run(); }
  }).observe(document.body, { childList: true, subtree: true });
})();
