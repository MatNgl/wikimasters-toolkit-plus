// Enchères : une bulle flottante (mes mises à gauche, mes ventes à droite), pour suivre ses enchères et
// surenchérir sans aller sur la page du Marché.
//
// Données : le même appel que la page Marché (GET /api/marketplace?mine=1 : `selling`, `bidding`). Actualisation chaque
// minute ; toutes les 8 s quand la bulle est ouverte. Les chronomètres tournent chaque seconde.
//
// Surenchérir : on charge la page de l'enchère dans un cadre invisible (même origine, adresse marquée #wmx-auto pour que
// la confirmation éventuelle du jeu soit validée), on lit le MINIMUM proposé par le jeu dans le champ « Montant de la
// mise » et on clique « Miser », comme l'utilisateur. On mise toujours exactement le minimum proposé.
(() => {
  const { el, sleep, waitFor } = WMX.dom;
  const D = { selling: [], bidding: [], me: null, loaded: false };
  const S = { bubble: null, bubbleOpen: false, betting: null, timer: null, lists: [], frames: new Map() };
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const cardTitle = (a) => a.card?.wikipedia_title || '?';
  const rarityOf = (a) => WMX.normRarity(a.snapshot_rarity || a.card?.rarity) || 'C';
  const leading = (a) => !!D.me && a.current_bidder_id === D.me;
  const msLeft = (a) => new Date(a.end_at).getTime() - Date.now();
  const fmtLeft = (ms) => {
    if (ms <= 0) return 'Terminée';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
  };
  const LOW_MS = 5 * 60 * 1000; // sous 5 min : chronomètre en rouge

  // --- Données ---------------------------------------------------------------------------------
  async function refresh() {
    try {
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('mine', '1');
      const res = await fetch(u);
      if (!res.ok) return;
      const j = await res.json();
      if (!D.me) { // mon identifiant : celui des enchères que j'ai gagnées, ou le vendeur de mes ventes
        const win = {};
        for (const a of j.won || []) if (a.winner_id) win[a.winner_id] = (win[a.winner_id] || 0) + 1;
        D.me = Object.entries(win).sort((x, y) => y[1] - x[1])[0]?.[0] || (j.selling || [])[0]?.seller_id || null;
      }
      D.selling = (j.selling || []).filter((a) => a.status === 'active');
      D.bidding = (j.bidding || []).filter((a) => a.status === 'active');
      D.loaded = true;
      pruneFrames();
      renderAll();
    } catch (_) { /* réseau : on garde l'affichage précédent */ }
  }

  /** Cadence : 8 s si la bulle est ouverte, sinon 1 min ; rien quand l'onglet est caché. */
  function schedulePoll() {
    clearTimeout(S.timer);
    const ms = S.bubbleOpen ? 8000 : 60000;
    S.timer = setTimeout(async () => {
      if (!WMX.alive()) return;
      if (!document.hidden) await refresh();
      schedulePoll();
    }, ms);
  }

  // --- Surenchérir -----------------------------------------------------------------------------
  const bidInput = (f) => { try { return f.contentDocument.querySelector('input[aria-label="Montant de la mise"]'); } catch (_) { return null; } };
  const bidButton = (f) => { try { return [...f.contentDocument.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Miser'); } catch (_) { return null; } };

  /** Page de l'enchère chargée (et gardée à jour par le jeu) dans un cadre invisible : le minimum y est toujours le bon. */
  function frameFor(a) {
    let f = S.frames.get(a.id);
    if (f?.isConnected) return f;
    if (S.frames.size >= 4) { // au plus 4 pages préchargées
      for (const [id, old] of S.frames) { if (id !== S.betting) { old.remove(); S.frames.delete(id); break; } }
    }
    f = el('iframe', { class: 'wmx-sheet-frame', src: `/marketplace/${a.id}#wmx-auto`, title: 'Mise', tabindex: '-1' });
    document.body.append(f);
    S.frames.set(a.id, f);
    return f;
  }
  function pruneFrames() {
    const keep = new Set(D.bidding.map((a) => a.id));
    for (const [id, f] of S.frames) if (!keep.has(id) && id !== S.betting) { f.remove(); S.frames.delete(id); }
  }
  function prepareFrames() {
    [...D.bidding].sort((a, b) => msLeft(a) - msLeft(b)).slice(0, 4).forEach(frameFor);
  }
  /** Minimum actuel proposé par le jeu pour cette enchère, ou null tant que sa page n'est pas chargée. */
  const minOf = (a) => {
    const i = S.frames.get(a.id) && bidInput(S.frames.get(a.id));
    const m = i ? Number(i.min) : NaN;
    return Number.isFinite(m) && m > 0 ? m : null;
  };

  function setNumber(input, v) {
    const w = input.ownerDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    setter.call(input, String(v));
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
  }

  async function bid(a) {
    if (S.betting) return WMX.toast('Une mise est déjà en cours…');
    if (leading(a)) return WMX.toast('Vous menez déjà cette enchère.');
    S.betting = a.id;
    renderAll();
    try {
      WMX.toast(`Mise sur « ${cardTitle(a)} »…`, 60000);
      const f = frameFor(a);
      const input = await waitFor(() => bidInput(f), 90000, 150);
      if (!input) return WMX.toast('La page de l’enchère ne s’est pas chargée.', 6000);
      const btn = bidButton(f);
      if (!btn) return WMX.toast('Bouton « Miser » introuvable sur la page de l’enchère.', 6000);
      const min = Number(input.min);
      if (!Number.isFinite(min) || min <= 0) return WMX.toast('Minimum de mise illisible : rien n’a été misé.', 6000);
      setNumber(input, min); // exactement le minimum proposé par le jeu
      await sleep(250);
      if (Number(input.value) !== min) return WMX.toast('Le montant saisi n’a pas été pris en compte : rien n’a été misé.', 6000);
      btn.click();
      await sleep(1800);
      await refresh();
      const now = D.bidding.find((x) => x.id === a.id);
      WMX.toast(now && leading(now)
        ? `Mise de ${fmt(min)} W placée sur « ${cardTitle(a)} » : vous menez.`
        : 'La mise n’est pas confirmée : solde insuffisant, ou quelqu’un a surenchéri entre-temps. Vérifiez la page de l’enchère.', 7000);
    } finally {
      S.betting = null;
      renderAll();
    }
  }

  async function cancelSale(a) {
    const item = { card_id: a.card_id, title: cardTitle(a), rarity: rarityOf(a), starred: false };
    await WMX.quick?.refresh();
    if (!WMX.quick?.cancelItem(item)) WMX.toast('Cette vente n’est plus active.');
  }

  // --- Affichage -------------------------------------------------------------------------------
  const timeEl = (a) => el('span', { class: 'wmx-auc-time', 'data-end': a.end_at }, fmtLeft(msLeft(a)));
  const rarityTag = (r) => el('span', { class: 'wmx-auc-rar', style: `color:rgb(${WMX.RARITY_RGB[r]})` }, r);

  function row(a, kind) {
    const r = rarityOf(a);
    const img = a.card?.image_url && !a.card?.hide_image
      ? el('img', { class: 'wmx-auc-img', src: a.card.image_url, alt: '', loading: 'lazy' })
      : el('div', { class: 'wmx-auc-img' });
    const title = el('strong', { title: cardTitle(a) }, cardTitle(a));
    let main, side;
    if (kind === 'bid') {
      const lead = leading(a);
      const act = el('button', { class: 'wmx-btn wmx-auc-bid', 'data-id': a.id }, 'Surenchérir');
      act.addEventListener('click', () => bid(a));
      main = el('div', { class: 'wmx-auc-main' },
        el('div', { class: 'wmx-auc-name' }, title, rarityTag(r)),
        el('span', { class: `wmx-auc-state ${lead ? 'ok' : 'ko'}` }, lead ? 'Vous menez' : 'Surenchéri'),
        timeEl(a));
      side = el('div', { class: 'wmx-auc-side' },
        el('div', { class: 'wmx-auc-price' }, el('small', {}, 'Mise actuelle'), el('b', {}, `${fmt(a.current_bid || a.base_amount)} W`)),
        act);
    } else {
      const act = a.current_bid ? '' : el('button', { class: 'wmx-btn wmx-btn--ghost wmx-auc-cancel', title: 'Annuler la vente et récupérer la carte' }, 'Annuler');
      if (act) act.addEventListener('click', () => cancelSale(a));
      main = el('div', { class: 'wmx-auc-main' },
        el('div', { class: 'wmx-auc-name' }, title, rarityTag(r)),
        a.current_bidder_id ? el('span', { class: 'wmx-auc-state ok' }, 'Mise reçue') : '',
        timeEl(a));
      side = el('div', { class: 'wmx-auc-side' },
        el('div', { class: 'wmx-auc-price' },
          a.current_bid ? el('small', {}, 'Mise actuelle') : el('small', {}, 'Prix de départ'),
          el('b', {}, `${fmt(a.current_bid || a.base_amount)} W`),
          a.current_bid ? el('small', {}, `Départ ${fmt(a.base_amount)} W`) : ''),
        act);
    }
    return el('div', { class: 'wmx-auc-row', style: `--rgb:${WMX.RARITY_RGB[r]}` }, img, main, side);
  }

  const column = (label, rows, empty) => el('div', { class: 'wmx-auc-col' }, el('h3', {}, `${label} (${rows.length})`),
    rows.length ? el('div', { class: 'wmx-auc-list' }, ...rows) : el('p', { class: 'wmx-cp-empty' }, empty));

  function content() {
    const bids = [...D.bidding].sort((a, b) => msLeft(a) - msLeft(b)).map((a) => row(a, 'bid'));
    const sells = [...D.selling].sort((a, b) => msLeft(a) - msLeft(b)).map((a) => row(a, 'sell'));
    return [column('Mes mises', bids, 'Aucune mise en cours.'), column('Mes ventes', sells, 'Aucune vente en cours.')];
  }

  function renderAll() {
    const outbid = D.bidding.filter((a) => !leading(a)).length;
    if (S.bubbleBody && S.bubbleOpen) S.bubbleBody.replaceChildren(...content());
    if (S.bubble) {
      S.pill.replaceChildren(el('span', {}, `Enchères · ${D.selling.length} vente${D.selling.length > 1 ? 's' : ''} · ${D.bidding.length} mise${D.bidding.length > 1 ? 's' : ''}`),
        outbid ? el('i', { class: 'wmx-auc-dot', title: `${outbid} enchère${outbid > 1 ? 's' : ''} où vous êtes surenchéri` }, String(outbid)) : '');
    }
    tick();
  }

  /** Chaque seconde : chronomètres, et libellé « Surenchérir · N W » avec le minimum lu sur la page de l'enchère. */
  function tick() {
    for (const t of document.querySelectorAll('.wmx-auc-time')) {
      const left = new Date(t.dataset.end).getTime() - Date.now();
      t.textContent = fmtLeft(left);
      t.classList.toggle('low', left < LOW_MS);
    }
    for (const b of document.querySelectorAll('.wmx-auc-bid')) {
      const a = D.bidding.find((x) => x.id === b.dataset.id);
      if (!a) continue;
      const m = minOf(a);
      b.textContent = S.betting === a.id ? 'Mise en cours…' : leading(a) ? 'Vous menez' : (m ? `Surenchérir · ${fmt(m)} W` : 'Surenchérir');
      b.disabled = !!S.betting || leading(a) || msLeft(a) <= 0;
    }
    if (S.bubble) S.bubble.hidden = WMX.settings?.auctionBubble === false || !D.loaded;
  }

  // --- Bulle flottante -------------------------------------------------------------------------
  function buildBubble() {
    S.pill = el('button', { class: 'wmx-bubble-pill', onclick: () => toggleBubble() });
    S.bubbleBody = el('div', { class: 'wmx-bubble-body' });
    const panel = el('div', { class: 'wmx-bubble-panel', hidden: '' },
      el('div', { class: 'wmx-bubble-head' }, el('strong', {}, 'Mes enchères'),
        el('span', {}, el('button', { class: 'wmx-qclear', title: 'Actualiser maintenant', onclick: refresh }, '↻'),
          el('button', { class: 'wmx-qclear', title: 'Réduire', onclick: () => toggleBubble(false) }, '×'))),
      S.bubbleBody);
    S.bubblePanel = panel;
    S.bubble = el('div', { class: 'wmx-bubble', hidden: '' }, panel, S.pill);
    document.body.append(S.bubble);
  }
  function toggleBubble(open = !S.bubbleOpen) {
    S.bubbleOpen = open;
    S.bubblePanel.hidden = !open;
    if (open) { renderAll(); refresh().then(prepareFrames); prepareFrames(); }
    schedulePoll();
  }

  WMX.auctions = { refresh, state: () => D };

  WMX.register({
    name: 'auctions',
    init() {
      buildBubble();
      setInterval(() => { if (WMX.alive()) tick(); }, 1000);
      setTimeout(async () => { await refresh(); schedulePoll(); }, 3000);
    },
  });
})();
