// Bienvenue et nouveautés : à la première installation, une courte présentation de l'extension ; après une mise à jour, ce qui a changé depuis
// la dernière version vue. Affiché une seule fois par version, sur le jeu, quand on y est connecté (menu du jeu présent). Rouvrable depuis les
// Paramètres (« Journal et données » → « Extension »).
(() => {
  const { el } = WMX.dom;

  // Nouveautés, de la plus récente à la plus ancienne. Écrites pour les joueurs : ce qu'ils voient et ce que ça change pour eux.
  // kind : 'new' (nouveau), 'better' (amélioré), 'fix' (corrigé). highlights : les grandes nouveautés, mises en avant en tête de la fenêtre.
  const CHANGES = [
    { v: '1.1.28', title: 'Bouton Marché et surveillance au-dessus du plafond', items: [
      ['new', 'Détail d’une carte (Collection, Toutes les cartes, profils) : un bouton « Marché » montre les enchères en cours de la carte, ou ouvre le Marché avec son nom déjà recherché.'],
      ['new', '« Surveiller » une carte au-dessus de votre plafond : choisissez un plafond pour cette enchère seulement (valeur fixe, ou moyenne ± %). Votre choix est retenu pour la prochaine fois.'],
    ] },
    { v: '1.1.26', title: 'Échanges : les wikibidous comptent', items: [
      ['fix', 'Contre-offre et nouvelle offre : les wikibidous donnés ou demandés sont comptés dans le bilan (avant : un échange contre des wikibidous paraissait perdu à 100 %).'],
    ] },
    { v: '1.1.24', title: 'Succès : tout réclamer en un clic', items: [
      ['new', 'Page Succès : un bandeau « Tout réclamer » récupère d’un coup toutes les récompenses disponibles (ou la seule qui reste).'],
    ] },
    { v: '1.1.23', title: 'Vue étendue plus calme', items: [
      ['fix', 'La liste ne se relance plus à chaque moyenne reçue : une mise à jour par minute au plus.'],
      ['fix', 'Pas de mise à jour pendant une sélection, une défausse ou une fenêtre ouverte : votre sélection n’est plus annulée.'],
    ] },
    { v: '1.1.22', title: 'Paquets automatiques plus fiables', items: [
      ['fix', 'L’ouverture automatique des paquets ne reste plus bloquée après une erreur : le menu répond toujours et l’ouverture reprend à l’échéance suivante.'],
    ] },
    { v: '1.1.21', title: 'Moyennes, vue étendue et défausse', highlights: [
      { icon: 'chart', title: 'La moyenne de la semaine', text: 'Les prix suivent la vue du marché du jeu, avec la tendance de la semaine.', visual: 'avg',
        settings: { label: 'Choisir où et comment', section: 'Moyennes du marché' } },
      { icon: 'layers', title: 'Une vue étendue toujours à jour', text: 'Vos cartes sont mises à jour dès que vous les obtenez, les étiquetez ou les supprimez.' },
      { icon: 'trash', title: 'Une défausse plus rapide', text: 'Jusqu’à 500 cartes par page, sans figer la page.' },
    ], groups: [
      { icon: 'fix', title: 'Corrections', items: [
        'Tri par moyenne toujours dans le bon ordre',
        'Plus de mise en vente à 10 W pour une carte rare sans moyenne',
        '« Garder 1 exemplaire » et doublons mieux gérés',
        'Le bouton « Voir les nouveautés » fonctionne de nouveau',
      ] },
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

  // Petites icônes (traits fins, couleur du texte) : une icône vaut mieux qu'un mot. Un nom inconnu (ex. un émoji) est affiché tel quel.
  const ICONS = {
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    new: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    better: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
    fix: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  };
  const ico = (name, size = 18) => {
    if (!ICONS[name]) return String(name || '');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
    WMX.dom.svg(svg, ICONS[name]);
    return svg;
  };
  /** Aperçu des quatre formes de la moyenne : de petites cartes d'exemple (mêmes classes que les vraies pastilles, le CSS des formes s'y applique). */
  function avgVisual() {
    const card = (form, label) => el('figure', { class: 'wmx-wn-fig' },
      el('div', { class: 'wmx-avgprev', style: '--wmx-rgb:250 204 21', ...(form ? { 'data-avgp': form } : {}), 'aria-hidden': 'true' },
        el('span', { class: 'wmx-avgprev-art' }), el('b', { class: 'wmx-avgprev-rar' }, 'L'),
        el('div', { class: 'wmx-avgprev-info top-[45%]' }, el('strong', {}, 'Henri IV'), el('small', {}, 'roi de France')),
        el('span', { class: 'wmx-nt-price wmx-sample', 'data-trend': 'up' }, el('span', { class: 'wmx-pl' }, 'Moy. '), el('span', { class: 'wmx-pv' }, '3 247 W'), ' ',
          el('i', { class: 'wmx-age fresh' }, '✓'), el('span', { class: 'wmx-ptr up' }, el('b', { class: 'wmx-pa' }, '↗'), el('span', { class: 'wmx-pc' }, ' +11 %')))),
      el('figcaption', {}, label));
    return el('div', { class: 'wmx-wn-vis' }, card('', 'Pastille'), card('compact', 'Compacte'), card('tab', 'Onglet'), card('strip', 'Ruban'));
  }
  /** Ouvre les Paramètres sur une rubrique : la fenêtre des nouveautés se ferme d'abord (elle est au-dessus). */
  const toSettings = (section) => { close(); try { WMX.openSettings?.(section); } catch (_) { /* Paramètres indisponibles */ } };

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
  // Version installée. Illisible quand l'extension a été rechargée sans actualiser l'onglet (ancienne copie coupée de Chrome) : on prend la
  // dernière version de la liste (avant : « 0 », la liste était vide et le bouton « Voir les nouveautés » ne faisait rien).
  const current = () => { try { return chrome.runtime.getManifest().version || CHANGES[0].v; } catch (_) { return CHANGES[0].v; } };
  /** Nouveautés des versions vues depuis `since` (exclue) jusqu'à la version installée (incluse). Sans `since` connu : les 3 dernières. */
  function changesSince(since) {
    const cur = current();
    const list = CHANGES.filter((c) => !newer(c.v, cur));
    if (!since) return (list.length ? list : CHANGES).slice(0, 3); // demandé depuis les Paramètres : toujours les dernières nouveautés
    return list.filter((c) => newer(c.v, since));
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
    // Grandes nouveautés en tête (« À la une ») : icône, titre, une phrase ; un aperçu et un lien vers le réglage concerné quand il y en a.
    const tops = groups.flatMap((g) => g.highlights || []);
    const featured = tops.length ? el('section', { class: 'wmx-wn-top' }, el('small', { class: 'wmx-wn-eyebrow' }, 'À la une'),
      ...tops.map((h) => el('div', { class: 'wmx-wn-feat' }, el('div', { class: 'wmx-wn-featicon', 'aria-hidden': 'true' }, ico(h.icon, 22)),
        el('div', {}, el('b', {}, h.title), el('p', {}, h.text), h.visual === 'avg' ? avgVisual() : '',
          h.settings ? el('button', { type: 'button', class: 'wmx-wn-link', onclick: () => toSettings(h.settings.section) }, ico('gear', 14), h.settings.label) : '')))) : '';
    // Corrections et petites améliorations : lignes courtes, une icône par ligne (pas de mots « Corrigé » / « Amélioré »).
    const row = (kind, text) => el('li', { class: `wmx-wn-item ${kind}` }, el('span', { class: `wmx-wn-kind ${kind}`, title: KIND[kind] || '' }, ico(kind === 'check' ? 'check' : kind, 14)), el('span', {}, text));
    const body = el('div', { class: 'wmx-wn-body' }, featured, ...groups.map((g) => el('section', { class: 'wmx-wn-ver' },
      el('div', { class: 'wmx-wn-verhead' }, el('b', {}, g.title), el('span', { class: 'wmx-wn-vtag' }, `v${g.v}`)),
      ...(g.groups || []).map((grp) => el('div', { class: 'wmx-wn-grp' }, el('small', {}, ico(grp.icon, 13), grp.title), el('ul', {}, ...grp.items.map((t) => row('check', t))))),
      (g.items || []).length ? el('ul', {}, ...g.items.map(([k, t]) => row(k, t))) : '')));
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
