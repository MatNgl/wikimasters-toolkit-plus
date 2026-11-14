// Assistant de vente (désactivé par défaut) : garde des emplacements d'enchères remplis avec les cartes portant l'une des étiquettes
// choisies (Paramètres). Le jeu RETIRE les étiquettes d'une carte mise en vente : l'extension s'en souvient et, quand l'enchère se termine sans
// acheteur, remet l'étiquette de vente à la carte revenue (puis l'assistant peut la remettre en vente).
// Pour vendre des cartes précises, il suffit de leur mettre l'étiquette (sélection native du jeu → « Étiqueter »).
// Tout passe par la file d'attente (mêmes gestes, même prix de départ que le bouton ⚡). Un seul onglet agit à la fois : celui qui prend
// le verrou, et seulement tant que l'assistant est activé (un onglet où il est désactivé ne bloque jamais les autres).
// Garde-fous : jamais une carte favorite ; une vente annulée à la main écarte la carte 12 h ; 2 échecs de suite l'écartent 6 h ;
// jamais une carte dont le prix de départ dépasse le plafond choisi (500 W par défaut) ; au plus N mises en vente automatiques par carte (réglage « Limiter les remises en vente », 4 par défaut, désactivable)
// et par jour ; jamais plus d'enchères actives que le nombre choisi.
// Visibilité : chaque passe publie son état : ligne dans la bulle des enchères, fenêtre « Détails » (pourquoi telle carte n'est pas
// mise en vente, prochaines cartes), bouton « Lancer maintenant ».
(() => {
  const { el, sleep } = WMX.dom;
  const H = WMX.logic.HOUR;
  const EVERY = 45000;
  const PAUSE = 3 * 60000; // pause après une mise en vente que le jeu n'a pas enregistrée
  const S = { skip: {}, log: {}, fails: {}, leader: !navigator.locks?.request, busy: false, wanted: false, purged: new Set(), release: null, shared: null, painters: new Set() };
  const on = () => !!WMX.settings?.autoSell;
  const tags = () => String(WMX.settings?.autoSellTags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const cap = () => Math.max(1, Number(WMX.settings?.autoSellCap) || 500);
  /** Enchères visées : le réglage (5 par défaut), jamais plus que la limite du compte lue sur le jeu (5 en classique, 10 en Pro). */
  const maxActive = () => Math.max(1, Math.min(WMX.quick?.max?.() || 10, Number(WMX.settings?.autoSellMax) || 5));
  /** Raretés à vendre, dans l'ordre (vide : toutes). */
  const rarList = () => [...new Set(String(WMX.settings?.autoSellPriorityRar || '').split(/[\s,;]+/).map((r) => r.trim().toUpperCase()).filter(Boolean))];
  const strict = () => WMX.settings?.autoSellStrict !== false;
  /** Mises en vente automatiques permises par carte sur 24 h glissantes : le réglage (1 à 50, 4 par défaut), ou sans limite s'il est désactivé. */
  const relistMax = () => (WMX.settings?.autoSellRelistLimit === false ? Infinity : Math.max(1, Math.min(50, Math.round(Number(WMX.settings?.autoSellRelistMax) || 4))));
  const RNAME = { L: 'Légendaire', UR: 'Ultra rare', SR: 'Super rare', R: 'Rare', PC: 'Peu commune', C: 'Commune' };
  const REASONS = { gone: 'plus dans votre collection (vendue ?)', favorite: 'favorite (verrouillée)', busy: 'déjà en vente ou en file', skipped: 'écartée temporairement', capped: 'trop chère pour l’assistant', get perDay() { return `limite de ${relistMax()} mise${relistMax() > 1 ? 's' : ''} en vente par 24 h atteinte (réglable dans les paramètres)`; }, later: 'rareté suivante : attend la fin de la précédente' };
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  /** Cartes mises en vente par l'assistant qui peuvent encore revenir (en vente, ou revenues invendues et en attente de leur étiquette). */
  const pendingSales = () => Object.entries(retag.mem).map(([card_id, m]) => ({ card_id, rarity: m.rarity }));
  /** « 2 à vendre · 1 en vente · 3 trop chères (> 500 W) » pour une rareté. */
  function rarSummary(b, capW) {
    if (!b) return '';
    return [b.eligible && `${b.eligible} à vendre`, b.onSale && `${b.onSale} en vente`, b.waiting && `${plural(b.waiting, 'écartée')} pour un temps`,
      b.capped && `${b.capped} trop chère${b.capped > 1 ? 's' : ''} (> ${capW} W)`, b.favorite && plural(b.favorite, 'favorite')].filter(Boolean).join(' · ');
  }

  async function skipCard(id, ms) {
    const cur = await WMX.store.get('autoSellSkip', {}); // relu avant d'écrire : un autre onglet a pu écarter d'autres cartes
    cur[id] = Date.now() + ms;
    S.skip = cur;
    await WMX.store.set('autoSellSkip', cur);
  }

  // ---- état publié ----
  const fmtIn = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; };
  const fmtAt = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  function publish(st) {
    S.shared = st;
    WMX.store.set('autoSellStatus', st);
    paintAll();
    return st;
  }
  /** Ligne courte : activé ou non, enchères en cours, et ce que fait l'assistant. */
  function line() {
    if (!on()) return { text: 'désactivé', cls: 'off' };
    const st = S.shared;
    if (!st || Date.now() - st.t > 4 * 60000) return { text: 'en attente d’un onglet actif… (gardez une page du jeu ouverte)', cls: 'wait' };
    const head = `${st.active ?? 0}/${st.target} en vente${st.queued ? ` · ${st.queued} en file` : ''}`;
    return { text: `${head} · ${st.reason}`, cls: st.state === 'listed' ? 'go' : st.state === 'nothing' || st.state === 'waiting' || st.state === 'no-inventory' || st.state === 'paused' ? 'warn' : 'ok' };
  }
  const WAIT_HELP = 'Aucune page du jeu n’a lancé de passe depuis plus de 4 minutes. L’assistant tourne dans une page ouverte de wiki-masters.com : gardez-en une ouverte (n’importe laquelle). Si vous venez d’activer l’assistant ou de mettre l’extension à jour, actualisez la page (F5) : la première passe a lieu environ 20 secondes après le chargement. Une page en arrière-plan ou « en veille » (économiseur de mémoire de Chrome) ne travaille pas : affichez-la.';
  function paintAll() { S.painters.forEach((p) => { try { p(); } catch (_) { /* élément retiré */ } }); }

  // ---- une passe ----
  async function tick() {
    if (!S.leader || S.busy || !WMX.alive() || !on()) return;
    S.busy = true;
    const now = Date.now();
    const st = { t: now, nextAt: now + EVERY, target: maxActive(), tags: tags(), cap: cap(), state: '', reason: '' };
    const done = (state, reason, extra = {}) => publish({ ...st, state, reason, ...extra });
    try {
      if (!st.tags.length) return done('no-tags', 'aucune étiquette choisie (Paramètres)');
      // L'inventaire n'est chargé que sur la Collection et le tableau de bord : l'assistant le charge lui-même (cache, puis lecture à jour),
      // pour fonctionner depuis n'importe quelle page du jeu. Les cartes revenues invendues y reviennent : relecture complète toutes les 30 min.
      await WMX.inventory.ensure();
      if (WMX.inventory.age() > 30 * 60000 && !WMX.inventory.isLoading()) WMX.inventory.reload();
      // À chaque passe : UNE requête compare le nombre de cartes de chaque étiquette de vente à celui de la fois précédente. Même nombre : rien n'est relu ;
      // nombre différent : les cartes de ces étiquettes sont relues (sans cela l'assistant ignorait, jusqu'à 30 min, les cartes étiquetées depuis le dernier
      // chargement complet, par exemple des Légendaires, et mettait d'abord d'autres raretés en vente).
      if (!WMX.inventory.isLoading() && Date.now() - (S.taggedAt || 0) > 40000) {
        S.taggedAt = Date.now();
        try { await WMX.inventory.syncTagged(st.tags, { force: !!S.forceTagged }); S.forceTagged = false; } catch (_) { /* jeu lent : on garde la copie actuelle */ }
      }
      const items = WMX.inventory.items(); // la liste en cache suffit : l'inventaire se recharge parfois pendant des minutes (jeu lent)
      if (!items.length) return done('no-inventory', WMX.inventory.isLoading() ? 'chargement de la collection en cours, reprise à la prochaine passe' : 'collection indisponible pour le moment, nouvelle tentative à la prochaine passe');
      if (WMX.quick.isRunning()) return done('queue-busy', 'file d’attente occupée, reprise à la fin', { queued: WMX.quick.queued() });
      if ((WMX.gameBlockedUntil || 0) > now) return done('paused', `le jeu a refusé les dernières demandes : l’assistant le laisse tranquille jusqu’à ${fmtAt(WMX.gameBlockedUntil)}`);
      if (S.pauseUntil > now) return done('paused', `le jeu n’a pas enregistré la dernière mise en vente : nouvel essai à ${fmtAt(S.pauseUntil)} (page rechargée)`);
      await WMX.quick.refresh();
      const active = WMX.quick.count();
      const free = Math.min(st.target - active, WMX.quick.max() - active);
      const busy = new Set(items.filter((it) => WMX.quick.stateOf(it.card_id) !== 'idle').map((it) => it.card_id));
      const plan = WMX.logic.autoSellPlan(items, { tags: st.tags, busy, gone: (it) => WMX.quick.notOwned(it.card_id), skip: S.skip, log: S.log, now, perDay: relistMax(), cap: st.cap, order: WMX.settings?.autoSellOrder, priorityRar: rarList(), strict: strict(), pending: pendingSales(), avg: (it) => WMX.prices.get(it.card_id, it.rarity)?.avg || 0 });
      // Les cartes que le jeu dit ne plus être à nous sont retirées de l'inventaire en mémoire (une seule fois).
      for (const e of plan.excluded) {
        if (e.reason !== 'gone' || S.purged.has(e.card_id)) continue;
        S.purged.add(e.card_id);
        for (let n = items.find((it) => it.card_id === e.card_id)?.count || 1; n > 0; n--) window.dispatchEvent(new CustomEvent('wmx:discard', { detail: { card_id: e.card_id } }));
      }
      const counts = {};
      for (const e of plan.excluded) counts[e.reason] = (counts[e.reason] || 0) + 1;
      const detail = {
        active, queued: 0, free: Math.max(0, free), tagged: plan.tagged, eligible: plan.eligible.length, counts,
        order: plan.order, current: plan.current, byRar: plan.byRar, outside: plan.outside, strict: strict() && plan.order.length > 0,
        gameTagged: (() => { const n = st.tags.map((t) => WMX.inventory.tagCount(t)).filter((x) => x != null); return n.length ? n.reduce((a, b) => a + b, 0) : null; })(), // nombre annoncé par le jeu : sert à repérer une copie périmée
        next: plan.eligible.slice(0, 10).map((it) => ({ title: it.title, rarity: it.rarity, avg: Math.round(WMX.prices.get(it.card_id, it.rarity)?.avg || 0) })),
        excluded: plan.excluded.slice(0, 60).map((e) => ({ title: e.title, rarity: e.rarity, reason: e.reason, until: e.until, avg: Math.round(e.avg || 0) })),
      };
      noteRarityProgress(plan, st);
      if (free <= 0) return done('full', `toutes les enchères visées sont en cours (${active}/${st.target})${plan.current ? ` · ${plan.current} en cours` : ''}`, detail);
      const picks = plan.eligible.slice(0, free);
      if (!picks.length) {
        if (plan.order.length) {
          const capped = plan.order.reduce((n, r) => n + (plan.byRar[r]?.capped || 0), 0);
          const capTxt = capped ? ` · ${capped} au-dessus du plafond de ${st.cap} W (Paramètres)` : '';
          if (plan.current) { // ordre strict : la rareté en cours n'a plus de carte libre, mais il en reste en vente ou écartées pour un temps
            const next = plan.order[plan.order.indexOf(plan.current) + 1];
            return done('waiting', `${plan.current} : ${rarSummary(plan.byRar[plan.current], st.cap)}${next ? ` · les ${next} attendent la fin des ${plan.current}` : ''}`, detail);
          }
          return done('nothing', `plus aucune carte ${plan.order.join(', ')} à vendre (${st.tags.join(', ')})${capTxt}${plan.outside ? ` · ${plan.outside} d’autres raretés ignorée${plan.outside > 1 ? 's' : ''}` : ''}`, detail);
        }
        const why = plan.tagged ? `aucune carte éligible sur ${plan.tagged} étiquetée${plan.tagged > 1 ? 's' : ''} (voir Détails)` : 'aucune carte ne porte ces étiquettes';
        return done('nothing', why, detail);
      }
      for (const it of picks) (S.log[it.card_id] = (S.log[it.card_id] || []).filter((t) => now - t < 24 * H)).push(now);
      WMX.store.set('autoSellLog', S.log);
      WMX.journal?.add('Assistant de vente', `${picks.length} carte${picks.length > 1 ? 's' : ''} mise${picks.length > 1 ? 's' : ''} en file : ${picks.map((p) => p.title).join(', ')}`);
      WMX.quick.bulk('launch', picks, { cap: st.cap });
      return done('listed', `${picks.length} carte${picks.length > 1 ? 's' : ''} mise${picks.length > 1 ? 's' : ''} en file à ${fmtAt(now)}`, { ...detail, queued: picks.length });
    } finally { S.busy = false; }
  }

  /**
   * Avec une liste de raretés : journal quand on passe d'une rareté à la suivante, et notification (une fois) quand plus aucune rareté choisie
   * n'a de carte à vendre. Mémorisé par réglage (étiquettes + raretés) : changer de réglage réarme l'alerte.
   */
  function noteRarityProgress(plan, st) {
    if (!plan.order.length) return;
    const k = `${st.tags.join(',')}|${plan.order.join(',')}`;
    const prev = S.progress?.k === k ? S.progress : { k, current: plan.current, emptyNotified: false };
    if (plan.current && prev.current && plan.current !== prev.current) WMX.journal?.add('Assistant de vente', `Plus aucune ${prev.current} à vendre : passage aux ${plan.current}`);
    const left = plan.order.some((r) => { const b = plan.byRar[r]; return b && b.eligible + b.waiting + b.onSale > 0; });
    if (!left && !prev.emptyNotified) {
      const capped = plan.order.reduce((n, r) => n + (plan.byRar[r]?.capped || 0), 0);
      WMX.journal?.add('Assistant de vente', `Plus aucune carte ${plan.order.join(', ')} à vendre`, 'warn');
      WMX.notify?.({ kind: 'warn', key: 'autosell-empty', ms: 12000, title: `Plus de carte ${plan.order.join(', ')} à vendre`,
        text: `Aucune carte ${plan.order.map((r) => RNAME[r] || r).join(', ')} à vendre avec l’étiquette ${st.tags.join(', ')}${capped ? ` (${capped} au-dessus du plafond de ${st.cap} W)` : ''}. L’assistant attend : étiquetez d’autres cartes ou changez les raretés dans les Paramètres.` });
    }
    S.progress = { k, current: plan.current, emptyNotified: !left };
  }

  /** Un onglet pilote l'assistant : celui qui prend le verrou. Demandé seulement si l'assistant est activé, rendu dès qu'il est désactivé. */
  function ensureLock() {
    if (!navigator.locks?.request) { S.leader = true; return; }
    if (on() && !S.wanted) {
      S.wanted = true;
      navigator.locks.request('wmx-autosell', () => {
        if (!on()) return undefined; // désactivé entre-temps : on rend le verrou aussitôt
        return new Promise((release) => { S.leader = true; S.release = () => { S.leader = false; S.release = null; release(); }; setTimeout(tick, 1500); });
      }).finally(() => { S.wanted = false; });
    } else if (!on() && S.release) S.release();
  }

  /** « Lancer maintenant » : ce onglet s'il pilote l'assistant, sinon on le demande à l'onglet qui le pilote. */
  async function runNow() {
    if (!on()) return WMX.toast?.('L’assistant de vente est désactivé : activez-le dans les Paramètres.', 5000);
    const blockedUntil = WMX.gameBlockedUntil || 0;
    if (blockedUntil > Date.now()) { // insister pendant un blocage risque de le prolonger : on demande confirmation
      if (!window.confirm(`Le jeu a refusé les dernières demandes : l’assistant attend jusqu’à ${fmtAt(blockedUntil)}. Insister peut rallonger l’attente. Lancer quand même ?`)) return undefined;
      WMX.gameBlockedUntil = 0;
      await WMX.store.set('gameBlockedUntil', 0);
    }
    ensureLock();
    S.pauseUntil = 0; // un lancement demandé à la main passe outre la pause
    S.taggedAt = 0; S.forceTagged = true; // et relit tout de suite les cartes étiquetées
    if (S.leader) { await tick(); return WMX.toast?.(`Assistant de vente : ${line().text}`, 5000); }
    await WMX.store.set('autoSellForce', Date.now()); // l'onglet qui pilote l'assistant lance une passe
    WMX.toast?.('Demande transmise à votre autre onglet du jeu…', 4000);
    setTimeout(() => { if (!S.shared || Date.now() - S.shared.t > 15000) WMX.toast?.('L’assistant ne tourne dans aucun onglet pour l’instant : gardez un onglet du jeu ouvert.', 7000, { kind: 'warn' }); }, 8000);
    return undefined;
  }
  // ---- Étiquette de vente remise aux cartes invendues ----
  // Constaté sur le jeu : une carte dont l'enchère est « settled_unsold » revient dans la collection SANS aucune étiquette. On mémorise donc, au moment
  // de la mise en vente, les étiquettes de vente de la carte (celles des Paramètres) ; l'enchère terminée sans acheteur, on les lui remet :
  //  - 30 s après la fin de l'enchère (le jeu met un moment à rendre la carte) ;
  //  - carte pas encore revenue (le jeu la dit non possédée, ou l'étiquette n'a pas pu être posée) : nouvel essai 30 s plus tard, 5 essais au plus,
  //    puis une erreur dans le journal (à faire à la main) ;
  //  - avant chaque essai : carte vendue entre-temps → oubliée ; remise en vente (par vous ou par l'assistant) → on n'y touche pas, une carte en
  //    vente ne peut pas être étiquetée (si cette nouvelle vente se termine sans acheteur, l'étiquette sera remise de la même façon).
  const RETAG_WAIT = 30000;
  const RETAG_TRIES = 5;
  const retag = { mem: {}, queued: new Map() }; // mem : carte -> { tags, title, rarity, at, done, tries, nextAt } ; queued : demande d'étiquette en cours
  const saveRetag = () => WMX.store.set('autoSellRetag', retag.mem);
  function rememberSaleTags(cardId) {
    const wanted = new Set(tags().map((t) => t.toLowerCase()));
    if (!wanted.size) return;
    const it = WMX.inventory.items().find((x) => x.card_id === cardId);
    const mine = (it?.tags || []).map((t) => t.name).filter((n) => wanted.has(String(n).toLowerCase()));
    if (!mine.length) return;
    retag.mem[cardId] = { tags: mine, title: it.title, rarity: it.rarity, at: Date.now(), done: 0, tries: 0, nextAt: 0 };
    saveRetag();
  }
  /** Abandon après 5 essais : erreur dans le journal (l'étiquette est à remettre à la main), la carte est oubliée. */
  function giveUp(id, m, why) {
    WMX.journal?.add('Assistant de vente', `« ${m.title} » invendue : l’étiquette ${m.tags.join(', ')} n’a pas pu être remise après ${RETAG_TRIES} essais (${why}). Remettez-la à la main pour qu’elle soit revendue.`, 'error');
    WMX.notify?.({ kind: 'warn', key: `retag-fail:${id}`, ms: 0, title: 'Étiquette de vente non remise', text: `« ${m.title} » est revenue invendue mais l’étiquette ${m.tags.join(', ')} n’a pas pu lui être remise (${why}). Remettez-la à la main.` });
    delete retag.mem[id];
    retag.queued.delete(id);
  }
  /** Un essai de plus pour cette carte : nouvel essai dans 30 s, ou abandon au 5e. Rend vrai si on abandonne. */
  function nextTry(id, m, why) {
    m.tries = (m.tries || 0) + 1;
    if (m.tries >= RETAG_TRIES) { giveUp(id, m, why); return true; }
    m.nextAt = Date.now() + RETAG_WAIT;
    WMX.journal?.add('Assistant de vente', `« ${m.title} » invendue : ${why}, nouvel essai dans 30 s (essai ${m.tries}/${RETAG_TRIES})`);
    return false;
  }
  async function retagPass() {
    const ids = Object.keys(retag.mem);
    if (!ids.length || !WMX.alive()) return;
    const now = Date.now();
    const day14 = 14 * 24 * H;
    for (const id of ids) if (now - retag.mem[id].at > day14) delete retag.mem[id]; // trop ancien : on oublie
    // Rien à faire tant qu'aucune carte n'attend son essai (pas de requête au jeu pour rien).
    if (!Object.entries(retag.mem).some(([id, m]) => (m.nextAt || 0) <= now && !retag.queued.has(id))) return;
    let hist;
    let selling = [];
    try {
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('mine', '1');
      const res = await fetch(u);
      if (!res.ok) return;
      const j = await res.json();
      hist = j.history || [];
      selling = j.selling || [];
    } catch (_) { return; }
    const back = [];
    for (const id of Object.keys(retag.mem)) {
      const m = retag.mem[id];
      if (retag.queued.has(id) || (m.nextAt || 0) > Date.now()) continue; // demande en cours, ou essai pas encore dû
      const list = hist.filter((a) => a.card_id === id && new Date(a.end_at).getTime() > m.at - 60000);
      if (list.some((a) => a.status === 'settled_sold')) { delete retag.mem[id]; continue; } // vendue : plus rien à remettre
      // De nouveau en vente (remise par vous ou par l'assistant) : une carte en vente ne peut pas être étiquetée, on attend la fin de cette vente.
      // Pendant la vente, on ne regarde qu'une fois par minute (inutile d'interroger le jeu toutes les 15 s pendant une enchère d'une heure).
      if (selling.some((a) => a.card_id === id && a.status === 'active') || WMX.quick.selling(id)) { m.tries = 0; m.nextAt = Date.now() + 60000; continue; }
      const ended = list.filter((a) => a.status === 'settled_unsold').sort((a, b) => new Date(b.end_at) - new Date(a.end_at))[0];
      if (!ended) { m.nextAt = Date.now() + 60000; continue; } // enchère pas encore terminée (ou pas encore dans l'historique) : on repasse dans 1 min
      const endT = new Date(ended.end_at).getTime();
      if (Date.now() - endT < RETAG_WAIT) { m.nextAt = endT + RETAG_WAIT; continue; } // finie il y a moins de 30 s : le jeu n'a peut-être pas rendu la carte
      if (ended.owned === false) { nextTry(id, m, 'la carte n’est pas encore revenue dans la collection'); continue; } // le jeu dit qu'elle n'est pas (encore) à nous
      retag.queued.set(id, Date.now());
      for (const tag of m.tags) WMX.quick.bulk('tag', [{ card_id: id, title: m.title, rarity: m.rarity }], { tag, add: true });
      back.push(m.title);
    }
    saveRetag();
    if (back.length) WMX.journal?.add('Assistant de vente', `Invendue${back.length > 1 ? 's' : ''} : remise de l’étiquette de vente à ${back.join(', ')}`);
  }
  const retagSafely = () => (navigator.locks?.request ? navigator.locks.request('wmx-retag', { ifAvailable: true }, async (l) => { if (l) await retagPass(); }) : retagPass());

  async function resetSkips() {
    S.skip = {}; S.log = {}; S.pauseUntil = 0;
    await WMX.store.set('autoSellSkip', {}); await WMX.store.set('autoSellLog', {});
    WMX.toast?.('Écarts et compteurs journaliers remis à zéro : toutes les cartes étiquetées redeviennent éligibles.', 5000);
    if (S.leader) tick();
  }

  // ---- affichage ----
  /** Ligne d'état (bulle des enchères) : se met à jour toute seule. */
  function footer() {
    const txt = el('span', { class: 'wmx-as-txt' });
    const box = el('div', { class: 'wmx-as-line' }, el('strong', {}, 'Assistant de vente'), txt,
      el('button', { class: 'wmx-qclear', title: 'Lancer une passe maintenant', onclick: runNow }, '▶ Lancer'),
      el('button', { class: 'wmx-qclear', title: 'Pourquoi telle carte est ou n’est pas mise en vente', onclick: openPanel }, 'Détails'));
    const paint = () => { const l = line(); txt.textContent = l.text; box.dataset.state = l.cls; box.title = l.cls === 'wait' ? WAIT_HELP : l.text; };
    S.painters.add(paint);
    paint();
    return box;
  }

  function openPanel() {
    if (document.querySelector('.wmx-aspanel')) return;
    const body = el('div', { class: 'wmx-modal-body wmx-as-body' });
    // Interrupteur : active ou désactive l'assistant sans passer par les Paramètres (n'enregistre que ce réglage).
    const toggleBtn = el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => WMX.updateSettings({ autoSell: !on() }) }, '');
    const rows = (items, fn) => (items.length ? items.map(fn) : [el('p', { class: 'wmx-jempty' }, '—')]);
    const render = () => {
      const st = S.shared;
      const l = line();
      const parts = [el('div', { class: 'wmx-as-state', 'data-state': l.cls }, l.text)];
      if (l.cls === 'wait') parts.push(el('div', { class: 'wmx-as-meta' }, WAIT_HELP));
      if (on() && st) {
        parts.push(el('div', { class: 'wmx-as-meta' },
          `Dernière passe : ${fmtAt(st.t)} · prochaine dans ${fmtIn(st.nextAt - Date.now())} · ${st.target} enchère${st.target > 1 ? 's' : ''} visée${st.target > 1 ? 's' : ''} · plafond de départ ${st.cap} W`));
        parts.push(el('div', { class: 'wmx-as-meta' }, `Étiquettes : ${(st.tags || []).join(', ') || '—'} · ${st.tagged ?? 0} carte(s) étiquetée(s)${st.gameTagged != null && st.gameTagged !== st.tagged ? ` (le jeu en compte ${st.gameTagged} : mise à jour en cours)` : ''} · ${st.eligible ?? 0} éligible(s)`));
        if (st.order?.length) {
          parts.push(el('h4', {}, `Raretés à vendre${st.strict ? ' (dans l’ordre, une à la fois)' : ' (dans l’ordre)'}`));
          st.order.forEach((r, i) => parts.push(el('div', { class: 'wmx-as-row', 'data-current': String(r === st.current) }, el('b', {}, `${i + 1}. ${r}`),
            el('span', {}, r === st.current ? 'en cours' : st.strict && st.current && st.order.indexOf(r) > st.order.indexOf(st.current) ? 'attend' : ''),
            el('small', {}, rarSummary(st.byRar?.[r], st.cap) || 'aucune carte'))));
          if (st.outside) parts.push(el('div', { class: 'wmx-as-meta' }, `${plural(st.outside, 'carte')} étiquetée${st.outside > 1 ? 's' : ''} d’une autre rareté : jamais mise${st.outside > 1 ? 's' : ''} en vente.`));
        }
        if (st.counts && Object.keys(st.counts).length) parts.push(el('div', { class: 'wmx-as-meta' }, 'Écartées : ' + Object.entries(st.counts).map(([k, n]) => `${n} ${REASONS[k] || k}`).join(' · ')));
        parts.push(el('h4', {}, 'Prochaines cartes mises en vente'), ...rows(st.next || [], (c) => el('div', { class: 'wmx-as-row' }, el('b', {}, c.rarity), el('span', {}, c.title), el('small', {}, c.avg ? `Moy. ${c.avg} W` : 'prix à charger'))));
        parts.push(el('h4', {}, 'Cartes étiquetées mises de côté'), ...rows(st.excluded || [], (c) => el('div', { class: 'wmx-as-row' }, el('b', {}, c.rarity), el('span', {}, c.title),
          el('small', {}, c.reason === 'later' ? `attend la fin des ${c.after || 'raretés précédentes'}` : c.reason === 'capped' ? `trop chère : moyenne ${c.avg} W, au-dessus du maximum de ${st.cap} W (Paramètres → Assistant de vente → Prix de départ maximum)` : `${REASONS[c.reason] || c.reason}${c.until ? ` jusqu’à ${fmtAt(c.until)}` : ''}`))));
      }
      body.replaceChildren(...parts);
      toggleBtn.textContent = on() ? 'Désactiver l’assistant' : 'Activer l’assistant';
    };
    render();
    const timer = setInterval(() => { if (!back.isConnected) clearInterval(timer); else render(); }, 1000);
    const close = () => { clearInterval(timer); back.remove(); };
    const back = el('div', { class: 'wmx-modal-backdrop wmx-aspanel', onmousedown: (e) => { if (e.target === back) close(); } },
      el('div', { class: 'wmx-modal', role: 'dialog', 'aria-label': 'Assistant de vente' },
        el('header', {}, el('div', {}, el('h2', {}, 'Assistant de vente'), el('p', {}, 'Ce qu’il fait, et pourquoi.')), el('button', { class: 'wmx-close', title: 'Fermer', onclick: close }, '×')),
        body,
        el('footer', {}, el('span', {}, ''), el('div', {},
          el('button', { class: 'wmx-btn wmx-btn--ghost', title: 'Oublie les cartes écartées et les compteurs du jour', onclick: resetSkips }, 'Réinitialiser les écarts'),
          toggleBtn,
          el('button', { class: 'wmx-btn', onclick: runNow }, 'Lancer maintenant'),
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Fermer')))));
    document.body.append(back);
  }

  WMX.register({
    name: 'auto-sell',
    match: /./,
    async init() {
      WMX.gameBlockedUntil = await WMX.store.get('gameBlockedUntil', 0); // blocage du jeu en cours (403) : survit au rechargement de la page
      WMX.gameBlockN = await WMX.store.get('gameBlockN', 0);              // refus d'affilée (la pause grandit à chaque refus)
      S.skip = await WMX.store.get('autoSellSkip', {});
      S.log = await WMX.store.get('autoSellLog', {});
      retag.mem = await WMX.store.get('autoSellRetag', {});
      S.shared = await WMX.store.get('autoSellStatus', null);
      WMX.store.get('wmxSettings', {}).then(async (s) => {
        // Ancienne valeur par défaut (3 enchères) : passée une fois à la nouvelle (5), comme demandé ; un autre choix de l'utilisateur est gardé.
        if (s.autoSellMax === 3 && !(await WMX.store.get('autoSellMax5', false))) { s.autoSellMax = 5; await WMX.store.set('wmxSettings', { ...s }); }
        WMX.store.set('autoSellMax5', true);
        Object.assign(WMX.settings, s); paintAll();
      }); // la ligne d'état ne dit « désactivé » qu'avant le chargement des réglages
      // Réglages et état partagés entre les onglets : un réglage changé dans un onglet vaut aussitôt dans tous.
      WMX.onStorage((c) => {
        if (c.wmxSettings?.newValue) { Object.assign(WMX.settings, c.wmxSettings.newValue); window.dispatchEvent(new CustomEvent('wmx:settings')); }
        if (c.autoSellStatus) { S.shared = c.autoSellStatus.newValue || null; paintAll(); }
        if (c.autoSellSkip) S.skip = c.autoSellSkip.newValue || {};
        if (c.autoSellRetag) retag.mem = c.autoSellRetag.newValue || {};
        if (c.gameBlockedUntil) { WMX.gameBlockedUntil = c.gameBlockedUntil.newValue || 0; paintAll(); }
        if (c.autoSellForce && S.leader && on()) { S.pauseUntil = 0; tick(); }
      });
      window.addEventListener('wmx:settings', () => { ensureLock(); paintAll(); });
      WMX.quick.onResult((op, res) => {
        if (op.type === 'cancel') skipCard(op.item.card_id, 12 * H); // vente annulée par vous : l'assistant ne la relance pas
        if (op.type === 'tag' && op.item.add && retag.mem[op.item.card_id]) { // étiquette de vente remise à une carte invendue
          const m = retag.mem[op.item.card_id];
          if (res.ok) {
            m.done = (m.done || 0) + 1;
            if (m.done >= m.tags.length) {
              WMX.journal?.add('Assistant de vente', `« ${m.title} » invendue : étiquette ${m.tags.join(', ')} remise${m.tries ? ` (essai ${m.tries + 1})` : ''}`);
              delete retag.mem[op.item.card_id]; retag.queued.delete(op.item.card_id);
            }
            saveRetag();
          } else if (res.error) { // échec (le plus souvent : la carte n'est pas encore revenue) : nouvel essai dans 30 s, 5 essais au plus
            retag.queued.delete(op.item.card_id);
            nextTry(op.item.card_id, m, 'l’étiquette n’a pas pu être posée (carte pas encore revenue ?)');
            saveRetag();
          }
        }
        if (op.type !== 'launch') return;
        if (res.ok) { delete S.fails[op.item.card_id]; rememberSaleTags(op.item.card_id); return; }
        if (res.blocked) return; // le jeu bloque les requêtes (403) : longue pause (WMX.gameBlockedUntil, posée par la file), la carte n'y est pour rien
        // « Vous ne possédez pas cette carte » : elle revient d'une enchère invendue et le jeu ne l'a pas encore rendue. Ce n'est ni un échec de la
        // carte ni un blocage du jeu : on la laisse de côté 2 minutes, sans mettre l'assistant en pause.
        if (/ne poss[eé]dez pas/i.test(`${res.tech || ''} ${res.error || ''}`)) { skipCard(op.item.card_id, 2 * 60000); WMX.journal?.add('Assistant de vente', `${op.item.title} : pas encore revenue dans la collection (enchère invendue) : nouvel essai dans 2 min`); return; }
        if (res.unconfirmed) { S.pauseUntil = Date.now() + PAUSE; return; } // le jeu n'a rien enregistré : ce n'est pas la faute de la carte (pas d'écart), on réessaie après une pause
        if (res.gone) { skipCard(op.item.card_id, 24 * H); WMX.journal?.add('Assistant de vente', op.item.title + ' introuvable dans la collection : écartée 24 h', 'warn'); return; } // vendue entre-temps
        if (res.capped) { skipCard(op.item.card_id, 24 * H); return; } // trop chère pour l'assistant : on n'y revient pas avant demain
        if (res.skipped || res.limit) return;
        S.fails[op.item.card_id] = (S.fails[op.item.card_id] || 0) + 1;
        if (S.fails[op.item.card_id] >= 2) { skipCard(op.item.card_id, 6 * H); delete S.fails[op.item.card_id]; WMX.journal?.add('Assistant de vente', `${op.item.title} écartée 6 h (deux échecs de suite)`, 'warn'); }
      });
      (async () => { // boucle détachée : init() ne doit pas bloquer le démarrage des autres fonctions
        await sleep(20000); // laisse l'inventaire, les prix et la liste des ventes se charger
        for (;;) {
          if (!WMX.alive()) return;
          ensureLock();
          try { await tick(); } catch (e) { console.warn('[WMX] assistant de vente', e); }
          try { await retagSafely(); } catch (e) { console.warn('[WMX] étiquette de vente', e); }
          await sleep(EVERY);
        }
      })();
      // Cartes invendues : vérifiées toutes les 15 s pour tenir le rythme « 30 s après la fin, puis toutes les 30 s » (aucune requête au jeu
      // tant qu'aucune carte n'attend son essai).
      setInterval(() => { if (WMX.alive() && Object.keys(retag.mem).length) retagSafely().catch(() => {}); }, 15000);
    },
  });
  WMX.autoSell = { tick, skipCard, runNow, resetSkips, footer, openPanel, line, retag: { remember: rememberSaleTags, pass: retagPass, memory: () => retag.mem } };
})();
