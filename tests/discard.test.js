// Défausse par critères : fenêtres et pilotage de la sélection du jeu, sur une fausse page Collection qui reproduit la vraie
// (relevée dans le jeu : menu « Filtrer par étiquette », boutons de rareté, clic sur la carte, compteur, fenêtre « Défausser N cartes ? »).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), headers: { get: () => null } });
const RAR = ['L', 'UR', 'SR', 'R', 'PC', 'C'];

/**
 * Fausse page Collection : 50 cartes par page, filtres (une vue d'étiquette, raretés cumulables), « Sélectionner », « Tout sélectionner (page) »
 * (favorites comprises), « Défausser (+N) », fenêtre .card-frame « Défausser N cartes ? » / « N × C », un exemplaire par carte cochée, favorites
 * jamais défaussées, message « N cartes défaussées (+N wikibidous). » qui reste affiché. `failAfterDiscard` : la liste échoue à se recharger une fois
 * (« Le chargement de la collection a échoué ») ; rechoisir une vue la relit.
 */
function fakeGame(w, cards, { perPage = 50, failAfterDiscard = false, lateReload = 0, blockTimes = 0 } = {}) {
  const d = w.document;
  const st = { blocks: 0, selecting: false, sel: new Set(), page: 0, list: cards.map((c, i) => ({ ...c, uid: i })), discarded: [], dialogs: 0, view: 'all', rar: new Set(), menuOpen: false, banner: '', fail: false, lie: false };
  const main = d.createElement('main');
  d.body.append(main);
  const button = (text, on, attrs = {}) => { const b = d.createElement('button'); b.textContent = text; for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v); b.addEventListener('click', on); return b; };
  const tagsOf = () => { const m = new Map(); for (const c of st.list) for (const t of c.tags || []) m.set(t.name, (m.get(t.name) || 0) + 1); return m; };
  const filtered = () => st.list.filter((c) => (st.rar.size ? st.rar.has(c.rarity) : true)
    && (st.view === 'all' ? true : st.view === 'none' ? !(c.tags || []).length : (c.tags || []).some((t) => t.name === st.view)));
  const pages = () => Math.max(1, Math.ceil(filtered().length / perPage));
  const pageCards = () => filtered().slice(st.page * perPage, (st.page + 1) * perPage);
  function render() {
    st.page = Math.max(0, Math.min(st.page, pages() - 1));
    main.replaceChildren();
    if (!st.selecting) main.append(button('Sélectionner', () => { st.selecting = true; st.sel.clear(); render(); }));
    else main.append(button('Quitter la sélection', () => { st.selecting = false; st.sel.clear(); render(); }));
    if (st.banner) { const b = d.createElement('div'); b.className = 'card-frame p-3 flex items-start'; /* comme le vrai jeu : message dans un encadré card-frame */ const sp = d.createElement('span'); sp.textContent = st.banner; b.append(sp); main.append(b); }
    const viewText = st.view === 'all' ? 'Toutes les étiquettes' : st.view === 'none' ? 'Sans étiquette' : `#${st.view} (${tagsOf().get(st.view) || 0})`;
    main.append(button(viewText, () => { st.menuOpen = !st.menuOpen; render(); }, { 'aria-label': 'Filtrer par étiquette', 'aria-haspopup': 'listbox' }));
    if (st.menuOpen) {
      const ul = d.createElement('ul'); ul.setAttribute('role', 'listbox');
      const opt = (text, v) => ul.append(button(text, () => { st.view = v; st.menuOpen = false; st.page = 0; st.sel.clear(); st.fail = false; render(); }, { role: 'option', 'aria-selected': String(st.view === v) }));
      opt('Toutes les étiquettes', 'all'); opt('Sans étiquette', 'none');
      for (const [name, n] of tagsOf()) opt(`#${name} (${n})`, name);
      main.append(ul);
    }
    for (const r of RAR) main.append(button(r, () => { st.rar.has(r) ? st.rar.delete(r) : st.rar.add(r); st.page = 0; st.sel.clear(); render(); }, { class: `px-3 py-1 rounded-full${st.rar.has(r) ? '' : ' opacity-50'}` }));
    if (st.fail) { const p = d.createElement('p'); p.textContent = 'Le chargement de la collection a échoué. Réessaie dans un instant.'; main.append(p); }
    const nav = d.createElement('div');
    nav.append(button('← Précédent', () => { st.page -= 1; st.sel.clear(); render(); }), button(`Page ${st.page + 1} / ${pages()}`, () => {}), button('Suivant →', () => { if (st.page + 1 < pages()) { st.page += 1; st.sel.clear(); render(); } }));
    main.append(nav);
    const grid = d.createElement('div');
    const list = st.fail ? [] : pageCards();
    if (!list.length && !st.fail) { const p = d.createElement('p'); p.textContent = 'Aucune carte trouvée avec ces filtres.'; grid.append(p); }
    for (const c of list) {
      const host = d.createElement('div'); host.className = 'relative isolate group';
      const card = d.createElement('div'); card.className = 'relative rounded-2xl overflow-hidden cursor-pointer';
      const badge = d.createElement('div'); badge.className = 'absolute top-2 left-2'; badge.textContent = c.rarity;
      const h3 = d.createElement('h3'); h3.textContent = c.title;
      card.append(badge, h3);
      card.addEventListener('click', () => { if (!st.selecting) return; st.sel.has(c.uid) ? st.sel.delete(c.uid) : st.sel.add(c.uid); render(); });
      if (c.starred) { const fb = d.createElement('button'); fb.setAttribute('aria-label', 'Retirer des favoris (déverrouille la carte)'); host.append(fb); }
      const mark = d.createElement('span'); mark.className = 'pointer-events-none absolute';
      mark.innerHTML = st.sel.has(c.uid) ? '<svg class="lucide lucide-check"></svg>' : '<svg class="lucide lucide-square"></svg>';
      host.append(card, mark);
      grid.append(host);
    }
    main.append(grid);
    d.querySelector('.fake-bar')?.remove();
    if (st.selecting) {
      const bar = d.createElement('div'); bar.className = 'fixed bottom-4 card-frame fake-bar'; // comme le jeu : barre fixée en bas, hors de <main>
      const n = d.createElement('div'); n.innerHTML = `<span>${st.sel.size}</span><span>carte${st.sel.size > 1 ? 's' : ''} sélectionnée${st.sel.size > 1 ? 's' : ''}</span>`;
      const real = st.list.filter((c) => st.sel.has(c.uid) && !c.starred).length;
      bar.append(n, button('Tout sélectionner (page)', () => { for (const c of pageCards()) st.sel.add(c.uid); render(); }), button(`Défausser (+${real})`, openDialog, real ? {} : { disabled: '' }));
      d.body.append(bar);
    }
  }
  function openDialog() {
    st.dialogs += 1;
    const chosen = st.list.filter((c) => st.sel.has(c.uid) && !c.starred); // une favorite sélectionnée n'est jamais défaussée
    const by = {};
    for (const c of chosen) by[c.rarity] = (by[c.rarity] || 0) + 1; // un exemplaire par carte cochée
    if (st.lie) by.C = (by.C || 0) + 1;
    const back = d.createElement('div'); back.className = 'fixed inset-0';
    const box = d.createElement('div'); box.className = 'card-frame';
    const h3 = d.createElement('h3'); h3.textContent = `Défausser ${chosen.length} carte${chosen.length > 1 ? 's' : ''} ?`;
    const p = d.createElement('p'); p.textContent = `${Object.entries(by).map(([r, n]) => `${n} × ${r}`).join(' · ')}.`;
    box.append(h3, p, button('Annuler', () => back.remove()), button('Défausser', () => {
      // blockTimes : le jeu refuse les N premières défausses (« automatisation non autorisée »), comme le vrai jeu (réponse 403 automation_limit + message).
      if (st.blocks < blockTimes) {
        st.blocks += 1;
        back.remove();
        st.banner = 'Trop de requêtes automatisées. L’automatisation n’est pas autorisée — voir le règlement.';
        render();
        setTimeout(() => { if (/automatisées/.test(st.banner)) { st.banner = ''; render(); } }, 800);
        return;
      }
      st.discarded.push(...chosen.map((c) => c.title));
      for (const c of chosen) c.count = (c.count || 1) - 1;
      // lateReload : comme le vrai jeu, la liste n'est relue qu'un peu plus tard (les cartes défaussées restent affichées, puis tout remonte d'un cran).
      if (lateReload) setTimeout(() => { st.list = st.list.filter((c) => (c.count ?? 1) > 0); render(); }, lateReload);
      else st.list = st.list.filter((c) => (c.count ?? 1) > 0);
      st.banner = `${chosen.length} carte${chosen.length > 1 ? 's' : ''} défaussée${chosen.length > 1 ? 's' : ''} (+${chosen.length} wikibidou${chosen.length > 1 ? 's' : ''}).`;
      st.sel.clear(); back.remove();
      if (failAfterDiscard && !st.failedOnce) { st.failedOnce = true; st.fail = true; } // la liste ne se recharge pas
      render();
    }));
    back.append(box);
    d.body.append(back);
  }
  render();
  st.rerender = render;
  return st;
}

