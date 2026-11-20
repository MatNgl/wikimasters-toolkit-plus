// Bienvenue et nouveautés : à la première installation, une courte présentation de l'extension ; après une mise à jour, ce qui a changé depuis
// la dernière version vue. Affiché une seule fois par version, sur le jeu, quand on y est connecté (menu du jeu présent). Rouvrable depuis les
// Paramètres (« Journal et données » → « Extension »).
(() => {
  const { el } = WMX.dom;

  // Nouveautés, de la plus récente à la plus ancienne. Écrites pour les joueurs : ce qu'ils voient et ce que ça change pour eux.
  // kind : 'new' (nouveau), 'better' (amélioré), 'fix' (corrigé). highlights : les grandes nouveautés, mises en avant en tête de la fenêtre.
  const CHANGES = [
    { v: '1.1.1', title: 'Moyenne de la semaine, défausse et vue étendue', items: [
      ['fix', 'Moyennes du marché : depuis la mise à jour du jeu, l’extension affiche la moyenne de la semaine, comme la fiche de la carte (sans vente cette semaine : celle de la dernière semaine avec des ventes). Plus de « Sans vente » à tort.'],
      ['fix', 'Défausse : plusieurs exemplaires d’une même carte sur la page sont cochés ou décochés un par un (plus d’arrêt « le jeu compte N cartes au lieu de N−1 »).'],
      ['fix', '« Garder 1 exemplaire » garde bien un exemplaire de chaque carte et défausse les autres (avant : aucun doublon reconnu).'],
      ['fix', 'Défausse avec la vue étendue : elle ne s’arrête plus sur « bouton Défausser introuvable » ; elle attend que le jeu ait relu sa liste.'],
      ['better', 'La défausse ne fige plus la page après chaque lot de cartes, et passe la vue étendue à 500 cartes par page en mode visible.'],
      ['fix', 'Le doublon d’une carte défaussée ne disparaît plus de la vue étendue.'],
    ] },
    { v: '1.0.96', title: 'Cadran des paquets et tableau de bord', items: [
      ['better', 'Le cadran des paquets reste affiché quand son menu est ouvert : un clic l’ouvre, un autre le referme (comme la bulle des enchères).'],
      ['fix', 'Le cadran des paquets est de nouveau visible sur le tableau de bord, et toujours sur la page Paquets.'],
      ['new', 'Tableau de bord : votre solde s’affiche à gauche des Paramètres ; un clic ouvre la boutique.'],
    ] },
    { v: '1.0.94', title: 'Vue étendue', items: [
      ['fix', 'Étiqueter plusieurs cartes dans la vue étendue marche de nouveau quand la sélection contient des cartes en vente ou vendues : elles sont ignorées, les autres sont étiquetées, comme sur la page du jeu.'],
      ['better', 'Les cartes mises en vente disparaissent de la vue étendue le temps de l’enchère.'],
    ] },
    { v: '1.0.93', title: 'Paquets et Collection', highlights: [
      { icon: '📦', title: 'Ouvrez vos paquets depuis n’importe quelle page', text: '« Tout ouvrir » et l’ouverture auto travaillent maintenant en arrière-plan : restez sur la Collection, le Marché ou les Échanges. La progression s’affiche sur le cadran des paquets, en bas à gauche, et vos cartes sont révélées à la fin. L’ouverture auto n’attend plus votre retour sur la page Paquets : votre stock n’atteint plus le maximum.' },
      { icon: '🃏', title: 'Une Collection plus pratique : la vue étendue', text: 'Cliquez sur « Vue étendue », à côté de la recherche de la Collection : jusqu’à 500 cartes par page, tri « Moyenne (plus chères) » et navigation instantanée. Sélection, défausse, favoris et étiquettes fonctionnent comme d’habitude.' },
    ], items: [
      ['better', 'Révélation plus fluide : les cartes se retournent en vague, sans temps mort ; une courte lueur annonce les plus rares. « Rapide » va environ trois fois plus vite.'],
      ['better', 'Assistant de vente : « Seulement celles-ci » propose d’abord les légendaires.'],
      ['fix', '« Aucun paquet disponible » n’apparaît plus quand il vous reste des paquets.'],
    ] },
    { v: '1.0.87', title: 'Collection', items: [
      ['better', 'Barre de la Collection redessinée : valeur estimée bien visible, jauge de chargement des prix avec pause et arrêt.'],
      ['new', 'Cette fenêtre : les nouveautés de chaque version, une seule fois.'],
    ] },
    { v: '1.0.85', title: 'Défausse en masse', items: [
      ['better', 'Défausse, favoris et étiquettes sur plus de 100 cartes : envoyés au jeu par lots de 100 (sa limite), en une seule action pour vous.'],
      ['better', 'L’icône de l’extension sur ses boutons, dans le menu et dans les Paramètres.'],
    ] },
    { v: '1.0.84', title: 'Vue étendue de la Collection', items: [
      ['new', 'Bouton « Vue étendue » à côté de la recherche : 50, 100, 200 ou 500 cartes par page, navigation instantanée.'],
      ['new', 'Nouveau tri « Moyenne (plus chères) » dans le menu de tri de la Collection.'],
      ['better', 'Les cartes tirées, achetées ou reçues apparaissent tout de suite dans la vue étendue.'],
    ] },
    { v: '1.0.80', title: 'Firefox', items: [
      ['fix', 'Firefox : la mise en vente (⚡ et assistant de vente), les mises et la surveillance fonctionnent de nouveau.'],
    ] },
    { v: '1.0.79', title: 'Tableau de bord', items: [
      ['new', 'Plus-values : tri par colonne (clic sur un titre), moyenne de chaque carte au jour de l’achat, détail des enchères d’achat et de vente.'],
      ['better', 'Infobulles des graphiques par-dessus la page : le graphique ne bouge plus au survol.'],
    ] },
    { v: '1.0.75', title: 'Paquets', items: [
      ['fix', 'L’ouverture ne reste plus bloquée sur une erreur du jeu : elle réessaie et vous dit pourquoi.'],
      ['new', '« Passer » arrête l’ouverture et montre tout de suite les cartes déjà tirées ; les paquets restants sont gardés.'],
    ] },
  ];
  const KIND = { new: 'Nouveau', better: 'Amélioré', fix: 'Corrigé' };

  // Présentation (première installation).
  const TOUR = [
    { icon: '🎁', title: 'Bienvenue dans WikiMasters Toolkit+', text: 'L’extension s’ajoute au jeu sans le remplacer : prix du marché sur vos cartes, ouverture des paquets en un clic, enchères suivies et ventes automatiques. Voici l’essentiel en quatre étapes.' },
    { icon: '📦', title: 'Paquets', text: '« Tout ouvrir » ouvre tous vos paquets et révèle les cartes, avec leur moyenne du marché ; « Ouvrir auto » les ouvre à intervalles réguliers. Les deux marchent depuis n’importe quelle page : la progression s’affiche sur le cadran des paquets, en bas à gauche.' },
    { icon: '🃏', title: 'Collection', text: 'Chaque carte affiche sa moyenne du marché et un bouton ⚡ pour la mettre aux enchères. La « Vue étendue » affiche jusqu’à 500 cartes par page et les trie par moyenne.' },
    { icon: '⚡', title: 'Enchères et ventes', text: 'La bulle en bas à droite suit vos mises et vos ventes. L’assistant de vente met en vente les cartes d’une étiquette (par exemple VENTE). Le Tableau de bord résume vos plus-values.' },
    { icon: '⚙️', title: 'Vos réglages', text: 'Tout se règle dans « WikiMasters+ », sous « Paramètres » dans le menu du jeu. Le journal d’activité y garde la trace de ce que fait l’extension.' },
  ];

  const vNum = (v) => String(v || '0').split('.').map((x) => Number(x) || 0);
  const newer = (a, b) => { const x = vNum(a); const y = vNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const current = () => { try { return chrome.runtime.getManifest().version; } catch (_) { return '0'; } };
  /** Nouveautés des versions vues depuis `since` (exclue) jusqu'à la version installée (incluse). Sans `since` connu : les 3 dernières. */
  function changesSince(since) {
    const cur = current();
    const list = CHANGES.filter((c) => !newer(c.v, cur));
    return since ? list.filter((c) => newer(c.v, since)) : list.slice(0, 3);
  }

  let open = null;
  function close() { open?.remove(); open = null; window.removeEventListener('keydown', onKey, true); }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function shell(children, cls = '') {
    close();
    const back = el('div', { class: `wmx-wn-back ${cls}` });
    const box = el('div', { class: 'wmx-wn', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'WikiMasters Toolkit+' }, ...children);
    back.append(box);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    window.addEventListener('keydown', onKey, true); // sur la fenêtre, en premier : le jeu intercepte Échap avant le document
    document.body.append(back);
    open = back;
    return box;
  }

  /** Nouveautés depuis la version `since`. */
  function showChanges(since) {
    const groups = changesSince(since);
    if (!groups.length) return false;
    // Grandes nouveautés en tête (« À la une »), en cartes ; puis le détail, version par version.
    const tops = groups.flatMap((g) => g.highlights || []);
    const featured = tops.length ? el('section', { class: 'wmx-wn-top' }, el('small', { class: 'wmx-wn-eyebrow' }, 'À la une'),
      ...tops.map((h) => el('div', { class: 'wmx-wn-feat' }, el('div', { class: 'wmx-wn-featicon', 'aria-hidden': 'true' }, h.icon), el('div', {}, el('b', {}, h.title), el('p', {}, h.text))))) : '';
    const body = el('div', { class: 'wmx-wn-body' }, featured, ...groups.map((g) => el('section', { class: 'wmx-wn-ver' },
      el('div', { class: 'wmx-wn-verhead' }, el('b', {}, g.title), el('span', { class: 'wmx-wn-vtag' }, `v${g.v}`)),
      el('ul', {}, ...g.items.map(([k, t]) => el('li', { class: `wmx-wn-item ${k}` }, el('span', { class: `wmx-wn-kind ${k}` }, KIND[k] || k), el('span', {}, t)))))));
    shell([
      el('header', { class: 'wmx-wn-head' }, WMX.dom.logo(40), el('div', {}, el('small', {}, 'WikiMasters Toolkit+'), el('h2', {}, `Nouveautés de la version ${current()}`)),
        el('button', { type: 'button', class: 'wmx-close', title: 'Fermer', 'aria-label': 'Fermer', onclick: close }, '×')),
      body,
      el('footer', { class: 'wmx-wn-foot' },
        el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost', onclick: () => showTour() }, 'Revoir la présentation'),
        el('button', { type: 'button', class: 'wmx-btn', onclick: close }, 'C’est noté')),
    ]);
    return true;
  }

  /** Présentation en quelques étapes (première installation, ou depuis les Paramètres). */
  function showTour(step = 0) {
    const s = TOUR[step];
    const last = step === TOUR.length - 1;
    shell([
      el('header', { class: 'wmx-wn-head' }, WMX.dom.logo(40), el('div', {}, el('small', {}, `Étape ${step + 1} sur ${TOUR.length}`), el('h2', {}, s.title)),
        el('button', { type: 'button', class: 'wmx-close', title: 'Fermer', 'aria-label': 'Fermer', onclick: close }, '×')),
      el('div', { class: 'wmx-wn-tour' }, el('div', { class: 'wmx-wn-emoji', 'aria-hidden': 'true' }, s.icon), el('p', {}, s.text)),
      el('div', { class: 'wmx-wn-dots', 'aria-hidden': 'true' }, ...TOUR.map((_, i) => el('i', { class: i === step ? 'on' : '' }))),
      el('footer', { class: 'wmx-wn-foot' },
        step ? el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost', onclick: () => showTour(step - 1) }, '← Précédent') : el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Passer'),
        el('button', { type: 'button', class: 'wmx-btn', onclick: () => (last ? close() : showTour(step + 1)) }, last ? 'C’est parti' : 'Suivant →')),
    ], 'wmx-wn--tour');
  }

  /** Connecté au jeu : son menu (lien « Collection ») est affiché ; jamais sur la page de connexion ni dans un cadre invisible. */
  const loggedIn = () => window.top === window && !/^\/(login|signup|register|auth)/.test(location.pathname) && !!document.querySelector('nav a[href="/collection"]');

  async function maybeShow() {
    const seen = await WMX.store.get('seenVersion', null);
    const cur = current();
    if (seen === cur) return;
    // Pas de version vue : première installation… ou une installation d'avant cette fenêtre (réglages déjà présents) : ses nouveautés récentes.
    const settings = await WMX.store.get('wmxSettings', null);
    const veteran = !!settings || !!(await WMX.store.get('stats', null));
    for (let i = 0; i < 20 && !loggedIn(); i++) await new Promise((r) => setTimeout(r, 1500)); // le menu du jeu s'affiche après la connexion
    if (!loggedIn() || !WMX.alive()) return;
    if (!seen && !veteran) showTour();
    else if (!showChanges(seen)) { /* aucune nouveauté à montrer pour cette version */ }
    WMX.store.set('seenVersion', cur);
  }

  WMX.whatsNew = { showChanges: (since) => showChanges(since === undefined ? null : since), showTour, changesSince, current };

  WMX.register({
    name: 'whats-new',
    init() { if (window.top === window) setTimeout(() => { if (WMX.alive()) maybeShow(); }, 2500); },
  });
})();
