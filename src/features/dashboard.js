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
  let tab = 'collection'; // onglet : 'collection' (valeur, raretés, top 10) ou 'profits' (plus-values, ledger.js)
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

  /** Courbe SVG : axe vertical gradué en W, dates en bas, lignes de repère, un point par jour (survol : date et valeur). */
  function chartSvg(days, hist) {
    const W = 680, H = 280, L = 64, RT = 18, T = 16, B = 36;
    const vals = days.map((d) => hist[d].value);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) { const pad = Math.max(10, hi * 0.05); lo -= pad; hi += pad; }
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const x = (i) => L + (days.length === 1 ? (W - L - RT) / 2 : (i / (days.length - 1)) * (W - L - RT));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let grid = '';
    for (let v = lo; v <= hi + step / 2; v += step) {
      grid += `<line class="g" x1="${L}" x2="${W - RT}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ty" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}">${fmtAxis(v)}</text>`;
    }
    const nLabels = Math.min(days.length, 6);
    let xl = '';
    for (let k = 0; k < nLabels; k++) {
      const i = nLabels === 1 ? 0 : Math.round((k / (nLabels - 1)) * (days.length - 1));
      xl += `<text class="tx" x="${x(i).toFixed(1)}" y="${H - 12}">${dmy(days[i])}</text><line class="tick" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${H - B}" y2="${H - B + 4}"/>`;
    }
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = days.length > 1 ? `<polygon class="area" points="${x(0).toFixed(1)},${H - B} ${pts.join(' ')} ${x(days.length - 1).toFixed(1)},${H - B}"/>` : '';
    const line = days.length > 1 ? `<polyline class="line" points="${pts.join(' ')}"/>` : '';
    const dots = vals.map((v, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${days.length > 40 ? 2 : 3.5}"><title>${dmyFull(days[i])} : ${fmt(v)} W</title></circle>`).join('');
    return `<svg class="wmx-vchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Valeur estimée de la collection dans le temps, en W">`
      + `<text class="unit" x="${L}" y="10">W</text>${grid}<line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${W - RT}" y1="${H - B}" y2="${H - B}"/>${area}${line}${dots}${xl}</svg>`;
  }

  /** Bloc « Valeur dans le temps » : repères chiffrés, choix de la période, courbe et tableau jour par jour. */
  function valueBlock(hist) {
    const all = Object.keys(hist).sort();
    const box = el('div', { class: 'wmx-panelbox wmx-vbox' }, el('h4', {}, 'Valeur estimée dans le temps (en W)'));
    if (all.length < 2) {
      box.append(el('p', { class: 'wmx-cp-empty' }, all.length
        ? `Un seul jour enregistré pour l’instant (${dmyFull(all[0])} : ${fmt(hist[all[0]].value)} W). La courbe, les écarts et le tableau apparaîtront dès le deuxième jour.`
        : 'Aucune valeur enregistrée pour l’instant. Chargez les prix de la collection : la valeur est notée une fois par jour.'));
      return box;
    }
    const days = range ? all.slice(-range) : all;
    const first = hist[days[0]].value;
    const last = hist[days.at(-1)].value;
    const vals = days.map((d) => hist[d].value);
    const diff = last - first;
    const pct = first ? (diff / first) * 100 : 0;
    const seg = el('div', { class: 'wmx-seg wmx-vrange' }, ...[[7, '7 jours'], [30, '30 jours'], [0, 'Tout']].map(([n, label]) => {
      const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(range === n) }, label);
      b.addEventListener('click', () => { range = n; render(); });
      return b;
    }));
    const stat = (label, value, cls = '') => el('div', { class: 'wmx-vstat' }, el('small', {}, label), el('b', { class: cls }, value));
    box.append(
      el('div', { class: 'wmx-vtop' },
        el('div', { class: 'wmx-vstats' },
          stat('Dernière valeur', `${fmt(last)} W`),
          stat(`Variation (${dmy(days[0])} → ${dmy(days.at(-1))})`, `${sign(diff)}${fmt(Math.abs(diff))} W (${sign(diff)}${Math.abs(pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)`, diff > 0 ? 'up' : diff < 0 ? 'down' : ''),
          stat('Plus haut', `${fmt(Math.max(...vals))} W`),
          stat('Plus bas', `${fmt(Math.min(...vals))} W`)),
        seg));
    const chart = el('div', { class: 'wmx-vwrap' });
    chart.innerHTML = chartSvg(days, hist);
    box.append(chart);
    // Tableau : du plus récent au plus ancien, avec l'écart au jour précédent et le nombre de cartes dont le prix était chargé ce jour-là.
    const rows = days.map((d, i) => {
      const h = hist[d];
      const prev = i ? hist[days[i - 1]].value : null;
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
          el('thead', {}, el('tr', {}, el('th', {}, 'Jour'), el('th', { class: 'n' }, 'Valeur estimée'), el('th', { class: 'n' }, 'Écart au jour précédent'), el('th', { class: 'n', title: 'Cartes dont le prix était chargé ce jour-là, sur le nombre de cartes de la collection' }, 'Prix chargés'))),
          el('tbody', {}, ...rows))),
      el('small', { class: 'wmx-cp-note' }, 'La valeur est la somme des moyennes du marché × exemplaires, notée une fois par jour. Elle bouge aussi quand davantage de prix sont chargés (dernière colonne) : une hausse peut venir de prix ajoutés, pas seulement du marché.'));
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
        el('div', { class: 'wmx-panelbox' }, el('h4', {}, 'Valeur par rareté'),
          el('div', { class: 'wmx-stackbar' }, ...R.map((r) => el('i', { style: `flex:${t.byR[r] || 0.0001};background:rgb(${WMX.RARITY_RGB[r]})` }))),
          ...R.map((r) => el('div', { class: 'wmx-row2', style: `--rgb:${WMX.RARITY_RGB[r]}` }, el('b', {}, r), el('span', {}, `${fmt(t.byR[r])} W`)))),
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
    tabsEl.replaceChildren(...[['collection', 'Collection'], ['profits', 'Plus-values']].map(([v, label]) => {
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