function setup(cards, opts) {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  const items = cards.map((c, i) => ({ id: `row${i}`, card_id: `id${i}`, title: c.title, rarity: c.rarity, count: c.count || 1, starred: !!c.starred && !c.domOnlyFav, image: c.image ?? 'x.jpg', tags: c.tags || [], at: '' }));
  WMX.inventory.items = () => items;
  WMX.inventory.find = (t, r) => items.find((it) => it.title === t && it.rarity === r) || null;
  WMX.inventory.ensure = async () => {};
  WMX.prices.get = () => ({ avg: 3 });
  WMX.prices.has = () => true;
  const game = fakeGame(w, cards.map((c, i) => ({ ...c, count: c.count || 1, uid: i })), opts);
  return { env, w, WMX, game, items };
}

const TEST = [{ name: 'TEST' }];
const cardsA = () => [
  ...Array.from({ length: 30 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' })),
  { title: 'Rare étiquetée', rarity: 'R', tags: [{ name: 'animaux' }] },
  { title: 'Commune favorite', rarity: 'C', starred: true },
  { title: 'Commune animaux', rarity: 'C', tags: [{ name: 'animaux' }] },
  ...Array.from({ length: 40 }, (_, i) => ({ title: `PC ${i}`, rarity: 'PC' })),
  ...Array.from({ length: 5 }, (_, i) => ({ title: `Commune fin ${i}`, rarity: 'C' })),
  ...Array.from({ length: 8 }, (_, i) => ({ title: `Test ${i}`, rarity: 'C', tags: TEST })),
];

test('défausse : fenêtre de sélection (raretés, étiquettes, options), puis confirmation avec la liste', async () => {
  const { env, w, WMX } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.discard.openPicker();
  const dlg = () => w.document.querySelector('.wmx-dc .wmx-dlg');
  assert.ok(dlg(), 'la fenêtre de sélection s’ouvre');
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /35 exemplaires à défausser/, 'C sans étiquette par défaut, sans la favorite ni les étiquetées');
  const tagBtn = dlg().querySelector('button.wmx-dc-tag');
  assert.match(tagBtn.textContent, /Cartes sans étiquette/);
  tagBtn.click();
  const row = (name) => [...dlg().querySelectorAll('.wmx-dc-tagrow')].find((r) => r.textContent.startsWith(name));
  assert.match(row('animaux').textContent, /animaux2/, 'menu déroulant des étiquettes du compte, avec leur nombre');
  row('animaux').querySelector('input').click();
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /1 exemplaire à défausser/, 'seulement la C étiquetée « animaux »');
  row('TEST').querySelector('input').click();
  assert.match(dlg().querySelector('button.wmx-dc-tag').textContent, /Étiquettes : animaux, TEST/, 'plusieurs étiquettes');
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /9 exemplaires/);
  row('animaux').querySelector('input').click(); row('TEST').querySelector('input').click();
  const opt = (label) => [...dlg().querySelectorAll('.wmx-dc-opt')].find((o) => o.querySelector('b').textContent === label).querySelector('.wmx-switch');
  opt('Défausser aussi les cartes étiquetées').click();
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /44 exemplaires/, 'les étiquetées C sont comprises');
  opt('Défausser aussi les cartes étiquetées').click();
  [...dlg().querySelectorAll('.wmx-chip2')].find((b) => /^PC ·/.test(b.textContent)).click();
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /75 exemplaires/);
  [...dlg().querySelectorAll('.wmx-dlg-row .wmx-btn')].find((b) => /^Continuer/.test(b.textContent)).click();
  const conf = w.document.querySelector('.wmx-dc [role=alertdialog]');
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

