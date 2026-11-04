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

  const home = (kind) => (kind === 'work' ? '/collection#wmx-auto' : '/collection'); // le cadre d'automatisation garde sa marque #wmx-auto
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // --- Notifications : pile en bas à droite, au-dessus de la file d'attente --------------------------------------------------
  // Temporaires (info, ok, warn) : disparaissent seules, un petit anneau se vide pour le montrer. Alertes (kind « alert », ou sticky) : rouges,
  // elles restent jusqu'à la croix (vérification humaine demandée, limite du site…). Même clé = la notification est remplacée, pas empilée.
  const NOTE_MAX = 5;
  const notes = new Map(); // clé -> { node, timer }
  let noteBox = null;
  let noteSeq = 0;
  function dismissNote(key) {
    const n = notes.get(key);
    if (!n) return;
    clearTimeout(n.timer);
    n.node.classList.add('leaving');
    setTimeout(() => n.node.remove(), 180);
    notes.delete(key);
  }
  const ringSvg = (ms) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('class', 'wmx-note-ring'); svg.style.setProperty('--ms', `${ms}ms`);
    svg.innerHTML = '<circle cx="10" cy="10" r="7" class="bg"/><circle cx="10" cy="10" r="7" class="fg" pathLength="100"/>';
    return svg;
  };
  /** kind : info | ok | warn | alert. title : ligne en gras (facultative). action : { label, onClick } bouton dans la notification. */
  function notify({ text, title = '', kind = 'info', ms = 5000, key = '', sticky = false, action = null }) {
    if (!text) return undefined;
    if (!noteBox?.isConnected) { noteBox = el('div', { class: 'wmx-notes' }); document.body.append(noteBox); }
    key = key || `n${++noteSeq}`;
    if (notes.has(key)) { clearTimeout(notes.get(key).timer); notes.get(key).node.remove(); notes.delete(key); }
    const persistent = sticky || kind === 'alert';
    const close = el('button', { class: 'wmx-note-x', title: 'Fermer', 'aria-label': 'Fermer', onclick: () => dismissNote(key) }, '×');
    const act = action ? el('button', { class: 'wmx-note-act', onclick: () => { try { action.onClick(); } finally { dismissNote(key); } } }, action.label) : '';
    const node = el('div', { class: `wmx-note ${kind}`, role: kind === 'alert' ? 'alert' : 'status' },
      el('div', { class: 'wmx-note-body' }, title ? el('b', {}, title) : '', el('span', {}, text), act),
      persistent ? close : el('div', { class: 'wmx-note-side' }, ringSvg(ms), close));
    noteBox.append(node);
    const entry = { node, timer: persistent ? null : setTimeout(() => dismissNote(key), ms) };
    notes.set(key, entry);
    // Trop de notifications : on retire les plus anciennes qui ne sont pas des alertes.
    for (const [k, n] of notes) { if (notes.size <= NOTE_MAX) break; if (!n.node.classList.contains('alert')) dismissNote(k); }
    return key;
  }
  const guessKind = (t) => (/échec|impossible|introuvable|refus|bloqu|limite|n’est pas confirmée|ne s’est pas|erreur|trop de|invalide|sans effet/i.test(t) ? 'warn'
    : /placée|réussie|terminée?|lancée|annulée|mis à jour|copié|remis à zéro|menez/i.test(t) ? 'ok' : 'info');
  /** Ancienne interface : WMX.toast(texte, durée en ms, { key, kind, title }). */
  function toast(text, ms = 5000, opts = {}) { return notify({ text, ms: ms || 5000, kind: opts.kind || guessKind(String(text || '')), key: opts.key, title: opts.title }); }
  WMX.toast = toast;
  WMX.notify = notify;
  WMX.dismissNote = dismissNote;

  /** Un refus du jeu (403/429, vérification humaine, limite d'automatisation) expliqué en clair ; `raw` = message du jeu ou réponse notée dans le cadre. */
  WMX.explainRefusal = function explainRefusal(raw) {
    const s = String(raw || '');
    const said = (s.match(/«\s*([^»]{3,160}?)\s*»/) || [])[1];
    const quote = said ? ` Le jeu dit : « ${said} »` : '';
    if (/v[ée]rification|humain|captcha|turnstile|challenge/i.test(s)) return { title: 'Vérification humaine demandée', text: `Le jeu veut s’assurer que vous êtes une personne. Faites la vérification affichée sur la page du jeu : l’extension reprendra ensuite.${quote}` };
    if (/automatis|trop de requêtes|règlement/i.test(s)) return { title: 'Limite du site atteinte', text: `Le jeu juge qu’il y a trop de requêtes automatisées. Évitez de cliquer en rafale : l’extension fait une pause, puis réessaie de plus en plus espacé.${quote}` };
    return { title: 'Le jeu refuse la requête', text: `Le jeu a refusé la demande (erreur 403 ou 429). L’extension fait une pause, puis réessaie.${quote}` };
  };

  // Messages affichés par le jeu lui-même (bandeau en haut : « trop de requêtes », vérification humaine…) : on les reprend, rouges et
  // persistants, avec ce qu'il faut faire. Seuls les éléments « notification » du jeu sont lus (jamais le texte des cartes).
  const GAME_NOTICE = /trop de requêtes|automatis|vérification|v[ée]rifi\w* (que )?vous|captcha|turnstile|êtes (bien )?un(e)? (humain|personne)/i;
  const NOTICE_SEL = '[role="alert"], [role="status"], [data-sonner-toast], [class*="toast" i], [aria-live]';
  function watchGameNotices() {
    try {
      const seen = (n) => {
        if (n.nodeType !== 1 || n.closest?.('.wmx-notes, .wmx-bubble, .wmx-qchip, .wmx-panel, .wmx-modal-backdrop, .wmx-sheet-frame')) return; // pas <html> : il porte des classes wmx-
        const holder = n.matches?.(NOTICE_SEL) ? n : (n.childElementCount <= 30 ? n.querySelector?.(NOTICE_SEL) : null); // pas de parcours des gros rendus (listes de cartes)
        const text = (holder?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 400 || !GAME_NOTICE.test(text)) return;
        const e = WMX.explainRefusal(text);
        // Tant que le jeu affiche ce message, les fonctions automatiques attendent (5 min au moins).
        WMX.gameBlockedUntil = Math.max(WMX.gameBlockedUntil || 0, Date.now() + 5 * 60000);
        WMX.store.set('gameBlockedUntil', WMX.gameBlockedUntil);
        notify({ kind: 'alert', key: 'game-notice', title: e.title, text: `${e.text.replace(/ Le jeu dit : .*$/, '')} Le jeu dit : « ${text.slice(0, 160)} »`, action: {
          label: 'C’est fait : reprendre',
          onClick: () => { WMX.gameBlockedUntil = 0; WMX.gameBlockN = 0; WMX.store.set('gameBlockedUntil', 0); WMX.store.set('gameBlockN', 0); WMX.autoSell?.runNow?.(); } } });
      };
      new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(seen); }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* page sans DOM */ }
  }
  watchGameNotices();

  // Gestion des erreurs : message lisible (au plus un par domaine toutes les 30 s), trace dans la console et mémoire des 30 derniers.
  const lastShown = {};
  WMX.reportError = function reportError(scope, status, detail = '') {
    const msg = WMX.logic.friendlyError(status);
    console.warn(`[WMX] ${scope}`, status, detail);
    WMX.store.get('errorLog', []).then((log) => {
      log.push({ t: Date.now(), scope, status, detail: String(detail).slice(0, 200) });
      WMX.store.set('errorLog', log.slice(-30));
    });
    if (Date.now() - (lastShown[scope] || 0) < 30000) return;
    lastShown[scope] = Date.now();
    if (status === 403 || status === 429) { const e = WMX.explainRefusal(`${status} ${detail}`); notify({ kind: 'alert', key: 'game-limit', title: e.title, text: e.text }); return; }
    toast(msg + (detail ? ` (${detail})` : ''), 7000, { kind: 'warn' });
  };

  const searchBox = (d) => [...d.querySelectorAll('input')].find((i) => /recherch/i.test(i.placeholder || ''));

  /** Le cadre est vraiment prêt quand la LISTE de cartes du jeu est affichée (« Page 1 / N »), pas seulement la barre de recherche. */
  const listReady = (frame) => {
    try {
      const d = frame.contentDocument;
      if (!d || !searchBox(d)) return false;
      const txt = d.body.innerText;
      // Quand la recherche ne renvoie qu'une page, le jeu masque « Page 1 / N » : des cartes affichées (ou « aucune carte ») suffisent.
      return /Page \d+\s*\/\s*\d+/.test(txt) || /Aucune carte|Aucun résultat/i.test(txt) || d.querySelectorAll('img').length >= 1;
    } catch (_) { return false; }
  };

  /** Charge (une seule fois) la Collection dans un cadre invisible. */
  WMX.prepareCardSheets = function prepare(kind = 'view') {
    lastUse = Date.now();
    const s = F[kind];
    if (s.frame) return s.ready;
    // Le cadre d'automatisation porte la marque #wmx-auto : les confirmations natives du jeu (défausse…) y sont acceptées (frame-hook.js).
    s.frame = el('iframe', { class: `wmx-sheet-frame wmx-${kind}`, src: kind === 'work' ? '/collection#wmx-auto' : '/collection', title: 'Fiche de carte', tabindex: '-1' });
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
    if (!input) throw new Error('barre de recherche de la collection introuvable');
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
    let b = [...d.querySelectorAll('button, a')].find((x) => /Mettre aux enchères|Défausser|Voir l.article/i.test(x.textContent));
    // Onglet « Marché » de la fiche : les boutons ci-dessus n'y sont plus affichés, mais les onglets « Détails » / « Marché » oui.
    if (!b) b = [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Détails' && [...(x.parentElement?.children || [])].some((s) => s.textContent.trim() === 'Marché'));
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

  /**
   * Remet le cadre sur la liste de la Collection. Après une mise en vente réussie, le jeu ouvre la page de l'enchère créée
   * (/marketplace/{id}) DANS le cadre : sans ce retour, l'opération suivante ne trouve plus la barre de recherche.
   */
  async function ensureCollection(kind) {
    const frame = F[kind].frame;
    const onList = () => { try { return frame.contentWindow.location.pathname === '/collection' && listReady(frame); } catch (_) { return false; } };
    if (onList()) return true;
    try { // navigation interne du jeu (rapide) : on clique « Collection » dans le cadre
      const link = frame.contentDocument.querySelector('nav a[href="/collection"]');
      if (link) link.click(); else frame.contentWindow.location.href = home(kind);
    } catch (_) { frame.src = home(kind); }
    if (await waitFor(onList, 20000, 200)) return true;
    frame.src = home(kind); // dernier recours : rechargement complet du cadre
    return !!(await waitFor(onList, 120000, 400));
  }

  /** Cherche la carte dans le cadre et ouvre sa fiche (sans l'afficher). Renvoie { d, w, root } ou { error }. */
  async function openInFrame(card, kind = 'view') {
    lastUse = Date.now();
    const ok = await WMX.prepareCardSheets(kind);
    if (!ok) return { error: 'frame' };
    const frame = F[kind].frame;
    if (!frame) return { error: 'frame' };
    if (!(await ensureCollection(kind))) return { error: 'frame' };
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
  /**
   * Aperçu immédiat pendant que la vraie fiche du jeu se charge (le jeu peut mettre 20 s et plus à répondre) : titre, rareté,
   * illustration, et un état de chargement. Il n'apparaît qu'après 250 ms (rien à l'écran quand la fiche s'ouvre tout de suite)
   * et se ferme par × / Échap / clic à côté : la fiche ne s'ouvre alors pas.
   */
  function showPreview(card, onCancel) {
    let node = null;
    const timer = setTimeout(() => {
      const rar = WMX.normRarity(card.rarity) || 'C';
      const art = el('div', { class: 'wmx-pre-art' });
      const close = () => { onCancel(); remove(); };
      node = el('div', { class: 'wmx-pre-back', onmousedown: (e) => { if (e.target === node) close(); } },
        el('div', { class: 'wmx-pre', style: `--rgb:${WMX.RARITY_RGB?.[rar] || '160 175 168'}` },
          el('button', { class: 'wmx-close', title: 'Annuler', onclick: close }, '×'),
          art,
          el('div', { class: 'wmx-pre-title' }, el('b', {}, rar), el('strong', {}, card.wikipedia_title || '?')),
          el('div', { class: 'wmx-pre-load' }, el('i'), el('span', {}, 'Chargement de la fiche du jeu…'))));
      document.body.append(node);
      WMX.loadCardInfo?.(card).then((i) => { if (i?.img && node?.isConnected) WMX.dom.artLayers(i.img, art); });
    }, 250);
    const remove = () => { clearTimeout(timer); node?.remove(); node = null; };
    return { remove, isOpen: () => !!node };
  }
  let preview = null;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && preview?.isOpen()) { e.stopPropagation(); preview.cancel(); } }, true);

  const asked = new Set(); // cartes dont la fiche est demandée, en cours d'ouverture ou affichée
  let lastAsked = null;    // dernière carte cliquée : si on clique ailleurs pendant un chargement, c'est elle qui s'ouvre
  WMX.openCardDetail = function openCardDetail(card) {
    const key = `${card.wikipedia_title}|${card.rarity}`;
    if (asked.has(key)) return undefined; // clics répétés sur la même carte : une seule ouverture
    asked.add(key);
    lastAsked = key;
    return WMX.sheet.exclusive(async () => {
      if (lastAsked !== key) return undefined; // une autre carte a été cliquée depuis : celle-ci est abandonnée
      // Premier chargement à froid : on l'explique au lieu de laisser croire à un blocage.
      const gen = routeGen;
      let cancelled = false;
      const pv = showPreview(card, () => { cancelled = true; });
      preview = { isOpen: pv.isOpen, cancel: () => { cancelled = true; pv.remove(); } };
      const cold = !F.view.frame;
      const slow = setTimeout(() => toast(cold ? 'Préparation de la fiche… la première ouverture charge la collection du jeu (jusqu’à ~30 s).' : 'Chargement de la fiche…', 90000), cold ? 600 : 500);
      let r;
      try { r = await openInFrame(card, 'view'); } finally { clearTimeout(slow); pv.remove(); preview = null; }
      toast('');
      if (cancelled) { if (!r.error) closeSheet('view'); return undefined; } // aperçu fermé par l'utilisateur
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
    }, 'view').finally(() => asked.delete(key));
  };
})();
