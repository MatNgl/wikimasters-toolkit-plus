// Activité en direct : ce que l'extension fait en arrière-plan, sans qu'on le voie : pages du jeu cachées (préchargées pour miser vite), enchères surveillées,
// requêtes envoyées au jeu, et la fluidité de la page (tâches qui bloquent le défilement, images par seconde, modifications de la page).
// Le comptage des requêtes et des tâches longues tourne en permanence (très léger) ; les mesures de fluidité (images par seconde, modifications de la page)
// ne tournent que fenêtre ouverte. Ouverte depuis Paramètres → Journal d'activité → « Activité en direct ».
(() => {
  const { el } = WMX.dom;
  const A = { fetches: [], longs: [], fps: [], muts: [], mutTotal: 0 };

  const KINDS = [
    [/\/api\/marketplace\/cards\/[^/]+\/sales/, 'prix du marché'],
    [/\/api\/marketplace\/[0-9a-f-]{8,}/, 'enchères (détail)'],
    [/\/api\/marketplace/, 'enchères (listes)'],
    [/\/api\/my-collection/, 'collection'],
    [/\/api\//, 'autres requêtes du jeu'],
  ];
  const kindOf = (u) => { const s = String(u); const k = KINDS.find(([re]) => re.test(s)); return k ? k[1] : 'images et autres'; };

  // Requêtes envoyées PAR l'extension (la page du jeu a son propre fetch, que ceci ne voit pas).
  try {
    const raw = window.fetch;
    if (typeof raw === 'function') {
      window.fetch = function activityFetch(input, init) {
        try {
          const u = typeof input === 'string' ? input : (input && input.url) || String(input);
          A.fetches.push([Date.now(), kindOf(u)]);
          if (A.fetches.length > 6000) A.fetches.splice(0, 2000);
        } catch (_) { /* comptage seulement */ }
        return raw.call(this, input, init);
      };
    }
  } catch (_) { /* fetch non modifiable */ }

  // Tâches de plus de 50 ms : pendant ce temps la page ne répond pas (défilement saccadé).
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) A.longs.push([Date.now(), Math.round(e.duration)]);
      if (A.longs.length > 500) A.longs.splice(0, 200);
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) { /* mesure indisponible */ }

  const within = (arr, ms, now = Date.now()) => arr.filter((x) => now - x[0] <= ms);
  const fmtLeft = (ms) => (ms == null ? '' : ms <= 0 ? 'terminée' : ms >= 3600000 ? `${Math.floor(ms / 3600000)} h ${Math.floor((ms % 3600000) / 60000)} min` : ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.floor((ms % 60000) / 1000)} s` : `${Math.floor(ms / 1000)} s`);

  /** Toutes les mesures, sous forme de données (affichées par la fenêtre ; utilisées aussi par les tests). */
  function snapshot() {
    const now = Date.now();
    const f60 = within(A.fetches, 60000, now);
    const byKind = {};
    for (const [, k] of f60) byKind[k] = (byKind[k] || 0) + 1;
    const buckets = Array.from({ length: 30 }, () => 0); // 30 tranches de 10 s : les 5 dernières minutes
    for (const [t] of within(A.fetches, 300000, now)) buckets[29 - Math.min(29, Math.floor((now - t) / 10000))] += 1;
    const l60 = within(A.longs, 60000, now);
    const frames = A.fps.slice(-120);
    const avgMs = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : null;
    const mut = within(A.muts, 10000, now);
    return {
      fetches60: f60.length, fetches300: within(A.fetches, 300000, now).length, byKind, buckets,
      longTasks60: l60.length, longestMs: l60.length ? Math.max(...l60.map((x) => x[1])) : 0, blockedMs60: l60.reduce((a, x) => a + x[1], 0),
      frameMs: avgMs, fps: avgMs ? Math.round(1000 / avgMs) : null, slowFrames: frames.filter((x) => x > 50).length, framesSeen: frames.length,
      mutationsPerSec: mut.length ? Math.round(mut.reduce((a, x) => a + x[1], 0) / 10) : 0,
      auctions: WMX.auctions?.stats?.() || null, sheets: WMX.sheet?.frames?.() || [],
      iframes: document.querySelectorAll('iframe').length,
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  }

  // --- Fenêtre ------------------------------------------------------------------------------------
  const row = (label, value, hint, cls = '') => el('div', { class: `wmx-act-row ${cls}`, title: hint || '' }, el('span', {}, label), el('b', {}, value));
  const bars = (buckets) => {
    const max = Math.max(1, ...buckets);
    const svg = el('div', { class: 'wmx-act-spark', title: 'Requêtes envoyées au jeu par tranche de 10 s, sur les 5 dernières minutes (la plus récente à droite)' });
    svg.innerHTML = `<svg viewBox="0 0 300 40" width="100%" height="40" role="img" aria-label="Requêtes sur 5 minutes">${buckets.map((v, i) => `<rect x="${i * 10 + 1}" y="${(40 - (v / max) * 36).toFixed(1)}" width="8" height="${((v / max) * 36).toFixed(1)}" rx="1.5"/>`).join('')}</svg>`;
    return svg;
  };

  function open() {
    if (document.querySelector('.wmx-actwin')) return;
    const body = el('div', { class: 'wmx-modal-body wmx-act-body' });
    // Mesures de fluidité : seulement fenêtre ouverte (images par seconde, modifications de la page).
    let raf = 0;
    let last = performance.now();
    const loop = (t) => { A.fps.push(Math.round(t - last)); last = t; if (A.fps.length > 400) A.fps.splice(0, 200); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    let mo = null;
    try {
      let tick = 0;
      mo = new MutationObserver((ms) => { tick += ms.length; });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      A.mutTimer = setInterval(() => { A.muts.push([Date.now(), tick]); tick = 0; if (A.muts.length > 60) A.muts.splice(0, 30); }, 1000);
    } catch (_) { /* mesure indisponible */ }

    const render = () => {
      const s = snapshot();
      const a = s.auctions;
      const parts = [];
      // 1) Pages cachées
      const hidden = [...(a?.frames || []).map((f) => ({ what: `Enchère « ${f.title} »`, state: f.over ? 'au-dessus du plafond' : f.ready ? 'prête à miser' : 'chargement', left: f.msLeft })),
        ...s.sheets.filter((x) => x.open).map((x) => ({ what: x.kind === 'work' ? 'Collection (mises en vente, étiquettes)' : 'Collection (fiches de cartes)', state: x.visible ? 'affichée' : 'cachée', left: null }))];
      parts.push(el('section', {}, el('h4', {}, `Pages du jeu cachées : ${hidden.length}`),
        el('p', { class: 'wmx-act-note' }, 'Pages du jeu chargées en arrière-plan : elles permettent de miser dès la dernière seconde et de piloter les ventes. Chacune consomme de la mémoire et du temps de calcul dans cet onglet.'),
        ...(hidden.length ? hidden.map((h) => row(h.what, `${h.state}${h.left != null ? ` · finit dans ${fmtLeft(h.left)}` : ''}`)) : [el('p', { class: 'wmx-jempty' }, 'Aucune page cachée pour le moment.')]),
        a ? row('Maximum d’enchères préchargées', `${a.maxFrames}`, 'Au-delà, la page de l’enchère qui finit le plus tard (ou celle au-dessus de votre plafond) est libérée.') : '',
        row('Cadres (iframes) dans la page', `${s.iframes}`, 'Tous les cadres de la page, y compris d’éventuels cadres du jeu lui-même.')));
      // 2) Surveillances et mises
      if (a) {
        parts.push(el('section', {}, el('h4', {}, 'Surveillances et mises automatiques'),
          row('Enchères surveillées', `${a.watching}`, 'Cartes sur lesquelles vous n’avez pas misé : l’extension miserait au dernier moment.'),
          row('  dont dans leur dernière minute', `${a.watchNear}`, 'Relues toutes les 2,5 s et leur page est préchargée.'),
          row('  dont au-dessus de votre plafond', `${a.watchOver}`, 'Gardées à l’œil sans urgence : pas de page préchargée, relues toutes les 30 s.'),
          row('Mises automatiques réglées (enchères où vous avez misé)', `${a.autoRules}`),
          row('Mises en cours maintenant', a.flying.length ? a.flying.join(', ') : 'aucune', `Jusqu’à ${a.maxPar} en parallèle.`),
          row('Mises manuelles en file', `${a.queued}`),
          row('Cet onglet pilote les mises automatiques', a.leader ? 'oui' : 'non (un autre onglet du jeu le fait)', 'Un seul onglet agit à la fois : celui qui est affiché.'),
          row('Relecture de vos enchères', a.pollMs ? `toutes les ${a.pollMs >= 1000 ? `${Math.round(a.pollMs / 1000)} s` : `${a.pollMs} ms`}` : '—', 'Plus rapide quand une enchère approche du moment de miser.')));
      }
      // 3) Requêtes
      const kinds = Object.entries(s.byKind).sort((x, y) => y[1] - x[1]);
      parts.push(el('section', {}, el('h4', {}, `Requêtes envoyées au jeu : ${s.fetches60} sur la dernière minute`),
        bars(s.buckets),
        ...(kinds.length ? kinds.map(([k, n]) => row(k, `${n}`)) : [el('p', { class: 'wmx-jempty' }, 'Aucune requête sur la dernière minute.')]),
        row('Sur les 5 dernières minutes', `${s.fetches300}`)));
      // 4) Fluidité
      const bad = s.longTasks60 > 5 || (s.fps != null && s.fps < 40);
      parts.push(el('section', {}, el('h4', {}, 'Fluidité de la page'),
        row('Images par seconde', s.fps == null ? 'mesure en cours…' : `${s.fps} (idéal : 60)`, 'Mesurée tant que cette fenêtre est ouverte.', s.fps != null && s.fps < 40 ? 'warn' : ''),
        row('Images lentes (plus de 50 ms)', s.framesSeen ? `${s.slowFrames} sur ${s.framesSeen}` : '—', 'Chacune est un à-coup visible.', s.slowFrames > 5 ? 'warn' : ''),
        row('Tâches qui bloquent la page (> 50 ms), dernière minute', `${s.longTasks60}`, 'Pendant une tâche longue, le défilement et les clics ne répondent plus.', s.longTasks60 > 5 ? 'warn' : ''),
        row('  la plus longue / temps total bloqué', s.longTasks60 ? `${s.longestMs} ms / ${s.blockedMs60} ms` : '—'),
        row('Modifications de la page par seconde', s.mutationsPerSec ? `${s.mutationsPerSec}` : 'mesure en cours…', 'Surtout les comptes à rebours du jeu (une modification par carte et par seconde).'),
        s.heapMb != null ? row('Mémoire utilisée par l’extension et la page', `${s.heapMb} Mo`) : '',
        bad ? el('p', { class: 'wmx-act-note warn' }, 'La page est chargée : fermez des pages cachées (supprimez des surveillances), ou fermez cette fenêtre, qui mesure en continu.') : ''));
      body.replaceChildren(...parts);
    };
    render();
    const timer = setInterval(() => { if (!back.isConnected) close(); else render(); }, 1000);
    function close() {
      clearInterval(timer); clearInterval(A.mutTimer); cancelAnimationFrame(raf);
      try { mo?.disconnect(); } catch (_) { /* déjà arrêté */ }
      back.remove();
    }
    const back = el('div', { class: 'wmx-modal-backdrop wmx-actwin', onmousedown: (e) => { if (e.target === back) close(); } },
      el('div', { class: 'wmx-modal', role: 'dialog', 'aria-label': 'Activité en direct' },
        el('header', {}, el('div', {}, el('h2', {}, 'Activité en direct'), el('p', {}, 'Ce que l’extension fait en arrière-plan, mis à jour chaque seconde.')), el('button', { class: 'wmx-close', title: 'Fermer', onclick: close }, '×')),
        body,
        el('footer', {}, el('span', {}, 'Les mesures de fluidité ne tournent que fenêtre ouverte.'), el('div', {}, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Fermer')))));
    document.body.append(back);
  }

  WMX.activity = { open, snapshot };
})();