test('défausse : fenêtre qui ne se ferme pas au clic à côté (croix), rareté facultative avec une étiquette, menu des étiquettes refermé au clic ailleurs, prix inconnus à vérifier', async () => {
  const { env, w, WMX } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.discard.openPicker();
  const back = () => w.document.querySelector('.wmx-dc');
  const dlg = () => w.document.querySelector('.wmx-dc .wmx-dlg');
  const go = () => [...dlg().querySelectorAll('.wmx-dlg-row .wmx-btn')].find((b) => /^Continuer/.test(b.textContent));
  // Clic à côté de la fenêtre : elle reste ouverte.
  back().dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  assert.ok(dlg(), 'un clic à côté ne ferme pas la fenêtre');
  // Aucune rareté et aucune étiquette : message rouge à côté des raretés, Continuer grisé.
  [...dlg().querySelectorAll('.wmx-chip2')].find((b) => /^C ·/.test(b.textContent)).click();
  assert.match(dlg().querySelector('.wmx-dc-err')?.textContent || '', /Choisissez au moins une rareté ou une étiquette/);
  assert.ok(go().disabled);
  // Une étiquette sans rareté : toutes les raretés de l'étiquette (la R et la C « animaux »).
  dlg().querySelector('button.wmx-dc-tag').click();
  const row = (name) => [...dlg().querySelectorAll('.wmx-dc-tagrow')].find((r) => r.textContent.startsWith(name));
  row('animaux').querySelector('input').click();
  assert.equal(dlg().querySelector('.wmx-dc-err'), null, 'plus de message d’erreur');
  assert.match(dlg().querySelector('.wmx-dc-hint').textContent, /toutes les raretés des étiquettes choisies/);
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /2 exemplaires à défausser/);
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /1 × R · 1 × C/);
  assert.ok(!go().disabled);
  // Menu des étiquettes ouvert : un clic ailleurs dans la fenêtre le referme.
  assert.ok(!dlg().querySelector('.wmx-dc-tagpanel').hidden, 'menu ouvert');
  dlg().querySelector('h3').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  assert.ok(dlg().querySelector('.wmx-dc-tagpanel').hidden, 'clic ailleurs : menu refermé');
  // Prix inconnus « en dernier » : rien à défausser tout de suite, mais on peut continuer (cartes à vérifier).
  row('animaux').querySelector('input').click();
  [...dlg().querySelectorAll('.wmx-chip2')].find((b) => /^C ·/.test(b.textContent)).click();
  WMX.prices.has = () => false;
  const sel = dlg().querySelector('select.wmx-dc-unpriced');
  sel.value = 'last';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /Rien à défausser tout de suite/);
  assert.match(dlg().querySelector('.wmx-dc-sum').textContent, /35 cartes au prix inconnu, vérifiées pendant la défausse/);
  assert.match(dlg().querySelector('.wmx-dc-prices').textContent, /Charger ces prix maintenant/);
  assert.ok(!go().disabled, 'on peut continuer : les prix seront chargés pendant la défausse');
  go().click();
  const conf = w.document.querySelector('.wmx-dc [role=alertdialog]');
  assert.match(conf.querySelector('h3').textContent, /Vérifier 35 cartes au prix inconnu \?/);
  // La croix ferme.
  conf.querySelector('.wmx-dlg-x').click();
  assert.equal(w.document.querySelector('.wmx-dc'), null, 'la croix ferme la fenêtre');
  env.close();
});

