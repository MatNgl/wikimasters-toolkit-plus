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
  /**
   * Opération toute récente (moins de 6 h) : on garde la moyenne que l'extension connaissait à ce moment-là (cache des prix, relevée à 48 h
   * près), c'est-à-dire celle que vous voyiez en achetant. Elle passe avant toute moyenne recalculée.
   */
  function noteSeen(e) {
    if (!e || Date.now() - e.t > 6 * 3600000) return e;
    const p = WMX.prices?.get?.(e.card_id, e.rarity);
    if (p?.avg > 0 && Math.abs((p.t || 0) - e.t) < 48 * 3600000) e.avgSeen = { v: p.avg, t: p.t };
    return e;
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
      if (e.price > 0 && e.t) { reg.sells[a.id] = noteSeen(e); added += 1; }
    }
    for (const a of won) {
      if (!a?.id || reg.buys[a.id] || (me && a.winner_id && a.winner_id !== me) || (a.status && a.status !== 'settled_sold')) continue;
      const e = entry(a);
      if (e.price > 0 && e.t) { reg.buys[a.id] = noteSeen(e); added += 1; }
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

  // --- Historique complet : lecture directe de la base du jeu --------------------------------------------------------------
  // Le site parle à sa base (Supabase) avec sa clé publique et la session du joueur. Avec les mêmes, l'extension lit EN LECTURE SEULE ses propres
  // enchères conclues (acheteur ou vendeur), depuis le début : quelques requêtes au lieu des 50 dernières. Le jeton de session reste dans la page
  // (jamais enregistré ni journalisé) ; si la lecture échoue (session expirée, base modifiée), on garde la méthode des 50 dernières.
  const SB = { cfg: null, busy: null };
  async function sbConfig() {
    if (SB.cfg) return SB.cfg;
    const saved = await WMX.store.get('sbConfig', null);
    if (saved?.url && saved?.key) return (SB.cfg = saved);
    let url = null, key = null;
    for (const src of [...document.querySelectorAll('script[src]')].map((s) => s.src).filter((u) => u.includes('/_next/'))) {
      try {
        const t = await (await fetch(src)).text();
        url ||= t.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] || null;
        key ||= t.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/)?.[0] || t.match(/sb_publishable_[A-Za-z0-9_-]{10,}/)?.[0] || null;
      } catch (_) { /* morceau illisible */ }
      if (url && key) break;
    }
    if (!url || !key) return null;
    SB.cfg = { url, key };
    WMX.store.set('sbConfig', SB.cfg); // adresse et clé PUBLIQUES du site (pas la session)
    return SB.cfg;
  }
  /** Session du joueur (cookie « sb-…-auth-token », éventuellement découpé en .0, .1…) : { access_token, user }, ou null. */
  function sbSession() {
    try {
      const parts = document.cookie.split(';').map((c) => c.trim()).filter((c) => /^sb-[^=]+-auth-token(\.\d+)?=/.test(c))
        .sort((a, b) => Number(a.match(/\.(\d+)=/)?.[1] || 0) - Number(b.match(/\.(\d+)=/)?.[1] || 0));
      let raw = parts.map((c) => decodeURIComponent(c.slice(c.indexOf('=') + 1))).join('');
      if (raw.startsWith('base64-')) raw = atob(raw.slice(7).replace(/-/g, '+').replace(/_/g, '/'));
      const s = JSON.parse(raw);
      return s?.access_token && s?.user?.id ? s : null;
    } catch (_) { return null; }
  }
  /**
   * Lit tout l'historique (achats et ventes conclus) et l'ajoute au registre. Rend { ok, total, added } ou { ok: false, why }.
   * Une seule lecture à la fois ; pas plus d'une par heure sauf `force` (« Actualiser »).
   */
  async function importAll(force = false) {
    await load();
    if (SB.busy) return SB.busy;
    if (!force && reg.full?.t && Date.now() - reg.full.t < 3600000) return { ok: true, total: reg.full.n, added: 0, cached: true };
    SB.busy = (async () => {
      const cfg = await sbConfig();
      const s = sbSession();
      if (!cfg) return { ok: false, why: 'adresse de la base du jeu introuvable' };
      if (!s) return { ok: false, why: 'session de connexion introuvable : reconnectez-vous au jeu' };
      const me = s.user.id;
      const headers = { apikey: cfg.key, Authorization: `Bearer ${s.access_token}` };
      const sel = encodeURIComponent('id,card_id,seller_id,winner_id,final_price,settled_at,snapshot_rarity,is_shiny,status,card:cards(wikipedia_title,rarity,image_url,hide_image)');
      let total = 0, added = 0;
      for (const [kind, col] of [['buy', 'winner_id'], ['sell', 'seller_id']]) {
        for (let from = 0; from < 50000; from += 1000) {
          let r;
          try { r = await fetch(`${cfg.url}/rest/v1/auctions?select=${sel}&status=eq.settled_sold&${col}=eq.${me}&order=settled_at.asc`, { headers: { ...headers, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } }); } catch (_) { return { ok: false, why: 'réseau' }; }
          if (!r.ok) { if (r.status === 401 || r.status === 403) { SB.cfg = null; WMX.store.set('sbConfig', null); } return { ok: false, why: r.status === 401 ? 'session expirée : actualisez la page du jeu' : `la base du jeu a répondu ${r.status}` }; }
          const rows = await r.json();
          total += rows.length;
          for (const a of rows) {
            const store = kind === 'buy' ? reg.buys : reg.sells;
            if (!a?.id || store[a.id] || (kind === 'buy' ? a.winner_id !== me : a.seller_id !== me)) continue;
            const e = entry(a);
            if (e.price > 0 && e.t) { store[a.id] = noteSeen(e); added += 1; }
          }
          if (rows.length < 1000) break;
          await new Promise((res) => setTimeout(res, 300));
        }
      }
      reg.full = { t: Date.now(), n: total };
      save(); emit();
      if (added) WMX.journal?.add('Plus-values', `historique complet lu : ${total} enchères conclues, ${added} nouvelles lignes`);
      return { ok: true, total, added };
    })();
    try { return await SB.busy; } finally { SB.busy = null; }
  }

  // --- Moyenne du marché au jour de chaque opération ---------------------------------------------------------------------
  // La moyenne affichée aujourd'hui n'est pas celle du jour de l'achat (les prix bougent). Pour chaque opération du registre, on lit les ventes
  // conclues de la carte dans les 30 jours qui la précèdent (base du jeu, lecture seule, 20 cartes par requête), et on garde leur moyenne
  // (logic.avgBefore) dans la ligne : `avgAt` = { v, n, w } ou null (aucune vente), calculée une seule fois. Si la base ne montre pas les
  // ventes des autres joueurs, on passe par l'historique des ventes du jeu (/api/marketplace/cards/{id}/sales), carte par carte.
  const AVG = { busy: null, done: 0, todo: 0, mode: 'db', failed: null, tried: new Set(), lastRun: 0, apiFails: 0 };
  const avgWhy = (why) => { if (AVG.failed !== why) { AVG.failed = why; WMX.journal?.add('Plus-values', `moyennes du jour de l’achat : ${why}`, 'warn'); } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const saleRow = (a) => ({ id: a.id, price: Number(a.final_price ?? a.price ?? 0) || 0, t: Date.parse(a.settled_at || a.sold_at || a.created_at) || 0,
    rarity: WMX.normRarity?.(a.snapshot_rarity || a.rarity) || a.snapshot_rarity || a.rarity || '', shiny: !!a.is_shiny });
  /** Ventes d'une carte selon l'historique du jeu (200 dernières) ; null si illisible. */
  async function gameSales(cardId) {
    for (let tryN = 0; tryN < 4; tryN++) {
      let r;
      try { r = await fetch(new URL(`/api/marketplace/cards/${cardId}/sales`, location.origin)); } catch (_) { return null; }
      if (r.status === 403 || r.status === 429) { await sleep(30000); continue; } // le jeu freine : pause, puis on reprend
      if (!r.ok) { AVG.apiStatus = r.status; return null; }
      const j = await r.json().catch(() => null);
      const arr = Array.isArray(j) ? j : j && (j.sales || j.items || j.history || Object.values(j).find((v) => Array.isArray(v) && v.some((x) => x && 'final_price' in x)));
      return Array.isArray(arr) ? arr.filter((a) => a && (a.status == null || a.status === 'settled_sold')).map(saleRow) : null;
    }
    return null;
  }
  async function fillAverages(onProgress) {
    await load();
    if (AVG.busy) return AVG.busy;
    // Une carte déjà essayée sur cette page n'est pas relue (sinon, en cas d'échec, chaque affichage relançait toute la lecture).
    const entries = [...Object.values(reg.buys), ...Object.values(reg.sells)].filter((e) => e.avgAt === undefined && !e.avgSeen && e.card_id && e.t && !AVG.tried.has(e.card_id));
    if (!entries.length) return { ok: true, added: 0 };
    AVG.lastRun = Date.now();
    entries.forEach((e) => AVG.tried.add(e.card_id));
    AVG.busy = (async () => {
      const byCard = new Map();
      for (const e of entries) { if (!byCard.has(e.card_id)) byCard.set(e.card_id, []); byCard.get(e.card_id).push(e); }
      const cards = [...byCard.keys()];
      AVG.todo = cards.length; AVG.done = 0; AVG.failed = null;
      const own = new Set([...Object.keys(reg.buys), ...Object.keys(reg.sells)]);
      const DAY = 24 * 3600000;
      const iso = (t) => `"${new Date(t).toISOString()}"`;
      let added = 0;
      const apply = (ids, sales) => {
        for (const id of ids) for (const e of byCard.get(id)) { e.avgAt = L.avgBefore(sales.get(id) || [], e); added += 1; }
        AVG.done += ids.length;
        save();
        onProgress?.();
      };
      for (let i = 0; i < cards.length;) {
        const chunk = AVG.mode === 'db' ? cards.slice(i, i + 20) : cards.slice(i, i + 1);
        const sales = new Map();
        if (AVG.mode === 'db') {
          const cfg = await sbConfig();
          const s = sbSession();
          if (!cfg || !s) { avgWhy(!cfg ? 'adresse de la base du jeu introuvable, lecture par l’historique des ventes du jeu' : 'session introuvable, lecture par l’historique des ventes du jeu'); AVG.mode = 'api'; continue; }
          const cond = chunk.map((id) => { const ts = byCard.get(id).map((e) => e.t); return `and(card_id.eq.${id},settled_at.gte.${iso(Math.min(...ts) - 30 * DAY)},settled_at.lte.${iso(Math.max(...ts))})`; }).join(',');
          const rows = [];
          let bad = null;
          for (let from = 0; from < 30000; from += 1000) {
            let r;
            try {
              r = await fetch(`${cfg.url}/rest/v1/auctions?select=id,card_id,final_price,settled_at,snapshot_rarity,is_shiny&status=eq.settled_sold&or=${encodeURIComponent(`(${cond})`)}&order=settled_at.asc`,
                { headers: { apikey: cfg.key, Authorization: `Bearer ${s.access_token}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
            } catch (_) { bad = 'réseau'; break; }
            if (!r.ok) { bad = `la base du jeu a répondu ${r.status}`; break; }
            const page = await r.json();
            rows.push(...page);
            if (page.length < 1000) break;
            await sleep(300);
          }
          // Base injoignable, ou qui ne montre que MES enchères (ventes des autres joueurs non lisibles) : historique des ventes du jeu, carte par carte.
          if (bad || (chunk.length >= 5 && rows.length && rows.every((a) => own.has(a.id)))) { avgWhy(bad ? `base du jeu illisible (${bad}), lecture par l’historique des ventes du jeu` : 'la base du jeu ne montre pas les ventes des autres joueurs, lecture par l’historique des ventes du jeu'); AVG.mode = 'api'; continue; }
          for (const a of rows) { if (!sales.has(a.card_id)) sales.set(a.card_id, []); sales.get(a.card_id).push(saleRow(a)); }
          apply(chunk, sales);
          await sleep(400);
        } else {
          const list = await gameSales(chunk[0]);
          if (list) { AVG.apiFails = 0; sales.set(chunk[0], list); apply(chunk, sales); } else { AVG.done += 1; AVG.apiFails += 1; onProgress?.(); } // illisible : réessayée à la prochaine ouverture du tableau de bord
          // L'historique des ventes du jeu ne répond pas (réservé au compte Pro, ou point d'accès changé) : on arrête, la moyenne actuelle sera montrée.
          if (AVG.apiFails >= 5) { avgWhy(`historique des ventes du jeu illisible (${AVG.apiStatus ? `réponse ${AVG.apiStatus}` : 'réponse sans ventes'}) : moyenne actuelle affichée à la place`); break; }
          await sleep(700);
        }
        i += chunk.length;
      }
      return { ok: true, added };
    })();
    try { return await AVG.busy; } finally { AVG.busy = null; }
  }

  // --- Affichage -------------------------------------------------------------------------------
  const V = { mode: 'all', unit: 'day', cursor: null, chart: 'gain', ops: 'all', opsSort: { key: 'date', dir: 'desc' }, stockSort: { key: 'date', dir: 'desc' } };
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

  /** Texte de l'infobulle d'une barre : période, montant, nombre de ventes / achats / reventes. */
  function tipFor(sr) {
    const p = sr.p;
    const head = V.unit === 'day' ? dayLong(sr.start) : periodTitle(sr.start).title;
    const nRes = `${p.resales} revente${p.resales > 1 ? 's' : ''}`;
    const lines = [];
    let label;
    if (V.mode === 'resale') {
      label = p.resales ? `plus-value réalisée sur ${nRes}` : 'aucune revente';
      if (p.resales) {
        lines.push(`${p.wins} gagnante${p.wins > 1 ? 's' : ''}${p.losses ? ` · ${p.losses} à perte` : ''} · détention moyenne ${L.holdText(p.hold)}`);
        lines.push(`Achetées ${fmt(p.resaleBought)} W · revendues ${fmt(p.resaleSold)} W`);
      }
    } else if (!(p.nSold + p.nBought)) {
      label = 'aucune opération';
    } else {
      const counts = `${p.nSold} vente${p.nSold > 1 ? 's' : ''} · ${p.nBought} achat${p.nBought > 1 ? 's' : ''} · ${nRes}`;
      if (V.chart === 'net') {
        label = 'flux net : ventes − achats';
        lines.push(counts, `Ventes ${fmt(p.sold)} W − achats ${fmt(p.bought)} W`, `Plus-value réalisée : ${signed(p.gain)} W (${nRes})`);
      } else {
        label = p.resales ? `plus-value réalisée (${nRes})` : 'plus-value réalisée : aucune revente';
        lines.push(counts, `Flux net : ${signed(p.net)} W (ventes ${fmt(p.sold)} − achats ${fmt(p.bought)})`);
        if (p.nBought) lines.push('Les cartes achetées non revendues ne comptent qu’à leur revente');
      }
    }
    return { head, value: sr.v, label, lines };
  }

  /** Barres par période (plus-value ou flux net), la période choisie en surbrillance ; survol : le détail ; clic : la période s'affiche. */
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
      html += `<rect class="hit" data-i="${i}" x="${x.toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B + 20}"/>`;
    });
    WMX.dom.svg(svg, html);
    svg.addEventListener('click', (e) => { const i = e.target?.getAttribute?.('data-i'); if (i != null) onPick(series[Number(i)].start); });
    // Infobulle : suit la souris au-dessus des barres.
    const ft = WMX.dom.floatTip('wmx-lg-tip');
    const tip = ft.el;
    const wrap = el('div', { class: 'wmx-lg-chartwrap' }, svg);
    let shown = -1;
    svg.addEventListener('mousemove', (e) => {
      const i = e.target?.getAttribute?.('data-i');
      if (i == null) { ft.hide(); shown = -1; return; }
      if (Number(i) !== shown) {
        shown = Number(i);
        const t = tipFor(series[shown]);
        tip.replaceChildren(el('span', { class: 'wmx-lg-tip-head' }, t.head), el('div', { class: 'wmx-lg-tip-main' }, el('b', { class: tone(t.value) }, `${signed(t.value)} W`), el('small', {}, t.label)), ...t.lines.map((l) => el('small', {}, l)));
      }
      ft.show(e);
    });
    svg.addEventListener('mouseleave', () => { ft.hide(); shown = -1; });
    return wrap;
  }

  /**
   * Tableau des opérations : un clic sur une carte déplie, sous sa ligne, les enchères concernées (achat, vente) : date, prix et identifiant de
   * l'enchère, avec « Copier » et « Ouvrir l'enchère » (page de l'enchère dans le jeu, nouvel onglet). Un second clic replie.
   */
  function attachDetails(table, items, auctionsOf) {
    const rows = [...table.querySelectorAll('tbody > tr')];
    rows.forEach((tr, i) => {
      const it = items[i];
      const card = tr.querySelector('.wmx-lg-card');
      if (!it || !card) return;
      card.classList.add('wmx-lg-card--click');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.title = 'Voir l’enchère d’achat ou de vente (identifiant, lien)';
      const toggle = () => {
        const open = tr.nextElementSibling?.classList.contains('wmx-lg-detail');
        if (open) { tr.nextElementSibling.remove(); tr.classList.remove('wmx-lg-open'); openRows.delete(it.id); return; }
        tr.classList.add('wmx-lg-open');
        openRows.add(it.id);
        const td = el('td', { colspan: String(tr.children.length) }, ...auctionsOf(it).map((a) => {
          const copy = el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost wmx-lg-copy' }, 'Copier');
          copy.addEventListener('click', async (e) => {
            e.stopPropagation();
            try { await navigator.clipboard.writeText(a.id); copy.textContent = 'Copié'; } catch (_) { copy.textContent = 'Copie impossible'; }
            setTimeout(() => { copy.textContent = 'Copier'; }, 1500);
          });
          return el('div', { class: 'wmx-lg-auction' },
            el('span', { class: `wmx-lg-op ${a.label === 'Achat' ? 'buy' : 'sell'}` }, a.label),
            el('span', { class: 'when' }, `${dayShort(a.t)}, ${hm(a.t)}`), el('b', {}, `${fmt(a.price)} W`),
            el('span', { class: 'wmx-lg-aid' }, 'Enchère ', el('code', { title: a.id }, a.id)), copy,
            el('a', { class: 'wmx-btn wmx-btn--ghost', href: `/marketplace/${a.id}`, target: '_blank', rel: 'noopener' }, 'Ouvrir l’enchère ↗'));
        }));
        tr.after(el('tr', { class: 'wmx-lg-detail' }, td));
      };
      if (openRows.has(it.id)) toggle(); // déjà dépliée avant ce nouvel affichage
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }

  /**
   * Tri d'un tableau selon une colonne : st = { key, dir: 'asc' | 'desc' }. Les cases vides (pas de prix de vente pour un achat, moyenne
   * inconnue…) restent toujours en bas ; à égalité, la plus récente d'abord.
   */
  function sortRows(rows, cols, st) {
    const col = cols.find((c) => c[0] === st.key && c[3]) || cols[0];
    const get = col[3];
    const sign = st.dir === 'asc' ? 1 : -1;
    rows.sort((x, y) => {
      const a = get(x), b = get(y);
      const ea = a == null || a === '', eb = b == null || b === '';
      if (ea || eb) return ea === eb ? y.t - x.t : ea ? 1 : -1;
      const c = typeof a === 'string' ? a.localeCompare(b, 'fr', { sensitivity: 'base' }) : a - b;
      return c ? sign * c : y.t - x.t;
    });
  }
  /** En-tête cliquable : un clic trie par cette colonne (les plus grands d'abord ; la carte : de A à Z), un second inverse l'ordre. */
  function sortHead(cols, st, onPick) {
    return el('thead', {}, el('tr', {}, ...cols.map(([key, label, cls, get, help]) => {
      if (!get) return el('th', { class: cls }, label);
      const on = st.key === key;
      const th = el('th', { class: `${cls} wmx-lg-sortable${on ? ' on' : ''}`, 'aria-sort': on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        el('button', { type: 'button', class: 'wmx-lg-sort', title: `${help ? `${help}\n` : ''}Cliquer pour trier${on ? ` (ordre ${st.dir === 'asc' ? 'croissant' : 'décroissant'})` : ''}` },
          label, el('i', { 'aria-hidden': 'true' }, on ? (st.dir === 'asc' ? '▲' : '▼') : '↕')));
      th.querySelector('button').addEventListener('click', () => onPick(on ? { key, dir: st.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'card' ? 'asc' : 'desc' }));
      return th;
    })));
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
  const KPI_HELP = {
    'Plus-value réalisée': 'Prix de vente moins prix d’achat des cartes achetées au marché puis revendues sur la période.',
    'Ventes': 'Tout ce que vous avez encaissé en ventes sur la période, cartes tirées comprises.',
    'Achats': 'Tout ce que vous avez dépensé en achats sur la période.',
    'Flux net': 'Ventes moins achats : ce que la période a fait entrer (ou sortir) de wikibidous.',
    'Reventes gagnantes': 'Part des reventes vendues plus cher qu’achetées.',
    'Détention moyenne': 'Temps moyen entre l’achat et la revente.',
    'Prix de vente': 'Total encaissé pour les cartes revendues.',
    'Prix d’achat': 'Ce que ces mêmes cartes vous avaient coûté.',
  };
  const kpi = (label, value, sub, cls = '') => el('div', { class: 'wmx-metric wmx-lg-kpi', title: KPI_HELP[label] || '' }, el('small', {}, label), el('b', { class: cls }, value), sub ? el('small', {}, sub) : '');

  let curBox = null;   // onglet affiché (redessiné quand des moyennes arrivent)
  let priceSub = null; // abonnement unique aux moyennes chargées
  const missing = new Set(); // cartes affichées sans moyenne dans le cache
  const openRows = new Set(); // lignes dépliées (enchères), gardées d'un affichage à l'autre
  /** Onglet « Plus-values » dans `box` (redessiné à chaque choix). */
  async function render(box) {
    await load();
    const redraw = () => render(box);
    // Historique complet : lu à la première ouverture, puis au plus une fois par heure (en arrière-plan ; la page se redessine à l'arrivée).
    if (!SB.busy && (!reg.full || Date.now() - reg.full.t > 3600000) && !(SB.last && !SB.last.ok && Date.now() - (SB.lastAt || 0) < 60000)) {
      importAll().then((r) => { SB.last = r; SB.lastAt = Date.now(); if (!r.ok && box.isConnected) redraw(); });
    }
    await WMX.prices?.load?.();
    curBox = box;
    if (!priceSub && WMX.prices?.onProgress) {
      let t = 0;
      // Redessin seulement quand une moyenne qui MANQUAIT à l'écran est arrivée (pas à chaque prix chargé ailleurs dans l'extension).
      priceSub = WMX.prices.onProgress(() => { if (curBox?.isConnected && Date.now() - t > 3000 && [...missing].some((id) => WMX.prices.has(id))) { t = Date.now(); setTimeout(() => curBox?.isConnected && render(curBox), 300); } });
    }
    if (!AVG.busy && Date.now() - AVG.lastRun > 10 * 60000) {
      let lastPaint = Date.now();
      fillAverages(() => { if (box.isConnected && Date.now() - lastPaint > 4000) { lastPaint = Date.now(); redraw(); } })
        .then((r) => { if (r?.added && box.isConnected) redraw(); });
    }
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
      series.push({ start: st, v: V.mode === 'all' && V.chart === 'net' ? p.net : p.gain, any, sel: st === V.cursor, p });
    }
    const pt = periodTitle(V.cursor);
    const unitWord = { day: 'jour', week: 'semaine', month: 'mois' }[V.unit];
    const explain = V.mode === 'resale'
      ? 'Achat-revente : seulement les cartes achetées au marché puis revendues, chacune avec son prix d’achat. Une revente compte à la date de la vente ; les cartes tirées vendues et celles encore en stock sont écartées.'
      : 'Tout : vos enchères conclues, achats et ventes. Chaque vente est rapprochée du plus ancien achat de la même carte (même rareté, même version) : la différence est la plus-value réalisée. Une carte tirée puis vendue compte comme « non achetée ».';
    const head = el('div', { class: 'wmx-lg-head' },
      el('div', { class: 'wmx-lg-tools' },
        seg([['all', 'Tout'], ['resale', 'Achat-revente']], V.mode, (v) => { V.mode = v; redraw(); }),
        seg([['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']], V.unit, (v) => { V.unit = v; V.cursor = null; redraw(); }),
        el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost wmx-lg-refresh', onclick: async (e) => { e.currentTarget.disabled = true; await refresh(); SB.last = await importAll(true); redraw(); } }, '↻ Actualiser')));
    const since = el('p', { class: 'wmx-lg-since' },
      el('span', { class: 'wmx-lg-info', tabindex: '0', title: explain, 'aria-label': explain }, 'ⓘ'), ` Depuis le ${dateFull(first)} : plus-value réalisée `, el('b', { class: tone(total.gain) }, `${signed(total.gain)} W`), ` sur ${fmt(total.resales)} revente${total.resales > 1 ? 's' : ''} (${pctText(total.pct)})`,
      V.mode === 'resale'
        ? ` · achetées ${fmt(total.resaleBought)} W · revendues ${fmt(total.resaleSold)} W · ${fmt(total.wins)} gagnante${total.wins > 1 ? 's' : ''} sur ${fmt(total.resales)}`
        : ` · ${fmt(total.nSold)} vente${total.nSold > 1 ? 's' : ''} pour ${fmt(total.sold)} W · ${fmt(total.nBought)} achat${total.nBought > 1 ? 's' : ''} pour ${fmt(total.bought)} W`);
    const note = el('small', { class: 'wmx-cp-note' }, reg.full
      ? `Historique complet lu dans la base du jeu (${fmt(reg.full.n)} enchères conclues, mis à jour ${new Date(reg.full.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}), puis complété au fil de l’eau.`
      : SB.last && !SB.last.ok
        ? `Historique complet indisponible pour l’instant (${SB.last.why}) : seules vos 50 dernières ventes et vos 50 derniers achats sont connus, notés depuis le ${dateFull(reg.since || Date.now())}. « Actualiser » réessaie.`
        : 'Lecture de l’historique complet en cours…');

    if (AVG.busy && AVG.todo) note.append(` Moyennes au jour de chaque opération : ${fmt(AVG.done)} / ${fmt(AVG.todo)} cartes lues…`);
    else if (AVG.failed && /actuelle affichée/.test(AVG.failed)) note.append(` Moyennes du jour de l’achat indisponibles : la moyenne actuelle est affichée (≈) quand elle est connue.`);

    const nav = el('div', { class: 'wmx-lg-nav' },
      el('button', { type: 'button', class: 'wmx-lg-arrow', title: `${unitWord} précédent${V.unit === 'week' ? 'e' : ''}`, 'aria-label': 'Période précédente', onclick: () => { V.cursor = L.periodShift(V.cursor, V.unit, -1); redraw(); } }, '←'),
      el('div', {}, el('small', {}, pt.eyebrow), el('h3', {}, pt.title)),
      V.cursor < nowStart ? el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost wmx-lg-today', onclick: () => { V.cursor = nowStart; redraw(); } }, { day: 'Aujourd’hui', week: 'Cette semaine', month: 'Ce mois' }[V.unit]) : '',
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
      el('div', {}, el('h4', {}, `${V.mode === 'all' && V.chart === 'net' ? 'Flux net' : 'Plus-value réalisée'} par ${unitWord}`), el('small', {}, 'Survolez une barre pour le détail · cliquez pour afficher ses opérations')),
      V.mode === 'all' ? seg([['gain', 'Plus-value'], ['net', 'Flux net']], V.chart, (v) => { V.chart = v; redraw(); }) : '');
    const chartBox = chart(series, (st) => { V.cursor = st; redraw(); });
    const periodBox = el('div', { class: 'wmx-panelbox wmx-lg-period' }, nav, kpis, chartHead, chartBox);

    // Opérations de la période
    const list = (V.mode === 'all' && V.ops !== 'all' ? inPeriod.filter((o) => (V.ops === 'buy' ? o.kind === 'buy' : o.kind !== 'buy')) : inPeriod).slice();
    const nb = inPeriod.filter((o) => o.kind === 'buy').length;
    const opsHead = el('div', { class: 'wmx-lg-tablehead' }, el('h4', {}, V.mode === 'resale' ? 'Reventes' : 'Opérations'),
      el('div', { class: 'wmx-lg-tools' },
        V.mode === 'all' ? seg([['all', `Tout ${inPeriod.length}`], ['buy', `Achats ${nb}`], ['sell', `Ventes ${inPeriod.length - nb}`]], V.ops, (v) => { V.ops = v; redraw(); }) : '',
        el('small', { class: 'wmx-lg-sorthint' }, 'Cliquez sur un titre de colonne pour trier')));
    const opKind = { buy: 'Achat', sell: 'Vente', resale: 'Revente' };
    // Moyenne au jour de l'achat (pour une vente de carte non achetée : au jour de la vente).
    const regOf = (e) => (e ? reg.buys[e.id] || reg.sells[e.id] || e : null);
    /**
     * Moyenne à montrer pour l'opération e (achat, ou vente d'une carte non achetée) : celle que l'extension affichait au moment de l'opération,
     * sinon celle recalculée d'après les ventes de ce jour-là, sinon la moyenne actuelle du cache (précédée de « ≈ »). { pending } : en cours de lecture.
     */
    const avgFor = (e, at) => {
      const r = regOf(e);
      if (!r) return null;
      if (r.avgSeen?.v) return { v: r.avgSeen.v, kind: 'seen', title: `Moyenne au jour de ${at} (celle qu’affichait l’extension à ce moment-là)` };
      if (r.avgAt?.v) return { v: r.avgAt.v, kind: 'day', title: `Moyenne au jour de ${at} : ${r.avgAt.n} vente${r.avgAt.n > 1 ? 's' : ''} de la carte (même rareté) ${r.avgAt.w === 7 ? 'dans les 7 jours' : 'les plus récentes, sur 30 jours au plus,'} avant ${at}` };
      const p = WMX.prices?.get?.(r.card_id, r.rarity);
      const waiting = r.avgAt === undefined && !!AVG.busy;
      if (p?.avg > 0) return { v: p.avg, kind: 'now', title: `≈ : moyenne actuelle de la carte, celle du jour de ${at} ${waiting ? 'est en cours de lecture' : r.avgAt === null ? 'est inconnue (aucune vente dans les 30 jours précédents)' : 'n’a pas pu être retrouvée'}` };
      if (waiting || WMX.prices?.loading?.(r.card_id)) return { pending: true };
      return null;
    };
    const avgCell = (e, at) => {
      const a = avgFor(e, at);
      if (!a) return el('td', { class: 'n muted', title: 'Moyenne inconnue : aucune vente retrouvée et pas de moyenne dans le cache' }, '—');
      if (a.pending) return el('td', { class: 'n muted', title: 'Moyenne en cours de lecture' }, '…');
      return el('td', { class: `n${a.kind === 'now' ? ' wmx-lg-avgnow' : ''}`, title: a.title }, `${a.kind === 'now' ? '≈ ' : ''}${fmt(a.v)} W`);
    };
    // Prix d'achat, avec l'écart à la moyenne montrée (vert : acheté sous la moyenne).
    const buyCell = (e, price) => {
      const a = avgFor(e, 'l’achat');
      const d = a?.v ? ((price - a.v) / a.v) * 100 : null;
      return el('td', { class: 'n' }, `${fmt(price)} W`, d == null ? '' : el('small', { class: tone(-d), title: a.kind === 'now' ? 'Écart à la moyenne actuelle (celle du jour de l’achat est inconnue)' : 'Écart à la moyenne du jour de l’achat' }, `${pctText(d)} / moy.`));
    };
    // Moyennes jamais chargées des cartes de la période (et du stock) : demandées en arrière-plan, la page se redessine à leur arrivée.
    missing.clear();
    const askPrices = (items) => items.slice(0, 300).forEach((x, i) => { if (x.card_id && !WMX.prices?.has?.(x.card_id)) { missing.add(x.card_id); WMX.prices?.keepFresh?.(x.card_id, 1e6 + i, { maxAge: Infinity }); } });
    const gainCell = (o) => (o.kind === 'resale'
      ? el('td', { class: `n ${tone(o.gain)}` }, `${signed(o.gain)} W`, el('small', {}, pctText(o.buy.price ? (o.gain / o.buy.price) * 100 : 0)))
      : el('td', { class: 'n muted' }, '—'));
    // Colonnes : [clé de tri, titre, classe, valeur pour le tri (null : colonne non triable), aide au survol du titre].
    const AVG_HELP = 'Moyenne du marché de la carte AU JOUR DE L’ACHAT (pour une vente d’une carte non achetée : au jour de la vente). Précédée de « ≈ » : moyenne actuelle, celle du jour de l’achat n’ayant pas pu être retrouvée.';
    const opAvg = (o) => (o.kind === 'resale' ? avgFor(o.buy, 'l’achat') : avgFor(o, 'l’achat'))?.v ?? null;
    const opsCols = V.mode === 'resale' ? [
      ['date', V.unit === 'day' ? 'Vendue à' : 'Vendue le', '', (o) => o.t],
      ['card', 'Carte', '', (o) => o.title],
      ['bought', 'Achetée le', '', (o) => o.buy.t],
      ['avg', 'Moyenne', 'n', opAvg, AVG_HELP],
      ['buy', 'Prix d’achat', 'n', (o) => o.buy.price],
      ['sell', 'Prix de vente', 'n', (o) => o.price],
      ['gain', 'Plus-value', 'n', (o) => o.gain],
      ['hold', 'Détention', 'n', (o) => o.hold],
    ] : [
      ['date', V.unit === 'day' ? 'Heure' : 'Date', '', (o) => o.t],
      ['card', 'Carte', '', (o) => o.title],
      ['op', 'Opération', '', null],
      ['avg', 'Moyenne', 'n', opAvg, AVG_HELP],
      ['buy', 'Prix d’achat', 'n', (o) => (o.kind === 'buy' ? o.price : o.kind === 'resale' ? o.buy.price : null)],
      ['sell', 'Prix de vente', 'n', (o) => (o.kind === 'buy' ? null : o.price)],
      ['gain', 'Plus-value', 'n', (o) => (o.kind === 'resale' ? o.gain : null)],
      ['hold', 'Détention', 'n', (o) => (o.kind === 'resale' ? o.hold : null)],
    ];
    sortRows(list, opsCols, V.opsSort);
    const opsThead = sortHead(opsCols, V.opsSort, (st) => { V.opsSort = st; redraw(); });
    const table = V.mode === 'resale'
      ? el('table', { class: 'wmx-lg-table' }, opsThead,
        el('tbody', {}, ...list.map((o) => el('tr', {}, el('td', { class: 'when' }, when(o.t)), el('td', {}, cardCell(o)), el('td', { class: 'when' }, `${dayShort(o.buy.t)}, ${hm(o.buy.t)}`),
          avgCell(o.buy, 'l’achat'), buyCell(o.buy, o.buy.price), el('td', { class: 'n' }, `${fmt(o.price)} W`), gainCell(o), el('td', { class: 'n' }, L.holdText(o.hold))))))
      : el('table', { class: 'wmx-lg-table' }, opsThead,
        el('tbody', {}, ...list.map((o) => el('tr', {}, el('td', { class: 'when' }, when(o.t)), el('td', {}, cardCell(o)), el('td', {}, el('span', { class: `wmx-lg-op ${o.kind}` }, opKind[o.kind])),
          o.kind === 'resale' ? avgCell(o.buy, 'l’achat') : avgCell(o, o.kind === 'buy' ? 'l’achat' : 'la vente'),
          o.kind === 'buy' ? buyCell(o, o.price) : o.kind === 'resale' ? buyCell(o.buy, o.buy.price) : el('td', { class: 'n muted' }, 'non achetée'),
          o.kind === 'buy' ? el('td', { class: 'n' }) : el('td', { class: 'n' }, `${fmt(o.price)} W`),
          gainCell(o), el('td', { class: 'n muted' }, o.kind === 'resale' ? L.holdText(o.hold) : '—')))));
    askPrices(list.map((o) => o));
    attachDetails(table, list, (o) => (o.kind === 'resale'
      ? [{ label: 'Achat', id: o.buy.id, t: o.buy.t, price: o.buy.price }, { label: 'Revente', id: o.id, t: o.t, price: o.price }]
      : [{ label: o.kind === 'buy' ? 'Achat' : 'Vente', id: o.id, t: o.t, price: o.price }]));
    const opsBox = el('div', { class: 'wmx-panelbox wmx-lg-ops' }, opsHead,
      list.length ? el('div', { class: 'wmx-lg-tablewrap' }, table) : el('p', { class: 'wmx-cp-empty' }, V.mode === 'resale' ? 'Aucune revente sur cette période.' : 'Aucune opération sur cette période.'));

    // Cartes achetées encore en stock (toujours dans la collection), avec la plus-value latente au prix du marché.
    const owned = WMX.inventory?.items?.().length ? stock.filter((b) => WMX.inventory.find(b.title, b.rarity)) : stock;
    const market = (b) => WMX.prices?.get?.(b.card_id, b.rarity)?.avg ?? null;
    const latent = owned.reduce((n, b) => (market(b) != null ? n + (market(b) - b.price) : n), 0);
    const unknown = owned.filter((b) => market(b) == null).length;
    const stockList = owned.slice();
    const stockCols = [
      ['date', 'Achetée', '', (b) => b.t],
      ['card', 'Carte', '', (b) => b.title],
      ['avg', 'Moyenne à l’achat', 'n', (b) => avgFor(b, 'l’achat')?.v ?? null, AVG_HELP],
      ['buy', 'Prix d’achat', 'n', (b) => b.price],
      ['market', 'Prix du marché', 'n', (b) => market(b), 'Moyenne du marché aujourd’hui'],
      ['latent', 'Plus-value latente', 'n', (b) => (market(b) == null ? null : market(b) - b.price), 'Prix du marché aujourd’hui moins prix d’achat'],
      ['since', 'Depuis', 'n', (b) => Date.now() - b.t],
    ];
    sortRows(stockList, stockCols, V.stockSort);
    const stockBox = el('div', { class: 'wmx-panelbox wmx-lg-stock' },
      el('div', { class: 'wmx-lg-tablehead' }, el('h4', {}, 'Cartes achetées en stock'),
        el('div', { class: 'wmx-lg-tools' },
          el('small', {}, `${fmt(owned.length)} carte${owned.length > 1 ? 's' : ''} · payées ${fmt(owned.reduce((n, b) => n + b.price, 0))} W · plus-value latente `, el('b', { class: tone(latent) }, `${signed(latent)} W`), unknown ? ` (${unknown} sans prix du marché)` : ''))),
      stockList.length ? el('div', { class: 'wmx-lg-tablewrap' }, el('table', { class: 'wmx-lg-table' },
        sortHead(stockCols, V.stockSort, (st) => { V.stockSort = st; redraw(); }),
        el('tbody', {}, ...stockList.slice(0, 200).map((b) => {
          const m = market(b);
          return el('tr', {}, el('td', { class: 'when' }, `${dayShort(b.t)}, ${hm(b.t)}`), el('td', {}, cardCell(b)), avgCell(b, 'l’achat'), buyCell(b, b.price),
            el('td', { class: 'n' }, m == null ? '—' : `${fmt(m)} W`), el('td', { class: `n ${m == null ? 'muted' : tone(m - b.price)}` }, m == null ? 'prix inconnu' : `${signed(m - b.price)} W`),
            el('td', { class: 'n muted' }, L.holdText(Date.now() - b.t)));
        }))))
        : el('p', { class: 'wmx-cp-empty' }, 'Aucune carte achetée en attente de revente.'));

    askPrices(stockList);
    const stockTable = stockBox.querySelector('table');
    if (stockTable) attachDetails(stockTable, stockList.slice(0, 200), (b) => [{ label: 'Achat', id: b.id, t: b.t, price: b.price }]);
    box.replaceChildren(el('div', { class: 'wmx-lg' }, head, since, note, periodBox, opsBox, V.mode === 'all' ? stockBox : ''));
  }

  WMX.ledger = { fillAverages,  ingest, refresh, render, importAll, onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); }, data: async () => (await load(), reg) };
})();
