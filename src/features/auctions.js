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
  const msLeftById = (id) => { const a = D.bidding.find((x) => x.id === id); return a ? msLeft(a) : 9e9; };
  const { fmtLeft, timeState } = WMX.logic; // sous 5 min : chronomètre rouge ; sous 2 min : alerte
  S.auto = {};                              // mises automatiques : { idEnchère: règle } (mémorisées)
  S.autoTry = {};                           // dernier essai de mise automatique par enchère
  S.autoFails = {};
  S.autoLast = {};                          // dernière mise par enchère : { bid: mise avant la mienne, t }
  S.bidQueue = [];
  S.draft = {};      // réglages de mise automatique en cours de saisie (gardés si la liste se redessine)
  S.autoSeen = null; // identifiants des mises déjà vues (les réglages par défaut ne s'appliquent qu'aux NOUVELLES mises)
  S.autoOpen = null;                        // enchère dont le formulaire de mise automatique est ouvert
  const saveAuto = () => WMX.store.set('autoBids', S.auto);
  const notified = new Set();               // alertes déjà envoyées (une seule fois chacune)

  // --- Alertes ----------------------------------------------------------------------------
  /** Message dans la page + notification du navigateur (si autorisée et activée dans les paramètres). */
  function alertUser(title, body, tag) {
    WMX.toast?.(`${title} — ${body}`, 9000);
    try {
      if (WMX.settings?.auctionNotify !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, tag });
      }
    } catch (_) { /* notification indisponible */ }
  }
  /** Nouvelle surenchère d'un autre joueur sur une enchère où je misais (au premier chargement, on ne fait que mémoriser). */
  function checkOutbid(first) {
    for (const a of D.bidding) {
      if (leading(a)) continue;
      const key = `${a.id}:out:${a.current_bid}`;
      if (notified.has(key)) continue;
      notified.add(key);
      if (!first) alertUser('Vous êtes surenchéri', `« ${cardTitle(a)} » : ${fmt(a.current_bid)} W`, key);
    }
  }
  /** Chaque seconde : une enchère (mise ou vente) qui passe sous 2 minutes déclenche une alerte unique. */
  function checkUrgent() {
    for (const [list, who] of [[D.bidding, 'Votre mise'], [D.selling, 'Votre vente']]) {
      for (const a of list) {
        if (timeState(msLeft(a)) !== 'urgent') continue;
        const key = `${a.id}:urgent`;
        if (notified.has(key)) continue;
        notified.add(key);
        alertUser('Enchère bientôt terminée', `${who} « ${cardTitle(a)} » se termine dans moins de 2 minutes.`, key);
      }
    }
  }
  /**
   * Bouton rond à côté de la barre latérale : l'anneau montre le temps restant de l'enchère (mise ou vente) qui se termine
   * le plus tôt, du vert (au moins 1 h) au rouge (fin imminente) ; au centre le nombre de mises et de ventes ; un point rouge
   * signale les enchères où l'on est surenchéri, ⚠ celles qui finissent dans moins de 2 minutes.
   */
  const RING = 2 * Math.PI * 30;
  function updatePill() {
    if (!S.pill) return;
    if (!D.loaded) { // premier chargement en cours (jeu lent) : la pastille est déjà là, sans chiffres trompeurs
      S.dialRing.style.stroke = '#3a4a43';
      S.dialBids.textContent = '…'; S.dialSales.textContent = '';
      S.pill.title = 'Mes enchères : chargement…';
      return;
    }
    const all = [...liveBids(), ...liveSales()];
    const lefts = all.map(msLeft).filter((x) => x > 0);
    const nearest = lefts.length ? Math.min(...lefts) : null;
    const frac = nearest == null ? 0 : WMX.logic.ringFraction(nearest);
    S.dialRing.style.strokeDashoffset = String(RING * (1 - frac));
    S.dialRing.style.stroke = nearest == null ? '#3a4a43' : WMX.logic.ringColor(frac);
    const urgent = all.filter((x) => timeState(msLeft(x)) === 'urgent').length;
    const outbid = liveBids().filter((x) => !leading(x)).length;
    S.dialBids.textContent = `${liveBids().length} mise${liveBids().length > 1 ? 's' : ''}`;
    S.dialSales.textContent = `${liveSales().length} vente${liveSales().length > 1 ? 's' : ''}`;
    S.dialOut.hidden = !outbid; S.dialOut.textContent = String(outbid);
    S.dialOut.title = `${outbid} enchère${outbid > 1 ? 's' : ''} où vous êtes surenchéri`;
    S.dialWarn.hidden = !urgent; S.dialWarn.textContent = '⚠';
    S.dialWarn.title = `${urgent} enchère${urgent > 1 ? 's' : ''} se termine${urgent > 1 ? 'nt' : ''} dans moins de 2 minutes`;
    S.pill.classList.toggle('alert', urgent > 0 || outbid > 0);
    S.pill.title = nearest == null ? 'Mes enchères' : `Mes enchères · la plus proche se termine dans ${fmtLeft(nearest)}`;
  }

  /** Réglages par défaut (Paramètres → Mises automatiques) sous forme de saisie pour parseAutoRule. */
  const defaultInput = () => {
    const s = WMX.settings || {};
    return { mode: s.autoDefaultMode === 'outbid' ? 'outbid' : 'time', amount: Number(s.autoDefaultSecs) || 35, unit: 's',
      capMode: ['abs', 'none', 'avg'].includes(s.autoCapMode) ? s.autoCapMode : 'avg', cap: Number(s.autoCapW) || 100,
      capPct: Number.isFinite(Number(s.autoCapPct)) ? Number(s.autoCapPct) : 20 };
  };
  /** « Appliquer aux nouvelles mises » : une mise qu'on n'avait jamais vue reçoit la règle par défaut (jamais celles déjà présentes). */
  function applyDefaults(first) {
    const ids = D.bidding.map((x) => x.id);
    if (!S.autoSeen) S.autoSeen = new Set(ids); // première lecture : tout ce qui existe déjà est « déjà vu »
    if (WMX.settings?.autoDefaultOn && !first) {
      for (const x of D.bidding) {
        if (S.autoSeen.has(x.id) || S.auto[x.id]) continue;
        const rule = WMX.logic.parseAutoRule(defaultInput());
        if (rule) { S.auto[x.id] = rule; S.autoFails[x.id] = 0; saveAuto(); }
      }
    }
    ids.forEach((id) => S.autoSeen.add(id));
  }

  // --- Données ---------------------------------------------------------------------------------
  async function refresh() {
    try {
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('mine', '1');
      const res = await fetch(u);
      if (!res.ok) {
        S.fails = (S.fails || 0) + 1;
        if (S.fails === 3) WMX.reportError?.('enchères', res.status);
        return;
      }
      const j = await res.json();
      if (!D.me) { // mon identifiant : celui des enchères que j'ai gagnées, ou le vendeur de mes ventes
        const win = {};
        for (const a of j.won || []) if (a.winner_id) win[a.winner_id] = (win[a.winner_id] || 0) + 1;
        D.me = Object.entries(win).sort((x, y) => y[1] - x[1])[0]?.[0] || (j.selling || [])[0]?.seller_id || null;
      }
      D.selling = (j.selling || []).filter((a) => a.status === 'active');
      D.bidding = (j.bidding || []).filter((a) => a.status === 'active');
      const first = !D.loaded;
      D.loaded = true;
      checkOutbid(first);
      applyDefaults(first);
      let dirty = false;
      for (const id of Object.keys(S.auto)) if (!D.bidding.some((x) => x.id === id)) { delete S.auto[id]; delete S.autoTry[id]; dirty = true; } // enchère terminée
      if (dirty) saveAuto();
      for (const id of Object.keys(S.auto)) { const x = D.bidding.find((b) => b.id === id); if (x) frameFor(x); } // page prête à l'avance : miser sans attendre
      pruneFrames();
      renderAll();
      window.dispatchEvent(new CustomEvent('wmx:bids'));
      S.fails = 0;
    } catch (err) { // réseau : on garde l'affichage précédent, et on prévient après plusieurs échecs de suite
      S.fails = (S.fails || 0) + 1;
      if (S.fails === 3) WMX.reportError?.('enchères', 0, String(err?.message || err));
    }
  }

  /** Cadence : 8 s si la bulle est ouverte, sinon 1 min ; rien quand l'onglet est caché. */
  function schedulePoll() {
    clearTimeout(S.timer);
    const fast = WMX.logic.autoPollMs(Object.entries(S.auto).map(([id, rule]) => ({ rule, msLeft: msLeftById(id) })));
    const nearEnd = [...D.bidding, ...D.selling].some((x) => msLeft(x) < 12000 && msLeft(x) > -GRACE_MS);
    const ms = fast || (nearEnd ? 3000 : (S.bubbleOpen ? 8000 : 60000));
    S.timer = setTimeout(async () => {
      if (!WMX.alive()) return;
      if (!document.hidden || Object.keys(S.auto).length) await refresh(); // une mise automatique doit voir l'enchère même onglet masqué
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

  /** État réel d'une enchère (GET /api/marketplace/{id}) : meneur actuel, mise, statut. null si illisible. */
  async function liveState(id) {
    try {
      const res = await fetch(`/api/marketplace/${id}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const j = (await res.json())?.auction;
      return j ? { bidder: j.current_bidder_id || null, bid: j.current_bid || 0, status: j.status } : null;
    } catch (_) { return null; }
  }

  /**
   * Plusieurs onglets du jeu peuvent être ouverts : un verrou commun à tous les onglets (Web Locks) fait qu'une seule mise à la fois
   * est vérifiée et passée par enchère. Le second onglet voit alors qu'on mène déjà et ne mise pas par-dessus soi-même.
   */
  const withLock = (name, fn) => (navigator.locks?.request ? navigator.locks.request(name, fn) : fn());
  const bid = (a, opts = {}) => withLock(`wmx-bid-${a.id}`, () => bidInner(a, opts));
  async function bidInner(a, opts = {}) {
    if (!D.me) await refresh(); // sans mon identifiant, on ne sait pas qui mène : pas de mise
    if (!D.me) return opts.auto ? undefined : WMX.toast('Identifiant introuvable : actualisez la page puis réessayez.', 5000);
    if (S.betting) return opts.auto ? undefined : WMX.toast('Une mise est déjà en cours…');
    if (leading(a)) return opts.auto ? undefined : WMX.toast('Vous menez déjà cette enchère.');
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
      if (opts.cap && min > opts.cap) { // plafond de la mise automatique dépassé : on s'arrête
        delete S.auto[a.id]; saveAuto();
        alertUser('Mise automatique arrêtée', `« ${cardTitle(a)} » : le minimum (${fmt(min)} W) dépasse votre plafond de ${fmt(opts.cap)} W.`, `${a.id}:cap`);
        return;
      }
      // Dernier contrôle, sur l'état RÉEL de l'enchère (pas sur la liste, parfois en retard) : jamais de surenchère sur soi-même.
      const live = await liveState(a.id);
      if (live && live.status && live.status !== 'active') return opts.auto ? undefined : WMX.toast('Cette enchère est terminée.', 5000);
      if (live && D.me && live.bidder === D.me) return opts.auto ? undefined : WMX.toast('Vous menez déjà cette enchère.', 4000);
      setNumber(input, min); // exactement le minimum proposé par le jeu
      await sleep(250);
      if (Number(input.value) !== min) return WMX.toast('Le montant saisi n’a pas été pris en compte : rien n’a été misé.', 6000);
      S.autoLast[a.id] = { bid: Number(live?.bid) || 0, t: Date.now() };
      btn.click();
      // Le serveur du jeu peut mettre quelques secondes à enregistrer la mise : on vérifie jusqu'à 6 fois avant de conclure à un échec.
      let now;
      for (let t = 0; t < 6; t++) {
        await sleep(t ? 2000 : 1800);
        await refresh();
        now = D.bidding.find((x) => x.id === a.id);
        if (now && leading(now)) break;
      }
      const won = !!(now && leading(now));
      WMX.toast(won
        ? `${opts.auto ? 'Mise automatique' : 'Mise'} de ${fmt(min)} W placée sur « ${cardTitle(a)} » : vous menez.`
        : 'La mise n’est pas confirmée : solde insuffisant, ou quelqu’un a surenchéri entre-temps. Vérifiez la page de l’enchère.', 7000);
      if (opts.auto) { // 3 échecs de suite : on arrête pour ne pas boucler
        S.autoFails[a.id] = won ? 0 : (S.autoFails[a.id] || 0) + 1;
        if (S.autoFails[a.id] >= 3) { delete S.auto[a.id]; saveAuto(); alertUser('Mise automatique arrêtée', `« ${cardTitle(a)} » : 3 mises sans effet (solde insuffisant ?).`, `${a.id}:fails`); }
      }
    } finally {
      S.betting = null;
      renderAll();
    }
  }

  // File d'attente des mises : on peut cliquer sur plusieurs enchères d'affilée, elles sont misées l'une après l'autre.
  const fire = () => window.dispatchEvent(new CustomEvent('wmx:bids'));
  let queueRunning = false;
  function enqueueBid(a) {
    if (S.bidQueue.some((x) => x.id === a.id) || S.betting === a.id) return;
    S.bidQueue.push(a);
    fire();
    if (S.bidQueue.length > 1 || S.betting) WMX.toast?.(`${S.bidQueue.length} mise${S.bidQueue.length > 1 ? 's' : ''} en file d’attente…`, 3000);
    runQueue();
  }
  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (S.bidQueue.length) {
        while (S.betting) await sleep(300); // une mise (ou mise automatique) est déjà en cours
        const a = S.bidQueue[0];
        try { await bid(a); } catch (err) { WMX.reportError?.('mise', 0, String(err?.message || err)); }
        S.bidQueue.shift();
        fire();
      }
    } finally { queueRunning = false; }
  }

  /**
   * Bouton « Annuler » d'une vente : « Annulation… » (trois points animés) et bloqué tant que l'annulation est demandée ou en cours,
   * pour que l'on comprenne que l'action est prise en compte. Il redevient « Annuler » si elle échoue (au bout de quelques secondes).
   */
  function paintCancel(btn) {
    const queued = WMX.quick?.stateOf(btn.dataset.card) === 'cancelling';
    const recent = btn.dataset.t && Date.now() - Number(btn.dataset.t) < 4000; // temps de mise en file
    const busy = queued || recent;
    if (busy === (btn.dataset.busy === '1')) return;
    btn.dataset.busy = busy ? '1' : '';
    btn.disabled = !!busy;
    btn.classList.toggle('busy', !!busy);
    btn.replaceChildren(...(busy ? ['Annulation', el('span', { class: 'wmx-dots' }, el('i', {}, '.'), el('i', {}, '.'), el('i', {}, '.'))] : ['Annuler']));
  }

  async function cancelSale(a) {
    const item = { card_id: a.card_id, title: cardTitle(a), rarity: rarityOf(a), starred: false };
    await WMX.quick?.refresh();
    if (!WMX.quick?.cancelItem(item)) WMX.toast('Cette vente n’est plus active.');
  }

  // --- Mise automatique -----------------------------------------------------------------------
  function setAuto(a, rule) {
    if (rule) { S.auto[a.id] = rule; S.autoFails[a.id] = 0; frameFor(a); } else { delete S.auto[a.id]; delete S.autoTry[a.id]; }
    saveAuto();
    S.autoOpen = null;
    renderAll();
    schedulePoll();
  }
  /** Groupe de boutons à choix unique (plus lisible qu'un menu déroulant : aucun texte coupé). */
  const seg = (options, current, onPick) => el('div', { class: 'wmx-seg' }, ...options.map(([v, label]) => {
    const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(v === current) }, label);
    b.addEventListener('click', () => onPick(v));
    return b;
  }));
  const avgOf = (a) => WMX.prices.get(a.card_id, rarityOf(a))?.avg ?? null;

  function autoForm(a) {
    const cur = S.auto[a.id];
    const d = S.draft[a.id] || (S.draft[a.id] = (() => {
      const base = cur || WMX.logic.parseAutoRule(defaultInput()) || { mode: 'time', secs: 35 };
      const secs = base.secs || 35;
      const useMin = secs >= 120 && secs % 60 === 0;
      return { mode: base.mode, amount: useMin ? secs / 60 : secs, unit: useMin ? 'min' : 's',
        capMode: base.capMode || (base.cap ? 'abs' : 'none'), cap: base.cap || Number(WMX.settings?.autoCapW) || 100, capPct: base.capPct ?? 20 };
    })());
    const root = el('div', { class: 'wmx-auc-auto' });
    const draw = () => {
      const avg = avgOf(a);
      const num = (key, props, onInput) => {
        const i = el('input', { class: 'wmx-input wmx-auc-num', type: 'number', value: String(d[key]), ...props });
        i.addEventListener('input', () => { d[key] = i.value === '' ? '' : Number(i.value); onInput?.(); });
        return i;
      };
      const preview = el('div', { class: 'wmx-auc-preview' });
      const drawPreview = () => {
        if (d.capMode === 'abs') preview.textContent = d.cap > 0 ? `Je ne mise plus au-dessus de ${fmt(d.cap)} W.` : 'Indiquez un plafond en W.';
        else if (d.capMode === 'avg') {
          const capW = WMX.logic.resolveCap({ capMode: 'avg', capPct: Number(d.capPct) || 0 }, avgOf(a));
          preview.textContent = capW != null ? `Plafond : ${fmt(capW)} W (moyenne du marché ${fmt(avgOf(a))} W${Number(d.capPct) ? ` ${d.capPct > 0 ? '+' : '−'} ${Math.abs(d.capPct)} %` : ''}).`
            : 'Moyenne du marché en cours de chargement…';
        } else preview.textContent = 'Aucun plafond : l’extension mise jusqu’à épuisement de votre solde.';
        preview.classList.toggle('warn', d.capMode === 'none');
      };
      const kids = [
        el('div', { class: 'wmx-auc-auto-head' }, el('strong', {}, 'Mise automatique'), el('small', {}, 'Mise toujours le minimum proposé par le jeu')),
        el('div', { class: 'wmx-auc-field' }, el('label', {}, 'Quand miser'), seg([['outbid', 'Dès que je suis surenchéri'], ['time', 'Juste avant la fin']], d.mode, (v) => { d.mode = v; draw(); })),
      ];
      if (d.mode === 'time') {
        kids.push(el('div', { class: 'wmx-auc-field' }, el('label', {}, 'Quand il reste'),
          el('div', { class: 'wmx-auc-inline' }, num('amount', { min: '1', step: '1' }), seg([['s', 'secondes'], ['min', 'minutes']], d.unit, (v) => { d.unit = v; draw(); })),
          el('div', { class: 'wmx-auc-presets' }, ...[[20, 's', '20 s'], [35, 's', '35 s'], [1, 'min', '1 min'], [2, 'min', '2 min'], [5, 'min', '5 min']].map(([n, u, label]) => {
            const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(d.amount === n && d.unit === u) }, label);
            b.addEventListener('click', () => { d.amount = n; d.unit = u; draw(); });
            return b;
          })),
          el('small', {}, 'Gardez une marge d’au moins 20 s : le délai de réponse du jeu dépend de votre connexion.')));
      }
      const capKids = [el('label', {}, 'Plafond (je ne dépasse jamais)'), seg([['none', 'Aucun'], ['abs', 'Valeur fixe'], ['avg', 'Selon la moyenne']], d.capMode, (v) => { d.capMode = v; draw(); })];
      if (d.capMode === 'abs') capKids.push(el('div', { class: 'wmx-auc-inline' }, num('cap', { min: '1', step: '1' }, drawPreview), el('span', { class: 'wmx-auc-unit' }, 'W')));
      if (d.capMode === 'avg') {
        capKids.push(el('div', { class: 'wmx-auc-presets' }, ...[[-20, '−20 %'], [0, 'À la moyenne'], [20, '+20 %'], [30, '+30 %'], [50, '+50 %']].map(([n, label]) => {
          const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(Number(d.capPct) === n) }, label);
          b.addEventListener('click', () => { d.capPct = n; draw(); });
          return b;
        })), el('div', { class: 'wmx-auc-inline' }, el('span', { class: 'wmx-auc-unit' }, 'Écart :'), num('capPct', { step: '5' }, drawPreview), el('span', { class: 'wmx-auc-unit' }, '% de la moyenne')));
      }
      capKids.push(preview);
      kids.push(el('div', { class: 'wmx-auc-field' }, ...capKids));
      drawPreview();
      if (d.capMode === 'avg' && avg == null) WMX.prices.fetchOne(a.card_id).then(() => { if (root.isConnected) drawPreview(); }); // la moyenne arrive : l'aperçu se met à jour
      const save = el('button', { class: 'wmx-btn' }, cur ? 'Enregistrer' : 'Activer');
      save.addEventListener('click', () => {
        const rule = WMX.logic.parseAutoRule({ mode: d.mode, amount: d.amount, unit: d.unit, capMode: d.capMode, cap: d.cap, capPct: d.capPct });
        if (!rule) return WMX.toast('Durée invalide.');
        if (d.capMode === 'abs' && !rule.cap) return WMX.toast('Plafond invalide.');
        delete S.draft[a.id];
        setAuto(a, rule);
      });
      const off = cur ? el('button', { class: 'wmx-btn wmx-btn--ghost' }, 'Désactiver') : '';
      if (off) off.addEventListener('click', () => { delete S.draft[a.id]; setAuto(a, null); });
      const cancel = el('button', { class: 'wmx-btn wmx-btn--ghost' }, 'Fermer');
      cancel.addEventListener('click', () => { delete S.draft[a.id]; S.autoOpen = null; renderAll(); });
      kids.push(el('div', { class: 'wmx-auc-autorow' }, save, off, cancel));
      root.replaceChildren(...kids);
    };
    draw();
    return root;
  }
  /** Chaque seconde : une règle est-elle à déclencher ? (une seule mise à la fois, 6 s minimum entre deux essais) */
  function runAuto() {
    if (!S.leader || S.betting || !D.loaded) return; // un seul onglet (le « chef ») exécute les mises automatiques
    for (const a of D.bidding) {
      const rule = S.auto[a.id];
      if (!rule) continue;
      const m = minOf(a);
      // Plafond en W : valeur fixe, ou moyenne du marché de la carte (+/− un pourcentage). Moyenne inconnue : on la demande et on attend.
      const capW = WMX.logic.resolveCap(rule, avgOf(a));
      if (rule.capMode === 'avg' && capW == null) {
        if (!WMX.prices.has(a.card_id)) WMX.prices.fetchOne(a.card_id);
        else if (!S.noAvgAlert?.[a.id]) { (S.noAvgAlert ||= {})[a.id] = 1; alertUser('Mise automatique en attente', `« ${cardTitle(a)} » : pas de moyenne du marché pour fixer le plafond.`, `${a.id}:noavg`); }
        continue;
      }
      if (capW != null && m && m > capW && !leading(a)) { // le minimum dépasse le plafond : la règle s'arrête (et on prévient)
        delete S.auto[a.id]; saveAuto(); renderAll();
        alertUser('Mise automatique arrêtée', `« ${cardTitle(a)} » : le minimum (${fmt(m)} W) dépasse votre plafond de ${fmt(capW)} W.`, `${a.id}:cap`);
        continue;
      }
      // Ma dernière mise automatique n'est pas encore visible (serveur lent) : on attend qu'une mise PLUS HAUTE apparaisse (vraie
      // surenchère d'un autre joueur) ou 90 s, au lieu de remiser par-dessus soi-même.
      const last = S.autoLast[a.id];
      if (last && Date.now() - last.t < 90000 && (a.current_bid || 0) <= last.bid) continue;
      const due = WMX.logic.autoBidDue(rule, { leading: leading(a), msLeft: msLeft(a), minBid: m, capW, cooldownOk: Date.now() - (S.autoTry[a.id] || 0) > 6000 });
      if (!due) continue;
      S.autoTry[a.id] = Date.now();
      bid(a, { auto: true, cap: capW });
      return;
    }
  }

  // --- Affichage -------------------------------------------------------------------------------
  /** Ouvre la page de l'enchère dans le jeu (routeur interne : pas de rechargement). Ctrl/⌘/clic milieu : nouvel onglet. */
  const openAuction = (a, e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // laisse le navigateur ouvrir un onglet
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('wmx:navigate', { detail: `/marketplace/${a.id}` }));
  };
  const timeEl = (a) => el('span', { class: 'wmx-auc-time', 'data-end': a.end_at }, fmtLeft(msLeft(a)));
  const rarityTag = (r) => el('span', { class: 'wmx-auc-rar', style: `color:rgb(${WMX.RARITY_RGB[r]})` }, r);

  function row(a, kind) {
    const r = rarityOf(a);
    const img = a.card?.image_url && !a.card?.hide_image
      ? el('img', { class: 'wmx-auc-img', src: a.card.image_url, alt: '', loading: 'lazy' })
      : el('div', { class: 'wmx-auc-img' });
    const title = el('a', { class: 'wmx-auc-title', href: `/marketplace/${a.id}`, title: `Voir l’enchère « ${cardTitle(a)} »` }, cardTitle(a));
    title.addEventListener('click', (e) => openAuction(a, e));
    let main, side;
    if (kind === 'bid') {
      const lead = leading(a);
      const act = el('button', { class: 'wmx-btn wmx-auc-bid', 'data-id': a.id }, 'Surenchérir');
      act.addEventListener('click', () => enqueueBid(a));
      const rule = S.auto[a.id];
      const autoBtn = el('button', { class: `wmx-auc-autobtn${rule ? ' on' : ''}`, title: rule ? 'Mise automatique active : cliquer pour la modifier' : 'Programmer une mise automatique', 'aria-label': 'Mise automatique' }, '⏱');
      autoBtn.addEventListener('click', () => { S.autoOpen = S.autoOpen === a.id ? null : a.id; renderAll(); });
      main = el('div', { class: 'wmx-auc-main' },
        el('div', { class: 'wmx-auc-name' }, title, rarityTag(r)),
        el('span', { class: `wmx-auc-state ${lead ? 'ok' : 'ko'}` }, lead ? 'Vous menez' : 'Surenchéri'),
        timeEl(a),
        rule ? el('span', { class: 'wmx-auc-autotag' }, WMX.logic.autoLabel(rule)) : '');
      side = el('div', { class: 'wmx-auc-side' },
        el('div', { class: 'wmx-auc-price' }, el('small', {}, 'Mise actuelle'), el('b', {}, `${fmt(a.current_bid || a.base_amount)} W`)),
        el('div', { class: 'wmx-auc-acts' }, autoBtn, act));
      return el('div', { class: 'wmx-auc-row', style: `--rgb:${WMX.RARITY_RGB[r]}` }, img, main, side, S.autoOpen === a.id ? autoForm(a) : '');
    } else {
      const act = a.current_bid || msLeft(a) <= 0 ? '' : el('button', { class: 'wmx-btn wmx-btn--ghost wmx-auc-cancel', 'data-card': a.card_id, title: 'Annuler la vente et récupérer la carte' }, 'Annuler');
      if (act) {
        paintCancel(act); // si l'annulation est déjà en cours (liste redessinée), le bouton le montre aussitôt
        act.addEventListener('click', () => {
          if (act.disabled) return;
          act.dataset.t = String(Date.now());
          paintCancel(act); // retour immédiat : « Annulation… », le bouton est bloqué (inutile de cliquer plusieurs fois)
          cancelSale(a);
        });
      }
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

  /** Une enchère terminée reste 15 s à l'écran (« Terminée »), puis disparaît du tableau, sans attendre le règlement par le serveur. */
  const GRACE_MS = 15000;
  const shown = (a) => msLeft(a) > -GRACE_MS;
  const liveBids = () => D.bidding.filter((x) => msLeft(x) > 0);
  const liveSales = () => D.selling.filter((x) => msLeft(x) > 0);
  const listSig = () => [...D.bidding, ...D.selling].filter(shown).map((x) => x.id).join();

  function content() {
    const bids = D.bidding.filter(shown).sort((a, b) => msLeft(a) - msLeft(b)).map((a) => row(a, 'bid'));
    const sells = D.selling.filter(shown).sort((a, b) => msLeft(a) - msLeft(b)).map((a) => row(a, 'sell'));
    return [column('Mes mises', bids, 'Aucune mise en cours.'), column('Mes ventes', sells, 'Aucune vente en cours.')];
  }

  function renderAll() {
    const typing = S.bubbleBody?.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
    if (S.bubbleBody && S.bubbleOpen && !typing) S.bubbleBody.replaceChildren(...content()); // pas de reconstruction pendant une saisie
    S.pillSig = null;
    tick();
  }

  /** Chaque seconde : chronomètres, et libellé « Surenchérir · N W » avec le minimum lu sur la page de l'enchère. */
  function tick() {
    for (const t of document.querySelectorAll('.wmx-auc-time')) {
      const left = new Date(t.dataset.end).getTime() - Date.now();
      t.textContent = fmtLeft(left);
      const st = timeState(left);
      t.classList.toggle('low', st === 'low' || st === 'urgent');
      t.classList.toggle('ended', st === 'ended');
      t.closest('.wmx-auc-row')?.classList.toggle('urgent', st === 'urgent');
    }
    for (const b of document.querySelectorAll('.wmx-auc-cancel')) paintCancel(b);
    for (const b of document.querySelectorAll('.wmx-auc-bid')) {
      const a = D.bidding.find((x) => x.id === b.dataset.id);
      if (!a) continue;
      const m = minOf(a);
      b.textContent = S.betting === a.id ? 'Mise en cours…' : leading(a) ? 'Vous menez' : (m ? `Surenchérir · ${fmt(m)} W` : 'Surenchérir');
      b.disabled = !!S.betting || leading(a) || msLeft(a) <= 0;
    }
    if (D.loaded) {
      const sig = listSig();
      const changed = S.listSig !== undefined && sig !== S.listSig;
      S.listSig = sig; // mémorisé AVANT de redessiner : renderAll() rappelle tick(), sans quoi la boucle ne s'arrête jamais
      if (changed) renderAll(); // une enchère vient de sortir du tableau
      checkUrgent(); runAuto();
    }
    updatePill();
    if (S.bubble) S.bubble.hidden = WMX.settings?.auctionBubble === false;
  }

  // --- Bulle flottante -------------------------------------------------------------------------
  const placeBubble = () => {
    if (!S.bubble) return;
    const x = Math.round(WMX.dom.sidebarRight()) + 16;
    S.bubble.style.left = `${x}px`;
    S.bubblePanel.style.maxWidth = `calc(100vw - ${x + 16}px)`;
  };
  function buildBubble() {
    const svg = (html) => { const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); n.setAttribute('viewBox', '0 0 72 72'); n.setAttribute('class', 'wmx-dial-svg'); n.innerHTML = html; return n; };
    const ring = svg(`<circle cx="36" cy="36" r="30" class="wmx-dial-bg"/><circle cx="36" cy="36" r="30" class="wmx-dial-ring" stroke-dasharray="${RING}" stroke-dashoffset="0"/>`);
    S.dialRing = ring.querySelector('.wmx-dial-ring');
    S.dialBids = el('b'); S.dialSales = el('small');
    S.dialOut = el('i', { class: 'wmx-auc-dot', hidden: '' });
    S.dialWarn = el('i', { class: 'wmx-auc-warn', hidden: '' });
    S.pill = el('button', { class: 'wmx-dial', 'aria-label': 'Mes enchères', onclick: () => {
      try { // la demande d'autorisation exige un geste de l'utilisateur : le premier clic
        if (typeof Notification !== 'undefined' && Notification.permission === 'default' && WMX.settings?.auctionNotify !== false) Notification.requestPermission();
      } catch (_) { /* indisponible */ }
      toggleBubble();
    } }, ring, el('span', { class: 'wmx-dial-txt' }, S.dialBids, S.dialSales), S.dialOut, S.dialWarn);
    S.bubbleBody = el('div', { class: 'wmx-bubble-body' });
    const panel = el('div', { class: 'wmx-bubble-panel', hidden: '' },
      S.bubbleHead = el('div', { class: 'wmx-bubble-head', title: 'Maintenez le clic pour déplacer · double-clic pour replacer' }, el('strong', {}, 'Mes enchères'),
        el('span', {},
          el('button', { class: 'wmx-qclear', title: 'Paramètres des enchères', onclick: () => WMX.openSettings() }, '⚙'),
          el('button', { class: 'wmx-qclear', title: 'Actualiser maintenant', onclick: refresh }, '↻'),
          el('button', { class: 'wmx-qclear', title: 'Réduire', onclick: () => toggleBubble(false) }, '×'))),
      S.bubbleBody, WMX.autoSell?.footer());
    S.bubblePanel = panel;
    enableDrag(S.bubbleHead);
    WMX.store.get('auctionBubblePos').then((p) => { if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) S.pos = p; }).catch(() => {});
    S.bubble = el('div', { class: 'wmx-bubble', hidden: '' }, panel, S.pill);
    document.body.append(S.bubble);
    WMX.dom.keepAttached(S.bubble);
    placeBubble();
    window.addEventListener('resize', placeBubble);
    new ResizeObserver(placeBubble).observe(document.documentElement);
    setTimeout(placeBubble, 600); setTimeout(placeBubble, 2500); // après le rendu du jeu
  }
  /** Le panneau part de la pastille et y retourne : son point d'origine est le centre de la pastille, où qu'on l'ait déplacé. */
  function aimAtPill() {
    const p = S.bubblePanel;
    const prev = p.style.transition;
    const was = p.classList.contains('open');
    p.style.transition = 'none';
    p.classList.add('open');
    const r = p.getBoundingClientRect();
    const b = S.pill.getBoundingClientRect();
    p.style.transformOrigin = `${Math.round(b.left + b.width / 2 - r.left)}px ${Math.round(b.top + b.height / 2 - r.top)}px`;
    if (!was) p.classList.remove('open');
    void p.offsetWidth;
    p.style.transition = prev;
  }
  function toggleBubble(open = !S.bubbleOpen) {
    S.bubbleOpen = open;
    const p = S.bubblePanel;
    clearTimeout(S.closeTimer);
    if (open) {
      p.hidden = false;
      applyPos();
      aimAtPill();
      void p.offsetWidth; // force le point de départ de la transition
      p.classList.add('open');
      S.pill.classList.add('on');
      renderAll(); refresh().then(prepareFrames); prepareFrames();
    } else {
      aimAtPill();
      p.classList.remove('open');
      S.pill.classList.remove('on');
      S.closeTimer = setTimeout(() => { if (!S.bubbleOpen) p.hidden = true; }, 340);
    }
    schedulePoll();
  }

  // Panneau déplaçable : on attrape l'en-tête ; la position est mémorisée et gardée dans l'écran.
  const clampPos = (x, y, p) => ({
    x: Math.min(Math.max(8, x), Math.max(8, innerWidth - p.offsetWidth - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, innerHeight - p.offsetHeight - 8)),
  });
  function applyPos() {
    const p = S.bubblePanel;
    if (!S.pos || !p) return;
    const c = clampPos(S.pos.x, S.pos.y, p);
    p.classList.add('moved');
    p.style.left = `${c.x}px`; p.style.top = `${c.y}px`;
  }
  function enableDrag(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const p = S.bubblePanel, r = p.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      p.classList.add('moved', 'dragging');
      const move = (ev) => {
        const c = clampPos(ev.clientX - dx, ev.clientY - dy, p);
        S.pos = c; p.style.left = `${c.x}px`; p.style.top = `${c.y}px`;
      };
      move(e);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        p.classList.remove('dragging');
        WMX.store.set('auctionBubblePos', S.pos);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', (e) => { // double-clic sur l'en-tête : retour à l'emplacement d'origine
      if (e.target.closest('button')) return;
      S.pos = null;
      WMX.store.set('auctionBubblePos', null);
      const p = S.bubblePanel; p.classList.remove('moved'); p.style.left = p.style.top = '';
    });
    window.addEventListener('resize', applyPos);
  }

  /** Utilisé par la page Marché : miser le minimum sur une enchère sans ouvrir sa page. */
  WMX.auctions = {
    refresh,
    state: () => D,
    bidById(id, title) { enqueueBid(D.bidding.find((x) => x.id === id) || { id, card: { wikipedia_title: title } }); },
    warm(id) { if (id && !S.betting) frameFor({ id }); },
    stateOf(id) {
      const x = D.bidding.find((b) => b.id === id);
      if (x && leading(x)) return 'leading';
      if (S.betting === id) return 'betting';
      if (S.bidQueue.some((q) => q.id === id)) return 'queued';
      return x ? 'outbid' : 'none';
    },
    busy: () => S.betting,
  };

  WMX.register({
    name: 'auctions',
    init() {
      buildBubble();
      WMX.quick?.onChange(() => { clearTimeout(S.qT); S.qT = setTimeout(() => { if (WMX.alive()) refresh(); }, 900); });
      // Élection du « chef » : un seul onglet du jeu exécute les mises automatiques (sinon chaque onglet miserait de son côté).
      if (navigator.locks?.request) navigator.locks.request('wmx-auto-leader', () => {
        S.leader = true;
        // Le rôle est rendu dès que ce script est orphelin (extension rechargée) : un onglet actualisé peut alors le reprendre.
        return new Promise((done) => { const t = setInterval(() => { if (!WMX.alive()) { clearInterval(t); S.leader = false; done(); } }, 2000); });
      }).catch(() => { S.leader = true; });
      else S.leader = true;
      WMX.store.get('autoBids', {}).then((r) => { S.auto = r || {}; });
      setInterval(() => { if (WMX.alive()) tick(); }, 1000);
      // Premier chargement : réessayé de plus en plus espacé tant qu'il échoue (jeu lent ou erreur passagère), au lieu d'attendre la minute suivante.
      setTimeout(async () => {
        for (let n = 0; n < 15 && !D.loaded && WMX.alive(); n++) { await refresh(); if (!D.loaded) await sleep(Math.min(30000, 4000 + n * 3000)); }
        schedulePoll();
      }, 3000);
    },
  });
})();
