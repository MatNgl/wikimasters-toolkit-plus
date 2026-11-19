// Ouverture des paquets : tiroir à cartes (pack-drawer.js) et ouverture en parallèle dans une page Paquets invisible (boosters.js + frame-hook.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const packCards = (n) => Array.from({ length: 5 }, (_, i) => ({ id: `p${n}-${i}`, wikipedia_title: `Carte ${n}-${i}`, rarity: i === 4 && n === 2 ? 'legendaire' : 'commun' }));

/** Faux jeu sur la page principale : bouton « Ouvrir », compteur « N / 20 paquets disponibles », cartes rendues par wmx:api. */
function fakePulls(w, stockStart) {
  const st = { stock: stockStart, calls: 0 };
  const page = w.document.createElement('main');
  page.innerHTML = '<h1>Ouvrir un paquet</h1><button id="open">Ouvrir</button><div id="cnt"></div>';
  w.document.body.append(page);
  const paint = () => { w.document.getElementById('cnt').textContent = `${st.stock} / 20 paquets disponibles`; };
  paint();
  w.document.getElementById('open').addEventListener('click', () => {
    st.calls += 1;
    const n = st.calls;
    w.dispatchEvent(new w.CustomEvent('wmx:start', { detail: { url: '/api/packs/open' } }));
    setTimeout(() => { st.stock -= 1; paint(); w.dispatchEvent(new w.CustomEvent('wmx:api', { detail: { url: '/api/packs/open', method: 'POST', status: 200, data: { cards: packCards(n) } } })); }, 30);
  });
  return st;
}

test('tiroir à cartes : « Tout ouvrir » met les cartes dans le tiroir (pas de plein écran), avec l’animation du style ; « Révéler » les montre toutes ; gardées après rechargement', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  w.history.pushState({}, '', '/pulls');
  const st = fakePulls(w, 3);
  await WMX.features.find((x) => x.name === 'pack-drawer').init();
  await WMX.features.find((x) => x.name === 'boosters').init();
  Object.assign(WMX.settings, { speed: 'fast', images: false, revealStyle: 'wish', packDrawer: true, packParallel: false });
  [...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Tout ouvrir').click();
  let sawComet = false;
  for (let i = 0; i < 200 && (st.stock > 0 || WMX.packDrawer.count() < 15); i++) { if (w.document.querySelector('.wmx-dr-comet')) sawComet = true; await sleep(50); }
  assert.equal(st.stock, 0, '3 paquets ouverts');
  assert.ok(!w.document.querySelector('.wmx-overlay'), 'pas de révélation en plein écran');
  const dr = w.document.querySelector('.wmx-dr');
  assert.ok(dr && !dr.hidden, 'tiroir affiché');
  assert.ok(sawComet, 'style Vœu : étoile filante à chaque paquet');
  for (let i = 0; i < 80 && (!/Révéler \(15\)/.test(dr.textContent) || /Arrêter/.test(dr.textContent)); i++) await sleep(50); // fin de l'ouverture
  assert.match(dr.textContent, /15 cartes/);
  assert.equal(env.mem.packDrawer.cards.length, 15, 'cartes gardées (rechargement de la page)');
  [...dr.querySelectorAll('button')].find((b) => /Révéler/.test(b.textContent)).click();
  for (let i = 0; i < 40 && !w.document.querySelector('.wmx-overlay'); i++) await sleep(50);
  assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile').length, 15, 'toutes les cartes révélées en plein écran');
  assert.equal(WMX.packDrawer.count(), 0, 'tiroir vidé');
  assert.equal(dr.hidden, true);
  env.close();
});

