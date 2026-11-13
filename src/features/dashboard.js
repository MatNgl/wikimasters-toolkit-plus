// Tableau de bord : une page de statistiques en plus de la collection du jeu (valeur estimée, valeur par rareté, top 10 des cartes
// les plus chères, courbe de la valeur dans le temps avec axes, repères et tableau). Entrée « Tableau de bord » dans la barre latérale du jeu.
(() => {
  const { el } = WMX.dom;
  const R = WMX.RARITIES;
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
  let page = null;
  let body = null;
  let range = 30; // période du graphique en jours (0 = tout)
  let tab = 'profits'; // onglet : 'profits' (plus-values, ledger.js ; ouvert par défaut) ou 'collection' (valeur, raretés, top 10)
  let priceBar = null;
  let tabsEl = null;

  const isOpen = () => !!page && !page.hidden;

  async function recordValue(t) {
    if (!t.priced) return;
    const h = await WMX.store.get('valueHistory', {});
    h[new Date().toLocaleDateString('sv-SE')] = { value: Math.round(t.value), priced: t.priced, loaded: t.loaded, total: t.total };
    WMX.store.set('valueHistory', h);
  }

  // --- Graphique de la valeur dans le temps --------------------------------------------------------
  /** Pas « rond » (1, 2, 5 × 10^n) pour les repères de l'axe vertical. */
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  /** Valeur d'axe compacte : 12 400 → « 12,4 k », 1 250 000 → « 1,25 M », sinon le nombre entier. */
  function fmtAxis(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M`;
    if (a >= 1e4) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`;
    return Math.round(v).toLocaleString('fr-FR');
  }
  const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const dmyFull = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  const dayKey = (t) => new Date(t).toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
  const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return dayKey(d); };
  const dayLong = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());

  /**
   * Estimation jour par jour : la valeur, au prix du marché actuel, des cartes possédées aujourd'hui, selon leur date d'obtention
   * (champ obtained_at du jeu). Rend { byDay: { jour: { value, n } } (cartes obtenues ce jour-là), first, before } — before : cartes sans date.
   */
  function rebuild() {
    const avg = (it) => WMX.inventory.price(it)?.avg ?? null;
    const byDay = {};
    let before = 0;
    for (const it of WMX.inventory.items()) {
      const a = avg(it);
      if (a == null) continue;
      const v = a * (it.count || 1);
      const t = Date.parse(it.at || '');
      if (!Number.isFinite(t)) { before += v; continue; }
      const k = dayKey(t);
      const d = (byDay[k] ||= { value: 0, n: 0 });
      d.value += v; d.n += it.count || 1;
    }
    const keys = Object.keys(byDay).sort();
    return { byDay, first: keys[0] || dayKey(Date.now()), before };
  }

  /**
   * Graphique de la valeur : estimation pour chaque jour de la période (pointillés) et valeurs notées chaque jour (trait plein, points).
   * Survol : la date, les deux valeurs et les cartes obtenues ce jour-là.
   */
  function valueChart(days, hist, est, gained) {
    const W = 1100, H = 280, Lm = 64, Rm = 16, T = 16, B = 34;
    const recVals = days.map((d) => hist[d]?.value ?? null);
    const all = [...est, ...recVals.filter((v) => v != null)];
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi === lo) { const pad = Math.max(10, hi * 0.05); lo -= pad; hi += pad; }
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const n = days.length;
    const x = (i) => Lm + (n === 1 ? (W - Lm - Rm) / 2 : (i / (n - 1)) * (W - Lm - Rm));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let g = '';
    for (let v = lo; v <= hi + step / 2; v += step) g += `<line class="g" x1="${Lm}" x2="${W - Rm}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ty" x="${Lm - 8}" y="${(y(v) + 4).toFixed(1)}">${fmtAxis(v)}</text>`;
    const nLabels = Math.min(n, 8);
    for (let k = 0; k < nLabels; k++) {
      const i = nLabels === 1 ? 0 : Math.round((k / (nLabels - 1)) * (n - 1));
      g += `<text class="tx" x="${x(i).toFixed(1)}" y="${H - 12}">${dmy(days[i])}</text>`;
    }
    const estPts = est.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = n > 1 ? `<polygon class="area" points="${x(0).toFixed(1)},${H - B} ${estPts} ${x(n - 1).toFixed(1)},${H - B}"/>` : '';
    const estLine = n > 1 ? `<polyline class="line est" points="${estPts}"/>` : '';
    const rec = recVals.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    const recLine = rec.length > 1 ? `<polyline class="line" points="${rec.map(([a, b2]) => `${a.toFixed(1)},${b2.toFixed(1)}`).join(' ')}"/>` : '';
    const dots = rec.map(([a, b2]) => `<circle class="dot" cx="${a.toFixed(1)}" cy="${b2.toFixed(1)}" r="${n > 60 ? 2.2 : 3.5}"/>`).join('');
    const slot = (W - Lm - Rm) / Math.max(1, n - 1);
    const hits = days.map((d, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}"/>`).join('');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'wmx-vchart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Valeur de la collection dans le temps, en W');
    svg.innerHTML = `<text class="unit" x="${Lm}" y="10">W</text>${g}<line class="axis" x1="${Lm}" x2="${Lm}" y1="${T}" y2="${H - B}"/><line class="axis" x1="${Lm}" x2="${W - Rm}" y1="${H - B}" y2="${H - B}"/>${area}${estLine}${recLine}${dots}<line class="cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>${hits}`;
    const tip = el('div', { class: 'wmx-lg-tip', hidden: '' });
    const wrap = el('div', { class: 'wmx-vwrap wmx-lg-chartwrap' }, svg, tip);
    const cursor = svg.querySelector('.cursor');
    svg.addEventListener('mousemove', (e) => {
      const i = e.target?.getAttribute?.('data-i');
      if (i == null) { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); return; }
      const k = Number(i);
      const d = days[k];
      const got = gained[d];
      tip.replaceChildren(
        el('span', { class: 'wmx-lg-tip-head' }, dayLong(d)),
        recVals[k] != null ? el('b', {}, `${fmt(recVals[k])} W`) : el('b', { class: 'muted' }, `≈ ${fmt(est[k])} W`),
        el('small', {}, recVals[k] != null ? `Valeur notée ce jour-là · estimation ${fmt(est[k])} W` : 'Estimation (pas de valeur notée ce jour-là)'),
        el('small', {}, got ? `${fmt(got.n)} carte${got.n > 1 ? 's' : ''} obtenue${got.n > 1 ? 's' : ''} ce jour-là · ≈ ${fmt(got.value)} W` : 'Aucune carte gardée obtenue ce jour-là'));
      tip.hidden = false;
      cursor.setAttribute('x1', x(k).toFixed(1)); cursor.setAttribute('x2', x(k).toFixed(1)); cursor.setAttribute('visibility', 'visible');
      const r = wrap.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      tip.style.left = `${Math.max(4, px + 14 + 270 > r.width ? px - 14 - 270 : px + 14)}px`;
      tip.style.top = `${Math.max(4, py - 30)}px`;
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); });
    return wrap;
  }

  /** Bloc « Valeur dans le temps » : repères chiffrés, choix de la période, graphique (estimation + valeurs notées) et tableau des jours notés. */
  function valueBlock(hist) {
    const box = el('div', { class: 'wmx-panelbox wmx-vbox' }, el('h4', {}, 'Valeur de la collection dans le temps (en W)'));
    const rb = rebuild();
    const recorded = Object.keys(hist).sort();
    const today = dayKey(Date.now());
    const start = range ? addDays(today, -(range - 1)) : [rb.first, recorded[0] || today].sort()[0];
    const days = [];
    for (let d = start; d <= today && days.length < 400; d = addDays(d, 1)) days.push(d);
    // Estimation cumulée : cartes obtenues avant la période, puis jour après jour.
    let acc = rb.before;
    for (const [k, v] of Object.entries(rb.byDay)) if (k < start) acc += v.value;
    const est = days.map((d) => (acc += rb.byDay[d]?.value || 0));
    if (!est.some((v) => v > 0) && !recorded.length) {
      box.append(el('p', { class: 'wmx-cp-empty' }, 'Aucune valeur pour l’instant. Chargez les prix de la collection : la valeur est notée une fois par jour et estimée pour les jours passés.'));
      return box;
    }
    const recIn = days.filter((d) => hist[d]);
    // Variation et plus haut : sur l'estimation seule (même calcul d'un bout à l'autre ; mélanger valeurs notées et estimées fausserait l'écart).
    const series = est;
    const first = est[0];
    const last = hist[today]?.value ?? est.at(-1);
    const diff = est.at(-1) - first;
    const pct = first ? (diff / first) * 100 : 0;
    const gainedIn = days.reduce((n, d) => n + (rb.byDay[d]?.value || 0), 0);
    const cardsIn = days.reduce((n, d) => n + (rb.byDay[d]?.n || 0), 0);
    const seg = el('div', { class: 'wmx-seg wmx-vrange' }, ...[[7, '7 jours'], [30, '30 jours'], [0, 'Tout']].map(([nn, label]) => {
      const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(range === nn) }, label);
      b.addEventListener('click', () => { range = nn; render(); });
      return b;
    }));
    const stat = (label, value, cls = '') => el('div', { class: 'wmx-vstat' }, el('small', {}, label), el('b', { class: cls }, value));
    box.append(
      el('div', { class: 'wmx-vtop' },
        el('div', { class: 'wmx-vstats' },
          stat('Valeur actuelle', `${fmt(last)} W`),
          stat(`Variation estimée (${dmy(days[0])} → ${dmy(days.at(-1))})`, `${sign(diff)}${fmt(Math.abs(diff))} W (${sign(diff)}${Math.abs(pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)`, diff > 0 ? 'up' : diff < 0 ? 'down' : ''),
          stat('Cartes obtenues sur la période', `${fmt(cardsIn)} · ≈ ${fmt(gainedIn)} W`),
          stat('Plus haut (estimation)', `${fmt(Math.max(...series))} W`)),
        seg),
      valueChart(days, hist, est, rb.byDay),
      el('div', { class: 'wmx-vlegend' },
        el('span', {}, el('i', { class: 'solid' }), 'Valeur notée chaque jour'),
        el('span', {}, el('i', { class: 'dash' }), 'Estimation : cartes possédées aujourd’hui, à leur date d’obtention, au prix actuel du marché'),
        el('span', { class: 'muted' }, 'Survolez le graphique pour le détail d’un jour')));
    // Tableau : les jours où la valeur a été notée, du plus récent au plus ancien.
    if (recIn.length) {
      const rows = recIn.map((d, i) => {
        const h = hist[d];
        const prev = i ? hist[recIn[i - 1]].value : null;
        const dv = prev == null ? null : h.value - prev;
        const loaded = h.loaded ?? h.priced;
        return el('tr', {},
          el('td', {}, dmyFull(d)),
          el('td', { class: 'n' }, `${fmt(h.value)} W`),
          el('td', { class: `n ${dv > 0 ? 'up' : dv < 0 ? 'down' : ''}` }, dv == null ? '—' : `${sign(dv)}${fmt(Math.abs(dv))} W${prev ? ` (${sign(dv)}${Math.abs((dv / prev) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)` : ''}`),
          el('td', { class: 'n' }, `${fmt(loaded)} / ${fmt(h.total)}`));
      }).reverse();
      box.append(
        el('div', { class: 'wmx-vtable-wrap' },
          el('table', { class: 'wmx-vtable' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Jour noté'), el('th', { class: 'n' }, 'Valeur notée'), el('th', { class: 'n' }, 'Écart au jour noté précédent'), el('th', { class: 'n', title: 'Cartes dont le prix était chargé ce jour-là, sur le nombre de cartes de la collection' }, 'Prix chargés'))),
            el('tbody', {}, ...rows))));
    }
    box.append(el('small', { class: 'wmx-cp-note' }, 'La valeur notée est la somme des moyennes du marché × exemplaires, une fois par jour (elle monte aussi quand des prix sont ajoutés). L’estimation ne compte que les cartes encore possédées : les cartes vendues ou défaussées depuis n’y figurent pas.'));
    return box;
  }

  const RNAME = { L: 'Légendaire', UR: 'Ultra rare', SR: 'Super rare', R: 'Rare', PC: 'Peu commune', C: 'Commune' };
  /** Valeur par rareté en anneau : une part par rareté (proportionnelle à sa valeur), le total au centre, la légende à côté. */
  function rarityDonut(byR) {
    const parts = R.map((r) => ({ r, v: Math.max(0, byR?.[r] || 0) }));
    const total = parts.reduce((n, x) => n + x.v, 0);
    const size = 220, rad = 82, sw = 30, c = size / 2;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('class', 'wmx-rdonut'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Valeur par rareté, total ${fmt(total)} W`);
    let html = `<circle class="track" cx="${c}" cy="${c}" r="${rad}" stroke-width="${sw}"/>`;
    let acc = 0;
    const gap = total ? 0.35 : 0; // petit espace entre les parts (en % du tour)
    for (const x of parts) {
      if (!x.v) continue;
      const pct = (x.v / total) * 100;
      const len = Math.max(0.01, pct - (pct > gap * 2 ? gap : 0));
      html += `<circle class="seg" data-r="${x.r}" cx="${c}" cy="${c}" r="${rad}" stroke-width="${sw}" pathLength="100" stroke="rgb(${WMX.RARITY_RGB[x.r]})" stroke-dasharray="${len.toFixed(3)} ${(100 - len).toFixed(3)}" stroke-dashoffset="${(-acc).toFixed(3)}" transform="rotate(-90 ${c} ${c})"><title>${RNAME[x.r]} : ${fmt(x.v)} W (${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)</title></circle>`;
      acc += pct;
    }
    html += `<text class="tot" x="${c}" y="${c - 2}">${fmtAxis(total)} W</text><text class="sub" x="${c}" y="${c + 18}">valeur estimée</text>`;
    svg.innerHTML = html;
    const legend = el('div', { class: 'wmx-rdonut-legend' }, ...parts.map((x) => el('div', { class: `wmx-rdonut-row${x.v ? '' : ' zero'}`, 'data-r': x.r, style: `--rgb:${WMX.RARITY_RGB[x.r]}` },
      el('i', {}), el('b', {}, x.r), el('span', {}, RNAME[x.r]),
      el('small', {}, total ? `${(x.v / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—'),
      el('strong', {}, `${fmt(x.v)} W`))));
    const box = el('div', { class: 'wmx-rdonut-wrap' }, svg, legend);
    // Survol : la part et sa ligne de légende ressortent ensemble.
    const focus = (r) => { box.classList.toggle('focus', !!r); box.querySelectorAll('[data-r]').forEach((n) => n.classList.toggle('on', n.dataset.r === r)); };
    box.addEventListener('mouseover', (e) => { const r = e.target.closest?.('[data-r]')?.dataset.r; focus(r || null); });
    box.addEventListener('mouseleave', () => focus(null));
    return box;
  }

  async function render() {
    if (!body) return;
    paintTabs();
    if (priceBar) priceBar.hidden = tab !== 'collection';
    if (tab === 'profits') { await WMX.ledger?.render(body); return; }
    const t = WMX.inventory.totals();
    recordValue(t);
    const hist = await WMX.store.get('valueHistory', {});
    const avg = (it) => WMX.inventory.price(it)?.avg ?? null;
    const top = WMX.inventory.items().filter((it) => avg(it) != null).sort((a, b) => avg(b) - avg(a)).slice(0, 10);
    const metric = (label, value, sub) => el('div', { class: 'wmx-metric' }, el('small', {}, label), el('b', {}, value), sub ? el('small', {}, sub) : '');
    const noSale = t.loaded - t.priced; // prix chargés, mais aucune vente pour cette rareté (comptés comme chargés)
    body.replaceChildren(
      el('div', { class: 'wmx-metrics' },
        metric('Valeur estimée', `${fmt(t.value)} W`, `${fmt(t.loaded)} / ${fmt(t.total)} prix chargés${noSale ? ` (dont ${fmt(noSale)} sans vente)` : ''}`),
        metric('Cartes uniques', fmt(t.total)),
        metric('Prix chargés', `${t.total ? Math.round((t.loaded / t.total) * 100) : 0} %`, t.loaded >= t.total && t.total ? 'Tous les prix sont chargés' : 'Chargez les raretés manquantes')),
      el('div', { class: 'wmx-dash-grid' },
        el('div', { class: 'wmx-panelbox wmx-rdonutbox' }, el('h4', {}, 'Valeur par rareté'), rarityDonut(t.byR)),
        el('div', { class: 'wmx-panelbox' }, el('h4', {}, 'Top 10 des plus chères'),
          ...(top.length ? top.map((it, i) => el('div', { class: 'wmx-top-row', style: `--rgb:${WMX.RARITY_RGB[it.rarity]}` },
            el('span', { class: 'wmx-top-n' }, String(i + 1)),
            el('span', { class: 'wmx-lg-thumb' }, it.image ? el('img', { src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'wmx-lg-noimg' }, 'W')),
            el('span', { class: 'wmx-top-name' }, el('b', { title: it.title }, it.title), el('small', {}, `${it.rarity}${it.count > 1 ? ` · ×${it.count}` : ''}`)),
            el('b', { class: 'wmx-top-price' }, `${fmt(avg(it))} W`))) : [el('p', { class: 'wmx-cp-empty' }, 'Aucun prix chargé pour le moment.')]))),
      valueBlock(hist));
  }

  function build() {
    body = el('div', { class: 'wmx-dash' });
    const status = el('span', { class: 'wmx-cp-status' });
    tabsEl = el('div', { class: 'wmx-seg wmx-dash-tabs' });
    page = el('section', { class: 'wmx-cplus', id: 'wmx-dashboard', hidden: '' },
      el('header', { class: 'wmx-cp-head' }, el('h2', {}, 'Tableau de bord'), tabsEl, status,
        el('button', { class: 'wmx-close', title: 'Paramètres (enchère rapide, prix…)', onclick: () => WMX.openSettings() }, '⚙')),
      el('div', { class: 'wmx-cp-scroll' }, priceBar = WMX.inventory.makePriceBar(), body));
    document.body.append(page);
    window.addEventListener('resize', place);
    WMX.inventory.onChange(() => { if (isOpen() && tab === 'collection') render(); });
    WMX.ledger?.onChange(() => { if (isOpen() && tab === 'profits') render(); });
  }

  /** Onglets « Collection » / « Plus-values » de l'en-tête. */
  function paintTabs() {
    if (!tabsEl) return;
    tabsEl.replaceChildren(...[['profits', 'Plus-values'], ['collection', 'Collection']].map(([v, label]) => {
      const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(tab === v) }, label);
      b.addEventListener('click', () => { if (tab === v) return; tab = v; if (v === 'profits') WMX.ledger?.refresh(); render(); });
      return b;
    }));
  }

  const place = () => { if (page) page.style.left = `${Math.round(WMX.dom.sidebarRight())}px`; };

  function markNav() {
    document.querySelectorAll('[data-wmx-nav="dash"]').forEach((a) => a.classList.toggle('wmx-nav-active', isOpen()));
  }

  function close() {
    if (page) page.hidden = true;
    document.documentElement.classList.remove('wmx-page-open');
    markNav();
  }

  async function open() {
    if (!page) build();
    place();
    page.hidden = false;
    document.documentElement.classList.add('wmx-page-open');
    markNav();
    WMX.inventory.ensure();
    WMX.inventory.renderStatus();
    render();
  }

  // --- Entrée « Tableau de bord » dans la barre latérale du jeu -----------------------------------
  const ICON = '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>';

  function mountNav() {
    mountSettingsNav();
    if (document.querySelector('[data-wmx-nav="dash"]')?.isConnected) return; // déjà posée : aucun calcul de mise en page
    const nav = [...document.querySelectorAll('nav')].find((n) => n.getBoundingClientRect().width > 100);
    const coll = nav?.querySelector('a[href="/collection"]');
    if (!nav || !coll || nav.querySelector('[data-wmx-nav="dash"]')) return;
    const tpl = nav.querySelector('a[href="/trades"]') || coll; // lien inactif : même gabarit, sans l'état « actif »
    const a = tpl.cloneNode(true);
    a.removeAttribute('href');
    a.setAttribute('role', 'button');
    a.setAttribute('tabindex', '0');
    a.className = a.className.replace(/bg-\[var\(--color-accent\)\]\/10|text-\[var\(--color-accent\)\]/g, '');
    a.classList.add('wmx-nav-item');
    a.dataset.wmxNav = 'dash';
    const svg = a.querySelector('svg');
    if (svg) svg.innerHTML = ICON;
    const iconWrap = a.querySelector('span');
    a.replaceChildren(...(iconWrap ? [iconWrap] : []), 'Tableau de bord', el('i', { class: 'wmx-nav-tag' }, 'ext'));
    const go = (e) => { e.preventDefault(); e.stopPropagation(); open(); };
    a.addEventListener('click', go);
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    coll.after(a);
    markNav();
  }

  // --- Entrée « WikiMasters+ » sous « Paramètres » : ouvre les paramètres de l'extension -------------------
  const SET_ICON = '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>';
  function mountSettingsNav() {
    if (document.querySelector('[data-wmx-nav="settings"]')?.isConnected) return;
    const nav = [...document.querySelectorAll('nav')].find((n) => n.getBoundingClientRect().width > 100);
    if (!nav) return;
    const anchor = nav.querySelector('a[href="/settings"]') || [...nav.querySelectorAll('a[href]')].find((a) => /^\s*Paramètres\s*$/i.test(a.textContent));
    if (!anchor) return;
    const tpl = nav.querySelector('a[href="/trades"]') || anchor;
    const a = tpl.cloneNode(true);
    a.removeAttribute('href');
    a.setAttribute('role', 'button');
    a.setAttribute('tabindex', '0');
    a.setAttribute('title', 'Paramètres de WikiMasters Toolkit+');
    a.className = a.className.replace(/bg-\[var\(--color-accent\)\]\/10|text-\[var\(--color-accent\)\]/g, '');
    a.classList.add('wmx-nav-item');
    a.dataset.wmxNav = 'settings';
    const svg = a.querySelector('svg');
    if (svg) svg.innerHTML = SET_ICON;
    const iconWrap = a.querySelector('span');
    a.replaceChildren(...(iconWrap ? [iconWrap] : []), 'WikiMasters+', el('i', { class: 'wmx-nav-tag' }, 'ext'));
    const go = (e) => { e.preventDefault(); e.stopPropagation(); WMX.openSettings(); };
    a.addEventListener('click', go);
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    anchor.after(a);
  }

  WMX.dashboard = { open, render, show: (t) => { tab = t; return open(); } };

  WMX.register({
    name: 'dashboard',
    init() {
      mountNav();
      // Le jeu redessine sa barre latérale : on remet notre entrée si elle disparaît.
      let timer = null;
      new MutationObserver((muts) => { if (!WMX.dom.foreign(muts)) return; clearTimeout(timer); timer = setTimeout(mountNav, 250); }).observe(document.body, { childList: true, subtree: true });
      // Cliquer sur une autre entrée de la barre latérale du jeu quitte la page.
      document.addEventListener('click', (e) => {
        const a = e.target.closest?.('nav a[href]');
        if (a && !a.classList.contains('wmx-nav-item') && isOpen()) close();
      }, true);
      // Changer de page du jeu referme le tableau de bord.
      new MutationObserver(() => close()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wmx-route'] });
    },
  });
})();
