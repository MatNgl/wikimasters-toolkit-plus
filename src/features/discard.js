// Défausse par critères (page Collection) : bouton « Défausser… » dans la barre de la collection → fenêtre de sélection (raretés, étiquette,
// options) → fenêtre de confirmation → l'extension pilote la SÉLECTION NATIVE du jeu, page par page : « Sélectionner », « Tout sélectionner
// (page) » (ou cases une à une), vérification du compteur « N cartes sélectionnées », « Défausser », vérification de la fenêtre du jeu
// (« N × C »…) puis confirmation. Rien n'est défaussé si un nombre ne correspond pas à ce qui a été confirmé.
// Garde-fous : jamais une favorite, jamais une carte en vente ou en file d'attente ; « Essai à blanc » (coché par défaut) fait tout sauf la
// confirmation finale ; une défausse ne reprend jamais toute seule après un rechargement ; bouton « Arrêter » à tout moment.
(() => {
  const { el, sleep } = WMX.dom;
  const R = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  const NAMES = { C: 'Commune', PC: 'Peu commune', R: 'Rare', SR: 'Super rare', UR: 'Ultra rare', L: 'Légendaire' };
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const key = (s) => norm(s).toLowerCase();
  const plural = (n, w, p = `${w}s`) => `${fmt(n)} ${n > 1 ? p : w}`;
  const DEFAULTS = { rarities: ['C'], tags: [], includeTagged: false, keepOne: false, useMax: true, maxAvg: 20, unpriced: 'keep', protectSale: true, onlyNoImage: false, keepRecent: false, protectTags: [] };
  let prefs = { ...DEFAULTS };
  const savePrefs = () => WMX.store.set('discardPrefs', prefs);
  const run = { on: false, stop: false };
  const S = { tagOpen: false }; // menu des étiquettes ouvert dans la fenêtre de sélection

  // ---- quelles cartes ----
  const saleTags = () => String(WMX.settings?.autoSellTags || '').split(',').map((t) => t.trim()).filter(Boolean);
  function plan(p = prefs) {
    const items = WMX.inventory.items();
    const day = Date.now() - 24 * WMX.logic.HOUR;
    const busy = new Set(items.filter((it) => WMX.quick?.stateOf(it.card_id) && WMX.quick.stateOf(it.card_id) !== 'idle').map((it) => it.card_id));
    const recent = p.keepRecent ? items.filter((it) => it.at && new Date(it.at).getTime() > day) : [];
    const recentIds = new Set(recent.map((it) => it.card_id));
    const res = WMX.logic.discardPlan(items.filter((it) => !recentIds.has(it.card_id)), {
      rarities: p.rarities, tags: p.tags || [], includeTagged: p.includeTagged, keepOne: p.keepOne, maxAvg: p.useMax ? Number(p.maxAvg) || 0 : 0,
      // Le prix ne compte que pour le seuil : sans seuil, une carte au prix inconnu est traitée comme les autres. Avec le seuil : « défausser »,
      // sinon gardée pour l'instant (« attendre » et « en dernier » chargent son prix pendant la défausse, voir start()).
      unpriced: !p.useMax || unpricedMode(p) === 'discard' ? 'discard' : 'keep', onlyNoImage: p.onlyNoImage, busy,
      protectTags: [...(p.protectTags || []), ...(p.protectSale ? saleTags() : [])],
      avg: (it) => WMX.prices.get(it.card_id, it.rarity)?.avg || 0, priced: (it) => WMX.prices.has(it.card_id),
    });
    const inScope = recent.filter((it) => (p.rarities.length ? p.rarities.includes(it.rarity) : (p.tags || []).length > 0)).length;
    if (inScope) res.kept.recent = inScope;
    return res;
  }
  /** Cartes au prix jamais chargé : 'keep' (gardées), 'discard' (défaussées), 'wait' (prix chargés avant de commencer), 'last' (traitées à la fin). */
  const unpricedMode = (p) => (['keep', 'discard', 'wait', 'last'].includes(p.unpriced) ? p.unpriced : p.keepUnpriced === false ? 'discard' : 'keep');
  const UNPRICED = [['keep', 'Les garder'], ['wait', 'Attendre leur prix (chargé avant de commencer)'], ['last', 'Les traiter en dernier (prix chargé pendant la défausse)'], ['discard', 'Les défausser aussi']];
  const KEPT = { favorite: 'favorites', busy: 'en vente ou en file', protected: 'étiquette protégée', image: 'avec image', value: 'au-dessus du seuil', unpriced: 'prix jamais chargé', single: 'un seul exemplaire', recent: 'obtenues depuis moins de 24 h' };
  /** Cartes au prix inconnu qui seront vérifiées (prix chargé avant ou pendant la défausse) : elles comptent pour pouvoir continuer. */
  const toCheck = (pl, p) => (p.useMax && ['wait', 'last'].includes(unpricedMode(p)) ? (pl.unpricedCards || []).length : 0);
  /** Durée estimée du chargement de n prix (une requête toutes les ~0,8 s en moyenne). */
  const loadTime = (n) => { const m = Math.ceil((n * 0.8) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  /** Croix de fermeture en haut à droite d'une fenêtre. */
  const closeX = (onClick) => el('button', { type: 'button', class: 'wmx-dlg-x', title: 'Fermer', 'aria-label': 'Fermer', onclick: onClick }, '×');
  const keptText = (kept) => Object.entries(kept).filter(([, n]) => n).map(([k, n]) => `${fmt(n)} ${KEPT[k] || k}`).join(' · ');
  const byRarText = (byRar) => R.slice().reverse().filter((r) => byRar[r]).map((r) => `${fmt(byRar[r])} × ${r}`).join(' · ');

  // ---- petits éléments ----
  const sw = (on, onChange, label, desc) => {
    const b = el('button', { type: 'button', class: 'wmx-switch', role: 'switch', 'aria-checked': String(!!on) });
    b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange(v); });
    return el('label', { class: 'wmx-dc-opt' }, el('span', {}, el('b', {}, label), desc ? el('small', {}, desc) : ''), b);
  };
  const chip = (label, rgb, on, onToggle) => {
    const b = el('button', { type: 'button', class: 'wmx-chip2', 'aria-pressed': String(on), style: rgb ? `--rgb:${rgb}` : '' }, label);
    b.addEventListener('click', () => onToggle(b.getAttribute('aria-pressed') !== 'true'));
    return b;
  };
  function tagList() {
    const m = new Map();
    for (const it of WMX.inventory.items()) for (const t of it.tags || []) { const k = key(t.name); const e = m.get(k) || { name: norm(t.name), n: 0 }; e.n += 1; m.set(k, e); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }

  // ---- fenêtre 1 : sélection ----
  function openPicker() {
    if (document.querySelector('.wmx-dc')) return;
    if (run.on) return WMX.toast?.('Une défausse est déjà en cours.', 4000);
    if (!WMX.inventory.items().length) return WMX.toast?.('La collection est encore en cours de chargement : réessayez dans un instant.', 5000);
    const body = el('div', { class: 'wmx-pm-body' });
    const go = el('button', { class: 'wmx-btn wmx-btn--danger' }, 'Continuer');
    let unsub = null;
    const close = () => { back.remove(); unsub?.(); };
    go.addEventListener('click', () => { const pl = plan(); if (!partial() && (pl.copies || toCheck(pl, prefs))) { close(); openConfirm(pl, { ...prefs }); } });
    // Un clic à côté de la fenêtre ne la ferme pas (trop facile à faire par erreur) : la croix ou « Annuler ».
    // Un clic ailleurs dans la fenêtre referme le menu des étiquettes.
    const dlg = el('div', { class: 'wmx-dlg wmx-dlg--wide', role: 'dialog', 'aria-label': 'Défausser des cartes' },
      closeX(() => close()),
      el('h3', {}, 'Défausser des cartes'),
        el('p', { class: 'wmx-dlg-note' }, 'Choisissez les cartes à défausser. Les favorites et les cartes en vente ne sont jamais défaussées. Une confirmation vous sera demandée avant toute défausse.'),
      body,
      el('div', { class: 'wmx-dlg-row' }, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'), go));
    dlg.addEventListener('mousedown', (e) => {
      if (S.tagOpen && !e.target.closest('.wmx-dc-tag, .wmx-dc-tagpanel')) { S.tagOpen = false; render(); }
    });
    const back = el('div', { class: 'wmx-dlg-back wmx-dc' }, dlg);
    /** Collection pas encore lue en entier (première lecture, sans copie en mémoire) : les nombres montent encore, on ne peut pas continuer. */
    const partial = () => WMX.inventory.isLoading() && WMX.inventory.age() === Infinity;
    function set(patch) { Object.assign(prefs, patch); savePrefs(); render(); }
    /** « Cartes au prix inconnu » : que faire des cartes dont la moyenne n'a jamais été chargée (seuil activé). */
    function unpricedRow(n) {
      const sel = el('select', { class: 'wmx-input wmx-select wmx-dc-unpriced' }, ...UNPRICED.map(([v, l]) => el('option', { value: v }, l)));
      sel.value = unpricedMode(prefs);
      sel.addEventListener('change', () => set({ unpriced: sel.value }));
      return el('label', { class: 'wmx-dc-opt wmx-dc-optcol' }, el('span', {}, el('b', {}, 'Cartes au prix inconnu'),
        el('small', {}, `Leur moyenne n’a jamais été chargée : impossible de savoir si elles dépassent le seuil.${n ? ` ${plural(n, 'carte')} concernée${n > 1 ? 's' : ''}.` : ''}`)), sel);
    }
    function render() {
      const items = WMX.inventory.items();
      const tags = tagList();
      // Menu déroulant à cases : une ou plusieurs étiquettes. Aucune cochée : les cartes SANS étiquette de ces raretés.
      const chosen = (prefs.tags || []).filter((x) => tags.some((t) => key(t.name) === key(x)));
      const tagBtn = el('button', { type: 'button', class: 'wmx-input wmx-select wmx-dc-tag', 'aria-haspopup': 'listbox', 'aria-expanded': String(!!S.tagOpen) },
        chosen.length ? `Étiquettes : ${chosen.join(', ')}` : 'Cartes sans étiquette (aucune étiquette choisie)');
      tagBtn.addEventListener('click', () => { S.tagOpen = !S.tagOpen; render(); });
      const tagPanel = el('div', { class: 'wmx-dc-tagpanel', role: 'listbox', 'aria-multiselectable': 'true' },
        ...(tags.length ? tags.map((t) => {
          const on = chosen.some((x) => key(x) === key(t.name));
          const box = el('input', { type: 'checkbox' }); box.checked = on;
          const row = el('label', { class: 'wmx-dc-tagrow', role: 'option', 'aria-selected': String(on) }, box, el('span', {}, t.name), el('small', {}, fmt(t.n)));
          box.addEventListener('change', () => set({ tags: box.checked ? [...chosen, t.name] : chosen.filter((x) => key(x) !== key(t.name)) }));
          return row;
        }) : [el('span', { class: 'wmx-cp-empty' }, 'Aucune étiquette dans la collection')]));
      if (!S.tagOpen) tagPanel.hidden = true;
      const maxIn = el('input', { class: 'wmx-input', type: 'number', min: '1', max: '100000', step: '1', value: String(prefs.maxAvg) });
      maxIn.addEventListener('change', () => { const v = Math.max(1, Math.round(Number(maxIn.value) || 20)); set({ maxAvg: v }); });
      const pl = plan();
      const unpricedN = pl.kept.unpriced || 0;
      const check = toCheck(pl, prefs);
      const noRar = !prefs.rarities.length;
      const loading = partial();
      const parts = [
        ...(loading ? [el('div', { class: 'wmx-dc-loading', role: 'status' }, el('b', {}, 'Lecture de votre collection en cours…'),
          el('small', {}, `${fmt(WMX.inventory.loaded?.() || items.length)} cartes lues pour l’instant : les nombres augmentent jusqu’à la fin de la lecture (quelques minutes la première fois, ensuite elle est gardée en mémoire). Vous pourrez continuer une fois la lecture terminée.`))] : []),
        el('div', { class: 'wmx-dc-hrow' }, el('div', { class: 'wmx-dc-h' }, 'Raretés'),
          noRar ? (chosen.length ? el('span', { class: 'wmx-dc-hint' }, 'aucune cochée : toutes les raretés des étiquettes choisies') : el('span', { class: 'wmx-dc-err', role: 'alert' }, 'Choisissez au moins une rareté ou une étiquette')) : ''),
        el('div', { class: 'wmx-pm-chips' }, ...R.map((r) => chip(`${r} · ${fmt(items.filter((i) => i.rarity === r).reduce((n, i) => n + (i.count || 1), 0))}`, WMX.RARITY_RGB?.[r], prefs.rarities.includes(r),
          (on) => set({ rarities: on ? [...new Set([...prefs.rarities, r])] : prefs.rarities.filter((x) => x !== r) })))),
        el('div', { class: 'wmx-dc-h' }, 'Étiquettes'),
        tagBtn, tagPanel,
      ];
      if (!chosen.length) parts.push(sw(prefs.includeTagged, (v) => set({ includeTagged: v }), 'Défausser aussi les cartes étiquetées', 'Désactivé : seules les cartes sans aucune étiquette sont concernées.'));
      if (!chosen.length && prefs.includeTagged) {
        parts.push(el('div', { class: 'wmx-dc-h' }, 'Étiquettes à protéger (jamais défaussées)'),
          el('div', { class: 'wmx-pm-chips wmx-pm-tags' }, ...(tags.length ? tags.map((t) => chip(t.name, '', (prefs.protectTags || []).some((x) => key(x) === key(t.name)),
            (on) => set({ protectTags: on ? [...(prefs.protectTags || []), t.name] : (prefs.protectTags || []).filter((x) => key(x) !== key(t.name)) })))
            : [el('span', { class: 'wmx-cp-empty' }, 'Aucune étiquette')])));
      }
      parts.push(el('div', { class: 'wmx-dc-h' }, 'Options'),
        sw(prefs.keepOne, (v) => set({ keepOne: v }), 'Garder 1 exemplaire', 'Ne défausse que les doublons : il reste toujours une carte de chaque.'),
        el('div', { class: 'wmx-dc-optrow' }, sw(prefs.useMax, (v) => set({ useMax: v }), 'Seuil de valeur', 'Ne jamais défausser une carte dont la moyenne du marché atteint ce montant (mieux vaut la vendre).'), el('span', { class: 'wmx-dc-w' }, maxIn, ' W')),
        ...(prefs.useMax ? [unpricedRow(unpricedN)] : []),
        sw(prefs.protectSale, (v) => set({ protectSale: v }), 'Protéger les étiquettes de vente', `Jamais une carte portant une étiquette de l’assistant de vente${saleTags().length ? ` (${saleTags().join(', ')})` : ''}.`),
        sw(prefs.onlyNoImage, (v) => set({ onlyNoImage: v }), 'Seulement les cartes sans image', 'Les cartes avec une illustration sont gardées.'),
        sw(prefs.keepRecent, (v) => set({ keepRecent: v }), 'Garder les cartes récentes', 'Obtenues depuis moins de 24 h : le temps de les regarder.'));
      // Prix inconnus avec le seuil : on peut les charger ici (en arrière-plan, la fenêtre se met à jour au fil de l'eau).
      if (unpricedN && prefs.useMax) {
        const st = WMX.prices.state?.() || {};
        parts.push(el('div', { class: 'wmx-dc-prices' },
          el('small', {}, st.running ? `Chargement des prix en cours : ${fmt(st.done || 0)} / ${fmt(st.total || 0)}${st.wait ? ` (pause de ${st.wait} s demandée par le jeu)` : ''}.`
            : `${plural(unpricedN, 'carte')} sans prix connu : leur chargement prend environ ${loadTime(unpricedN)} (une carte à la fois, pour ne pas surcharger le jeu).`),
          st.running ? '' : el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost', onclick: () => { WMX.prices.start(pl.unpricedCards, { total: pl.unpricedCards.length }); render(); } }, 'Charger ces prix maintenant')));
      }
      const kt = keptText(pl.kept);
      const empty = !pl.copies && !check;
      parts.push(el('div', { class: 'wmx-dc-sum', 'data-empty': String(empty) },
        el('b', {}, pl.copies ? `${plural(pl.copies, 'exemplaire')} à défausser` : check ? 'Rien à défausser tout de suite' : (noRar && !chosen.length ? 'Choisissez au moins une rareté ou une étiquette' : 'Aucune carte ne correspond')),
        pl.copies ? el('span', {}, `${byRarText(pl.byRar)} · ${plural(pl.cards.length, 'carte')} · valeur estimée ≈ ${fmt(pl.value)} W`) : '',
        check ? el('span', {}, `+ ${plural(check, 'carte')} au prix inconnu, ${unpricedMode(prefs) === 'wait' ? 'vérifiées avant de commencer' : 'vérifiées pendant la défausse et traitées à la fin'} : celles sous ${fmt(prefs.maxAvg)} W seront défaussées (chargement des prix ≈ ${loadTime(check)}).`) : '',
        kt ? el('small', {}, `Gardées : ${kt}`) : ''));
      if (pl.cards.length) parts.push(preview(pl.cards, 40));
      // Rendu complet à chaque changement (cartes lues, prix arrivés) : le défilement de la fenêtre et du menu des étiquettes est conservé.
      const keepScroll = { dlg: dlg.scrollTop, tags: body.querySelector('.wmx-dc-tagpanel')?.scrollTop || 0 };
      body.replaceChildren(...parts);
      dlg.scrollTop = keepScroll.dlg;
      const tp = body.querySelector('.wmx-dc-tagpanel');
      if (tp) tp.scrollTop = keepScroll.tags;
      go.textContent = loading ? 'Lecture en cours…' : pl.copies ? `Continuer (${fmt(pl.copies)}${check ? ` + ${fmt(check)} à vérifier` : ''})` : check ? `Continuer (${fmt(check)} à vérifier)` : 'Continuer';
      go.disabled = loading || empty;
    }
    document.body.append(back);
    render();
    // Cartes lues ou prix arrivés : la fenêtre se met à jour, mais jamais pendant une saisie (seuil, liste « prix inconnu ») : après.
    let later = false;
    const typing = () => dlg.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
    dlg.addEventListener('focusout', () => setTimeout(() => { if (later && back.isConnected && !typing()) { later = false; render(); } }, 0));
    unsub = WMX.inventory.onChange?.(() => { if (!back.isConnected) return; if (typing()) later = true; else render(); });
  }

  function preview(cards, max) {
    const list = el('div', { class: 'wmx-dc-list' }, ...cards.slice(0, max).map((c) => el('div', { class: 'wmx-dc-row', style: `--rgb:${WMX.RARITY_RGB?.[c.rarity] || '160 175 168'}` },
      el('b', {}, c.rarity), el('span', {}, c.title), el('small', {}, `${c.copies > 1 ? `×${c.copies} · ` : ''}${c.avg ? `Moy. ${fmt(c.avg)} W` : WMX.prices.has(c.card_id) ? 'Sans vente' : 'prix inconnu'}${c.image ? '' : ' · sans image'}`))));
    if (cards.length > max) list.append(el('div', { class: 'wmx-dc-more' }, `… et ${plural(cards.length - max, 'autre carte', 'autres cartes')}`));
    return list;
  }

  // ---- fenêtre 2 : confirmation ----
  function openConfirm(pl, p) {
    let dry = true;
    let ok = false;
    let visible = false;
    const go = el('button', { class: 'wmx-btn wmx-btn--danger', disabled: '' }, '');
    const check = toCheck(pl, p);
    const what = `${fmt(pl.copies)}${check ? ` + ${fmt(check)} à vérifier` : ''}`;
    const paint = () => {
      go.textContent = dry ? `Essai à blanc (${what})` : (pl.copies ? `Défausser ${plural(pl.copies, 'exemplaire')}${check ? ` + ${fmt(check)} à vérifier` : ''}` : `Lancer (${fmt(check)} à vérifier)`);
      if (ok || dry) go.removeAttribute('disabled'); else go.setAttribute('disabled', '');
    };
    const ack = el('label', { class: 'wmx-dc-ack' }, el('input', { type: 'checkbox' }), el('span', {}, 'J’ai compris : une défausse est définitive, les cartes ne reviennent pas.'));
    ack.querySelector('input').addEventListener('change', (e) => { ok = e.target.checked; paint(); });
    const dryOpt = sw(dry, (v) => { dry = v; ack.hidden = v; paint(); }, 'Essai à blanc', 'Coche les cartes dans la sélection du jeu et vérifie la fenêtre de défausse, sans la confirmer. Désactivez pour défausser vraiment.');
    ack.hidden = true;
    const visOpt = sw(visible, (v) => { visible = v; }, 'Mode visible', 'Pilote la page Collection affichée, sous vos yeux (pour les premiers essais). Désactivé : la défausse se fait dans une page invisible, vous pouvez continuer à naviguer.');
    const close = () => back.remove();
    go.addEventListener('click', () => { if (!dry && !ok) return; close(); start(pl, { dry, visible, prefs: p }); });
    const filters = [p.rarities.length ? p.rarities.map((r) => NAMES[r]).join(', ') : 'toutes les raretés', (p.tags || []).length ? `étiquette${p.tags.length > 1 ? 's' : ''} ${p.tags.join(', ')}` : p.includeTagged ? 'étiquetées comprises' : 'sans étiquette',
      p.keepOne && '1 exemplaire gardé', p.useMax && `gardées dès ${p.maxAvg} W`, p.useMax && { keep: 'prix inconnu gardé', discard: 'prix inconnu défaussé', wait: 'prix inconnu chargé avant', last: 'prix inconnu traité en dernier' }[unpricedMode(p)], p.protectSale && 'étiquettes de vente protégées', p.onlyNoImage && 'sans image seulement', p.keepRecent && 'récentes gardées'].filter(Boolean);
    const back = el('div', { class: 'wmx-dlg-back wmx-dc' }, // pas de fermeture au clic à côté : la croix, ou « Modifier »
      el('div', { class: 'wmx-dlg wmx-dlg--wide', role: 'alertdialog', 'aria-label': 'Confirmer la défausse' },
        closeX(close),
        el('h3', {}, pl.copies ? `Défausser ${plural(pl.copies, 'exemplaire')}${check ? ` (+ ${fmt(check)} à vérifier)` : ''} ?` : `Vérifier ${plural(check, 'carte')} au prix inconnu ?`),
        el('div', { class: 'wmx-dc-sum' }, el('b', {}, pl.copies ? byRarText(pl.byRar) : 'Rien à défausser tout de suite'),
          pl.copies ? el('span', {}, `${plural(pl.cards.length, 'carte')} · valeur estimée ≈ ${fmt(pl.value)} W`) : '',
          check ? el('span', {}, `+ ${plural(check, 'carte')} au prix inconnu : prix chargés ${unpricedMode(p) === 'wait' ? 'avant de commencer' : 'pendant la défausse'} (≈ ${loadTime(check)}), celles sous ${fmt(p.maxAvg)} W défaussées ${unpricedMode(p) === 'wait' ? 'avec les autres' : 'à la fin'}, les autres gardées.`) : '',
          el('small', {}, filters.join(' · '))),
        pl.cards.length ? preview(pl.cards, 500) : '',
        dryOpt, ack, visOpt,
        el('p', { class: 'wmx-dlg-note' }, 'L’extension utilise la sélection du jeu sur la page Collection, page par page, et affiche sa progression en bas de l’écran. Ne rechargez pas l’onglet pendant la défausse. Elle s’arrête dès qu’un nombre affiché par le jeu ne correspond pas à cette liste.'),
        el('div', { class: 'wmx-dlg-row' }, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { close(); openPicker(); } }, 'Modifier'), go)));
    paint();
    document.body.append(back);
  }

  // ---- pilotage de la sélection native du jeu ----
  // Relevé sur le vrai jeu (page Collection) :
  //  - filtres : menu « Filtrer par étiquette » (options role=option : « Toutes les étiquettes », « Sans étiquette », « #NOM (n) » ; UNE seule à la fois),
  //    boutons de rareté L…C (plusieurs à la fois ; actif = sans « opacity-50 ») ; F5 remet tout à zéro et l'adresse ne change jamais ;
  //  - « Sélectionner » → barre : « N cartes sélectionnées », « Tout sélectionner (page) », « Défausser (+N) » (N = wikibidous) ; un clic sur la carte
  //    la coche (icône « check ») ; « Tout sélectionner » coche aussi les favorites, que le jeu ne défausse jamais ;
  //  - fenêtre (sans role=dialog) : titre h3 « Défausser N cartes ? », ligne « N × C », titres, « Annuler » / « Défausser » ; une carte cochée = UN exemplaire ;
  //  - après : message « N cartes défaussées (+N wikibidous). », la sélection reste ouverte ; la liste se recharge… ou affiche « Le chargement de la
  //    collection a échoué » : il faut alors la relire (filtre choisi de nouveau, ou page rechargée en arrière-plan).
  const KEEP_MAX = 30; // cartes gardées sur une page au-delà desquelles on passe à la page suivante (défausse plus efficace)
  // Page pilotée : la page Collection affichée (mode visible) ou une page Collection invisible (arrière-plan, par défaut).
  let D = document;
  let W = window;
  const pageText = () => (D.body ? (D.body.innerText ?? D.body.textContent ?? '') : '');
  const tagKey = (s) => key(s).replace(/^#/, '');
  const NATIVE = {
    buttons: () => [...D.querySelectorAll('button, [role=button], a')].filter((b) => !b.closest('.wmx-dc, .wmx-dc-run, .wmx-bubble, .wmx-modal-backdrop, .wmx-cp-prices')),
    btn: (re) => NATIVE.buttons().find((b) => re.test(norm(b.textContent)) && !b.disabled && b.getAttribute('aria-disabled') !== 'true'),
    select: () => NATIVE.btn(/^Sélectionner$/i),
    selectAll: () => NATIVE.btn(/^Tout sélectionner/i),
    quit: () => NATIVE.btn(/^Quitter la sélection/i),
    discard: () => NATIVE.btn(/^Défausser\s*\(/i),
    next: () => NATIVE.btn(/^Suivant/i),
    prev: () => NATIVE.btn(/^(←\s*)?Précédent/i),
    tagMenu: () => D.querySelector('button[aria-label="Filtrer par étiquette"]'),
    tagOptions: () => [...D.querySelectorAll('[role=option]')],
    rarityChips: () => NATIVE.buttons().filter((b) => b.closest('main') && /^(L|UR|SR|R|PC|C)$/.test(norm(b.textContent))),
    chipOn: (b) => !/\bopacity-50\b/.test(String(b.className)),
    /** Compteur « 50 cartes sélectionnées » : <span>50</span><span>cartes sélectionnées</span>, dans la barre fixée en bas de page (hors de <main>). */
    count() {
      const re = /^(\d[\d\s ]*?)\s*cartes?\s+sélectionnées?$/i;
      const elx = [...D.querySelectorAll('body div, body p, body span')].find((e) => re.test(norm(e.textContent)) && ![...e.children].some((c) => re.test(norm(c.textContent))) && !e.closest('.wmx-dc, .wmx-dc-run')); // barre fixée en bas de page, hors de <main>
      if (elx) return Number(re.exec(norm(elx.textContent))[1].replace(/\D/g, ''));
      return NATIVE.quit() ? 0 : null;
    },
    cards: () => [...D.querySelectorAll('main h3')].map((h3) => h3.closest('[class*="rounded-2xl"]')).filter((c) => c && !c.closest('.wmx-dc, .wmx-dc-run, .card-frame')),
    checked: (card) => !!(card.parentElement || card).querySelector('svg.lucide-check'),
    read(card) {
      const title = norm(card.querySelector('h3')?.textContent);
      const rarity = WMX.normRarity(norm(card.querySelector('div.absolute.top-2.left-2')?.textContent)) || '';
      return title && rarity ? { title, rarity, item: WMX.inventory.find(title, rarity) } : null;
    },
    /** Fenêtre de défausse du jeu : titre « Défausser N cartes ? ». */
    dialog() {
      const h = [...D.querySelectorAll('h2, h3')].find((e) => /^Défausser \d+ cartes? \?$/i.test(norm(e.textContent)));
      if (!h) return null;
      let box = h.closest('.card-frame, [role=dialog], [role=alertdialog]') || h.parentElement;
      while (box && !box.querySelector('button') && box.parentElement) box = box.parentElement;
      return box;
    },
    /** « 12 × C · 3 × PC » lu dans la fenêtre de défausse du jeu. */
    dialogCounts(d) { const out = {}; for (const m of String(d.innerText || d.textContent).matchAll(/(\d+)\s*[×x]\s*(L|UR|SR|PC|R|C)(?![A-Za-z])/g)) out[m[2]] = (out[m[2]] || 0) + Number(m[1]); return out; },
    /**
     * Message « N cartes défaussées (+N wikibidous). » : l'élément le plus précis qui le contient. Relevé sur le vrai jeu : il est affiché dans un
     * encadré « card-frame » (comme la fenêtre de défausse) ; on n'écarte donc que ce qui est DANS la fenêtre de défausse elle-même.
     */
    banner() {
      const dlg = NATIVE.dialog();
      const all = [...D.querySelectorAll('main *')].filter((e) => /^\d+ cartes? défaussées?/i.test(norm(e.textContent)) && !(dlg && dlg.contains(e)) && !e.closest('.wmx-dc, .wmx-dc-run'));
      return all.find((e) => ![...e.children].some((c) => /^\d+ cartes? défaussées?/i.test(norm(c.textContent)))) || null;
    },
    loadError: () => /chargement de la collection a échoué/i.test(pageText()),
    empty: () => /Aucune carte trouvée/i.test(pageText()),
    page() { const m = /Page\s+(\d+)\s*\/\s*(\d+)/i.exec(pageText()); return m ? { n: Number(m[1]), of: Number(m[2]) } : null; },
  };
  const waitFor = async (fn, ms, step = 150) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
  /** Liste affichée et prête : des cartes, ou « Aucune carte trouvée » (jamais pendant une erreur de chargement). */
  const listReady = () => !NATIVE.loadError() && (NATIVE.cards().length > 0 || NATIVE.empty());
  /**
   * Après une défausse, le jeu relit sa liste un peu plus tard : les cartes remontent d'une page à l'autre (5 pages deviennent 4…). On attend que
   * la page affichée ne change plus (mêmes cartes, même « Page N / M ») pendant ~1 s avant de la lire, sinon on coche une carte qui va bouger.
   */
  async function settled(maxMs = 8000) {
    const sig = () => `${norm(D.body?.innerText?.match(/Page \d+ \/ \d+/)?.[0] || '')}|${NATIVE.cards().map((c) => norm(c.querySelector('h3')?.textContent)).join('§')}`;
    const end = Date.now() + maxMs;
    let last = sig();
    let since = Date.now();
    while (Date.now() < end) {
      await sleep(250);
      const s = sig();
      if (s !== last) { last = s; since = Date.now(); continue; }
      if (Date.now() - since >= 1000 && listReady()) return true;
    }
    return listReady();
  }

  /**
   * Filtres du jeu : raretés choisies (toutes : aucun bouton actif) et UNE vue d'étiquette (« Toutes les étiquettes », « Sans étiquette » ou « #NOM »).
   * Choisir l'option du menu relance aussi la lecture de la liste (utile après « le chargement a échoué »). Rend un message d'erreur, ou ''.
   */
  async function applyFilters(rarities, view) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const menu = await waitFor(NATIVE.tagMenu, 15000);
      if (!menu) return 'menu « Filtrer par étiquette » du jeu introuvable';
      const want = (o) => { const t = norm(o.textContent); return view.kind === 'all' ? /^Toutes les étiquettes$/i.test(t) : view.kind === 'none' ? /^Sans étiquette$/i.test(t) : tagKey(t.replace(/\s*\(\d[\d\s ]*\)\s*$/, '')) === tagKey(view.tag); };
      if (attempt > 0 || !want({ textContent: norm(menu.textContent) })) {
        if (attempt > 0) { // relecture forcée : on passe par une autre vue puis on revient
          menu.click();
          const other = await waitFor(() => NATIVE.tagOptions().find((o) => !want(o) && /^(Toutes les étiquettes|Sans étiquette)$/i.test(norm(o.textContent))), 4000);
          other?.click();
          await sleep(800);
        }
        NATIVE.tagMenu().click();
        const opt = await waitFor(() => NATIVE.tagOptions().find(want), 5000);
        if (!opt) { D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return view.kind === 'tag' ? `l’étiquette « ${view.tag} » n’existe pas dans le menu du jeu` : 'vue du menu des étiquettes introuvable'; }
        opt.click();
        await sleep(400);
      }
      const all = rarities.length >= 6;
      for (const b of NATIVE.rarityChips()) {
        const on = all ? false : rarities.includes(norm(b.textContent));
        if (NATIVE.chipOn(b) !== on) { b.click(); await sleep(250); }
      }
      const okChips = NATIVE.rarityChips().every((b) => NATIVE.chipOn(b) === (all ? false : rarities.includes(norm(b.textContent))));
      if (!okChips) return 'les filtres de rareté du jeu ne répondent pas';
      if (!want({ textContent: norm(NATIVE.tagMenu()?.textContent) })) return 'le filtre d’étiquette du jeu ne s’est pas appliqué';
      if (await waitFor(listReady, 15000, 250)) {
        if (!NATIVE.quit()) {
          const s = await waitFor(NATIVE.select, 6000);
          if (!s) return 'bouton « Sélectionner » du jeu introuvable';
          s.click();
          if (!(await waitFor(() => NATIVE.count() === 0, 5000))) return 'le mode sélection du jeu ne s’est pas ouvert';
        }
        return '';
      }
      await sleep(2000 * (attempt + 1)); // « le chargement a échoué » : le jeu se reprend, on relit la liste
    }
    return 'la collection du jeu ne se charge pas (« le chargement de la collection a échoué ») : réessayez dans un instant';
  }

  /** Coche ou décoche une carte (clic sur la carte, en mode sélection) ; vérifie que le compteur bouge de 1. */
  async function toggleCard(card, delta) {
    card.scrollIntoView?.({ block: 'center' });
    await sleep(80);
    const before = NATIVE.count();
    card.click();
    return !!(await waitFor(() => { const n = NATIVE.count(); return n != null && before != null && n === before + delta; }, 1500, 100));
  }
  /** Parcourt la page affichée et rend les cartes vues, dans l'ordre (par paliers, au cas où la liste serait virtualisée). */
  async function scanPage() {
    const seen = new Map();
    const scroller = D.scrollingElement || D.documentElement;
    scroller.scrollTo?.(0, 0);
    await sleep(150);
    for (let i = 0; i < 60; i++) {
      for (const c of NATIVE.cards()) { const info = NATIVE.read(c); if (info && !seen.has(`${info.title}|${info.rarity}`)) seen.set(`${info.title}|${info.rarity}`, info); }
      const atEnd = scroller.scrollTop + W.innerHeight >= scroller.scrollHeight - 4;
      if (atEnd) break;
      scroller.scrollBy?.(0, 400);
      await sleep(120);
    }
    return [...seen.values()];
  }
  const findCard = (k) => NATIVE.cards().find((c) => { const i = NATIVE.read(c); return i && `${i.title}|${i.rarity}` === k; });
  /** Trouve une carte de la page puis la coche ou la décoche (un seul nouvel essai si le clic rate, vérifié par le compteur). */
  async function toggleByKey(k, delta) {
    const scroller = D.scrollingElement || D.documentElement;
    let card = findCard(k);
    for (let y = 0; !card && y < scroller.scrollHeight; y += 400) { scroller.scrollTo?.(0, y); await sleep(120); card = findCard(k); }
    if (!card) return false;
    if (await toggleCard(card, delta)) return true;
    await sleep(400);
    return NATIVE.count() != null && (await toggleCard(card, delta));
  }

  // ---- déroulé ----
  let panel = null;
  /** Fenêtre de progression (page principale) : « 120 / 340 exemplaires », étape en cours, « Arrêter » / « Afficher ». */
  function showRun(text, kind = 'ok') {
    if (!panel?.isConnected) {
      const peek = el('button', { class: 'wmx-btn wmx-btn--ghost wmx-dc-peek', title: 'Montrer ou cacher la page Collection où travaille l’extension' }, 'Afficher');
      peek.addEventListener('click', () => { const f = run.frame; if (!f) return; const on = !f.classList.contains('wmx-on'); f.classList.toggle('wmx-on', on); f.classList.toggle('wmx-dc-peek-on', on); peek.textContent = on ? 'Masquer' : 'Afficher'; });
      panel = el('div', { class: 'wmx-dc-run', role: 'status' },
        el('div', { class: 'wmx-dc-run-head' }, el('b', { class: 'wmx-dc-run-title' }, 'Défausse'), el('span', { class: 'wmx-dc-run-num' }), el('span', { class: 'wmx-dc-run-sp' }), peek,
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { if (!run.on) { panel.remove(); return; } run.stop = true; showRun('arrêt demandé : fin de l’étape en cours…', 'warn'); } }, 'Arrêter')),
        el('div', { class: 'wmx-dc-run-bar' }, el('i')),
        el('span', { class: 'wmx-dc-run-txt' }));
      document.body.append(WMX.dom.keepAttached ? WMX.dom.keepAttached(panel) : panel);
    }
    const pr = run.prog || { done: 0, total: 0 };
    panel.dataset.kind = kind;
    panel.querySelector('.wmx-dc-run-title').textContent = `${run.dry ? 'Essai à blanc' : 'Défausse'}${run.frame ? ' en arrière-plan' : ''}`;
    panel.querySelector('.wmx-dc-run-num').textContent = pr.total ? `${fmt(pr.done)} / ${fmt(pr.total)} exemplaires ${run.dry ? 'vérifiés' : 'défaussés'}` : '';
    panel.querySelector('.wmx-dc-run-bar i').style.width = `${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%`;
    panel.querySelector('.wmx-dc-peek').hidden = !run.frame;
    panel.querySelector('.wmx-dc-run-txt').textContent = text;
    panel.querySelector('.wmx-dc-run-head .wmx-btn:last-child').textContent = run.on ? 'Arrêter' : 'Fermer';
  }
  /** Page Collection invisible (arrière-plan) ; `reload()` la recharge (état propre) et rend le nouveau document. Remplacée dans les essais. */
  async function openFrame() {
    const f = el('iframe', { class: 'wmx-sheet-frame wmx-dc-frame', src: '/collection#wmx-discard', title: 'Défausse', tabindex: '-1' }); // pas #wmx-auto : aucune confirmation n'est acceptée d'office
    document.body.append(f);
    const ready = () => waitFor(() => { try { return f.contentDocument?.readyState === 'complete' && f.contentDocument.querySelector('button[aria-label="Filtrer par étiquette"]') ? f : null; } catch (_) { return null; } }, 45000, 300);
    if (!(await ready())) { f.remove(); return null; }
    return {
      d: f.contentDocument, w: f.contentWindow, frame: f, remove: () => f.remove(),
      async reload() { try { f.contentWindow.location.reload(); } catch (_) { return null; } await sleep(800); return (await ready()) ? { d: f.contentDocument, w: f.contentWindow } : null; },
    };
  }
  /** Vérification humaine du jeu dans la page invisible : on la montre au centre de l'écran et on attend qu'elle soit faite. */
  async function humanGate() {
    if (!run.frame || !/vérification rapide/i.test(pageText())) return true;
    run.frame.classList.add('wmx-on', 'wmx-human');
    showRun('le jeu demande une vérification rapide : faites-la dans la fenêtre affichée, la défausse reprend ensuite.', 'warn');
    const ok = await waitFor(() => run.stop || !/vérification rapide/i.test(pageText()), 5 * 60000, 500);
    run.frame.classList.remove('wmx-on', 'wmx-human');
    return !!ok && !run.stop;
  }
  /** Vues à parcourir : une par étiquette choisie (le jeu n'en filtre qu'une à la fois), sinon « Sans étiquette » ou « Toutes les étiquettes ». */
  const viewsOf = (p) => ((p.tags || []).length ? p.tags.map((tag) => ({ kind: 'tag', tag, label: `étiquette ${tag}` }))
    : p.includeTagged ? [{ kind: 'all', label: 'toutes les étiquettes' }] : [{ kind: 'none', label: 'sans étiquette' }]);

  async function start(pl, { dry, visible = false, prefs: p = prefs }) {
    if (run.on) return;
    if (visible && !/^\/collection\/?$/.test(location.pathname)) return WMX.toast?.('Mode visible : ouvrez la page Collection pour lancer la défausse.', 5000);
    run.on = true; run.stop = false; run.dry = dry; run.prog = { done: 0, total: pl.copies }; run.frame = null;
    let ctx = null;
    if (visible) { D = document; W = window; } else {
      showRun('préparation de la page Collection en arrière-plan…');
      ctx = await (WMX.discard.frameFactory || openFrame)();
      if (!ctx) { run.on = false; showRun('la page Collection n’a pas pu être préparée en arrière-plan (jeu lent ?) : rien n’a été défaussé. Réessayez, ou utilisez le mode visible.', 'warn'); return; }
      D = ctx.d; W = ctx.w; run.frame = ctx.frame || null;
    }
    // Cartes au prix inconnu (seuil activé) : « attendre » charge leurs prix AVANT de commencer ; « en dernier » les charge pendant la défausse
    // puis traite, à la fin, celles qui sont sous le seuil. Une carte dont le prix reste introuvable est gardée.
    const mode = p.useMax ? unpricedMode(p) : 'keep';
    const priceLoad = { done: 0, total: 0 };
    const loadPrices = async (cards) => {
      const todo = cards.filter((c) => !WMX.prices.has(c.card_id));
      if (!todo.length) return;
      Object.assign(priceLoad, { done: 0, total: todo.length });
      WMX.prices.start(todo, { total: todo.length });
      await waitFor(() => { priceLoad.done = todo.filter((c) => WMX.prices.has(c.card_id)).length; return run.stop || priceLoad.done >= todo.length || !WMX.prices.state().running; }, 60 * 60000, 1000);
    };
    if (mode === 'wait' && pl.unpricedCards?.length) {
      const tick = setInterval(() => showRun(`chargement des prix inconnus avant de commencer : ${fmt(priceLoad.done)} / ${fmt(priceLoad.total)}…`), 1000);
      await loadPrices(pl.unpricedCards);
      clearInterval(tick);
      if (run.stop) { run.on = false; ctx?.remove?.(); D = document; W = window; run.frame = null; showRun('arrêtée à votre demande pendant le chargement des prix : rien n’a été défaussé.', 'warn'); return; }
      pl = plan({ ...p, unpriced: 'keep' }); // prix connus : le seuil s'applique ; les prix toujours introuvables restent gardés
      run.prog.total = pl.copies;
    }
    const lastLoad = mode === 'last' && pl.unpricedCards?.length ? loadPrices(pl.unpricedCards) : null;
    // Exemplaires restants par carte (clé titre|rareté, comme la page du jeu les affiche).
    const left = new Map(pl.cards.map((c) => [`${norm(c.title)}|${c.rarity}`, { ...c }]));
    const remaining = () => [...left.values()].some((c) => c.copies > 0);
    const stats = { copies: 0, rounds: 0, reward: 0 };
    const label = dry ? 'Essai à blanc' : 'Défausse';
    const rarities = (p.rarities || []).length ? [...p.rarities] : [...new Set([...pl.cards, ...(pl.unpricedCards || [])].map((c) => c.rarity))]; // aucune rareté cochée : celles des cartes concernées
    const done = (n) => `${plural(n, 'exemplaire')} ${dry ? 'vérifié' : 'défaussé'}${n > 1 ? 's' : ''}`;
    const finish = (text, kind = 'ok') => {
      run.on = false;
      const c = ctx; ctx = null;
      setTimeout(() => c?.remove?.(), 1500); // page invisible retirée (après la dernière réponse du jeu)
      D = document; W = window;
      run.prog.done = stats.copies;
      showRun(text, kind);
      run.frame = null;
      WMX.journal?.add('Défausse', text, kind === 'ok' ? undefined : 'warn');
      WMX.notify?.({ kind: kind === 'ok' ? 'info' : 'warn', key: 'discard', ms: 12000, title: kind === 'ok' ? `${label} terminée` : `${label} arrêtée`, text });
      setTimeout(() => { if (!run.on) panel?.remove(); }, 30000);
    };
    async function abort(text) { await clearSelection(); return finish(text, 'warn'); }
    /** Après une défausse : la liste du jeu doit se relire. En arrière-plan on recharge la page (état propre) ; en mode visible on rechoisit le filtre. */
    async function recover(view) {
      if (ctx?.reload) {
        showRun('relecture de la collection (page rechargée en arrière-plan)…');
        const r = await ctx.reload();
        if (!r) return 'la page en arrière-plan n’a pas pu être rechargée';
        D = r.d; W = r.w;
      }
      return applyFilters(rarities, view);
    }
    try {
      WMX.journal?.add('Défausse', `${label} lancée : ${plural(pl.copies, 'exemplaire')} (${byRarText(pl.byRar)})${run.frame ? ', en arrière-plan' : ''}`);
      for (let phase = 0; phase < 2; phase++) {
      for (const view of viewsOf(p)) {
        if (!remaining()) break;
        showRun(`filtres du jeu : ${rarities.join(', ')} · ${view.label}…`);
        const err = await applyFilters(rarities, view);
        if (err) return abort(`${err}. Rien n’a été défaussé${stats.copies ? ' de plus' : ''}.`);
        let page = 1;
        let sweeps = 0;
        let sweepFrom = stats.copies;
        // Page suivante ; au bout, un nouveau passage depuis la page 1 rattrape les cartes remontées après une défausse (3 au plus, s'il a servi).
        const advance = async () => {
          const nx = NATIVE.next();
          const pg = NATIVE.page();
          if (nx && (!pg || pg.n < pg.of)) { nx.click(); page += 1; await sleep(600); await waitFor(listReady, 15000, 200); await settled(); return true; }
          if (dry || sweeps >= 3 || stats.copies === sweepFrom || !remaining()) return false;
          sweeps += 1; sweepFrom = stats.copies;
          showRun(`retour à la page 1 : cartes restantes à rattraper (passage ${sweeps + 1})…`);
          const e = await recover(view); if (e) return false;
          // Les filtres étaient déjà les bons : la page affichée n'a pas changé. On revient nous-mêmes à la page 1 (« Précédent »).
          for (let i = 0; i < 400 && (NATIVE.page()?.n || 1) > 1; i++) {
            const pv = NATIVE.prev();
            if (!pv) break;
            pv.click();
            await sleep(400);
            await waitFor(listReady, 15000, 200);
          }
          await settled();
          page = 1;
          return true;
        };
        let moved = 0; // relectures de suite d'une page dont une carte a bougé pendant la sélection
        /** Une carte n'est plus là où on l'a lue (la liste du jeu s'est relue entre-temps) : on décoche tout, on attend la liste, on relit la page. */
        const reread = async (what) => {
          moved += 1;
          if (moved > 3) return false;
          showRun(`${view.label} · page ${page} : « ${what} » a bougé (liste du jeu relue), nouvelle lecture de la page…`);
          await clearSelection();
          await settled();
          return true;
        };
        for (let guard = 0; guard < 600; guard++) {
          if (run.stop) return abort(`arrêtée à votre demande : ${done(stats.copies)}.`);
          if (!remaining()) break;
          if (run.frame && !run.frame.isConnected) return finish(`la page en arrière-plan a été fermée : ${done(stats.copies)}.`, 'warn');
          if (!(await humanGate())) return abort('la vérification du jeu n’a pas été faite : arrêtée.');
          if (NATIVE.loadError()) { const e = await recover(view); if (e) return abort(`${e}. ${done(stats.copies)}.`); }
          run.prog.done = stats.copies;
          showRun(`${view.label} · page ${page} : lecture des cartes…`);
          const seen = await scanPage();
          const targets = seen.filter((s) => left.get(`${s.title}|${s.rarity}`)?.copies > 0);
          if (!targets.length) { if (!(await advance())) break; continue; }
          // Cocher : « Tout sélectionner (page) » puis décocher les cartes gardées si la page est surtout à défausser, sinon carte par carte.
          showRun(`${view.label} · page ${page} : sélection de ${plural(targets.length, 'carte')}…`);
          if (NATIVE.count() !== 0) await clearSelection();
          const tkeys = new Set(targets.map((t) => `${t.title}|${t.rarity}`));
          let lost = '';
          const all = NATIVE.selectAll();
          const usedAll = !!all && targets.length > seen.length / 2;
          if (usedAll) {
            all.click();
            if (!(await waitFor(() => NATIVE.count() >= targets.length, 6000))) return abort(`page ${page} : « Tout sélectionner » n’a pas coché les cartes. Rien n’a été défaussé sur cette page.`);
            for (const s of seen) {
              const k = `${s.title}|${s.rarity}`;
              if (tkeys.has(k)) continue;
              if (s.item?.starred) continue; // favorite cochée par « Tout sélectionner » : le jeu ne la défausse jamais, inutile de la décocher
              if (run.stop) break;
              if (!(await toggleByKey(k, -1))) { lost = s.title; break; }
            }
          } else {
            for (const t of targets) {
              if (run.stop) break;
              if (!(await toggleByKey(`${t.title}|${t.rarity}`, 1))) { lost = t.title; break; }
            }
          }
          if (lost) {
            if (await reread(lost)) continue;
            return abort(`page ${page} : impossible de ${usedAll ? 'décocher' : 'cocher'} « ${lost} » (la liste du jeu bouge encore). Rien n’a été défaussé sur cette page.`);
          }
          moved = 0;
          if (run.stop) return abort(`arrêtée à votre demande : ${done(stats.copies)}.`);
          // Compteur : les cartes prévues, plus éventuellement les favorites laissées cochées (le jeu les omet ; la fenêtre, vérifiée ensuite, le confirme).
          const n = NATIVE.count();
          const favs = usedAll ? seen.filter((x) => x.item?.starred && !tkeys.has(`${x.title}|${x.rarity}`)).length : 0;
          if (n !== targets.length && n !== targets.length + favs) return abort(`page ${page} : le jeu compte ${n ?? '?'} carte(s) sélectionnée(s) au lieu de ${targets.length}${favs ? ` (ou ${targets.length + favs} avec les favorites)` : ''}. Rien n’a été défaussé sur cette page.`);
          // Fenêtre du jeu : une carte cochée = UN exemplaire ; les nombres par rareté doivent être exactement les cartes prévues.
          const want = {};
          for (const t of targets) want[t.rarity] = (want[t.rarity] || 0) + 1;
          const db = NATIVE.discard();
          if (!db) return abort(`page ${page} : bouton « Défausser » du jeu introuvable. Rien n’a été défaussé.`);
          const reward = Number((/\+\s*(\d[\d\s ]*)/.exec(norm(db.textContent)) || [])[1]?.replace(/\D/g, '') || 0);
          db.click();
          const dlg = await waitFor(NATIVE.dialog, 6000);
          if (!dlg) return abort(`page ${page} : la fenêtre de défausse du jeu ne s’est pas ouverte. Rien n’a été défaussé.`);
          const got = NATIVE.dialogCounts(dlg);
          if (!R.every((r) => (got[r] || 0) === (want[r] || 0))) {
            cancelDialog(dlg);
            return abort(`page ${page} : le jeu s’apprête à défausser ${byRarText(got) || '?'} au lieu de ${byRarText(want)}. Rien n’a été défaussé.`);
          }
          if (dry) {
            cancelDialog(dlg);
            await waitFor(() => !NATIVE.dialog(), 3000);
            for (const t of targets) { const c = left.get(`${t.title}|${t.rarity}`); stats.copies += c.copies; c.copies = 0; } // vérifiées (exemplaires suivants compris)
            await clearSelection();
            if (!(await advance())) break;
            continue;
          }
          const confirm = [...dlg.querySelectorAll('button')].reverse().find((b) => /^Défausser$/i.test(norm(b.textContent)) && !b.disabled);
          if (!confirm) { cancelDialog(dlg); return abort(`page ${page} : bouton de confirmation du jeu introuvable. Rien n’a été défaussé.`); }
          // L'ancien message « N cartes défaussées » reste affiché : on le note pour ne pas le prendre pour la réponse à cette défausse.
          const oldBanner = NATIVE.banner();
          const oldText = oldBanner ? norm(oldBanner.textContent) : '';
          showRun(`${view.label} · page ${page} : défausse de ${byRarText(want)}…`);
          confirm.click();
          const expect = new RegExp(`^${targets.length} cartes? défaussées?`, 'i');
          const ok = await waitFor(() => { if (NATIVE.dialog()) return null; const b = NATIVE.banner(); return b && expect.test(norm(b.textContent)) && (b !== oldBanner || norm(b.textContent) !== oldText) ? b : null; }, 20000, 200)
            || (await waitFor(() => !NATIVE.dialog() && NATIVE.banner() && expect.test(norm(NATIVE.banner().textContent)), 2500, 200)); // même message qu'avant (même nombre) : la fenêtre fermée suffit
          if (!ok) return finish(`page ${page} : le jeu n’a pas confirmé la défausse (vérifiez votre collection). ${done(stats.copies)} avant.`, 'warn');
          stats.copies += targets.length;
          stats.reward += reward; stats.rounds += 1;
          run.prog.done = stats.copies;
          for (const t of targets) {
            const c = left.get(`${t.title}|${t.rarity}`);
            window.dispatchEvent(new CustomEvent('wmx:discard', { detail: { card_id: c.card_id } })); // inventaire de l'extension (page principale) : un exemplaire de moins
            c.copies -= 1; // d'autres exemplaires à défausser : la carte est recochée au passage suivant
          }
          // La liste du jeu se relit (ou échoue) : on attend qu'elle soit prête, et on la relit nous-mêmes si besoin.
          await sleep(1200);
          if (!(await waitFor(listReady, 6000, 200))) { const e = await recover(view); if (e) return abort(`${e}. ${done(stats.copies)}.`); }
          await settled(); // la liste du jeu peut encore se relire (cartes remontées) : on la laisse se poser avant de lire ou de changer de page
          if (NATIVE.count() == null) { const e = await applyFilters(rarities, view); if (e) return abort(`${e}. ${done(stats.copies)}.`); }
          // Cartes gardées (favorites, options) restées sur cette page : à partir de 30, on passe à la suivante.
          if (seen.length - targets.length >= KEEP_MAX) { showRun(`page ${page} : ${seen.length - targets.length} cartes gardées sur la page, passage à la suivante…`); if (!(await advance())) break; }
        }
      }
      // « En dernier » : on attend la fin du chargement des prix, puis on ajoute les cartes désormais sous le seuil et on refait un passage.
      if (phase > 0 || !lastLoad) break;
      const tick = setInterval(() => showRun(`prix inconnus : ${fmt(priceLoad.done)} / ${fmt(priceLoad.total)} chargés, traitement à la fin…`), 1000);
      await lastLoad;
      clearInterval(tick);
      if (run.stop) return abort(`arrêtée à votre demande : ${done(stats.copies)}.`);
      let added = 0;
      for (const c of plan({ ...p, unpriced: 'keep' }).cards) {
        const k = `${norm(c.title)}|${c.rarity}`;
        if (left.has(k)) continue;
        left.set(k, { ...c }); added += c.copies; run.prog.total += c.copies;
      }
      if (!added) break;
      showRun(`${plural(added, 'exemplaire')} au prix désormais connu, sous le seuil : défausse en dernier…`);
      }
      const missing = [...left.values()].filter((c) => c.copies > 0);
      await clearSelection();
      const tail = missing.length ? ` · ${plural(missing.length, 'carte')} non trouvée${missing.length > 1 ? 's' : ''} avec les filtres du jeu` : '';
      return finish(dry ? `essai réussi : ${done(stats.copies)}, rien n’a été défaussé${tail}. Relancez sans « Essai à blanc » pour défausser.`
        : `${done(stats.copies)}${stats.reward ? ` (+${fmt(stats.reward)} wikibidou${stats.reward > 1 ? 's' : ''})` : ''}${tail}.`);
    } catch (e) {
      console.warn('[WMX] défausse', e);
      return finish(`erreur inattendue (${e?.message || e}) : arrêtée.`, 'warn');
    }
  }
  function cancelDialog(dlg) {
    const b = [...dlg.querySelectorAll('button')].find((x) => /^(Annuler|Fermer|Non)$/i.test(norm(x.textContent)) || /fermer/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click(); else dlg.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  /** Vide la sélection en restant en mode sélection (« Quitter la sélection » puis « Sélectionner »). */
  async function clearSelection() {
    await sleep(200);
    const q = NATIVE.quit();
    if (q) { q.click(); await waitFor(() => !NATIVE.quit(), 4000); }
    const s = await waitFor(NATIVE.select, 4000);
    if (s) { s.click(); await waitFor(() => NATIVE.count() === 0, 4000); }
  }

  /** Bouton de la barre de la collection. */
  function button() {
    return el('button', { class: 'wmx-btn wmx-btn--ghost wmx-dc-open', type: 'button', title: 'Défausser des cartes par rareté, étiquette et options (confirmation demandée)', onclick: () => WMX.inventory.ensure().then(openPicker) }, 'Défausser…');
  }

  WMX.register({
    name: 'discard',
    match: /^\/collection\/?$/,
    async init() {
      prefs = { ...DEFAULTS, ...(await WMX.store.get('discardPrefs', {})) };
      if (prefs.tag && !(prefs.tags || []).length) prefs.tags = [prefs.tag]; // ancien réglage (une seule étiquette)
      prefs.unpriced = unpricedMode(prefs); delete prefs.keepUnpriced; // ancien réglage (garder / défausser)
      delete prefs.tag;
    },
  });
  WMX.discard = { button, openPicker, plan, start, native: NATIVE, frameFactory: null, isRunning: () => run.on, stop: () => { run.stop = true; } };
})();