test('défausse : filtres du jeu appliqués (rareté + étiquette), essai à blanc puis défausse réelle', async () => {
  const { env, w, WMX, game } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], tags: ['TEST'], keepUnpriced: true };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 8);
  await WMX.discard.start(pl, { dry: true, visible: true, prefs: p });
  assert.equal(game.view, 'TEST', 'vue « #TEST » choisie dans le menu du jeu');
  assert.deepEqual([...game.rar], ['C'], 'rareté C activée');
  assert.equal(game.discarded.length, 0, 'essai à blanc : rien n’est défaussé');
  assert.ok(game.dialogs >= 1, 'la fenêtre de défausse du jeu a été ouverte et vérifiée');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /essai réussi : 8 exemplaires vérifiés/);
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.deepEqual(game.discarded.sort(), Array.from({ length: 8 }, (_, i) => `Test ${i}`).sort(), 'seulement les cartes #TEST');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /8 exemplaires défaussés \(\+8 wikibidous\)/);
  env.close();
});

test('défausse : « Sans étiquette » sur plusieurs pages, favorites laissées cochées, cartes étiquetées jamais touchées', async () => {
  const { env, WMX, game } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], keepUnpriced: true };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 35);
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.equal(game.view, 'none', 'vue « Sans étiquette »');
  assert.equal(game.discarded.length, 35);
  assert.ok(!game.discarded.some((t) => /favorite|animaux|Test/.test(t)), 'ni favorite, ni étiquetée');
  env.close();
});

test('défausse : une carte cochée = un exemplaire ; « Garder 1 exemplaire » recoche la carte jusqu’au nombre prévu', async () => {
  const cards = [{ title: 'Triple', rarity: 'C', count: 3 }, { title: 'Double', rarity: 'C', count: 2 }, { title: 'Simple', rarity: 'C' }];
  const { env, WMX, game } = setup(cards);
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], keepOne: true, keepUnpriced: true };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 3, 'garder 1 exemplaire : 2 des 3 triples et 1 des 2 doubles');
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.deepEqual(game.discarded.sort(), ['Double', 'Triple', 'Triple']);
  assert.deepEqual(game.list.map((c) => [c.title, c.count]).sort(), [['Double', 1], ['Simple', 1], ['Triple', 1]], 'un exemplaire de chaque reste');
  env.close();
});

