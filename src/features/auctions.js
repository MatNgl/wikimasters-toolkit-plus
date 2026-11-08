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
  const D = { selling: [], bidding: [], watching: [], me: null, loaded: false };
  const S = { bubble: null, bubbleOpen: false, betting: null, timer: null, lists: [], frames: new Map() };
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const cardTitle = (a) => a.card?.wikipedia_title || '?';
  const rarityOf = (a) => WMX.normRarity(a.snapshot_rarity || a.card?.rarity) || 'C';
  const leading = (a) => !!D.me && a.current_bidder_id === D.me;
  const msLeft = (a) => new Date(a.end_at).getTime() - Date.now();
  // « Surveiller » : une enchère sur laquelle je n'ai pas (encore) misé mais qui porte une règle de mise automatique marquée `watch` : l'extension
  // attend le dernier moment (ex. sous 35 s) et ne mise que si le prix reste sous le plafond. Dès que j'ai misé, elle devient une mise automatique ordinaire.
  const allBids = () => [...D.bidding, ...D.watching.filter((w) => !D.bidding.some((b) => b.id === w.id))];
  const msLeftById = (id) => { const a = allBids().find((x) => x.id === id); return a ? msLeft(a) : 9e9; };
  const MAX_WATCH = 12; // au-delà : trop de requêtes de suivi
  const { fmtLeft, timeState } = WMX.logic; // sous 5 min : chronomètre rouge ; sous 2 min : alerte
  S.auto = {};                              // mises automatiques : { idEnchère: règle } (mémorisées)
  S.autoTry = {};                           // dernier essai de mise automatique par enchère
  S.autoFails = {};
  S.autoLast = {};                          // dernière mise par enchère : { bid: mise avant la mienne, t }
  S.bidQueue = [];
  S.draft = {};      // réglages de mise automatique en cours de saisie (gardés si la liste se redessine)
  S.autoSeen = null; // identifiants des mises déjà vues (les réglages par défaut ne s'appliquent qu'aux NOUVELLES mises)
  S.autoOpen = null;                        // enchère dont le formulaire de mise automatique est ouvert
  S.hidden = {};                            // enchères dépassées retirées de la bulle par l'utilisateur : { id: date } (mémorisées)
  const saveAuto = () => WMX.store.set('autoBids', S.auto);
  const notified = new Set();               // alertes déjà envoyées (une seule fois chacune)

  // --- Alertes ----------------------------------------------------------------------------
  /** Message dans la page + notification du navigateur (si autorisée et activée dans les paramètres).
   *  Couleurs : `info` (bleu : on vous informe, ex. surenchéri), `warn` (jaune : attention, ex. fin proche, surveillance, mise arrêtée), `ok` (vert), `alert` (rouge). */
  function alertUser(title, body, tag, { toast = true, kind = 'warn' } = {}) {
    if (toast) WMX.notify?.({ kind, title, text: body, ms: 9000, key: `alert:${tag}` });
    try {
      if (WMX.settings?.auctionNotify !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, tag });
      }
    } catch (_) { /* notification indisponible */ }
  }
  /** D'où vient un plafond, en clair : « moyenne du marché −10 % (moyenne : 19 W) » ou « valeur fixe ». */
  const capSource = (rule, a) => {
    if (rule?.capMode === 'avg') {
      const p = Number(rule.capPct) || 0;
      const avg = a ? avgOf(a) : null;
      return `moyenne du marché${p ? ` ${p > 0 ? '+' : '−'}${Math.abs(p)} %` : ''}${avg != null ? `, la moyenne est de ${fmt(avg)} W` : ''}`;
    }
    return rule?.capMode === 'abs' || rule?.cap ? 'valeur fixe' : 'réglage de plafond';
  };
  /** Le prix a dépassé (ou dépasse déjà) le plafond : on le dit clairement, avec un bouton qui ouvre les réglages à la bonne partie. */
  function capNotice(a, price, capW, rule, { starting = false } = {}) {
    const name = cardTitle(a);
    const title = 'Prix au-dessus de votre plafond';
    const current = a.current_bid || a.base_amount || price;
    // Le plafond s'applique à la mise que l'extension placerait (le minimum demandé par le jeu), pas au prix actuel : on donne les deux pour que ce soit clair.
    const text = starting
      ? `« ${name} » est déjà à ${fmt(current)} W, alors que votre plafond est de ${fmt(capW)} W (${capSource(rule, a)}). L’extension ne la surveillera pas : elle ne miserait jamais. Relevez le plafond si vous voulez quand même tenter.`
      : `« ${name} » : la prochaine mise doit être d’au moins ${fmt(price)} W (prix actuel : ${fmt(current)} W), ce qui dépasse votre plafond de ${fmt(capW)} W (${capSource(rule, a)}). L’extension ne mise donc pas (ou plus) sur cette carte. Relevez le plafond si vous voulez quand même tenter.`;
    WMX.notify?.({ kind: 'warn', ms: 20000, key: `cap:${a.id}`, title, text, action: { label: 'Modifier le plafond', onClick: () => WMX.openSettings?.('Mises automatiques') } });
    alertUser(title, `« ${name} » : ${fmt(price)} W pour un plafond de ${fmt(capW)} W.`, `${a.id}:cap`, { toast: false });
  }
  /** Nouvelle surenchère d'un autre joueur sur une enchère où je misais (au premier chargement, on ne fait que mémoriser). */
  function checkOutbid(first) {
    for (const a of D.bidding) {
      if (leading(a) || S.hidden[a.id]) continue; // je mène, ou j'ai retiré cette enchère de la liste : pas d'alerte
      const key = `${a.id}:out:${a.current_bid}`;
      if (notified.has(key)) continue;
      notified.add(key);
      if (!first) alertUser('Vous êtes surenchéri', `« ${cardTitle(a)} » : ${fmt(a.current_bid)} W`, key, { kind: 'info' });
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
  const isWatch = (a) => !!S.auto[a.id]?.watch && !D.bidding.some((b) => b.id === a.id);
  S.watchT = {}; // dernière lecture de chaque enchère surveillée
  /** Relit les enchères surveillées (GET /api/marketplace/{id}) : peu souvent tant que c'est loin, toutes les 2,5 s près du moment de miser. */
  async function refreshWatching(force = false) {
    const ids = Object.keys(S.auto).filter((id) => S.auto[id]?.watch && !D.bidding.some((b) => b.id === id));
    const next = [];
    for (const id of ids) {
      const prev = D.watching.find((w) => w.id === id);
      const rule = S.auto[id];
      const left = prev ? msLeft(prev) : 9e9;
      const near = left <= (rule.secs || 60) * 1000 + 20000;
      const every = !prev ? 0 : near ? 2500 : left <= 5 * 60000 ? 15000 : 60000;
      if (!force && prev && Date.now() - (S.watchT[id] || 0) < every) { next.push(prev); continue; }
      S.watchT[id] = Date.now();
      let a = null;
      let gone = false;
      try {
        const res = await fetch(`/api/marketplace/${id}`, { cache: 'no-store' });
        if (res.status === 404) gone = true;
        else if (res.ok) a = (await res.json())?.auction || null;
      } catch (_) { /* réseau : on garde la dernière lecture */ }
      if (gone || (a && (a.status !== 'active' || msLeft(a) < -GRACE_MS))) { // terminée sans que j'aie misé : la veille s'arrête
        delete S.auto[id]; delete S.autoTry[id]; saveAuto();
        const title = a ? cardTitle(a) : (prev ? cardTitle(prev) : 'cette carte');
        if (!gone) alertUser('Veille terminée', `« ${title} » est terminée : l’extension n’a pas misé (le prix est resté trop haut pour votre plafond, ou le moment de miser n’est pas arrivé).`, `${id}:watchend`);
        continue;
      }
      if (a) next.push(a); else if (prev) next.push(prev);
    }
    D.watching = next;
  }

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
      await refreshWatching();
      // Enchères retirées de la bulle : on les oublie quand elles sont terminées ou que je les mène de nouveau.
      for (const id of Object.keys(S.hidden)) {
        const h = D.bidding.find((x) => x.id === id);
        if (!h || leading(h)) { delete S.hidden[id]; WMX.store.set('hiddenBids', S.hidden); }
      }
      let dirty = false;
      for (const id of Object.keys(S.auto)) {
        const inBids = D.bidding.some((x) => x.id === id);
        if (S.auto[id]?.watch && inBids) { delete S.auto[id].watch; dirty = true; continue; } // j'ai misé : la veille devient une mise automatique ordinaire
        if (!inBids && !S.auto[id]?.watch) { delete S.auto[id]; delete S.autoTry[id]; dirty = true; } // enchère terminée
      }
      if (dirty) saveAuto();
      // Page prête à l'avance (miser sans attendre) pour les règles dont l'enchère finit le plus tôt : jamais plus de pages que MAX_FRAMES.
      // Une veille n'a besoin de sa page que dans la dernière minute et demie avant le moment de miser.
      Object.keys(S.auto).map((id) => allBids().find((b) => b.id === id)).filter((a) => a && (!isWatch(a) || msLeft(a) <= (S.auto[a.id].secs || 60) * 1000 + 90000))
        .sort((x, y) => msLeft(x) - msLeft(y)).slice(0, MAX_FRAMES).forEach(frameFor);
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
    // Une veille encore lointaine (plus de 5 min avant le moment de miser) ne demande pas l'actualisation rapide des règles.
    const fast = WMX.logic.autoPollMs(Object.entries(S.auto).filter(([id, rule]) => !rule.watch || msLeftById(id) <= 5 * 60000 + (rule.secs || 60) * 1000)
      .map(([id, rule]) => ({ rule, msLeft: msLeftById(id) })));
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
  const MAX_FRAMES = 4; // jamais plus : chaque page préchargée est une page du jeu de plus qui tourne
  function frameFor(a) {
    let f = S.frames.get(a.id);
    if (f?.isConnected) return f;
    if (S.frames.size >= MAX_FRAMES) { // on libère celle dont l'enchère finit le plus tard (jamais la plus urgente)
      let far = null;
      for (const [id] of S.frames) { if (id !== S.betting && id !== a.id && (!far || msLeftById(id) > msLeftById(far))) far = id; }
      if (far) { S.frames.get(far).remove(); S.frames.delete(far); }
    }
    f = el('iframe', { class: 'wmx-sheet-frame', src: `/marketplace/${a.id}#wmx-auto`, title: 'Mise', tabindex: '-1' });
    document.body.append(f);
    S.frames.set(a.id, f);
    return f;
  }
  function pruneFrames() {
    const keep = new Set(allBids().map((a) => a.id));
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
    if (!D.me) return opts.auto ? undefined : WMX.toast('Je ne retrouve pas votre compte. Actualisez la page (F5) puis réessayez.', 6000, { kind: 'warn' });
    if (S.betting) return opts.auto ? undefined : WMX.toast('Une autre mise est en cours : patientez un instant.');
    if (leading(a)) return opts.auto ? undefined : WMX.toast('Vous menez déjà cette enchère.');
    S.betting = a.id;
    renderAll();
    const jr = (text, level) => WMX.journal?.add(opts.auto ? 'Mise automatique' : 'Surenchère', `« ${cardTitle(a)} » : ${text}`, level);
    const release = () => { if (S.betting === a.id) { S.betting = null; renderAll(); } }; // sans effet si une autre mise a déjà pris la place
    const t0 = Date.now();
    try {
      WMX.toast(`Mise sur « ${cardTitle(a)} »…`, 60000, { key: `bid:${a.id}:go`, kind: 'info' });
      const preloaded = !!bidInput(S.frames.get(a.id) || {});
      const f = frameFor(a);
      const input = await waitFor(() => bidInput(f), 90000, 150);
      if (!input) { jr(`la page de l’enchère ne s’est pas chargée (${Math.round((Date.now() - t0) / 1000)} s) : rien n’a été misé`, 'error'); return WMX.toast('La page de l’enchère n’a pas répondu : rien n’a été misé. Réessayez dans un instant.', 7000, { kind: 'warn' }); }
      const btn = bidButton(f);
      if (!btn) { jr('bouton « Miser » introuvable sur la page de l’enchère', 'error'); return WMX.toast('Le bouton « Miser » n’est pas apparu : rien n’a été misé. Le jeu a peut-être changé sa page.', 7000, { kind: 'warn' }); }
      const min = Number(input.min);
      if (!Number.isFinite(min) || min <= 0) { jr('minimum de mise illisible : rien n’a été misé', 'error'); return WMX.toast('Je n’ai pas pu lire la mise minimum : rien n’a été misé. Réessayez dans un instant.', 7000, { kind: 'warn' }); }
      if (opts.cap && min > opts.cap) { // plafond de la mise automatique dépassé : on s'arrête
        const ruleBefore = S.auto[a.id];
        delete S.auto[a.id]; saveAuto();
        jr(`le minimum (${fmt(min)} W) dépasse le plafond de ${fmt(opts.cap)} W : règle arrêtée`, 'warn');
        capNotice(a, min, opts.cap, ruleBefore);
        return;
      }
      if (opts.auto) jr(`mise de ${fmt(min)} W déclenchée (il reste ${Math.max(0, Math.round(msLeft(a) / 1000))} s${preloaded ? '' : ', page chargée à la demande en ' + Math.round((Date.now() - t0) / 1000) + ' s'})`);
      // Dernier contrôle, sur l'état RÉEL de l'enchère (pas sur la liste, parfois en retard) : jamais de surenchère sur soi-même.
      const live = await liveState(a.id);
      if (live && live.status && live.status !== 'active') return opts.auto ? undefined : WMX.toast('Cette enchère est terminée.', 5000);
      if (live && D.me && live.bidder === D.me) return opts.auto ? undefined : WMX.toast('Vous menez déjà cette enchère.', 4000);
      // Le minimum peut avoir monté pendant la vérification ci-dessus (un rival vient de miser) : on relit celui de la page juste avant de saisir,
      // sinon la mise serait inférieure au minimum et refusée.
      let amount = Number(input.min);
      if (!Number.isFinite(amount) || amount <= 0) amount = min;
      if (opts.cap && amount > opts.cap) {
        const ruleBefore = S.auto[a.id];
        delete S.auto[a.id]; saveAuto();
        jr(`le minimum est monté à ${fmt(amount)} W, au-dessus du plafond de ${fmt(opts.cap)} W : règle arrêtée`, 'warn');
        capNotice(a, amount, opts.cap, ruleBefore);
        return;
      }
      setNumber(input, amount); // exactement le minimum proposé par le jeu
      await sleep(200);
      if (Number(input.value) !== amount) { jr(`le montant ${fmt(amount)} W n’a pas été pris en compte : rien n’a été misé`, 'error'); return WMX.toast('Le montant n’a pas été accepté par la page : rien n’a été misé. Réessayez.', 7000, { kind: 'warn' }); }
      const before = Number(live?.bid) || 0;
      S.autoLast[a.id] = { bid: before, t: Date.now() };
      try { f.contentDocument.dispatchEvent(new Event('wmx-net-reset')); } catch (_) { /* cadre libéré */ } // relevé des réponses du serveur remis à zéro (frame-hook.js)
      btn.click();
      // Le clic est passé : l'exécuteur de mises est libéré tout de suite (la vérification qui suit peut durer plusieurs secondes et ne doit pas
      // retarder la mise suivante, par exemple une autre enchère qui se termine au même moment).
      await sleep(500);
      release();
      // Le serveur du jeu peut mettre quelques secondes à enregistrer la mise : on vérifie jusqu'à 6 fois avant de conclure à un échec.
      // On regarde l'état réel de l'enchère (léger) : si on mène, c'est gagné ; si la mise a monté jusqu'à notre montant sans qu'on mène, elle est
      // passée et un autre joueur l'a déjà dépassée (ce n'est pas un échec : la règle continue de surenchérir).
      let now, l2 = null;
      for (let t = 0; t < 6; t++) {
        await sleep(t ? 1500 : 700);
        l2 = await liveState(a.id);
        if (l2 && D.me && l2.bidder === D.me) break;
        if (l2 && l2.bid >= amount && l2.bid > before) break;
        await refresh();
        now = D.bidding.find((x) => x.id === a.id);
        if (now && leading(now)) break;
      }
      await refresh();
      now = D.bidding.find((x) => x.id === a.id);
      const won = !!(now && leading(now)) || !!(l2 && D.me && l2.bidder === D.me);
      const placed = won || !!(l2 && l2.bid >= amount && l2.bid > before);
      const left = Math.max(0, Math.round(msLeft(a) / 1000));
      // Le jeu a-t-il REFUSÉ la mise (403/429, coupure) ? Alors on l'explique en rouge, au lieu d'un vague « non confirmée ».
      let refusal = '';
      try { const n = f.contentDocument.documentElement.dataset.wmxNet || ''; if (/→ (403|429|réseau)/.test(n)) refusal = n.split(' ; ').filter((x) => /→ (403|429|réseau)/.test(x)).pop(); } catch (_) { /* cadre libéré */ }
      if (!placed && refusal) {
        const why = WMX.explainRefusal(refusal);
        jr(`le jeu a refusé la mise : ${refusal}`, 'error');
        WMX.notify?.({ kind: 'alert', key: 'game-bid-refused', title: `Mise refusée sur « ${cardTitle(a)} »`, text: `${why.title}. ${why.text}`, hint: why.hint });
      }
      jr(won ? `mise de ${fmt(amount)} W placée, on mène (il reste ${left} s)` : placed ? `mise de ${fmt(amount)} W placée mais déjà surenchérie (il reste ${left} s)` : `mise de ${fmt(amount)} W non confirmée (solde insuffisant, refus du jeu ou surenchère à la même seconde)`, won || placed ? 'info' : 'warn');
      WMX.dismissNote?.(`bid:${a.id}:go`);
      WMX.toast(won
        ? `${opts.auto ? 'Mise automatique' : 'Mise'} de ${fmt(amount)} W placée sur « ${cardTitle(a)} » : vous menez.`
        : placed ? `Mise de ${fmt(amount)} W placée sur « ${cardTitle(a)} », mais déjà surenchérie.`
          : refusal ? `Le jeu a refusé votre mise sur « ${cardTitle(a)} » (voir l’alerte rouge).`
            : 'Votre mise n’est pas confirmée : soit vous n’avez pas assez de W, soit quelqu’un a surenchéri entre-temps. Regardez la page de l’enchère.', 7000, { key: `bid:${a.id}`, kind: won ? 'ok' : 'warn' });
      if (opts.auto) { // 3 échecs de suite : on arrête pour ne pas boucler
        S.autoFails[a.id] = placed ? 0 : (S.autoFails[a.id] || 0) + 1;
        if (S.autoFails[a.id] >= 3) { delete S.auto[a.id]; saveAuto(); alertUser('Mise automatique arrêtée', `« ${cardTitle(a)} » : 3 mises sans effet (solde insuffisant ?).`, `${a.id}:fails`); }
      }
    } finally {
      WMX.dismissNote?.(`bid:${a.id}:go`); // la notification « Mise sur… » ne reste pas si la mise s'arrête en route
      release();
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
    if (!WMX.quick?.cancelItem(item)) WMX.toast('Cette vente est déjà terminée.');
  }

  // --- Mise automatique -----------------------------------------------------------------------
  function setAuto(a, rule) {
    if (rule) { if (isWatch(a)) rule.watch = true; S.auto[a.id] = rule; S.autoFails[a.id] = 0; if (!isWatch(a)) frameFor(a); } else { delete S.auto[a.id]; delete S.autoTry[a.id]; D.watching = D.watching.filter((w) => w.id !== a.id); }
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
        el('div', { class: 'wmx-auc-field' }, el('label', {}, 'Quand miser'), seg([['outbid', 'Dès que je suis surenchéri'], ['time', 'Sous un délai avant la fin']], d.mode, (v) => { d.mode = v; draw(); })),
      ];
      if (d.mode === 'time') {
        // L'explication complète est dans une infobulle (survol de ⓘ) : le formulaire reste court.
        const hint = 'Tant que le compteur est sous ce délai, je surenchéris à chaque fois que quelqu’un d’autre me dépasse, jusqu’à la fin ou au plafond. Gardez une marge d’au moins 20 s : le délai de réponse du jeu dépend de votre connexion.';
        kids.push(el('div', { class: 'wmx-auc-field' }, el('label', {}, 'Quand il reste', el('i', { class: 'wmx-info', title: hint, tabindex: '0', 'aria-label': hint }, 'ⓘ')),
          el('div', { class: 'wmx-auc-inline' }, num('amount', { min: '1', step: '1' }), seg([['s', 'secondes'], ['min', 'minutes']], d.unit, (v) => { d.unit = v; draw(); })),
          el('div', { class: 'wmx-auc-presets' }, ...[[20, 's', '20 s'], [35, 's', '35 s'], [1, 'min', '1 min'], [2, 'min', '2 min'], [5, 'min', '5 min']].map(([n, u, label]) => {
            const b = el('button', { type: 'button', class: 'wmx-seg-btn', 'aria-pressed': String(d.amount === n && d.unit === u) }, label);
            b.addEventListener('click', () => { d.amount = n; d.unit = u; draw(); });
            return b;
          }))));
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
        if (!rule) return WMX.toast('La durée indiquée n’est pas valide : mettez par exemple 30 secondes.', 6000, { kind: 'warn' });
        if (d.capMode === 'abs' && !rule.cap) return WMX.toast('Le plafond indiqué n’est pas valide : indiquez un nombre de W.', 6000, { kind: 'warn' });
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
    for (const a of allBids()) {
      const rule = S.auto[a.id];
      if (!rule) continue;
      const watching = isWatch(a);
      // Minimum de mise : lu sur la page de l'enchère ; pour une veille dont la page n'est pas encore chargée, on prend la borne basse connue (mise actuelle + 1).
      const m = minOf(a) || (watching ? (a.current_bid ? a.current_bid + 1 : a.base_amount) || null : null);
      // Plafond en W : valeur fixe, ou moyenne du marché de la carte (+/− un pourcentage). Moyenne inconnue : on la demande et on attend.
      const capW = WMX.logic.resolveCap(rule, avgOf(a));
      if (rule.capMode === 'avg' && capW == null) {
        if (!WMX.prices.has(a.card_id)) WMX.prices.fetchOne(a.card_id);
        else if (!S.noAvgAlert?.[a.id]) { (S.noAvgAlert ||= {})[a.id] = 1; alertUser('Mise automatique en attente', `« ${cardTitle(a)} » : pas de moyenne du marché pour fixer le plafond.`, `${a.id}:noavg`); }
        continue;
      }
      if (capW != null && m && m > capW && !leading(a)) { // le minimum dépasse le plafond : la règle s'arrête (et on prévient)
        delete S.auto[a.id]; saveAuto(); renderAll();
        capNotice(a, m, capW, rule);
        continue;
      }
      // Ma dernière mise automatique n'est pas encore visible (serveur lent) : on attend qu'une mise PLUS HAUTE apparaisse (vraie
      // surenchère d'un autre joueur) ou 90 s, au lieu de remiser par-dessus soi-même.
      const last = S.autoLast[a.id];
      if (last && Date.now() - last.t < 90000 && (a.current_bid || 0) <= last.bid) continue;
      const due = WMX.logic.autoBidDue(rule, { leading: leading(a), msLeft: msLeft(a), minBid: m, capW, cooldownOk: Date.now() - (S.autoTry[a.id] || 0) > (msLeft(a) <= 90000 ? 3000 : 6000) });
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

  /** Moyenne du marché et verdict, à côté de la mise actuelle. La moyenne manquante est demandée une fois par carte (file des prix). */
  function avgChip(a, role) {
    const p = WMX.prices.get(a.card_id, rarityOf(a));
    if (!p && !WMX.prices.fresh(a.card_id)) {
      if (!(S.avgAsked ||= new Set()).has(a.card_id)) { S.avgAsked.add(a.card_id); WMX.prices.fetchOne(a.card_id).then(() => { if (S.bubbleOpen) renderAll(); }); }
      return el('div', { class: 'wmx-auc-mk wait' }, 'Moy. …');
    }
    const n = WMX.logic.priceNote(role, a.current_bid || a.base_amount, p);
    return el('div', { class: 'wmx-auc-mk ' + n.kind, title: n.title }, el('span', {}, n.avg), el('b', {}, n.verdict));
  }

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
        isWatch(a) ? el('span', { class: 'wmx-auc-state watch', title: 'Vous n’avez pas misé : l’extension misera au dernier moment si le prix reste sous votre plafond.' }, 'Surveillance')
          : el('span', { class: `wmx-auc-state ${lead ? 'ok' : 'ko'}` }, lead ? 'Vous menez' : 'Surenchéri'),
        timeEl(a),
        rule ? el('span', { class: 'wmx-auc-autotag', 'data-id': a.id }, WMX.logic.autoLabel(rule)) : '');
      // « Retirer » : une enchère surveillée (arrête la veille) ou dépassée (la masque de la bulle et arrête sa règle automatique). Pas sur une enchère que je mène.
      const rm = (isWatch(a) || !lead) ? el('button', { class: 'wmx-auc-rm', type: 'button', 'aria-label': 'Retirer',
        title: isWatch(a) ? 'Arrêter la surveillance et retirer de la liste' : 'Retirer de la liste (et arrêter sa mise automatique)' }, '×') : '';
      if (rm) rm.addEventListener('click', () => removeBid(a));
      side = el('div', { class: 'wmx-auc-side' },
        el('div', { class: 'wmx-auc-price' }, el('small', {}, 'Mise actuelle'), el('b', {}, `${fmt(a.current_bid || a.base_amount)} W`), avgChip(a, 'buy')),
        el('div', { class: 'wmx-auc-acts' }, rm, autoBtn, act));
      return el('div', { class: `wmx-auc-row${isWatch(a) ? ' watch' : ''}`, style: `--rgb:${WMX.RARITY_RGB[r]}` }, img, main, side, S.autoOpen === a.id ? autoForm(a) : '');
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
          a.current_bid ? el('small', {}, `Départ ${fmt(a.base_amount)} W`) : '',
          avgChip(a, 'sale')),
        act);
    }
    return el('div', { class: 'wmx-auc-row', style: `--rgb:${WMX.RARITY_RGB[r]}` }, img, main, side);
  }

  /** Ouvre l'onglet « Mes enchères » ou « Mes ventes » du Marché (navigation interne du jeu, puis clic sur l'onglet). */
  async function goMarket(tabRe) {
    toggleBubble(false);
    if (!/^\/marketplace\/?$/.test(location.pathname)) window.dispatchEvent(new CustomEvent('wmx:navigate', { detail: '/marketplace' }));
    const tab = await waitFor(() => [...document.querySelectorAll('button, [role=tab], a')].find((x) => !x.closest('.wmx-bubble') && tabRe.test(x.textContent.trim())), 20000, 200);
    tab?.click();
  }
  const column = (label, rows, tabRe, count = rows.length) => el('div', { class: 'wmx-auc-col' },
    el('h3', {}, el('a', { class: 'wmx-auc-h3link', href: '/marketplace', title: `Voir « ${label} » dans le Marché`, onclick: (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // laisse le navigateur ouvrir un onglet
      e.preventDefault(); goMarket(tabRe);
    } }, `${label} (${count}) ↗`)),
    el('div', { class: 'wmx-auc-list' }, ...rows));
  const note = (text) => el('p', { class: 'wmx-auc-note' }, text);

  /** Une enchère terminée reste 15 s à l'écran (« Terminée »), puis disparaît du tableau, sans attendre le règlement par le serveur. */
  const GRACE_MS = 15000;
  const shown = (a) => msLeft(a) > -GRACE_MS;
  const liveBids = () => D.bidding.filter((x) => msLeft(x) > 0 && !S.hidden[x.id]);
  const liveSales = () => D.selling.filter((x) => msLeft(x) > 0);
  const listSig = () => [...allBids(), ...D.selling].filter(shown).map((x) => x.id).join();

  function content() {
    // Dans « Mes enchères » : d'abord celles où j'ai misé, puis, sous un petit titre, les cartes que je surveille sans avoir misé (pas de troisième colonne).
    const byEnd = (a, b) => msLeft(a) - msLeft(b);
    const mineList = D.bidding.filter((a) => shown(a) && !S.hidden[a.id]).sort(byEnd);
    const watchList = allBids().filter((a) => isWatch(a) && shown(a)).sort(byEnd);
    const bids = [...mineList.map((a) => row(a, 'bid')),
      ...(watchList.length ? [el('p', { class: 'wmx-auc-sep', title: 'Vous n’avez pas misé sur ces cartes : l’extension misera au dernier moment, si le prix reste sous votre plafond.' }, 'Sous surveillance (rien de misé pour l’instant)'), ...watchList.map((a) => row(a, 'bid'))] : [])];
    const bidCount = mineList.length + watchList.length;
    const sells = D.selling.filter(shown).sort((a, b) => msLeft(a) - msLeft(b)).map((a) => row(a, 'sell'));
    // Panneau adaptatif : deux colonnes quand il y a des enchères ET des ventes ; une seule, plus étroite, sinon (pas de place vide ni de note
    // pour la partie absente : elle réapparaît dès qu'il y en a). Rien du tout : une seule note.
    const mode = bids.length && sells.length ? 'two' : (bids.length || sells.length ? 'one' : 'none');
    if (S.bubblePanel) { S.bubblePanel.dataset.mode = mode; applySize(); }
    const out = [];
    if (bids.length) out.push(column('Mes enchères', bids, /^Mes ench/i, bidCount));
    if (sells.length) out.push(column('Mes ventes', sells, /^Mes ventes/i));
    if (!out.length) out.push(note('Aucune enchère ni vente en cours pour le moment.'));
    return out;
  }

  /** Retire une enchère de la bulle : une veille s'arrête ; une enchère dépassée est masquée (jusqu'à ce que je la mène de nouveau) et sa règle automatique s'arrête. */
  function removeBid(a) {
    const watching = isWatch(a);
    delete S.auto[a.id]; delete S.autoTry[a.id]; delete S.draft[a.id];
    if (S.autoOpen === a.id) S.autoOpen = null;
    D.watching = D.watching.filter((w) => w.id !== a.id);
    saveAuto();
    if (!watching) { S.hidden[a.id] = Date.now(); WMX.store.set('hiddenBids', S.hidden); }
    pruneFrames();
    fire(); renderAll(); schedulePoll();
    WMX.notify?.({ kind: 'warn', key: `rm:${a.id}`, ms: 5000, title: watching ? 'Surveillance arrêtée' : 'Enchère retirée de la liste',
      text: watching ? `« ${cardTitle(a)} » n’est plus surveillée : rien ne sera misé.` : `« ${cardTitle(a)} » n’apparaît plus dans la bulle et sa mise automatique est arrêtée. Elle réapparaît si vous la menez de nouveau.` });
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
      const a = allBids().find((x) => x.id === b.dataset.id);
      if (!a) continue;
      const m = minOf(a);
      b.textContent = S.betting === a.id ? 'Mise en cours…' : leading(a) ? 'Vous menez' : (m ? `Surenchérir · ${fmt(m)} W` : 'Surenchérir');
      b.disabled = !!S.betting || leading(a) || msLeft(a) <= 0;
    }
    // Règle de mise automatique : le plafond en W, et pourquoi elle ne mise pas si le minimum du jeu le dépasse (le plafond vaut pour la mise PLACÉE).
    for (const t of document.querySelectorAll('.wmx-auc-autotag[data-id]')) {
      const a = allBids().find((x) => x.id === t.dataset.id);
      const rule = a && S.auto[a.id];
      if (!rule) continue;
      const capW = WMX.logic.resolveCap(rule, avgOf(a));
      const m = minOf(a) || (isWatch(a) ? (a.current_bid ? a.current_bid + 1 : a.base_amount) || null : null);
      const blocked = capW != null && m && m > capW && !leading(a);
      t.textContent = `${WMX.logic.autoLabel(rule)}${capW != null ? ` (${fmt(capW)} W)` : ''}${blocked ? ` · ⛔ minimum ${fmt(m)} W au-dessus` : ''}`;
      t.classList.toggle('warn', !!blocked);
      t.title = 'Le plafond s’applique à la mise que l’extension placerait (le minimum demandé par le jeu), pas au prix actuel : elle ne mise jamais au-dessus.';
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
    S.bubblePanel.style.maxWidth = S.pos ? 'calc(100vw - 16px)' : `calc(100vw - ${x + 16}px)`;
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
      S.bubbleHead = el('div', { class: 'wmx-bubble-head', title: 'Maintenez le clic pour déplacer · double-clic pour replacer' }, el('strong', {}, 'Enchères et ventes'),
        el('span', {},
          el('button', { class: 'wmx-qclear', title: 'Paramètres des enchères', onclick: () => WMX.openSettings() }, '⚙'),
          el('button', { class: 'wmx-qclear', title: 'Actualiser maintenant', onclick: refresh }, '↻'),
          el('button', { class: 'wmx-qclear', title: 'Réduire', onclick: () => toggleBubble(false) }, '×'))),
      S.bubbleBody, WMX.autoSell?.footer());
    S.bubblePanel = panel;
    enableDrag(S.bubbleHead);
    const foot = panel.querySelector('.wmx-as-line');
    if (foot) enableDrag(foot, centerPanel); // on peut aussi attraper le panneau par le bas ; double-clic : au milieu de la fenêtre
    addGrips(panel);
    window.addEventListener('resize', () => { applyPos(); keepReachable(); });
    new ResizeObserver(() => keepReachable()).observe(panel); // le contenu qui grandit (ventes chargées) ne doit pas pousser l'en-tête hors de l'écran
    WMX.store.get('auctionBubbleSize').then((s) => { if (s && typeof s === 'object') { S.size = s; applySize(); } }).catch(() => {});
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
      renderAll();
      applyPos();
      aimAtPill();
      void p.offsetWidth; // force le point de départ de la transition
      p.classList.add('open');
      S.pill.classList.add('on');
      setTimeout(keepReachable, 400); // après l'animation d'ouverture : l'en-tête doit être à l'écran
      refresh().then(prepareFrames); prepareFrames();
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
  /** Remet le panneau au milieu de la fenêtre (hauteur ramenée à la fenêtre si besoin) : sert quand l'en-tête est sorti de l'écran. */
  function centerPanel() {
    const p = S.bubblePanel;
    if (!p || p.hidden) return;
    if (p.offsetHeight > innerHeight - 16) { sizes().h = innerHeight - 16; applySize(); WMX.store.set('auctionBubbleSize', S.size); }
    S.pos = clampPos((innerWidth - p.offsetWidth) / 2, (innerHeight - p.offsetHeight) / 2, p);
    applyPos();
    WMX.store.set('auctionBubblePos', S.pos);
  }
  /** En-tête sorti de l'écran (par le haut ou les côtés) : le panneau ne pourrait plus être attrapé, on le recentre. */
  function keepReachable() {
    const p = S.bubblePanel;
    if (!p || p.hidden || !S.bubbleOpen) return;
    const r = p.getBoundingClientRect();
    if (r.width && (r.top < 0 || r.left < 0 || r.right > innerWidth + 1)) centerPanel();
  }
  function enableDrag(handle, onDoubleClick) {
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
    handle.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      if (onDoubleClick) return onDoubleClick();
      // double-clic sur l'en-tête : retour à l'emplacement d'origine
      S.pos = null;
      WMX.store.set('auctionBubblePos', null);
      const p = S.bubblePanel; p.classList.remove('moved'); p.style.left = p.style.top = '';
      setTimeout(keepReachable, 50);
    });
  }

  // Taille réglable : on attrape un bord du panneau (gauche, droit, haut ou bas). La largeur est mémorisée par disposition (deux colonnes / une / vide),
  // la hauteur est commune. Seul le CONTENU change de taille : l'en-tête (titre, réglages, actualiser, fermer) et la ligne de l'assistant de vente
  // restent affichés, la liste des enchères défile. Double-clic sur un bord : retour à la taille d'origine. Le bord haut garde le panneau collé à sa
  // pastille ; les bords gauche et bas le font passer en position libre (le bord opposé reste en place).
  const MIN_W = 300, MIN_H = 230;
  const sizes = () => (S.size ||= {});
  function applySize() {
    const p = S.bubblePanel;
    if (!p) return;
    const w = sizes()[p.dataset.mode];
    const h = sizes().h;
    p.style.width = w ? `${Math.min(w, innerWidth - 16)}px` : '';
    p.style.height = h ? `${Math.min(h, innerHeight - 16)}px` : '';
    if (h) p.style.maxHeight = 'none';
  }
  const GRIP_HINT = { l: 'la largeur', r: 'la largeur', t: 'la hauteur', b: 'la hauteur' };
  function addGrips(panel) {
    for (const side of ['l', 'r', 't', 'b']) {
      const g = el('div', { class: `wmx-bubble-grip ${side}`, title: `Glisser pour changer ${GRIP_HINT[side]} · double-clic : taille d’origine` });
      g.addEventListener('pointerdown', (e) => startResize(e, side, g));
      g.addEventListener('dblclick', () => {
        if (side === 't' || side === 'b') { delete sizes().h; panel.style.height = ''; panel.style.maxHeight = ''; } else delete sizes()[panel.dataset.mode];
        WMX.store.set('auctionBubbleSize', S.size); applySize();
      });
      panel.append(g);
    }
  }
  function startResize(e, side, grip) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = S.bubblePanel, r = p.getBoundingClientRect();
    const mode = p.dataset.mode || 'two';
    const startX = e.clientX, startY = e.clientY, w0 = r.width, h0 = r.height, left0 = r.left, top0 = r.top;
    const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(lo, v), Math.max(lo, hi)));
    grip.setPointerCapture?.(e.pointerId);
    p.classList.add('resizing');
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      p.style.maxWidth = 'calc(100vw - 16px)';
      let left = left0, top = top0, free = false;
      if (side === 'r' || side === 'l') {
        const w = side === 'r' ? clamp(w0 + dx, MIN_W, innerWidth - 8 - left0) : clamp(w0 - dx, MIN_W, left0 + w0 - 8);
        p.style.width = `${w}px`; sizes()[mode] = w;
        if (side === 'l') { left = Math.max(8, left0 + w0 - w); free = true; }
      } else {
        const h = side === 'b' ? clamp(h0 + dy, MIN_H, innerHeight - 8 - top0) : clamp(h0 - dy, MIN_H, top0 + h0 - 8);
        p.style.maxHeight = 'none'; p.style.height = `${h}px`; sizes().h = h;
        if (side === 'b') free = true;
        else if (p.classList.contains('moved')) { top = top0 + h0 - h; free = true; } // panneau libre : son bord bas reste en place
      }
      if (free) { S.pos = { x: left, y: top }; p.classList.add('moved'); p.style.left = `${left}px`; p.style.top = `${top}px`; }
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      p.classList.remove('resizing');
      WMX.store.set('auctionBubbleSize', S.size);
      if (S.pos) WMX.store.set('auctionBubblePos', S.pos);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /** Règle d'une veille : les réglages par défaut des mises automatiques, mais toujours « sous un délai » (jamais « dès surenchère », qui miserait aussitôt)
   *  et toujours avec un plafond (par défaut : moyenne du marché −20 %). */
  function watchRule() {
    const base = defaultInput();
    const input = { ...base, mode: 'time', amount: base.mode === 'time' ? base.amount : 30, unit: 's' };
    if (input.capMode === 'none') { input.capMode = 'avg'; input.capPct = -20; }
    return WMX.logic.parseAutoRule(input);
  }

  /** Utilisé par la page Marché : miser le minimum sur une enchère sans ouvrir sa page, ou la surveiller pour miser au dernier moment. */
  WMX.auctions = {
    refresh,
    /** 'watch' (surveillée), 'auto' (mise automatique ordinaire déjà réglée) ou 'none'. */
    watchState(id) { const r = S.auto[id]; return r ? (r.watch ? 'watch' : 'auto') : 'none'; },
    /** Texte court de la règle d'une veille, ex. « sous 35 s · max 120 W ». */
    watchInfo(id) {
      const r = S.auto[id];
      if (!r) return '';
      const a = allBids().find((x) => x.id === id);
      const capW = a ? WMX.logic.resolveCap(r, avgOf(a)) : null;
      return `${r.secs < 120 ? `sous ${r.secs} s` : `sous ${Math.round(r.secs / 60)} min`}${capW != null ? ` · max ${fmt(capW)} W` : (WMX.logic.capLabel(r) ? ` · ${WMX.logic.capLabel(r)}` : '')}`;
    },
    /** Démarre ou arrête la veille d'une enchère. Renvoie le nouvel état. */
    async toggleWatch(id, title = '') {
      const name = title || 'cette carte';
      const cur = S.auto[id];
      if (cur?.watch) {
        delete S.auto[id]; delete S.autoTry[id]; D.watching = D.watching.filter((w) => w.id !== id);
        saveAuto(); fire(); renderAll(); schedulePoll();
        WMX.notify?.({ kind: 'warn', title: 'Surveillance arrêtée', text: `« ${name} » n’est plus surveillée : rien ne sera misé.`, ms: 6000, key: `watch:${id}` });
        return 'none';
      }
      if (cur) { WMX.toast(`Une mise automatique est déjà réglée sur « ${name} » (à modifier dans « Mes enchères »).`); return 'auto'; }
      const max = Math.min(50, Math.max(1, Number(WMX.settings?.watchMax) || MAX_WATCH));
      if (Object.values(S.auto).filter((r) => r?.watch).length >= max) {
        WMX.notify?.({ kind: 'warn', key: 'watch-limit', ms: 9000, title: 'Limite de surveillances atteinte',
          text: `Vous surveillez déjà ${max} enchères. Arrêtez-en une, ou augmentez la limite dans les réglages (chaque surveillance ajoute des requêtes vers le jeu).`,
          action: { label: 'Modifier la limite', onClick: () => WMX.openSettings?.('Mises automatiques') } });
        return 'none';
      }
      const rule = watchRule();
      if (!rule) { WMX.toast('Je n’ai pas pu préparer la veille : vérifiez les réglages des mises automatiques (Paramètres).', 6000, { kind: 'warn' }); return 'none'; }
      S.auto[id] = { ...rule, watch: true };
      S.autoFails[id] = 0;
      saveAuto();
      await refreshWatching(true);
      const a = D.watching.find((w) => w.id === id);
      if (a && !WMX.prices.has(a.card_id)) WMX.prices.fetchOne(a.card_id).then(() => { if (S.bubbleOpen) renderAll(); });
      // Moyenne du marché inconnue (plafond « selon la moyenne ») : on la demande un court instant pour pouvoir juger tout de suite.
      if (a && rule.capMode === 'avg' && avgOf(a) == null) await Promise.race([WMX.prices.fetchOne(a.card_id), sleep(4000)]);
      const capW = a ? WMX.logic.resolveCap(rule, avgOf(a)) : null;
      // Le prix est déjà au-dessus du plafond : il ne redescendra pas, la veille ne servirait à rien. On l'explique au lieu de créer puis supprimer une règle.
      const price = a ? (a.current_bid ? a.current_bid + 1 : a.base_amount) : 0;
      if (a && capW != null && price > capW) {
        delete S.auto[id]; delete S.autoTry[id]; D.watching = D.watching.filter((w) => w.id !== id);
        saveAuto(); fire(); renderAll(); schedulePoll();
        capNotice(a, a.current_bid || a.base_amount, capW, rule, { starting: true });
        return 'none';
      }
      const secs = rule.secs < 120 ? `${rule.secs} s` : `${Math.round(rule.secs / 60)} min`;
      WMX.notify?.({ kind: 'warn', ms: 9000, key: `watch:${id}`, title: `« ${a ? cardTitle(a) : name} » est surveillée`,
        text: `Je ne mise pas maintenant. Je miserai quand il restera ${secs}, seulement si le prix reste sous ${capW != null ? `${fmt(capW)} W` : `votre plafond (${WMX.logic.capLabel(rule)})`}. Sinon, je laisse tomber.` });
      fire(); renderAll(); schedulePoll();
      return 'watch';
    },
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
    /** File des surenchères (pastille de la file d'attente) : la mise en cours, puis celles qui attendent. */
    queued() {
      const info = (a, current) => ({ id: a.id, title: cardTitle(a), rarity: a.card ? rarityOf(a) : '', current });
      const cur = S.betting ? [info(D.bidding.find((x) => x.id === S.betting) || { id: S.betting }, true)] : [];
      return [...cur, ...S.bidQueue.filter((a) => a.id !== S.betting).map((a) => info(a, false))];
    },
    removeQueued(id) { S.bidQueue = S.bidQueue.filter((a) => a.id !== id || a.id === S.betting); fire(); },
    clearQueued() { S.bidQueue = S.bidQueue.filter((a) => a.id === S.betting); fire(); },
  };

  WMX.register({
    name: 'auctions',
    init() {
      buildBubble();
      WMX.quick?.onChange(() => { clearTimeout(S.qT); S.qT = setTimeout(() => { if (WMX.alive()) refresh(); }, 900); });
      // Élection du « chef » : un seul onglet du jeu exécute les mises automatiques (sinon chaque onglet miserait de son côté).
      // L'onglet affiché prend le rôle (un onglet en arrière-plan voit ses minuteries ralenties par le navigateur : il ne tiendrait pas un délai de 15 s).
      const takeLead = (steal) => navigator.locks.request('wmx-auto-leader', steal ? { steal: true } : {}, () => {
        S.leader = true;
        // Le rôle est rendu dès que ce script est orphelin (extension rechargée) : un onglet actualisé peut alors le reprendre.
        return new Promise((done) => { const t = setInterval(() => { if (!WMX.alive() || !S.leader) { clearInterval(t); S.leader = false; done(); } }, 2000); });
      }).catch((e) => { S.leader = e?.name === 'AbortError' ? false : true; }); // AbortError : un autre onglet, affiché, a pris le rôle
      if (navigator.locks?.request) {
        takeLead(false);
        const claim = () => { if (!document.hidden && !S.leader && WMX.alive() && Object.keys(S.auto).length) takeLead(true); };
        document.addEventListener('visibilitychange', claim);
        setTimeout(claim, 4000); // onglet ouvert directement au premier plan alors qu'un onglet masqué tient déjà le rôle
      } else S.leader = true;
      WMX.store.get('hiddenBids', {}).then((r) => { S.hidden = r && typeof r === 'object' ? r : {}; renderAll(); }).catch(() => {});
      WMX.store.get('autoBids', {}).then((r) => { S.auto = r || {}; refreshWatching(true).then(() => { renderAll(); fire(); }).catch(() => {}); });
      // Les règles créées ou modifiées dans un autre onglet arrivent ici : sans cela, l'onglet « chef » ignorerait les règles créées ailleurs.
      WMX.onStorage((c) => {
        if (!c.autoBids) return;
        const next = c.autoBids.newValue || {};
        if (JSON.stringify(next) === JSON.stringify(S.auto)) return;
        S.auto = next; renderAll(); schedulePoll();
        refreshWatching().then(() => { renderAll(); fire(); }).catch(() => {}); // une veille créée dans un autre onglet : on lit tout de suite l'enchère
      });
      setInterval(() => { if (WMX.alive()) tick(); }, 1000);
      // Pas de requête ici : on décide seulement, plus souvent, avec les données déjà chargées (réaction plus rapide dans la dernière minute).
      setInterval(() => { if (WMX.alive() && D.loaded && Object.keys(S.auto).length) runAuto(); }, 400);
      // Premier chargement : réessayé de plus en plus espacé tant qu'il échoue (jeu lent ou erreur passagère), au lieu d'attendre la minute suivante.
      setTimeout(async () => {
        for (let n = 0; n < 15 && !D.loaded && WMX.alive(); n++) { await refresh(); if (!D.loaded) await sleep(Math.min(30000, 4000 + n * 3000)); }
        schedulePoll();
      }, 3000);
    },
  });
})();
