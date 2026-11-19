// Tiroir à cartes : un petit panneau en bas de l'écran, à côté du cadran des paquets, où s'ajoutent les cartes tirées pendant l'ouverture
// (« Tout ouvrir », ouverture en parallèle, ouverture auto), avec l'animation du style d'ouverture choisi dans les Paramètres. Les cartes y
// restent (même après un rechargement de la page) jusqu'à « Révéler », qui les montre toutes en plein écran, dans ce même style.
// Sans « Tiroir à cartes » mais avec l'ouverture en parallèle, le panneau sert seulement à suivre l'ouverture : la révélation suit d'elle-même.
(() => {
  const { el, sleep } = WMX.dom;
  const RANKS = { C: 0, PC: 1, R: 2, SR: 3, UR: 4, L: 5 };
  const S = { cards: [], loaded: false, opening: false, keep: true, done: 0, total: 0, note: '', stop: false, collapsed: false, anim: Promise.resolve() };
  let root = null;
  const rar = (c) => WMX.normRarity(c?.rarity) || 'C';
  const rgb = (r) => WMX.RARITY_RGB?.[r] || '183 193 206';
  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
  const save = () => WMX.store.set('packDrawer', { cards: S.cards });
  const speedF = () => ({ fast: 0.45, instant: 0 }[WMX.settings?.speed] ?? 1);

  function build() {
    if (root?.isConnected) return root;
    root = el('div', { class: 'wmx-dr', role: 'region', 'aria-label': 'Tiroir à cartes', hidden: '' });
    document.body.append(root);
    WMX.dom.keepAttached?.(root); // le jeu peut vider <body> en changeant de page : le tiroir y revient
    return root;
  }
  function paint() {
    build();
    const n = S.cards.length;
    const show = S.opening || n > 0;
    root.hidden = !show;
    if (!show) return;
    root.classList.toggle('collapsed', S.collapsed && !S.opening);
    root.classList.toggle('opening', S.opening);
    const pct = S.total ? Math.min(100, (S.done / S.total) * 100) : 0;
    if (S.collapsed && !S.opening) {
      const pill = el('button', { type: 'button', class: 'wmx-dr-pill', title: 'Ouvrir le tiroir à cartes' }, WMX.dom.logo(18), el('b', {}, fmt(n)), el('span', {}, n > 1 ? 'cartes' : 'carte'));
      pill.addEventListener('click', () => { S.collapsed = false; paint(); });
      root.replaceChildren(pill);
      return;
    }
    const head = el('div', { class: 'wmx-dr-head' }, WMX.dom.logo(20), el('b', {}, 'Tiroir à cartes'), el('span', { class: 'wmx-dr-count' }, `${fmt(n)} carte${n > 1 ? 's' : ''}`));
    if (!S.opening) {
      const min = el('button', { type: 'button', class: 'wmx-dr-min', title: 'Réduire', 'aria-label': 'Réduire' }, '–');
      min.addEventListener('click', () => { S.collapsed = true; paint(); });
      head.append(min);
    }
    const status = S.opening
      ? el('div', { class: 'wmx-dr-status' }, el('div', { class: 'wmx-dr-line' }, el('span', {}, S.done < S.total ? `Ouverture : paquet ${fmt(S.done + 1)} / ${fmt(S.total)}` : `${fmt(S.total)} paquets ouverts`), S.note ? el('small', {}, S.note) : ''), el('div', { class: 'wmx-dr-bar' }, el('i', { style: `width:${pct}%` })))
      : el('div', { class: 'wmx-dr-status' }, el('small', {}, S.keep ? 'Cartes mises de côté : révélez-les quand vous voulez.' : 'Révélation…'));
    const stage = root.querySelector('.wmx-dr-stage') || el('div', { class: 'wmx-dr-stage', 'aria-hidden': 'true' });
    const actions = el('div', { class: 'wmx-dr-actions' });
    if (S.opening) {
      const stop = el('button', { type: 'button', class: 'wmx-btn wmx-btn--ghost' }, S.stop ? 'Arrêt…' : 'Arrêter');
      stop.disabled = S.stop;
      stop.title = 'Arrête l’ouverture : les paquets restants sont gardés, les cartes déjà tirées restent dans le tiroir';
      stop.addEventListener('click', () => { S.stop = true; paint(); });
      actions.append(stop);
    }
    if (n && S.keep) {
      const go = el('button', { type: 'button', class: 'wmx-btn' }, `Révéler (${fmt(n)})`);
      go.title = 'Montre toutes les cartes du tiroir en plein écran, avec le style d’ouverture choisi';
      go.addEventListener('click', () => reveal());
      actions.append(go);
    }
    root.replaceChildren(head, status, stage, actions);
  }

  // --- Animation des cartes qui s'ajoutent, selon le style d'ouverture -----------------------------------------------------------------
  // Classique : les cartes arrivent face cachée, l'une après l'autre (rien n'est dévoilé). Pile lumineuse : elles glissent sur une pile qui
  // grossit. Vœu : une étoile filante de la couleur de la meilleure carte du paquet, puis les cartes montent en brillant de leur rareté.
  function animate(cards) {
    S.anim = S.anim.then(async () => {
      const f = speedF();
      const stage = root?.querySelector('.wmx-dr-stage');
      if (!stage || !f) return;
      const style = WMX.settings?.revealStyle || 'classic';
      const minis = cards.slice(0, 5).map((c) => el('i', { class: 'wmx-dr-card', style: `--rgb:${rgb(rar(c))}` }, 'W'));
      if (style === 'stack') {
        const pile = el('div', { class: 'wmx-dr-pile' }, el('i'), el('i'), el('b', {}, fmt(S.cards.length - cards.length)));
        const row = el('div', { class: 'wmx-dr-row' }, ...minis);
        stage.replaceChildren(pile, row);
        for (let k = 0; k < minis.length; k++) {
          await sleep(90 * f);
          minis[k].classList.add('to-pile');
          await sleep(260 * f);
          pile.querySelector('b').textContent = fmt(S.cards.length - cards.length + k + 1);
          pile.classList.remove('bump'); void pile.offsetWidth; pile.classList.add('bump');
        }
      } else if (style === 'wish') {
        const best = cards.reduce((b, c) => (RANKS[rar(c)] > RANKS[b] ? rar(c) : b), 'C');
        const comet = el('i', { class: `wmx-dr-comet r-${best}`, style: `--rgb:${rgb(best)}` });
        stage.replaceChildren(comet);
        await sleep(900 * f);
        const row = el('div', { class: 'wmx-dr-row' }, ...minis);
        minis.forEach((m, k) => { m.classList.add('aura'); m.style.setProperty('--d', `${k * 70 * f}ms`); });
        stage.replaceChildren(row);
        await sleep((400 + minis.length * 70) * f);
      } else {
        const row = el('div', { class: 'wmx-dr-row' }, ...minis);
        minis.forEach((m, k) => m.style.setProperty('--d', `${k * 80 * f}ms`));
        stage.replaceChildren(row);
        await sleep((300 + minis.length * 80) * f);
      }
    }).catch(() => {});
    return S.anim;
  }

  /** Ajoute des cartes au tiroir (ouverture auto, par exemple), avec l'animation du style choisi. */
  function add(cards) {
    if (!cards?.length) return;
    S.cards.push(...cards);
    S.keep = true;
    save();
    paint();
    animate(cards);
  }

  /** Toutes les cartes du tiroir, en plein écran, dans le style choisi ; le tiroir se vide. */
  async function reveal() {
    const cards = S.cards.slice();
    if (!cards.length) return;
    S.cards = [];
    save();
    paint();
    await WMX.reveal(cards);
  }

  /**
   * Suivi d'une ouverture (« Tout ouvrir ») dans le tiroir, avec la même interface que l'écran de révélation pour boosters.js :
   * stopped (« Arrêter »), addPack, setRemaining, setNote, yield, finish. keep : cartes gardées dans le tiroir (sinon révélées à la fin).
   */
  function session(total, { keep = true } = {}) {
    S.opening = true; S.keep = keep; S.total = total; S.done = 0; S.note = ''; S.stop = false; S.collapsed = false;
    paint();
    return {
      get stopped() { return S.stop; },
      addPack(cards) { S.cards.push(...cards); save(); S.done = Math.min(S.total, S.done + 1); paint(); animate(cards); },
      setRemaining(n, t) { S.total = t; S.done = t - n; paint(); },
      setNote(t) { if (S.note !== (t || '')) { S.note = t || ''; paint(); } },
      yield() {},
      close() { S.opening = false; paint(); },
      async finish() {
        await S.anim; // la dernière animation se termine
        S.opening = false;
        paint();
        if (!keep) await reveal();
        else if (S.cards.length) WMX.toast?.(`${fmt(S.cards.length)} carte${S.cards.length > 1 ? 's' : ''} dans le tiroir : « Révéler » pour les voir.`, 5000);
      },
    };
  }

  WMX.packDrawer = { session, add, reveal, count: () => S.cards.length, cards: () => S.cards.slice() };

  WMX.register({
    name: 'pack-drawer',
    async init() {
      if (window.top !== window) return;
      const saved = await WMX.store.get('packDrawer', null);
      if (Array.isArray(saved?.cards) && saved.cards.length) { S.cards = saved.cards; S.collapsed = true; }
      S.loaded = true;
      paint();
    },
  });
})();
