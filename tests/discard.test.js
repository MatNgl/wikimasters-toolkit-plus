// Défausse par critères : fenêtres et pilotage de la sélection du jeu, sur une fausse page Collection (mêmes boutons et textes que le jeu).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), headers: { get: () => null } });

/** Fausse page Collection du jeu : 50 cartes par page, « Sélectionner », « Tout sélectionner (page) », compteur, « Défausser », fenêtre « N × C ». */
function fakeGame(w, cards, { perPage = 50, discardAllCopies = true } = {}) {
  const d = w.document;
  const st = { selecting: false, sel: new Set(), page: 0, list: cards.map((c, i) => ({ ...c, uid: i })), discarded: [], dialogs: 0 };
  const main = d.createElement('main');
  d.body.append(main);
  const button = (text, on) => { const b = d.createElement('button'); b.textContent = text; b.addEventListener('click', on); return b; };
  function render() {
    st.page = Math.max(0, Math.min(st.page, Math.ceil(st.list.length / perPage) - 1)); // comme le jeu : jamais au-delà de la dernière page
    main.replaceChildren();
    const bar = d.createElement('div');
    if (!st.selecting) bar.append(button('Sélectionner', () => { st.selecting = true; st.sel.clear(); render(); }));
    else {
      bar.append(button('Quitter la sélection', () => { st.selecting = false; st.sel.clear(); render(); }),
        button('Tout sélectionner (page)', () => { for (const c of pageCards()) st.sel.add(c.uid); render(); })); // comme le jeu : favorites comprises
      const n = d.createElement('span'); n.textContent = `${st.sel.size} carte${st.sel.size > 1 ? 's' : ''} sélectionnée${st.sel.size > 1 ? 's' : ''}`; bar.append(n);
      bar.append(button(`Défausser (+${st.sel.size * 2})`, openDialog));
    }
    const grid = d.createElement('div'); grid.className = 'flex flex-wrap';
    for (const c of pageCards()) {
      const card = d.createElement('div'); card.className = 'relative isolate group cursor-pointer rounded-2xl';
      const badge = d.createElement('div'); badge.className = 'absolute top-2 left-2'; badge.textContent = c.rarity;
      const h3 = d.createElement('h3'); h3.textContent = c.title;
      card.append(badge, h3);
      card.addEventListener('click', () => { if (!st.selecting) return; st.sel.has(c.uid) ? st.sel.delete(c.uid) : st.sel.add(c.uid); render(); });
      grid.append(card);
    }
    main.append(bar, grid);
    if (st.page > 0) main.append(button('← Précédent', () => { st.page -= 1; st.sel.clear(); render(); }));
    if ((st.page + 1) * perPage < st.list.length) main.append(button('Suivant →', () => { st.page += 1; st.sel.clear(); render(); }));
    if (st.toast) { const t = d.createElement('div'); t.textContent = st.toast; main.append(t); }
  }
  const pageCards = () => st.list.slice(st.page * perPage, (st.page + 1) * perPage);
  function openDialog() {
    st.dialogs += 1;
    const chosen = st.list.filter((c) => st.sel.has(c.uid) && !c.starred); // comme le jeu : une favorite sélectionnée n'est jamais défaussée
    const by = {};
    for (const c of chosen) by[c.rarity] = (by[c.rarity] || 0) + (discardAllCopies ? c.count : 1);
    const dlg = d.createElement('div'); dlg.setAttribute('role', 'dialog');
    dlg.append(Object.assign(d.createElement('p'), { textContent: `Défausser ces cartes ? ${Object.entries(by).map(([r, n]) => `${n} × ${r}`).join(', ')}.` }),
      button('Annuler', () => dlg.remove()),
      button('Défausser', () => {
        st.discarded.push(...chosen.map((c) => c.title));
        st.list = st.list.filter((c) => !st.sel.has(c.uid));
        st.toast = `${chosen.length} cartes défaussées`;
        st.sel.clear(); dlg.remove(); render();
      }));
    d.body.append(dlg);
  }
  render();
  return st;
}

