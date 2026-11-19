// Styles d'ouverture des paquets (+ aperçu dans les Paramètres), fenêtre de bienvenue / nouveautés, barre de la Collection.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => ({ ok: true, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const RAR = { commun: 'C', peu_commun: 'PC', rare: 'R', super_rare: 'SR', legendaire: 'L' };
const cards = Object.keys(RAR).map((r, i) => ({ id: `k${i}`, wikipedia_title: `Carte ${i}`, rarity: r }));

for (const [style, marker] of [['classic', null], ['stack', '.wmx-rv-stage'], ['wish', '.wmx-rv-wish']]) {
  test(`ouverture des paquets, style « ${style} » : animation propre au style, toutes les cartes retournées à la fin, « Continuer » disponible`, async () => {
    const env = createEnv({ fetchImpl: async () => json({ summary: {} }) });
    const { w, WMX } = env;
    WMX.settings = { speed: 'fast', images: false, revealStyle: style };
    const s = WMX.revealSession();
    s.addPack(cards);
    let seen = !marker;
    const watch = setInterval(() => { if (marker && w.document.querySelector(marker)) seen = true; }, 20);
    await s.finish();
    clearInterval(watch);
    assert.ok(seen, `élément du style vu pendant l’animation (${marker})`);
    const tiles = [...w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile')];
    assert.equal(tiles.length, 5, 'les 5 cartes dans la grille');
    assert.ok(tiles.every((t) => t.classList.contains('flip')), 'toutes retournées');
    assert.ok(!w.document.querySelector('.wmx-rv-stage, .wmx-rv-wish'), 'éléments temporaires retirés');
    assert.ok(!w.document.querySelector('.wmx-overlay .wmx-actions button[disabled]'));
    env.close();
  });
}

test('ouverture des paquets : « Passer » pendant un style lent (Pile lumineuse) révèle tout de suite toutes les cartes', async () => {
  const env = createEnv({ fetchImpl: async () => json({ summary: {} }) });
  const { w, WMX } = env;
  WMX.settings = { speed: 'normal', images: false, revealStyle: 'stack' };
  const s = WMX.revealSession();
  s.addPack(cards);
  const t0 = Date.now();
  const done = s.finish();
  await sleep(300);
  [...w.document.querySelectorAll('.wmx-overlay button')].find((b) => b.textContent === 'Passer').click();
  await done;
  assert.ok(Date.now() - t0 < 2000, 'fini aussitôt');
  assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile.flip').length, 5);
  env.close();
});

test('Paramètres → Paquets : réglage « Style d’ouverture » (4 styles) et aperçu animé à droite, qui suit le style choisi ; caché dans les autres rubriques', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  WMX.openSettings('Révélation');
  const sel = w.document.querySelector('select[data-key="revealStyle"]');
  assert.ok(sel, 'réglage présent');
  assert.deepEqual([...sel.options].map((o) => o.value), ['classic', 'stack', 'wish']);
  const preview = w.document.querySelector('.wmx-set-preview');
  assert.equal(preview.hidden, false, 'aperçu affiché pour les Paquets');
  await sleep(50);
  assert.equal(preview.querySelectorAll('.wmx-rv-demo .wmx-tile').length, 5, 'cinq cartes d’exemple');
  sel.value = 'stack';
  sel.dispatchEvent(new w.Event('change'));
  assert.match(preview.querySelector('h4').textContent, /Pile lumineuse/);
  for (let i = 0; i < 20 && !preview.querySelector('.wmx-rv-stage'); i++) await sleep(50);
  assert.ok(preview.querySelector('.wmx-rv-stage'), 'l’aperçu joue la pile');
  [...preview.querySelectorAll('.wmx-rv-pick button')].find((b) => b.textContent === 'Vœu').click();
  assert.equal(sel.value, 'wish', 'les boutons de l’aperçu changent aussi le réglage');
  [...w.document.querySelectorAll('.wmx-set-navbtn')].find((b) => /Vente/.test(b.textContent)).click();
  assert.equal(w.document.querySelector('.wmx-set-preview').hidden, true, 'pas d’aperçu ailleurs');
  [...w.document.querySelectorAll('.wmx-modal footer .wmx-btn')].find((b) => b.textContent === 'Appliquer').click();
  await sleep(300);
  assert.equal(WMX.settings.revealStyle, 'wish', 'style enregistré');
  env.close();
});

