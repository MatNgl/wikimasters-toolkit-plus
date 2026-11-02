// Fiche d'une carte SANS quitter l'écran : on charge la Collection du jeu dans un cadre invisible (même origine),
// on y cherche la carte et on y ouvre la VRAIE fiche du jeu (étiquettes, mise aux enchères, défausse…), qu'on affiche
// seule par-dessus l'écran en cours. Rien n'est envoyé par l'extension : elle tape dans la recherche du jeu et clique.
//
// Deux cadres indépendants, pour que l'un ne retarde jamais l'autre :
//   « view » : affichage des fiches (doit rester instantané) ;
//   « work » : automatisation des enchères rapides (file d'attente, voir quick-auction.js).
// Chargés une seule fois (≈ 20 s à froid), puis gardés prêts jusqu'à 15 min sans utilisation.
(() => {
  const { el, sleep, waitFor } = WMX.dom;
  const IDLE_MS = 15 * 60000;
  const KINDS = ['view', 'work'];
  const F = Object.fromEntries(KINDS.map((k) => [k, { frame: null, ready: null, chain: Promise.resolve() }]));
  let toastTimer = null;
  let lastUse = Date.now();

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function toast(text, ms = 4500) {
    document.querySelector('.wmx-toast')?.remove();
    clearTimeout(toastTimer);
    if (!text) return;
    const t = el('div', { class: 'wmx-toast' }, text);
    document.body.append(t);
    toastTimer = setTimeout(() => t.remove(), ms);
  }
  WMX.toast = toast;

  const searchBox = (d) => [...d.querySelectorAll('input')].find((i) => /recherch/i.test(i.placeholder || ''));

  /** Le cadre est vraiment prêt quand la LISTE de cartes du jeu est affichée (« Page 1 / N »), pas seulement la barre de recherche. */
  const listReady = (frame) => {
    try { const d = frame.contentDocument; return !!(d && searchBox(d) && /Page \d+\s*\/\s*\d+/.test(d.body.innerText)); } catch (_) { return false; }
  };

  /** Charge (une seule fois) la Collection dans un cadre invisible. */
  WMX.prepareCardSheets = function prepare(kind = 'view') {
    lastUse = Date.now();
    const s = F[kind];
    if (s.frame) return s.ready;
    s.frame = el('iframe', { class: `wmx-sheet-frame wmx-${kind}`, src: '/collection', title: 'Fiche de carte', tabindex: '-1' });
    document.body.append(s.frame);
    const frame = s.frame;
    s.ready = waitFor(() => listReady(frame), 180000, 400).then((ok) => !!ok);
    return s.ready;
  };

  /** Libère un cadre (ou tous) : la Collection chargée est lourde. */
  WMX.releaseCardSheets = function release(kind) {
    for (const k of kind ? [kind] : KINDS) { F[k].frame?.remove(); F[k].frame = null; F[k].ready = null; }
  };

  // Les cadres inutilisés depuis 15 min sont libérés.
  setInterval(() => {
    if (!WMX.alive()) return;
    if (Date.now() - lastUse > IDLE_MS && !F.view.frame?.classList.contains('wmx-on') && !WMX.quick?.isRunning?.()) WMX.releaseCardSheets();
  }, 60000);

  /** Saisie compatible React puis Entrée, comme un utilisateur. */
  function search(d, w, text) {
    const input = searchBox(d);
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    input.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new w.KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
  }

  /** Tuile de carte dont le titre correspond ; à titre égal on préfère la même rareté. */
  function findTile(d, card) {
    const title = norm(card.wikipedia_title);
    const want = WMX.normRarity(card.rarity);
    const tiles = [];
    for (const leaf of d.querySelectorAll('*')) {
      if (leaf.children.length || norm(leaf.textContent) !== title) continue;
      let t = leaf;
      for (let i = 0; i < 8 && t; i++) {
        const r = t.getBoundingClientRect();
        if (r.width > 130 && r.width < 240 && r.height > 170) break;
        t = t.parentElement;
      }
      if (t && !tiles.includes(t)) tiles.push(t);
    }
    return tiles.find((t) => new RegExp(`^\\s*${want}\\b`).test(t.innerText || '')) || tiles[0] || null;
  }

  /** Racine (position fixe) de la fiche ouverte dans le cadre, ou null. */
  function sheetRoot(d, w) {
    const b = [...d.querySelectorAll('button, a')].find((x) => /Mettre aux enchères|Défausser|Voir l.article/i.test(x.textContent));
    let m = b;
    while (m && w.getComputedStyle(m).position !== 'fixed') m = m.parentElement;
    return m || null;
  }

  /** Ferme la fiche du jeu comme le ferait l'utilisateur : bouton « Fermer », sinon touche Échap dans le cadre. */
  function closeSheet(kind = 'view') {
    try {
      const frame = F[kind].frame;
      const d = frame.contentDocument;
      const w = frame.contentWindow;
      const root = sheetRoot(d, w);
      if (!root) return;
      const x = [...root.querySelectorAll('button')].find((b) => /^[×✕x]$/i.test(b.textContent.trim()) || /fermer|close/i.test(b.getAttribute('aria-label') || ''));
      if (x) x.click();
      else for (const t of ['keydown', 'keyup']) d.dispatchEvent(new w.KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    } catch (_) { /* cadre libéré */ }
  }
  // Échap pressé dans la page (et non dans le cadre) ferme aussi la fiche affichée.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && F.view.frame?.classList.contains('wmx-on')) { e.stopPropagation(); closeSheet('view'); }
  }, true);

  // Changer de page du jeu (ex. clic sur « Marché ») pendant qu'une fiche s'ouvre ou est affichée : on la ferme proprement.
  let routeGen = 0;
  new MutationObserver(() => {
    routeGen += 1;
    if (F.view.frame?.classList.contains('wmx-on')) closeSheet('view');
    toast('');
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wmx-route'] });

  /** Cherche la carte dans le cadre et ouvre sa fiche (sans l'afficher). Renvoie { d, w, root } ou { error }. */
  async function openInFrame(card, kind = 'view') {
    lastUse = Date.now();
    const ok = await WMX.prepareCardSheets(kind);
    if (!ok) return { error: 'frame' };
    const frame = F[kind].frame;
    if (!frame) return { error: 'frame' };
    const d = frame.contentDocument;
    const w = frame.contentWindow;
    search(d, w, card.wikipedia_title);
    // La recherche relance un chargement : on laisse la liste se mettre à jour, puis on repère la carte.
    const tile = await waitFor(() => findTile(d, card), 15000, 150);
    if (!tile) return { error: 'notfound' };
    await sleep(120);
    tile.click();
    const root = await waitFor(() => sheetRoot(d, w), 6000, 80);
    if (!root) return { error: 'nosheet' };
    return { d, w, root };
  }

  WMX.sheet = {
    openInFrame,
    closeSheet,
    /** Exécute `fn` quand le cadre `kind` est libre (les opérations d'un même cadre ne se mélangent pas). */
    exclusive(fn, kind = 'view') {
      const s = F[kind];
      const run = s.chain.then(fn, fn);
      s.chain = run.catch(() => {});
      return run;
    },
  };

  const ERRORS = {
    frame: 'Impossible de charger la fiche pour le moment.',
    notfound: 'Carte introuvable dans la recherche du jeu.',
    nosheet: 'La fiche ne s’est pas ouverte.',
  };

  /** Affiche la fiche du jeu par-dessus l'écran en cours. */
  WMX.openCardDetail = function openCardDetail(card) {
    return WMX.sheet.exclusive(async () => {
      // Premier chargement à froid : on l'explique au lieu de laisser croire à un blocage.
      const gen = routeGen;
      const cold = !F.view.frame;
      const slow = setTimeout(() => toast(cold ? 'Préparation de la fiche… la première ouverture charge la collection du jeu (jusqu’à ~30 s).' : 'Chargement de la fiche…', 90000), cold ? 600 : 1500);
      let r;
      try { r = await openInFrame(card, 'view'); } finally { clearTimeout(slow); }
      toast('');
      if (gen !== routeGen) { if (!r.error) closeSheet('view'); return undefined; } // l'utilisateur a changé de page entre-temps
      if (r.error) return toast(ERRORS[r.error] || 'Fiche indisponible.');
      const { d, w, root } = r;
      const frame = F.view.frame;

      // Seule la fiche reste visible ; le reste du cadre devient invisible et transparent.
      if (!d.getElementById('wmx-sheet-style')) {
        const st = d.createElement('style');
        st.id = 'wmx-sheet-style';
        st.textContent = 'html{visibility:hidden!important;background:transparent!important} body{background:transparent!important} .wmx-keep,.wmx-keep *{visibility:visible!important} .fixed.inset-0,.fixed.inset-0 *{visibility:visible!important}';
        d.head.append(st);
      }
      root.classList.add('wmx-keep');
      frame.classList.add('wmx-on');
      w.focus();

      // Fermeture de la fiche (croix, Échap, clic à côté) : on masque le cadre.
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          let open = false;
          try { open = !!(F.view.frame && sheetRoot(F.view.frame.contentDocument, F.view.frame.contentWindow)); } catch (_) { /* cadre libéré */ }
          if (!open) { clearInterval(iv); F.view.frame?.classList.remove('wmx-on'); window.focus(); lastUse = Date.now(); resolve(); }
        }, 200);
      });
    }, 'view');
  };
})();