function setup(cards, opts) {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  const items = cards.map((c, i) => ({ id: `row${i}`, card_id: `id${i}`, title: c.title, rarity: c.rarity, count: c.count || 1, starred: !!c.starred, image: c.image ?? 'x.jpg', tags: c.tags || [], at: '' }));
  WMX.inventory.items = () => items;
  WMX.inventory.find = (t, r) => items.find((it) => it.title === t && it.rarity === r) || null;
  WMX.inventory.ensure = async () => {};
  WMX.prices.get = () => ({ avg: 3 });
  WMX.prices.has = () => true;
  const game = fakeGame(w, cards.map((c, i) => ({ ...c, count: c.count || 1, uid: i })), opts);
  return { env, w, WMX, game, items };
}

const cardsA = () => [
  ...Array.from({ length: 30 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' })),
  { title: 'Rare étiquetée', rarity: 'R', tags: [{ name: 'animaux' }] },
  { title: 'Commune favorite', rarity: 'C', starred: true },
  { title: 'Commune animaux', rarity: 'C', tags: [{ name: 'animaux' }] },
  ...Array.from({ length: 40 }, (_, i) => ({ title: `PC ${i}`, rarity: 'PC' })),
  ...Array.from({ length: 5 }, (_, i) => ({ title: `Commune fin ${i}`, rarity: 'C' })),
];

test('défausse : fenêtre de sélection (raretés, étiquettes, options), puis confirmation avec la liste', async () => {
  const { env, w, WMX } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.discard.openPicker();
  const dlg = () => w.document.querySelector('.wmx-dc .wmx-dlg');
  assert.ok(dlg(), 'la fenêtre de sélection s’ouvre');
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /35 exemplaires à défausser/, 'C sans étiquette par défaut, sans la favorite ni l’étiquetée');
  const tagBtn = dlg().querySelector('button.wmx-dc-tag');
  assert.match(tagBtn.textContent, /Cartes sans étiquette/, 'aucune étiquette choisie : cartes sans étiquette');
  tagBtn.click();
  const row = () => [...dlg().querySelectorAll('.wmx-dc-tagrow')].find((r) => /animaux/.test(r.textContent));
  assert.match(row().textContent, /animaux2/, 'menu déroulant des étiquettes du compte, avec leur nombre');
  row().querySelector('input').click();
  assert.match(dlg().querySelector('button.wmx-dc-tag').textContent, /Étiquettes : animaux/);
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /1 exemplaire à défausser/, 'seulement la C étiquetée « animaux »');
  row().querySelector('input').click();
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /35 exemplaires/, 'retour aux cartes sans étiquette');
  const opt = (label) => [...dlg().querySelectorAll('.wmx-dc-opt')].find((o) => o.querySelector('b').textContent === label).querySelector('.wmx-switch');
  opt('Défausser aussi les cartes étiquetées').click();
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /36 exemplaires/, 'l’étiquetée C est comprise');
  assert.ok(dlg().querySelector('.wmx-pm-tags'), 'les étiquettes à protéger apparaissent');
  opt('Défausser aussi les cartes étiquetées').click();
  [...dlg().querySelectorAll('.wmx-chip2')].find((b) => /^PC ·/.test(b.textContent)).click();
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /75 exemplaires/);
  [...dlg().querySelectorAll('.wmx-dlg-row .wmx-btn')].find((b) => /^Continuer/.test(b.textContent)).click();
  const conf = w.document.querySelector('.wmx-dc [role=alertdialog]');
  assert.ok(conf, 'fenêtre de confirmation');
  assert.match(conf.querySelector('h3').textContent, /Défausser 75 exemplaires \?/);
  assert.equal(conf.querySelectorAll('.wmx-dc-row').length, 75, 'la liste complète est montrée');
  const go = [...conf.querySelectorAll('.wmx-dlg-row .wmx-btn')].pop();
  assert.match(go.textContent, /Essai à blanc/, 'essai à blanc par défaut');
  [...conf.querySelectorAll('.wmx-dc-opt')].find((o) => /Essai à blanc/.test(o.textContent)).querySelector('.wmx-switch').click();
  assert.ok(go.disabled, 'défausse réelle : la case « j’ai compris » est obligatoire');
  conf.querySelector('.wmx-dc-ack input').click();
  assert.ok(!go.disabled);
  env.close();
});

