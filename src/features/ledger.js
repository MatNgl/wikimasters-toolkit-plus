// Plus-values : registre des achats et des ventes au marché, et l'onglet « Plus-values » du tableau de bord.
// Le jeu ne rend que les 50 dernières ventes (`history`) et les 50 derniers achats (`won`) de GET /api/marketplace?mine=1, sans pagination :
// l'extension les note donc au fil de l'eau (à chaque lecture de la bulle des enchères, de la page Marché, ou « Actualiser ») dans un registre
// gardé dans le navigateur, une ligne par enchère (jamais deux fois). Chaque vente est rapprochée de l'achat le plus ancien de la même carte
// (logic.ledgerPair) : plus-value réalisée et durée de détention ; les achats pas encore revendus forment le « stock » (plus-value latente).
(() => {
  const { el } = WMX.dom;
  const L = WMX.logic;
  const KEY = 'ledger';
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const pctText = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
  let reg = null; // { buys: { id: ligne }, sells: { id: ligne }, since }
  let saveT = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => { try { cb(); } catch (_) { /* vue fermée */ } });

  async function load() {
    if (!reg) {
      const r = await WMX.store.get(KEY, null);
      reg = r && r.buys && r.sells ? r : { buys: {}, sells: {}, since: 0 };
    }
    return reg;
  }
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => WMX.store.set(KEY, reg), 500); };

  /** Ligne du registre à partir d'une enchère terminée du jeu. */
  function entry(a) {
    const card = a.card || {};
    return {
      id: a.id,
      t: Date.parse(a.settled_at || a.end_at || a.created_at) || 0,
      price: Number(a.final_price ?? a.current_bid ?? 0) || 0,
      card_id: a.card_id || card.id || '',
      title: card.wikipedia_title || '?',
      rarity: WMX.normRarity?.(a.snapshot_rarity || card.rarity) || a.snapshot_rarity || card.rarity || '',
      shiny: !!(a.is_shiny ?? card.is_shiny),
      image: card.hide_image || card.nsfw_image ? '' : (card.image_url || ''),
    };
  }
  const mostCommon = (list) => { const m = new Map(); for (const x of list) if (x) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };

  /**
   * Ajoute au registre les ventes (`history`, vendues) et les achats (`won`) d'une réponse de /api/marketplace?mine=1. Mon identifiant est déduit
   * des achats (gagnant) ou des ventes (vendeur) : une ligne qui ne me concerne pas n'est jamais notée. Rend le nombre de lignes ajoutées.
   */
  async function ingest(j) {
    if (!j || (!Array.isArray(j.history) && !Array.isArray(j.won))) return 0;
    await load();
    const won = j.won || [];
    const hist = j.history || [];
    const me = mostCommon(won.map((a) => a.winner_id)) || mostCommon(hist.map((a) => a.seller_id));
    let added = 0;
    for (const a of hist) {
      if (!a?.id || a.status !== 'settled_sold' || reg.sells[a.id] || (me && a.seller_id && a.seller_id !== me)) continue;
      const e = entry(a);
      if (e.price > 0 && e.t) { reg.sells[a.id] = e; added += 1; }
    }
    for (const a of won) {
      if (!a?.id || reg.buys[a.id] || (me && a.winner_id && a.winner_id !== me) || (a.status && a.status !== 'settled_sold')) continue;
      const e = entry(a);
      if (e.price > 0 && e.t) { reg.buys[a.id] = e; added += 1; }
    }
    if (!reg.since) { reg.since = Date.now(); added += 0; save(); }
    if (added) { save(); emit(); }
    return added;
  }

  /** Relecture à la demande (« Actualiser ») : une requête, comme la bulle des enchères. */
  async function refresh() {
    try {
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('mine', '1');
      const res = await fetch(u);
      if (res.ok) return ingest(await res.json());
    } catch (_) { /* jeu injoignable */ }
    return -1;
  }

  // La page Marché du jeu demande aussi mes enchères : on en profite.
  WMX.onApi?.(({ path, data }) => { if (path === '/api/marketplace' && (data?.history || data?.won)) ingest(data); });

  // --- Affichage -------------------------------------------------------------------------------
  const V = { mode: 'all', unit: 'day', cursor: null, chart: 'gain', ops: 'all', sort: 'recent', stockSort: 'recent' };
  const PERIODS = { day: 30, week: 12, month: 12 };
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const dayLong = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  const dayShort = (t) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const when = (t) => (V.unit === 'day' ? hm(t) : `${dayShort(t)}, ${hm(t)}`);
  const dateFull = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  function periodTitle(start) {
    const now = L.periodStart(Date.now(), V.unit);
    if (V.unit === 'day') return { eyebrow: start === now ? 'Aujourd’hui' : start === L.periodShift(now, 'day', -1) ? 'Hier' : 'Jour', title: dayLong(start) };
    if (V.unit === 'week') {
      const end = L.periodShift(start, 'week', 1) - 1;
      const a = new Date(start), b = new Date(end);
      const same = a.getMonth() === b.getMonth();
      return { eyebrow: start === now ? 'Cette semaine' : 'Semaine', title: `Semaine du ${a.getDate()}${same ? '' : ` ${MONTHS[a.getMonth()]}`} au ${b.getDate()} ${b.toLocaleDateString('fr-FR', { month: 'long' })}` };
    }
    const d = new Date(start);
    return { eyebrow: start === now ? 'Ce mois' : 'Mois', title: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()) };
  }
  const axisLabel = (start) => {
    const d = new Date(start);
    return V.unit === 'month' ? MONTHS[d.getMonth()] : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  const fmtAxis = (v) => {
    const sg = v > 0 ? '+' : v < 0 ? '−' : '';
    return Math.abs(v) >= 1000 ? `${sg}${(Math.abs(v) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k` : `${sg}${fmt(Math.abs(v))}`;
  };

  /** Barres par période (plus-value ou flux net), la période choisie en surbrillance ; un clic sur une barre l'affiche. */
  function chart(series, onPick) {
    const W = 1200, H = 240, Lm = 54, Rm = 12, T = 14, B = 30;
    const vals = series.map((s) => s.v);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (hi === lo) hi = lo + 10;
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const n = series.length;
    const slot = (W - Lm - Rm) / n;
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'wmx-lg-chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', V.mode === 'all' && V.chart === 'net' ? 'Flux net par période, en W' : 'Plus-value réalisée par période, en W');
    let html = '';
    for (let v = lo; v <= hi + step / 2; v += step) html += `<line class="g${v === 0 ? ' zero' : ''}" x1="${Lm}" x2="${W - Rm}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ty" x="${Lm - 8}" y="${(y(v) + 4).toFixed(1)}">${fmtAxis(v)}</text>`;
    const every = Math.max(1, Math.ceil(n / 8));
    const selI = series.findIndex((x) => x.sel);
    series.forEach((s, i) => {
      const x = Lm + i * slot;
      if (s.sel) html += `<rect class="sel" x="${x.toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}"/><line class="selbar" x1="${x.toFixed(1)}" x2="${(x + slot).toFixed(1)}" y1="${H - B}" y2="${H - B}"/>`;
      const bw = Math.max(3, Math.min(26, slot * 0.6));
      const cx = x + slot / 2;
      if (s.v) {
        const top = y(Math.max(0, s.v)), bot = y(Math.min(0, s.v));
        html += `<rect class="bar ${s.v > 0 ? 'up' : 'down'}" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, bot - top).toFixed(1)}" rx="2"/>`;
      } else if (s.any) html += `<circle class="dot" cx="${cx.toFixed(1)}" cy="${y(0).toFixed(1)}" r="3"/>`;
      if (s.sel || (i % every === 0 && (selI < 0 || Math.abs(i - selI) >= Math.max(2, Math.ceil(every / 2))))) html += `<text class="tx${s.sel ? ' on' : ''}" x="${cx.toFixed(1)}" y="${H - 10}">${axisLabel(s.start)}</text>`;
      html += `<rect class="hit" data-i="${i}" x="${x.toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B + 20}"><title>${axisLabel(s.start)} : ${signed(s.v)} W</title></rect>`;
    });
    svg.innerHTML = html;
    svg.addEventListener('click', (e) => { const i = e.target?.getAttribute?.('data-i'); if (i != null) onPick(series[Number(i)].start); });
    return svg;
  }

  const rarityBadge = (r) => el('span', { class: 'wmx-lg-rar', style: `--rgb:${WMX.RARITY_RGB?.[r] || '160 175 168'}` }, r || '?');
  function cardCell(e) {
    const thumb = e.image ? el('img', { src: e.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'wmx-lg-noimg' }, 'W');
    return el('div', { class: 'wmx-lg-card', style: `--rgb:${WMX.RARITY_RGB?.[e.rarity] || '160 175 168'}` },
      el('span', { class: 'wmx-lg-thumb' }, thumb),
      el('span', { class: 'wmx-lg-name' }, el('b', { title: e.title }, e.title), el('span', {}, rarityBadge(e.rarity), e.shiny ? el('i', { class: 'wmx-lg-shiny' }, 'shiny') : '')));
  }
  const seg = (items, value, onPick, cls = '') => el('div', { class: `wmx-seg ${cls}` }, ...items.map(([v, label]) => {
    const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(value === v) }, label);
    b.addEventListener('click', () => onPick(v));
    return b;
  }));
  const kpi = (label, value, sub, cls = '') => el('div', { class: 'wmx-metric wmx-lg-kpi' }, el('small', {}, label), el('b', { class: cls }, value), sub ? el('small', {}, sub) : '');

  /** Onglet « Plus-values » dans `box` (redessiné à chaque choix). */
  async function render(box) {
    await load();
    const redraw = () => render(box);
    const { ops, stock } = L.ledgerPair(Object.values(reg.buys), Object.values(reg.sells));
    const all = V.mode === 'resale' ? ops.filter((o) => o.kind === 'resale') : ops;
    const first = Math.min(...[...Object.values(reg.buys), ...Object.values(reg.sells)].map((e) => e.t), reg.since || Date.now());
    const total = L.ledgerSummary(all);
    // Période affichée : la plus récente par défaut.
    if (V.cursor == null || L.periodStart(V.cursor, V.unit) !== V.cursor) V.cursor = L.periodStart(V.cursor ?? Date.now(), V.unit);
    const nowStart = L.periodStart(Date.now(), V.unit);
    const next = L.periodShift(V.cursor, V.unit, 1);
    const inPeriod = all.filter((o) => o.t >= V.cursor && o.t < next);
    const s = L.ledgerSummary(inPeriod);
    // Série du graphique : les N dernières périodes jusqu'à celle affichée (ou l'actuelle).
    const lastStart = Math.max(V.cursor, nowStart);
    const series = [];
    for (let i = PERIODS[V.unit] - 1; i >= 0; i--) {
      const st = L.periodShift(lastStart, V.unit, -i);
      const en = L.periodShift(st, V.unit, 1);
      const p = L.ledgerSummary(all.filter((o) => o.t >= st && o.t < en));
      const any = p.nSold + p.nBought > 0;
      series.push({ start: st, v: V.mode === 'all' && V.chart === 'net' ? p.net : p.gain, any, sel: st === V.cursor });
    }
    const pt = periodTitle(V.cursor);
    const unitWord = { day: 'jour', week: 'semaine', month: 'mois' }[V.unit];
    const head = el('div', { class: 'wmx-lg-head' },
      el('p', { class: 'wmx-lg-lead' }, V.mode === 'resale'
        ? 'Seulement les cartes achetées au marché puis revendues, chacune avec son prix d’achat : une revente compte à la date de la vente. Les ventes de cartes tirées et les cartes encore en stock sont écartées.'
        : 'Vos enchères conclues, achats et ventes. Une vente est rapprochée du plus ancien achat encore en stock de la même carte (même rareté, même version) : la différence est la plus-value réalisée.'),
      el('div', { class: 'wmx-lg-tools' },
        seg([['all', 'Tout'], ['resale', 'Achat-revente']], V.mode, (v) => { V.mode = v; redraw(); }),
        seg([['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']], V.unit, (v) => { V.unit = v; V.cursor = null; redraw(); }),
        el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost wmx-lg-refresh', onclick: async (e) => { e.currentTarget.disabled = true; await refresh(); redraw(); } }, '↻ Actualiser')));
    const since = el('p', { class: 'wmx-lg-since' },
      `Depuis le ${dateFull(first)} : plus-value réalisée `, el('b', { class: tone(total.gain) }, `${signed(total.gain)} W`), ` sur ${fmt(total.resales)} revente${total.resales > 1 ? 's' : ''} (${pctText(total.pct)})`,
      V.mode === 'resale'
        ? ` · achetées ${fmt(total.resaleBought)} W · revendues ${fmt(total.resaleSold)} W · ${fmt(total.wins)} gagnante${total.wins > 1 ? 's' : ''} sur ${fmt(total.resales)}`
        : ` · ${fmt(total.nSold)} vente${total.nSold > 1 ? 's' : ''} pour ${fmt(total.sold)} W · ${fmt(total.nBought)} achat${total.nBought > 1 ? 's' : ''} pour ${fmt(total.bought)} W`);
    const note = el('small', { class: 'wmx-cp-note' }, `Historique noté par l’extension depuis le ${dateFull(reg.since || Date.now())} (le jeu ne garde que vos 50 dernières ventes et vos 50 derniers achats : il s’enrichit à chaque visite du jeu, la bulle des enchères ouverte ou non).`);

    const nav = el('div', { class: 'wmx-lg-nav' },
      el('button', { type: 'button', class: 'wmx-lg-arrow', title: `${unitWord} précédent${V.unit === 'week' ? 'e' : ''}`, 'aria-label': 'Période précédente', onclick: () => { V.cursor = L.periodShift(V.cursor, V.unit, -1); redraw(); } }, '←'),
      el('div', {}, el('small', {}, pt.eyebrow), el('h3', {}, pt.title)),
      el('button', { type: 'button', class: 'wmx-lg-arrow', 'aria-label': 'Période suivante', disabled: V.cursor >= nowStart ? '' : null, onclick: () => { if (V.cursor < nowStart) { V.cursor = L.periodShift(V.cursor, V.unit, 1); redraw(); } } }, '→'));
    if (V.cursor >= nowStart) nav.lastChild.setAttribute('disabled', '');
    else nav.lastChild.removeAttribute('disabled');

    const winRate = s.resales ? Math.round((s.wins / s.resales) * 100) : 0;
    const kpis = el('div', { class: 'wmx-lg-kpis' }, ...(V.mode === 'resale' ? [
      kpi('Plus-value réalisée', `${signed(s.gain)} W`, s.resales ? `${pctText(s.pct)} sur ${s.resales} revente${s.resales > 1 ? 's' : ''}` : 'aucune revente', tone(s.gain)),
      kpi('Prix de vente', `${fmt(s.resaleSold)} W`, `${s.resales} revente${s.resales > 1 ? 's' : ''}`),
      kpi('Prix d’achat', `${fmt(s.resaleBought)} W`, 'des cartes revendues'),
      kpi('Reventes gagnantes', s.resales ? `${winRate} %` : '—', s.resales ? `${s.wins} sur ${s.resales}${s.losses ? ` · ${s.losses} à perte` : ''}` : ''),
      kpi('Détention moyenne', s.resales ? L.holdText(s.hold) : '—', 'de l’achat à la revente'),
    ] : [
      kpi('Plus-value réalisée', `${signed(s.gain)} W`, s.resales ? `${pctText(s.pct)} sur ${s.resales} revente${s.resales > 1 ? 's' : ''}` : 'aucune revente', tone(s.gain)),
      kpi('Ventes', `${fmt(s.sold)} W`, `${s.nSold} vente${s.nSold > 1 ? 's' : ''}${s.soldNotBought ? ` · dont ${fmt(s.soldNotBought)} W de cartes non achetées` : ''}`),
      kpi('Achats', `${fmt(s.bought)} W`, `${s.nBought} achat${s.nBought > 1 ? 's' : ''}`),
      kpi('Flux net', `${signed(s.net)} W`, 'ventes − achats', tone(s.net)),
      kpi('Reventes gagnantes', s.resales ? `${winRate} %` : '—', s.resales ? `${s.wins} sur ${s.resales} · détention moyenne ${L.holdText(s.hold)}` : ''),
    ]));
    const chartHead = el('div', { class: 'wmx-lg-charthead' },
      el('div', {}, el('h4', {}, `${V.mode === 'all' && V.chart === 'net' ? 'Flux net' : 'Plus-value réalisée'} par ${unitWord}`), el('small', {}, 'Cliquez sur une barre pour afficher la période')),
      V.mode === 'all' ? seg([['gain', 'Plus-value'], ['net', 'Flux net']], V.chart, (v) => { V.chart = v; redraw(); }) : '');
    const chartBox = el('div', { class: 'wmx-lg-chartwrap' }, chart(series, (st) => { V.cursor = st; redraw(); }));
    const periodBox = el('div', { class: 'wmx-panelbox wmx-lg-period' }, nav, kpis, chartHead, chartBox);

    // Opérations de la période
    const list = (V.mode === 'all' && V.ops !== 'all' ? inPeriod.filter((o) => (V.ops === 'buy' ? o.kind === 'buy' : o.kind !== 'buy')) : inPeriod).slice();
    if (V.sort === 'gain') list.sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity) || b.t - a.t);
    const nb = inPeriod.filter((o) => o.kind === 'buy').length;
    const opsHead = el('div', { class: 'wmx-lg-tablehead' }, el('h4', {}, V.mode === 'resale' ? 'Reventes' : 'Opérations'),
      el('div', { class: 'wmx-lg-tools' },
        V.mode === 'all' ? seg([['all', `Tout ${inPeriod.length}`], ['buy', `Achats ${nb}`], ['sell', `Ventes ${inPeriod.length - nb}`]], V.ops, (v) => { V.ops = v; redraw(); }) : '',
        seg([['recent', 'Récentes'], ['gain', 'Plus-value']], V.sort, (v) => { V.sort = v; redraw(); })));
    const opKind = { buy: 'Achat', sell: 'Vente', resale: 'Revente' };
    const gainCell = (o) => (o.kind === 'resale'
      ? el('td', { class: `n ${tone(o.gain)}` }, `${signed(o.gain)} W`, el('small', {}, pctText(o.buy.price ? (o.gain / o.buy.price) * 100 : 0)))
      : el('td', { class: 'n muted' }, '—'));
    const table = V.mode === 'resale'
      ? el('table', { class: 'wmx-lg-table' },
        el('thead', {}, el('tr', {}, el('th', {}, V.unit === 'day' ? 'Vendue à' : 'Vendue le'), el('th', {}, 'Carte'), el('th', {}, 'Achetée le'), el('th', { class: 'n' }, 'Prix d’achat'), el('th', { class: 'n' }, 'Prix de vente'), el('th', { class: 'n' }, 'Plus-value'), el('th', { class: 'n' }, 'Détention'))),
        el('tbody', {}, ...list.map((o) => el('tr', {}, el('td', { class: 'when' }, when(o.t)), el('td', {}, cardCell(o)), el('td', { class: 'when' }, `${dayShort(o.buy.t)}, ${hm(o.buy.t)}`),
          el('td', { class: 'n' }, `${fmt(o.buy.price)} W`), el('td', { class: 'n' }, `${fmt(o.price)} W`), gainCell(o), el('td', { class: 'n' }, L.holdText(o.hold))))))
      : el('table', { class: 'wmx-lg-table' },
        el('thead', {}, el('tr', {}, el('th', {}, V.unit === 'day' ? 'Heure' : 'Date'), el('th', {}, 'Carte'), el('th', {}, 'Opération'), el('th', { class: 'n' }, 'Prix'), el('th', { class: 'n' }, 'Prix d’achat'), el('th', { class: 'n' }, 'Plus-value'), el('th', { class: 'n' }, 'Détention'))),
        el('tbody', {}, ...list.map((o) => el('tr', {}, el('td', { class: 'when' }, when(o.t)), el('td', {}, cardCell(o)), el('td', {}, el('span', { class: `wmx-lg-op ${o.kind}` }, opKind[o.kind])),
          el('td', { class: 'n' }, `${fmt(o.price)} W`),
          el('td', { class: 'n muted' }, o.kind === 'resale' ? `${fmt(o.buy.price)} W` : o.kind === 'sell' ? 'non achetée' : '—'),
          gainCell(o), el('td', { class: 'n muted' }, o.kind === 'resale' ? L.holdText(o.hold) : '—')))));
    const opsBox = el('div', { class: 'wmx-panelbox wmx-lg-ops' }, opsHead,
      list.length ? el('div', { class: 'wmx-lg-tablewrap' }, table) : el('p', { class: 'wmx-cp-empty' }, V.mode === 'resale' ? 'Aucune revente sur cette période.' : 'Aucune opération sur cette période.'));

    // Cartes achetées encore en stock (toujours dans la collection), avec la plus-value latente au prix du marché.
    const owned = WMX.inventory?.items?.().length ? stock.filter((b) => WMX.inventory.find(b.title, b.rarity)) : stock;
    const market = (b) => WMX.prices?.get?.(b.card_id, b.rarity)?.avg ?? null;
    const latent = owned.reduce((n, b) => (market(b) != null ? n + (market(b) - b.price) : n), 0);
    const unknown = owned.filter((b) => market(b) == null).length;
    const stockList = owned.slice();
    if (V.stockSort === 'gain') stockList.sort((a, b) => ((market(b) ?? b.price) - b.price) - ((market(a) ?? a.price) - a.price));
    const stockBox = el('div', { class: 'wmx-panelbox wmx-lg-stock' },
      el('div', { class: 'wmx-lg-tablehead' }, el('h4', {}, 'Cartes achetées en stock'),
        el('div', { class: 'wmx-lg-tools' },
          el('small', {}, `${fmt(owned.length)} carte${owned.length > 1 ? 's' : ''} · payées ${fmt(owned.reduce((n, b) => n + b.price, 0))} W · plus-value latente `, el('b', { class: tone(latent) }, `${signed(latent)} W`), unknown ? ` (${unknown} sans prix du marché)` : ''),
          seg([['recent', 'Récentes'], ['gain', 'Plus-value']], V.stockSort, (v) => { V.stockSort = v; redraw(); }))),
      stockList.length ? el('div', { class: 'wmx-lg-tablewrap' }, el('table', { class: 'wmx-lg-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Achetée'), el('th', {}, 'Carte'), el('th', { class: 'n' }, 'Prix d’achat'), el('th', { class: 'n' }, 'Prix du marché'), el('th', { class: 'n' }, 'Plus-value latente'), el('th', { class: 'n' }, 'Depuis'))),
        el('tbody', {}, ...stockList.slice(0, 200).map((b) => {
          const m = market(b);
          return el('tr', {}, el('td', { class: 'when' }, `${dayShort(b.t)}, ${hm(b.t)}`), el('td', {}, cardCell(b)), el('td', { class: 'n' }, `${fmt(b.price)} W`),
            el('td', { class: 'n' }, m == null ? '—' : `${fmt(m)} W`), el('td', { class: `n ${m == null ? 'muted' : tone(m - b.price)}` }, m == null ? 'prix inconnu' : `${signed(m - b.price)} W`),
            el('td', { class: 'n muted' }, L.holdText(Date.now() - b.t)));
        }))))
        : el('p', { class: 'wmx-cp-empty' }, 'Aucune carte achetée en attente de revente.'));

    box.replaceChildren(el('div', { class: 'wmx-lg' }, head, since, note, periodBox, opsBox, V.mode === 'all' ? stockBox : ''));
  }

  WMX.ledger = { ingest, refresh, render, onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); }, data: async () => (await load(), reg) };
})();