test('défausse : un nombre du jeu qui ne correspond pas arrête tout', async () => {
  const cards = [{ title: 'Une', rarity: 'C' }, { title: 'Deux', rarity: 'C' }];
  const { env, w, WMX, game } = setup(cards);
  await WMX.features.find((f) => f.name === 'discard').init();
  game.lie = true; // la fenêtre du jeu annonce une carte de trop
  const p = { rarities: ['C'], keepUnpriced: true };
  await WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 0, 'rien n’est défaussé');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /3 × C au lieu de 2 × C/);
  env.close();
});

test('défausse : « le chargement de la collection a échoué » après une défausse → la liste est relue et la défausse continue', async () => {
  const cards = Array.from({ length: 70 }, (_, i) => ({ title: `T${i}`, rarity: 'C', tags: TEST }));
  const { env, WMX, game } = setup(cards, { failAfterDiscard: true });
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], tags: ['TEST'], keepUnpriced: true };
  await WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  assert.ok(game.failedOnce, 'le jeu a bien échoué une fois');
  assert.equal(game.discarded.length, 70, 'toutes les cartes TEST défaussées malgré l’échec de chargement');
  env.close();
});

test('défausse en arrière-plan : la page invisible est pilotée, la progression « N / total » s’affiche, la page est retirée à la fin', async () => {
  const { env, w, WMX, game } = setup(cardsA());
  await WMX.features.find((f) => f.name === 'discard').init();
  let removed = false;
  WMX.discard.frameFactory = async () => ({ d: w.document, w, frame: null, remove: () => { removed = true; } }); // la fausse page joue la page invisible
  w.history.pushState({}, '', '/marketplace'); // l'utilisateur est ailleurs
  const p = { rarities: ['C'], keepUnpriced: true };
  const pl = WMX.discard.plan(p);
  const run = WMX.discard.start(pl, { dry: false, prefs: p });
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
  const p = { rarities: ['C'], keepUnpriced: true };
  await WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 0);
  assert.equal(WMX.discard.isRunning(), false);
  env.close();
});

test('défausse : 30 cartes gardées (favorites) sur une page font passer à la suivante, les cartes remontées sont rattrapées', async () => {
  const cards = [
    ...Array.from({ length: 35 }, (_, i) => ({ title: `Favorite ${i}`, rarity: 'C', starred: true })),
    ...Array.from({ length: 60 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' })),
  ];
  const { env, WMX, game } = setup(cards);
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], keepUnpriced: true };
  await WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 60, 'toutes les communes sont défaussées');
  assert.ok(!game.discarded.some((t) => /Favorite/.test(t)), 'aucune favorite');
  env.close();
});

test('défausse : la liste du jeu relue en retard après une défausse (cartes qui remontent d’une page) ne bloque plus : on attend qu’elle se pose', async () => {
  // Page 1 : 43 cartes gardées (avec image) + 7 à défausser ; page 2 : 7 à défausser puis 43 gardées, puis 13 à défausser.
  const kept = (n, from) => Array.from({ length: n }, (_, i) => ({ title: `Gardée ${from + i}`, rarity: 'C', image: 'x.jpg' }));
  const gone = (n, from) => Array.from({ length: n }, (_, i) => ({ title: `Sans image ${from + i}`, rarity: 'C', image: '' }));
  const cards = [...kept(43, 0), ...gone(7, 0), ...gone(7, 7), ...kept(43, 43), ...gone(13, 14)];
  const { env, w, WMX, game } = setup(cards, { lateReload: 1500 });
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], onlyNoImage: true, keepUnpriced: true };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 27);
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 27, `les 27 cartes sans image sont défaussées : ${game.discarded.length}`);
  assert.ok(!game.discarded.some((t) => /Gardée/.test(t)), 'aucune carte avec image');
  assert.doesNotMatch(w.document.querySelector('.wmx-dc-run')?.textContent || '', /impossible de cocher|arrêtée/);
  env.close();
});

