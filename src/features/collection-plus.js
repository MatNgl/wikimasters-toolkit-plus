// Collection+ : toute la collection en mémoire (≈ 6 400 cartes), filtres et tri instantanés, pagination au choix
// (10 / 25 / 50 / 100), prix du marché par carte, valeur estimée, et la VRAIE fiche du jeu au clic (cadre invisible,
// voir card-detail.js). L'extension ne fait que LIRE l'inventaire (GET /api/my-collection, comme la page du jeu).
(() => {
  const { el, sleep } = WMX.dom;
  const R = WMX.RARITIES;
  const RANK = { L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0 };
  const PER_PAGE = [10, 25, 50, 100];
  const SORTS = [['rarity', 'Rareté'], ['expensive', 'Plus chères'], ['cheap', 'Moins chères'], ['recent', 'Ajoutées récemment'], ['name', 'Nom (A → Z)']];
  const INV_TTL = 10 * 60 * 1000; // inventaire en cache : actualisé en arrière-plan au-delà de 10 min

  const S = {
    items: [], page: 1, perPage: 50, sort: 'rarity', q: '', rar: new Set(), tag: '', fav: false, dup: false,
    min: '', max: '', tab: 'cards', priceRar: new Set(['L', 'UR', 'SR', 'R']), loading: false, loadedCount: 0,
  };
  let overlay = null;
  let refreshTimer = null;
  const ui = {};

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const price = (it) => WMX.prices.get(it.card_id, it.rarity);
  const avg = (it) => price(it)?.avg ?? null;

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
      if (!hadCache && p % 4 === 0) { S.items = [...byId.values()]; fillTags(); refresh(); }
      renderStatus();
      await sleep(300);
    }
    S.items = [...byId.values()];
    S.loading = false;
    WMX.store.set('invCache', { t: Date.now(), items: S.items });
    fillTags();
    refresh();
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
  function tile(it) {
    const p = price(it);
    const t = el('div', { class: 'wmx-ct', 'data-r': it.rarity, style: `--rgb:${WMX.RARITY_RGB[it.rarity]}`, title: 'Cliquer pour ouvrir la fiche' },
      el('div', { class: 'wmx-ct-shade' }),
      el('span', { class: 'wmx-rar' }, it.rarity),
      el('div', { class: 'wmx-ct-acts' }, it.starred ? el('i', {}, '★') : '', it.count > 1 ? el('i', { class: 'wmx-ct-n' }, `×${it.count}`) : ''),
      el('div', { class: 'wmx-meta' }, el('strong', {}, it.title), el('span', { class: 'wmx-ct-price' }, p ? `Moy. ${fmt(p.avg)} W` : 'Moy. —')));
    if (it.image) WMX.dom.artLayers(it.image, t);
    t.addEventListener('click', () => WMX.openCardDetail?.({ id: it.card_id, wikipedia_title: it.title, rarity: it.rarity, lang: it.lang }));
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

  function refresh() {
    if (!overlay) return;
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
    if (!ui.status) return;
    const t = totals();
    ui.value.textContent = t.total ? `Valeur estimée : ${fmt(t.value)} W` : '';
    ui.value.title = `Somme des moyennes du marché × exemplaires, pour les ${fmt(t.priced)} cartes dont le prix est chargé.`;
    ui.status.textContent = S.loading ? `Chargement de la collection : ${fmt(S.loadedCount)} cartes…` : `${fmt(t.total)} cartes uniques · ${fmt(t.copies)} exemplaires`;
    const st = WMX.prices.state();
    const fresh = S.items.filter((it) => WMX.prices.fresh(it.card_id)).length;
    ui.priceInfo.textContent = st.running
      ? `Prix : ${fmt(st.done)} / ${fmt(st.total)}${st.wait ? ` · pause ${st.wait} s (limite du jeu)` : ''}${st.paused ? ' · en pause' : ''}`
      : `Prix à jour : ${fmt(fresh)} / ${fmt(t.total)}`;
    ui.priceBar.firstChild.style.width = `${st.running && st.total ? (st.done / st.total) * 100 : (t.total ? (fresh / t.total) * 100 : 0)}%`;
    ui.priceBtn.textContent = st.running ? (st.paused ? 'Reprendre' : 'Pause') : 'Charger les prix';
    ui.priceStop.hidden = !st.running;
  }

  function fillTags() {
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
  const savePrefs = () => WMX.store.set('cplusPrefs', { perPage: S.perPage, sort: S.sort });

  function priceAction() {
    const st = WMX.prices.state();
    if (st.running) { if (st.paused) WMX.prices.resume(); else WMX.prices.pause(); return; }
    const todo = S.items.filter((it) => S.priceRar.has(it.rarity) && !WMX.prices.fresh(it.card_id))
      .sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.title.localeCompare(b.title, 'fr'));
    if (!todo.length) { ui.priceInfo.textContent = 'Les prix de ces raretés sont déjà à jour'; return; }
    WMX.prices.start(todo);
  }

  function build() {
    ui.q = el('input', { class: 'wmx-input wmx-cp-search', type: 'search', placeholder: 'Rechercher une carte…' });
    ui.q.addEventListener('input', () => { S.q = ui.q.value; S.page = 1; refresh(); });
    ui.per = select(PER_PAGE.map((n) => [n, `${n} par page`]), S.perPage, (v) => { S.perPage = Number(v); S.page = 1; savePrefs(); refresh(); });
    ui.sort = select(SORTS, S.sort, (v) => { S.sort = v; S.page = 1; savePrefs(); refresh(); });
    ui.tag = select([['', 'Toutes les étiquettes']], '', (v) => { S.tag = v; S.page = 1; refresh(); });
    ui.min = el('input', { class: 'wmx-input', type: 'number', min: '0', placeholder: 'Min W' });
    ui.max = el('input', { class: 'wmx-input', type: 'number', min: '0', placeholder: 'Max W' });
    ui.min.addEventListener('input', () => { S.min = ui.min.value; S.page = 1; refresh(); });
    ui.max.addEventListener('input', () => { S.max = ui.max.value; S.page = 1; refresh(); });

    ui.status = el('span', { class: 'wmx-cp-status' });
    ui.value = el('span', { class: 'wmx-cp-value' });
    ui.priceInfo = el('span', {});
    ui.priceBar = el('div', { class: 'wmx-cp-bar' }, el('i'));
    ui.priceBtn = el('button', { class: 'wmx-btn', onclick: priceAction }, 'Charger les prix');
    ui.priceStop = el('button', { class: 'wmx-btn wmx-btn--ghost', hidden: '', onclick: () => WMX.prices.stop() }, 'Arrêter');
    ui.grid = el('div', { class: 'wmx-ct-grid' });
    ui.count = el('span', {});
    ui.pager = el('div', { class: 'wmx-pager' });
    ui.dash = el('div', { class: 'wmx-dash', hidden: '' });

    const tabs = ['cards', 'dash'].map((k) => {
      const b = el('button', { class: `wmx-tab${k === S.tab ? ' on' : ''}` }, k === 'cards' ? 'Cartes' : 'Tableau de bord');
      b.addEventListener('click', () => {
        S.tab = k;
        tabs.forEach((x, i) => x.classList.toggle('on', ['cards', 'dash'][i] === k));
        ui.cardsView.hidden = k !== 'cards';
        ui.dash.hidden = k !== 'dash';
        if (k === 'dash') renderDash();
      });
      return b;
    });

    ui.cardsView = el('div', { class: 'wmx-cards-view' },
      el('div', { class: 'wmx-cp-tools' }, ui.q, ui.per, ui.sort, ui.tag,
        el('span', { class: 'wmx-cp-range' }, ui.min, '–', ui.max)),
      el('div', { class: 'wmx-cp-tools' },
        ...R.map((r) => chip(r, WMX.RARITY_RGB[r], false, (on) => { on ? S.rar.add(r) : S.rar.delete(r); S.page = 1; refresh(); })),
        chip('★ Favoris', '', false, (on) => { S.fav = on; S.page = 1; refresh(); }),
        chip('Doublons', '', false, (on) => { S.dup = on; S.page = 1; refresh(); })),
      el('div', { class: 'wmx-cp-prices' },
        el('div', { class: 'wmx-cp-pricehead' }, ui.priceInfo,
          el('span', { class: 'wmx-cp-pchips' }, 'Raretés :', ...R.map((r) => chip(r, WMX.RARITY_RGB[r], S.priceRar.has(r), (on) => { on ? S.priceRar.add(r) : S.priceRar.delete(r); }))),
          ui.priceBtn, ui.priceStop),
        ui.priceBar),
      ui.grid,
      el('div', { class: 'wmx-cp-foot' }, ui.count, ui.pager));

    overlay = el('section', { class: 'wmx-cplus', id: 'wmx-cplus' },
      el('header', { class: 'wmx-cp-head' },
        el('h2', {}, 'Collection+'), ...tabs, ui.status, ui.value,
        el('button', { class: 'wmx-close', title: 'Fermer', onclick: close }, '×')),
      el('div', { class: 'wmx-cp-scroll' }, ui.cardsView, ui.dash));
    document.body.append(overlay);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.hidden && !document.querySelector('.wmx-sheet-frame.wmx-on, .wmx-overlay')) close();
    });

    WMX.prices.onProgress(() => {
      renderStatus();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 1500); // met à jour les prix affichés sans redessiner à chaque requête
    });
  }

  const place = () => { if (overlay) overlay.style.left = `${Math.round(WMX.dom.sidebarRight())}px`; };

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    WMX.releaseCardSheets?.();
  }

  async function open() {
    const first = !overlay;
    if (first) {
      const prefs = await WMX.store.get('cplusPrefs', {});
      if (PER_PAGE.includes(prefs.perPage)) S.perPage = prefs.perPage;
      if (SORTS.some(([k]) => k === prefs.sort)) S.sort = prefs.sort;
      build();
    }
    overlay.hidden = false;
    place();
    WMX.prepareCardSheets?.(); // fiche du jeu prête au premier clic
    await WMX.prices.load();
    if (first || !S.items.length) {
      const cached = await WMX.store.get('invCache', null);
      if (cached?.items?.length) { S.items = cached.items; fillTags(); }
      refresh();
      if (!cached || Date.now() - cached.t > INV_TTL) loadInventory();
    } else refresh();
  }

  WMX.register({
    name: 'collection-plus',
    match: /^\/collection/,
    init() {
      document.body.append(el('button', { class: 'wmx-launch', onclick: open }, el('span', {}, '▦'), 'Collection+'));
    },
  });
})();
