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

  // --- Notifications : une seule pile en bas à droite ----------------------------------------------------------------------
  // Elles ne s'étalent plus sur l'écran : chacune passe DEVANT la précédente, au même endroit (on devine les plus anciennes derrière,
  // et un compteur « +2 » dit combien il y en a). Survoler la pile la déplie pour toutes les lire (les minuteries sont alors en pause).
  // La pile se pose toujours au-dessus de la file d'attente et de la bulle des enchères : si on ouvre l'une d'elles, elle monte ;
  // s'il ne reste pas la place au-dessus, elle passe à leur gauche. Jamais par-dessus.
  // Temporaires (info, ok, warn) : disparaissent seules, un petit anneau se vide pour le montrer. Alertes (kind « alert », ou sticky) : rouges,
  // elles restent jusqu'à la croix. Même clé = la notification est remplacée, pas empilée.
  const NOTE_MAX = 6;      // notifications gardées (au-delà, les plus anciennes qui ne sont pas des alertes s'en vont)
  const NOTE_LAYERS = 2;   // cartes devinées derrière la première quand la pile est repliée
  const NOTE_STEP = 7;     // décalage (px) de chaque carte de l'arrière
  const ANCHORS = '.wmx-qchip, .wmx-bubble:not([hidden]) .wmx-bubble-pill, .wmx-bubble:not([hidden]) .wmx-bubble-panel:not([hidden]):not(.moved)';
  const notes = new Map(); // clé -> { node, h, timer, due, left, persistent }
  let noteBox = null;
  let noteSeq = 0;
  let noteOpen = false;
  let noteRO = null;
  let noteTick = null;
  const watched = new WeakSet();

  /** Place la pile au-dessus de ce qui occupe le coin (file d'attente, bulle des enchères, ouvertes ou non). */
  function placeNotes() {
    if (!noteBox?.isConnected) return;
    const vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    const anchors = [...document.querySelectorAll(ANCHORS)];
    if (typeof ResizeObserver === 'function') {
      noteRO ||= new ResizeObserver(() => { placeNotes(); layoutNotes(); });
      for (const a of anchors) if (!watched.has(a)) { watched.add(a); noteRO.observe(a); }
    }
    const rects = anchors.map((a) => a.getBoundingClientRect()).filter((r) => r.width && r.height && r.right > vw - 160);
    let bottom = 18, right = 18;
    if (rects.length) {
      bottom = Math.round(vh - Math.min(...rects.map((r) => r.top)) + 10);
      const need = (notes.size ? Math.max(...[...notes.values()].map((n) => n.h || 70)) : 70) + NOTE_LAYERS * NOTE_STEP + 12;
      if (vh - bottom < need) { // plus la place au-dessus (bulle des enchères ouverte en grand) : à gauche de ce qui est ouvert
        const r2 = Math.round(vw - Math.min(...rects.map((r) => r.left)) + 12);
        if (vw - r2 >= 260) { bottom = 18; right = r2; } else bottom = Math.max(18, vh - need);
      }
    }
    noteBox.style.bottom = `${bottom}px`;
    noteBox.style.right = `${right}px`;
  }

  /** Dispose les cartes : repliées (la plus récente devant, deux devinées derrière) ou dépliées au survol. */
  function layoutNotes() {
    if (!noteBox?.isConnected) return;
    const list = [...notes.values()].reverse(); // la plus récente d'abord
    const avail = (window.innerHeight || 800) - (parseFloat(noteBox.style.bottom) || 18) - 16;
    // Hauteur naturelle (texte sur 1 à 3 lignes) relue à chaque fois : la largeur peut avoir changé (fenêtre redimensionnée).
    for (const [i, n] of list.entries()) if (noteOpen || i === 0) { n.node.style.height = ''; n.h = n.node.offsetHeight || n.h; }
    const frontH = list[0]?.h || 0;
    let y = 0;
    list.forEach((n, i) => {
      const st = n.node.style;
      n.node.classList.toggle('front', i === 0);
      n.node.classList.toggle('back', !noteOpen && i > 0);
      st.zIndex = String(100 - i);
      if (noteOpen) {
        const fits = i === 0 || y + n.h <= avail;
        st.height = '';
        st.transform = `translateY(${-y}px)`;
        st.opacity = fits ? '1' : '0';
        st.pointerEvents = fits ? 'auto' : 'none';
        if (fits) y += n.h + 8;
      } else {
        const layer = Math.min(i, NOTE_LAYERS + 1);
        st.height = i ? `${frontH}px` : ''; // les cartes de l'arrière prennent la taille de celle de devant : on ne voit que leur bord
        st.transform = `translateY(${-layer * NOTE_STEP}px) scale(${1 - layer * 0.045})`;
        st.opacity = i > NOTE_LAYERS ? '0' : '1';
        st.pointerEvents = i ? 'none' : 'auto';
      }
    });
    noteBox.style.height = `${noteOpen ? Math.max(0, y - 8) : frontH + Math.min(list.length - 1, NOTE_LAYERS) * NOTE_STEP}px`;
    const front = list[0]?.node;
    for (const n of list) if (n.node !== front) delete n.node.dataset.more;
    if (front) {
      if (list.length > 1 && !noteOpen) front.dataset.more = `+${list.length - 1}`; else delete front.dataset.more;
      front.classList.toggle('more-alert', list.slice(1).some((n) => n.persistent)); // une alerte attend derrière : compteur rouge
    }
  }

  function startNoteTimer(key, n, ms) {
    clearTimeout(n.timer);
    n.due = Date.now() + ms;
    n.timer = setTimeout(() => dismissNote(key), ms);
  }
  function setNotesOpen(open) {
    if (open === noteOpen) return;
    noteOpen = open;
    noteBox?.classList.toggle('open', open);
    for (const [k, n] of notes) { // pendant la lecture, rien ne disparaît
      if (n.persistent) continue;
      if (open) { clearTimeout(n.timer); n.left = Math.max(1500, (n.due || 0) - Date.now()); } else startNoteTimer(k, n, n.left || 3000);
    }
    layoutNotes();
  }

  function ensureNoteBox() {
    if (noteBox?.isConnected) return;
    noteBox = el('div', { class: 'wmx-notes' });
    noteBox.addEventListener('mouseenter', () => setNotesOpen(true));
    noteBox.addEventListener('mouseleave', () => setNotesOpen(false));
    document.body.append(noteBox);
    noteOpen = false;
    if (!noteTick) noteTick = setInterval(() => { if (!notes.size) { clearInterval(noteTick); noteTick = null; return; } placeNotes(); layoutNotes(); }, 1000); // bulle déplacée, fenêtre redimensionnée…
  }

  function dismissNote(key) {
    const n = notes.get(key);
    if (!n) return;
    clearTimeout(n.timer);
    notes.delete(key);
    n.node.style.opacity = '0';
    n.node.style.transform += ' translateX(16px)';
    n.node.style.pointerEvents = 'none';
    setTimeout(() => n.node.remove(), 200);
    if (!notes.size) setNotesOpen(false);
    layoutNotes();
  }
  const ringSvg = (ms) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('class', 'wmx-note-ring'); svg.style.setProperty('--ms', `${ms}ms`);
    svg.innerHTML = '<circle cx="10" cy="10" r="7" class="bg"/><circle cx="10" cy="10" r="7" class="fg" pathLength="100"/>';
    return svg;
  };
  /** kind : info | ok | warn | alert. title : ligne en gras (facultative). action : { label, onClick } bouton dans la notification. */
  function notify({ text, title = '', kind = 'info', ms = 5000, key = '', sticky = false, action = null, hint = '' }) {
    if (!text) return undefined;
    ensureNoteBox();
    key = key || `n${++noteSeq}`;
    if (notes.has(key)) { clearTimeout(notes.get(key).timer); notes.get(key).node.remove(); notes.delete(key); }
    const persistent = sticky || kind === 'alert' || !(ms > 0); // durée 0 : reste jusqu’à la croix, au lieu de disparaître aussitôt
    if (!title) title = kind === 'warn' ? 'Ça n’a pas marché' : kind === 'alert' ? 'Attention' : ''; // titre commun aux problèmes : on les reconnaît d’un coup d’œil
    const close = el('button', { class: 'wmx-note-x', title: 'Fermer', 'aria-label': 'Fermer', onclick: () => dismissNote(key) }, '×');
    const act = action ? el('button', { class: 'wmx-note-act', onclick: () => { try { action.onClick(); } finally { dismissNote(key); } } }, action.label) : '';
    const node = el('div', { class: `wmx-note ${kind}`, role: kind === 'alert' ? 'alert' : 'status', ...(hint ? { title: `Détail technique : ${hint}` } : {}) },
      el('div', { class: 'wmx-note-body' }, title ? el('b', {}, title) : '', el('span', {}, text), act),
      persistent ? close : el('div', { class: 'wmx-note-side' }, ringSvg(ms), close));
    node.style.opacity = '0';
    node.style.transform = 'translateY(14px)';
    noteBox.append(node);
    const entry = { node, h: node.offsetHeight || 64, timer: null, due: 0, left: 0, persistent };
    notes.set(key, entry);
    if (!persistent) { if (noteOpen) { entry.left = ms; entry.due = Date.now() + ms; } else startNoteTimer(key, entry, ms); }
    // Trop de notifications : on retire les plus anciennes qui ne sont pas des alertes.
    for (const [k, n] of notes) { if (notes.size <= NOTE_MAX) break; if (!n.persistent) dismissNote(k); }
    placeNotes();
    (window.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => { entry.h = node.offsetHeight || entry.h; layoutNotes(); });
    layoutNotes();
    node.style.opacity = '0'; node.style.transform = 'translateY(14px)'; // l'entrée glisse depuis le bas à l'image suivante
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
  // Messages en français simple, sans code ni JSON : `title` et `text` pour la notification, `short` pour une ligne de journal, `hint` (détail technique du jeu)
  // en info-bulle seulement, `kind` pour réagir selon le cas (human = vérification humaine, limit = trop de requêtes, refused = refus sans précision).
  WMX.explainRefusal = function explainRefusal(raw) {
    const s = String(raw || '');
    const said = (s.match(/«\s*([^»]{3,300}?)\s*»/) || [])[1] || '';
    const hint = s.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (/human_verification|anti-?bot|v[ée]rification|humain|captcha|turnstile|challenge/i.test(s)) {
      return { kind: 'human', hint, short: 'le jeu demande une vérification humaine', title: 'Le jeu veut vérifier que vous êtes humain',
        text: 'Une petite vérification (une case à cocher) est demandée. Faites-la dès qu’elle s’affiche : l’extension reprend ensuite toute seule. Si rien ne s’affiche, lancez une mise en vente à la main sur le jeu.' };
    }
    if (/automatis|trop de requêtes|règlement|too many|\b429\b/i.test(s)) {
      return { kind: 'limit', hint, short: 'le jeu trouve qu’il y a trop de demandes', title: 'Le jeu trouve que ça va trop vite',
        text: 'Trop de demandes en peu de temps. L’extension se met en pause, puis réessaie de plus en plus tard : inutile d’insister.' };
    }
    const plain = said && !/^[{[]/.test(said) ? ` Le jeu dit : « ${said.slice(0, 160)} »` : '';
    return { kind: 'refused', hint, short: 'le jeu a refusé la demande', title: 'Le jeu a refusé la demande',
      text: `Le jeu a dit non pour le moment. L’extension réessaiera un peu plus tard.${plain}` };
  };

  /** Le jeu demande sa vérification humaine dans le cadre d'automatisation (invisible d'habitude) : on le montre au centre de l'écran pour que la personne
   *  la fasse, puis l'appelant reprend. Renvoie 'done' (faite), 'cancel' (bouton Annuler), 'timeout' (3 min sans réponse) ou 'none' (aucune vérification
   *  trouvée dans le cadre : le jeu n'a affiché qu'un message). */
  WMX.askHumanCheck = async function askHumanCheck(kind = 'work', doc = null) {
    const frame = F[kind]?.frame;
    let d = doc;
    try { d = d || frame?.contentDocument; } catch (_) { d = null; }
    if (!frame || !d) return 'none';
    const dialog = () => { try { return /vérification rapide/i.test(d.body.innerText ?? d.body.textContent) || !!d.querySelector('iframe[src*="challenges.cloudflare.com"]'); } catch (_) { return false; } };
    if (!(await waitFor(dialog, 3500, 150))) return 'none';
    let cancelled = false;
    frame.classList.add('wmx-on', 'wmx-human');
    notify({ kind: 'alert', key: 'game-human', title: 'Vérification demandée par le jeu',
      text: 'Cochez la case dans la fenêtre au centre de l’écran. L’extension reprend toute seule dès que c’est fait.',
      action: { label: 'Annuler', onClick: () => { cancelled = true; } } });
    const ok = await waitFor(() => cancelled || !dialog(), 180000, 400);
    frame.classList.remove('wmx-on', 'wmx-human');
    dismissNote('game-human');
    return cancelled ? 'cancel' : ok ? 'done' : 'timeout';
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
        notify({ kind: 'alert', key: 'game-notice', title: e.title, text: e.text, hint: text.slice(0, 200), action: {
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
    if (status === 403 || status === 429) { const e = WMX.explainRefusal(`${status} ${detail}`); notify({ kind: 'alert', key: 'game-limit', title: e.title, text: e.text, hint: e.hint }); return; }
    notify({ kind: 'warn', text: msg, ms: 7000, hint: detail ? `${scope} : ${status} ${detail}` : `${scope} : ${status}` });
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
    if (active && !active.shown) active.sig.cancel(); // chargement en cours : abandonné
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wmx-route'] });

  /**
   * Remet le cadre sur la liste de la Collection. Après une mise en vente réussie, le jeu ouvre la page de l'enchère créée
   * (/marketplace/{id}) DANS le cadre : sans ce retour, l'opération suivante ne trouve plus la barre de recherche.
   */
  async function ensureCollection(kind, sig = null) {
    const frame = F[kind].frame;
    const onList = () => { try { return frame.contentWindow.location.pathname === '/collection' && listReady(frame); } catch (_) { return false; } };
    if (onList()) return true;
    try { // navigation interne du jeu (rapide) : on clique « Collection » dans le cadre
      const link = frame.contentDocument.querySelector('nav a[href="/collection"]');
      if (link) link.click(); else frame.contentWindow.location.href = home(kind);
    } catch (_) { frame.src = home(kind); }
    if (await waitFor(() => sig?.cancelled || onList(), 20000, 200)) return !sig?.cancelled;
    frame.src = home(kind); // dernier recours : rechargement complet du cadre
    return !!(await waitFor(() => sig?.cancelled || onList(), 120000, 400)) && !sig?.cancelled;
  }

  /** Signal d'annulation : `cancel()` fait s'arrêter aussitôt une ouverture de fiche en cours (elle ne bloque plus la suivante). */
  const mkSignal = () => {
    const s = { cancelled: false, cancel() { if (!s.cancelled) { s.cancelled = true; s.wake(); } } };
    s.promise = new Promise((resolve) => { s.wake = resolve; });
    return s;
  };

  /** Cherche la carte dans le cadre et ouvre sa fiche (sans l'afficher). Renvoie { d, w, root } ou { error } (error « cancelled » si `sig` a été annulé). */
  async function openInFrame(card, kind = 'view', sig = null) {
    lastUse = Date.now();
    const stopped = () => !!sig?.cancelled;
    const ready = WMX.prepareCardSheets(kind);
    const ok = sig ? await Promise.race([ready, sig.promise.then(() => false)]) : await ready; // le premier chargement du cadre peut durer 30 s : on ne l'attend pas si on a annulé
    if (stopped()) return { error: 'cancelled' };
    if (!ok) return { error: 'frame' };
    const frame = F[kind].frame;
    if (!frame) return { error: 'frame' };
    // Une fiche restée ouverte dans le cadre (ouverture annulée en route) est refermée d'abord : sinon on la prendrait pour celle de cette carte.
    try {
      if (sheetRoot(frame.contentDocument, frame.contentWindow)) {
        closeSheet(kind);
        await waitFor(() => stopped() || !sheetRoot(frame.contentDocument, frame.contentWindow), 2500, 80);
      }
    } catch (_) { /* cadre en cours de chargement */ }
    if (stopped()) return { error: 'cancelled' };
    if (!(await ensureCollection(kind, sig))) return { error: stopped() ? 'cancelled' : 'frame' };
    const d = frame.contentDocument;
    const w = frame.contentWindow;
    search(d, w, card.wikipedia_title);
    // La recherche relance un chargement : on laisse la liste se mettre à jour, puis on repère la carte.
    const tile = await waitFor(() => stopped() || findTile(d, card), 15000, 150);
    if (stopped()) return { error: 'cancelled' };
    if (!tile) return { error: 'notfound' };
    await sleep(120);
    if (stopped()) return { error: 'cancelled' };
    tile.click();
    const root = await waitFor(() => stopped() || sheetRoot(d, w), 6000, 80);
    if (stopped()) { closeSheet(kind); return { error: 'cancelled' }; }
    if (!root) return { error: 'nosheet' };
    return { d, w, root };
  }

  WMX.sheet = {
    openInFrame,
    signal: mkSignal,
    closeSheet,
    /** Cadres de la collection (fiches de cartes « view », mises en vente et étiquettes « work ») : ouverts ? affichés ? — pour « Activité en direct ». */
    frames: () => KINDS.map((k) => ({ kind: k, open: !!F[k].frame, visible: !!F[k].frame?.classList.contains('wmx-on') })),
    /** Exécute `fn` quand le cadre `kind` est libre (les opérations d'un même cadre ne se mélangent pas). */
    exclusive(fn, kind = 'view') {
      const s = F[kind];
      const run = s.chain.then(fn, fn);
      s.chain = run.catch(() => {});
      return run;
    },
  };

  const ERRORS = {
    frame: 'La fiche de la carte n’a pas pu s’ouvrir pour le moment. Réessayez dans un instant.',
    notfound: 'Le jeu ne retrouve pas cette carte dans votre collection.',
    nosheet: 'La fiche de la carte ne s’est pas ouverte. Réessayez.',
  };

  /** Affiche la fiche du jeu par-dessus l'écran en cours. */
  /**
   * Aperçu immédiat pendant que la vraie fiche du jeu se charge (le jeu peut mettre 20 s et plus à répondre) : titre, rareté,
   * illustration, et un état de chargement. Il n'apparaît qu'après 250 ms (rien à l'écran quand la fiche s'ouvre tout de suite)
   * et se ferme par × / Échap / clic à côté : la fiche ne s'ouvre alors pas.
   */
  function showPreview(card, onCancel, cold = false) {
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
          el('div', { class: 'wmx-pre-load' }, el('i'), el('span', {}, cold ? 'Première ouverture : cela peut prendre jusqu’à 30 secondes…' : 'Chargement de la fiche du jeu…')),
          el('small', { class: 'wmx-pre-hint' }, 'Vous pouvez fermer (×, Échap) et ouvrir une autre carte : le chargement s’arrête.')));
      document.body.append(node);
      WMX.loadCardInfo?.(card).then((i) => { if (i?.img && node?.isConnected) WMX.dom.artLayers(i.img, art); });
    }, 250);
    const remove = () => { clearTimeout(timer); node?.remove(); node = null; };
    return { remove, isOpen: () => !!node };
  }
  let preview = null;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && preview?.isOpen()) { e.stopPropagation(); preview.cancel(); } }, true);

  // Une seule fiche à la fois : la dernière demandée (en chargement ou affichée). Cliquer une autre carte pendant un chargement, fermer l'aperçu,
  // changer de page ou dépasser le délai ANNULE aussitôt le chargement en cours (recherche, ouverture) : il ne bloque plus la fiche suivante.
  let active = null; // { key, sig, shown }
  WMX.openCardDetail = function openCardDetail(card) {
    const key = `${card.wikipedia_title}|${card.rarity}`;
    if (active && !active.sig.cancelled) {
      if (active.shown || active.key === key) return undefined; // fiche déjà affichée, ou clics répétés sur la même carte : une seule ouverture
      active.sig.cancel(); // une autre carte a été cliquée pendant le chargement : on l'abandonne tout de suite
    }
    const op = { key, sig: mkSignal(), shown: false, timedOut: false };
    active = op;
    return WMX.sheet.exclusive(async () => {
      if (op.sig.cancelled) return undefined; // abandonnée avant même de commencer
      const gen = routeGen;
      const cold = !F.view.frame; // premier chargement à froid : expliqué dans l'aperçu (pas de notification)
      const pv = showPreview(card, () => op.sig.cancel(), cold);
      preview = { isOpen: pv.isOpen, cancel: () => { op.sig.cancel(); pv.remove(); } };
      const limit = setTimeout(() => { if (!op.shown) { op.timedOut = true; op.sig.cancel(); } }, cold ? 70000 : 35000); // jamais un blocage sans fin
      let r;
      try { r = await openInFrame(card, 'view', op.sig); } finally { clearTimeout(limit); pv.remove(); preview = null; }
      if (op.sig.cancelled) { // annulée (aperçu fermé, autre carte cliquée, délai dépassé)
        if (!r.error) closeSheet('view');
        if (op.timedOut) toast('La fiche met trop de temps à répondre : réessayez dans un instant.', 7000, { kind: 'warn' });
        return undefined;
      }
      if (gen !== routeGen) { if (!r.error) closeSheet('view'); return undefined; } // l'utilisateur a changé de page entre-temps
      if (r.error) return toast(ERRORS[r.error] || 'La fiche n’est pas disponible pour le moment.', 7000, { kind: 'warn' });
      const { d, w, root } = r;
      const frame = F.view.frame;
      op.shown = true;

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
    }, 'view').finally(() => { if (active === op) active = null; });
  };
})();