test('défausse : blocage « automatisation » du jeu → pause (message), nouvel essai, encore une pause si besoin, puis la défausse aboutit', async () => {
  const cards = Array.from({ length: 12 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' }));
  const { env, w, WMX, game } = setup(cards, { blockTimes: 2 });
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.discard.blockWait = 1; // 1 s au lieu de 30 dans le test
  const texts = [];
  const spy = setInterval(() => { const t = w.document.querySelector('.wmx-dc-run')?.textContent || ''; if (t && texts[texts.length - 1] !== t) texts.push(t); }, 100);
  const p = { rarities: ['C'], keepUnpriced: true };
  await WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  clearInterval(spy);
  assert.equal(game.blocks, 2, 'le jeu a refusé deux fois');
  assert.equal(game.discarded.length, 12, 'puis la défausse a abouti, sans rien perdre');
  assert.ok(texts.some((t) => /le jeu bloque la défausse.*nouvel essai dans/.test(t)), 'message de pause avec compte à rebours');
  assert.ok(texts.some((t) => /2e essai/.test(t)), 'deuxième pause quand le jeu refuse encore');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /12 exemplaires défaussés/);
  const journal = (await WMX.journal.list()).map((e) => e.text).join(' | ');
  assert.match(journal, /le jeu bloque la défausse/);
  assert.match(journal, /blocage levé après 2 pause/);
  env.close();
});

test('défausse « prix inconnu : en dernier » sur plusieurs pages : le 2e passage repart de la page 1 (plus de cartes « non trouvées »)', async () => {
  // 30 cartes à prix connu bas et 60 au prix inconnu (pas chères une fois chargées) mélangées, puis 30 gardées (avec image) en fin de liste ; pages de 20.
  const cards = [];
  for (let i = 0; i < 30; i++) cards.push({ title: `Connue ${i}`, rarity: 'C', image: '' }, { title: `Inconnue ${i}`, rarity: 'C', image: '' }, { title: `Inconnue bis ${i}`, rarity: 'C', image: '' });
  for (let i = 0; i < 30; i++) cards.push({ title: `Gardée ${i}`, rarity: 'C' }); // comme chez vous : les dernières pages ne contiennent que des cartes gardées
  cards.push({ title: 'Connue fin', rarity: 'C', image: '' }); // une carte au prix connu tout à la fin : le 1er passage finit sur la dernière page
  const { env, w, WMX, game, items } = setup(cards, { perPage: 20 });
  await WMX.features.find((f) => f.name === 'discard').init();
  const known = new Map(items.filter((it) => /^Connue|^Gardée/.test(it.title)).map((it) => [it.card_id, 3]));
  WMX.prices.has = (id) => known.has(id);
  WMX.prices.get = (id) => (known.has(id) ? { avg: known.get(id) } : null);
  let running = false;
  WMX.prices.state = () => ({ running });
  WMX.prices.start = (todo) => { running = true; setTimeout(() => { for (const c of todo) known.set(c.card_id, 4); running = false; }, 800); return todo.length; };
  const p = { rarities: ['C'], useMax: true, maxAvg: 20, unpriced: 'last', onlyNoImage: true };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 31);
  assert.equal(pl.unpricedCards.length, 60);
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 91, `les 31 + 60 cartes sans image sont défaussées : ${game.discarded.length}`);
  assert.ok(!game.discarded.some((t) => /Gardée/.test(t)));
  assert.doesNotMatch(w.document.querySelector('.wmx-dc-run')?.textContent || '', /non trouvée/);
  env.close();
});

test('défausse « tout défausser » (aucune option) : toutes les cartes de l’étiquette, page par page avec « Tout sélectionner », sauf les favorites', async () => {
  const cards = [];
  for (let i = 0; i < 70; i++) cards.push({ title: `Test ${i}`, rarity: i % 3 ? 'C' : 'R', tags: TEST, count: i === 5 ? 2 : 1 });
  for (let i = 0; i < 4; i++) cards.push({ title: `Fav ${i}`, rarity: 'C', tags: TEST, starred: true });
  cards.push({ title: 'Autre étiquette', rarity: 'C', tags: [{ name: 'animaux' }] }, { title: 'Sans étiquette', rarity: 'C' });
  const { env, w, WMX, game } = setup(cards, { perPage: 20 });
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.prices.has = () => false; // prix inconnus : sans seuil, peu importe
  const p = { rarities: [], tags: ['TEST'], useMax: false, keepOne: false, onlyNoImage: false, keepRecent: false, protectSale: false };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 71, '70 cartes dont une en double, sans les 4 favorites');
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 71, `toutes les cartes TEST (et le 2e exemplaire) : ${game.discarded.length}`);
  assert.ok(!game.discarded.some((t) => /Fav|Autre|Sans étiquette/.test(t)), 'ni favorite, ni autre étiquette, ni carte sans étiquette');
  assert.match(w.document.querySelector('.wmx-dc-run').textContent, /71 exemplaires défaussés/);
  const journal = (await WMX.journal.list()).map((e) => e.text).join(' | ');
  assert.match(journal, /mode « tout défausser »/);
  env.close();
});

