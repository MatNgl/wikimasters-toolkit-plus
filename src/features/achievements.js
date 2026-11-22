// Page « Succès » (/achievements) : un grand bandeau « Tout réclamer » en haut de la page quand des récompenses sont à récupérer.
// Le jeu met un bouton « Réclamer » sur chaque succès débloqué dont la récompense n'a pas été prise (POST /api/achievements/claim, une
// récompense à la fois). Le bandeau clique ces boutons un par un, comme le ferait le joueur, avec une courte pause entre deux, et suit
// la réponse du jeu : un succès est réclamé quand son bouton disparaît. Un seul succès à réclamer : le bandeau le propose quand même.
(() => {
  const { el, sleep } = WMX.dom;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const isPage = () => /^\/achievements\/?$/.test(location.pathname);
  const plural = (n, one, many) => `${fmt(n)} ${n > 1 ? many : one}`;

  const S = { run: null, result: null, banner: null, timer: null, hideT: null };

  // --- Lecture de la page du jeu ---------------------------------------------------------------------------------------------------
  /** Boutons de récompense du jeu : « Réclamer » (prêt) ou « Réclamation... » (demande en cours). */
  const claimButtons = () => [...document.querySelectorAll('main button')].filter((b) => !b.closest('.wmx-ach') && /^Réclam(er|ation)/.test(norm(b.textContent)));
  const ready = (b) => norm(b.textContent) === 'Réclamer' && !b.disabled;
  /** Carte du succès qui porte ce bouton : le plus proche ancêtre qui contient un titre. */
  const cardOf = (b) => { let n = b.parentElement; while (n && n !== document.body && !n.querySelector('h3')) n = n.parentElement; return n && n !== document.body ? n : null; };
  const titleOf = (b) => norm(cardOf(b)?.querySelector('h3')?.textContent);
  /** Récompense affichée sur la carte (« +500 wikibidous »). */
  const rewardOf = (b) => { const m = norm(cardOf(b)?.textContent).match(/\+\s*([\d\s  ]+?)\s*wikibidous/i); return m ? Number(m[1].replace(/\D/g, '')) || 0 : 0; };
  const todo = () => claimButtons().filter(ready).map((b) => ({ title: titleOf(b), reward: rewardOf(b) }));
  const stateOf = (title) => { const b = claimButtons().find((x) => titleOf(x) === title); return !b ? 'gone' : ready(b) ? 'ready' : 'busy'; };

  // --- Réclamation -------------------------------------------------------------------------------------------------------------------
  async function claimAll() {
    if (S.run) return;
    const list = todo();
    if (!list.length) return;
    clearTimeout(S.hideT);
    const run = S.run = { total: list.length, done: 0, ok: 0, failed: 0, gain: 0, note: '', stop: false, current: '' };
    S.result = null;
    paint();
    let strikes = 0;
    try {
      for (const t of list) {
        if (run.stop || !isPage() || !WMX.alive()) break;
        if ((WMX.gameBlockedUntil || 0) > Date.now()) { run.note = 'Le jeu demande de patienter : réessayez dans un instant.'; break; }
        const b = claimButtons().find((x) => ready(x) && titleOf(x) === t.title);
        if (!b) { run.done += 1; if (stateOf(t.title) === 'gone') run.ok += 1; continue; } // déjà réclamé entre-temps
        run.current = t.title;
        paint();
        const t0 = Date.now();
        b.click();
        let seenBusy = false;
        let res = 'timeout';
        while (Date.now() - t0 < 12000) { // la réponse du jeu : le bouton disparaît (réclamé) ou revient à « Réclamer » (refusé)
          await sleep(100);
          const st = stateOf(t.title);
          if (st === 'busy') seenBusy = true;
          if (st === 'gone') { res = 'ok'; break; }
          if (st === 'ready' && (seenBusy || Date.now() - t0 > 2500)) { res = 'refused'; break; }
        }
        run.done += 1;
        if (res === 'ok') { run.ok += 1; run.gain += t.reward; strikes = 0; } else { run.failed += 1; strikes += 1; }
        paint();
        if (strikes >= 2) { run.note = 'Le jeu n’a pas accepté la réclamation : réessayez dans un instant.'; break; }
        if (t !== list[list.length - 1]) await sleep(450 + Math.random() * 350); // courte pause entre deux réclamations
      }
    } finally {
      S.run = null;
      S.result = { ok: run.ok, failed: run.failed, gain: run.gain, total: run.total, note: run.note, stopped: run.stop, at: Date.now() };
      if (run.ok) {
        WMX.journal?.add('Succès', `${plural(run.ok, 'récompense réclamée', 'récompenses réclamées')} : +${fmt(run.gain)} wikibidous${run.failed ? ` (${run.failed} refusée${run.failed > 1 ? 's' : ''} par le jeu)` : ''}`, run.failed ? 'warn' : 'info');
        WMX.toast?.(`+${fmt(run.gain)} wikibidous réclamés (${plural(run.ok, 'succès', 'succès')}).`, 5000, { kind: 'ok' });
      } else if (run.failed) WMX.journal?.add('Succès', `réclamation refusée par le jeu (${run.failed} essai${run.failed > 1 ? 's' : ''})`, 'warn');
      paint();
      S.hideT = setTimeout(() => { S.result = null; paint(); }, 10000);
    }
  }

  // --- Bandeau ----------------------------------------------------------------------------------------------------------------------
  const GIFT = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
  const icon = (markup, cls) => { const s = el('span', { class: `wmx-ach-ico ${cls || ''}`.trim() }); WMX.dom.svg(s, markup); return s; };

  function host() {
    return document.querySelector('main h1')?.closest('div.flex-1') || document.querySelector('main');
  }

  function paint() {
    if (!isPage()) { S.banner?.remove(); S.banner = null; return; }
    const list = S.run ? [] : todo();
    const run = S.run;
    const res = !run && S.result && (!list.length || S.result.failed) ? S.result : null; // un refus reste affiché, même s'il reste des succès à réclamer
    if (!run && !res && !list.length) { S.banner?.remove(); S.banner = null; return; }
    const h = host();
    if (!h) return;
    if (!S.banner) S.banner = el('div', { class: 'wmx-ach', role: 'status', 'aria-live': 'polite' });
    const b = S.banner;
    let kids;
    if (run) {
      const stop = el('button', { type: 'button', class: 'wmx-ach-stop', onclick: () => { run.stop = true; paint(); } }, run.stop ? 'Arrêt…' : 'Arrêter');
      if (run.stop) stop.disabled = true;
      kids = [icon(GIFT, 'busy'), el('div', { class: 'wmx-ach-txt' },
        el('b', {}, `Réclamation en cours… ${run.done}/${run.total}`),
        el('small', {}, `${run.current ? `« ${run.current} » · ` : ''}${run.gain ? `+${fmt(run.gain)} wikibidous reçus` : 'un instant…'}`),
        el('div', { class: 'wmx-ach-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round((100 * run.done) / run.total)}%` }))), stop];
      b.className = 'wmx-ach';
    } else if (res) {
      const good = res.ok > 0;
      kids = [icon(good ? CHECK : GIFT, good && !res.failed ? 'ok' : 'warn'), el('div', { class: 'wmx-ach-txt' },
        el('b', {}, good ? `${plural(res.ok, 'succès réclamé', 'succès réclamés')} · +${fmt(res.gain)} wikibidous` : 'Aucune récompense réclamée'),
        el('small', {}, res.note || (res.failed ? `${plural(res.failed, 'refusé', 'refusés')} par le jeu : réessayez dans un instant.` : 'Tout est à jour.'))),
        ...(list.length ? [el('button', { type: 'button', class: 'wmx-ach-go', onclick: claimAll }, `Réessayer (${list.length})`)] : [])];
      b.className = `wmx-ach ${good && !res.failed ? 'is-ok' : 'is-warn'}`;
    } else {
      const sum = list.reduce((n, t) => n + t.reward, 0);
      const one = list.length === 1;
      const go = el('button', { type: 'button', class: 'wmx-ach-go', onclick: claimAll }, one ? 'Réclamer le succès' : `Tout réclamer (${list.length})`);
      kids = [icon(GIFT), el('div', { class: 'wmx-ach-txt' },
        el('b', {}, one ? '1 succès à réclamer' : `${list.length} succès à réclamer`),
        el('small', {}, one ? `« ${list[0].title} »${list[0].reward ? ` · +${fmt(list[0].reward)} wikibidous` : ''}` : `${sum ? `+${fmt(sum)} wikibidous à récupérer` : 'Récompenses à récupérer'} · un seul clic`)), go];
      b.className = 'wmx-ach';
    }
    // Pas de réécriture inutile : le texte et les boutons ne changent pas à chaque balayage (le bouton garde son focus).
    const sig = kids.map((k) => k.outerHTML).join('');
    if (b.dataset.sig !== sig) { b.dataset.sig = sig; b.replaceChildren(...kids); }
    if (!b.isConnected || b.parentElement !== h) h.prepend(b);
  }

  const schedule = () => { clearTimeout(S.timer); S.timer = setTimeout(paint, 150); };

  WMX.register({
    name: 'achievements',
    match: /^\/achievements/,
    init() {
      new MutationObserver((muts) => { if (WMX.dom.foreign(muts)) schedule(); }).observe(document.body, { childList: true, subtree: true, characterData: true });
      WMX.onApi?.(({ path }) => { if (/^\/api\/achievements\//.test(path)) schedule(); });
      setInterval(() => { if (WMX.alive()) paint(); }, 1500); // filet : la page du jeu peut remplacer son contenu sans qu'on le voie
      schedule();
    },
  });
  WMX.achievements = { claimAll, todo, paint };
})();
