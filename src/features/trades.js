// Échanges : bouton « Valeurs » sur chaque offre d'échange (reçues, envoyées, historique) : les cartes de chaque côté avec leur
// moyenne du marché, les wikibidous ajoutés, le total par côté et l'écart. Les offres viennent de GET /api/trades (déjà demandé
// par le jeu) ; les moyennes de la même source que Collection+. Principe repris de l'ancienne extension (cartes repérées par
// leurs titres dans l'offre affichée).
(() => {
  const { el } = WMX.dom;
  const trades = new Map();
  const open = new Set();
  let timer = null;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

  function mapTrade(raw) {
    if (!raw?.id || !raw.initiator_id || !raw.recipient_id) return null;
    const items = (raw.items || []).map((it) => {
      const card = it?.card;
      const id = it?.card_id || card?.id;
      if (!id || !card?.wikipedia_title) return null;
      return { by: it.offered_by, id, title: card.wikipedia_title, rarity: WMX.normRarity(it.snapshot_rarity || card.rarity) || 'C' };
    }).filter(Boolean);
    return {
      id: raw.id, items,
      sides: [
        { uid: raw.initiator_id, name: raw.initiator?.username || 'Initiateur', w: Number(raw.initiator_wikibidous) || 0 },
        { uid: raw.recipient_id, name: raw.recipient?.username || 'Destinataire', w: Number(raw.recipient_wikibidous) || 0 },
      ],
    };
  }

  const cardEls = () => [...document.querySelectorAll('.card-frame')].filter((c) =>
    [...c.querySelectorAll('button[aria-label]')].some((b) => norm(b.getAttribute('aria-label')) === 'voir le détail de l’échange' || norm(b.getAttribute('aria-label')) === "voir le détail de l'échange"));

  /** Offre correspondant à une carte affichée : titres des cartes présents dans l'élément, puis noms des joueurs. */
  function matchTrade(elm, used) {
    if (elm.dataset.wmxTrade && trades.has(elm.dataset.wmxTrade)) return trades.get(elm.dataset.wmxTrade);
    const titled = new Set([...elm.querySelectorAll('[title]')].map((n) => norm(n.getAttribute('title'))));
    const text = norm(elm.textContent);
    let best = null;
    let bestScore = 0;
    for (const t of trades.values()) {
      if (used.has(t.id)) continue;
      const titles = t.items.map((i) => norm(i.title));
      const hit = titles.filter((x) => titled.has(x)).length;
      let score = hit * 30 + (titles.length && hit === titles.length ? 100 : 0) - (titles.length - hit) * 20;
      for (const s of t.sides) if (norm(s.name) && text.includes(norm(s.name))) score += 12;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  function panel(t) {
    const rows = [];
    const totals = t.sides.map((s) => {
      const items = t.items.filter((i) => i.by === s.uid);
      let sum = s.w;
      let known = 0;
      const lines = items.map((i) => {
        const p = WMX.prices.get(i.id, i.rarity);
        const fresh = WMX.prices.fresh(i.id);
        if (p) { sum += p.avg; known += 1; } else if (fresh) known += 1;
        return el('div', { class: 'wmx-tv-row', style: `--rgb:${WMX.RARITY_RGB[i.rarity]}` },
          el('b', {}, i.rarity), el('span', {}, i.title), el('em', {}, p ? `${fmt(p.avg)} W` : fresh ? 'sans vente' : '…'));
      });
      if (s.w) lines.push(el('div', { class: 'wmx-tv-row' }, el('b', {}, 'W'), el('span', {}, 'Wikibidous ajoutés'), el('em', {}, `${fmt(s.w)} W`)));
      if (!items.length && !s.w) lines.push(el('div', { class: 'wmx-tv-row' }, el('span', {}, 'Aucune carte')));
      rows.push(el('div', { class: 'wmx-tv-side' }, el('h5', {}, `${s.name} · ${items.length} carte${items.length > 1 ? 's' : ''}`), ...lines,
        el('div', { class: 'wmx-tv-total' }, el('span', {}, `Total${known < items.length ? ` (prix connus : ${known}/${items.length})` : ''}`), el('b', {}, `${fmt(sum)} W`))));
      return sum;
    });
    const diff = totals[0] - totals[1];
    return el('div', { class: 'wmx-tv' }, ...rows,
      el('div', { class: 'wmx-tv-diff' }, diff === 0 ? 'Valeurs équivalentes' : `Écart : ${fmt(Math.abs(diff))} W en faveur de ${diff > 0 ? t.sides[1].name : t.sides[0].name}`));
  }

  function render(elm, t) {
    let wrap = elm.querySelector(':scope > .wmx-tv-wrap');
    if (!wrap) {
      const btn = el('button', { class: 'wmx-btn wmx-btn--ghost wmx-tv-btn', type: 'button' }, 'Valeurs');
      wrap = el('div', { class: 'wmx-tv-wrap' }, btn);
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = trades.get(elm.dataset.wmxTrade);
        if (!cur) return;
        if (open.has(cur.id)) open.delete(cur.id); else { open.add(cur.id); for (const i of cur.items) if (!WMX.prices.get(i.id, i.rarity) && !WMX.prices.fresh(i.id)) WMX.prices.fetchOne(i.id); }
        render(elm, cur);
      });
      elm.append(wrap);
    }
    const isOpen = open.has(t.id);
    const sig = isOpen ? t.items.map((i) => `${WMX.prices.get(i.id, i.rarity)?.avg ?? ''}${WMX.prices.fresh(i.id) ? 1 : 0}`).join(',') : 'closed';
    if (wrap.dataset.sig === sig) return; // rien n'a changé : pas de reconstruction (évite une boucle avec l'observateur)
    wrap.dataset.sig = sig;
    wrap.querySelector('.wmx-tv-btn').textContent = open.has(t.id) ? 'Masquer les valeurs' : 'Valeurs';
    wrap.querySelector('.wmx-tv')?.remove();
    if (open.has(t.id)) wrap.append(panel(t));
  }

  function scan() {
    if (!/^\/trades/.test(location.pathname)) return;
    const used = new Set();
    for (const elm of cardEls()) {
      const t = matchTrade(elm, used);
      if (!t) continue;
      used.add(t.id);
      elm.dataset.wmxTrade = t.id;
      render(elm, t);
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 250); };

  WMX.register({
    name: 'trades',
    match: /^\/trades/,
    init() {
      WMX.onApi(({ path, data }) => {
        if (path !== '/api/trades') return;
        for (const raw of data?.trades || []) { const t = mapTrade(raw); if (t) trades.set(t.id, t); }
        schedule();
      });
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      WMX.prices.onProgress(() => { if (open.size) schedule(); });
      schedule();
    },
  });
  WMX.tradeValues = { mapTrade, scan };
})();