test('défausse : essai à blanc (sélection vérifiée, rien de défaussé) puis défausse réelle page par page', async () => {
  const { env, w, WMX, game } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  const pl = WMX.discard.plan({ rarities: ['C'], tag: '', includeTagged: false, keepUnpriced: true, protectSale: true });
  assert.equal(pl.copies, 35);
  await WMX.discard.start(pl, { dry: true, visible: true });
  assert.equal(game.discarded.length, 0, 'essai à blanc : rien n’est défaussé');
  assert.ok(game.dialogs >= 1, 'la fenêtre de défausse du jeu a été ouverte et vérifiée : ' + w.document.querySelector('.wmx-dc-run')?.textContent);
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /essai réussi : 35 exemplaires/);
  assert.equal(game.selecting, false, 'la sélection du jeu est refermée');
  await WMX.discard.start(pl, { dry: false, visible: true });
  assert.equal(game.discarded.length, 35, 'les 35 communes sans étiquette sont défaussées');
  assert.ok(!game.discarded.includes('Commune favorite') && !game.discarded.includes('Commune animaux'), 'jamais la favorite ni l’étiquetée');
  assert.ok(game.list.some((c) => c.rarity === 'PC'), 'les autres raretés restent');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /35 exemplaires défaussés/);
  env.close();
});

test('défausse : un nombre du jeu qui ne correspond pas arrête tout (doublons défaussés en entier)', async () => {
  const cards = [{ title: 'Double', rarity: 'C', count: 3 }, { title: 'Simple', rarity: 'C' }];
  const { env, w, WMX, game } = setup(cards);
  await WMX.features.find((f) => f.name === 'discard').init();
  const pl = WMX.discard.plan({ rarities: ['C'], keepOne: true, keepUnpriced: true });
  assert.equal(pl.copies, 2, 'garder 1 exemplaire : 2 des 3 doubles');
  await WMX.discard.start(pl, { dry: false, visible: true });
  assert.equal(game.discarded.length, 0, 'le jeu aurait défaussé les 3 exemplaires : rien n’est défaussé');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /3 × C au lieu de 2 × C.*Garder 1 exemplaire/);
  env.close();
});

test('défausse en arrière-plan : la page invisible est pilotée, la progression « N / total » s’affiche, la page est retirée à la fin', async () => {
  const { env, w, WMX, game } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  let removed = false;
  WMX.discard.frameFactory = async () => ({ d: w.document, w, frame: null, remove: () => { removed = true; } }); // la fausse page joue la page invisible
  w.history.pushState({}, '', '/marketplace'); // l'utilisateur est ailleurs : l'arrière-plan n'a pas besoin de la page Collection
  const pl = WMX.discard.plan({ rarities: ['C'], keepUnpriced: true });
  const run = WMX.discard.start(pl, { dry: false });
  await sleep(1500);
  assert.match(w.document.querySelector('.wmx-dc-run-num').textContent, /\/ 35 exemplaires défaussés/, 'progression sur le total repéré');
  await run;
  assert.equal(game.discarded.length, 35);
  assert.match(w.document.querySelector('.wmx-dc-run-num').textContent, /^35 \/ 35/);
  await sleep(1700);
  assert.ok(removed, 'la page invisible est retirée');
  env.close();
});

test('défausse : mode visible refusé hors de la page Collection (rien n’est lancé)', async () => {
  const { env, w, WMX, game } = setup(cardsA());
  w.history.pushState({}, '', '/marketplace');
  const pl = WMX.discard.plan({ rarities: ['C'], keepUnpriced: true });
  await WMX.discard.start(pl, { dry: false, visible: true });
  assert.equal(game.discarded.length, 0);
  assert.equal(WMX.discard.isRunning(), false);
  env.close();
});

test('défausse : les favorites cochées par « Tout sélectionner » ne sont pas décochées (le jeu les omet), et 30 cartes gardées sur une page font passer à la suivante', async () => {
  const cards = [
    ...Array.from({ length: 35 }, (_, i) => ({ title: `Favorite ${i}`, rarity: 'C', starred: true })),
    ...Array.from({ length: 60 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' })),
  ];
  const { env, WMX, game } = setup(cards);
  await WMX.features.find((f) => f.name === 'discard').init();
  const pl = WMX.discard.plan({ rarities: ['C'], keepUnpriced: true });
  assert.equal(pl.copies, 60);
  await WMX.discard.start(pl, { dry: false, visible: true });
  assert.equal(game.discarded.length, 60, 'toutes les communes sont défaussées, y compris celles remontées en page 1');
  assert.ok(!game.discarded.some((t) => /Favorite/.test(t)), 'aucune favorite');
  assert.equal(game.list.length, 35, 'il ne reste que les favorites');
  env.close();
});
