// Fiche d'une carte SANS quitter l'écran : on charge la Collection du jeu dans un cadre invisible (même origine),
// on y cherche la carte et on y ouvre la VRAIE fiche du jeu (étiquettes, mise aux enchères, défausse…), qu'on affiche
// seule par-dessus l'écran en cours. Le même cadre sert à l'enchère rapide (voir quick-auction.js), sans l'afficher.
// Rien n'est envoyé par l'extension elle-même : elle tape dans la recherche du jeu et clique, comme l'utilisateur.
(() => {
  const { el, sleep, waitFor } = WMX.dom;
  let frame = null;
  let ready = null;
  let toastTimer = null;
  let chain = Promise.resolve(); // une seule opération à la fois sur le cadre

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

  /** Charge (une seule fois) la Collection dans un cadre invisible. */
  WMX.prepareCardSheets = function prepare() {
    if (frame) return ready;
    frame = el('iframe', { class: 'wmx-sheet-frame', src: '/collection', title: 'Fiche de carte', tabindex: '-1' });
    document.body.append(frame);
    ready = waitFor(() => {
      try { const d = frame.contentDocument; return !!(d && searchBox(d)); } catch (_) { return false; }
    }, 120000, 400).then((ok) => !!ok);
    return ready;
  };

  /** Libère le cadre (la Collection chargée est lourde). */
  WMX.releaseCardSheets = function release() {
    frame?.remove();
    frame = null; ready = null;
  };

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
  function closeSheet() {
    try {
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
    if (e.key === 'Escape' && frame?.classList.contains('wmx-on')) { e.stopPropagation(); closeSheet(); }
  }, true);

  /** Cherche la carte dans le cadre et ouvre sa fiche (sans l'afficher). Renvoie { d, w, root } ou { error }. */
  async function openInFrame(card) {
    const ok = await WMX.prepareCardSheets();
    if (!ok) return { error: 'frame' };
    const d = frame.contentDocument;
    const w = frame.contentWindow;
    search(d, w, card.wikipedia_title);
    const tile = await waitFor(() => findTile(d, card), 12000, 250);
    if (!tile) return { error: 'notfound' };
    await sleep(250);
    tile.click();
    const root = await waitFor(() => sheetRoot(d, w), 6000, 100);
    if (!root) return { error: 'nosheet' };
    return { d, w, root };
  }

  WMX.sheet = {
    openInFrame,
    closeSheet,
    /** Exécute `fn` quand le cadre est libre (affichage de fiche et enchère rapide ne se mélangent pas). */
    exclusive(fn) {
      const run = chain.then(fn, fn);
      chain = run.catch(() => {});
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
      toast('Chargement de la fiche…', 60000);
      const r = await openInFrame(card);
      if (r.error) return toast(ERRORS[r.error] || 'Fiche indisponible.');
      const { d, w, root } = r;

      // Seule la fiche reste visible ; le reste du cadre devient invisible et transparent.
      if (!d.getElementById('wmx-sheet-style')) {
        const st = d.createElement('style');
        st.id = 'wmx-sheet-style';
        st.textContent = 'html{visibility:hidden!important;background:transparent!important} body{background:transparent!important} .wmx-keep,.wmx-keep *{visibility:visible!important}';
        d.head.append(st);
      }
      root.classList.add('wmx-keep');
      frame.classList.add('wmx-on');
      w.focus();
      toast('');

      // Fermeture de la fiche (croix, Échap, clic à côté) : on masque le cadre.
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          let open = false;
          try { open = !!(frame && sheetRoot(frame.contentDocument, frame.contentWindow)); } catch (_) { /* cadre libéré */ }
          if (!open) { clearInterval(iv); frame?.classList.remove('wmx-on'); window.focus(); resolve(); }
        }, 250);
      });
    });
  };
})();
