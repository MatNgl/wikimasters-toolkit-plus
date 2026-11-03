// Assistant de vente (désactivé par défaut) : garde des emplacements d'enchères remplis avec les cartes portant l'une des étiquettes
// choisies (Paramètres). Une carte invendue revient dans la collection avec son étiquette : l'assistant la remet donc en vente tout seul.
// Pour vendre des cartes précises, il suffit de leur mettre l'étiquette (sélection native du jeu → « Étiqueter »).
// Tout passe par la file d'attente (mêmes gestes, même prix de départ que le bouton ⚡). Un seul onglet agit à la fois : celui qui prend
// le verrou, et seulement tant que l'assistant est activé (un onglet où il est désactivé ne bloque jamais les autres).
// Garde-fous : jamais une carte favorite ; une vente annulée à la main écarte la carte 12 h ; 2 échecs de suite l'écartent 6 h ;
// jamais une carte dont le prix de départ dépasse le plafond choisi (500 W par défaut) ; au plus 4 mises en vente automatiques par carte
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
  const maxActive = () => Math.max(1, Math.min(10, Number(WMX.settings?.autoSellMax) || 3));
  const REASONS = { gone: 'plus dans votre collection (vendue ?)', favorite: 'favorite (verrouillée)', busy: 'déjà en vente ou en file', skipped: 'écartée temporairement', capped: 'trop chère pour l’assistant', perDay: 'limite de 4 mises en vente par jour' };

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
    return { text: `${head} · ${st.reason}`, cls: st.state === 'listed' ? 'go' : st.state === 'nothing' || st.state === 'no-inventory' || st.state === 'paused' ? 'warn' : 'ok' };
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
      const items = WMX.inventory.items(); // la liste en cache suffit : l'inventaire se recharge parfois pendant des minutes (jeu lent)
      if (!items.length) return done('no-inventory', WMX.inventory.isLoading() ? 'chargement de la collection en cours, reprise à la prochaine passe' : 'collection indisponible pour le moment, nouvelle tentative à la prochaine passe');
      if (WMX.quick.isRunning()) return done('queue-busy', 'file d’attente occupée, reprise à la fin', { queued: WMX.quick.queued() });
      if (S.pauseUntil > now) return done('paused', S.blockedPause ? `le jeu bloque les requêtes (erreur 403) : l’assistant le laisse tranquille jusqu’à ${fmtAt(S.pauseUntil)}` : `le jeu n’a pas enregistré la dernière mise en vente : nouvel essai à ${fmtAt(S.pauseUntil)} (page rechargée)`);
      await WMX.quick.refresh();
      const active = WMX.quick.count();
      const free = Math.min(st.target - active, WMX.quick.max() - active);
      const busy = new Set(items.filter((it) => WMX.quick.stateOf(it.card_id) !== 'idle').map((it) => it.card_id));
      const plan = WMX.logic.autoSellPlan(items, { tags: st.tags, busy, gone: (it) => WMX.quick.notOwned(it.card_id), skip: S.skip, log: S.log, now, perDay: 4, cap: st.cap, avg: (it) => WMX.prices.get(it.card_id, it.rarity)?.avg || 0 });
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
        next: plan.eligible.slice(0, 10).map((it) => ({ title: it.title, rarity: it.rarity, avg: Math.round(WMX.prices.get(it.card_id, it.rarity)?.avg || 0) })),
        excluded: plan.excluded.slice(0, 60).map((e) => ({ title: e.title, rarity: e.rarity, reason: e.reason, until: e.until })),
      };
      if (free <= 0) return done('full', `toutes les enchères visées sont en cours (${active}/${st.target})`, detail);
      const picks = plan.eligible.slice(0, free);
      if (!picks.length) {
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
    ensureLock();
    S.pauseUntil = 0; // un lancement demandé à la main passe outre la pause
    if (S.leader) { await tick(); return WMX.toast?.(`Assistant de vente : ${line().text}`, 5000); }
    await WMX.store.set('autoSellForce', Date.now()); // l'onglet qui pilote l'assistant lance une passe
    WMX.toast?.('Demande envoyée à l’onglet qui pilote l’assistant…', 4000);
    setTimeout(() => { if (!S.shared || Date.now() - S.shared.t > 15000) WMX.toast?.('Aucun onglet du jeu ne pilote l’assistant pour l’instant : gardez un onglet du jeu ouvert.', 7000); }, 8000);
    return undefined;
  }
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
        parts.push(el('div', { class: 'wmx-as-meta' }, `Étiquettes : ${(st.tags || []).join(', ') || '—'} · ${st.tagged ?? 0} carte(s) étiquetée(s) · ${st.eligible ?? 0} éligible(s)`));
        if (st.counts && Object.keys(st.counts).length) parts.push(el('div', { class: 'wmx-as-meta' }, 'Écartées : ' + Object.entries(st.counts).map(([k, n]) => `${n} ${REASONS[k] || k}`).join(' · ')));
        parts.push(el('h4', {}, 'Prochaines cartes mises en vente'), ...rows(st.next || [], (c) => el('div', { class: 'wmx-as-row' }, el('b', {}, c.rarity), el('span', {}, c.title), el('small', {}, c.avg ? `Moy. ${c.avg} W` : 'prix à charger'))));
        parts.push(el('h4', {}, 'Cartes étiquetées mises de côté'), ...rows(st.excluded || [], (c) => el('div', { class: 'wmx-as-row' }, el('b', {}, c.rarity), el('span', {}, c.title),
          el('small', {}, `${REASONS[c.reason] || c.reason}${c.until ? ` jusqu’à ${fmtAt(c.until)}` : ''}`))));
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
      S.skip = await WMX.store.get('autoSellSkip', {});
      S.log = await WMX.store.get('autoSellLog', {});
      S.shared = await WMX.store.get('autoSellStatus', null);
      WMX.store.get('wmxSettings', {}).then((s) => { Object.assign(WMX.settings, s); paintAll(); }); // la ligne d'état ne dit « désactivé » qu'avant le chargement des réglages
      // Réglages et état partagés entre les onglets : un réglage changé dans un onglet vaut aussitôt dans tous.
      WMX.onStorage((c) => {
        if (c.wmxSettings?.newValue) { Object.assign(WMX.settings, c.wmxSettings.newValue); window.dispatchEvent(new CustomEvent('wmx:settings')); }
        if (c.autoSellStatus) { S.shared = c.autoSellStatus.newValue || null; paintAll(); }
        if (c.autoSellSkip) S.skip = c.autoSellSkip.newValue || {};
        if (c.autoSellForce && S.leader && on()) { S.pauseUntil = 0; tick(); }
      });
      window.addEventListener('wmx:settings', () => { ensureLock(); paintAll(); });
      WMX.quick.onResult((op, res) => {
        if (op.type === 'cancel') skipCard(op.item.card_id, 12 * H); // vente annulée par vous : l'assistant ne la relance pas
        if (op.type !== 'launch') return;
        if (res.ok) { delete S.fails[op.item.card_id]; return; }
        if (res.blocked) { S.pauseUntil = Date.now() + 10 * 60000; S.blockedPause = true; return; } // le jeu bloque les requêtes (403) : longue pause, la carte n'y est pour rien
        if (res.unconfirmed) { S.blockedPause = false; S.pauseUntil = Date.now() + PAUSE; return; } // le jeu n'a rien enregistré : ce n'est pas la faute de la carte (pas d'écart), on réessaie après une pause
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
          await sleep(EVERY);
        }
      })();
    },
  });
  WMX.autoSell = { tick, skipCard, runNow, resetSkips, footer, openPanel, line };
})();