test('bienvenue : première installation → présentation en 5 étapes ; mise à jour → nouveautés depuis la version vue, une seule fois ; jamais hors connexion', async () => {
  const mk = (version) => {
    const env = createEnv({ fetchImpl: async () => json({}) });
    env.w.chrome.runtime.getManifest = () => ({ version, version_name: version });
    return env;
  };
  // Première installation, connecté (menu du jeu présent).
  let env = mk('1.0.87');
  env.w.document.body.insertAdjacentHTML('beforeend', '<nav><a href="/collection">Collection</a></nav>');
  env.WMX.features.find((f) => f.name === 'whats-new').init();
  for (let i = 0; i < 40 && !env.w.document.querySelector('.wmx-wn'); i++) await sleep(100);
  assert.match(env.w.document.querySelector('.wmx-wn').textContent, /Étape 1 sur 5.*Bienvenue/s);
  [...env.w.document.querySelectorAll('.wmx-wn button')].find((b) => /Suivant/.test(b.textContent)).click();
  assert.match(env.w.document.querySelector('.wmx-wn').textContent, /Étape 2 sur 5.*Paquets/s);
  assert.equal(env.mem.seenVersion, '1.0.87');
  env.close();
  // Mise à jour depuis la 1.0.80 : nouveautés 1.0.84 à 1.0.87 seulement.
  env = mk('1.0.87');
  env.mem.seenVersion = '1.0.80';
  env.mem.wmxSettings = { speed: 'fast' };
  env.w.document.body.insertAdjacentHTML('beforeend', '<nav><a href="/collection">Collection</a></nav>');
  env.WMX.features.find((f) => f.name === 'whats-new').init();
  for (let i = 0; i < 40 && !env.w.document.querySelector('.wmx-wn'); i++) await sleep(100);
  const txt = env.w.document.querySelector('.wmx-wn').textContent;
  assert.match(txt, /Nouveautés de la version 1\.0\.87/);
  assert.match(txt, /v1\.0\.87.*v1\.0\.85.*v1\.0\.84/s);
  assert.doesNotMatch(txt, /v1\.0\.80|v1\.0\.79/, 'rien de déjà vu');
  assert.equal(env.mem.seenVersion, '1.0.87');
  env.close();
  // Déjà vue : rien.
  env = mk('1.0.87');
  env.mem.seenVersion = '1.0.87';
  env.w.document.body.insertAdjacentHTML('beforeend', '<nav><a href="/collection">Collection</a></nav>');
  env.WMX.features.find((f) => f.name === 'whats-new').init();
  await sleep(3000);
  assert.ok(!env.w.document.querySelector('.wmx-wn'), 'une seule fois par version');
  env.close();
});

test('barre de la Collection : valeur estimée en grand, jauge (pourcentage, état), boutons Charger / Pause / Arrêter', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  env.mem.invCacheV2 = { t: Date.now(), complete: true, items: [
    { id: 'a', card_id: 'c1', title: 'A', rarity: 'L', count: 1, tags: [] }, { id: 'b', card_id: 'c2', title: 'B', rarity: 'C', count: 1, tags: [] },
  ] };
  env.mem.priceCache = { c1: { t: Date.now(), s: { L: { average: 1234, count: 2, latest: 1200 } } } };
  await WMX.inventory.ensure();
  const bar = WMX.inventory.makePriceBar('wmx-nt-bar');
  w.document.body.append(bar);
  WMX.inventory.renderStatus();
  assert.equal(bar.querySelector('.wmx-pb-value').textContent, '1 234');
  assert.match(bar.querySelector('.wmx-pb-valuesub').textContent, /1 carte évaluée sur 2/);
  assert.equal(bar.querySelector('.wmx-pb-label').textContent, 'Prix récupérés');
  assert.equal(bar.querySelector('.wmx-pb-pct').textContent, '50 %');
  assert.equal(bar.dataset.state, 'idle');
  assert.ok(bar.querySelector('.wmx-cp-pricehead .wmx-btn'), 'actions à droite (« Défausser… » s’y ajoute)');
  assert.equal(bar.querySelector('.wmx-pb-stop').hidden, true, '« Arrêter » seulement pendant un chargement');
  env.close();
});
