// Défausse par critères (page Collection) : bouton « Défausser… » dans la barre de la collection → fenêtre de sélection (raretés, étiquette,
// options) → fenêtre de confirmation → l'extension pilote la SÉLECTION NATIVE du jeu, page par page : « Sélectionner », « Tout sélectionner
// (page) » (ou cases une à une), vérification du compteur « N cartes sélectionnées », « Défausser », vérification de la fenêtre du jeu
// (« N × C »…) puis confirmation. Rien n'est défaussé si un nombre ne correspond pas à ce qui a été confirmé.
// Garde-fous : jamais une favorite, jamais une carte en vente ou en file d'attente ; « Essai à blanc » (coché par défaut) fait tout sauf la
// confirmation finale ; une défausse ne reprend jamais toute seule après un rechargement ; bouton « Arrêter » à tout moment.
(() => {
  const { el, sleep } = WMX.dom;
  const R = ['C', 'PC', 'R', 'SR', 'UR', 'L'];
  const NAMES = { C: 'Commune', PC: 'Peu commune', R: 'Rare', SR: 'Super rare', UR: 'Ultra rare', L: 'Légendaire' };
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const key = (s) => norm(s).toLowerCase();
  const plural = (n, w, p = `${w}s`) => `${fmt(n)} ${n > 1 ? p : w}`;
  const DEFAULTS = { rarities: ['C'], tags: [], includeTagged: false, keepOne: false, useMax: true, maxAvg: 20, keepUnpriced: true, protectSale: true, onlyNoImage: false, keepRecent: false, protectTags: [] };
  let prefs = { ...DEFAULTS };
  const savePrefs = () => WMX.store.set('discardPrefs', prefs);
  const run = { on: false, stop: false };
  const S = { tagOpen: false }; // menu des étiquettes ouvert dans la fenêtre de sélection

  // ---- quelles cartes ----
  const saleTags = () => String(WMX.settings?.autoSellTags || '').split(',').map((t) => t.trim()).filter(Boolean);
  function plan(p = prefs) {
    const items = WMX.inventory.items();
    const day = Date.now() - 24 * WMX.logic.HOUR;
    const busy = new Set(items.filter((it) => WMX.quick?.stateOf(it.card_id) && WMX.quick.stateOf(it.card_id) !== 'idle').map((it) => it.card_id));
    const recent = p.keepRecent ? items.filter((it) => it.at && new Date(it.at).getTime() > day) : [];
    const recentIds = new Set(recent.map((it) => it.card_id));
    const res = WMX.logic.discardPlan(items.filter((it) => !recentIds.has(it.card_id)), {
      rarities: p.rarities, tags: p.tags || [], includeTagged: p.includeTagged, keepOne: p.keepOne, maxAvg: p.useMax ? Number(p.maxAvg) || 0 : 0,
      unpriced: p.keepUnpriced ? 'keep' : 'discard', onlyNoImage: p.onlyNoImage, busy,
      protectTags: [...(p.protectTags || []), ...(p.protectSale ? saleTags() : [])],
      avg: (it) => WMX.prices.get(it.card_id, it.rarity)?.avg || 0, priced: (it) => WMX.prices.has(it.card_id),
    });
    const inScope = recent.filter((it) => p.rarities.includes(it.rarity)).length;
    if (inScope) res.kept.recent = inScope;
    return res;
  }
  const KEPT = { favorite: 'favorites', busy: 'en vente ou en file', protected: 'étiquette protégée', image: 'avec image', value: 'au-dessus du seuil', unpriced: 'prix jamais chargé', single: 'un seul exemplaire', recent: 'obtenues depuis moins de 24 h' };
  const keptText = (kept) => Object.entries(kept).filter(([, n]) => n).map(([k, n]) => `${fmt(n)} ${KEPT[k] || k}`).join(' · ');
  const byRarText = (byRar) => R.slice().reverse().filter((r) => byRar[r]).map((r) => `${fmt(byRar[r])} × ${r}`).join(' · ');

  // ---- petits éléments ----
  const sw = (on, onChange, label, desc) => {
    const b = el('button', { type: 'button', class: 'wmx-switch', role: 'switch', 'aria-checked': String(!!on) });
    b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange(v); });
    return el('label', { class: 'wmx-dc-opt' }, el('span', {}, el('b', {}, label), desc ? el('small', {}, desc) : ''), b);
  };
  const chip = (label, rgb, on, onToggle) => {
    const b = el('button', { type: 'button', class: 'wmx-chip2', 'aria-pressed': String(on), style: rgb ? `--rgb:${rgb}` : '' }, label);
    b.addEventListener('click', () => onToggle(b.getAttribute('aria-pressed') !== 'true'));
    return b;
  };
  function tagList() {
    const m = new Map();
    for (const it of WMX.inventory.items()) for (const t of it.tags || []) { const k = key(t.name); const e = m.get(k) || { name: norm(t.name), n: 0 }; e.n += 1; m.set(k, e); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }

  // ---- fenêtre 1 : sélection ----
  function openPicker() {
    if (document.querySelector('.wmx-dc')) return;
    if (run.on) return WMX.toast?.('Une défausse est déjà en cours.', 4000);
    if (!WMX.inventory.items().length) return WMX.toast?.('La collection est encore en cours de chargement : réessayez dans un instant.', 5000);
    const body = el('div', { class: 'wmx-pm-body' });
    const go = el('button', { class: 'wmx-btn wmx-btn--danger' }, 'Continuer');
    let unsub = null;
    const close = () => { back.remove(); unsub?.(); };
    go.addEventListener('click', () => { const pl = plan(); if (pl.copies) { close(); openConfirm(pl, { ...prefs }); } });
    const back = el('div', { class: 'wmx-dlg-back wmx-dc', onmousedown: (e) => { if (e.target === back) close(); } },
      el('div', { class: 'wmx-dlg wmx-dlg--wide', role: 'dialog', 'aria-label': 'Défausser des cartes' },
        el('h3', {}, 'Défausser des cartes'),
        el('p', { class: 'wmx-dlg-note' }, 'Choisissez les cartes à défausser. Les favorites et les cartes en vente ne sont jamais défaussées. Une confirmation vous sera demandée avant toute défausse.'),
        body,
        el('div', { class: 'wmx-dlg-row' }, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'), go)));
    function set(patch) { Object.assign(prefs, patch); savePrefs(); render(); }
    function render() {
      const items = WMX.inventory.items();
      const tags = tagList();
      // Menu déroulant à cases : une ou plusieurs étiquettes. Aucune cochée : les cartes SANS étiquette de ces raretés.
      const chosen = (prefs.tags || []).filter((x) => tags.some((t) => key(t.name) === key(x)));
      const tagBtn = el('button', { type: 'button', class: 'wmx-input wmx-select wmx-dc-tag', 'aria-haspopup': 'listbox', 'aria-expanded': String(!!S.tagOpen) },
        chosen.length ? `Étiquettes : ${chosen.join(', ')}` : 'Cartes sans étiquette (aucune étiquette choisie)');
      tagBtn.addEventListener('click', () => { S.tagOpen = !S.tagOpen; render(); });
      const tagPanel = el('div', { class: 'wmx-dc-tagpanel', role: 'listbox', 'aria-multiselectable': 'true' },
        ...(tags.length ? tags.map((t) => {
          const on = chosen.some((x) => key(x) === key(t.name));
          const box = el('input', { type: 'checkbox' }); box.checked = on;
          const row = el('label', { class: 'wmx-dc-tagrow', role: 'option', 'aria-selected': String(on) }, box, el('span', {}, t.name), el('small', {}, fmt(t.n)));
          box.addEventListener('change', () => set({ tags: box.checked ? [...chosen, t.name] : chosen.filter((x) => key(x) !== key(t.name)) }));
          return row;
        }) : [el('span', { class: 'wmx-cp-empty' }, 'Aucune étiquette dans la collection')]));
      if (!S.tagOpen) tagPanel.hidden = true;
      const maxIn = el('input', { class: 'wmx-input', type: 'number', min: '1', max: '100000', step: '1', value: String(prefs.maxAvg) });
      maxIn.addEventListener('change', () => { const v = Math.max(1, Math.round(Number(maxIn.value) || 20)); set({ maxAvg: v }); });
      const pl = plan();
      const unpricedN = pl.kept.unpriced || 0;
      const parts = [
        el('div', { class: 'wmx-dc-h' }, 'Raretés'),
        el('div', { class: 'wmx-pm-chips' }, ...R.map((r) => chip(`${r} · ${fmt(items.filter((i) => i.rarity === r).reduce((n, i) => n + (i.count || 1), 0))}`, WMX.RARITY_RGB?.[r], prefs.rarities.includes(r),
          (on) => set({ rarities: on ? [...new Set([...prefs.rarities, r])] : prefs.rarities.filter((x) => x !== r) })))),
        el('div', { class: 'wmx-dc-h' }, 'Étiquettes'),
        tagBtn, tagPanel,
      ];
      if (!chosen.length) parts.push(sw(prefs.includeTagged, (v) => set({ includeTagged: v }), 'Défausser aussi les cartes étiquetées', 'Désactivé : seules les cartes sans aucune étiquette sont concernées.'));
      if (!chosen.length && prefs.includeTagged) {
        parts.push(el('div', { class: 'wmx-dc-h' }, 'Étiquettes à protéger (jamais défaussées)'),
          el('div', { class: 'wmx-pm-chips wmx-pm-tags' }, ...(tags.length ? tags.map((t) => chip(t.name, '', (prefs.protectTags || []).some((x) => key(x) === key(t.name)),
            (on) => set({ protectTags: on ? [...(prefs.protectTags || []), t.name] : (prefs.protectTags || []).filter((x) => key(x) !== key(t.name)) })))
            : [el('span', { class: 'wmx-cp-empty' }, 'Aucune étiquette')])));
      }
      parts.push(el('div', { class: 'wmx-dc-h' }, 'Options'),
        sw(prefs.keepOne, (v) => set({ keepOne: v }), 'Garder 1 exemplaire', 'Ne défausse que les doublons : il reste toujours une carte de chaque.'),
        el('div', { class: 'wmx-dc-optrow' }, sw(prefs.useMax, (v) => set({ useMax: v }), 'Seuil de valeur', 'Ne jamais défausser une carte dont la moyenne du marché atteint ce montant (mieux vaut la vendre).'), el('span', { class: 'wmx-dc-w' }, maxIn, ' W')),
        sw(prefs.keepUnpriced, (v) => set({ keepUnpriced: v }), 'Garder les cartes au prix inconnu', `Une carte dont le prix n’a jamais été chargé est gardée (sa valeur est inconnue).${unpricedN ? ` ${plural(unpricedN, 'carte')} concernée${unpricedN > 1 ? 's' : ''} : chargez leurs prix d’abord.` : ''}`),
        sw(prefs.protectSale, (v) => set({ protectSale: v }), 'Protéger les étiquettes de vente', `Jamais une carte portant une étiquette de l’assistant de vente${saleTags().length ? ` (${saleTags().join(', ')})` : ''}.`),
        sw(prefs.onlyNoImage, (v) => set({ onlyNoImage: v }), 'Seulement les cartes sans image', 'Les cartes avec une illustration sont gardées.'),
        sw(prefs.keepRecent, (v) => set({ keepRecent: v }), 'Garder les cartes récentes', 'Obtenues depuis moins de 24 h : le temps de les regarder.'));
      if (unpricedN && prefs.keepUnpriced) parts.push(el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost', onclick: () => WMX.inventory.openPriceModal() }, 'Charger les prix…'));
      const kt = keptText(pl.kept);
      parts.push(el('div', { class: 'wmx-dc-sum', 'data-empty': String(!pl.copies) },
        el('b', {}, pl.copies ? `${plural(pl.copies, 'exemplaire')} à défausser` : (prefs.rarities.length ? 'Aucune carte ne correspond' : 'Choisissez au moins une rareté')),
        pl.copies ? el('span', {}, `${byRarText(pl.byRar)} · ${plural(pl.cards.length, 'carte')} · valeur estimée ≈ ${fmt(pl.value)} W`) : '',
        kt ? el('small', {}, `Gardées : ${kt}`) : ''));
      if (pl.cards.length) parts.push(preview(pl.cards, 40));
      body.replaceChildren(...parts);
      go.textContent = pl.copies ? `Continuer (${fmt(pl.copies)})` : 'Continuer';
      go.disabled = !pl.copies;
    }
    document.body.append(back);
    render();
    unsub = WMX.inventory.onChange?.(() => { if (back.isConnected) render(); });
  }

  function preview(cards, max) {
    const list = el('div', { class: 'wmx-dc-list' }, ...cards.slice(0, max).map((c) => el('div', { class: 'wmx-dc-row', style: `--rgb:${WMX.RARITY_RGB?.[c.rarity] || '160 175 168'}` },
      el('b', {}, c.rarity), el('span', {}, c.title), el('small', {}, `${c.copies > 1 ? `×${c.copies} · ` : ''}${c.avg ? `Moy. ${fmt(c.avg)} W` : WMX.prices.has(c.card_id) ? 'Sans vente' : 'prix inconnu'}${c.image ? '' : ' · sans image'}`))));
    if (cards.length > max) list.append(el('div', { class: 'wmx-dc-more' }, `… et ${plural(cards.length - max, 'autre carte', 'autres cartes')}`));
    return list;
  }

  // ---- fenêtre 2 : confirmation ----
  function openConfirm(pl, p) {
    let dry = true;
    let ok = false;
    let visible = false;
    const go = el('button', { class: 'wmx-btn wmx-btn--danger', disabled: '' }, '');
    const paint = () => {
      go.textContent = dry ? `Essai à blanc (${fmt(pl.copies)})` : `Défausser ${plural(pl.copies, 'exemplaire')}`;
      if (ok || dry) go.removeAttribute('disabled'); else go.setAttribute('disabled', '');
    };
    const ack = el('label', { class: 'wmx-dc-ack' }, el('input', { type: 'checkbox' }), el('span', {}, 'J’ai compris : une défausse est définitive, les cartes ne reviennent pas.'));
    ack.querySelector('input').addEventListener('change', (e) => { ok = e.target.checked; paint(); });
    const dryOpt = sw(dry, (v) => { dry = v; ack.hidden = v; paint(); }, 'Essai à blanc', 'Coche les cartes dans la sélection du jeu et vérifie la fenêtre de défausse, sans la confirmer. Désactivez pour défausser vraiment.');
    ack.hidden = true;
    const visOpt = sw(visible, (v) => { visible = v; }, 'Mode visible', 'Pilote la page Collection affichée, sous vos yeux (pour les premiers essais). Désactivé : la défausse se fait dans une page invisible, vous pouvez continuer à naviguer.');
    const close = () => back.remove();
    go.addEventListener('click', () => { if (!dry && !ok) return; close(); start(pl, { dry, visible }); });
    const filters = [p.rarities.map((r) => NAMES[r]).join(', '), (p.tags || []).length ? `étiquette${p.tags.length > 1 ? 's' : ''} ${p.tags.join(', ')}` : p.includeTagged ? 'étiquetées comprises' : 'sans étiquette',
      p.keepOne && '1 exemplaire gardé', p.useMax && `gardées dès ${p.maxAvg} W`, p.keepUnpriced && 'prix inconnu gardé', p.protectSale && 'étiquettes de vente protégées', p.onlyNoImage && 'sans image seulement', p.keepRecent && 'récentes gardées'].filter(Boolean);
    const back = el('div', { class: 'wmx-dlg-back wmx-dc', onmousedown: (e) => { if (e.target === back) close(); } },
      el('div', { class: 'wmx-dlg wmx-dlg--wide', role: 'alertdialog', 'aria-label': 'Confirmer la défausse' },
        el('h3', {}, `Défausser ${plural(pl.copies, 'exemplaire')} ?`),
        el('div', { class: 'wmx-dc-sum' }, el('b', {}, byRarText(pl.byRar)), el('span', {}, `${plural(pl.cards.length, 'carte')} · valeur estimée ≈ ${fmt(pl.value)} W`), el('small', {}, filters.join(' · '))),
        preview(pl.cards, 500),
        dryOpt, ack, visOpt,
        el('p', { class: 'wmx-dlg-note' }, 'L’extension utilise la sélection du jeu sur la page Collection, page par page, et affiche sa progression en bas de l’écran. Ne rechargez pas l’onglet pendant la défausse. Elle s’arrête dès qu’un nombre affiché par le jeu ne correspond pas à cette liste.'),
        el('div', { class: 'wmx-dlg-row' }, el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { close(); openPicker(); } }, 'Modifier'), go)));
    paint();
    document.body.append(back);
  }

  // ---- pilotage de la sélection native du jeu ----
  // Tout ce qui dépend de la page du jeu est ici (d'après la page observée : vue Collection, mode « Sélectionner », 50 cartes par page, liste
  // virtualisée, case à cocher dans le coin haut droit de la carte, compteur « N cartes sélectionnées », « Défausser », fenêtre « N × C »,
  // message « N cartes défaussées », « Suivant → »).
  const KEEP_MAX = 30; // cartes gardées sur une page au-delà desquelles on passe à la page suivante (défausse plus efficace)
  // Page pilotée : la page Collection affichée (mode visible) ou une page Collection invisible (arrière-plan, par défaut).
  let D = document;
  let W = window;
  const pageText = () => (D.body ? (D.body.innerText ?? D.body.textContent ?? '') : '');
  const NATIVE = {
    buttons: () => [...D.querySelectorAll('button, [role=button], a')].filter((b) => !b.closest('.wmx-dc, .wmx-dc-run, .wmx-bubble, .wmx-modal-backdrop')),
    btn: (re) => NATIVE.buttons().find((b) => re.test(norm(b.textContent)) && !b.disabled && b.getAttribute('aria-disabled') !== 'true'),
    select: () => NATIVE.btn(/^Sélectionner$/i),
    selectAll: () => NATIVE.btn(/^Tout sélectionner/i),
    quit: () => NATIVE.btn(/^Quitter la sélection/i),
    discard: () => NATIVE.btn(/^Défausser/i),
    next: () => NATIVE.btn(/^Suivant/i),
    prev: () => NATIVE.btn(/^(←\s*)?Précédent/i),
    count() { const m = /(\d[\d\s ]*)\s+cartes?\s+sélectionnées?/i.exec(pageText()); return m ? Number(m[1].replace(/\D/g, '')) : (NATIVE.quit() ? 0 : null); },
    cards: () => [...D.querySelectorAll('main h3')].map((h3) => h3.closest('[class*="rounded-2xl"]')).filter((c) => c && !c.closest('.wmx-dc, .wmx-dc-run, [role=dialog]')),
    read(card) {
      const title = norm(card.querySelector('h3')?.textContent);
      const rarity = WMX.normRarity(norm(card.querySelector('div.absolute.top-2.left-2')?.textContent)) || '';
      return title && rarity ? { title, rarity, item: WMX.inventory.find(title, rarity) } : null;
    },
    dialog: () => [...D.querySelectorAll('[role=dialog], [role=alertdialog]')].find((d) => !d.closest('.wmx-dc, .wmx-dc-run') && /défauss/i.test(d.textContent)),
    /** « 12 × C · 3 × PC » lu dans la fenêtre de défausse du jeu. */
    dialogCounts(d) { const out = {}; for (const m of String(d.innerText || d.textContent).matchAll(/(\d+)\s*[×x]\s*(L|UR|SR|PC|R|C)\b/g)) out[m[2]] = (out[m[2]] || 0) + Number(m[1]); return out; },
    done: () => /(\d+)\s+cartes?\s+défaussées?/i.exec(pageText()),
  };
  /** Clic « comme une souris » : les clics JavaScript simples ne cochent pas les cartes du jeu. */
  function press(node, x, y) {
    const o = { bubbles: true, cancelable: true, view: W, clientX: x, clientY: y, button: 0 };
    const Ptr = W.PointerEvent || W.MouseEvent;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) node.dispatchEvent(new (t.startsWith('pointer') ? Ptr : W.MouseEvent)(t, o));
  }
  const waitFor = async (fn, ms, step = 150) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
  /** Coche ou décoche une carte (case du coin haut droit) ; vérifie que le compteur bouge de 1. */
  async function toggleCard(card, delta) {
    card.scrollIntoView?.({ block: 'center' });
    await sleep(120);
    const r = card.getBoundingClientRect();
    const x = r.right - 17; const y = r.top + 17;
    const target = D.elementFromPoint?.(x, y) || card;
    if (target.closest('.wmx-nt-bolt, .wmx-nt-price, input, a[href*="wikipedia"]')) return false; // jamais le ⚡ ni le lien Wikipédia
    const before = NATIVE.count();
    press(target, x, y);
    return !!(await waitFor(() => { const n = NATIVE.count(); return n != null && before != null && n === before + delta; }, 1500, 120));
  }
  /** Parcourt la page affichée (liste virtualisée : par paliers) et rend les cartes vues, dans l'ordre. */
  async function scanPage() {
    const seen = new Map();
    const scroller = D.scrollingElement || D.documentElement;
    scroller.scrollTo?.(0, 0);
    await sleep(200);
    for (let i = 0; i < 60; i++) {
      for (const c of NATIVE.cards()) { const info = NATIVE.read(c); if (info && !seen.has(`${info.title}|${info.rarity}`)) seen.set(`${info.title}|${info.rarity}`, info); }
      const atEnd = scroller.scrollTop + W.innerHeight >= scroller.scrollHeight - 4;
      if (atEnd) break;
      scroller.scrollBy?.(0, 300);
      await sleep(160);
    }
    return [...seen.values()];
  }
  const findCard = (k) => NATIVE.cards().find((c) => { const i = NATIVE.read(c); return i && `${i.title}|${i.rarity}` === k; });
  /** Amène une carte de la page à l'écran (liste virtualisée) puis la coche ou la décoche. */
  async function toggleByKey(k, delta) {
    const scroller = D.scrollingElement || D.documentElement;
    let card = findCard(k);
    for (let y = 0; !card && y < scroller.scrollHeight; y += 300) { scroller.scrollTo?.(0, y); await sleep(140); card = findCard(k); }
    if (!card) return false;
    if (await toggleCard(card, delta)) return true;
    await sleep(400);
    return NATIVE.count() != null && (await toggleCard(card, delta)); // un clic peut rater : un seul nouvel essai, vérifié par le compteur
  }

  // ---- déroulé ----
  let panel = null;
  /** Fenêtre de progression (page principale) : « 120 / 340 exemplaires », étape en cours, « Arrêter » / « Afficher ». */
  function showRun(text, kind = 'ok') {
    if (!panel?.isConnected) {
      const peek = el('button', { class: 'wmx-btn wmx-btn--ghost wmx-dc-peek', title: 'Montrer ou cacher la page Collection où travaille l’extension' }, 'Afficher');
      peek.addEventListener('click', () => { const f = run.frame; if (!f) return; const on = !f.classList.contains('wmx-on'); f.classList.toggle('wmx-on', on); f.classList.toggle('wmx-dc-peek-on', on); peek.textContent = on ? 'Masquer' : 'Afficher'; });
      panel = el('div', { class: 'wmx-dc-run', role: 'status' },
        el('div', { class: 'wmx-dc-run-head' }, el('b', { class: 'wmx-dc-run-title' }, 'Défausse'), el('span', { class: 'wmx-dc-run-num' }), el('span', { class: 'wmx-dc-run-sp' }), peek,
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { if (!run.on) { panel.remove(); return; } run.stop = true; showRun('arrêt demandé : fin de l’étape en cours…', 'warn'); } }, 'Arrêter')),
        el('div', { class: 'wmx-dc-run-bar' }, el('i')),
        el('span', { class: 'wmx-dc-run-txt' }));
      document.body.append(WMX.dom.keepAttached ? WMX.dom.keepAttached(panel) : panel);
    }
    const pr = run.prog || { done: 0, total: 0 };
    panel.dataset.kind = kind;
    panel.querySelector('.wmx-dc-run-title').textContent = `${run.dry ? 'Essai à blanc' : 'Défausse'}${run.frame ? ' en arrière-plan' : ''}`;
    panel.querySelector('.wmx-dc-run-num').textContent = pr.total ? `${fmt(pr.done)} / ${fmt(pr.total)} exemplaires ${run.dry ? 'vérifiés' : 'défaussés'}` : '';
    panel.querySelector('.wmx-dc-run-bar i').style.width = `${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%`;
    panel.querySelector('.wmx-dc-peek').hidden = !run.frame;
    panel.querySelector('.wmx-dc-run-txt').textContent = text;
    panel.querySelector('.wmx-dc-run-head .wmx-btn:last-child').textContent = run.on ? 'Arrêter' : 'Fermer';
  }
  /** Page Collection invisible (arrière-plan) : remplacée dans les essais par une fausse page. */
  async function openFrame() {
    const f = el('iframe', { class: 'wmx-sheet-frame wmx-dc-frame', src: '/collection#wmx-discard', title: 'Défausse', tabindex: '-1' }); // pas #wmx-auto : aucune confirmation n'est acceptée d'office
    document.body.append(f);
    const ready = await waitFor(() => { try { return f.contentDocument?.readyState === 'complete' && f.contentDocument.querySelector('main h3') ? f : null; } catch (_) { return null; } }, 45000, 300);
    if (!ready) { f.remove(); return null; }
    return { d: f.contentDocument, w: f.contentWindow, frame: f, remove: () => f.remove() };
  }
  /** Vérification humaine du jeu dans la page invisible : on la montre au centre de l'écran et on attend qu'elle soit faite. */
  async function humanGate() {
    if (!run.frame || !/vérification rapide/i.test(pageText())) return true;
    run.frame.classList.add('wmx-on', 'wmx-human');
    showRun('le jeu demande une vérification rapide : faites-la dans la fenêtre affichée, la défausse reprend ensuite.', 'warn');
    const ok = await waitFor(() => run.stop || !/vérification rapide/i.test(pageText()), 5 * 60000, 500);
    run.frame.classList.remove('wmx-on', 'wmx-human');
    return !!ok && !run.stop;
  }
  async function start(pl, { dry, visible = false }) {
    if (run.on) return;
    if (visible && !/^\/collection\/?$/.test(location.pathname)) return WMX.toast?.('Mode visible : ouvrez la page Collection pour lancer la défausse.', 5000);
    run.on = true; run.stop = false; run.dry = dry; run.prog = { done: 0, total: pl.copies }; run.frame = null;
    let ctx = null;
    if (visible) { D = document; W = window; } else {
      showRun('préparation de la page Collection en arrière-plan…');
      ctx = await (WMX.discard.frameFactory || openFrame)();
      if (!ctx) { run.on = false; showRun('la page Collection n’a pas pu être préparée en arrière-plan (jeu lent ?) : rien n’a été défaussé. Réessayez, ou utilisez le mode visible.', 'warn'); return; }
      D = ctx.d; W = ctx.w; run.frame = ctx.frame || null;
    }
    // Copies restantes par carte (clé titre|rareté, comme la page du jeu les affiche).
    const left = new Map(pl.cards.map((c) => [`${norm(c.title)}|${c.rarity}`, { ...c }]));
    const stats = { copies: 0, rounds: 0, reward: 0 };
    const label = dry ? 'Essai à blanc' : 'Défausse';
    const finish = (text, kind = 'ok') => {
      run.on = false;
      const c = ctx; ctx = null;
      setTimeout(() => c?.remove?.(), 1500); // page invisible retirée (après la dernière réponse du jeu)
      D = document; W = window;
      run.prog.done = stats.copies;
      showRun(text, kind);
      run.frame = null;
      WMX.journal?.add('Défausse', text, kind === 'ok' ? undefined : 'warn');
      WMX.notify?.({ kind: kind === 'ok' ? 'info' : 'warn', key: 'discard', ms: 12000, title: kind === 'ok' ? `${label} terminée` : `${label} arrêtée`, text });
      setTimeout(() => { if (!run.on) panel?.remove(); }, 30000);
    };
    try {
      WMX.journal?.add('Défausse', `${label} lancée : ${plural(pl.copies, 'exemplaire')} (${byRarText(pl.byRar)})`);
      showRun('ouverture de la sélection du jeu…');
      if (!NATIVE.quit()) {
        const b = await waitFor(NATIVE.select, 8000);
        if (!b) return finish('bouton « Sélectionner » du jeu introuvable sur la page Collection : rien n’a été défaussé.', 'warn');
        b.click();
        if (!(await waitFor(() => NATIVE.count() === 0, 5000))) return finish('le mode sélection du jeu ne s’est pas ouvert : rien n’a été défaussé.', 'warn');
      } else if (NATIVE.count() !== 0) return finish('une sélection est déjà en cours sur la page : videz-la (« Quitter la sélection ») puis relancez.', 'warn');
      // On part de la première page (une passe précédente a pu s'arrêter plus loin).
      const goFirst = async () => { for (let i = 0; i < 300 && NATIVE.prev(); i++) { NATIVE.prev().click(); await sleep(600); await waitFor(() => NATIVE.cards().length, 15000); } };
      await goFirst();
      let page = 1;
      // Page suivante ; arrivé au bout, un nouveau passage depuis la page 1 rattrape les cartes remontées d'une page à l'autre après une défausse
      // (au plus 3 passages, et seulement si le précédent a défaussé quelque chose).
      let sweeps = 0;
      let sweepFrom = 0;
      const advance = async () => {
        const nx = NATIVE.next();
        if (nx) { nx.click(); page += 1; await sleep(1500); await waitFor(() => NATIVE.cards().length, 15000); return true; }
        if (dry || sweeps >= 3 || stats.copies === sweepFrom || ![...left.values()].some((c) => c.copies > 0)) return false;
        sweeps += 1; sweepFrom = stats.copies;
        showRun(`retour à la page 1 : cartes restantes à rattraper (passage ${sweeps + 1})…`);
        await goFirst(); page = 1;
        return true;
      };
      for (let guard = 0; guard < 400; guard++) {
        if (run.stop) return finish(`arrêtée à votre demande : ${plural(stats.copies, 'exemplaire')} ${dry ? 'vérifié' : 'défaussé'}${stats.copies > 1 ? 's' : ''}.`, 'warn');
        if (![...left.values()].some((c) => c.copies > 0)) break;
        if (run.frame && !run.frame.isConnected) return finish(`la page en arrière-plan a été fermée : ${plural(stats.copies, 'exemplaire')} ${dry ? 'vérifié' : 'défaussé'}${stats.copies > 1 ? 's' : ''}.`, 'warn');
        if (!(await humanGate())) return abort('la vérification du jeu n’a pas été faite : arrêtée.');
        run.prog.done = stats.copies;
        showRun(`page ${page} : lecture des cartes…`);
        const seen = await scanPage();
        const targets = seen.filter((s) => left.get(`${s.title}|${s.rarity}`)?.copies > 0);
        if (!targets.length) {
          if (!(await advance())) break;
          continue;
        }
        // Cocher : « Tout sélectionner (page) » puis décocher les autres si la page est surtout à défausser, sinon carte par carte.
        showRun(`page ${page} : sélection de ${plural(targets.length, 'carte')}…`);
        const tkeys = new Set(targets.map((t) => `${t.title}|${t.rarity}`));
        const all = NATIVE.selectAll();
        const usedAll = !!all && targets.length > seen.length / 2;
        if (usedAll) {
          all.click();
          if (!(await waitFor(() => NATIVE.count() >= targets.length, 6000))) return finish(`page ${page} : « Tout sélectionner » n’a pas coché les cartes. Rien n’a été défaussé sur cette page.`, 'warn');
          for (const s of seen) {
            const k = `${s.title}|${s.rarity}`;
            if (tkeys.has(k)) continue;
            if (s.item?.starred) continue; // favorite cochée par « Tout sélectionner » : le jeu ne la défausse jamais, inutile de la décocher
            if (run.stop) break;
            if (!(await toggleByKey(k, -1))) return abort(`page ${page} : impossible de décocher « ${s.title} ». Rien n’a été défaussé sur cette page.`);
          }
        } else {
          for (const t of targets) {
            if (run.stop) break;
            if (!(await toggleByKey(`${t.title}|${t.rarity}`, 1))) return abort(`page ${page} : impossible de cocher « ${t.title} ». Rien n’a été défaussé sur cette page.`);
          }
        }
        if (run.stop) return abort(`arrêtée à votre demande : ${plural(stats.copies, 'exemplaire')} ${dry ? 'vérifié' : 'défaussé'}${stats.copies > 1 ? 's' : ''}.`);
        // Compteur du jeu : les cartes prévues, plus éventuellement les favorites laissées cochées par « Tout sélectionner » (le jeu les omet à la défausse ;
        // la fenêtre de défausse, vérifiée ensuite, le confirme : sinon rien n'est défaussé).
        const n = NATIVE.count();
        const favs = usedAll ? seen.filter((x) => x.item?.starred && !tkeys.has(`${x.title}|${x.rarity}`)).length : 0;
        if (n !== targets.length && n !== targets.length + favs) return abort(`page ${page} : le jeu compte ${n ?? '?'} carte(s) sélectionnée(s) au lieu de ${targets.length}${favs ? ` (ou ${targets.length + favs} avec les favorites)` : ''}. Rien n’a été défaussé sur cette page.`);
        // Fenêtre de défausse du jeu : une carte cochée = UN exemplaire défaussé (constaté : une carte en ×2 n'en perd qu'un). Les nombres par rareté
        // doivent donc être exactement le nombre de cartes cochées ; une carte qui doit perdre plusieurs exemplaires est recochée au passage suivant.
        const want = {};
        for (const t of targets) want[t.rarity] = (want[t.rarity] || 0) + 1;
        const db = NATIVE.discard();
        if (!db) return abort(`page ${page} : bouton « Défausser » du jeu introuvable. Rien n’a été défaussé.`);
        const reward = Number((/\+\s*(\d[\d\s ]*)/.exec(norm(db.textContent)) || [])[1]?.replace(/\D/g, '') || 0);
        db.click();
        const dlg = await waitFor(NATIVE.dialog, 6000);
        if (!dlg) return abort(`page ${page} : la fenêtre de défausse du jeu ne s’est pas ouverte. Rien n’a été défaussé.`);
        const got = NATIVE.dialogCounts(dlg);
        const same = R.every((r) => (got[r] || 0) === (want[r] || 0));
        if (!same) {
          cancelDialog(dlg);
          return abort(`page ${page} : le jeu s’apprête à défausser ${byRarText(got) || '?'} au lieu de ${byRarText(want)}. Rien n’a été défaussé.`);
        }
        if (dry) {
          cancelDialog(dlg);
          for (const t of targets) { const c = left.get(`${t.title}|${t.rarity}`); stats.copies += c.copies; c.copies = 0; } // vérifiées (exemplaires suivants compris) : on passe à la suite
          await clearSelection();
          if (!(await advance())) break;
          continue;
        }
        const confirm = [...dlg.querySelectorAll('button')].reverse().find((b) => /^(Défausser|Confirmer|Oui|Valider)/i.test(norm(b.textContent)) && !b.disabled);
        if (!confirm) { cancelDialog(dlg); return abort(`page ${page} : bouton de confirmation du jeu introuvable. Rien n’a été défaussé.`); }
        showRun(`page ${page} : défausse de ${byRarText(want)}…`);
        confirm.click();
        const ok = await waitFor(() => !dlg.isConnected && NATIVE.done(), 20000, 200);
        if (!ok) return finish(`page ${page} : le jeu n’a pas confirmé la défausse (vérifiez votre collection). ${plural(stats.copies, 'exemplaire')} défaussé${stats.copies > 1 ? 's' : ''} avant.`, 'warn');
        stats.copies += targets.length;
        stats.reward += reward; stats.rounds += 1;
        for (const t of targets) {
          const c = left.get(`${t.title}|${t.rarity}`);
          window.dispatchEvent(new CustomEvent('wmx:discard', { detail: { card_id: c.card_id } })); // inventaire de l'extension (page principale) : un exemplaire de moins
          c.copies -= 1; // d'autres exemplaires à défausser : la carte est recochée au passage suivant
        }
        await sleep(1500); // le jeu recharge la page : les cartes suivantes remontent
        await waitFor(() => NATIVE.cards().length, 15000);
        if (NATIVE.count() == null) { const b = await waitFor(NATIVE.select, 5000); b?.click(); await waitFor(() => NATIVE.count() === 0, 5000); }
        // Cartes gardées (favorites, étiquetées, options) restées sur cette page : à partir de 30, elle ne laisserait plus que quelques places
        // aux cartes à défausser à chaque passe ; on passe à la page suivante (les cartes remontées seront rattrapées au passage suivant).
        if (seen.length - targets.length >= KEEP_MAX) { showRun(`page ${page} : ${seen.length - targets.length} cartes gardées sur la page, passage à la suivante…`); if (!(await advance())) break; }
      }
      const missing = [...left.values()].filter((c) => c.copies > 0);
      await clearSelection(true);
      const tail = missing.length ? ` · ${plural(missing.length, 'carte')} non trouvée${missing.length > 1 ? 's' : ''} sur les pages parcourues` : '';
      return finish(dry ? `essai réussi : ${plural(stats.copies, 'exemplaire')} coché${stats.copies > 1 ? 's' : ''} et vérifié${stats.copies > 1 ? 's' : ''}, rien n’a été défaussé${tail}. Relancez sans « Essai à blanc » pour défausser.`
        : `${plural(stats.copies, 'exemplaire')} défaussé${stats.copies > 1 ? 's' : ''}${stats.reward ? ` (+${fmt(stats.reward)})` : ''}${tail}.`);
    } catch (e) {
      console.warn('[WMX] défausse', e);
      return finish(`erreur inattendue (${e?.message || e}) : arrêtée.`, 'warn');
    }
    async function abort(text) { await clearSelection(true); return finish(text, 'warn'); }
  }
  function cancelDialog(dlg) {
    const b = [...dlg.querySelectorAll('button')].find((x) => /^(Annuler|Fermer|Non)$/i.test(norm(x.textContent)) || /fermer/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click(); else dlg.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  /** Vide la sélection (« Quitter la sélection » puis, si demandé, rien d'autre ; sinon on la rouvre pour la page suivante). */
  async function clearSelection(leave = false) {
    await sleep(300);
    const q = NATIVE.quit();
    if (q) { q.click(); await waitFor(() => !NATIVE.quit(), 4000); }
    if (leave) return;
    const s = await waitFor(NATIVE.select, 4000);
    if (s) { s.click(); await waitFor(() => NATIVE.count() === 0, 4000); }
  }

  /** Bouton de la barre de la collection. */
  function button() {
    return el('button', { class: 'wmx-btn wmx-btn--ghost wmx-dc-open', type: 'button', title: 'Défausser des cartes par rareté, étiquette et options (confirmation demandée)', onclick: () => WMX.inventory.ensure().then(openPicker) }, 'Défausser…');
  }

  WMX.register({
    name: 'discard',
    match: /^\/collection\/?$/,
    async init() {
      prefs = { ...DEFAULTS, ...(await WMX.store.get('discardPrefs', {})) };
      if (prefs.tag && !(prefs.tags || []).length) prefs.tags = [prefs.tag]; // ancien réglage (une seule étiquette)
      delete prefs.tag;
    },
  });
  WMX.discard = { button, openPicker, plan, start, native: NATIVE, frameFactory: null, isRunning: () => run.on, stop: () => { run.stop = true; } };
})();
