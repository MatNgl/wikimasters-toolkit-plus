// Collection+ : toute la collection en mémoire (≈ 6 400 cartes), filtres et tri instantanés, pagination au choix
// (10 / 25 / 50 / 100), prix du marché par carte, valeur estimée, et la VRAIE fiche du jeu au clic (cadre invisible,
// voir card-detail.js). L'extension ne fait que LIRE l'inventaire (GET /api/my-collection, comme la page du jeu).
(() => {
  const { el, sleep } = WMX.dom;
  const R = WMX.RARITIES;
  const RANK = { L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0 };
  const PER_PAGE = [10, 25, 50, 100, 250];
  const SORTS = [['rarity', 'Rareté'], ['expensive', 'Plus chères'], ['cheap', 'Moins chères'], ['recent', 'Ajoutées récemment'], ['name', 'Nom (A → Z)']];
  const INV_TTL = 10 * 60 * 1000; // inventaire en cache : actualisé en arrière-plan au-delà de 10 min

  const S = {
    items: [], page: 1, perPage: 50, sort: 'rarity', q: '', rar: new Set(), tag: '', fav: false, dup: false,
    min: '', max: '', tab: 'cards', priceRar: new Set(['L', 'UR', 'SR', 'R']), priceMode: 'rar', priceTags: new Set(), selecting: false, sel: new Set(), gone: new Map(), tagsTouched: false, loading: false, loadedCount: 0,
  };
  let overlay = null;  // page « Collection+ »
  let pageDash = null; // page « Tableau de bord »
  let refreshTimer = null;
  let tickTimer = null;
  const ui = {};

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const price = (it) => WMX.prices.get(it.card_id, it.rarity);
  const avg = (it) => price(it)?.avg ?? null;
  /** « Moy. — » = prix pas encore chargé ; « Sans vente » = chargé, mais aucune vente sur le marché pour cette rareté. */
  const priceText = (it) => {
    const p = price(it);
    if (p) return `Moy. ${fmt(p.avg)} W`;
    return WMX.prices.fresh(it.card_id) ? 'Sans vente' : 'Moy. —';
  };

  const compact = (r) => ({
    id: r.id, card_id: r.card_id, title: r.card?.wikipedia_title || '?', rarity: WMX.normRarity(r.card?.rarity) || 'C',
    image: r.card?.hide_image || r.card?.nsfw_image ? '' : (r.card?.image_url || ''), lang: r.card?.lang || 'fr',
    count: r.count || 1, starred: !!r.starred, at: r.obtained_at || '',
    tags: (r.tags || []).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  });

  // --- Inventaire ------------------------------------------------------------------------------
  async function loadInventory() {
    if (S.loading) return;
    S.loading = true;
    const hadCache = S.items.length > 0; // avec un cache on garde l'affichage actuel jusqu'à la fin
    const byId = new Map();
    let blocks = 0;
    for (let p = 0; p < 400 && WMX.alive(); p++) {
      const u = new URL('/api/my-collection', location.origin);
      u.searchParams.set('sort', 'name'); // tri alphabétique : ordre stable d'une page à l'autre
      u.searchParams.set('page', String(p));
      u.searchParams.set('stats', '0');
      let res;
      try { res = await fetch(u); } catch (_) { break; }
      if (res.status === 429) { blocks += 1; await sleep((3 + blocks) * 1000); p -= 1; continue; }
      if (!res.ok) break;
      blocks = 0;
      const rows = (await res.json()).collection || [];
      if (!rows.length) break;
      for (const r of rows) byId.set(r.id, compact(r));
      S.loadedCount = byId.size;
      if (!hadCache && p % 4 === 0) { S.items = withoutDiscarded([...byId.values()]); fillTags(); refresh(); }
      renderStatus();
      await sleep(300);
    }
    S.items = withoutDiscarded([...byId.values()]);
    S.loading = false;
    WMX.store.set('invCache', { t: Date.now(), items: S.items });
    fillTags();
    refresh();
  }

  /** Un chargement lancé AVANT une défausse peut rendre des cartes déjà défaussées : on les retire (et on mémorise la correction). */
  function withoutDiscarded(list) {
    if (!S.gone.size) return list;
    return list.map((it) => (S.gone.has(it.card_id) ? { ...it, count: it.count - S.gone.get(it.card_id) } : it)).filter((it) => it.count > 0);
  }

  // --- Filtres, tri ----------------------------------------------------------------------------
  function view() {
    const q = norm(S.q);
    const min = S.min === '' ? null : Number(S.min);
    const max = S.max === '' ? null : Number(S.max);
    const rows = S.items.filter((it) => {
      if (S.rar.size && !S.rar.has(it.rarity)) return false;
      if (q && !norm(it.title).includes(q)) return false;
      if (S.fav && !it.starred) return false;
      if (S.dup && it.count < 2) return false;
      if (S.tag === '__none') { if (it.tags.length) return false; }
      else if (S.tag && !it.tags.some((t) => t.id === S.tag)) return false;
      if (min != null || max != null) {
        const v = avg(it);
        if (v == null || (min != null && v < min) || (max != null && v > max)) return false;
      }
      return true;
    });
    const v = new Map(rows.map((it) => [it.id, avg(it)]));
    const byPrice = (dir) => (a, b) => {
      const x = v.get(a.id), y = v.get(b.id);
      if (x == null && y == null) return a.title.localeCompare(b.title, 'fr');
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * (x - y) || a.title.localeCompare(b.title, 'fr');
    };
    const sorters = {
      rarity: (a, b) => RANK[b.rarity] - RANK[a.rarity] || a.title.localeCompare(b.title, 'fr'),
      expensive: byPrice(-1),
      cheap: byPrice(1),
      recent: (a, b) => b.at.localeCompare(a.at),
      name: (a, b) => a.title.localeCompare(b.title, 'fr'),
    };
    return rows.sort(sorters[S.sort] || sorters.rarity);
  }

  // --- Affichage -------------------------------------------------------------------------------
  /** Bouton ⚡ : un clic met la carte en file d'attente ; recliquer la retire de la file ou annule l'enchère (voir quick-auction.js). */
  function bolt(it) {
    const q = WMX.quick;
    if (!q) return '';
    const st = q.stateOf(it.card_id);
    const glyph = { queued: '⏳', working: '…', cancelling: '…' }[st] || '⚡';
    const b = el('button', { class: `wmx-bolt${st === 'live' ? ' live' : ''}${st === 'queued' ? ' queued' : ''}${st === 'working' || st === 'cancelling' ? ' busy' : ''}`, title: q.hint(it), 'aria-label': 'Enchère rapide' }, glyph);
    if (it.starred && st === 'idle') b.disabled = true;
    b.addEventListener('click', (e) => { e.stopPropagation(); q.toggle(it); });
    b.addEventListener('mouseenter', () => WMX.prepareCardSheets?.('work')); // le cadre d'automatisation charge dès qu'on vise ⚡
    return b;
  }

  function tile(it) {
    const p = price(it);
    const t = el('div', { class: 'wmx-ct', 'data-id': it.id, 'data-r': it.rarity, style: `--rgb:${WMX.RARITY_RGB[it.rarity]}`, title: 'Cliquer pour ouvrir la fiche' },
      el('div', { class: 'wmx-ct-shade' }),
      el('span', { class: 'wmx-rar' }, it.rarity),
      el('i', { class: 'wmx-ct-check' }, '✓'),
      el('div', { class: 'wmx-ct-acts' }, bolt(it), it.starred ? el('i', { class: 'wmx-star' }, '★') : '', it.count > 1 ? el('i', { class: 'wmx-ct-n' }, `×${it.count}`) : ''),
      el('div', { class: 'wmx-meta' }, el('strong', {}, it.title), el('span', { class: 'wmx-ct-price' }, priceText(it))));
    if (it.image) WMX.dom.artLayers(it.image, t);
    if (S.sel.has(it.id)) t.classList.add('sel');
    t.addEventListener('click', () => {
      if (S.selecting) return toggleSel(it, t); // mode sélection : un clic coche / décoche la carte
      return WMX.openCardDetail?.({ id: it.card_id, wikipedia_title: it.title, rarity: it.rarity, lang: it.lang });
    });
    return t;
  }

  function pager(pages) {
    const nums = new Set([1, pages, S.page - 2, S.page - 1, S.page, S.page + 1, S.page + 2]);
    const list = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    const nav = (label, target, off) => {
      const b = el('button', { class: 'wmx-pg', onclick: () => go(target) }, label);
      if (off) b.disabled = true;
      return b;
    };
    const out = [nav('‹', S.page - 1, S.page <= 1)];
    let prev = 0;
    for (const n of list) {
      if (n - prev > 1) out.push(el('span', { class: 'wmx-pg-gap' }, '…'));
      out.push(el('button', { class: `wmx-pg${n === S.page ? ' on' : ''}`, onclick: () => go(n) }, String(n)));
      prev = n;
    }
    out.push(nav('›', S.page + 1, S.page >= pages));
    return out;
  }

  function go(n) { S.page = n; refresh(); ui.grid.scrollTo?.(0, 0); overlay.querySelector('.wmx-cp-scroll')?.scrollTo(0, 0); }

  /**
   * Met à jour les boutons ⚡ et les prix des cartes affichées SANS les réordonner : une carte sur laquelle on clique
   * (ou dont le prix vient d'arriver) reste à sa place. Le tri ne se refait que sur une action de l'utilisateur.
   */
  function refreshTiles() {
    if (!overlay || !ui.grid) return;
    if (S.byIdSrc !== S.items) { S.byId = new Map(S.items.map((i) => [i.id, i])); S.byIdSrc = S.items; }
    for (const t of ui.grid.querySelectorAll('.wmx-ct')) {
      const it = S.byId.get(t.dataset.id);
      if (!it) continue;
      t.querySelector('.wmx-bolt')?.replaceWith(bolt(it));
      const acts = t.querySelector('.wmx-ct-acts');
      const star = acts?.querySelector('.wmx-star');
      if (it.starred && !star) acts.append(el('i', { class: 'wmx-star' }, '★'));
      else if (!it.starred && star) star.remove();
      const pr = t.querySelector('.wmx-ct-price');
      if (pr) pr.textContent = priceText(it);
    }
    renderStatus();
  }

  function refresh() {
    if (!overlay) return;
    if (ui.reorder) ui.reorder.hidden = true;
    const rows = view();
    const pages = Math.max(1, Math.ceil(rows.length / S.perPage));
    if (S.page > pages) S.page = pages;
    const from = (S.page - 1) * S.perPage;
    ui.grid.replaceChildren(...(rows.length ? rows.slice(from, from + S.perPage).map(tile)
      : [el('p', { class: 'wmx-cp-empty' }, S.loading ? 'Chargement de la collection…' : 'Aucune carte ne correspond à ces filtres.')]));
    ui.count.textContent = rows.length ? `${fmt(from + 1)} à ${fmt(Math.min(from + S.perPage, rows.length))} sur ${fmt(rows.length)} cartes` : '0 carte';
    ui.pager.replaceChildren(...(rows.length ? pager(pages) : []));
    renderStatus();
    if (S.tab === 'dash') renderDash();
  }

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

  function renderStatus() {
    if (!ui.heads) return;
    const t = totals();
    const auctions = WMX.quick ? ` · Enchères : ${WMX.quick.count()}/${WMX.quick.max()}` : '';
    const statusText = (S.loading ? `Chargement de la collection : ${fmt(S.loadedCount)} cartes…` : `${fmt(t.total)} cartes uniques · ${fmt(t.copies)} exemplaires`) + auctions;
    for (const h of ui.heads) {
      h.value.textContent = t.total ? `Valeur estimée : ${fmt(t.value)} W` : '';
      h.value.title = `Somme des moyennes du marché × exemplaires, pour les ${fmt(t.priced)} cartes dont le prix est chargé.`;
      h.status.textContent = statusText;
    }
    const st = WMX.prices.state();
    const noSale = S.items.filter((it) => WMX.prices.fresh(it.card_id) && !price(it)).length; // prix demandé, mais aucune vente pour cette rareté
    const loaded = t.priced + noSale; // cartes dont le prix est connu (moyenne existante ou « sans vente »)
    const info = st.running
      ? `Prix : ${fmt(st.done)} / ${fmt(st.total)}${st.wait ? ` · pause ${st.wait} s (limite du jeu)` : ''}${st.failed ? ` · ${st.failed} à réessayer` : ''}${st.paused ? ' · en pause' : ''}`
      : `Prix récupérés : ${fmt(loaded)} / ${fmt(t.total)} (dont ${fmt(noSale)} sans vente)${st.failed ? ` · ${st.failed} à réessayer` : ''}`;
    const pct = `${st.running && st.total ? (st.done / st.total) * 100 : (t.total ? (loaded / t.total) * 100 : 0)}%`;
    for (const p of ui.priceBars) {
      p.info.textContent = info;
      p.bar.firstChild.style.width = pct;
      p.btn.textContent = st.running ? (st.paused ? 'Reprendre' : 'Pause') : 'Charger les prix…';
      p.stop.hidden = !st.running;
    }
  }

  function fillTags() {
    refreshPriceModal();
    if (!ui.tag) return;
    const counts = new Map();
    for (const it of S.items) for (const t of it.tags) counts.set(t.id, { ...t, n: (counts.get(t.id)?.n || 0) + 1 });
    const keep = ui.tag.value || S.tag;
    ui.tag.replaceChildren(el('option', { value: '' }, 'Toutes les étiquettes'), el('option', { value: '__none' }, 'Sans étiquette'),
      ...[...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((t) => el('option', { value: t.id }, `${t.name} (${t.n})`)));
    ui.tag.value = keep;
  }

  // --- Tableau de bord -------------------------------------------------------------------------
  async function recordValue(t) {
    if (!t.priced) return;
    const h = await WMX.store.get('valueHistory', {});
    h[new Date().toLocaleDateString('sv-SE')] = { value: Math.round(t.value), priced: t.priced, total: t.total };
    WMX.store.set('valueHistory', h);
  }

  async function renderDash() {
    const t = totals();
    recordValue(t);
    const hist = await WMX.store.get('valueHistory', {});
    const days = Object.keys(hist).sort();
    const top = S.items.filter((it) => avg(it) != null).sort((a, b) => avg(b) - avg(a)).slice(0, 10);
    const metric = (label, value, sub) => el('div', { class: 'wmx-metric' }, el('small', {}, label), el('b', {}, value), sub ? el('small', {}, sub) : '');
    let spark = el('p', { class: 'wmx-cp-empty' }, 'La courbe apparaîtra dès qu’au moins deux jours de valeur auront été enregistrés.');
    if (days.length >= 2) {
      const vals = days.map((d) => hist[d].value);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 300},${80 - (hi === lo ? 40 : ((v - lo) / (hi - lo)) * 70) - 5}`).join(' ');
      spark = el('div', {});
      spark.innerHTML = `<svg viewBox="0 0 300 80" width="100%" height="90" role="img" aria-label="Valeur dans le temps"><polyline points="${pts}" fill="none" stroke="var(--acc,#2dd4a0)" stroke-width="2"/></svg>`;
      spark.append(el('small', { class: 'wmx-cp-note' }, `${days[0]} → ${days.at(-1)} · de ${fmt(lo)} W à ${fmt(hi)} W`));
    }
    ui.dash.replaceChildren(
      el('div', { class: 'wmx-metrics' },
        metric('Valeur estimée', `${fmt(t.value)} W`, `${fmt(t.priced)} / ${fmt(t.total)} prix chargés`),
        metric('Cartes uniques', fmt(t.total), `${fmt(t.copies)} exemplaires`),
        metric('Prix chargés', `${t.total ? Math.round((t.priced / t.total) * 100) : 0} %`, 'Chargez les raretés manquantes')),
      el('div', { class: 'wmx-dash-grid' },
        el('div', { class: 'wmx-panelbox' }, el('h4', {}, 'Valeur par rareté'),
          el('div', { class: 'wmx-stackbar' }, ...R.map((r) => el('i', { style: `flex:${t.byR[r] || 0.0001};background:rgb(${WMX.RARITY_RGB[r]})` }))),
          ...R.map((r) => el('div', { class: 'wmx-row2', style: `--rgb:${WMX.RARITY_RGB[r]}` }, el('b', {}, r), el('span', {}, `${fmt(t.byR[r])} W`)))),
        el('div', { class: 'wmx-panelbox' }, el('h4', {}, 'Top 10 des plus chères'),
          ...(top.length ? top.map((it) => el('div', { class: 'wmx-row2', style: `--rgb:${WMX.RARITY_RGB[it.rarity]}` },
            el('span', {}, `${it.rarity} · ${it.title}`), el('b', {}, `${fmt(avg(it))} W`))) : [el('p', { class: 'wmx-cp-empty' }, 'Aucun prix chargé pour le moment.')]))),
      el('div', { class: 'wmx-panelbox' }, el('h4', {}, 'Valeur dans le temps'), spark));
  }

  // --- Construction de l'écran -----------------------------------------------------------------
  const chip = (label, rgb, on, onToggle) => {
    const b = el('button', { class: 'wmx-chip2', 'aria-pressed': String(on), style: rgb ? `--rgb:${rgb}` : '' }, label);
    b.addEventListener('click', () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); onToggle(v); });
    return b;
  };
  const select = (opts, value, onChange) => {
    const s = el('select', { class: 'wmx-input wmx-select' }, ...opts.map(([v, l]) => el('option', { value: String(v) }, l)));
    s.value = String(value);
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  const savePrefs = () => WMX.store.set('cplusPrefs', {
    perPage: S.perPage, sort: S.sort, priceMode: S.priceMode, priceRar: [...S.priceRar], priceTags: [...S.priceTags], tagsTouched: S.tagsTouched,
  });

  /** Cartes concernées par le choix (raretés ou étiquettes) et, parmi elles, celles dont le prix manque ou est périmé. */
  function pricePlan() {
    const byTag = S.priceMode === 'tag';
    const selected = byTag
      ? S.items.filter((it) => it.tags.some((t) => S.priceTags.has(t.id)))
      : S.items.filter((it) => S.priceRar.has(it.rarity));
    // Un prix encore valable (48 h, 96 h si la carte est très vendue) n'est pas rechargé ; il compte d'emblée dans la jauge.
    const todo = selected.filter((it) => !WMX.prices.fresh(it.card_id))
      .sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.title.localeCompare(b.title, 'fr'));
    return { selected, todo };
  }

  function startPriceLoad() {
    const { selected, todo } = pricePlan();
    if (!todo.length) return false;
    WMX.prices.start(todo, { base: selected.length - todo.length, total: selected.length });
    return true;
  }

  let priceModal = null;
  const refreshPriceModal = () => priceModal?.render();

  /** Fenêtre de choix du chargement des prix : par rareté ou par étiquette, avec ce qu'il reste à charger pour chaque choix. */
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
        el('p', { class: 'wmx-dlg-note' }, 'Choisissez ce qu’il faut charger. Seuls les prix manquants ou périmés sont demandés (validité 48 h, 96 h pour une carte très vendue) : ceux déjà connus ne changent pas.'),
        body,
        el('div', { class: 'wmx-dlg-row' }, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'), go)));
    const missing = (list) => list.filter((it) => !WMX.prices.fresh(it.card_id)).length;
    function render() {
      const mode = (m, label) => el('button', { class: 'wmx-chip2', 'aria-pressed': String(S.priceMode === m), onclick: () => { S.priceMode = m; savePrefs(); render(); } }, label);
      let chips;
      if (S.priceMode === 'rar') {
        chips = el('div', { class: 'wmx-pm-chips' }, ...R.map((r) => chip(`${r} · ${missing(S.items.filter((i) => i.rarity === r))} à charger`, WMX.RARITY_RGB[r], S.priceRar.has(r),
          (on) => { on ? S.priceRar.add(r) : S.priceRar.delete(r); savePrefs(); render(); })));
      } else {
        const counts = new Map();
        for (const it of S.items) for (const t of it.tags) { const e = counts.get(t.id) || { ...t, list: [] }; e.list.push(it); counts.set(t.id, e); }
        const tags = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        chips = el('div', { class: 'wmx-pm-chips wmx-pm-tags' }, ...(tags.length ? tags.map((t) => chip(`${t.name} · ${missing(t.list)}/${t.list.length}`, '', S.priceTags.has(t.id),
          (on) => { S.tagsTouched = true; on ? S.priceTags.add(t.id) : S.priceTags.delete(t.id); savePrefs(); render(); }))
          : [el('span', { class: 'wmx-cp-empty' }, 'Aucune étiquette dans la collection')]));
      }
      const { selected, todo } = pricePlan();
      const mins = Math.max(1, Math.round((todo.length * 1.5) / 60));
      body.replaceChildren(
        el('div', { class: 'wmx-pm-seg' }, mode('rar', 'Par rareté'), mode('tag', 'Par étiquette')),
        chips,
        el('p', { class: 'wmx-pm-sum' }, !selected.length ? (S.priceMode === 'tag' ? 'Choisissez au moins une étiquette.' : 'Choisissez au moins une rareté.')
          : todo.length ? `${fmt(todo.length)} prix à charger (${fmt(selected.length - todo.length)} déjà connus) · environ ${mins} min, selon la réponse du jeu.` : 'Tous les prix de ce choix sont déjà connus.'));
      go.textContent = todo.length ? `Charger ${fmt(todo.length)} prix` : 'Charger';
      go.disabled = !todo.length;
    }
    priceModal = { render };
    document.body.append(back);
    render();
  }

  function priceAction() {
    const st = WMX.prices.state();
    if (st.running) { if (st.paused) WMX.prices.resume(); else WMX.prices.pause(); return; }
    openPriceModal();
  }

  // --- Mode sélection (étiqueter, retirer l'étiquette, favoris, défausse en lot), directement dans Collection+ ------------
  const selItems = () => S.items.filter((i) => S.sel.has(i.id));
  const tagKey = (s) => String(s || '').trim().toLowerCase();
  const hasTag = (it, name) => it.tags.some((t) => tagKey(t.name) === tagKey(name));

  function toggleSel(it, t) {
    if (S.sel.has(it.id)) S.sel.delete(it.id); else S.sel.add(it.id);
    t.classList.toggle('sel', S.sel.has(it.id));
    renderSelbar();
  }

  function toggleSelect(on = !S.selecting) {
    S.selecting = on;
    if (!on) S.sel.clear();
    overlay?.classList.toggle('wmx-selecting', on);
    document.querySelectorAll('.wmx-cp-select').forEach((b) => { b.textContent = on ? '✕ Quitter la sélection' : '☑ Sélectionner'; });
    ui.grid?.querySelectorAll('.wmx-ct.sel').forEach((t) => { if (!on) t.classList.remove('sel'); });
    renderSelbar();
  }

  /** Cartes à traiter par une action : celles pour lesquelles elle a un effet, avec le nombre de cartes ignorées. */
  function plan(kind, tag) {
    const all = selItems();
    const keep = {
      favOn: (i) => !i.starred,
      favOff: (i) => i.starred,
      tagAdd: (i) => !hasTag(i, tag),
      tagRemove: (i) => hasTag(i, tag),
      discard: (i) => !i.starred && !WMX.quick?.selling(i.card_id),
    }[kind];
    const todo = all.filter(keep);
    return { todo, skipped: all.length - todo.length };
  }

  function launch(kind, tag) {
    const { todo, skipped } = plan(kind, tag);
    if (!todo.length) return WMX.toast?.(skipped ? 'Rien à faire : toutes les cartes sélectionnées sont déjà dans cet état (ou verrouillées).' : 'Aucune carte sélectionnée.');
    const n = kind === 'favOn' ? WMX.quick.bulk('favorite', todo, { want: 'on' })
      : kind === 'favOff' ? WMX.quick.bulk('favorite', todo, { want: 'off' })
      : kind === 'tagAdd' ? WMX.quick.bulk('tag', todo, { tag, add: true })
      : kind === 'tagRemove' ? WMX.quick.bulk('tag', todo, { tag, add: false })
      : WMX.quick.bulk('discard', todo);
    WMX.toast?.(`${n} carte${n > 1 ? 's' : ''} en file d’attente${skipped ? ` · ${skipped} ignorée${skipped > 1 ? 's' : ''} (déjà fait ou verrouillée)` : ''}. Suivi dans la pastille ⚡.`, 6000);
    S.sel.clear();
    ui.grid?.querySelectorAll('.wmx-ct.sel').forEach((t) => t.classList.remove('sel'));
    renderSelbar();
  }

  /** Fenêtre de choix d'une étiquette (ajout : toutes ; retrait : celles des cartes sélectionnées). */
  function tagPicker(add) {
    const counts = new Map();
    for (const it of add ? S.items : selItems()) for (const t of it.tags) counts.set(tagKey(t.name), { name: t.name, n: (counts.get(tagKey(t.name))?.n || 0) + 1 });
    const tags = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const box = el('div', { class: 'wmx-selpop' });
    const search = el('input', { class: 'wmx-input', type: 'search', placeholder: add ? 'Étiqueter avec…' : 'Retirer l’étiquette…' });
    const list = el('div', { class: 'wmx-selpop-list' });
    const draw = () => {
      const q = tagKey(search.value);
      const rows = tags.filter((t) => !q || tagKey(t.name).includes(q));
      list.replaceChildren(...(rows.length ? rows.map((t) => el('button', { class: 'wmx-chip2', onclick: () => { box.remove(); launch(add ? 'tagAdd' : 'tagRemove', t.name); } }, `${t.name} (${t.n})`))
        : [el('span', { class: 'wmx-cp-empty' }, add ? 'Aucune étiquette de ce nom (le jeu ne crée pas d’étiquette ici)' : 'Les cartes sélectionnées n’ont aucune étiquette')]));
    };
    search.addEventListener('input', draw);
    box.append(el('div', { class: 'wmx-selpop-head' }, el('strong', {}, add ? 'Étiqueter les cartes sélectionnées' : 'Retirer une étiquette'), el('button', { class: 'wmx-close', onclick: () => box.remove() }, '×')), search, list);
    ui.selbar.parentElement.querySelector('.wmx-selpop')?.remove();
    ui.selbar.before(box);
    draw();
    search.focus();
  }

  /** Fenêtre de confirmation de défausse, calquée sur celle du jeu. Rien n'est défaussé sans un clic explicite sur « Défausser ». */
  function confirmDiscard() {
    const { todo, skipped } = plan('discard');
    if (!todo.length) return WMX.toast?.('Aucune carte défaussable dans la sélection (favorites, en vente ou en échange).');
    document.querySelector('.wmx-selpop')?.remove();
    const byR = {};
    for (const i of todo) byR[i.rarity] = (byR[i.rarity] || 0) + 1;
    const rare = todo.filter((i) => ['L', 'UR', 'SR'].includes(i.rarity)).length;
    const names = todo.map((i) => i.title);
    const close = () => backdrop.remove();
    const backdrop = el('div', { class: 'wmx-dlg-back', onmousedown: (e) => { if (e.target === backdrop) close(); } },
      el('div', { class: 'wmx-dlg', role: 'dialog', 'aria-label': 'Défausser' },
        el('h3', {}, `Défausser ${todo.length} carte${todo.length > 1 ? 's' : ''} ?`),
        el('div', { class: 'wmx-dlg-chips' }, ...R.filter((r) => byR[r]).map((r) => el('b', { style: `color:rgb(${WMX.RARITY_RGB[r]})` }, `${byR[r]} × ${r}`))),
        rare ? el('p', { class: 'wmx-dlg-warn' }, `Attention : ${rare} carte${rare > 1 ? 's' : ''} rare${rare > 1 ? 's' : ''} (L / UR / SR) dans la sélection.`) : '',
        el('p', { class: 'wmx-dlg-list' }, names.slice(0, 12).join(', ') + (names.length > 12 ? `, +${names.length - 12} autres…` : '')),
        skipped ? el('p', { class: 'wmx-dlg-note' }, `${skipped} carte${skipped > 1 ? 's' : ''} de la sélection ${skipped > 1 ? 'sont' : 'est'} en favori, en vente ou en échange en attente : ${skipped > 1 ? 'elles ne seront pas défaussées' : 'elle ne sera pas défaussée'}.`) : '',
        el('p', { class: 'wmx-dlg-strong' }, 'Un exemplaire de chaque carte sélectionnée sera retiré définitivement.'),
        el('p', { class: 'wmx-dlg-gain' }, 'Vous recevrez ', el('b', {}, `ⓦ ${todo.length} wikibidous`), '.'),
        el('div', { class: 'wmx-dlg-row' },
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'),
          el('button', { class: 'wmx-btn wmx-btn--danger', onclick: () => { close(); launch('discard'); } }, 'Défausser'))));
    document.body.append(backdrop);
  }

  // Icônes (mêmes pictogrammes que la barre de sélection du jeu).
  const ICO = {
    check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="3"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    starOff: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/><path d="m3 3 18 18"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v6m4-6v6"/>',
  };
  const icon = (k) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '15'); s.setAttribute('height', '15'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = ICO[k]; return s; };

  /** Barre d'actions, même présentation que celle du jeu : compteur, icônes, et le nombre de cartes que chaque action va toucher. */
  function renderSelbar() {
    if (!ui.selbar) return;
    ui.selbar.hidden = !S.selecting;
    if (!S.selecting) { document.querySelector('.wmx-selpop')?.remove(); return; }
    const n = S.sel.size;
    const count = (k, tag) => plan(k, tag).todo.length;
    const pageTiles = [...ui.grid.querySelectorAll('.wmx-ct')];
    const pageAll = pageTiles.length > 0 && pageTiles.every((t) => S.sel.has(t.dataset.id));
    const mk = (ico, label, fn, { cls = '', off = false } = {}) => {
      const b = el('button', { class: `wmx-sel-btn ${cls}`, onclick: fn }, icon(ico), el('span', {}, label));
      if (off) b.disabled = true;
      return b;
    };
    const fav = count('favOn');
    const unfav = count('favOff');
    const del = count('discard');
    ui.selbar.replaceChildren(
      el('div', { class: 'wmx-sel-count' }, el('b', {}, String(n)), ` carte${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`),
      el('div', { class: 'wmx-sel-row' },
        mk(pageAll ? 'square' : 'check', pageAll ? 'Désélectionner la page' : 'Tout sélectionner (page)', pageAll ? deselectPage : selectPage, { cls: 'strong' }),
        mk('tag', 'Étiqueter', () => tagPicker(true), { off: !n }),
        mk('tag', 'Retirer l’étiquette', () => tagPicker(false), { off: !n }),
        mk('star', `Mettre en favori (${fav})`, () => launch('favOn'), { off: !fav }),
        mk('starOff', `Retirer des favoris (${unfav})`, () => launch('favOff'), { off: !unfav }),
        mk('trash', `Défausser (+${del})`, confirmDiscard, { cls: 'danger', off: !del })));
  }

  function selectPage() {
    for (const t of ui.grid.querySelectorAll('.wmx-ct')) { S.sel.add(t.dataset.id); t.classList.add('sel'); }
    renderSelbar();
  }
  function deselectPage() {
    for (const t of ui.grid.querySelectorAll('.wmx-ct')) { S.sel.delete(t.dataset.id); t.classList.remove('sel'); }
    renderSelbar();
  }

  /** Bandeau propre à une page : titre, état, valeur, paramètres. Pas d'onglets ni de croix : on change de page par la barre latérale. */
  function head(title) {
    const status = el('span', { class: 'wmx-cp-status' });
    const value = el('span', { class: 'wmx-cp-value' });
    ui.heads.push({ status, value });
    const select = title === 'Collection+'
      ? el('button', { class: 'wmx-btn wmx-btn--ghost wmx-cp-select', title: 'Sélectionner des cartes pour les étiqueter, les mettre en favori ou les défausser en lot', onclick: () => toggleSelect() }, S.selecting ? '✕ Quitter la sélection' : '☑ Sélectionner')
      : '';
    return el('header', { class: 'wmx-cp-head' }, el('h2', {}, title), status, value, select,
      el('button', { class: 'wmx-close', title: 'Paramètres (enchère rapide, prix…)', onclick: () => WMX.openSettings() }, '⚙'));
  }

  /** Barre de chargement des prix (présente sur les deux pages, car la valeur en dépend) : un seul bouton, qui ouvre la fenêtre de choix. */
  function makePriceBar() {
    const info = el('span', {});
    const bar = el('div', { class: 'wmx-cp-bar' }, el('i'));
    const btn = el('button', { class: 'wmx-btn', onclick: priceAction }, 'Charger les prix…');
    const stop = el('button', { class: 'wmx-btn wmx-btn--ghost', hidden: '', onclick: () => WMX.prices.stop() }, 'Arrêter');
    ui.priceBars.push({ info, bar, btn, stop });
    return el('div', { class: 'wmx-cp-prices' }, el('div', { class: 'wmx-cp-pricehead' }, info, el('span', { class: 'wmx-cp-pspacer' }), btn, stop), bar);
  }

  function build() {
    ui.heads = [];
    ui.priceBars = [];
    ui.q = el('input', { class: 'wmx-input wmx-cp-search', type: 'search', placeholder: 'Rechercher une carte…' });
    ui.q.addEventListener('input', () => { S.q = ui.q.value; S.page = 1; refresh(); });
    ui.per = select(PER_PAGE.map((n) => [n, `${n} par page`]), S.perPage, (v) => { S.perPage = Number(v); S.page = 1; savePrefs(); refresh(); });
    ui.sort = select(SORTS, S.sort, (v) => { S.sort = v; S.page = 1; savePrefs(); refresh(); });
    ui.tag = select([['', 'Toutes les étiquettes']], '', (v) => { S.tag = v; S.page = 1; refresh(); });
    ui.min = el('input', { class: 'wmx-input', type: 'number', min: '0', placeholder: 'Min W' });
    ui.max = el('input', { class: 'wmx-input', type: 'number', min: '0', placeholder: 'Max W' });
    ui.min.addEventListener('input', () => { S.min = ui.min.value; S.page = 1; refresh(); });
    ui.max.addEventListener('input', () => { S.max = ui.max.value; S.page = 1; refresh(); });
    ui.grid = el('div', { class: 'wmx-ct-grid' });
    ui.count = el('span', {});
    ui.pager = el('div', { class: 'wmx-pager' });
    ui.dash = el('div', { class: 'wmx-dash' });
    ui.reorder = el('button', { class: 'wmx-btn wmx-btn--ghost wmx-reorder', hidden: '', title: 'Les prix ont changé : remettre les cartes dans l’ordre du tri', onclick: () => refresh() }, '↻ Réordonner');

    ui.cardsView = el('div', { class: 'wmx-cards-view' },
      el('div', { class: 'wmx-cp-tools' }, ui.q, ui.per, ui.sort, ui.tag,
        el('span', { class: 'wmx-cp-range' }, ui.min, '–', ui.max)),
      el('div', { class: 'wmx-cp-tools' },
        ...R.map((r) => chip(r, WMX.RARITY_RGB[r], false, (on) => { on ? S.rar.add(r) : S.rar.delete(r); S.page = 1; refresh(); })),
        chip('★ Favoris', '', false, (on) => { S.fav = on; S.page = 1; refresh(); }),
        chip('Doublons', '', false, (on) => { S.dup = on; S.page = 1; refresh(); }), ui.reorder),
      makePriceBar(),
      ui.grid,
      el('div', { class: 'wmx-cp-foot' }, ui.count, ui.pager));

    // Deux pages à part entière : chacune a son propre bandeau et son propre contenu.
    overlay = el('section', { class: 'wmx-cplus', id: 'wmx-cplus', hidden: '' }, head('Collection+'), el('div', { class: 'wmx-cp-scroll' }, ui.cardsView));
    pageDash = el('section', { class: 'wmx-cplus', id: 'wmx-dashboard', hidden: '' }, head('Tableau de bord'), el('div', { class: 'wmx-cp-scroll' }, makePriceBar(), ui.dash));
    ui.selbar = el('div', { class: 'wmx-selbar', hidden: '' });
    overlay.append(ui.selbar);
    document.body.append(overlay, pageDash);
    window.addEventListener('resize', place);

    WMX.quick?.onChange(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshTiles, 150); }); // ⚡ à jour, cartes à leur place
    // Un favori posé depuis ailleurs (révélation) : mis à jour ici aussi.
    window.addEventListener('wmx:fav', (e) => {
      for (const it of S.items) if (it.card_id === e.detail.card_id) it.starred = e.detail.starred;
      refreshTiles();
    });
    // Étiquette posée ou retirée / carte défaussée par la file : la grille se met à jour sans rechargement.
    window.addEventListener('wmx:tag', (e) => {
      const { card_id, tag, add } = e.detail;
      const known = S.items.flatMap((i) => i.tags).find((t) => tagKey(t.name) === tagKey(tag));
      for (const it of S.items) {
        if (it.card_id !== card_id) continue;
        it.tags = add ? (hasTag(it, tag) ? it.tags : [...it.tags, known || { id: tag, name: tag, color: null }]) : it.tags.filter((t) => tagKey(t.name) !== tagKey(tag));
      }
      fillTags();
    });
    window.addEventListener('wmx:discard', (e) => {
      S.gone.set(e.detail.card_id, (S.gone.get(e.detail.card_id) || 0) + 1);
      for (const it of S.items) if (it.card_id === e.detail.card_id) { it.count -= 1; }
      S.items = S.items.filter((i) => i.count > 0);
      WMX.store.set('invCache', { t: Date.now(), items: S.items }); // le cache ne réaffiche plus les cartes défaussées
      S.sel.forEach((id) => { if (!S.items.some((i) => i.id === id)) S.sel.delete(id); });
      refresh();
      renderSelbar();
    });
    setInterval(() => { if (isOpen() && WMX.alive()) WMX.quick?.refresh(); }, 60000);

    WMX.prices.onProgress(() => {
      renderStatus();
      if (tickTimer) return; // une mise à jour au plus toutes les 1,5 s, même pendant un chargement continu
      tickTimer = setTimeout(() => { // met à jour les prix affichés, sans déplacer les cartes
        tickTimer = null;
        refreshTiles();
        if (S.tab === 'dash' && isOpen()) renderDash();
        if (ui.reorder && (S.sort === 'expensive' || S.sort === 'cheap' || S.min !== '' || S.max !== '')) ui.reorder.hidden = false;
      }, 1500);
    });
  }

  const isOpen = () => (!!overlay && (!overlay.hidden || !pageDash.hidden));

  /** Affiche UNE des trois pages (les autres sont masquées) ; pendant ce temps le surlignage « actif » du jeu est neutralisé. */
  function setTab(k) {
    S.tab = k;
    if (overlay) overlay.hidden = k !== 'cards';
    if (pageDash) pageDash.hidden = k !== 'dash';
    document.documentElement.classList.add('wmx-page-open');
    if (k === 'dash') renderDash();
    markNav();
  }

  const place = () => {
    const x = `${Math.round(WMX.dom.sidebarRight())}px`;
    if (overlay) overlay.style.left = x;
    if (pageDash) pageDash.style.left = x;
  };

  /** Quitter la page : seulement en allant ailleurs dans le jeu (pas de bouton de fermeture). */
  function close() {
    if (S.selecting) toggleSelect(false);
    if (overlay) { overlay.hidden = true; pageDash.hidden = true; }
    document.documentElement.classList.remove('wmx-page-open');
    markNav();
  }

  async function open(tab = 'cards') {
    const first = !overlay;
    if (first) {
      const prefs = await WMX.store.get('cplusPrefs', {});
      if (PER_PAGE.includes(prefs.perPage)) S.perPage = prefs.perPage;
      if (SORTS.some(([k]) => k === prefs.sort)) S.sort = prefs.sort;
      if (prefs.priceMode === 'tag') S.priceMode = 'tag';
      if (Array.isArray(prefs.priceRar)) S.priceRar = new Set(prefs.priceRar.filter((r) => R.includes(r)));
      if (Array.isArray(prefs.priceTags)) S.priceTags = new Set(prefs.priceTags);
      S.tagsTouched = !!prefs.tagsTouched;
      build();
    }
    place();
    setTab(tab);
    WMX.prepareCardSheets?.('view'); // fiche du jeu prête au premier clic
    WMX.quick?.refresh();      // quelles cartes sont déjà en vente
    await WMX.prices.load();
    if (first || !S.items.length) {
      const cached = await WMX.store.get('invCache', null);
      if (cached?.items?.length) { S.items = cached.items; fillTags(); }
      refresh();
      if (!cached || Date.now() - cached.t > INV_TTL) loadInventory();
    } else refresh();
  }

  // --- Entrées « Collection+ » et « Tableau de bord » dans la barre latérale du jeu ----------------
  const ICONS = {
    cards: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    dash: '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
  };

  function markNav() {
    document.querySelectorAll('[data-wmx-nav]').forEach((a) => {
      const on = isOpen() && a.dataset.wmxNav === S.tab;
      a.classList.toggle('wmx-nav-active', on);
    });
  }

  function mountNav() {
    const nav = [...document.querySelectorAll('nav')].find((n) => n.getBoundingClientRect().width > 100);
    const coll = nav?.querySelector('a[href="/collection"]');
    if (!nav || !coll || nav.querySelector('[data-wmx-nav]')) return;
    const tpl = nav.querySelector('a[href="/trades"]') || coll; // lien inactif : même gabarit, sans l'état « actif »
    const make = (key, label, tab) => {
      const a = tpl.cloneNode(true);
      a.removeAttribute('href');
      a.setAttribute('role', 'button');
      a.setAttribute('tabindex', '0');
      a.className = a.className.replace(/bg-\[var\(--color-accent\)\]\/10|text-\[var\(--color-accent\)\]/g, '');
      a.classList.add('wmx-nav-item');
      a.dataset.wmxNav = key;
      const svg = a.querySelector('svg');
      if (svg) svg.innerHTML = ICONS[key];
      // On garde l'icône du gabarit, on remplace son libellé (nœud de texte) et on ajoute l'étiquette « ext ».
      const iconWrap = a.querySelector('span');
      a.replaceChildren(...(iconWrap ? [iconWrap] : []), label, el('i', { class: 'wmx-nav-tag' }, 'ext'));
      const go = (e) => { e.preventDefault(); e.stopPropagation(); open(tab); };
      a.addEventListener('click', go);
      a.addEventListener('mouseenter', () => WMX.prepareCardSheets?.('view')); // la fiche charge pendant qu'on vise l'entrée
      a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
      return a;
    };
    coll.after(make('cards', 'Collection+', 'cards'), make('dash', 'Tableau de bord', 'dash'));
    markNav();
  }

  WMX.register({
    name: 'collection-plus',
    init() {
      mountNav();
      // Le jeu redessine sa barre latérale : on remet nos entrées si elles disparaissent.
      let timer = null;
      new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(mountNav, 250); }).observe(document.body, { childList: true, subtree: true });
      // Cliquer sur n'importe quelle autre entrée de la barre latérale du jeu quitte la page, même si c'est la page du dessous.
      document.addEventListener('click', (e) => {
        const a = e.target.closest?.('nav a[href]');
        if (a && !a.classList.contains('wmx-nav-item') && isOpen()) close();
      }, true);
      // Changer de page du jeu referme Collection+.
      new MutationObserver(() => close()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wmx-route'] });
    },
  });
})();