test('défausse : « Fermer » retire vraiment le panneau de progression (il ne revient plus)', async () => {
  const { env, w, WMX } = setup([{ title: 'Commune 1', rarity: 'C' }]);
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], keepUnpriced: true };
  await WMX.discard.start(WMX.discard.plan(p), { dry: true, visible: true, prefs: p });
  const panel = w.document.querySelector('.wmx-dc-run');
  assert.ok(panel);
  [...panel.querySelectorAll('button')].find((b) => /Fermer/.test(b.textContent)).click();
  await sleep(1500);
  assert.equal(w.document.querySelector('.wmx-dc-run'), null, 'le panneau ne revient pas');
  env.close();
});

test('défausse « tout défausser » : une favorite que la copie de la collection ignore est reconnue sur la carte (pas d’arrêt « Défausser introuvable »), et à la fin on quitte la sélection', async () => {
  const cards = [];
  for (let i = 0; i < 3; i++) cards.push({ title: `Fav cachée ${i}`, rarity: 'C', tags: TEST, starred: true, domOnlyFav: true });
  for (let i = 0; i < 22; i++) cards.push({ title: `Test ${i}`, rarity: 'C', tags: TEST });
  const { env, w, WMX, game } = setup(cards, { perPage: 20 });
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.prices.has = () => false;
  const p = { rarities: [], tags: ['TEST'], useMax: false, keepOne: false, onlyNoImage: false, keepRecent: false, protectSale: false };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 25, 'la copie de la collection croit pouvoir défausser les 3 favorites');
  await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  assert.equal(game.discarded.length, 22, `les 22 cartes, jamais les favorites : ${game.discarded.length}`);
  assert.doesNotMatch(w.document.querySelector('.wmx-dc-run')?.textContent || '', /introuvable|arrêtée/);
  assert.ok([...w.document.querySelectorAll('button')].some((b) => b.textContent === 'Sélectionner'), 'fin : le mode sélection du jeu est quitté');
  await sleep(5600);
  assert.equal(w.document.querySelector('.wmx-dc-run'), null, 'réussite : le panneau se ferme seul');
  env.close();
});

