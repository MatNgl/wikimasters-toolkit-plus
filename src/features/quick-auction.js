// Enchère rapide (bouton ⚡ de Collection+) : un clic met la carte en FILE D'ATTENTE ; la file se traite en arrière-plan,
// une carte après l'autre, même si vous changez de page, ouvrez une fiche ou fermez Collection+. Chaque carte est mise aux
// enchères avec le prix de départ calculé (moyenne du marché × coefficient, mode prudent optionnel) et la durée choisie
// dans les paramètres. Recliquer sur ⚡ retire la carte de la file, ou annule l'enchère si elle est déjà en vente.
// Tout passe par le formulaire et les boutons du jeu, pilotés comme le ferait l'utilisateur dans un cadre invisible :
// l'extension n'invente aucun appel. La file est mémorisée : elle reprend si la page est rechargée.
(() => {
  const { el, sleep, waitFor } = WMX.dom;
  const LABELS = { '10min': '10 min', '30min': '30 min', '1h': '1 h', '3h': '3 h', '6h': '6 h', '12h': '12 h' };
  const MINUTES = { '10 min': 10, '30 min': 30, '1 h': 60, '3 h': 180, '6 h': 360, '12 h': 720 };
  const S = { fav: new Map(), selling: new Map(), max: 10, queue: [], current: null, running: false, batch: { done: 0, total: 0, ok: 0, failed: [] } };
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => { try { cb(); } catch (_) { /* écouteur obsolète */ } });
  const slim = (it) => ({ card_id: it.card_id, title: it.title, rarity: it.rarity, starred: !!it.starred, tag: it.tag, add: it.add, want: it.want });
  const isAuctionOp = (o) => o.type === 'launch' || o.type === 'cancel';
  // L'opération en cours n'est PAS réécrite dans le stockage : un autre onglet ne peut pas la reprendre (pas de doublon).
  const persist = () => WMX.store.set('quickQueue', S.queue.filter((o) => o !== S.current).map((o) => ({ id: o.id, type: o.type, item: o.item })));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const withLock = (name, fn) => (navigator.locks?.request ? navigator.locks.request(name, fn) : fn());
  /**
   * Plusieurs onglets peuvent avoir copié la même file : avant d'exécuter une opération, on la « réclame » dans le stockage
   * partagé, sous verrou. Si un autre onglet l'a déjà prise (ou traitée), on passe : jamais deux fois la même opération.
   */
  const claim = (op) => withLock('wmx-queue', async () => {
    const stored = await WMX.store.get('quickQueue', []);
    const i = stored.findIndex((x) => x.id === op.id);
    if (i < 0) return false;
    stored.splice(i, 1);
    await WMX.store.set('quickQueue', stored);
    return true;
  });

  const cfg = () => ({ coef: Number(WMX.settings?.quickCoef) || 0.9, dur: LABELS[WMX.settings?.quickDuration] || '1 h', prudent: !!WMX.settings?.quickPrudent });

  /** Prix de départ : moyenne × coefficient, plafonné à 1,2 × dernière vente en mode prudent, arrondi, 1 W minimum. */
  function startPrice(p) {
    const c = cfg();
    let v = p.avg * c.coef;
    if (c.prudent && p.last) v = Math.min(v, p.last * 1.2);
    return Math.max(1, Math.round(v));
  }

  /** Mes enchères en cours, d'après le même appel que la page Marché (champ `selling`). */
  async function refresh() {
    try {
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('mine', '1');
      const res = await fetch(u);
      if (!res.ok) return;
      const j = await res.json();
      S.max = j.maxConcurrentAuctions || 10;
      S.selling = new Map((j.selling || []).filter((a) => a.status === 'active').map((a) => [a.card_id, a]));
      notify();
    } catch (_) { /* réseau : on garde l'état précédent */ }
  }

  function setNumber(w, input, v) {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(v));
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
  }

  const fixedAncestor = (w, e) => {
    let m = e;
    while (m && w.getComputedStyle(m).position !== 'fixed') m = m.parentElement;
    return m;
  };

  const SHEET_ERRORS = {
    frame: 'impossible de charger la fiche',
    notfound: 'carte introuvable dans la recherche du jeu',
    nosheet: 'la fiche ne s’est pas ouverte',
  };

  /** Ouvre la fiche (cachée), le formulaire d'enchère, saisit le prix et la durée, puis lance. */
  async function driveForm(item, price, dur) {
    const r = await WMX.sheet.openInFrame({ id: item.card_id, wikipedia_title: item.title, rarity: item.rarity }, 'work');
    if (r.error) return { error: SHEET_ERRORS[r.error] };
    const { d, w, root } = r;
    try {
      const open = [...root.querySelectorAll('button')].find((b) => /Mettre aux enchères/i.test(b.textContent));
      if (!open || open.disabled) return { error: 'le jeu ne permet pas de la vendre (déjà en vente, favorite ou en échange ?)', fatal: true };
      open.click();
      const launch = await waitFor(() => [...d.querySelectorAll('button')].find((b) => /Lancer l.enchère/i.test(b.textContent)), 8000, 120);
      if (!launch) return { error: 'le formulaire d’enchère ne s’est pas ouvert' };
      const form = fixedAncestor(w, launch) || d.body;
      const input = form.querySelector('input[aria-label="Mise de départ"], input[type=number]');
      if (!input) return { error: 'champ « Mise de départ » introuvable' };
      setNumber(w, input, price);
      [...form.querySelectorAll('button')].find((b) => b.textContent.trim() === dur)?.click();
      await sleep(250);
      if (Number(input.value) !== price) return { error: 'le prix saisi n’a pas été pris en compte' };
      launch.click();
      const closed = await waitFor(() => !/Lancer l.enchère/i.test(d.body.innerText), 9000, 150);
      return closed ? { ok: true } : { error: 'le jeu n’a pas confirmé l’enchère' };
    } finally {
      WMX.sheet.closeSheet('work');
    }
  }

  // Pages d'annulation préchargées : le clic d'annulation est alors presque instantané. Libérées après 15 min.
  const warm = new Map(); // id de l'enchère -> cadre

  function prewarm(auction) {
    if (!auction || warm.has(auction.id)) return;
    for (const [oldId, oldFrame] of warm) { oldFrame.remove(); warm.delete(oldId); } // une seule page préchargée : la dernière enchère
    const f = el('iframe', { class: 'wmx-sheet-frame', src: `/marketplace/${auction.id}#wmx-auto`, title: 'Annulation', tabindex: '-1' });
    document.body.append(f);
    warm.set(auction.id, f);
    setTimeout(() => { if (warm.get(auction.id) === f) { f.remove(); warm.delete(auction.id); } }, 15 * 60000);
  }

  /** Annule une enchère depuis sa page de détail ; la confirmation du jeu est validée par frame-hook.js (adresse #wmx-auto). */
  async function cancelAuction(auction) {
    const f = warm.get(auction.id) || el('iframe', { class: 'wmx-sheet-frame', src: `/marketplace/${auction.id}#wmx-auto`, title: 'Annulation', tabindex: '-1' });
    if (!f.isConnected) document.body.append(f);
    try {
      const find = (re) => { try { return [...f.contentDocument.querySelectorAll('button')].find((b) => re.test(b.textContent)); } catch (_) { return null; } };
      const btn = await waitFor(() => find(/Annuler et récupérer/i), 90000, 300);
      if (!btn) return { error: 'bouton d’annulation introuvable (enchère déjà misée ou terminée ?)' };
      btn.click();
      const confirm = await waitFor(() => find(/^(Confirmer|Oui|Valider|Annuler la vente|Annuler l.enchère)/i), 2000, 120);
      confirm?.click();
      return { ok: true };
    } finally {
      await sleep(500);
      f.remove();
      warm.delete(auction.id);
    }
  }

  // --- Traitement d'un élément de la file ------------------------------------------------------
  async function doLaunch(item) {
    const c = cfg();
    await refresh();
    if (S.selling.has(item.card_id)) return { skipped: true };
    if (S.selling.size >= S.max) return { limit: true };
    let p = WMX.prices.get(item.card_id, item.rarity);
    if (!p) { await WMX.prices.fetchOne(item.card_id); p = WMX.prices.get(item.card_id, item.rarity); }
    if (!p) return { error: 'aucune vente sur le marché pour cette rareté : pas de moyenne pour fixer le prix' };
    const price = startPrice(p);
    const attempt = async () => {
      try { return await driveForm(item, price, c.dur); } catch (e) { console.warn('[WMX] enchère', item.title, e); return { error: `${e?.name || 'Erreur'} : ${e?.message || e}` }; }
    };
    let res = await attempt();
    if (!res.ok && !res.fatal) { await sleep(3000); res = await attempt(); } // un nouvel essai (le cadre est remis sur la collection)
    if (!res.ok) return { error: res.error };
    await sleep(600);
    await refresh();
    return S.selling.has(item.card_id) ? { ok: true, price } : { error: 'enchère non confirmée par le jeu' };
  }

  async function doCancel(item) {
    await refresh();
    const a = S.selling.get(item.card_id);
    if (!a) return { skipped: true };
    // Le serveur du jeu peut répondre par une erreur 503 quand il est surchargé : jusqu'à 3 essais espacés avant d'abandonner.
    for (let t = 0; t < 3; t++) {
      const res = await cancelAuction(a);
      if (!res.ok) return { error: res.error };
      await sleep(800 + t * 4000);
      await refresh();
      if (!S.selling.has(item.card_id)) return { ok: true };
    }
    return { error: 'le jeu n’a pas annulé l’enchère (serveur du jeu surchargé, ou enchère déjà misée) : réessayez plus tard' };
  }

  /** Pose ou retire le favori en cliquant l'étoile de la fiche du jeu (cadre invisible), comme l'utilisateur. */
  async function doFavorite(item) {
    const r = await WMX.sheet.exclusive(() => WMX.sheet.openInFrame({ id: item.card_id, wikipedia_title: item.title, rarity: item.rarity }, 'work'), 'work');
    if (r.error) return { error: SHEET_ERRORS[r.error] };
    const { root } = r;
    try {
      const star = [...root.querySelectorAll('button')].find((b) => /favoris/i.test(b.getAttribute('aria-label') || ''));
      if (!star) return { error: 'étoile des favoris introuvable' };
      const before = star.getAttribute('aria-label');
      const wasStarred = !/^ajouter/i.test(before);
      if ((item.want === 'on' && wasStarred) || (item.want === 'off' && !wasStarred)) return { ok: true }; // déjà dans l'état voulu
      star.click();
      await waitFor(() => star.getAttribute('aria-label') !== before, 5000, 120);
      const starred = !wasStarred;
      S.fav.set(item.card_id, starred);
      window.dispatchEvent(new CustomEvent('wmx:fav', { detail: { card_id: item.card_id, starred } }));
      return { ok: true };
    } finally {
      WMX.sheet.closeSheet('work');
    }
  }

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  /** Ajoute (item.add) ou retire l'étiquette item.tag d'une carte, avec le champ « Ajouter une étiquette… » de la fiche du jeu. */
  async function doTag(item) {
    const r = await WMX.sheet.exclusive(() => WMX.sheet.openInFrame({ id: item.card_id, wikipedia_title: item.title, rarity: item.rarity }, 'work'), 'work');
    if (r.error) return { error: SHEET_ERRORS[r.error] };
    const { root, d, w } = r;
    try {
      const want = norm(item.tag);
      const chipBtn = () => [...root.querySelectorAll('button')].find((b) => norm(b.getAttribute('aria-label')) === norm(`Retirer l'étiquette ${item.tag}`) || norm(b.getAttribute('aria-label')) === norm(`Retirer l’étiquette ${item.tag}`));
      if (!item.add) {
        const b = chipBtn();
        if (!b) return { ok: true }; // la carte n'a déjà plus cette étiquette
        b.click();
        if (!(await waitFor(() => !chipBtn(), 6000, 150))) return { error: `l’étiquette « ${item.tag} » n’a pas été retirée` };
      } else {
        if (chipBtn()) return { ok: true }; // déjà étiquetée
        const input = root.querySelector('input[placeholder^="Ajouter une étiquette"]');
        if (!input) return { error: 'champ « Ajouter une étiquette » introuvable' };
        input.focus();
        setNumber(w, input, item.tag);
        // On ne choisit JAMAIS « Créer… » : seulement l'étiquette existante portant exactement ce nom.
        const opt = await waitFor(() => [...d.querySelectorAll('li[role=option] button')].find((b) => norm(b.textContent) === want), 6000, 150);
        if (!opt) { setNumber(w, input, ''); return { error: `étiquette « ${item.tag} » introuvable dans les suggestions du jeu` }; }
        opt.click();
        if (!(await waitFor(() => chipBtn(), 6000, 150))) return { error: `l’étiquette « ${item.tag} » n’a pas été ajoutée` };
      }
      window.dispatchEvent(new CustomEvent('wmx:tag', { detail: { card_id: item.card_id, tag: item.tag, add: !!item.add } }));
      return { ok: true };
    } finally {
      WMX.sheet.closeSheet('work');
    }
  }

  /** Défausse UNE carte avec le bouton « Défausser » de la fiche (et sa confirmation éventuelle). Une carte favorite est refusée. */
  async function doDiscard(item) {
    const r = await WMX.sheet.exclusive(() => WMX.sheet.openInFrame({ id: item.card_id, wikipedia_title: item.title, rarity: item.rarity }, 'work'), 'work');
    if (r.error) return { error: SHEET_ERRORS[r.error] };
    const { root, d } = r;
    try {
      const star = [...root.querySelectorAll('button')].find((b) => /favoris/i.test(b.getAttribute('aria-label') || ''));
      if (star && /^retirer/i.test(star.getAttribute('aria-label') || '')) return { error: 'carte favorite : verrouillée, impossible de la défausser' };
      const btn = [...root.querySelectorAll('button')].find((b) => /^Défausser/i.test(b.textContent.trim()));
      if (!btn || btn.disabled) return { error: 'bouton « Défausser » indisponible (carte verrouillée ou en vente ?)' };
      btn.click();
      const confirm = await waitFor(() => [...d.querySelectorAll('button')].find((b) => b !== btn && /^(Confirmer|Oui|Valider|Défausser( la carte)?)$/i.test(b.textContent.trim())), 2500, 120);
      confirm?.click();
      if (!(await waitFor(() => !root.isConnected || !btn.isConnected, 9000, 200))) return { error: 'le jeu n’a pas défaussé la carte' };
      window.dispatchEvent(new CustomEvent('wmx:discard', { detail: { card_id: item.card_id } }));
      return { ok: true };
    } finally {
      WMX.sheet.closeSheet('work');
    }
  }

  // --- Pastille de progression (visible sur toutes les pages) -----------------------------------
  function updateChip() {
    let c = document.querySelector('.wmx-qchip');
    if (!S.queue.length && !S.running) { c?.remove(); return; }
    if (!c) {
      c = el('div', { class: 'wmx-qchip' }, el('span', { class: 'wmx-qtext' }), el('button', { class: 'wmx-qclear', onclick: clearQueue }, 'Vider la file'));
      document.body.append(c);
    }
    const cur = S.current ? ` · ${{ launch: 'mise en vente', cancel: 'annulation', favorite: 'favori', tag: 'étiquette', discard: 'défausse' }[S.current.type]} : ${S.current.item.title}` : '';
    c.querySelector('.wmx-qtext').textContent = `⚡ File ${S.batch.done}/${S.batch.total}${cur}`;
  }

  function clearQueue() {
    S.queue = S.queue.filter((o) => o === S.current); // seul l'élément en cours de traitement ne peut pas être retiré
    S.batch.total = S.batch.done + S.queue.length;
    persist(); notify(); updateChip();
  }

  async function process() {
    if (S.running) return;
    S.running = true;
    notify();
    try {
      while (S.queue.length) {
        const op = S.queue[0];
        if (!(await claim(op))) { // déjà prise par un autre onglet
          S.queue = S.queue.filter((o) => o !== op);
          S.batch.total = Math.max(S.batch.done, S.batch.total - 1);
          updateChip(); notify();
          continue;
        }
        S.current = op;
        updateChip(); notify();
        let res;
        try { res = op.type === 'launch' ? await doLaunch(op.item) : op.type === 'cancel' ? await doCancel(op.item) : op.type === 'tag' ? await doTag(op.item) : op.type === 'discard' ? await doDiscard(op.item) : await doFavorite(op.item); } catch (e) { console.warn('[WMX] file d’enchères', op.type, op.item.title, e); res = { error: `${e?.name || 'Erreur'} : ${e?.message || e}` }; }
        S.queue = S.queue.filter((o) => o !== op);
        S.current = null;
        S.batch.done += 1;
        S.lastOpType = op.type;
        if (res.ok) S.batch.ok += 1;
        else if (res.limit) { // plus de place : on arrête les mises en vente restantes
          const rest = S.queue.filter((o) => o.type === 'launch').length + 1;
          S.queue = S.queue.filter((o) => o.type !== 'launch');
          S.batch.failed.push(`${rest} carte${rest > 1 ? 's' : ''} non lancée${rest > 1 ? 's' : ''} (limite de ${S.max} enchères)`);
          S.batch.total = S.batch.done + S.queue.length;
        } else if (res.error) S.batch.failed.push(`${op.item.title} : ${res.error}`);
        persist(); updateChip(); notify();
      }
      const b = S.batch;
      if (b.total > 1 || b.failed.length) {
        WMX.toast(`File terminée : ${b.ok} réussie${b.ok > 1 ? 's' : ''}${b.failed.length ? ` · ${b.failed.length} à vérifier (${b.failed.slice(0, 2).join(' ; ')})` : ''}.`, 9000);
      } else if (b.ok) {
        WMX.toast({ launch: 'Enchère lancée. Recliquez sur ⚡ pour l’annuler.', cancel: 'Enchère annulée : la carte est de retour dans votre collection.', favorite: 'Favori mis à jour.', tag: 'Étiquette mise à jour.', discard: 'Carte défaussée.' }[S.lastOpType] || 'Terminé.', 5000);
      }
      const lastLaunched = S.lastLaunched && S.selling.get(S.lastLaunched);
      if (lastLaunched) prewarm(lastLaunched); // prépare l'annulation éventuelle de la dernière enchère lancée
    } finally {
      S.running = false;
      S.current = null;
      S.batch = { done: 0, total: 0, ok: 0, failed: [] };
      updateChip(); notify();
    }
  }

  function enqueue(op) {
    op.id = op.id || newId();
    if (!S.running && !S.queue.length) S.batch = { done: 0, total: 0, ok: 0, failed: [] };
    S.queue.push(op);
    S.batch.total += 1;
    if (op.type === 'launch') S.lastLaunched = op.item.card_id;
    persist(); updateChip(); notify();
    process();
  }

  const stateOf = (cardId) => {
    if (S.current && isAuctionOp(S.current) && S.current.item.card_id === cardId) return S.current.type === 'launch' ? 'working' : 'cancelling';
    const q = S.queue.find((o) => isAuctionOp(o) && o.item.card_id === cardId);
    if (q) return q.type === 'launch' ? 'queued' : 'cancelling';
    return S.selling.has(cardId) ? 'live' : 'idle';
  };
  const favState = (cardId) => (S.current?.type === 'favorite' && S.current.item.card_id === cardId) || S.queue.some((o) => o.type === 'favorite' && o.item.card_id === cardId) ? 'working' : 'idle';
  const isStarred = (item) => (S.fav.has(item.card_id) ? S.fav.get(item.card_id) : !!item.starred);

  WMX.quick = {
    refresh,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    isRunning: () => S.running || S.queue.length > 0,
    stateOf,
    favState,
    isStarred,
    /**
     * Opérations en lot sur des cartes (mode sélection de Collection+) : 'favorite' (want 'on' | 'off'), 'tag' (tag, add), 'discard'.
     * Chaque carte est mise dans la même file que les enchères, traitée en arrière-plan, et reprend après un rechargement.
     */
    bulk(type, items, extra = {}) {
      for (const it of items) enqueue({ type, item: slim({ ...it, ...extra }) });
      return items.length;
    },
    /** Ajoute ou retire le favori (file d'attente, comme les enchères). */
    toggleFavorite(item) {
      if (favState(item.card_id) === 'working') return;
      enqueue({ type: 'favorite', item: slim({ ...item, starred: isStarred(item) }) });
    },
    selling: (cardId) => S.selling.get(cardId) || null,
    count: () => S.selling.size,
    queued: () => S.queue.filter((o) => o.type === 'launch').length,
    max: () => S.max,
    /** Texte de l'infobulle du bouton ⚡ d'une carte. */
    hint(item) {
      const st = stateOf(item.card_id);
      if (st === 'queued') return 'En file d’attente : sera mise en vente automatiquement (recliquez pour la retirer de la file)';
      if (st === 'working') return 'Mise en vente en cours…';
      if (st === 'cancelling') return 'Annulation en cours…';
      const a = S.selling.get(item.card_id);
      if (a) return `En vente à ${a.base_amount} W${a.current_bid ? ` (mise actuelle ${a.current_bid} W)` : ''} : cliquez pour annuler`;
      if (isStarred(item)) return 'Carte favorite : verrouillée, impossible de la vendre';
      const c = cfg();
      const p = WMX.prices.get(item.card_id, item.rarity);
      return p ? `Enchère rapide : ${startPrice(p)} W pendant ${c.dur} (moyenne ${Math.round(p.avg)} W × ${c.coef})` : 'Enchère rapide (le prix sera chargé automatiquement)';
    },
    /** Annule la vente d'une carte (depuis la page Enchères). Renvoie false si la carte n'est plus en vente. */
    cancelItem(item) {
      if (!S.selling.has(item.card_id) || stateOf(item.card_id) === 'cancelling') return false;
      enqueue({ type: 'cancel', item: slim(item) });
      return true;
    },
    /** Un clic met en file ; sur une carte en file il la retire ; sur une carte en vente il annule l'enchère. */
    toggle(item) {
      const id = item.card_id;
      const st = stateOf(id);
      if (st === 'working' || st === 'cancelling') return WMX.toast('Cette carte est en cours de traitement…');
      if (st === 'queued') {
        S.queue = S.queue.filter((o) => !(o.item.card_id === id && o.type === 'launch'));
        S.batch.total = Math.max(S.batch.done, S.batch.total - 1);
        persist(); updateChip(); notify();
        return undefined;
      }
      if (st === 'live') return enqueue({ type: 'cancel', item: slim(item) });
      if (isStarred(item)) return WMX.toast('Carte favorite : le jeu la verrouille, impossible de la vendre.');
      if (S.selling.size + WMX.quick.queued() >= S.max) return WMX.toast(`Limite de ${S.max} enchères actives : ${S.selling.size} en vente, ${WMX.quick.queued()} en file.`);
      return enqueue({ type: 'launch', item: slim(item) });
    },
  };

  // Reprise : une file mémorisée (page rechargée en cours de route) repart toute seule.
  (async () => {
    const stored = await WMX.store.get('quickQueue', []);
    // Une défausse est définitive : elle ne reprend JAMAIS toute seule après un rechargement (à relancer depuis la sélection).
    const q = stored.filter((o) => o.type !== 'discard').map((o) => ({ ...o, id: o.id || newId() }));
    if (q.length !== stored.length || q.some((o, i) => o.id !== stored[i]?.id)) {
      await WMX.store.set('quickQueue', q);
      setTimeout(() => WMX.toast?.(`${stored.length - q.length} défausse${stored.length - q.length > 1 ? 's' : ''} en attente abandonnée${stored.length - q.length > 1 ? 's' : ''} (page rechargée) : relancez-les depuis la sélection si besoin.`, 9000), 3000);
    }
    if (!q.length) return;
    S.queue = q.map((o) => ({ id: o.id, type: o.type, item: o.item }));
    S.batch = { done: 0, total: q.length, ok: 0, failed: [] };
    updateChip();
    await sleep(4000); // laisse les réglages et les prix se charger
    await WMX.prices.load();
    process();
  })();
})();
