// Révélation des paquets, fenêtre de bienvenue / nouveautés, barre de la Collection.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => ({ ok: true, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const RAR = { commun: 'C', peu_commun: 'PC', rare: 'R', super_rare: 'SR', legendaire: 'L' };
const cards = Object.keys(RAR).map((r, i) => ({ id: `k${i}`, wikipedia_title: `Carte ${i}`, rarity: r }));

test('révélation fluide : une seule ouverture ; les cartes se retournent en vague, une courte lueur seulement pour les super rares et plus ; « Rapide » environ trois fois plus vite ; « Passer » révèle tout', async () => {
  const run = async (speed, skipAfter = null) => {
    const env = createEnv({ fetchImpl: async () => json({ summary: {} }) });
    const { w, WMX } = env;
    WMX.settings = { speed, images: false };
    const s = WMX.revealSession();
    s.addPack(cards);
    assert.ok([...w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile')].every((t) => !t.dataset.r), 'pendant l’ouverture : cartes alignées face cachée, neutres');
    const glints = new Set();
    const watch = setInterval(() => w.document.querySelectorAll('.wmx-tile.glint').forEach((t) => glints.add(t.dataset.r)), 15);
    const t0 = Date.now();
    const done = s.finish();
    if (skipAfter != null) { await sleep(skipAfter); [...w.document.querySelectorAll('.wmx-overlay button')].find((b) => b.textContent === 'Passer').click(); }
    await done;
    clearInterval(watch);
    const ms = Date.now() - t0;
    assert.equal(w.document.querySelectorAll('.wmx-overlay .wmx-grid .wmx-tile.flip').length, 5, 'toutes retournées');
    assert.ok(!w.document.querySelector('.wmx-tile.glint'), 'plus aucune lueur à la fin');
    env.close();
    return { ms, glints: [...glints].sort() };
  };
  const normal = await run('normal');
  assert.deepEqual(normal.glints, ['L', 'SR'], 'lueur seulement pour la super rare et la légendaire');
  assert.ok(normal.ms < 3500, `5 cartes en moins de 3,5 s (${normal.ms} ms)`);
  const fast = await run('fast');
  assert.ok(fast.ms < normal.ms * 0.6, `« Rapide » bien plus vite (${fast.ms} ms contre ${normal.ms} ms)`);
  const skipped = await run('normal', 120);
  assert.ok(skipped.ms < 600, 'Passer : tout de suite');
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
  env.mem.priceCache = { c1: { w: 2, t: Date.now(), s: { L: { average: 1234, count: 2, latest: 1200 } } } };
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

test('mise à jour vers la 1.0.93 : « À la une » (paquets depuis n’importe quelle page, vue étendue de la Collection) une seule fois, aussi pour qui vient d’une version sans cette fenêtre', async () => {
  const open = async (seen) => {
    const env = createEnv({ fetchImpl: async () => json({}) });
    env.w.chrome.runtime.getManifest = () => ({ version: '1.0.93', version_name: '1.0.93' });
    if (seen) env.mem.seenVersion = seen;
    env.mem.wmxSettings = { speed: 'normal' }; // déjà utilisateur
    env.w.document.body.insertAdjacentHTML('beforeend', '<nav><a href="/collection">Collection</a></nav>');
    env.WMX.features.find((f) => f.name === 'whats-new').init();
    for (let i = 0; i < 40 && !env.w.document.querySelector('.wmx-wn'); i++) await sleep(100);
    return env;
  };
  for (const seen of [null, '1.0.79']) {
    const env = await open(seen);
    const box = env.w.document.querySelector('.wmx-wn');
    assert.ok(box, `fenêtre affichée (version vue : ${seen || 'aucune'})`);
    const top = box.querySelector('.wmx-wn-top');
    assert.ok(top, 'bloc « À la une »');
    assert.match(top.textContent, /Ouvrez vos paquets depuis n’importe quelle page/);
    assert.match(top.textContent, /vue étendue/);
    assert.equal(env.mem.seenVersion, '1.0.93');
    env.close();
  }
  const again = await open('1.0.93');
  await sleep(2600);
  assert.ok(!again.w.document.querySelector('.wmx-wn'), 'pas une deuxième fois');
  again.close();
});

test('« Voir les nouveautés » (Paramètres) : toujours les dernières nouveautés, même si la version installée est illisible (extension rechargée sans actualiser l’onglet)', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  env.w.chrome.runtime.getManifest = () => { throw new Error('Extension context invalidated.'); };
  env.WMX.whatsNew.showChanges();
  const box = env.w.document.querySelector('.wmx-wn');
  assert.ok(box, 'fenêtre affichée');
  assert.ok(box.querySelectorAll('.wmx-wn-ver').length >= 1, 'au moins une version listée');
  env.close();
});

test('moyennes : zones masquées et forme « étiquette » (Paramètres → Moyennes) ; étiquette = valeur + tendance de la semaine', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  env.mem.priceCache = { c1: { w: 2, t: Date.now(), s: { L: { average: 5170, count: 90, latest: 5170, change: -0.152 } } }, c2: { w: 2, t: Date.now(), s: { L: { average: 800, count: 2, latest: 800, change: 0.04 } } } };
  await WMX.prices.load();
  WMX.features.find((f) => f.name === 'card-style').init();
  const html = w.document.documentElement.classList;
  assert.ok(!html.contains('wmx-avg-strip') && !html.contains('wmx-noavg-coll'), 'par défaut : pastille, partout');
  await WMX.updateSettings({ avgStyle: 'strip', avgCollection: false, avgMarket: false });
  await sleep(50);
  assert.ok(html.contains('wmx-avg-strip'), 'forme ruban');
  assert.ok(html.contains('wmx-noavg-coll') && html.contains('wmx-noavg-market') && !html.contains('wmx-noavg-trades'), 'seulement les zones décochées');
  assert.equal(WMX.avgOn('avgCollection'), false, 'zone masquée : plus de demande au jeu pour l’afficher');
  const chip = w.document.createElement('span');
  WMX.prices.fillChip(chip, 'c1', 'L');
  assert.match(chip.querySelector('.wmx-pv').textContent, /^5\s170 W$/);
  assert.equal(chip.querySelector('.wmx-ptr').textContent, '↘ −15 %');
  assert.equal(chip.dataset.trend, 'down');
  assert.match(chip.title, /Moyenne de la semaine : 5\s170 W[\s\S]*−15 % par rapport à la semaine de ventes précédente/);
  WMX.prices.fillChip(chip, 'c2', 'L');
  assert.equal(chip.querySelector('.wmx-ptr').textContent, '↗ +4,0 %');
  assert.match(chip.textContent, /^Moy\. 800 W/, 'pastille : « Moy. » + valeur (la tendance est cachée par le CSS)');
  // Aperçu : une nouvelle forme sur chacune des trois premières cartes, la pastille ailleurs ; toujours posée sur la carte elle-même.
  await WMX.updateSettings({ avgStyle: 'preview' });
  await sleep(50);
  const cards = [0, 1, 2, 3].map((i) => { const c = w.document.createElement('div'); c.dataset.wmxIdx = String(i); const ch = w.document.createElement('span'); WMX.prices.placeChip(c, ch); return c; });
  assert.deepEqual(cards.map((c) => c.dataset.avgp || null), ['compact', 'tab', 'strip', null]);
  assert.ok(cards.every((c) => c.lastElementChild.parentElement === c), 'pastille sur la carte (place fixe)');
  env.close();
});
