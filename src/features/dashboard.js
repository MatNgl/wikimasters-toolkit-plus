// Tableau de bord : une page de statistiques en plus de la collection du jeu (valeur estimée, valeur par rareté, top 10 des cartes
// les plus chères, courbe de la valeur dans le temps). Entrée « Tableau de bord » dans la barre latérale du jeu.
(() => {
  const { el } = WMX.dom;
  const R = WMX.RARITIES;
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  let page = null;
  let body = null;

  const isOpen = () => !!page && !page.hidden;

  async function recordValue(t) {
    if (!t.priced) return;
    const h = await WMX.store.get('valueHistory', {});
    h[new Date().toLocaleDateString('sv-SE')] = { value: Math.round(t.value), priced: t.priced, total: t.total };
    WMX.store.set('valueHistory', h);
  }

  async function render() {
    if (!body) return;
    const t = WMX.inventory.totals();
    recordValue(t);
    const hist = await WMX.store.get('valueHistory', {});
    const days = Object.keys(hist).sort();
    const avg = (it) => WMX.inventory.price(it)?.avg ?? null;
    const top = WMX.inventory.items().filter((it) => avg(it) != null).sort((a, b) => avg(b) - avg(a)).slice(0, 10);
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
    body.replaceChildren(
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

  function build() {
    body = el('div', { class: 'wmx-dash' });
    const status = el('span', { class: 'wmx-cp-status' });
    page = el('section', { class: 'wmx-cplus', id: 'wmx-dashboard', hidden: '' },
      el('header', { class: 'wmx-cp-head' }, el('h2', {}, 'Tableau de bord'), status,
        el('button', { class: 'wmx-close', title: 'Paramètres (enchère rapide, prix…)', onclick: () => WMX.openSettings() }, '⚙')),
      el('div', { class: 'wmx-cp-scroll' }, WMX.inventory.makePriceBar(), body));
    document.body.append(page);
    window.addEventListener('resize', place);
    WMX.inventory.onChange(() => { if (isOpen()) render(); });
  }

  const place = () => { if (page) page.style.left = `${Math.round(WMX.dom.sidebarRight())}px`; };

  function markNav() {
    document.querySelectorAll('[data-wmx-nav]').forEach((a) => a.classList.toggle('wmx-nav-active', isOpen()));
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
    const nav = [...document.querySelectorAll('nav')].find((n) => n.getBoundingClientRect().width > 100);
    const coll = nav?.querySelector('a[href="/collection"]');
    if (!nav || !coll || nav.querySelector('[data-wmx-nav]')) return;
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

  WMX.register({
    name: 'dashboard',
    init() {
      mountNav();
      // Le jeu redessine sa barre latérale : on remet notre entrée si elle disparaît.
      let timer = null;
      new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(mountNav, 250); }).observe(document.body, { childList: true, subtree: true });
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
