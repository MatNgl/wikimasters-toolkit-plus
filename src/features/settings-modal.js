// Fenêtre flottante « Paramètres de l'extension » (mêmes principes que le modal de l'ancienne extension,
// avec notre style et nos réglages). Les changements ne sont appliqués qu'avec « Appliquer ».
(() => {
  const { el } = WMX.dom;
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

  WMX.DEFAULTS = {
    speed: 'normal', order: 'rarity', images: true,
    stopOn: 'off', reserve: 0, fullStockOpen: true, anticipate: true,
    quickCoef: 0.9, quickDuration: '1h', quickPrudent: false, auctionBubble: true, auctionNotify: true, autoReload: true,
    autoDefaultMode: 'time', autoDefaultSecs: 35, autoCapMode: 'avg', autoCapW: 100, autoCapPct: 20, autoDefaultOn: false, watchMax: 12, autoSell: false, autoSellTags: 'VENTE', autoSellMax: 3, autoSellCap: 500, autoSellOrder: 'avg', autoSellPriorityRar: '', autoSellStrict: true, quickNoSalePrice: 10, cardStyle: true, cardShowDesc: true, cardShowStats: true,
  };

  // La mise à jour automatique n'existe que dans la version de développement (permission « alarms ») : absente de la version publiée.
  const devBuild = () => { try { return !!chrome.runtime.getManifest().permissions?.includes('alarms'); } catch (_) { return false; } };

  const SECTIONS = [
    {
      title: 'Révélation',
      desc: 'Animation et ordre d’affichage des cartes après l’ouverture.',
      items: [
        { key: 'speed', type: 'select', label: 'Vitesse de révélation', desc: 'Durée des secousses et des retournements.',
          options: [['normal', 'Normale'], ['fast', 'Rapide'], ['instant', 'Instantanée']] },
        { key: 'order', type: 'select', label: 'Ordre des cartes', desc: 'Du plus commun au plus rare, ou dans l’ordre du tirage.',
          options: [['rarity', 'Par rareté'], ['draw', 'Du tirage']] },
        { key: 'images', type: 'toggle', label: 'Images et descriptions Wikipédia', desc: 'Affiche l’illustration et la description de chaque carte (une requête vers Wikipédia par carte).' },
      ],
    },
    {
      title: 'Ouverture automatique',
      desc: 'À chaque fin d’intervalle, « Ouvrir automatiquement » ouvre tous les paquets disponibles (au-dessus de la réserve).',
      items: [
        { key: 'stopOn', type: 'select', label: 'S’arrêter sur une belle carte', desc: 'Arrête l’ouverture auto dès qu’une carte de cette rareté (ou mieux) est tirée.',
          options: [['off', 'Jamais'], ['SR', 'SR ou mieux'], ['UR', 'UR ou mieux'], ['L', 'Légendaire']] },
        { key: 'reserve', type: 'select', label: 'Réserve de paquets', desc: 'Paquets gardés en stock : l’auto n’ouvre que s’il en reste plus.', number: true,
          options: [...Array(10).keys()].map((i) => [i, plural(i, 'paquet')]) },
        { key: 'fullStockOpen', type: 'toggle', label: 'Ouvrir quand le stock est plein', desc: 'À 10/10, ouvre aussitôt les paquets au-dessus de la réserve pour ne pas bloquer la régénération.' },
        { key: 'anticipate', type: 'toggle', label: 'Anticiper le blocage du stock', desc: 'Ouvre un paquet plus tôt si le stock risque d’être plein avant la prochaine ouverture planifiée.' },
      ],
    },
    {
      title: 'Enchère rapide',
      desc: 'Réglages du bouton ⚡ de la collection : prix de départ = moyenne du marché × coefficient.',
      items: [
        { key: 'quickCoef', type: 'number', min: 0.1, max: 3, step: 0.05, label: 'Coefficient du prix de départ', desc: 'Appliqué à la moyenne du marché, arrondi à l\u2019entier (1 W minimum). 0,9 = 10 % sous la moyenne.' },
        { key: 'quickNoSalePrice', type: 'number', min: 1, max: 1000000, step: 1, label: 'Prix de départ sans moyenne (W)', desc: 'Pour une carte sans aucune vente sur le marché (« Sans vente ») : prix de départ utilisé à la place de la moyenne. 10 W par défaut.' },
        { key: 'quickDuration', type: 'select', label: 'Durée de l\u2019enchère', desc: 'Durée proposée par défaut (celles du jeu).',
          options: [['10min', '10 min'], ['30min', '30 min'], ['1h', '1 h'], ['3h', '3 h'], ['6h', '6 h'], ['12h', '12 h']] },
        { key: 'quickPrudent', type: 'toggle', label: 'Mode prudent', desc: 'Le prix de départ ne dépasse pas 1,2 fois la dernière vente.' },
      ],
    },
    {
      title: 'Assistant de vente',
      desc: 'Garde des enchères actives avec vos cartes portant certaines étiquettes, et remet en vente celles qui n’ont pas trouvé preneur. Même prix de départ et même durée que le bouton ⚡. Pour vendre des cartes précises, donnez-leur l’étiquette (sélection du jeu → étiquette).',
      items: [
        { key: 'autoSell', type: 'toggle', label: 'Activer l’assistant de vente', desc: 'Désactivé par défaut : une fois activé, il met de vraies cartes en vente tout seul (jamais une favorite).' },
        { type: 'action', label: 'État de l’assistant', desc: 'Pourquoi il met (ou ne met pas) telle carte en vente, prochaines cartes, cartes écartées. Aussi dans la bulle des enchères.', button: 'Voir les détails', run: () => WMX.autoSell?.openPanel() },
        { type: 'action', label: 'Forcer une passe', desc: 'Lance tout de suite une passe de l’assistant, sans attendre la prochaine (toutes les 45 s).', button: 'Lancer maintenant', run: () => WMX.autoSell?.runNow() },
        { key: 'autoSellTags', type: 'tags', label: 'Étiquettes à vendre', desc: 'Cochez une ou plusieurs étiquettes de votre compte. Seules les cartes qui en portent une sont concernées.' },
        { key: 'autoSellCap', type: 'number', min: 1, max: 1000000, step: 10, label: 'Prix de départ maximum (W)', desc: 'Garde-fou : l’assistant ne met jamais en vente une carte dont le prix de départ dépasserait ce montant (500 W par défaut). Pour une carte plus chère, utilisez le bouton ⚡ vous-même.' },
        { key: 'autoSellMax', type: 'number', min: 1, max: 10, step: 1, label: 'Enchères actives visées', desc: 'L’assistant complète jusqu’à ce nombre d’enchères en cours (vos ventes manuelles comptent). 10 = limite du jeu.' },
        { key: 'autoSellPriorityRar', type: 'rarityOrder', label: 'Raretés à vendre', desc: '« Toutes les raretés » : aucune restriction. « Seulement celles-ci » : l’assistant ne vend QUE les raretés de la liste, dans leur ordre (n°1 d’abord). Les cartes étiquetées d’une autre rareté ne sont jamais mises en vente. Quand il n’en reste plus, la bulle des enchères le dit.' },
        { key: 'autoSellStrict', type: 'toggle', label: 'Une rareté à la fois', desc: 'Activé (recommandé) : la rareté n°2 n’est mise en vente que lorsqu’il ne reste plus aucune carte n°1 à vendre, y compris celles déjà en vente qui pourraient revenir invendues. Les places restent libres en attendant. Désactivé : les places libres sont complétées avec la rareté suivante. Une favorite ou une carte au-dessus du prix maximum ne retient jamais la liste.' },
        { key: 'autoSellOrder', type: 'select', label: 'Ordre dans une même rareté', desc: 'Quelles cartes l’assistant met en vente en premier (sans liste de raretés : parmi toutes les cartes étiquetées).',
          options: [['avg', 'Meilleure moyenne d’abord'], ['avgLow', 'Moyenne la plus basse d’abord'], ['rarityHigh', 'Raretés les plus hautes d’abord'], ['rarityLow', 'Raretés les plus basses d’abord']] },
      ],
    },
    {
      title: 'Enchères',
      desc: 'Bulle flottante : vos mises et vos ventes en cours, avec « Surenchérir » (mise exacte du minimum proposé).',
      items: [
        { key: 'auctionBubble', type: 'toggle', label: 'Bulle flottante des enchères', desc: 'Affichée en bas à droite sur toutes les pages du jeu ; actualisée chaque minute (toutes les 8 s quand elle est ouverte).' },
        { key: 'auctionNotify', type: 'toggle', label: 'Alertes d’enchères', desc: 'Notification quand vous êtes surenchéri ou qu’une de vos enchères passe sous 2 minutes (le navigateur demande l’autorisation au premier clic sur la bulle).' },
      ],
    },
    {
      title: 'Mises automatiques',
      desc: 'Réglages proposés par défaut quand vous programmez une mise automatique (bouton ⏱ d’une mise). Elle mise toujours le minimum du jeu.',
      items: [
        { key: 'autoDefaultMode', type: 'select', label: 'Déclencheur par défaut', desc: 'Quand miser automatiquement.',
          options: [['time', 'Sous un délai avant la fin (surenchère à chaque fois)'], ['outbid', 'Dès que je suis surenchéri']] },
        { key: 'autoDefaultSecs', type: 'number', min: 5, max: 3600, step: 5, label: 'Délai avant la fin (secondes)', desc: 'Pour « sous un délai » : tant que le compteur est en dessous, on surenchérit à chaque fois qu’un autre joueur nous dépasse. Gardez une marge : le délai de réponse du jeu dépend de votre connexion (au moins 20 s).' },
        { key: 'autoCapMode', type: 'select', label: 'Plafond par défaut', desc: 'Limite au-delà de laquelle l’extension ne mise plus.',
          options: [['avg', 'Selon la moyenne du marché'], ['abs', 'Valeur fixe en W'], ['none', 'Aucun plafond']] },
        { key: 'autoCapPct', type: 'number', min: -90, max: 500, step: 5, label: 'Écart à la moyenne (%)', desc: 'Pour le plafond « selon la moyenne » : +30 = jusqu’à 30 % au-dessus de la moyenne, 0 = à la moyenne, −10 = en dessous.' },
        { key: 'autoCapW', type: 'number', min: 1, max: 100000, step: 1, label: 'Plafond fixe (W)', desc: 'Pour le plafond « valeur fixe ».' },
        { key: 'watchMax', type: 'number', min: 1, max: 50, step: 1, label: 'Surveillances en même temps (maximum)', desc: 'Nombre d’enchères que vous pouvez surveiller avec « Surveiller ». Chaque enchère surveillée est relue régulièrement auprès du jeu : plus il y en a, plus l’extension envoie de requêtes (12 par défaut, prudent).' },
        { key: 'autoDefaultOn', type: 'toggle', label: 'Appliquer aux nouvelles mises', desc: 'Programme automatiquement ces réglages sur chaque nouvelle mise que vous placez (désactivé par défaut).' },
      ],
    },
    {
      title: 'Aspect des cartes',
      desc: 'Apparence des cartes dans la page Collection.',
      items: [
        { key: 'cardShowDesc', type: 'toggle', label: 'Afficher la description', desc: 'Courte description Wikipédia sous le titre de la carte. Masquée, le titre peut tenir sur trois lignes.' },
        { key: 'cardShowStats', type: 'toggle', label: 'Afficher l’attaque et la défense', desc: 'Les deux valeurs en bas de chaque carte (épées et bouclier).' },
        { key: 'cardStyle', type: 'toggle', label: 'Style de carte plein cadre', desc: 'Illustration sur toute la carte, texte sur dégradé, cadre à la couleur de la rareté, vagues fines et reflet. Désactivez pour revoir les cartes du jeu telles quelles (actualisez la page).' },
      ],
    },
    {
      title: 'Extension', dev: true,
      desc: 'Pour les essais : l’extension surveille son dossier et se recharge quand une nouvelle version y est déposée.',
      items: [
        { key: 'autoReload', type: 'toggle', label: 'Mise à jour automatique', desc: 'Vérifie chaque minute ; après un rechargement, actualisez l’onglet du jeu (F5).' },
      ],
    },
    {
      title: 'Journal d’activité',
      desc: 'Les derniers événements de l’extension (file d’attente, assistant de vente, incidents), gardés sur cet ordinateur.',
      items: [
        { type: 'action', label: 'Journal', desc: 'Ce que l’extension a fait et ce qui a échoué, avec l’heure.', button: 'Afficher', run: () => WMX.journal.show() },
        { type: 'action', label: 'Diagnostic', desc: 'Copie le journal pour le transmettre en cas de problème.', button: 'Copier', run: () => WMX.journal.copy() },
        { type: 'action', label: 'Activité en direct', desc: 'Ce que l’extension fait en arrière-plan : pages du jeu cachées, enchères surveillées, requêtes envoyées au jeu, fluidité de la page (tâches qui bloquent le défilement).', button: 'Afficher', run: () => WMX.activity?.open() },
      ],
    },
    {
      title: 'Données',
      desc: 'Historique de vos tirages, conservé sur cet ordinateur.',
      items: [
        { type: 'action', label: 'Historique par jour', desc: 'Paquets, cartes et raretés tirés chaque jour.', button: 'Exporter en CSV', run: () => WMX.stats.exportCsv() },
        { type: 'action', confirm: true, label: 'Réinitialiser les statistiques', desc: 'Remet à zéro le compteur du menu. L\u2019historique par jour est conservé.', button: 'Réinitialiser', run: () => WMX.stats.reset() },
      ],
    },
  ];

  // Menu de gauche : une page par thème, chacune regroupant une ou plusieurs parties ci-dessus (au lieu d'un seul long bloc à faire défiler).
  const GROUPS = [
    { id: 'packs', label: 'Paquets', hint: 'Révélation, ouverture automatique', sections: ['Révélation', 'Ouverture automatique'] },
    { id: 'auctions', label: 'Enchères', hint: 'Bulle, alertes, mises automatiques, surveillance', sections: ['Enchères', 'Mises automatiques'] },
    { id: 'sell', label: 'Vente', hint: 'Enchère rapide ⚡, assistant de vente', sections: ['Enchère rapide', 'Assistant de vente'] },
    { id: 'cards', label: 'Aspect des cartes', hint: 'Style, description, attaque et défense', sections: ['Aspect des cartes'] },
    { id: 'data', label: 'Journal et données', hint: 'Journal d’activité, diagnostic, historique', sections: ['Journal d’activité', 'Données', 'Extension'] },
  ];
  let lastGroup = 'packs';

  /**
   * Enregistre UNIQUEMENT les réglages donnés, par-dessus ce qui est déjà enregistré : un onglet resté ouvert avec d'anciens réglages
   * n'écrase plus ceux qu'un autre onglet a changés (l'assistant de vente se retrouvait ainsi désactivé sans que personne ne l'ait demandé).
   */
  WMX.updateSettings = async (patch) => {
    const stored = await WMX.store.get('wmxSettings', {});
    const next = { ...WMX.settings, ...stored, ...patch };
    Object.assign(WMX.settings, next);
    await WMX.store.set('wmxSettings', next);
    WMX.applySettings?.();
    window.dispatchEvent(new CustomEvent('wmx:settings')); // les pages se mettent à jour sans rechargement
  };

  /** Ouvre les réglages ; `sectionTitle` (ex. « Mises automatiques ») fait défiler jusqu'à cette partie et la met en évidence un instant. */
  WMX.openSettings = function openSettings(sectionTitle = '') {
    if (document.querySelector('.wmx-modal-backdrop')) return;
    const initial = { ...WMX.settings }; // pour ne sauvegarder que ce que l'utilisateur a réellement modifié
    let draft = { ...WMX.settings };
    const content = el('div', { class: 'wmx-modal-body wmx-set-page' });
    const nav = el('nav', { class: 'wmx-set-nav', 'aria-label': 'Rubriques des paramètres' });
    const visible = SECTIONS.filter((sec) => !sec.dev || devBuild());
    let group = GROUPS.find((g) => g.sections.includes(sectionTitle))?.id || lastGroup;

    const control = (it) => {
      if (it.type === 'select') {
        const s = el('select', { class: 'wmx-input wmx-select' }, ...it.options.map(([v, l]) => el('option', { value: String(v) }, l)));
        s.value = String(draft[it.key]);
        s.addEventListener('change', () => { draft[it.key] = it.number ? Number(s.value) : s.value; });
        return s;
      }
      if (it.type === 'rarityOrder') {
        // Raretés à vendre, dans l'ordre : la n°1 est traitée d'abord, puis la n°2… « Toutes les raretés » : aucune restriction. Valeur : codes séparés par des virgules (ex. « UR,SR »).
        const NAMES = { L: 'Légendaire', UR: 'Ultra rare', SR: 'Super rare', R: 'Rare', PC: 'Peu commune', C: 'Commune' };
        const wrap = el('div', { class: 'wmx-rord' });
        const get = () => [...new Set(String(draft[it.key] || '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => NAMES[x]))];
        const set = (arr) => { draft[it.key] = arr.join(','); draw(); };
        const badge = (r) => el('b', { class: 'wmx-rord-r', style: `--rgb:${WMX.RARITY_RGB?.[r] || '160 175 168'}` }, r);
        const btn = (label, title, onClick, extra = {}) => { const b = el('button', { type: 'button', class: 'wmx-rord-btn', title, 'aria-label': title, ...extra }, label); b.addEventListener('click', onClick); return b; };
        const draw = () => {
          const ord = get();
          const rest = Object.keys(NAMES).filter((r) => !ord.includes(r));
          const mode = (label, on, onClick) => { const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(on) }, label); b.addEventListener('click', onClick); return b; };
          wrap.replaceChildren(
            el('div', { class: 'wmx-seg' }, mode('Toutes les raretés', !ord.length, () => set([])), mode('Seulement celles-ci', !!ord.length, () => { if (!ord.length) set(['UR']); })),
            ...(ord.length ? [el('ol', { class: 'wmx-rord-list' }, ...ord.map((r, i) => el('li', {}, el('span', { class: 'wmx-rord-n' }, `n°${i + 1}`), badge(r), el('span', { class: 'wmx-rord-name' }, NAMES[r]),
              btn('↑', 'Monter', () => { const a = [...ord]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(a); }, i ? {} : { disabled: '' }),
              btn('↓', 'Descendre', () => { const a = [...ord]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set(a); }, i < ord.length - 1 ? {} : { disabled: '' }),
              btn('×', 'Retirer de la liste', () => set(ord.filter((x) => x !== r))))))] : []),
            ...(ord.length && rest.length ? [el('div', { class: 'wmx-rord-add' }, el('small', {}, 'Ajouter :'), ...rest.map((r) => btn(r, `Ajouter ${NAMES[r]}`, () => set([...ord, r]), { class: 'wmx-rord-btn wmx-rord-plus' })))] : []));
        };
        draw();
        return wrap;
      }
      if (it.type === 'number') {
        const i = el('input', { class: 'wmx-input', type: 'number', min: String(it.min), max: String(it.max), step: String(it.step), value: String(draft[it.key]) });
        i.addEventListener('change', () => {
          const v = Number(i.value);
          if (Number.isFinite(v)) draft[it.key] = Math.min(it.max, Math.max(it.min, v));
          i.value = String(draft[it.key]);
        });
        return i;
      }
      if (it.type === 'tags') {
        // Menu déroulant à cases à cocher : les étiquettes réelles du compte (d'après l'inventaire), avec leur nombre de cartes.
        const chosen = () => String(draft[it.key] || '').split(',').map((s) => s.trim()).filter(Boolean);
        const known = () => {
          const m = new Map();
          for (const card of WMX.inventory?.items?.() || []) for (const t of card.tags || []) {
            const k = String(t.name).trim().toLowerCase();
            const e = m.get(k) || { name: String(t.name).trim(), n: 0 };
            e.n += 1; m.set(k, e);
          }
          for (const s of chosen()) if (!m.has(s.toLowerCase())) m.set(s.toLowerCase(), { name: s, n: 0 }); // étiquette choisie mais plus vue (inventaire pas chargé)
          return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        };
        const label = () => { const c = chosen(); return c.length ? c.join(', ') : 'Choisir des étiquettes…'; };
        const btn = el('button', { class: 'wmx-input wmx-select wmx-tagbtn', type: 'button', 'aria-haspopup': 'listbox', title: 'Étiquettes de votre compte' }, label());
        const panel = el('div', { class: 'wmx-tagpanel', role: 'listbox', hidden: true });
        const drawPanel = () => {
          const list = known();
          panel.replaceChildren(...(list.length ? list.map((t) => {
            const cb = WMX.dom.checkbox({ checked: chosen().some((s) => s.toLowerCase() === t.name.toLowerCase()) });
            cb.addEventListener('change', () => {
              const rest = chosen().filter((s) => s.toLowerCase() !== t.name.toLowerCase());
              draft[it.key] = (cb.checked ? [...rest, t.name] : rest).join(', ');
              btn.textContent = label();
            });
            return el('label', { class: 'wmx-tagopt' }, cb, el('span', {}, t.name), el('small', {}, t.n ? String(t.n) : ''));
          }) : [el('p', { class: 'wmx-jempty' }, 'Aucune étiquette trouvée : l’inventaire est peut-être encore en cours de chargement.')]));
        };
        const wrap = el('div', { class: 'wmx-tagpick' }, btn, panel);
        // La liste est positionnée par rapport à l'écran (et non à la zone défilante des réglages, qui la coupait) : elle s'ouvre
        // vers le bas, ou vers le haut s'il y a plus de place, et sa hauteur s'adapte à l'espace disponible.
        const place = () => {
          const r = btn.getBoundingClientRect();
          const vh = window.innerHeight;
          const below = vh - r.bottom - 12;
          const above = r.top - 12;
          const up = below < 200 && above > below;
          Object.assign(panel.style, {
            left: `${r.left}px`, width: `${r.width}px`, maxHeight: `${Math.max(120, Math.min(320, up ? above : below))}px`,
            top: up ? 'auto' : `${r.bottom + 4}px`, bottom: up ? `${vh - r.top + 4}px` : 'auto',
          });
        };
        const closePanel = () => {
          panel.hidden = true;
          document.removeEventListener('mousedown', outside, true);
          window.removeEventListener('scroll', place, true);
          window.removeEventListener('resize', place);
        };
        const outside = (e) => { if (!wrap.contains(e.target)) closePanel(); };
        btn.addEventListener('click', () => {
          if (!panel.hidden) { closePanel(); return; }
          drawPanel(); panel.hidden = false; place();
          document.addEventListener('mousedown', outside, true);
          window.addEventListener('scroll', place, true);
          window.addEventListener('resize', place);
        });
        return wrap;
      }
      if (it.type === 'text') {
        const i = el('input', { class: 'wmx-input', type: 'text', value: String(draft[it.key] ?? ''), placeholder: 'VENTE' });
        i.addEventListener('input', () => { draft[it.key] = i.value; });
        return i;
      }
      if (it.type === 'toggle') {
        const b = el('button', { class: 'wmx-switch', role: 'switch', 'aria-checked': String(!!draft[it.key]) });
        b.addEventListener('click', () => { draft[it.key] = !draft[it.key]; b.setAttribute('aria-checked', String(draft[it.key])); });
        return b;
      }
      const b = el('button', { class: 'wmx-btn wmx-btn--ghost' }, it.button);
      b.addEventListener('click', () => {
        if (it.confirm && !b.dataset.armed) { // deuxième clic requis pour confirmer
          b.dataset.armed = '1';
          b.textContent = 'Confirmer ?';
          b.classList.add('wmx-btn--danger');
          setTimeout(() => { delete b.dataset.armed; b.textContent = it.button; b.classList.remove('wmx-btn--danger'); }, 4000);
          return;
        }
        it.run();
        if (it.confirm) { delete b.dataset.armed; b.textContent = 'Fait'; b.classList.remove('wmx-btn--danger'); }
      });
      return b;
    };

    const render = () => {
      lastGroup = group;
      nav.replaceChildren(...GROUPS.filter((g) => visible.some((sec) => g.sections.includes(sec.title))).map((g) => {
        const b = el('button', { type: 'button', class: 'wmx-set-navbtn', 'aria-current': g.id === group ? 'page' : 'false' }, el('b', {}, g.label), el('small', {}, g.hint));
        b.addEventListener('click', () => { if (group === g.id) return; group = g.id; render(); content.scrollTop = 0; });
        return b;
      }));
      const g = GROUPS.find((x) => x.id === group) || GROUPS[0];
      content.replaceChildren(...visible.filter((sec) => g.sections.includes(sec.title)).map((sec) => el('section', { class: 'wmx-sec' },
        el('h3', {}, sec.title), el('p', {}, sec.desc),
        el('div', { class: 'wmx-rows' }, ...sec.items.map((it) =>
          el('div', { class: 'wmx-setrow' }, el('div', {}, el('strong', {}, it.label), el('small', {}, it.desc)), control(it)))))));
    };
    render();

    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const modal = el('div', { class: 'wmx-modal wmx-modal--nav', role: 'dialog', 'aria-label': 'Paramètres de l’extension' },
      el('header', {}, el('div', {}, el('h2', {}, 'Paramètres de l’extension'), el('p', {}, 'Réglez uniquement ce dont vous avez besoin.')),
        el('button', { class: 'wmx-close', title: 'Fermer', onclick: close }, '×')),
      el('div', { class: 'wmx-set-layout' }, nav, content),
      el('footer', {}, el('span', {}, 'Les changements s’appliquent avec « Appliquer ».'),
        el('div', {},
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { draft = { ...WMX.DEFAULTS }; render(); } }, 'Valeurs par défaut'),
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'),
          el('button', { class: 'wmx-btn', onclick: () => {
            const changed = Object.fromEntries(Object.keys(draft).filter((k) => draft[k] !== initial[k]).map((k) => [k, draft[k]]));
            WMX.updateSettings(changed);
            close();
          } }, 'Appliquer'))));
    const backdrop = el('div', { class: 'wmx-modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, modal);
    document.body.append(backdrop);
    if (sectionTitle) {
      const sec = [...content.querySelectorAll('section.wmx-sec')].find((s) => s.querySelector('h3')?.textContent === sectionTitle);
      if (sec) {
        sec.classList.add('wmx-sec-hl');
        sec.scrollIntoView?.({ block: 'start' });
        setTimeout(() => sec.classList.remove('wmx-sec-hl'), 2600);
      }
    }
  };
})();