test('défausse : le panneau masqué pendant la défausse laisse une bulle « N / M » ; un clic sur la bulle le réaffiche', async () => {
  const cards = Array.from({ length: 30 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' }));
  const { env, w, WMX } = setup(cards, { perPage: 10 });
  await WMX.features.find((f) => f.name === 'discard').init();
  const p = { rarities: ['C'], keepUnpriced: true };
  const run = WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  await sleep(1500);
  w.document.querySelector('.wmx-dc-hide').click();
  await sleep(300);
  assert.ok(w.document.querySelector('.wmx-dc-run').hidden, 'panneau masqué');
  const bubble = w.document.querySelector('.wmx-dc-bubble');
  assert.ok(bubble, 'bulle affichée');
  assert.match(bubble.textContent, /\/30/, 'avancement N / 30');
  bubble.click();
  assert.ok(!w.document.querySelector('.wmx-dc-run').hidden, 'un clic sur la bulle réaffiche le panneau');
  assert.equal(w.document.querySelector('.wmx-dc-bubble'), null);
  await run;
  env.close();
});

test('défausse : une étiquette choisie la dernière fois qui n’existe plus (vidée) est oubliée : les cartes sans étiquette sont bien proposées', async () => {
  const cards = cardsA().filter((c) => !(c.tags || []).some((t) => t.name === 'TEST')); // l'étiquette TEST a été vidée par une défausse
  const { env, w, WMX } = setup(cards);
  env.mem.discardPrefs = { rarities: ['C'], tags: ['TEST'] };
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.discard.openPicker();
  const dlg = w.document.querySelector('.wmx-dc .wmx-dlg');
  assert.match(dlg.querySelector('button.wmx-dc-tag').textContent, /Cartes sans étiquette/);
  assert.match(dlg.querySelector('.wmx-dc-sum').textContent, /35 exemplaires à défausser/, 'les C sans étiquette, pas « Aucune carte ne correspond »');
  assert.deepEqual([...(env.mem.discardPrefs.tags || [])], [], 'l’étiquette disparue est retirée des réglages');
  env.close();
});

test('défausse en mode visible : quitter la page Collection en cours de route fait continuer la défausse en arrière-plan', async () => {
  const cards = Array.from({ length: 40 }, (_, i) => ({ title: `Commune ${i}`, rarity: 'C' }));
  const { env, w, WMX, game } = setup(cards, { perPage: 10, lateReload: 300 });
  await WMX.features.find((f) => f.name === 'discard').init();
  w.history.pushState({}, '', '/collection');
  let opened = 0;
  WMX.discard.frameFactory = async () => { opened += 1; return { d: w.document, w, frame: null, remove: () => {} }; }; // la fausse page joue la page invisible
  const p = { rarities: ['C'], keepUnpriced: true };
  const run = WMX.discard.start(WMX.discard.plan(p), { dry: false, visible: true, prefs: p });
  await sleep(2500);
  w.history.pushState({}, '', '/pulls'); // l'utilisateur va sur la page Paquets
  await run;
  assert.equal(opened, 1, 'une page invisible a pris le relais');
  assert.equal(game.discarded.length, 40, `toutes les cartes sont défaussées : ${game.discarded.length}`);
  const journal = (await WMX.journal.list()).map((e) => e.text).join(' | ');
  assert.match(journal, /page Collection quittée : la défausse continue en arrière-plan/);
  WMX.discard.frameFactory = null;
  env.close();
});

test('défausse « tout défausser » : filtres du jeu remis à zéro en cours de route → réappliqués, et jamais une carte hors de la liste', async () => {
  const cards = [];
  for (let i = 0; i < 30; i++) cards.push({ title: `Autre ${i}`, rarity: 'C' }); // sans étiquette : hors de la liste, en tête de la vue « toutes »
  for (let i = 0; i < 30; i++) cards.push({ title: `Test ${i}`, rarity: 'C', tags: TEST });
  const { env, w, WMX, game } = setup(cards, { perPage: 10, lateReload: 400 });
  await WMX.features.find((f) => f.name === 'discard').init();
  WMX.prices.has = () => false;
  const p = { rarities: [], tags: ['TEST'], useMax: false, keepOne: false, onlyNoImage: false, keepRecent: false, protectSale: false };
  const pl = WMX.discard.plan(p);
  assert.equal(pl.copies, 30);
  const run = WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
  for (let i = 0; i < 200 && game.discarded.length < 10; i++) await sleep(100); // après la 1re défausse (page 1)
  game.view = 'all'; game.rar.clear(); game.page = 0; game.sel.clear(); // le jeu remet ses filtres à zéro (retour sur la Collection)
  game.rerender();
  await run;
  assert.equal(game.discarded.length, 30, `les 30 cartes TEST : ${game.discarded.length}`);
  assert.ok(!game.discarded.some((t) => /Autre/.test(t)), 'aucune carte hors de l’étiquette');
  env.close();
});

for (const mode of ['wait', 'last']) {
  test(`défausse : cartes au prix inconnu « ${mode === 'wait' ? 'attendre leur prix' : 'traiter en dernier'} » (seuil 20 W : la pas chère défaussée, la chère et l’introuvable gardées)`, async () => {
    const cards = [{ title: 'Connue', rarity: 'C' }, { title: 'Pas chère', rarity: 'C' }, { title: 'Chère', rarity: 'C' }, { title: 'Introuvable', rarity: 'C' }];
    const { env, WMX, game, items } = setup(cards);
    await WMX.features.find((f) => f.name === 'discard').init();
    const known = new Map([['id0', 3]]); // seule « Connue » a un prix au départ
    const later = { id1: 5, id2: 50 }; // « Introuvable » (id3) : le jeu ne donne jamais son prix
    WMX.prices.has = (id) => known.has(id);
    WMX.prices.get = (id) => (known.has(id) ? { avg: known.get(id) } : null);
    let running = false;
    WMX.prices.state = () => ({ running });
    WMX.prices.start = (todo) => { running = true; setTimeout(() => { for (const c of todo) if (later[c.card_id] != null) known.set(c.card_id, later[c.card_id]); running = false; }, 1200); return todo.length; };
    const p = { rarities: ['C'], useMax: true, maxAvg: 20, unpriced: mode };
    const pl = WMX.discard.plan(p);
    assert.deepEqual(Array.from(pl.cards, (c) => c.title), ['Connue'], 'au départ, seule la carte au prix connu est prévue');
    assert.equal(pl.unpricedCards.length, 3);
    await WMX.discard.start(pl, { dry: false, visible: true, prefs: p });
    assert.deepEqual(game.discarded.sort(), ['Connue', 'Pas chère'], 'la carte devenue « pas chère » est défaussée ; la chère et l’introuvable restent');
    assert.ok(items.length === 4);
    env.close();
  });
}
