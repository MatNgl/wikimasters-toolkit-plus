// Ouverture des paquets en parallèle (par défaut) : page Paquets invisible (boosters.js + relais de frame-hook.js), progression sur le cadran,
// cartes révélées à la fin dans l'écran habituel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const packCards = (n) => Array.from({ length: 5 }, (_, i) => ({ id: `p${n}-${i}`, wikipedia_title: `Carte ${n}-${i}`, rarity: 'commun' }));

/**
 * Faux jeu : page Paquets « invisible » (un vrai document à part que l'extension pilote ; ses réponses arrivent par postMessage, comme avec
 * frame-hook.js). opts.zeroFirst : le compteur s'affiche d'abord à 0 (le jeu lit encore le stock), puis à sa vraie valeur.
 */
async function setup(stockStart, opts = {}) {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  w.history.pushState({}, '', '/marketplace');
  const fx = new JSDOM(`<body><h1>Ouvrir un paquet</h1><button>Ouvrir</button><div id="cnt">${opts.zeroFirst ? 0 : stockStart} / 20 paquets disponibles</div></body>`, { url: 'https://www.wiki-masters.com/pulls#wmx-pulls' });
  Object.defineProperty(fx.window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  const st = { stock: stockStart, calls: 0, frames: [] };
  const paint = () => { fx.window.document.getElementById('cnt').textContent = `${st.stock} / 20 paquets disponibles`; };
  if (opts.zeroFirst) setTimeout(paint, 1200);
  const post = (msg) => w.dispatchEvent(new w.MessageEvent('message', { data: JSON.stringify({ wmx: 'pulls', ...msg }), origin: 'https://www.wiki-masters.com', source: fx.window }));
  fx.window.document.querySelector('button').addEventListener('click', () => {
    st.calls += 1;
    const n = st.calls;
    post({ t: 'start', url: '/api/packs/open' });
    setTimeout(() => { st.stock -= 1; paint(); post({ t: 'api', url: '/api/packs/open', method: 'POST', status: 200, data: { cards: packCards(n) } }); }, opts.slow || 30);
  });
  const orig = w.document.createElement.bind(w.document);
  w.document.createElement = (tag, ...rest) => {
    const n = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'iframe') {
      st.frames.push(n);
      Object.defineProperty(n, 'contentDocument', { get: () => fx.window.document });
      Object.defineProperty(n, 'contentWindow', { get: () => fx.window });
    }
    return n;
  };
  if (opts.before) opts.before(env);
  WMX.features.find((x) => x.name === 'stats').init();
  await WMX.features.find((x) => x.name === 'boosters').init();
  Object.assign(WMX.settings, { speed: 'instant', images: false });
  const button = (re) => [...w.document.querySelectorAll('button')].find((b) => re.test(b.textContent));
  return { env, w, WMX, st, button };
}

test('ouverture en parallèle (par défaut) : depuis une autre page, sans la quitter ; progression sur le cadran (« 1/2 ouverts », pastille des cartes) ; « Tout ouvrir » devient « Arrêter l’ouverture » ; cartes alignées et révélées à la fin', async () => {
  const { env, w, WMX, st, button } = await setup(2, { slow: 400 });
  assert.notEqual(WMX.settings.openParallel, false, 'activée par défaut');
  const navigated = [];
  w.addEventListener('wmx:navigate', (e) => navigated.push(e.detail));
  button(/^Tout ouvrir$/).click();
  let sawDial = false;
  let sawStop = false;
  for (let i = 0; i < 120 && !w.document.querySelector('.wmx-overlay .wmx-tile.flip'); i++) {
    const txt = w.document.querySelector('.wmx-fab-txt')?.textContent || '';
    if (/\d\/2\s*ouverts/.test(txt)) sawDial = true;
    if (button(/Arrêter l’ouverture/)) sawStop = true;
    await sleep(50);
  }
  assert.ok(sawDial, 'le cadran suit les paquets ouverts');
  assert.ok(sawStop, '« Arrêter l’ouverture » pendant l’ouverture');
  assert.equal(st.stock, 0, 'les 2 paquets ouverts dans la page invisible');
  assert.deepEqual(navigated, [], 'la page en cours n’est pas quittée');
  assert.equal(w.location.pathname, '/marketplace');
  assert.ok(st.frames.filter((f) => /wmx-pulls/.test(f.getAttribute('src'))).every((f) => !f.isConnected), 'page invisible retirée à la fin');
  assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile').length, 10, 'cartes alignées puis révélées');
  assert.ok(button(/^Tout ouvrir$/), 'bouton revenu');
  assert.equal((await WMX.stats.get()).cards, 10, 'statistiques comptées comme d’habitude');
  env.close();
});

test('ouverture en parallèle : compteur du jeu d’abord à 0 (stock pas encore lu) → plus de « Aucun paquet disponible » avec un paquet en stock', async () => {
  const { env, w, st, button } = await setup(1, { zeroFirst: true });
  button(/^Tout ouvrir$/).click();
  for (let i = 0; i < 120 && !w.document.querySelector('.wmx-overlay .wmx-tile.flip'); i++) await sleep(50);
  assert.equal(st.stock, 0, 'le paquet a été ouvert');
  assert.doesNotMatch(w.document.body.textContent, /Aucun paquet disponible/);
  assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile').length, 5);
  env.close();
});

test('ouverture en parallèle : « Arrêter l’ouverture » garde les paquets restants et révèle les cartes déjà tirées', async () => {
  const { env, w, st, button } = await setup(6, { slow: 250 });
  button(/^Tout ouvrir$/).click();
  for (let i = 0; i < 80 && st.stock > 4; i++) await sleep(50);
  button(/Arrêter l’ouverture/).click();
  for (let i = 0; i < 100 && !w.document.querySelector('.wmx-overlay .wmx-tile.flip'); i++) await sleep(50);
  const opened = 6 - st.stock;
  assert.ok(opened >= 2 && opened <= 3, `arrêt après le paquet en cours (${opened})`);
  assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile').length, opened * 5);
  await sleep(600);
  assert.equal(6 - st.stock, opened, 'plus rien d’ouvert ensuite');
  env.close();
});

test('ouverture auto en parallèle : depuis une autre page, à l’échéance, ouverture dans la page Paquets invisible ; stock relevé pour le cadran, sans revenir sur la page Paquets', async () => {
  const { env, w, WMX, st } = await setup(3, { before: (e) => { e.mem.autoRun = { on: true, t: Date.now(), buffer: [], opened: 0, nextAt: Date.now() - 1000 }; } });
  WMX.settings.reserve = 0;
  for (let i = 0; i < 120 && st.stock > 0; i++) await sleep(50);
  assert.equal(st.stock, 0, 'les 3 paquets ouverts à l’échéance, depuis le Marché');
  assert.equal(w.location.pathname, '/marketplace');
  for (let i = 0; i < 40 && env.mem.packsSeen?.packs !== 0; i++) await sleep(50);
  assert.equal(env.mem.packsSeen.packs, 0, 'stock relevé après l’ouverture : le cadran est à jour');
  assert.ok(st.frames.filter((f) => /wmx-pulls/.test(f.getAttribute('src'))).every((f) => !f.isConnected), 'page invisible refermée');
  assert.match(w.document.querySelector('.wmx-fab-count').textContent, /^3$/, 'pastille : 3 paquets ouverts par l’auto');
  env.close();
});