test('tiroir à cartes : animation des cartes qui s’ajoutent selon le style (Classique : face cachée ; Pile lumineuse : pile qui grossit)', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  await WMX.features.find((x) => x.name === 'pack-drawer').init();
  WMX.settings = { speed: 'fast', revealStyle: 'stack' };
  WMX.packDrawer.add(packCards(1));
  let pile = false;
  for (let i = 0; i < 30; i++) { if (w.document.querySelector('.wmx-dr-pile')) pile = true; await sleep(30); }
  assert.ok(pile, 'Pile lumineuse : les cartes rejoignent une pile');
  WMX.settings.revealStyle = 'classic';
  WMX.packDrawer.add(packCards(3));
  await sleep(60);
  const minis = [...w.document.querySelectorAll('.wmx-dr-stage .wmx-dr-card')];
  assert.equal(minis.length, 5);
  assert.ok(minis.every((m) => !m.classList.contains('aura')), 'Classique : rien n’est dévoilé avant la révélation');
  assert.match(w.document.querySelector('.wmx-dr').textContent, /10 cartes/);
  env.close();
});

test('ouverture en parallèle : « Tout ouvrir » depuis une autre page, dans une page Paquets invisible (relais de frame-hook.js) ; sans tiroir, révélation en plein écran à la fin ; la page n’est pas quittée', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  w.history.pushState({}, '', '/marketplace');
  // Page Paquets « invisible » : un vrai document à part, que l'extension pilote ; ses réponses arrivent par postMessage (comme frame-hook.js).
  const fx = new JSDOM('<body><h1>Ouvrir un paquet</h1><button>Ouvrir</button><div id="cnt">2 / 20 paquets disponibles</div></body>', { url: 'https://www.wiki-masters.com/pulls#wmx-pulls' });
  Object.defineProperty(fx.window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  let stock = 2;
  let calls = 0;
  const post = (msg) => w.dispatchEvent(new w.MessageEvent('message', { data: JSON.stringify({ wmx: 'pulls', ...msg }), origin: 'https://www.wiki-masters.com', source: fx.window }));
  fx.window.document.querySelector('button').addEventListener('click', () => {
    calls += 1;
    const n = calls;
    post({ t: 'start', url: '/api/packs/open' });
    setTimeout(() => { stock -= 1; fx.window.document.getElementById('cnt').textContent = `${stock} / 20 paquets disponibles`; post({ t: 'api', url: '/api/packs/open', method: 'POST', status: 200, data: { cards: packCards(n) } }); }, 30);
  });
  const created = [];
  const orig = w.document.createElement.bind(w.document);
  w.document.createElement = (tag, ...rest) => {
    const n = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'iframe') {
      created.push(n);
      Object.defineProperty(n, 'contentDocument', { get: () => fx.window.document });
      Object.defineProperty(n, 'contentWindow', { get: () => fx.window });
    }
    return n;
  };
  const navigated = [];
  w.addEventListener('wmx:navigate', (e) => navigated.push(e.detail));
  WMX.features.find((x) => x.name === 'stats').init();
  await WMX.features.find((x) => x.name === 'pack-drawer').init();
  await WMX.features.find((x) => x.name === 'boosters').init();
  Object.assign(WMX.settings, { speed: 'instant', images: false, revealStyle: 'classic', packDrawer: false, packParallel: true });
  [...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Tout ouvrir').click();
  for (let i = 0; i < 120 && !w.document.querySelector('.wmx-overlay .wmx-tile.flip'); i++) await sleep(50);
  assert.equal(stock, 0, 'les 2 paquets ouverts dans la page invisible');
  assert.deepEqual(navigated, [], 'la page en cours n’est pas quittée');
  assert.equal(w.location.pathname, '/marketplace');
  assert.ok(created.some((f) => /\/pulls#wmx-pulls$/.test(f.getAttribute('src'))), 'page Paquets invisible');
  assert.ok(created.filter((f) => /wmx-pulls/.test(f.getAttribute('src'))).every((f) => !f.isConnected), 'retirée à la fin');
  assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile').length, 10, 'sans tiroir : révélation en plein écran à la fin');
  const stats = await WMX.stats.get();
  assert.equal(stats.cards, 10, 'statistiques comptées comme d’habitude');
  env.close();
});
