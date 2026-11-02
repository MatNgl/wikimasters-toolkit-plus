// Inventaire : toute la collection en mémoire (≈ 6 000 cartes, GET /api/my-collection comme la page du jeu), valeur estimée,
// et le chargement des prix par rareté ou par étiquette (fenêtre « Charger les prix »). Partagé par la collection du jeu
// (collection-native.js) et le tableau de bord (dashboard.js). L'extension ne fait ici que LIRE.
(() => {
  const { el, sleep } = WMX.dom;
  const R = WMX.RARITIES;
  const RANK = { L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0 };
  const INV_TTL = 10 * 60 * 1000; // inventaire en cache : actualisé en arrière-plan au-delà de 10 min

  const S = {
    items: [], loading: false, loadedCount: 0, started: false, gone: new Map(),
    priceRar: new Set(['L', 'UR', 'SR', 'R']), priceMode: 'rar', priceTags: new Set(), tagsTouched: false,
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => { try { cb(); } catch (_) { /* écouteur obsolète */ } });
  const bars = []; // barres de prix affichées (une par page qui en a une)
  let index = null; // clé « titre|rareté » -> carte

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const price = (it) => WMX.prices.get(it.card_id, it.rarity);
  /** « Moy. — » = prix pas encore chargé ; « Sans vente » = chargé, mais aucune vente sur le marché pour cette rareté. */
  const priceText = (it) => {
    const p = price(it);
    if (p) return `Moy. ${fmt(p.avg)} W`;
    return WMX.prices.has(it.card_id) ? 'Sans vente' : 'Moy. —';
  };
  const compact = (r) => ({
    id: r.id, card_id: r.card_id, title: r.card?.wikipedia_title || '?', rarity: WMX.normRarity(r.card?.rarity) || 'C',
    image: r.card?.hide_image || r.card?.nsfw_image ? '' : (r.card?.image_url || ''), lang: r.card?.lang || 'fr',
    count: r.count || 1, starred: !!r.starred, at: r.obtained_at || '',
    tags: (r.tags || []).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  });
  const tagKey = (s) => String(s || '').trim().toLowerCase();
  const hasTag = (it, name) => it.tags.some((t) => tagKey(t.name) === tagKey(name));

  /** Un chargement lancé AVANT une défausse peut rendre des cartes déjà défaussées : on les retire. */
  function withoutDiscarded(list) {
    if (!S.gone.size) return list;
    return list.map((it) => (S.gone.has(it.card_id) ? { ...it, count: it.count - S.gone.get(it.card_id) } : it)).filter((it) => it.count > 0);
  }
  const setItems = (list) => { S.items = list; index = null; emit(); };

  async function loadInventory() {
    if (S.loading) return;
    S.loading = true;
    const hadCache = S.items.length > 0; // avec un cache on garde l'affichage actuel jusqu'à la fin
    const byId = new Map();
    let blocks = 0;
    let fails = 0;
    let complete = false; // vrai seulement si on atteint la dernière page (une réponse vide)
    for (let p = 0; p < 400 && WMX.alive(); p++) {
      const u = new URL('/api/my-collection', location.origin);
      u.searchParams.set('sort', 'name'); // tri alphabétique : ordre stable d'une page à l'autre
      u.searchParams.set('page', String(p));
      u.searchParams.set('stats', '0');
      let res;
      try { res = await fetch(u); } catch (_) { res = null; }
      if (res?.status === 429) { blocks += 1; await sleep((3 + blocks) * 1000); p -= 1; continue; }
      if (!res || !res.ok) { // erreur passagère du jeu (503…) : on réessaie la même page quelques fois avant d'abandonner
        fails += 1;
        if (fails > 6) { WMX.reportError?.('inventaire', res?.status ?? 0, `page ${p}`); break; }
        await sleep(2000 + fails * 2500);
        p -= 1;
        continue;
      }
      blocks = 0;
      fails = 0;
      const rows = (await res.json()).collection || [];
      if (!rows.length) { complete = true; break; }
      for (const r of rows) byId.set(r.id, compact(r));
      S.loadedCount = byId.size;
      if (!hadCache && p % 4 === 0) setItems(withoutDiscarded([...byId.values()]));
      else renderStatus();
      await sleep(300);
    }
    S.loading = false;
    if (complete || !S.items.length) setItems(withoutDiscarded([...byId.values()]));
    // Un chargement interrompu ne remplace pas un inventaire plus complet, et son cache est marqué incomplet (rechargé la prochaine fois).
    WMX.store.set('invCacheV2', { t: Date.now(), items: S.items, complete });
  }

  /** Charge les préférences, puis l'inventaire en cache (affiché aussitôt) et, s'il est périmé, l'inventaire à jour. */
  async function ensure() {
    if (S.started) return;
    S.started = true;
    const prefs = await WMX.store.get('cplusPrefs', {});
    if (prefs.priceMode === 'tag') S.priceMode = 'tag';
    if (Array.isArray(prefs.priceRar)) S.priceRar = new Set(prefs.priceRar.filter((r) => R.includes(r)));
    if (Array.isArray(prefs.priceTags)) S.priceTags = new Set(prefs.priceTags);
    S.tagsTouched = !!prefs.tagsTouched;
    await WMX.prices.load();
    const cached = await WMX.store.get('invCacheV2', null);
    if (cached?.items?.length) setItems(withoutDiscarded(cached.items));
    if (!cached || !cached.complete || Date.now() - cached.t > INV_TTL) loadInventory(); // un cache sans « complete » est partiel : on recharge
  }

  const keyOf = (title, rarity) => `${norm(title)}|${rarity}`;
  /** Carte de l'inventaire correspondant à un titre et une rareté (tels qu'affichés par le jeu). */
  function find(title, rarity) {
    if (!index) { index = new Map(); for (const it of S.items) index.set(keyOf(it.title, it.rarity), it); }
    return index.get(keyOf(title, rarity)) || null;
  }
  /** Lignes d'une page de la collection du jeu (réponse de /api/my-collection) : permet de reconnaître les cartes avant la fin du chargement. */
  const pageRows = new Map();
  function learn(rows) {
    for (const r of rows || []) { const c = compact(r); pageRows.set(keyOf(c.title, c.rarity), c); }
  }
  const findAny = (title, rarity) => find(title, rarity) || pageRows.get(keyOf(title, rarity)) || null;

  // --- Événements de la file (favori, étiquette, défausse) : l'inventaire reste à jour sans rechargement ---------------
  window.addEventListener('wmx:fav', (e) => { for (const it of S.items) if (it.card_id === e.detail.card_id) it.starred = e.detail.starred; emit(); });
  window.addEventListener('wmx:tag', (e) => {
    const { card_id, tag, add } = e.detail;
    const known = S.items.flatMap((i) => i.tags).find((t) => tagKey(t.name) === tagKey(tag));
    for (const it of S.items) {
      if (it.card_id !== card_id) continue;
      it.tags = add ? (hasTag(it, tag) ? it.tags : [...it.tags, known || { id: tag, name: tag, color: null }]) : it.tags.filter((t) => tagKey(t.name) !== tagKey(tag));
    }
    emit();
  });
  window.addEventListener('wmx:discard', (e) => {
    S.gone.set(e.detail.card_id, (S.gone.get(e.detail.card_id) || 0) + 1);
    for (const it of S.items) if (it.card_id === e.detail.card_id) it.count -= 1;
    setItems(S.items.filter((i) => i.count > 0));
    if (!S.loading) WMX.store.set('invCacheV2', { t: Date.now(), items: S.items, complete: true }); // le cache ne réaffiche plus les cartes défaussées (jamais une liste partielle)
  });

  function totals() {
    let value = 0, priced = 0, copies = 0;
    const byR = Object.fromEntries(R.map((r) => [r, 0]));
    for (const it of S.items) {
      copies += it.count;
      const p = price(it);
      if (!p) continue;
      priced += 1;
      value += p.avg * it.count;
      byR[it.rarity] += p.avg * it.count;
    }
    return { value, priced, copies, byR, total: S.items.length };
  }

  // --- Barre de prix (état + bouton) --------------------------------------------------------------
  function renderStatus() {
    const t = totals();
    const st = WMX.prices.state();
    const noSale = S.items.filter((it) => WMX.prices.has(it.card_id) && !price(it)).length; // prix demandé, mais aucune vente pour cette rareté
    const loaded = t.priced + noSale; // cartes dont le prix est connu (moyenne existante ou « sans vente »)
    const info = !S.items.length ? (S.loading || S.started ? `Chargement de la collection : ${fmt(S.loadedCount)} cartes…` : 'Collection non chargée')
      : st.running
        ? `Prix : ${fmt(st.done)} / ${fmt(st.total)}${st.wait ? ` · pause ${st.wait} s (limite du jeu)` : ''}${st.failed ? ` · ${st.failed} à réessayer` : ''}${st.paused ? ' · en pause' : ''}`
        : `Prix récupérés : ${fmt(loaded)} / ${fmt(t.total)} (dont ${fmt(noSale)} sans vente)${st.failed ? ` · ${st.failed} à réessayer` : ''}`;
    const pct = `${st.running && st.total ? (st.done / st.total) * 100 : (t.total ? (loaded / t.total) * 100 : 0)}%`;
    for (const b of bars) {
      if (!b.root.isConnected) continue;
      b.info.textContent = info;
      b.bar.firstChild.style.width = pct;
      b.btn.textContent = st.running ? (st.paused ? 'Reprendre' : 'Pause') : 'Charger les prix…';
      b.stop.hidden = !st.running;
      b.value.textContent = t.total ? `Valeur estimée : ${fmt(t.value)} W` : '';
      b.value.title = `Somme des moyennes du marché × exemplaires, pour les ${fmt(t.priced)} cartes dont le prix est chargé.`;
    }
  }

  /** Barre « valeur · état des prix · bouton » : un seul bouton, qui ouvre la fenêtre de choix. */
  function makePriceBar(cls = '') {
    const info = el('span', { class: 'wmx-pb-info' });
    const value = el('b', { class: 'wmx-pb-value' });
    const bar = el('div', { class: 'wmx-cp-bar' }, el('i'));
    const btn = el('button', { class: 'wmx-btn', onclick: priceAction }, 'Charger les prix…');
    const stop = el('button', { class: 'wmx-btn wmx-btn--ghost', hidden: '', onclick: () => WMX.prices.stop() }, 'Arrêter');
    const root = el('div', { class: `wmx-cp-prices ${cls}` }, el('div', { class: 'wmx-cp-pricehead' }, value, info, el('span', { class: 'wmx-cp-pspacer' }), btn, stop), bar);
    bars.push({ root, info, value, bar, btn, stop });
    renderStatus();
    return root;
  }

  // --- Chargement des prix par rareté ou par étiquette ---------------------------------------------
  const savePrefs = () => WMX.store.set('cplusPrefs', { priceMode: S.priceMode, priceRar: [...S.priceRar], priceTags: [...S.priceTags], tagsTouched: S.tagsTouched });
  const chip = (label, rgb, on, onToggle) => {
    const b = el('button', { class: 'wmx-chip2', 'aria-pressed': String(on), style: rgb ? `--rgb:${rgb}` : '' }, label);
    b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); onToggle(v); });
    return b;
  };

  /** Cartes concernées par le choix (raretés ou étiquettes) et, parmi elles, celles dont le prix manque ou est périmé. */
  function pricePlan() {
    const byTag = S.priceMode === 'tag';
    const selected = byTag
      ? S.items.filter((it) => it.tags.some((t) => S.priceTags.has(t.id)))
      : S.items.filter((it) => S.priceRar.has(it.rarity));
    // Priorité : les prix jamais chargés ; l'actualisation (prix de plus de 4 jours) n'a lieu qu'une fois tous passés une fois.
    const batch = WMX.logic.priceBatch(selected, (it) => WMX.prices.has(it.card_id), (it) => WMX.prices.fresh(it.card_id));
    const todo = batch.todo.slice().sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.title.localeCompare(b.title, 'fr'));
    return { selected, todo, missing: batch.missing.length, stale: batch.stale.length, refresh: batch.refresh };
  }
  function startPriceLoad() {
    const { selected, todo } = pricePlan();
    if (!todo.length) return false;
    WMX.prices.start(todo, { base: selected.length - todo.length, total: selected.length });
    return true;
  }

  let priceModal = null;
  function openPriceModal() {
    if (priceModal) return;
    if (!S.tagsTouched && !S.priceTags.size) { // « vente » est cochée d'office la première fois
      const sale = S.items.flatMap((i) => i.tags).find((t) => /vente/i.test(t.name));
      if (sale) S.priceTags.add(sale.id);
    }
    const body = el('div', { class: 'wmx-pm-body' });
    const close = () => { back.remove(); priceModal = null; };
    const go = el('button', { class: 'wmx-btn', onclick: () => { if (startPriceLoad()) close(); } }, 'Charger');
    const back = el('div', { class: 'wmx-dlg-back', onmousedown: (e) => { if (e.target === back) close(); } },
      el('div', { class: 'wmx-dlg wmx-dlg--wide', role: 'dialog', 'aria-label': 'Charger les prix' },
        el('h3', {}, 'Charger les prix'),
        el('p', { class: 'wmx-dlg-note' }, 'Choisissez ce qu’il faut charger. Les prix jamais chargés passent en premier ; un prix déjà chargé n’est actualisé que sur votre demande, et seulement au bout de 4 jours.'),
        body,
        el('div', { class: 'wmx-dlg-row' }, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'), go)));
    // Par choix : prix jamais chargés (priorité) ou, à défaut, prix de plus de 4 jours.
    const missing = (list) => list.filter((it) => !WMX.prices.has(it.card_id)).length;
    const stale = (list) => list.filter((it) => WMX.prices.has(it.card_id) && !WMX.prices.fresh(it.card_id)).length;
    const count = (list) => { const m = missing(list); return m ? `${m} jamais chargé${m > 1 ? 's' : ''}` : (stale(list) ? `${stale(list)} à actualiser` : 'à jour'); };
    function render() {
      const mode = (m, label) => el('button', { class: 'wmx-chip2', 'aria-pressed': String(S.priceMode === m), onclick: () => { S.priceMode = m; savePrefs(); render(); } }, label);
      let chips;
      if (S.priceMode === 'rar') {
        chips = el('div', { class: 'wmx-pm-chips' }, ...R.map((r) => chip(`${r} · ${count(S.items.filter((i) => i.rarity === r))}`, WMX.RARITY_RGB[r], S.priceRar.has(r),
          (on) => { on ? S.priceRar.add(r) : S.priceRar.delete(r); savePrefs(); render(); })));
      } else {
        const counts = new Map();
        for (const it of S.items) for (const t of it.tags) { const e = counts.get(t.id) || { ...t, list: [] }; e.list.push(it); counts.set(t.id, e); }
        const tags = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        chips = el('div', { class: 'wmx-pm-chips wmx-pm-tags' }, ...(tags.length ? tags.map((t) => chip(`${t.name} · ${count(t.list)}`, '', S.priceTags.has(t.id),
          (on) => { S.tagsTouched = true; on ? S.priceTags.add(t.id) : S.priceTags.delete(t.id); savePrefs(); render(); }))
          : [el('span', { class: 'wmx-cp-empty' }, 'Aucune étiquette dans la collection')]));
      }
      const { selected, todo, missing: nMissing, stale: nStale, refresh } = pricePlan();
      const mins = Math.max(1, Math.round((todo.length * 1.5) / 60));
      body.replaceChildren(
        el('div', { class: 'wmx-pm-seg' }, mode('rar', 'Par rareté'), mode('tag', 'Par étiquette')),
        chips,
        el('p', { class: 'wmx-pm-sum' }, !selected.length ? (S.priceMode === 'tag' ? 'Choisissez au moins une étiquette.' : 'Choisissez au moins une rareté.')
          : refresh ? `Tous les prix de ce choix ont été chargés au moins une fois. ${fmt(nStale)} ont plus de 4 jours : à actualiser (environ ${mins} min, selon la réponse du jeu).`
          : todo.length ? `${fmt(nMissing)} prix jamais chargés${nStale ? ` (${fmt(nStale)} de plus de 4 jours attendront que tout ait été chargé une fois)` : ''} · environ ${mins} min, selon la réponse du jeu.`
          : 'Tous les prix de ce choix sont à jour (moins de 4 jours).'));
      go.textContent = todo.length ? (refresh ? `Actualiser ${fmt(todo.length)} prix` : `Charger ${fmt(todo.length)} prix`) : 'Charger';
      go.disabled = !todo.length;
    }
    priceModal = { render };
    document.body.append(back);
    render();
  }
  listeners.add(() => priceModal?.render());

  function priceAction() {
    const st = WMX.prices.state();
    if (st.running) { if (st.paused) WMX.prices.resume(); else WMX.prices.pause(); return; }
    ensure().then(openPriceModal);
  }

  let tick = null;
  WMX.prices.onProgress(() => {
    renderStatus();
    if (tick) return; // une mise à jour au plus toutes les 1,5 s, même pendant un chargement continu
    tick = setTimeout(() => { tick = null; emit(); }, 1500);
  });
  listeners.add(renderStatus);

  WMX.inventory = {
    ensure, renderStatus, items: () => S.items, find: findAny, learn, totals, price, priceText, fmt, makePriceBar, openPriceModal,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    isLoading: () => S.loading,
  };
})();
