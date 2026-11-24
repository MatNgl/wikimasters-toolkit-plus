// Bouton « Marché » sur une carte : voir en un clic si elle est en vente, et aller la chercher sur le Marché.
// Deux façons, combinées dans la même fenêtre :
//  1) un petit panneau qui interroge le Marché du jeu (GET /api/marketplace?…&q=Titre, la même recherche que la barre du jeu) et liste les enchères en cours
//     de CETTE carte (titre exact), avec « Voir » (ouvre l'enchère) et « Surveiller » ;
//  2) « Voir sur le Marché » : ouvre la page Marché et recopie le titre dans la barre de recherche du jeu, puis lance la recherche (le jeu ne lit pas
//     la recherche dans l'adresse de la page : on tape donc le titre comme le ferait le joueur).
// Le bouton est posé UNIQUEMENT dans la fiche (le détail) d'une carte du jeu : Collection, Toutes les cartes, profils. Pas sur les cartes elles-mêmes,
// ni dans la révélation des paquets (la carte y est déjà sous les yeux).
(() => {
  const { el, sleep, waitFor } = WMX.dom;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const PENDING = 'wmxMarketQ';
  const cache = new Map(); // titre normalisé -> { t, list }
  const onMarket = () => /^\/marketplace\/?$/.test(location.pathname);

  // --- Recherche des enchères en cours d'une carte --------------------------------------------------------------------------------------
  /** Enchères actives dont le titre est EXACTEMENT celui de la carte (la recherche du jeu renvoie aussi les titres qui le contiennent). */
  async function find(title) {
    const key = norm(title);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < 20000) return hit.list;
    if ((WMX.gameBlockedUntil || 0) > Date.now()) throw new Error('blocked');
    const out = [];
    for (let page = 1; page <= 3; page++) { // 150 résultats au plus : une recherche par clic, jamais en boucle
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', String(page)); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('q', title);
      const res = await fetch(u);
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      for (const a of j?.auctions || []) if (a?.status === 'active' && norm(a.card?.wikipedia_title) === key) out.push(a);
      if (!j?.hasMore) break;
      await sleep(400);
    }
    out.sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
    cache.set(key, { t: Date.now(), list: out });
    return out;
  }

  // --- Aller sur le Marché avec la recherche pré-remplie -----------------------------------------------------------------------------
  /** Recopie le titre dans la barre de recherche du Marché et lance la recherche. */
  async function fill(title) {
    const input = await waitFor(() => document.querySelector('input[type="search"][placeholder^="Rechercher une carte"]'), 15000, 150);
    if (!input) { WMX.toast?.(`Tapez « ${title} » dans la barre de recherche du Marché.`, 6000); return false; }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, title);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    const btn = [...document.querySelectorAll('button')].find((b) => norm(b.textContent) === 'rechercher' && !b.closest('.wmx-bubble, .wmx-panel, .wmx-dlg'));
    if (btn && !btn.disabled) btn.click();
    else for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return true;
  }
  /** Recherche demandée avant un changement de page (ou un rechargement complet) : exécutée une seule fois, par le premier qui la trouve. */
  async function consumePending() {
    let q = null;
    try { q = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); sessionStorage.removeItem(PENDING); } catch (_) { q = null; }
    if (!q?.title || Date.now() - (q.t || 0) > 30000 || !onMarket()) return false;
    return fill(q.title);
  }
  async function go(card) {
    const title = card.title || card.wikipedia_title;
    if (!title) return;
    closePanel();
    try { WMX.sheet?.closeSheet?.('view'); } catch (_) { /* fiche déjà fermée */ }
    try { sessionStorage.setItem(PENDING, JSON.stringify({ title, t: Date.now() })); } catch (_) { /* stockage de session indisponible */ }
    if (!onMarket()) {
      window.dispatchEvent(new CustomEvent('wmx:navigate', { detail: '/marketplace' }));
      await waitFor(() => onMarket(), 8000, 100);
      await sleep(300);
    }
    await consumePending();
  }

  // --- Panneau --------------------------------------------------------------------------------------------------------------------------
  let panel = null;
  const closePanel = () => { panel?.remove(); panel = null; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' && panel) { e.stopPropagation(); closePanel(); } };

  /** Prix de l'enchère : la mise actuelle, sinon le prix de départ. */
  const priceOf = (a) => a.current_bid || a.base_amount || 0;
  function rowOf(a, me) {
    const mine = !!me && a.seller_id === me;
    const rarity = WMX.normRarity(a.snapshot_rarity || a.card?.rarity) || '';
    const price = a.current_bid ? `Mise ${fmt(a.current_bid)} W` : `Départ ${fmt(a.base_amount)} W`;
    const left = Math.max(0, new Date(a.end_at).getTime() - Date.now());
    // Écart avec la moyenne du marché : vert si moins cher, rouge si plus cher (rien tant que la moyenne n'est pas connue).
    const avg = WMX.prices?.get?.(a.card_id, rarity || 'C')?.avg;
    const pct = avg > 0 ? Math.round((priceOf(a) / avg - 1) * 100) : null;
    const pill = pct == null ? '' : el('span', { class: `wmx-mks-pill ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}`, title: `Moyenne du marché : ${fmt(avg)} W` }, `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} %`);
    const title = a.card?.wikipedia_title || '';
    const watch = el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost wmx-mks-watch' }, 'Surveiller');
    const paintWatch = () => { const s = WMX.auctions?.watchState?.(a.id); watch.textContent = s === 'watch' ? 'Surveillée' : s === 'auto' ? 'Mise auto' : 'Surveiller'; watch.disabled = s === 'auto'; watch.classList.toggle('on', s === 'watch'); };
    watch.addEventListener('click', async () => { watch.disabled = true; try { await WMX.auctions?.toggleWatch?.(a.id, title); } finally { paintWatch(); } });
    paintWatch();
    const see = el('button', { type: 'button', class: 'wmx-btn wmx-mks-see' }, 'Voir');
    see.addEventListener('click', () => {
      closePanel();
      try { WMX.sheet?.closeSheet?.('view'); } catch (_) { /* fiche déjà fermée */ }
      window.dispatchEvent(new CustomEvent('wmx:navigate', { detail: `/marketplace/${a.id}` }));
    });
    return el('div', { class: 'wmx-mks-item' },
      el('b', { class: 'wmx-mks-rar', style: `--rgb:${WMX.RARITY_RGB?.[rarity] || '160 175 168'}` }, rarity || '?'),
      el('div', { class: 'wmx-mks-info' }, el('strong', {}, price, pill), el('small', {}, `${WMX.logic.fmtLeft(left)} restant${mine ? ' · votre vente' : ''}`)),
      mine ? el('span', { class: 'wmx-mks-mine' }, 'Votre vente') : el('div', { class: 'wmx-mks-acts' }, watch, see));
  }

  /** Ouvre le panneau d'une carte { title, rarity? } : résultats du Marché + « Voir sur le Marché ». */
  async function open(card) {
    const title = card.title || card.wikipedia_title;
    if (!title) return;
    closePanel();
    const list = el('div', { class: 'wmx-mks-list' }, el('p', { class: 'wmx-mks-wait' }, 'Recherche sur le Marché…'));
    const goBtn = el('button', { type: 'button', class: 'wmx-btn', onclick: () => go({ title }) }, 'Voir sur le Marché');
    const dlg = el('div', { class: 'wmx-dlg wmx-mks-dlg', role: 'dialog', 'aria-label': `${title} sur le Marché` },
      el('button', { type: 'button', class: 'wmx-dlg-x', title: 'Fermer', 'aria-label': 'Fermer', onclick: closePanel }, '×'),
      el('h3', {}, `« ${title} » sur le Marché`), list,
      el('div', { class: 'wmx-dlg-row' }, el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost', onclick: closePanel }, 'Fermer'), goBtn));
    panel = el('div', { class: 'wmx-dlg-back wmx-mks' }, dlg);
    panel.addEventListener('mousedown', (e) => { if (e.target === panel) closePanel(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(panel);
    const mine = panel;
    try {
      const found = await find(title);
      if (panel !== mine) return; // fermé entre-temps
      const me = WMX.auctions?.state?.()?.me || null;
      const rar = WMX.normRarity(card.rarity);
      const rarOf = (a) => WMX.normRarity(a.snapshot_rarity || a.card?.rarity);
      // Les moins chères d'abord (ordre croissant) ; la rareté de la carte regardée passe avant les autres, dont les prix ne se comparent pas.
      const sorted = [...found].sort((a, b) => ((rarOf(b) === rar) - (rarOf(a) === rar)) || priceOf(a) - priceOf(b) || new Date(a.end_at) - new Date(b.end_at));
      const paint = () => {
        if (panel !== mine) return;
        if (!sorted.length) { list.replaceChildren(el('p', { class: 'wmx-mks-wait' }, 'Aucune enchère en cours pour cette carte.')); return; }
        const avg = WMX.prices?.get?.(sorted[0].card_id, rarOf(sorted[0]) || 'C')?.avg;
        list.replaceChildren(el('p', { class: 'wmx-mks-count' }, `${sorted.length} enchère${sorted.length > 1 ? 's' : ''} en cours${avg > 0 ? ` · moyenne ${fmt(avg)} W` : ''}`), ...sorted.slice(0, 8).map((a) => rowOf(a, me)),
          ...(sorted.length > 8 ? [el('p', { class: 'wmx-mks-wait' }, `… et ${sorted.length - 8} autre${sorted.length - 8 > 1 ? 's' : ''} : « Voir sur le Marché ».`)] : []));
      };
      paint();
      // Moyennes du marché (une seule lecture par carte) : les écarts vert / rouge s'ajoutent dès qu'elles arrivent.
      const missing = [...new Set(sorted.slice(0, 8).map((a) => a.card_id).filter((id) => id && !WMX.prices?.has?.(id)))];
      if (missing.length) Promise.all(missing.map((id) => Promise.race([WMX.prices.fetchOne(id), sleep(8000)]))).then(paint).catch(() => {});
    } catch (err) {
      if (panel !== mine) return;
      list.replaceChildren(el('p', { class: 'wmx-mks-wait' }, err?.message === 'blocked' ? 'Le jeu demande de patienter : réessayez dans un instant.' : 'Le Marché ne répond pas pour le moment. « Voir sur le Marché » ouvre la recherche.'));
    }
  }

  // --- Bouton ---------------------------------------------------------------------------------------------------------------------------
  const ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  /** Bouton « Marché » (icône + texte). */
  function button(card) {
    const ico = el('span', { class: 'wmx-mks-ico' });
    WMX.dom.svg(ico, ICON);
    const b = el('button', { type: 'button', class: 'wmx-mks-btn', title: 'Voir si cette carte est en vente sur le Marché' }, ico, 'Marché');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(card); });
    return b;
  }

  // --- Fiche d'une carte du jeu : le bouton est ajouté sous le titre, à côté des onglets Détails / Marché / Cadre -------------------------
  const RAR = /^(L|UR|SR|R|PC|C)$/;
  /** Titre et rareté d'une fiche ouverte (racine = élément en position fixe qui porte le titre et les onglets). */
  function sheetCard(root) {
    const h = root.querySelector('h2');
    const title = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    const badge = [...root.querySelectorAll('div, span')].find((e) => !e.children.length && RAR.test(e.textContent.trim()) && e.getBoundingClientRect().top < (root.getBoundingClientRect().top + 120));
    return { title, rarity: badge ? WMX.normRarity(badge.textContent.trim()) : '' };
  }
  /** Ajoute le bouton « Marché » à une fiche ouverte dans la page du jeu. Sans effet si déjà fait. */
  function decorateSheet(root) {
    if (!root || root.querySelector('.wmx-mks-row') || onMarket()) return false;
    const tab = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Détails' && [...(b.parentElement?.children || [])].some((s) => s.textContent.trim() === 'Marché'));
    const tablist = tab?.parentElement;
    const { title, rarity } = sheetCard(root);
    if (!tablist || !title) return false;
    const row = el('div', { class: 'wmx-mks-row' }, button({ title, rarity }));
    tablist.after(row);
    return true;
  }
  const sheetRoots = () => [...document.querySelectorAll('div.fixed.inset-0')].filter((d) => d.querySelector('h2') && !d.closest('.wmx-dlg-back, .wmx-bubble, .wmx-panel, .wmx-modal-backdrop, .wmx-overlay'));
  let timer = null;
  const scan = () => { if (onMarket()) return; for (const r of sheetRoots()) decorateSheet(r); };

  WMX.register({
    name: 'market-search',
    match: /./, // la fiche d'une carte s'ouvre sur plusieurs pages ; la recherche pré-remplie se termine sur le Marché
    init() {
      new MutationObserver((muts) => { if (WMX.dom.foreign(muts)) { clearTimeout(timer); timer = setTimeout(scan, 150); } }).observe(document.body, { childList: true, subtree: true });
      // Rechargement complet vers le Marché (au lieu du routeur du jeu) : la recherche demandée est terminée ici.
      if (onMarket()) setTimeout(consumePending, 300);
    },
  });
  WMX.marketSearch = { find, open, go, fill, button, decorateSheet, sheetCard, consumePending };
})();
