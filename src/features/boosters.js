// Ouverture groupée / automatique. Pilote le bouton natif « Ouvrir » (le flux du jeu, y compris
// sa vérification humaine, reste intact) et capte les cartes dans la réponse /api/packs/open.
// La vérification humaine n'est JAMAIS touchée : on attend qu'elle disparaisse.
(() => {
  const { el, findExact, sleep } = WMX.dom;
  const state = { busy: false, auto: false, buffer: [], opened: 0, loopId: 0, nextAt: null, par: null }; // par : ouverture en parallèle en cours { done, total, cards, stop }
  let lastCards = null;
  const ui = {};

  WMX.settings = { ...WMX.DEFAULTS };
  // Réglages enregistrés : chargés sur toutes les pages (le bouton ⚡ de la collection lit l'écart du prix de départ, par exemple).
  WMX.store.get('wmxSettings', {}).then((s) => Object.assign(WMX.settings, WMX.migrateSettings(s)));
  const rank = (r) => WMX.RARITIES.length - 1 - WMX.RARITIES.indexOf(r); // C = 0 … L = 5

  let openError = null; // dernière réponse d'erreur (ex. 429) à l'ouverture d'un paquet
  let dailyLimit = false;
  WMX.onApi(({ path, method, status, data }) => {
    if (method !== 'POST' || path !== '/api/packs/open') return;
    if (data?.cards) { lastCards = data.cards; WMX.prices.prefetch?.(data.cards); } // prix récupérés pendant la pause entre paquets
    // Toute autre réponse est un refus ou une panne : limite de débit (429), blocage « automatisation » (403 automation_limit), erreur du serveur (5xx),
    // page d'erreur illisible ou réseau coupé (statut 0). Avant, seuls les 429 étaient vus : les autres laissaient l'ouverture attendre 3 min sans rien dire.
    else openError = { t: Date.now(), status, data: data || {} };
  });

  // Pause entre deux paquets : 0,3 s (un humain enchaîne ses paquets au moins aussi vite ; la vérification humaine arrive de toute façon).
  // Chaque fois que le jeu refuse une ouverture trop rapprochée, la pause passe au palier suivant : 0,5 s, puis 1 s, puis 1,5 s (au plus),
  // pour le reste de CETTE ouverture ; sans refus, on garde 0,3 s. La suivante (« Tout ouvrir », ou la prochaine ouverture auto) repart de 0,3 s.
  const COOLDOWN_STEPS_S = [0.3, 0.5, 1, 1.5];
  const BASE_COOLDOWN_S = COOLDOWN_STEPS_S[0];
  let cooldownS = BASE_COOLDOWN_S;
  let blocks = 0;       // refus consécutifs : la pause s'allonge d'1 s à chaque refus, puis repart de la pause de base (cooldownS) au premier succès

  /** Indication `retry_after` du jeu en secondes (nombre, « 5 s », « 2 min » ou date), ou null si illisible. */
  const retryHint = (v) => {
    const s = String(v ?? '');
    const n = Number(s.match(/\d+(\.\d+)?/)?.[0]);
    if (/^\s*\d+(\.\d+)?\s*(s|sec|secondes?)?\s*$/i.test(s)) return n;
    if (/min/i.test(s) && n) return n * 60;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : Math.max(1, (t - Date.now()) / 1000);
  };

  // --- Où l'ouverture a lieu ----------------------------------------------------------------------
  // CTX null : la page principale (page Paquets affichée). Ouverture en parallèle : une page Paquets INVISIBLE (cadre « #wmx-pulls ») où
  // l'extension clique « Ouvrir » ; vous pouvez utiliser le jeu pendant ce temps. Ses requêtes sont relayées par frame-hook.js (postMessage)
  // et remises dans le circuit habituel (wmx:start / wmx:api) : cartes tirées, statistiques et copie de la collection comme d'habitude.
  let CTX = null;
  const D = () => (CTX ? CTX.doc() : document) || document;
  const bodyText = () => { try { return D().body?.innerText || ''; } catch (_) { return ''; } };
  window.addEventListener('message', (e) => {
    if (!CTX || e.origin !== location.origin || e.source !== CTX.win()) return;
    let d = null;
    try { d = JSON.parse(String(e.data)); } catch (_) { return; }
    if (d?.wmx !== 'pulls') return;
    if (d.t === 'start') window.dispatchEvent(new CustomEvent('wmx:start', { detail: { url: d.url } }));
    else if (d.t === 'api') window.dispatchEvent(new CustomEvent('wmx:api', { detail: { url: d.url, method: d.method, status: d.status, data: d.data, req: null } }));
  });
  /** Page Paquets invisible, prête quand son bouton « Ouvrir » et son compteur sont affichés ; null si elle ne se charge pas. */
  async function pullsFrame() {
    const f = el('iframe', { class: 'wmx-sheet-frame wmx-pulls-frame', src: '/pulls#wmx-pulls', title: 'Paquets (ouverture en parallèle)', tabindex: '-1' });
    document.body.append(f);
    const doc = () => { try { return f.contentDocument; } catch (_) { return null; } };
    const ok = await WMX.dom.waitFor(() => {
      const d = doc();
      return d?.body && /\d+\s*\/\s*\d+\s*paquets?/i.test(d.body.innerText || '') && [...d.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase() === 'ouvrir');
    }, 40000, 300);
    if (!ok) { f.remove(); return null; }
    return {
      frame: f, doc, win: () => f.contentWindow,
      /** Vérification humaine du jeu : la page invisible apparaît au centre de l'écran, le temps de la faire. */
      human(on) { f.classList.toggle('wmx-on', !!on); f.classList.toggle('wmx-human', !!on); },
      close() { f.remove(); },
    };
  }

  // --- Lecture de l'état du jeu --------------------------------------------------------------
  const packInfo = () => {
    const m = bodyText().match(/(\d+)\s*\/\s*(\d+)\s*paquets?/i);
    if (!m) return { packs: 0, max: WMX.logic.PACK_MAX };
    const max = WMX.logic.packMax(m[2]); // stock maximum affiché par le jeu (« 3 / 20 paquets »)
    return { packs: Math.min(max, Number(m[1])), max };
  };
  const packsLeft = () => packInfo().packs;
  const nextPackIn = () => {
    const m = bodyText().match(/Prochain dans\s*(\d+):(\d{2})/i);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const humanCheck = () => /vérification rapide/i.test(bodyText());
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Recharge d'un paquet : 3 min en compte Pro, 10 min en compte classique (stock maximum lu sur la page : « N / M paquets »). Le type de compte est lu sur
  // la page Paquets (encadré « Pack PRO du jour » = Pro ; proposition de passer Pro, ou encadré absent = classique) et mémorisé.
  let account = 'classic';
  const regenS = () => WMX.logic.packRegen(account);
  let noProSeen = 0; // lectures de la page Paquets d'affilée sans encadré Pro : classique seulement après plusieurs (la page peut finir de s'afficher)
  const readAccount = () => {
    const found = WMX.logic.packAccount(document.body.innerText);
    if (found === 'pro' || found === 'classic') noProSeen = 0;
    let next = found;
    if (!found && /paquets?\s+disponibles/i.test(document.body.innerText)) next = ++noProSeen >= 5 ? 'classic' : null;
    if (next && next !== account) { account = next; WMX.store.set('packAccount', { type: account, t: Date.now() }); }
    return account;
  };

  /** Stock de paquets vu pour la dernière fois (mémorisé, avec l'heure exacte du prochain paquet) : estimation affichée hors de la page Paquets. */
  const estimateSeen = (s) => {
    const e = WMX.logic.packEstimate(s, Date.now(), regenS());
    return e && { ...e, est: true };
  };

  const setStatus = (t) => { if (ui.status) ui.status.textContent = t; };
  /** Compteur rouge sur la bulle « W » : nombre de paquets ouverts pendant l'auto. */
  const setBadge = () => {
    // Ouverture auto : paquets ouverts ; ouverture en parallèle : cartes tirées (révélées à la fin).
    for (const c of [ui.fabCount, ui.fabCount2]) { c.hidden = !state.auto && !state.par; c.textContent = String(state.par ? state.par.cards.length : state.opened); }
  };
  let refreshDial = () => {}; // redessine le cadran (défini à sa construction)
  let recordSeen = () => {};  // note un relevé du stock (page Paquets invisible) : base de l'estimation du cadran sur les autres pages
  let getEstimate = () => null; // stock estimé hors de la page Paquets ({ packs, max, nextIn, est }) ou null
  /** « Tout ouvrir » devient « Arrêter l'ouverture » pendant une ouverture en parallèle. */
  const setAllBtn = () => {
    if (!ui.allBtn) return;
    ui.allBtn.textContent = state.par ? 'Arrêter l’ouverture' : 'Tout ouvrir';
    ui.allBtn.classList.toggle('wmx-btn--danger', !!state.par);
  };
  const stopParallel = () => { if (state.par) { state.par.stop = true; setStatus('Arrêt après le paquet en cours…'); } };
  const setAutoBtn = () => {
    // Boutons côte à côte : libellés courts.
    ui.autoBtn.textContent = state.auto ? 'Arrêter' : 'Ouvrir auto';
    ui.autoBtn.classList.toggle('wmx-btn--danger', state.auto);
    document.documentElement.classList.toggle('wmx-auto-on', state.auto); // le menu reste visible (réduit) sur les autres pages tant que l'auto tourne
  };

  // --- Ouverture d'un paquet via l'interface native ------------------------------------------
  /** Revient à l'écran « Ouvrir » : flèche ronde pour passer les cartes, puis « Continuer ». */
  async function dismissResult() {
    // On ignore notre interface, dont l'image figée (qui contient une copie du bouton « Ouvrir »).
    const outside = (e) => !e.closest('.wmx-panel, .wmx-overlay, .wmx-cover');
    const nativeOpen = () => [...D().querySelectorAll('button')].find((b) => outside(b) && b.textContent.trim().toLowerCase() === 'ouvrir');
    for (let i = 0; i < 250; i++) {
      if (nativeOpen()) return true; // même désactivé : après le dernier paquet il reste grisé
      const cont = CTX ? [...D().querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === 'continuer') : findExact('continuer', 'button');
      if (cont && !cont.disabled && outside(cont)) cont.click();
      else {
        const arrows = [...D().querySelectorAll('button')]
          .filter((b) => outside(b) && !b.textContent.trim() && /w-12/.test(b.className) && /rounded-full/.test(b.className) && !b.disabled);
        arrows.at(-1)?.click();
      }
      await sleep(120);
    }
    return false;
  }

  /**
   * Pendant l'ouverture, on masque l'écran de résultat natif (pour ne pas spoiler les cartes) avec une
   * image figée de la page « Paquets » plutôt qu'un écran noir ; le compteur y est décrémenté dès que
   * le paquet est consommé.
   */
  function makeSnapshot(btn, packs) {
    const cover = document.querySelector('.wmx-cover');
    let root = btn;
    while (root && !/\bflex-1\b[^]*\bp-4\b/.test(String(root.className))) root = root.parentElement;
    if (!root || !cover) return null;
    const clone = root.cloneNode(true);
    clone.setAttribute('inert', '');
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    clone.style.cssText = 'width:100%;pointer-events:none';
    cover.replaceChildren(clone);
    return { clone, packs };
  }
  function consumeInSnapshot(snap) {
    if (!snap) return;
    const n = String(snap.packs);
    const leaf = [...snap.clone.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === n
      && /\d+\s*\/\s*\d+/.test(e.parentElement?.textContent || '') && /paquets?/i.test(e.parentElement?.parentElement?.textContent || ''));
    if (leaf) leaf.textContent = String(Math.max(0, snap.packs - 1));
  }

  /** Délai sans réponse du jeu à une ouverture partie (hors vérification humaine) avant de la considérer perdue et de réessayer. */
  const noAnswerMs = () => WMX.packNoAnswerMs || 20000; // réglable pour les tests
  /** Ouverture en cours arrêtée par l'utilisateur (« Passer » de l'écran de révélation). */
  const stopped = (session) => !!session?.stopped;

  async function openOne(session) {
    const btn = [...D().querySelectorAll('button')]
      .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
    if (!btn) return null;
    lastCards = null;
    const snap = CTX ? null : makeSnapshot(btn, packsLeft()); // page invisible : rien à masquer
    if (!CTX) document.documentElement.classList.add('wmx-opening');
    btn.click();
    let clickedAt = Date.now();
    openError = null;
    const sent = () => (WMX.apiStarts || []).some((a) => a.t >= clickedAt && /packs\/open/.test(a.path)); // la demande d'ouverture est partie
    const end = Date.now() + 180000; // laisse le temps à la vérification humaine, faite par l'utilisateur
    let stopAt = 0;
    while (!lastCards && Date.now() < end) {
      // « Passer » : on n'ouvre plus rien. Une ouverture déjà partie a encore quelques secondes pour répondre (ses cartes ne sont pas perdues).
      if (stopped(session)) {
        stopAt ||= Date.now();
        if (!sent() || openError || Date.now() - stopAt > 8000) break;
        await sleep(100);
        continue;
      }
      // Le jeu refuse l'ouverture (limite de débit) : on attend le délai indiqué puis on réessaie, ou on s'arrête.
      // Réponse qui demande la vérification humaine du jeu : ce n'est pas une panne, on attend que l'utilisateur la fasse (jamais de nouveau clic).
      if (openError && (humanCheck() || /human|v[ée]rif|captcha|challenge|turnstile/i.test(JSON.stringify(openError.data || {})))) openError = null;
      if (openError && openError.t >= clickedAt) {
        const d = { ...(openError.data || {}), _status: openError.status };
        openError = null;
        // Réponse exacte du serveur gardée dans le journal (la première de chaque ouverture) : c'est elle qui dit s'il s'agit d'un refus « trop rapide »
        // ou d'une vraie limite du jour (le code de la page du jeu, lui, ne connaît aucune limite quotidienne des paquets).
        if (!blocks || d.rate_limit_daily) WMX.journal?.add('Paquets', `le jeu refuse l’ouverture (${errLabel(d)}) : ${JSON.stringify(d).slice(0, 300)}`, 'warn');
        if (d.rate_limit_daily) {
          dailyLimit = true;
          const msg = String(d.error || d.message || '').trim();
          setStatus(`Le jeu indique une limite d’ouvertures pour aujourd’hui${msg ? ` : « ${msg} »` : ''}`);
          break;
        }
        blocks += 1;
        if (blocks === 1) { // le jeu a refusé cette pause : palier suivant pour le reste de cette ouverture (0,3 → 0,5 → 1 → 1,5 s)
          cooldownS = COOLDOWN_STEPS_S.find((v) => v > cooldownS) ?? COOLDOWN_STEPS_S[COOLDOWN_STEPS_S.length - 1];
          WMX.journal?.add('Paquets', `ouverture trop rapide selon le jeu : pause entre paquets portée à ${String(cooldownS).replace('.', ',')} s`);
        }
        if (blocks > 15) { setStatus('Le jeu refuse l’ouverture : arrêt'); break; }
        // Attente = pause de base + 1 s par refus consécutif (4, 5, 6… s), au moins ce que demande le jeu. Blocage « automatisation » : 30 s.
        const auto = d.code === 'automation_limit' || /automatis/i.test(String(d.error || d.message || ''));
        const rate = status429(d);
        const waitS = auto ? 30 : Math.min(120, Math.max(cooldownS + blocks, retryHint(d.retry_after) ?? 0));
        const why = auto ? 'Le jeu bloque les actions automatisées' : rate ? 'Ouverture trop rapide' : `Le jeu ne répond pas (${errLabel(d)})`;
        for (let s = Math.ceil(waitS); s > 0 && !lastCards && !stopped(session); s--) {
          setStatus(`${why} : nouvel essai dans ${s} s`);
          session?.setNote(`${auto ? 'blocage du jeu' : rate ? 'attente' : 'erreur du jeu'}, nouvel essai dans ${s} s`);
          await sleep(1000);
        }
        if (stopped(session)) break;
        session?.setNote('');
        const retry = [...D().querySelectorAll('button')]
          .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
        if (retry) retry.click();
        clickedAt = Date.now();
        continue;
      }
      const hc = humanCheck();
      session?.yield(hc); // l'écran de révélation s'efface pour laisser la vérification du jeu cliquable
      CTX?.human(hc); // page invisible : elle s'affiche au centre le temps de la vérification
      setStatus(hc ? 'Vérification du jeu : cliquez-la si besoin…' : 'Ouverture…');
      // Clic perdu (le jeu n'était pas encore prêt) : aucune requête d'ouverture n'est partie et le bouton est
      // toujours là, on recommence au lieu d'attendre indéfiniment.
      if (!hc && Date.now() - clickedAt > 2500 && !(WMX.apiStarts || []).some((a) => a.t >= clickedAt && /human-check|packs\/open/.test(a.path))) {
        const again = [...D().querySelectorAll('button')]
          .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
        if (again) again.click();
        clickedAt = Date.now();
      }
      // Demande partie mais restée sans réponse (serveur qui ne répond plus) : on le dit, puis on réessaie au lieu d'attendre 3 min en silence.
      if (!hc && sent()) {
        const waited = Date.now() - clickedAt;
        if (waited > 5000) session?.setNote(`le jeu ne répond pas depuis ${Math.round(waited / 1000)} s`);
        if (waited > noAnswerMs()) {
          WMX.journal?.add('Paquets', `aucune réponse du jeu ${Math.round(waited / 1000)} s après l’ouverture : nouvel essai`, 'warn');
          session?.setNote('');
          const again = [...D().querySelectorAll('button')]
            .find((b) => !b.disabled && !b.closest('.wmx-cover, .wmx-panel') && b.textContent.trim().toLowerCase() === 'ouvrir');
          if (again) again.click();
          clickedAt = Date.now();
        }
      }
      await sleep(100);
    }
    session?.yield(false);
    CTX?.human(false);
    const cards = lastCards;
    if (cards) { blocks = 0; consumeInSnapshot(snap); } // succès : la pause repart de sa valeur de base
    const ok = !cards || (await dismissResult());
    if (ok && cards) await sleep(300); // laisse l'écran « Ouvrir » du jeu se remettre en place avant le clic suivant
    if (!CTX) { document.documentElement.classList.remove('wmx-opening'); document.querySelector('.wmx-cover')?.replaceChildren(); }
    if (!ok) { setStatus('Écran de résultat inattendu : arrêt'); state.busy = false; state.auto = false; persistAuto(); }
    return cards;
  }

  /** Réponse de limite de débit (« trop rapide ») ? */
  function status429(d) { return d._status === 429 || !!d.rate_limited; }
  /** Libellé court d'une réponse d'erreur du jeu, pour le journal et l'écran : « 429 », « 403 automation_limit », « 502 », « réseau ». */
  function errLabel(d) { return d._status ? `${d._status}${d.code ? ` ${d.code}` : ''}` : 'réseau'; }

  /** Pause obligatoire entre deux paquets, visible dans le panneau et sur l'écran de révélation. */
  async function cooldown(session) {
    const end = Date.now() + cooldownS * 1000;
    for (let left = end - Date.now(); left > 0 && (state.busy || state.auto) && !stopped(session); left = end - Date.now()) {
      const s = String(Math.round(left / 100) / 10).replace('.', ','); // « 1,5 s », « 0,5 s »
      session?.setNote(`pause ${s} s`);
      setStatus(`Pause de ${s} s avant le paquet suivant`);
      await sleep(Math.min(500, left));
    }
    session?.setNote('');
  }

  // --- « Tout ouvrir » -----------------------------------------------------------------------
  /**
   * Ouverture en parallèle : la progression est sur le cadran des paquets (anneau « 2/5 ouverts », pastille du nombre de cartes tirées) et
   * « Tout ouvrir » devient « Arrêter l'ouverture ». Les cartes s'alignent ensuite dans l'écran de révélation habituel, à la fin. Elles sont
   * gardées (pendingCards) si la page est rechargée en cours de route : la reprise les montre.
   */
  function parallelRun(total) {
    state.par = { done: 0, total, cards: [], stop: false };
    setBadge(); setAllBtn(); refreshDial();
    return {
      get stopped() { return !!state.par?.stop; },
      addPack(cards) {
        state.par.cards.push(...cards);
        state.par.done += 1;
        WMX.store.set('pendingCards', state.par.cards);
        WMX.prices.prefetch?.(cards); // moyennes chargées pendant l'ouverture : prêtes pour la révélation
        setBadge(); refreshDial();
      },
      setRemaining() {},
      setNote(t) { if (t) setStatus(t); },
      yield() {},
      async finish() {
        const cards = state.par?.cards || [];
        state.par = null;
        setBadge(); setAllBtn(); refreshDial();
        if (cards.length) await WMX.reveal(cards);
      },
    };
  }

  /** « Tout ouvrir », dans la page Paquets invisible si « Ouverture en parallèle » est activée (par défaut), sinon sur la page Paquets. */
  async function openAll({ parallel = WMX.settings.openParallel !== false } = {}) {
    if (state.auto) { setStatus('Arrêtez d’abord l’ouverture auto'); return; }
    if (state.busy) return;
    state.busy = true;
    if (parallel) {
      setStatus('Préparation de l’ouverture en parallèle…');
      CTX = await pullsFrame();
      if (!CTX) { state.busy = false; setStatus('La page Paquets invisible ne s’est pas chargée : réessayez, ou désactivez « Ouverture en parallèle »'); return; }
    }
    // Le compteur « N / M paquets » du jeu peut s'afficher d'abord à 0 le temps que la page lise votre stock : on lui laisse 4 s
    // (sinon « Aucun paquet disponible » avec un paquet en stock).
    let total = packsLeft();
    for (let i = 0; i < 10 && !total; i++) { await sleep(400); total = packsLeft(); }
    if (!total) { state.busy = false; CTX?.close(); CTX = null; setStatus('Aucun paquet disponible'); return; }
    cooldownS = BASE_COOLDOWN_S; // chaque « Tout ouvrir » repart de la pause courte
    const session = parallel ? parallelRun(total) : WMX.revealSession({ stoppable: true });
    session.setRemaining(total, total);
    let opened = 0;
    try {
      for (let done = 0; done < total && state.busy && !session.stopped; done++) {
        const cards = await openOne(session);
        if (!cards) break;
        opened += 1;
        session.addPack(cards);
        session.setRemaining(total - done - 1, total);
        if (done < total - 1) await cooldown(session);
      }
    } finally { state.busy = false; setStatus(''); CTX?.close(); CTX = null; }
    if (parallel && session.stopped) setStatus('Ouverture arrêtée : les paquets restants sont gardés');
    // « Passer » pendant l'ouverture : les paquets restants ne sont pas ouverts, ils restent dans le stock du jeu.
    if (session.stopped && opened < total) {
      const left = total - opened;
      WMX.journal?.add('Paquets', `ouverture arrêtée par « Passer » : ${opened} paquet${opened > 1 ? 's' : ''} ouvert${opened > 1 ? 's' : ''}, ${left} gardé${left > 1 ? 's' : ''} pour plus tard`);
      session.setNote(`arrêtée : ${left} paquet${left > 1 ? 's' : ''} gardé${left > 1 ? 's' : ''} pour plus tard`);
    }
    await session.finish();
  }

  /** « Tout ouvrir » depuis une autre page : on revient d'abord sur la page Paquets, puis on ouvre. */
  async function openAllAnywhere() {
    if (WMX.settings.openParallel) return openAll(); // ouverture en parallèle : depuis n'importe quelle page, sans la quitter
    if (!/^\/pulls/.test(location.pathname)) {
      window.dispatchEvent(new CustomEvent('wmx:navigate', { detail: '/pulls' }));
      setStatus('Retour sur la page Paquets…');
      const ok = await WMX.dom.waitFor(() => /^\/pulls/.test(location.pathname) && packInfo().max > 0 && document.body.innerText.match(/paquets?/i), 40000, 400);
      if (!ok) { setStatus('Page Paquets introuvable'); return; }
      await sleep(1500);
    }
    return openAll();
  }

  // --- Ouverture automatique ------------------------------------------------------------------
  /** Ouvre `n` paquets et les met de côté ; s'arrête si une carte atteint le seuil choisi. */
  async function openBatch(n) {
    cooldownS = BASE_COOLDOWN_S; // chaque ouverture auto repart de la pause courte
    for (let i = 0; i < n && state.auto; i++) {
      if (i > 0) await cooldown();
      if (!state.auto) return;
      state.busy = true;
      const cards = await openOne();
      state.busy = false;
      if (!cards) {
        if (dailyLimit) { dailyLimit = false; stopAuto(); setStatus('Ouverture auto arrêtée : le jeu indique une limite d’ouvertures pour aujourd’hui (réponse du jeu dans le journal)'); } // remis à zéro : une prochaine ouverture repart normalement
        return;
      }
      state.buffer.push(...cards);
      state.opened += 1;
      persistAuto(); // les cartes mises de côté survivent à un rechargement de la page
      setBadge();
      const stop = WMX.settings.stopOn;
      if (stop !== 'off' && cards.some((c) => rank(WMX.normRarity(c.rarity)) >= rank(stop))) { stopAuto(); return; }
    }
  }

  /** Durée tirée au hasard entre les deux bornes de l'intervalle (en ms). */
  function nextInterval() { return rand(Number(ui.min.value), Number(ui.max.value)) * 60000; }
  /** Fixe l'échéance de la prochaine ouverture (une seule pour toute la page, mémorisée avec l'état de l'ouverture auto). */
  function setNextAt(t) { state.nextAt = t; persistAuto(); }

  /**
   * Boucle de l'ouverture auto. `initialNextAt` : échéance déjà connue (reprise après un rechargement de la page), sinon une nouvelle est tirée.
   * Une seule boucle est active à la fois : toute nouvelle boucle met fin à la précédente (`loopId`), même après « Arrêter » puis « Ouvrir auto » en un instant.
   */
  async function autoLoop(initialNextAt = null) {
    const id = ++state.loopId;
    setNextAt(Number.isFinite(initialNextAt) ? initialNextAt : Date.now() + nextInterval());
    let lastBeat = Date.now();
    while (state.auto && id === state.loopId) {
      await sleep(1000);
      if (id !== state.loopId) break; // une autre boucle a pris le relais
      if (Date.now() - lastBeat > 15000) { lastBeat = Date.now(); persistAuto(); } // « toujours en cours » : sert à décider de la reprise après un rechargement
      if (!WMX.alive()) { // extension rechargée : ce script orphelin s'arrête et retire son interface
        state.auto = false;
        document.querySelectorAll('.wmx-panel, .wmx-cover').forEach((e) => e.remove());
        break;
      }
      if (!state.auto) break;
      if (state.busy) continue;
      // Hors de la page Paquets : avec l'ouverture en parallèle (par défaut), le compte à rebours continue sur n'importe quelle page et, à
      // l'échéance, les paquets s'ouvrent dans une page Paquets invisible ; sans elle, l'ouverture attend le retour sur la page Paquets.
      const onPulls = /^\/pulls/.test(location.pathname);
      const par = WMX.settings.openParallel !== false;
      if (!onPulls && !par) {
        const w = (state.nextAt - Date.now()) / 1000;
        setStatus(w > 0 ? `Prochaine ouverture dans ${mmss(w)} · elle se fera sur la page Paquets` : 'Ouverture prête : retournez sur la page Paquets');
        continue;
      }
      let packs; let max; let nextIn;
      if (onPulls) { ({ packs, max } = packInfo()); nextIn = nextPackIn(); } else {
        const e = getEstimate(); // relevé de la dernière visite (ou de la dernière ouverture invisible), recalculé chaque seconde
        packs = e ? e.packs : null; max = e?.max || WMX.logic.PACK_MAX; nextIn = e ? e.nextIn : null;
      }
      const cfg = WMX.settings;
      const reserve = Math.min(cfg.reserve, max - 1);
      const wait = (state.nextAt - Date.now()) / 1000;
      let toOpen = 0;
      let why = '';
      // À chaque échéance : on ouvre TOUS les paquets disponibles au-dessus de la réserve, pour ne jamais atteindre le maximum.
      const ready = Math.max(0, (packs ?? 0) - reserve);
      if (packs == null) { if (wait <= 0) toOpen = -1; } // stock inconnu (page Paquets jamais visitée) : on le lit à l'échéance
      else if (packs >= max && cfg.fullStockOpen) { toOpen = ready; why = 'stock plein'; }
      else if (ready > 0) {
        if (wait <= 0) toOpen = ready;
        else if (cfg.anticipate && nextIn != null && nextIn + (max - packs - 1) * regenS() <= wait + 60) { toOpen = ready; why = 'avant blocage du stock'; }
      }
      if (toOpen !== 0 && !onPulls) {
        await autoInvisible(reserve, why);
        setNextAt(Date.now() + nextInterval());
      } else if (toOpen > 0) {
        setStatus(why ? `Ouverture anticipée (${why})` : 'Ouverture…');
        await openBatch(toOpen);
        setNextAt(Date.now() + nextInterval());
      } else if (state.auto) {
        const where = onPulls ? '' : ' · en parallèle';
        setStatus(packs == null ? `Prochaine ouverture dans ${mmss(Math.max(0, wait))}${where}`
          : `Prochaine ouverture dans ${mmss(Math.max(0, wait))} · ${onPulls ? '' : '~'}${packs} paquet${packs > 1 ? 's' : ''} en attente${ready === 0 && packs > 0 ? ' (réserve)' : ''}${where}`);
      }
    }
  }

  /**
   * Ouverture auto depuis une autre page que Paquets (ouverture en parallèle) : page Paquets invisible, lecture du VRAI stock, ouverture des
   * paquets au-dessus de la réserve, puis nouveau relevé du stock pour le cadran (nombre de paquets à jour sans revenir sur la page Paquets).
   */
  async function autoInvisible(reserve, why) {
    setStatus(why ? `Ouverture anticipée en parallèle (${why})…` : 'Ouverture auto en parallèle…');
    state.busy = true;
    CTX = await pullsFrame();
    state.busy = false;
    if (!CTX) { setStatus('Page Paquets invisible indisponible : nouvel essai à la prochaine échéance'); return; }
    try {
      let real = packsLeft();
      for (let i = 0; i < 10 && !real; i++) { await sleep(400); real = packsLeft(); } // compteur du jeu d'abord à 0, le temps de lire le stock
      const info = packInfo();
      recordSeen(real, info.max, nextPackIn());
      const n = Math.max(0, real - reserve);
      if (n > 0) await openBatch(n);
      const after = packInfo();
      recordSeen(after.packs, after.max, nextPackIn());
    } finally { CTX?.close(); CTX = null; }
  }

  /**
   * Mémorise l'ouverture auto (en cours, avec les cartes déjà tirées et mises de côté) ou l'efface ; rend le verrou quand elle s'arrête.
   * Un rechargement de la page ne l'interrompt plus : au chargement suivant elle reprend, cartes comprises (voir buildPanel).
   */
  function persistAuto() {
    if (!state.auto) { state.unlock?.(); state.unlock = null; WMX.stats.release(); } // statistiques retenues : comptées maintenant
    return WMX.store.set('autoRun', state.auto ? { on: true, t: Date.now(), buffer: state.buffer, opened: state.opened, nextAt: state.nextAt } : null);
  }
  /** Une seule page du jeu mène l'ouverture auto (deux pages ouvriraient les mêmes paquets). Vrai si ce rôle est pris. */
  function takeAutoLock() {
    return new Promise((resolve) => {
      if (!WMX.lock.available) { resolve(true); return; }
      WMX.lock('wmx-pack-auto', { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return null; }
        resolve(true);
        return new Promise((release) => { state.unlock = release; });
      }).catch(() => resolve(true));
    });
  }

  function startAuto(resume = false, nextAt = null) {
    if (state.busy) return;
    state.auto = true;
    WMX.stats.hold(); // la répartition des raretés ne bouge qu'à l'arrêt : pas de spoil pendant l'ouverture
    if (!state.unlock) takeAutoLock();
    persistAuto();
    setBadge(); setAutoBtn();
    if (!resume) WMX.prepareCardSheets?.(); // fiche des cartes prête quand la révélation s'affichera
    autoLoop(nextAt);
  }

  function stopAuto() {
    state.auto = false;
    const cards = state.buffer;
    state.buffer = []; state.opened = 0;
    persistAuto();
    setBadge(); setAutoBtn(); setStatus('');
    if (cards.length) WMX.reveal(cards);
  }

  // --- Panneau --------------------------------------------------------------------------------
  const field = (label, control, title) => el('label', title ? { title } : {}, label, control);

  async function buildPanel() {
    Object.assign(WMX.settings, WMX.migrateSettings(await WMX.store.get('wmxSettings', {})));
    const ap = await WMX.store.get('autoPrefs', { min: 5, max: 10 });
    const seenPacks = await WMX.store.get('packsSeen', null);
    account = (await WMX.store.get('packAccount', null))?.type || seenPacks?.account || 'classic';
    WMX.store.set('packCooldown', null); // ancienne pause « apprise » (gardée d'une fois sur l'autre) : abandonnée, chaque ouverture repart de 1,5 s
    let panelPos = await WMX.store.get('panelPos', null); // position choisie du menu ouvert ({ x, y }) ou null : emplacement d'origine
    if (!(panelPos && Number.isFinite(panelPos.x) && Number.isFinite(panelPos.y))) panelPos = null;

    ui.status = el('div', { class: 'wmx-status' });
    ui.stats = el('div', { class: 'wmx-pstats' });
    ui.min = el('input', { class: 'wmx-input', type: 'number', min: '1', max: '60', step: '1', value: ap.min });
    ui.max = el('input', { class: 'wmx-input', type: 'number', min: '1', max: '60', step: '1', value: ap.max });
    const clamp = () => {
      const a = Math.min(60, Math.max(1, Math.round(Number(ui.min.value) || 1)));
      const b = Math.min(60, Math.max(a, Math.round(Number(ui.max.value) || a)));
      ui.min.value = a; ui.max.value = b;
      WMX.store.set('autoPrefs', { min: a, max: b });
    };
    const onIntervalChange = () => { clamp(); if (state.auto && !state.busy) setNextAt(Date.now() + nextInterval()); };
    ui.min.addEventListener('change', onIntervalChange);
    ui.max.addEventListener('change', onIntervalChange);
    clamp();

    ui.autoBtn = el('button', { class: 'wmx-btn wmx-btn--wide', onclick: () => (state.auto ? stopAuto() : startAuto()) });
    ui.fabCount = el('span', { class: 'wmx-fab-count', hidden: '' });  // sur le cadran
    ui.fabCount2 = el('span', { class: 'wmx-fab-count', hidden: '' }); // sur le logo de l'en-tête
    // Réduit, le menu devient un cadran comme celui des enchères : l'anneau suit la régénération du prochain paquet, le centre affiche le stock.
    const RING = 2 * Math.PI * 30;
    const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ringSvg.setAttribute('viewBox', '0 0 72 72');
    ringSvg.setAttribute('class', 'wmx-fab-ring');
    WMX.dom.svg(ringSvg, `<circle cx="36" cy="36" r="30" class="wmx-dial-bg"/><circle cx="36" cy="36" r="30" class="wmx-dial-ring" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/>`);
    ui.fabRing = ringSvg;
    ui.fabTxt = el('span', { class: 'wmx-fab-txt' }, el('b', {}, '–'), el('small', {}, 'paquets'));
    let dialEl = null; // le cadran, défini plus bas
    let prefCollapsed = false; // préférence d'affichage du menu sur la page Paquets
    let seenSnap = seenPacks; // dernier relevé fait sur la page Paquets (mémorisé) : base de l'estimation sur les autres pages
    let lastPacks = estimateSeen(seenSnap);
    let lastSave = 0;
    recordSeen = (packs, max, nextIn) => {
      const now = Date.now();
      seenSnap = { packs, max, nextAt: packs >= max || nextIn == null ? null : now + nextIn * 1000, t: now, account };
      lastSave = now;
      WMX.store.set('packsSeen', seenSnap);
      lastPacks = estimateSeen(seenSnap);
      refreshDial();
    };
    getEstimate = () => estimateSeen(seenSnap);
    // Un relevé fait dans un autre onglet (page Paquets) vaut aussitôt ici.
    WMX.onStorage?.((c) => {
      if (c.packsSeen?.newValue && !/^\/pulls/.test(location.pathname)) seenSnap = c.packsSeen.newValue;
      if (c.packAccount?.newValue?.type) account = c.packAccount.newValue.type;
    });
    // Avertissement « stock plein » : l'ouverture auto ne s'exécute que sur la page Paquets. Quand le stock est plein (N/N) alors qu'on est
    // ailleurs, un message et un bouton ramènent sur la page Paquets, où l'ouverture reprend d'elle-même.
    const goPulls = () => window.dispatchEvent(new CustomEvent('wmx:navigate', { detail: '/pulls' }));
    let warnDismissed = false;
    const warn = el('div', { class: 'wmx-fullwarn', role: 'status', hidden: '' },
      el('span', { class: 'wmx-fullwarn-ic' }, '⚠'), el('span', { class: 'wmx-fullwarn-txt' }),
      el('button', { class: 'wmx-btn', onclick: goPulls }, 'Aller aux paquets'),
      el('button', { class: 'wmx-qclear', title: 'Masquer', 'aria-label': 'Masquer', onclick: () => { warnDismissed = true; warn.hidden = true; } }, '×'));
    const updateFab = refreshDial = () => {
      const onPulls = /^\/pulls/.test(location.pathname);
      const live = onPulls && document.body.innerText.match(/(\d+)\s*\/\s*(\d+)\s*paquets?/i); // compteur « N / M paquets » affiché (pas encore : on garde l'estimation)
      if (live) {
        const before = account;
        readAccount();
        const now = Date.now();
        const max = WMX.logic.packMax(live[2], seenSnap?.max); // maximum affiché par le jeu (20 aujourd'hui)
        const packs = Math.min(max, Number(live[1]));
        const nextIn = nextPackIn();
        // L'heure EXACTE du prochain paquet est mémorisée (et non un compte à rebours) : un rechargement ou un changement de page ne la décale pas.
        // Compteur « Prochain dans » pas encore affiché : on garde l'heure déjà connue si le stock n'a pas changé.
        const prev = estimateSeen(seenSnap);
        const nextAt = packs >= max ? null : nextIn != null ? now + nextIn * 1000 : (prev && prev.packs === packs ? prev.nextAt : null);
        lastPacks = { packs, max, nextIn: nextAt ? Math.max(0, (nextAt - now) / 1000) : null };
        const changed = !seenSnap || seenSnap.packs !== packs || seenSnap.max !== max || before !== account || (nextAt == null) !== (seenSnap.nextAt == null);
        seenSnap = { packs, max, nextAt, t: now, account };
        if (changed || now - lastSave > 15000) { lastSave = now; WMX.store.set('packsSeen', seenSnap); } // tout de suite quand le stock change (ouverture, nouveau paquet)
      } else lastPacks = estimateSeen(seenSnap) || (onPulls ? lastPacks : null); // hors de la page Paquets : estimation recalculée chaque seconde
      const full = !!lastPacks && lastPacks.packs >= lastPacks.max;
      if (!full) warnDismissed = false; // le prochain stock plein ramènera l'alerte
      warn.hidden = !(full && !onPulls && !warnDismissed) || (state.auto && WMX.settings.openParallel !== false); // ouverture auto en parallèle : elle s'en charge
      if (!warn.hidden) warn.querySelector('.wmx-fullwarn-txt').textContent = `Stock plein (${lastPacks.est ? '~' : ''}${lastPacks.packs}/${lastPacks.max}) : ` + (state.auto ? 'l’ouverture auto ne marche que sur la page Paquets' : 'vos paquets ne se régénèrent plus, allez les ouvrir');
      dialEl?.classList.toggle('full', full); // anneau rouge : le stock est plein
      dialEl?.classList.toggle('opening', !!state.par);
      if (state.par) { // ouverture en parallèle : l'anneau suit les paquets ouverts
        const { done, total, cards } = state.par;
        const ring = ringSvg.querySelector('.wmx-dial-ring');
        ring.style.strokeDashoffset = String(RING * (1 - (total ? done / total : 0)));
        ring.style.stroke = '#2dd4a0';
        ui.fabTxt.firstChild.textContent = `${done}/${total}`;
        ui.fabTxt.lastChild.textContent = 'ouverts';
        ui.fabTxt.title = `Ouverture en parallèle : ${done} paquet${done > 1 ? 's' : ''} ouvert${done > 1 ? 's' : ''} sur ${total}, ${cards.length} carte${cards.length > 1 ? 's' : ''} tirée${cards.length > 1 ? 's' : ''} (révélées à la fin). Le menu des paquets (clic) permet de l'arrêter.`;
        return;
      }
      if (!lastPacks) return;
      const { packs, max, nextIn, est } = lastPacks;
      const frac = packs >= max ? 1 : Math.min(1, Math.max(0, 1 - (nextIn ?? regenS()) / regenS()));
      const ring = ringSvg.querySelector('.wmx-dial-ring');
      ring.style.strokeDashoffset = String(RING * (1 - frac));
      ring.style.stroke = packs >= max ? '#ef4444' : '#2dd4a0';
      ui.fabTxt.lastChild.textContent = packs >= max ? 'plein' : 'paquets';
      ui.fabTxt.firstChild.textContent = `${est ? '~' : ''}${packs}/${max}`;
      const fullAt = packs < max && nextIn != null ? Date.now() + (nextIn + (max - packs - 1) * regenS()) * 1000 : null;
      const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      ui.fabTxt.title = (est ? 'Estimation d’après la dernière visite de la page Paquets. ' : '')
        + `Compte ${account === 'pro' ? 'Pro : 1 paquet toutes les 3 min' : 'classique : 1 paquet toutes les 10 min'}. `
        + (packs >= max ? 'Stock plein : ouvrez vos paquets' : nextIn != null ? `Prochain paquet dans ${mmss(nextIn)} · stock plein vers ${hhmm(fullAt)}` : 'Heure du prochain paquet inconnue : passez sur la page Paquets');
    };
    setInterval(() => {
      if (!WMX.alive()) return;
      updateFab();
      document.documentElement.classList.toggle('wmx-auto-on', state.auto); // le jeu peut réinitialiser les attributs de <html> en finissant de s'afficher
    }, 1000);
    // Logo « W » de l'en-tête. Le bouton réduit est un cadran à part, comme celui des enchères : le menu en sort et y rentre.
    const fab = el('span', { class: 'wmx-fab', title: 'WikiMasters Toolkit+' }, el('span', { class: 'wmx-fab-w' }, 'W'), ui.fabCount2);
    // Comme la bulle des enchères : le cadran reste affiché menu ouvert ; un clic ouvre le menu, un autre le referme.
    const dial = dialEl = el('button', { class: 'wmx-pdial', title: 'Ouvrir le menu des paquets', 'aria-label': 'Menu des paquets', 'aria-expanded': 'false', onclick: () => setCollapsed(panel.classList.contains('open')) }, ui.fabRing, ui.fabTxt, ui.fabCount);
    const fold = el('button', { class: 'wmx-icon wmx-fold', title: 'Réduire le menu', 'aria-label': 'Réduire le menu', onclick: () => setCollapsed(true) });
    fold.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const body = el('div', { class: 'wmx-body' },
      el('div', { class: 'wmx-btnrow' }, ui.allBtn = el('button', { class: 'wmx-btn wmx-btn--wide', onclick: () => (state.par ? stopParallel() : openAllAnywhere()) }, 'Tout ouvrir'), ui.autoBtn),
      ui.status,
      el('h4', {}, 'Intervalle de l’ouverture auto'),
      field('Minimum (min)', ui.min, 'Entre 1 et 60 minutes. Un intervalle court = plus de requêtes envoyées au jeu.'),
      field('Maximum (min)', ui.max, 'Jusqu’à 60 minutes.'),
      el('h4', {}, 'Statistiques'),
      ui.stats,
      el('button', { class: 'wmx-settings-btn', onclick: () => WMX.openSettings() }, el('span', {}, '⚙'), 'Paramètres'),
      el('div', { class: 'wmx-ver' }, (() => { try { return `v${chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version}`; } catch (_) { return ''; } })()));

    const head = el('div', { class: 'wmx-head', title: 'Maintenez le clic pour déplacer · double-clic pour replacer' }, fab, el('h3', {}, 'WikiMasters Toolkit+'), fold);
    const panel = el('aside', { class: 'wmx-panel', hidden: '' }, head, body);

    // Menu déplaçable (comme la bulle des enchères) : on attrape l'en-tête ; la position est mémorisée et gardée dans l'écran.
    const clampPanel = (x, y) => ({
      x: Math.min(Math.max(8, x), Math.max(8, innerWidth - (panel.offsetWidth || 330) - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, innerHeight - (panel.offsetHeight || 420) - 8)),
    });
    function applyPanelPos() {
      if (!panelPos) { panel.classList.remove('moved'); panel.style.top = panel.style.bottom = panel.style.margin = ''; return; }
      const c = clampPanel(panelPos.x, panelPos.y);
      panel.classList.add('moved');
      Object.assign(panel.style, { left: `${c.x}px`, top: `${c.y}px`, bottom: 'auto', margin: '0' });
    }
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture?.(e.pointerId);
      panel.classList.add('dragging');
      const move = (ev) => { panelPos = clampPanel(ev.clientX - dx, ev.clientY - dy); applyPanelPos(); };
      const up = () => {
        head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
        panel.classList.remove('dragging');
        WMX.store.set('panelPos', panelPos);
      };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
    head.addEventListener('dblclick', (e) => { // double-clic sur l'en-tête : retour à l'emplacement d'origine
      if (e.target.closest('button')) return;
      panelPos = null; WMX.store.set('panelPos', null); applyPanelPos(); place();
    });

    /** Le menu part du centre du cadran et y retourne : son point d'origine est calculé d'après la position réelle des deux. */
    function aim() {
      const prev = panel.style.transition;
      const was = panel.classList.contains('open');
      panel.style.transition = 'none';
      panel.hidden = false;
      panel.classList.add('open');
      const r = panel.getBoundingClientRect();
      const d = dial.getBoundingClientRect();
      panel.style.transformOrigin = `${Math.round(d.left + d.width / 2 - r.left)}px ${Math.round(d.top + d.height / 2 - r.top)}px`;
      if (!was) panel.classList.remove('open');
      void panel.offsetWidth;
      panel.style.transition = prev;
    }
    /** Réduit le menu dans son cadran (c = true) ou le fait ressortir, avec animation. */
    function setCollapsed(c, animate = true, remember = true) {
      clearTimeout(panel._t);
      if (!c) {
        if (animate) { aim(); void panel.offsetWidth; } else { panel.hidden = false; panel.style.transition = 'none'; }
        panel.classList.add('open');
        if (!animate) { void panel.offsetWidth; panel.style.transition = ''; }
      } else {
        if (animate) aim();
        panel.classList.remove('open');
        panel._t = setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, animate ? 340 : 0);
      }
      dial.classList.toggle('on', !c); // le cadran reste toujours affiché ; enfoncé tant que le menu est ouvert
      dial.setAttribute('aria-expanded', String(!c));
      dial.title = c ? 'Ouvrir le menu des paquets' : 'Refermer le menu des paquets';
      if (remember && /^\/pulls/.test(location.pathname)) { prefCollapsed = c; WMX.store.set('panelCollapsed', c); }
    }

    // Changement de page : le menu se réduit à son cadran (visible partout, à côté de celui des enchères) hors de la page Paquets, et reprend
    // l'affichage choisi en y revenant.
    // Un menu déjà OUVERT le reste en arrivant sur la page Paquets : « Tout ouvrir » / « Ouvrir auto » lancés depuis une autre page y ramènent, et le menu
    // (avec son état d'avancement) ne doit pas se refermer en route à cause de la préférence d'affichage de la page Paquets.
    new MutationObserver(() => {
      if (!/^\/pulls/.test(location.pathname)) setCollapsed(true, true, false);
      else if (!panel.classList.contains('open')) setCollapsed(prefCollapsed, true, false);
      place();
    })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-wmx-route'] });

    WMX.packsMenu = { collapse: () => { if (panel.classList.contains('open')) setCollapsed(true, true, false); } }; // tableau de bord ouvert : le menu rentre dans son cadran
    const cover = el('div', { class: 'wmx-cover' });
    document.body.append(panel, dial, cover, warn);
    [panel, dial, cover, warn].forEach(WMX.dom.keepAttached);

    // La barre latérale du jeu s'élargit selon l'écran : le menu se cale à sa droite au lieu d'une position fixe.
    const place = () => {
      const edges = [...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect().right).filter((x) => x > 100 && x < 700);
      const x = edges.length ? Math.max(...edges) : 256;
      const left = `${Math.max(8, Math.min(Math.round(x + 16), innerWidth - (panel.offsetWidth || 330) - 8))}px`; // reste toujours dans l'écran
      dial.style.left = left; // au-dessus du cadran des enchères (même colonne)
      if (panelPos) applyPanelPos(); else panel.style.left = left;
      cover.style.left = `${Math.round(x)}px`;
    };
    place();
    applyPanelPos();
    window.addEventListener('resize', place);
    new ResizeObserver(place).observe(document.documentElement);
    setTimeout(place, 600); setTimeout(place, 2500); // après le rendu du jeu (polices, mise en page)
    setBadge(); setAutoBtn();
    setTimeout(() => { if (/^\/pulls/.test(location.pathname)) WMX.prepareCardSheets?.('view'); }, 3000); // fiche du jeu prête avant le premier clic sur une carte tirée
    // Petit écran : le menu démarre réduit à sa bulle « W » (visible, jamais masqué) ; on le déplie d'un clic.
    prefCollapsed = (await WMX.store.get('panelCollapsed', false)) || innerWidth < 1250;
    setCollapsed(/^\/pulls/.test(location.pathname) ? prefCollapsed : true, false, false);

    // Statistiques : anneau coloré par rareté + légende, avec le nombre de cartes uniquement.
    const render = async () => {
      const s = await WMX.stats.get();
      const RGB = WMX.RARITY_RGB;
      const pct = (r) => (s.cards ? (s.rarity[r] / s.cards) * 100 : 0);
      let acc = 0;
      const stops = WMX.RARITIES.map((r) => { const a = acc; acc += pct(r); return `rgb(${RGB[r]}) ${a}% ${acc}%`; }).join(',');
      const fmt = (r) => `${pct(r).toFixed(1).replace('.', ',')} %`;
      ui.stats.replaceChildren(el('div', { class: 'wmx-sbox' },
        el('div', { class: 'wmx-donutrow' },
          el('div', { class: 'wmx-donut', style: `background:conic-gradient(${s.cards ? stops : '#1a2a24 0 100%'})` },
            el('div', { class: 'wmx-donut-c' }, el('b', {}, String(s.cards)), el('small', {}, s.cards > 1 ? 'cartes' : 'carte'))),
          el('div', { class: 'wmx-legend' }, ...WMX.RARITIES.map((r) => el('div', { style: `--rgb:${RGB[r]}` },
            el('i'), el('b', {}, r), el('span', { class: 'wmx-lp' }, fmt(r)), el('span', { class: 'wmx-ln' }, String(s.rarity[r])))))),
        (() => {
          const avg = WMX.logic.packAverage(s.value || 0, s.valuedPacks || 0);
          return avg == null ? '' : el('div', { class: 'wmx-avgpack', title: 'Somme des moyennes du marché des cartes tirées, divisée par le nombre de paquets (lots dont tous les prix étaient connus).' },
            el('small', {}, 'Valeur moyenne d’un paquet'), el('b', {}, `${avg.toLocaleString('fr-FR')} W`), el('small', {}, `sur ${s.valuedPacks} paquet${s.valuedPacks > 1 ? 's' : ''}`));
        })()));
    };
    WMX.applySettings = render;
    render();
    WMX.onStorage((c) => { if (c.stats) render(); });

    // Ancien tiroir à cartes (1.0.90, retiré) : ses cartes restantes sont révélées une dernière fois, puis il est vidé.
    if (window.top === window) WMX.store.get('packDrawer', null).then((d) => { if (!d) return; WMX.store.set('packDrawer', null); if (d.cards?.length) WMX.reveal(d.cards); }).catch(() => {});
    // Reprise : cartes tirées avant un rechargement de la page et jamais révélées.
    const pending = await WMX.store.get('pendingCards', []);
    if (pending.length) WMX.reveal(pending);

    // Ouverture auto en cours avant un rechargement de la page : elle reprend, avec les cartes déjà tirées, si sa dernière trace date de moins de
    // 5 min et qu'aucune autre page du jeu ne la mène. Plus ancienne, elle n'est pas relancée, mais les cartes tirées sont montrées.
    const saved = await WMX.store.get('autoRun', null);
    if (saved?.on) {
      if (Date.now() - (saved.t || 0) < 5 * 60000) {
        let got = false;
        for (let i = 0; i < 5 && !got; i++) { got = await takeAutoLock(); if (!got) await sleep(1000); } // l'ancienne page rend le verrou en se fermant
        if (got) {
          state.buffer = saved.buffer || [];
          state.opened = saved.opened || 0;
          startAuto(true, saved.nextAt); // l'échéance d'avant le rechargement est conservée (pas de nouveau tirage au sort)
          if (!/^\/pulls/.test(location.pathname)) setCollapsed(true, false);
          setStatus('Ouverture auto reprise après le rechargement de la page');
        }
      } else {
        WMX.store.set('autoRun', null);
        if (saved.buffer?.length) WMX.reveal(saved.buffer);
      }
    }
    // Statistiques restées en attente (page fermée pendant l'auto) : comptées, sauf si une autre page du jeu mène encore l'ouverture auto.
    const otherRuns = saved?.on && Date.now() - (saved.t || 0) < 5 * 60000 && !state.auto;
    if (!state.auto && !otherRuns) WMX.stats.release();
  }

  // Le menu existe sur toutes les pages (masqué hors de la page Paquets tant que l'ouverture auto ne tourne pas) : un rechargement de la
  // page ne doit ni le faire disparaître ni interrompre l'ouverture auto.
  WMX.register({
    name: 'boosters',
    match: /./,
    init() {
      document.documentElement.dataset.wmxBoost = 'init';
      return buildPanel().then(() => { document.documentElement.dataset.wmxBoost = 'ok'; }).catch((e) => { // erreur de construction du menu : visible (console et attribut) au lieu de disparaître en silence
        document.documentElement.dataset.wmxBoost = 'err: ' + (e?.message || e);
        console.warn('[WMX] menu des paquets', e);
      });
    },
  });
})();
