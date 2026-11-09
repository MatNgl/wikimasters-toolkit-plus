// Essais de fumée : exécutent vraiment le code de l'extension (jsdom + faux réseau) pour attraper les erreurs d'exécution.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });

const ME = 'me-1';
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();
const auction = (id, over = {}) => ({ id, status: 'active', card_id: `c-${id}`, snapshot_rarity: 'UR', base_amount: 10, current_bid: null, current_bidder_id: null, seller_id: ME, end_at: inMin(60),
  card: { wikipedia_title: `Carte ${id}`, rarity: 'UR', image_url: null }, ...over });

test('prix : validité 48 h / 96 h, cache et file prioritaire', async () => {
  const calls = [];
  const env = createEnv({ files: ['src/lib/namespace.js', 'src/lib/storage.js', 'src/lib/logic.js', 'src/lib/dom.js', 'src/features/stats.js', 'src/features/prices.js'],
    fetchImpl: async (u) => { calls.push(String(u)); return json({ summary: { UR: { average: 100, count: 12, latest: 90 } } }); } });
  const { WMX } = env;
  await WMX.prices.load();
  await WMX.prices.fetchOne('abc');
  assert.equal(calls.length, 1);
  assert.equal(WMX.prices.get('abc', 'UR').avg, 100);
  assert.equal(WMX.prices.fresh('abc'), true);
  env.close();
});

test('prix : un refus 429 provoque une pause puis une reprise, sans perdre de carte', async () => {
  let n = 0;
  const env = createEnv({ files: ['src/lib/namespace.js', 'src/lib/storage.js', 'src/lib/logic.js', 'src/lib/dom.js', 'src/features/stats.js', 'src/features/prices.js'],
    fetchImpl: async () => (++n === 1 ? json({}, 429, { 'retry-after': '0' }) : json({ summary: { R: { average: 5, count: 1, latest: 5 } } })) });
  const { WMX } = env;
  await WMX.prices.load();
  const t0 = Date.now();
  const r = await WMX.prices.fetchOne('x');
  assert.ok(r.summary, 'la requête finit par aboutir');
  assert.ok(Date.now() - t0 >= 5500, 'pause d\'au moins ~6 s après le refus');
  assert.equal(n, 2);
  env.close();
});

test('bulle des enchères : lignes, urgence, mise automatique et alerte', async () => {
  const urgent = auction('a1', { seller_id: 'other', current_bid: 5, current_bidder_id: ME, end_at: new Date(Date.now() + 90_000).toISOString() });
  const outbid = auction('a2', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(30) });
  const sale = auction('s1', { current_bid: 12, current_bidder_id: 'x' });
  const ended = auction('s2', { end_at: new Date(Date.now() - 4_000).toISOString() });
  const payload = { selling: [sale, ended], bidding: [urgent, outbid], won: [{ winner_id: ME }], history: [] };
  const env = createEnv({ fetchImpl: async () => json(payload) });
  const { w, WMX } = env;
  w.WMX.RARITY_RGB = w.WMX.RARITY_RGB || { C: '1 1 1', PC: '1 1 1', R: '1 1 1', SR: '1 1 1', UR: '1 1 1', L: '1 1 1' };
  for (const f of WMX.features) await f.init?.();
  await sleep(3400); // premier chargement (3 s)
  assert.equal(w.document.querySelector('.wmx-bubble').hidden, false);
  const pill = w.document.querySelector('.wmx-dial');
  assert.match(pill.textContent, /2 mises/);
  assert.match(pill.textContent, /1 vente/);
  assert.equal(pill.querySelector('.wmx-auc-warn').hidden, false, 'pastille ⚠ pour l\'enchère sous 2 min');
  assert.ok(pill.classList.contains('alert'));
  assert.notEqual(pill.querySelector('.wmx-dial-ring').style.stroke, '', 'anneau coloré selon le temps restant');
  pill.click();
  await sleep(100);
  const rows = [...w.document.querySelectorAll('.wmx-auc-row')];
  assert.equal(rows.length, 4);
  assert.ok(rows.some((r) => r.classList.contains('urgent')));
  assert.equal(w.document.querySelectorAll('.wmx-auc-cancel').length, 0, 'ni vente avec mise, ni vente terminée n\'a de bouton Annuler');
  assert.ok(w.document.querySelector('.wmx-auc-time.ended'));
  // formulaire de mise automatique
  const row = rows.find((r) => /Carte a2/.test(r.textContent));
  row.querySelector('.wmx-auc-autobtn').click();
  const form = w.document.querySelector('.wmx-auc-auto');
  assert.ok(form, 'formulaire ouvert');
  const pick = (label) => [...w.document.querySelectorAll('.wmx-auc-auto .wmx-seg-btn')].find((b) => b.textContent.trim() === label);
  pick('Sous un délai avant la fin').click();
  const info = w.document.querySelector('.wmx-auc-auto .wmx-info');
  assert.match(info.title, /je surenchéris à chaque fois que quelqu’un d’autre me dépasse/, 'l\'explication est dans une infobulle');
  assert.equal([...w.document.querySelectorAll('.wmx-auc-auto small')].some((s) => /je surenchéris/.test(s.textContent)), false, 'et plus en texte dans le formulaire');
  const amount = w.document.querySelector('.wmx-auc-auto .wmx-auc-num');
  amount.value = '45';
  amount.dispatchEvent(new w.Event('input', { bubbles: true }));
  pick('Selon la moyenne').click();
  pick('+30 %').click();
  assert.match(w.document.querySelector('.wmx-auc-preview').textContent, /[Mm]oyenne|Plafond/);
  w.document.querySelector('.wmx-auc-auto .wmx-btn:not(.wmx-btn--ghost)').click();
  await sleep(50);
  assert.match(w.document.querySelector('.wmx-auc-autotag').textContent, /Auto · sous 45 s · max moy\. \+30 %/);
  assert.deepEqual(Object.values(env.mem.autoBids)[0], { mode: 'time', secs: 45, capMode: 'avg', capPct: 30 });
  env.close();
});

test('révélation : couronnes seulement quand tous les prix sont connus', async () => {
  const env = createEnv({ files: ['src/lib/namespace.js', 'src/lib/storage.js', 'src/lib/logic.js', 'src/lib/dom.js', 'src/features/stats.js', 'src/features/card-detail.js', 'src/features/reveal.js', 'src/features/prices.js'],
    fetchImpl: async (u) => {
      const id = String(u).match(/cards\/([^/]+)\//)[1];
      return json({ summary: { C: { average: Number(id.slice(1)) * 10, count: 1, latest: 1 } } });
    } });
  const { w, WMX } = env;
  WMX.settings = { speed: 'instant', images: false };
  WMX.quick = undefined;
  const cards = Array.from({ length: 10 }, (_, i) => ({ id: `k${i + 1}`, wikipedia_title: `T${i + 1}`, rarity: 'commun' }));
  await WMX.prices.load();
  const s = WMX.revealSession();
  s.addPack(cards.slice(0, 5));
  s.addPack(cards.slice(5));
  await s.finish();
  assert.equal(w.document.querySelectorAll('.wmx-crown').length, 0, 'pas de couronne tant que les prix manquent');
  for (let i = 0; i < 60 && w.document.querySelectorAll('.wmx-crown').length < 2; i++) await sleep(200);
  const crowns = [...w.document.querySelectorAll('.wmx-crown')];
  assert.equal(crowns.length, 1 + 1, '10 cartes : 2 couronnes');
  assert.match(crowns.find((c) => c.dataset.rank === '1').parentElement.textContent, /T10/);
  await sleep(300);
  const st = await WMX.stats.get();
  assert.equal(st.valuedPacks, 2);
  assert.equal(st.value, (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10) * 10);
  env.close();
});

/** Page d'enchère factice (champ « Montant de la mise » + bouton « Miser ») injectée à la place du cadre invisible. */
function fakeBidPages(w, min, stuck = [], balance = null) {
  const { JSDOM } = require('jsdom');
  const clicks = [];
  const orig = w.document.createElement.bind(w.document);
  w.document.createElement = (tag, ...rest) => {
    const n = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'iframe') {
      const d = new JSDOM(`<body>${balance != null ? `<div>Votre solde : ${balance} wikibidous</div>` : ''}<input aria-label="Montant de la mise" type="number" min="${min}"><button>Miser</button></body>`).window.document;
      d.querySelector('button').addEventListener('click', () => clicks.push(d.querySelector('input').value));
      const blank = new JSDOM('<body></body>').window.document; // page qui ne se charge pas : jamais de champ de mise
      Object.defineProperty(n, 'contentDocument', { get: () => (stuck.some((s) => String(n.getAttribute('src') || '').includes(s)) ? blank : d) });
    }
    return n;
  };
  return clicks;
}

async function bubbleEnv(rule, { min = 7, bidding }) {
  const payload = { selling: [], bidding, won: [{ winner_id: ME }], history: [] };
  const env = createEnv({ fetchImpl: async () => json(payload) });
  const { w, WMX } = env;
  const clicks = fakeBidPages(w, min);
  env.mem.autoBids = rule;
  for (const f of WMX.features) await f.init?.();
  return { env, clicks, payload };
}

test('mise automatique « dès surenchère » : mise exactement le minimum, une seule fois dans le délai de 6 s', async () => {
  const a = auction('b1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(60) });
  const { env, clicks } = await bubbleEnv({ b1: { mode: 'outbid' } }, { bidding: [a] });
  await sleep(6500);
  assert.deepEqual(clicks, ['7'], 'une mise de 7 (le minimum affiché par la page) et pas de doublon');
  env.close();
});

test('mise automatique « à X secondes » : rien tant que le moment n\'est pas venu', async () => {
  const a = auction('b2', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(60) });
  const { env, clicks } = await bubbleEnv({ b2: { mode: 'time', secs: 30 } }, { bidding: [a] });
  await sleep(5500);
  assert.deepEqual(clicks, []);
  env.close();
});

test('mise automatique : jamais si on mène déjà, et le plafond arrête la règle', async () => {
  const mine = auction('b3', { seller_id: 'other', current_bid: 8, current_bidder_id: ME, end_at: inMin(60) });
  const r1 = await bubbleEnv({ b3: { mode: 'outbid' } }, { bidding: [mine] });
  await sleep(5500);
  assert.deepEqual(r1.clicks, []);
  r1.env.close();

  const rival = auction('b4', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(60) });
  const r2 = await bubbleEnv({ b4: { mode: 'outbid', cap: 5 } }, { bidding: [rival], min: 7 });
  await sleep(6500);
  assert.deepEqual(r2.clicks, [], 'minimum 7 > plafond 5 : aucune mise');
  assert.equal(r2.env.mem.autoBids.b4?.overNotified, true, 'la règle reste, marquée au-dessus du plafond');
  r2.env.close();
});

/** Environnement « veille » : enchères détaillées par identifiant (GET /api/marketplace/{id}), aucune mise à moi, pages de mise factices (minimum `min`). */
async function watchEnv({ rules = {}, auctions = [], min = 7, route = '', body = '', delay = 0, stuck = [], balance = null }) {
  const byId = Object.fromEntries(auctions.map((a) => [a.id, a]));
  const payload = { auctions, selling: [], bidding: [], won: [{ winner_id: ME }], history: [] };
  const env = createEnv({ fetchImpl: async (u) => {
    if (String(u).includes('/sales')) return json({ summary: { UR: { average: 20, count: 12, latest: 20 } } }); // moyenne du marché : 20 W
    const m = String(u).match(/\/api\/marketplace\/([\w-]+)/);
    if (m && delay) await sleep(delay); // jeu lent : chaque lecture d'une enchère prend `delay` ms
    return m ? (byId[m[1]] ? json({ auction: byId[m[1]] }) : json({}, 404)) : json(payload);
  } });
  const { w, WMX } = env;
  if (route) w.history.pushState({}, '', route);
  if (body) w.document.body.innerHTML = body;
  const clicks = fakeBidPages(w, min, stuck, balance);
  env.mem.autoBids = rules;
  WMX.settings.autoCapMode = 'abs'; WMX.settings.autoCapW = 1000; // plafond large par défaut (chaque test règle le sien au besoin)
  for (const f of WMX.features) await f.init?.();
  return { env, w, WMX, clicks };
}

test('fiche de carte : annuler un chargement lent le coupe aussitôt (le cadre jamais prêt ne bloque rien), sans notification de chargement', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  // Ouverture directe : un signal annulé arrête l'attente du cadre (ici il ne sera jamais prêt : jsdom ne charge pas la Collection).
  const sig = WMX.sheet.signal();
  const p = WMX.sheet.openInFrame({ wikipedia_title: 'A', rarity: 'C' }, 'view', sig);
  await sleep(200);
  sig.cancel();
  const r = await Promise.race([p, sleep(1500).then(() => 'trop lent')]);
  assert.equal(r?.error, 'cancelled', 'annulée en moins de 1,5 s au lieu d\'attendre le cadre');

  // Clic sur une carte, puis sur une autre pendant le chargement : la première est abandonnée, la seconde prend la main.
  const a = { wikipedia_title: 'Carte A', rarity: 'C' };
  const b = { wikipedia_title: 'Carte B', rarity: 'C' };
  WMX.openCardDetail(a);
  await sleep(500);
  assert.match(w.document.querySelector('.wmx-pre')?.textContent || '', /Carte A/, 'aperçu de la carte A');
  assert.equal(w.document.querySelectorAll('.wmx-note').length, 0, 'aucune notification de chargement : l\'aperçu suffit');
  WMX.openCardDetail(b);
  await sleep(900);
  const pre = w.document.querySelector('.wmx-pre')?.textContent || '';
  assert.match(pre, /Carte B/, 'la seconde carte s\'ouvre sans attendre la première');
  assert.ok(!/Carte A/.test(pre), 'la première est abandonnée');
  assert.equal(w.document.querySelectorAll('.wmx-note').length, 0);
  // Fermer l'aperçu (×) puis recliquer sur la même carte : possible tout de suite.
  w.document.querySelector('.wmx-pre .wmx-close').click();
  await sleep(300);
  assert.equal(w.document.querySelector('.wmx-pre'), null, 'aperçu fermé');
  WMX.openCardDetail(b);
  await sleep(900);
  assert.match(w.document.querySelector('.wmx-pre')?.textContent || '', /Carte B/, 'on peut rouvrir la même carte après avoir annulé');
  env.close();
});

test('veille (« Surveiller ») : rien n\'est misé avant le dernier moment, puis une seule mise du minimum', async () => {
  const a = auction('w1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: new Date(Date.now() + 33000).toISOString() });
  const { env, clicks } = await watchEnv({ auctions: [a], rules: { w1: { mode: 'time', secs: 30, capMode: 'abs', cap: 20, watch: true } } });
  await sleep(2500);
  assert.deepEqual(clicks, [], 'avant le délai : aucune mise');
  await sleep(4500);
  assert.deepEqual(clicks, ['7'], 'sous 30 s : une mise du minimum proposé par le jeu');
  env.close();
});

test('tableau de bord : courbe avec axes et valeurs, tableau jour par jour, prix chargés comptés avec les cartes sans vente', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  env.mem.valueHistory = {
    '2026-11-01': { value: 10000, priced: 80, loaded: 90, total: 100 },
    '2026-11-02': { value: 12500, priced: 90, loaded: 100, total: 100 },
    '2026-11-03': { value: 11800, priced: 95, loaded: 100, total: 100 },
  };
  WMX.features.find((f) => f.name === 'dashboard').init();
  await WMX.dashboard.open();
  await sleep(300);
  const svg = w.document.querySelector('.wmx-vchart');
  assert.ok(svg, 'courbe affichée');
  const labels = [...svg.querySelectorAll('text')].map((t) => t.textContent);
  assert.ok(labels.includes('W'), 'unité sur l’axe vertical');
  assert.ok(labels.some((l) => /^\d{2}\/\d{2}$/.test(l)), 'dates sur l’axe horizontal');
  assert.ok(labels.some((l) => /\d/.test(l) && l !== 'W' && !l.includes('/')), 'valeurs graduées sur l’axe vertical');
  assert.equal(svg.querySelectorAll('.dot').length, 3, 'un point par jour (valeur et date au survol)');
  const rows = [...w.document.querySelectorAll('.wmx-vtable tbody tr')];
  assert.equal(rows.length, 3, 'un tableau avec une ligne par jour');
  assert.match(rows[0].textContent, /03\/11\/2026/, 'du plus récent au plus ancien');
  assert.match(rows[0].textContent, /−\s?700\s?W/, 'écart au jour précédent');
  assert.match(w.document.querySelector('.wmx-vstats').textContent, /Variation/);
  const metrics = w.document.querySelector('.wmx-metrics').textContent;
  assert.ok(!/exemplaires/.test(metrics), 'pas de répétition du nombre d’exemplaires sous « Cartes uniques »');
  env.close();
});

test('tableau de bord : « prix chargés » inclut les cartes sans vente', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { WMX } = env;
  const t = WMX.inventory.totals();
  assert.ok('loaded' in t && t.loaded >= t.priced, 'le total compte les prix chargés, avec ou sans vente');
  env.close();
});

test('veille : les lectures des enchères surveillées se font en parallèle, et le bouton « Surveiller » répond aussitôt même si le jeu est lent', async () => {
  const mk = (id) => auction(id, { seller_id: 'other', base_amount: 50, end_at: inMin(90) });
  const auctions = ['p1', 'p2', 'p3', 'p4'].map(mk);
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 1000, watch: true };
  const { env, WMX } = await watchEnv({ auctions, delay: 400, rules: { p1: rule, p2: rule, p3: rule, p4: rule } });
  const t0 = Date.now();
  await WMX.auctions.refresh();
  const took = Date.now() - t0;
  assert.ok(took < 1100, `4 veilles lues en parallèle (environ 0,4 s), pas l'une après l'autre (environ 1,6 s) : ${took} ms`);
  env.close();

  // Bouton « Surveiller » : « Surveillée » apparaît tout de suite, sans attendre la lecture (1,5 s) de l'enchère.
  const slow = await watchEnv({ auctions: [mk('m9')], route: '/marketplace', body: '<a class="card-frame block" href="/marketplace/m9"><div>m9</div></a>', delay: 1500 });
  for (let i = 0; i < 60 && !slow.w.document.querySelector('.wmx-mk-watch'); i++) await sleep(150);
  const btn = slow.w.document.querySelector('.wmx-mk-watch');
  btn.click();
  await sleep(250);
  assert.match(btn.textContent, /Surveillée/, 'état immédiat');
  assert.equal(btn.disabled, false, 'jamais grisé pendant la lecture');
  await sleep(1800); // la lecture lente se termine avant la fin du test (sinon l'exécuteur signale une activité après le test)
  slow.env.close();
});

test('bulle des enchères : interrupteur « Afficher les enchères au-dessus de mon plafond » (mémorisé), la colonne reste pour les réafficher', async () => {
  const cheap = auction('o1', { seller_id: 'other', base_amount: 10, current_bid: 12, current_bidder_id: 'rival', end_at: inMin(30) });
  const dear = auction('o2', { seller_id: 'other', base_amount: 50, current_bid: 60, current_bidder_id: 'rival', end_at: inMin(30) });
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 20, watch: true }; // plafond 20 W : o1 (12 W) reste sous, o2 (60 W) est au-dessus
  const { env, w, WMX } = await watchEnv({ auctions: [cheap, dear], rules: { o1: rule, o2: { ...rule } } });
  await WMX.auctions.refresh();
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  const rows = () => w.document.querySelectorAll('.wmx-auc-row').length;
  const toggle = () => w.document.querySelector('.wmx-auc-toggle');
  assert.equal(rows(), 2, 'par défaut, tout est affiché');
  assert.match(toggle().textContent, /Afficher les enchères au-dessus de mon plafond \(1\)/);
  assert.match(w.document.querySelector('.wmx-auc-row.over')?.textContent || '', /Plafond dépassé/, 'la ligne dit pourquoi');
  assert.equal(toggle().getAttribute('aria-checked'), 'true');
  toggle().click();
  await sleep(50);
  assert.equal(rows(), 1, 'au-dessus du plafond masquée : on ne garde que ce qui reste intéressant');
  assert.equal(toggle().getAttribute('aria-checked'), 'false');
  assert.equal(env.mem.auctionShowOver, false, 'choix mémorisé');
  toggle().click();
  await sleep(50);
  assert.equal(rows(), 2, 'réaffichée');
  // Une enchère simplement dépassée par un rival (sous le plafond) n'est PAS concernée : elle reste affichée.
  const lost = { id: 'l1', status: 'active', card: { wikipedia_title: 'Surenchérie', rarity: 'C' }, end_at: inMin(30), base_amount: 5, current_bid: 9, current_bidder_id: 'rival' };
  WMX.auctions.state().bidding = [lost];
  toggle().click();
  await sleep(50);
  assert.ok(w.document.body.textContent.includes('Surenchérie'), 'surenchérie par un rival mais sans plafond dépassé : toujours visible');
  env.close();
});

test('mises automatiques : une page qui ne se charge pas ne bloque plus les autres (en parallèle, attente bornée par le temps restant)', async () => {
  const soon = new Date(Date.now() + 22000).toISOString();
  const a1 = auction('stuck1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: soon });
  const a2 = auction('fine1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: soon });
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 1000, watch: true };
  const { env, clicks } = await watchEnv({ auctions: [a1, a2], rules: { stuck1: rule, fine1: rule }, stuck: ['stuck1'] });
  await sleep(8000);
  assert.equal(clicks.length, 1, 'l’enchère dont la page est chargée est misée, sans attendre celle dont la page est bloquée');
  env.close();
});

test('enchères au-dessus du plafond : pas de page préchargée (réservée aux enchères encore intéressantes), mais toujours dans la bulle', async () => {
  const mk = (id, bid) => auction(id, { seller_id: 'other', current_bid: bid, current_bidder_id: 'rival', end_at: inMin(1) });
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 20, watch: true }; // plafond 20 W
  const { env, w, WMX } = await watchEnv({ auctions: [mk('dear1', 500), mk('good1', 8), mk('good2', 9)], rules: { dear1: rule, good1: { ...rule }, good2: { ...rule } } });
  await WMX.auctions.refresh();
  await sleep(100);
  const framed = [...w.document.querySelectorAll('iframe.wmx-sheet-frame')].map((f) => f.getAttribute('src') || '').join(' ');
  assert.ok(framed.includes('good1') && framed.includes('good2'), 'pages préchargées pour les enchères encore intéressantes');
  assert.ok(!framed.includes('dear1'), 'aucune page préchargée pour celle qui dépasse le plafond');
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  assert.match(w.document.querySelector('.wmx-bubble-panel').textContent, /Plafond dépassé/, 'mais elle reste suivie dans la bulle');
  env.close();
});

test('fluidité : les modifications faites par l’extension elle-même ne relancent pas les balayages de la page', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  w.document.documentElement.classList.add('wmx-calm'); // <html> porte des classes wmx- : il ne doit rien rendre « interne »
  w.document.body.innerHTML = '<div class="game"><span class="x">jeu</span></div><div class="wmx-mk"><b>moy</b></div><div class="wmx-notes"><div class="wmx-note">n</div></div>';
  const q = (s) => w.document.querySelector(s);
  assert.equal(WMX.dom.foreign([{ target: q('.x') }]), true, 'une modification du jeu est traitée');
  assert.equal(WMX.dom.foreign([{ target: q('.x').firstChild }]), true, 'y compris un texte du jeu');
  assert.equal(WMX.dom.foreign([{ target: q('.wmx-mk b') }]), false, 'dans la pastille de moyenne de l’extension : ignorée');
  assert.equal(WMX.dom.foreign([{ target: q('.wmx-note') }]), false, 'dans une notification : ignorée');
  assert.equal(WMX.dom.foreign([{ target: q('.wmx-mk b') }, { target: q('.x') }]), true, 'un mélange : traité dès qu’une modification vient du jeu');
  env.close();
});

test('marché : les boutons « Miser / Surveiller » ne sont pas réécrits quand rien ne change (défilement fluide)', async () => {
  const a = auction('m1', { seller_id: 'other', base_amount: 50, end_at: inMin(90) });
  const { env, w } = await watchEnv({ auctions: [a], route: '/marketplace', body: '<a class="card-frame block" href="/marketplace/m1"><div>m1</div></a>' });
  for (let i = 0; i < 60 && !w.document.querySelector('.wmx-mk-acts'); i++) await sleep(150);
  await sleep(1200); // les prix et la mise en page finissent d'arriver
  const acts = w.document.querySelector('.wmx-mk-acts');
  assert.ok(acts, 'boutons présents');
  let n = 0;
  const mo = new w.MutationObserver((ms) => { n += ms.length; });
  mo.observe(acts, { childList: true, subtree: true, characterData: true, attributes: true });
  for (let i = 0; i < 6; i++) w.dispatchEvent(new w.CustomEvent('wmx:bids')); // les mises sont relues toutes les quelques secondes : l'événement est fréquent
  await sleep(700);
  mo.disconnect();
  assert.equal(n, 0, 'aucune écriture : un texte identique réécrit relance tous les observateurs de la page');
  env.close();
});

test('activité en direct : requêtes comptées par type, pages cachées et surveillances listées, accessible depuis les réglages', async () => {
  const a = auction('ac1', { seller_id: 'other', base_amount: 10, end_at: inMin(1) }); // 10 W : sous le plafond de 20 W
  const b = auction('ac2', { seller_id: 'other', current_bid: 500, current_bidder_id: 'rival', end_at: inMin(1) });
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 20, watch: true };
  const { env, w, WMX } = await watchEnv({ auctions: [a, b], rules: { ac1: rule, ac2: { ...rule } } });
  await WMX.auctions.refresh();
  await w.fetch('/api/marketplace?page=1&limit=50&mine=1');
  await w.fetch('/api/marketplace/cards/k1/sales?scope=summary');
  const s = WMX.activity.snapshot();
  assert.ok(s.fetches60 >= 4, 'les requêtes de l’extension sont comptées (lectures des enchères surveillées comprises)');
  assert.ok(s.byKind['enchères (listes)'] >= 1 && s.byKind['prix du marché'] >= 1, 'classées par type');
  assert.equal(s.auctions.watching, 2, 'deux enchères surveillées');
  assert.equal(s.auctions.watchOver, 1, 'dont une au-dessus du plafond');
  assert.equal(s.auctions.frames.length, 1, 'une seule page cachée : celle de l’enchère encore intéressante');
  assert.equal(s.auctions.frames[0].title, 'Carte ac1');
  WMX.openSettings();
  const row = [...w.document.querySelectorAll('.wmx-setrow')].find((r) => /Activité en direct/.test(r.textContent));
  assert.ok(row, 'entrée dans les réglages');
  row.querySelector('button').click();
  await sleep(300);
  const win = w.document.querySelector('.wmx-actwin');
  assert.ok(win, 'fenêtre ouverte');
  assert.match(win.textContent, /Pages du jeu cachées : 1/);
  assert.match(win.textContent, /Enchères surveillées/);
  assert.match(win.textContent, /Requêtes envoyées au jeu/);
  assert.match(win.textContent, /Fluidité de la page/);
  win.querySelector('.wmx-close').click();
  assert.equal(w.document.querySelector('.wmx-actwin'), null, 'se ferme proprement');
  env.close();
});

test('bulle des enchères : l’interrupteur « au-dessus de mon plafond » est toujours affiché, même sans enchère concernée ni sans aucune enchère', async () => {
  const fine = { id: 'f1', status: 'active', card: { wikipedia_title: 'Normale', rarity: 'C' }, end_at: inMin(30), base_amount: 5, current_bid: 6, current_bidder_id: ME };
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [fine], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  WMX.features.find((x) => x.name === 'auctions').init();
  await WMX.auctions.refresh();
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  assert.match(w.document.querySelector('.wmx-auc-toggle')?.textContent || '', /Afficher les enchères au-dessus de mon plafond \(0\)/, 'affiché avec 0 enchère concernée');
  WMX.auctions.state().bidding = []; // plus aucune enchère : la bulle se réduit à une note
  WMX.auctions.refresh = WMX.auctions.refresh;
  w.document.querySelector('.wmx-dial').click(); await sleep(50); w.document.querySelector('.wmx-dial').click(); await sleep(150);
  assert.ok(w.document.querySelector('.wmx-auc-toggle'), 'toujours là quand il n’y a aucune enchère');
  env.close();
});

test('mises automatiques : solde insuffisant affiché sur la page → aucun clic, raison claire (au lieu de « non confirmée »)', async () => {
  const soon = new Date(Date.now() + 20000).toISOString();
  const a = auction('bal1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: soon });
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 1000, watch: true };
  const { env, w, clicks } = await watchEnv({ auctions: [a], rules: { bal1: rule }, min: 70, balance: '5' });
  await sleep(6500);
  assert.deepEqual(clicks, [], 'aucune mise envoyée : le jeu la refuserait');
  assert.match(w.document.body.textContent, /Solde insuffisant/);
  assert.match(w.document.body.textContent, /il vous reste 5 W/);
  env.close();
});

test('mises automatiques : une page qui ne se charge pas n’est pas retentée en boucle toutes les 4 s', async () => {
  const soon = new Date(Date.now() + 25000).toISOString();
  const a = auction('slow1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: soon });
  const rule = { mode: 'time', secs: 30, capMode: 'abs', cap: 1000, watch: true };
  const { env, WMX } = await watchEnv({ auctions: [a], rules: { slow1: rule }, stuck: ['slow1'] });
  const errors = [];
  const add = WMX.journal.add.bind(WMX.journal);
  WMX.journal.add = (scope, text, level) => { if (/ne s’est pas chargée/.test(text)) errors.push(Date.now()); return add(scope, text, level); };
  // fin d'enchère toujours repoussée de quelques secondes (comme quand le jeu prolonge une enchère misée dans les dernières secondes)
  const push = setInterval(() => { a.end_at = new Date(Date.now() + 5000).toISOString(); }, 500);
  await sleep(20000);
  clearInterval(push);
  assert.ok(errors.length >= 1 && errors.length <= 2, `au plus deux essais en 20 s (attente d'au moins 8 s, puis recul) : ${errors.length}`);
  env.close();
});

test('mise automatique au-dessus du plafond : une seule ligne au journal, pas de nouvel essai chaque seconde quand la page est libérée', async () => {
  // cap1 : mise actuelle 8 > plafond 5 : sa page est libérée, et la règle ne doit pas croire le minimum inconnu (= sous le plafond).
  // cap2 : mise actuelle 4 (borne basse 5 = plafond) mais la page demande 9 : il faut se souvenir du 9 une fois la page libérée.
  const a = auction('cap1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(60) });
  const b = auction('cap2', { seller_id: 'other', current_bid: 4, current_bidder_id: 'rival', end_at: inMin(61) });
  const rule = { mode: 'outbid', capMode: 'abs', cap: 5 };
  const { env, clicks } = await bubbleEnv({ cap1: { ...rule }, cap2: { ...rule } }, { bidding: [a, b], min: 9 });
  const lines = [];
  const add = env.WMX.journal.add.bind(env.WMX.journal);
  env.WMX.journal.add = (scope, text, level) => { if (/plafond/.test(text)) lines.push(text); return add(scope, text, level); };
  await sleep(12000);
  assert.deepEqual(clicks, [], 'rien n’est misé');
  assert.ok(lines.filter((l) => /cap1/.test(l)).length <= 1, `au plus une ligne « au-dessus du plafond » en 12 s pour cap1 : ${lines}`);
  assert.equal(lines.filter((l) => /cap2/.test(l)).length, 1, `une seule ligne pour cap2 : ${lines}`);
  assert.equal(env.mem.autoBids.cap1?.overNotified, true);
  assert.equal(env.mem.autoBids.cap2?.overNotified, true);
  env.close();
});

test('mise automatique : une enchère terminée (page sans champ de mise) n’est pas signalée comme page non chargée ni retentée', async () => {
  const soon = new Date(Date.now() + 20000).toISOString();
  const a = auction('end1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: soon });
  const payload = { selling: [], bidding: [a], won: [{ winner_id: ME }], history: [] };
  const env = createEnv({ fetchImpl: async (u) => (/\/api\/marketplace\/end1/.test(String(u)) ? json({ auction: { ...a, status: 'ended' } }) : json(payload)) });
  const { w, WMX } = env;
  const clicks = fakeBidPages(w, 9, ['end1']);
  env.mem.autoBids = { end1: { mode: 'time', secs: 30 } };
  const errs = []; const ends = [];
  const add = WMX.journal.add.bind(WMX.journal);
  WMX.journal.add = (scope, text, level) => { if (/ne s’est pas chargée/.test(text)) errs.push(text); if (/terminée/.test(text)) ends.push(text); return add(scope, text, level); };
  for (const f of WMX.features) await f.init?.();
  await sleep(19000);
  assert.deepEqual(clicks, []);
  assert.equal(errs.length, 0, 'pas d’erreur « page non chargée » pour une enchère finie');
  assert.equal(ends.length, 1, 'une ligne « enchère terminée »');
  env.close();
});

test('veille : un prix déjà au-dessus du plafond arrête la veille sans rien miser, et on prévient', async () => {
  const a = auction('w2', { seller_id: 'other', current_bid: 30, current_bidder_id: 'rival', end_at: inMin(60) });
  const { env, w, clicks } = await watchEnv({ auctions: [a], rules: { w2: { mode: 'time', secs: 30, capMode: 'abs', cap: 20, watch: true } } });
  await sleep(5000);
  assert.deepEqual(clicks, []);
  assert.equal(env.mem.autoBids.w2?.overNotified, true, 'la veille reste (marquée au-dessus du plafond), elle n’est plus supprimée');
  assert.match(w.document.body.textContent, /Prix au-dessus de votre plafond/);
  assert.match(w.document.body.textContent, /Modifier le plafond/, 'avec un bouton vers les réglages');
  assert.match(w.document.body.textContent, /prochaine mise doit être d’au moins 31 W \(prix actuel : 30 W\)/, 'on distingue la mise minimum du prix actuel');
  env.close();
});

test('veille : un prix déjà au-dessus du plafond n\'est pas surveillé, et la notification explique pourquoi avec un bouton vers les réglages', async () => {
  const a = auction('w5', { seller_id: 'other', current_bid: 30, current_bidder_id: 'rival', end_at: inMin(60) });
  const { env, w, WMX } = await watchEnv({ auctions: [a] });
  WMX.settings.autoCapMode = 'avg'; WMX.settings.autoCapPct = -10; // plafond : moyenne (20 W) −10 % = 18 W
  const state = await WMX.auctions.toggleWatch('w5', 'Carte w5');
  assert.equal(state, 'none', 'aucune veille créée');
  assert.equal(env.mem.autoBids.w5, undefined);
  const note = w.document.querySelector('.wmx-note.warn');
  assert.ok(note, 'notification affichée');
  assert.match(note.textContent, /Prix au-dessus de votre plafond/);
  assert.match(note.textContent, /30 W/);
  assert.match(note.textContent, /18 W/);
  assert.match(note.textContent, /moyenne du marché −10 %/, 'on dit d\'où vient le plafond');
  assert.match(note.textContent, /ne la surveillera pas/);
  note.querySelector('.wmx-note-act').click();
  await sleep(100);
  assert.ok(w.document.querySelector('.wmx-modal'), 'les réglages s\'ouvrent');
  assert.equal(w.document.querySelector('.wmx-sec-hl h3')?.textContent, 'Mises automatiques', 'à la partie « Mises automatiques », mise en évidence');
  env.close();
});

test('veille : bouton « Surveiller » sur le marché (à côté de « Miser »), puis dans la bulle « Mes enchères » sous un petit titre', async () => {
  const a = auction('m1', { seller_id: 'other', base_amount: 50, end_at: inMin(90) });
  const { env, w, WMX } = await watchEnv({ auctions: [a], route: '/marketplace', body: '<a class="card-frame block" href="/marketplace/m1"><div>m1</div></a>' });
  for (let i = 0; i < 60 && !w.document.querySelector('.wmx-mk-acts'); i++) await sleep(150);
  const acts = w.document.querySelector('.wmx-mk-acts');
  assert.ok(acts && acts.querySelector('.wmx-mk-bid') && acts.querySelector('.wmx-mk-watch'), '« Miser » et « Surveiller » côte à côte');
  assert.match(acts.querySelector('.wmx-mk-watch').textContent, /Surveiller/);
  acts.querySelector('.wmx-mk-watch').click();
  for (let i = 0; i < 40 && WMX.auctions.watchState('m1') !== 'watch'; i++) await sleep(100);
  assert.equal(WMX.auctions.watchState('m1'), 'watch');
  assert.equal(env.mem.autoBids.m1.watch, true, 'la règle de veille est mémorisée');
  assert.equal(env.mem.autoBids.m1.mode, 'time', 'toujours « sous un délai » (jamais une mise immédiate)');
  assert.ok(env.mem.autoBids.m1.capMode, 'et toujours avec un plafond');
  await sleep(300);
  assert.match(acts.querySelector('.wmx-mk-watch').textContent, /Surveillée/);
  assert.match(w.document.body.textContent, /est surveillée/, 'notification claire');
  WMX.auctions.openBubble?.();
  w.document.querySelector('.wmx-pill, .wmx-dial')?.click();
  await sleep(300);
  const text = w.document.querySelector('.wmx-bubble')?.textContent || '';
  assert.match(text, /Sous surveillance/, 'la carte surveillée apparaît dans « Mes enchères », sous un petit titre');
  acts.querySelector('.wmx-mk-watch').click(); // second clic : on arrête
  for (let i = 0; i < 40 && WMX.auctions.watchState('m1') !== 'none'; i++) await sleep(100);
  assert.equal(WMX.auctions.watchState('m1'), 'none');
  assert.equal(env.mem.autoBids.m1, undefined);
  env.close();
});

test('veille : bouton « Surveiller » sur la page d\'une enchère, juste au-dessus de la ligne « Miser » du jeu', async () => {
  const id = '3f9c2a10-5b7e-4c11-9d2a-0a1b2c3d4e5f';
  const a = auction(id, { seller_id: 'other', base_amount: 100, end_at: inMin(45) });
  const body = '<main><h1>Carte X</h1><div class="card-frame"><div>Votre solde</div><div class="flex gap-2"><div><input aria-label="Montant de la mise" type="number" min="100"></div><button>Miser</button></div></div></main>';
  const { env, w, WMX } = await watchEnv({ auctions: [a], route: `/marketplace/${id}`, body });
  for (let i = 0; i < 60 && !w.document.querySelector('.wmx-dw'); i++) await sleep(150);
  const box = w.document.querySelector('.wmx-dw');
  assert.ok(box, 'bouton ajouté');
  assert.equal(box.nextElementSibling.querySelector('button').textContent, 'Miser', 'juste au-dessus de la ligne « Miser »');
  assert.match(box.querySelector('.wmx-dw-btn').textContent, /Surveiller \(mise au dernier moment\)/);
  box.querySelector('.wmx-dw-btn').click();
  for (let i = 0; i < 40 && WMX.auctions.watchState(id) !== 'watch'; i++) await sleep(100);
  await sleep(300);
  assert.match(w.document.querySelector('.wmx-dw-btn').textContent, /Surveillée · sous \d+ s/);
  env.close();
});

test('marché : badge de moyenne et verdict sous chaque enchère visible', async () => {
  const mk = (id, cardId, price) => ({ id, card_id: cardId, snapshot_rarity: 'UR', base_amount: price, current_bid: null, card: { wikipedia_title: id, rarity: 'UR' } });
  const list = [mk('m1', 'k1', 70), mk('m2', 'k2', 100), mk('m3', 'k3', 300), mk('m4', 'k4', 50)];
  const env = createEnv({ fetchImpl: async (u) => {
    const s = String(u);
    if (s.includes('/sales')) {
      const id = s.match(/cards\/([^/]+)\//)[1];
      return id === 'k4' ? json({ summary: {} }) : json({ summary: { UR: { average: 100, count: 12, latest: 95 } } });
    }
    return json({ auctions: list });
  } });
  const { w, WMX } = env;
  w.history.pushState({}, '', '/marketplace');
  w.document.body.innerHTML = list.map((a) => `<a class="card-frame block" href="/marketplace/${a.id}"><div>${a.id}</div></a>`).join('');
  for (const f of WMX.features) if (f.name === 'market') f.init();
  for (let i = 0; i < 80 && w.document.querySelectorAll('.wmx-mk:not(.wait)').length < 4; i++) await sleep(150);
  const txt = (id) => w.document.querySelector(`a[href$="/${id}"] .wmx-mk`);
  assert.match(txt('m1').textContent, /Moy\. 100 W.*-30 %.*Bonne affaire/);
  assert.match(txt('m2').textContent, /Prix correct/);
  assert.match(txt('m3').textContent, /\+200 %.*Trop cher/);
  assert.match(txt('m4').textContent, /Sans vente.*Prix inconnu/);
  assert.ok(txt('m1').classList.contains('deal') && txt('m3').classList.contains('high'));
  env.close();
});

test('marché : « Miser le minimum » pose le minimum de la page d\'enchère, sans navigation', async () => {
  const list = [{ id: 'q1', card_id: 'k1', snapshot_rarity: 'R', base_amount: 10, current_bid: null, card: { wikipedia_title: 'Carte Q1', rarity: 'R' } }];
  const env = createEnv({ fetchImpl: async (u) => (String(u).includes('/sales') ? json({ summary: { R: { average: 12, count: 5, latest: 11 } } }) : json({ auctions: list, selling: [], bidding: [], won: [{ winner_id: ME }], history: [] })) });
  const { w, WMX } = env;
  const clicks = fakeBidPages(w, 11);
  w.history.pushState({}, '', '/marketplace');
  w.document.body.innerHTML = '<a class="card-frame" href="/marketplace/q1"><div>Carte Q1</div></a>';
  for (const f of WMX.features) if (f.name === 'market' || f.name === 'auctions') await f.init();
  for (let i = 0; i < 60 && !w.document.querySelector('.wmx-mk-bid'); i++) await sleep(150);
  const btn = w.document.querySelector('.wmx-mk-bid');
  assert.ok(btn, 'bouton présent');
  assert.equal(btn.textContent, 'Miser');
  btn.click();
  for (let i = 0; i < 40 && !clicks.length; i++) await sleep(150);
  assert.deepEqual(clicks, ['11']);
  assert.equal(w.location.pathname, '/marketplace', 'aucune navigation');
  env.close();
});

test('échanges : valeurs des deux côtés, wikibidous et écart', async () => {
  const env = createEnv({ fetchImpl: async (u) => {
    const id = String(u).match(/cards\/([^/]+)\//)?.[1];
    return json({ summary: { UR: { average: id === 'c1' ? 100 : 40, count: 9, latest: 1 }, R: { average: 10, count: 9, latest: 1 } } });
  } });
  const { w, WMX } = env;
  w.history.pushState({}, '', '/trades');
  w.document.body.innerHTML = `<div class="card-frame"><span title="Alpha">Alpha</span><span title="Beta">Beta</span>Offre de bob et moi
    <button aria-label="Voir le détail de l'échange">+</button></div>`;
  for (const f of WMX.features) if (f.name === 'trades') f.init();
  w.dispatchEvent(new w.CustomEvent('wmx:api', { detail: { url: '/api/trades', method: 'GET', status: 200, data: { trades: [{
    id: 't1', initiator_id: 'u1', recipient_id: 'u2', initiator_wikibidous: 5, recipient_wikibidous: 0,
    initiator: { username: 'bob' }, recipient: { username: 'moi' },
    items: [
      { offered_by: 'u1', card_id: 'c1', snapshot_rarity: 'UR', card: { wikipedia_title: 'Alpha' } },
      { offered_by: 'u2', card_id: 'c2', snapshot_rarity: 'UR', card: { wikipedia_title: 'Beta' } },
    ] }] } } }));
  for (let i = 0; i < 40 && !w.document.querySelector('.wmx-tv-btn'); i++) await sleep(150);
  w.document.querySelector('.wmx-tv-btn').click();
  for (let i = 0; i < 60 && !/Écart/.test(w.document.body.textContent) || /…/.test(w.document.querySelector('.wmx-tv')?.textContent || ''); i++) await sleep(150);
  const txt = w.document.querySelector('.wmx-tv').textContent;
  assert.match(txt, /bob · 1 carte/);
  assert.match(txt, /Total.*105 W/, 'Alpha 100 + 5 wikibidous');
  assert.match(txt, /Total.*40 W/);
  assert.match(txt, /Écart : 65 W en faveur de moi/);
  env.close();
});

test('marché : plusieurs « Miser le minimum » de suite se mettent en file et sont misés l\'un après l\'autre', async () => {
  const mk = (id, cid) => ({ id, card_id: cid, snapshot_rarity: 'R', base_amount: 10, current_bid: null, card: { wikipedia_title: `Carte ${id}`, rarity: 'R' } });
  const list = [mk('f1', 'k1'), mk('f2', 'k2'), mk('f3', 'k3')];
  const env = createEnv({ fetchImpl: async (u) => (String(u).includes('/sales') ? json({ summary: { R: { average: 12, count: 5, latest: 11 } } }) : json({ auctions: list, selling: [], bidding: [], won: [{ winner_id: ME }], history: [] })) });
  const { w, WMX } = env;
  const clicks = fakeBidPages(w, 11);
  w.history.pushState({}, '', '/marketplace');
  w.document.body.innerHTML = list.map((a) => `<a class="card-frame" href="/marketplace/${a.id}"><div>${a.id}</div></a>`).join('');
  for (const f of WMX.features) if (f.name === 'market' || f.name === 'auctions') await f.init();
  for (let i = 0; i < 80 && w.document.querySelectorAll('.wmx-mk-bid').length < 3; i++) await sleep(150);
  const btns = [...w.document.querySelectorAll('.wmx-mk-bid')];
  assert.equal(btns.length, 3);
  btns.forEach((b) => b.click()); // trois clics d'affilée, sans attendre
  assert.match(btns[1].textContent, /En file/);
  assert.match(btns[2].textContent, /En file/);
  for (let i = 0; i < 160 && clicks.length < 3; i++) await sleep(150);
  assert.deepEqual(clicks, ['11', '11', '11']);
  env.close();
});

test('marché : mes ventes n\'ont pas de bouton de mise et affichent bénéfice / perte', async () => {
  const mine = (id, cid, price) => ({ id, card_id: cid, seller_id: 'me-1', status: 'active', snapshot_rarity: 'UR', base_amount: price, current_bid: null, end_at: inMin(30), card: { wikipedia_title: id, rarity: 'UR' } });
  const sell = [mine('v1', 'k1', 130), mine('v2', 'k2', 60)];
  const buy = { id: 'b1', card_id: 'k3', seller_id: 'other', status: 'active', snapshot_rarity: 'UR', base_amount: 50, current_bid: null, end_at: inMin(30), card: { wikipedia_title: 'b1', rarity: 'UR' } };
  const env = createEnv({ fetchImpl: async (u) => (String(u).includes('/sales') ? json({ summary: { UR: { average: 100, count: 9, latest: 90 } } }) : json({ auctions: [buy, ...sell], selling: sell, bidding: [], won: [{ winner_id: 'me-1' }], history: [] })) });
  const { w, WMX } = env;
  w.history.pushState({}, '', '/marketplace');
  w.document.body.innerHTML = ['v1', 'v2', 'b1'].map((id) => `<a class="card-frame" href="/marketplace/${id}"><div>${id}</div></a>`).join('');
  for (const f of WMX.features) if (f.name === 'market' || f.name === 'auctions') await f.init();
  for (let i = 0; i < 80 && w.document.querySelectorAll('.wmx-mk:not(.wait)').length < 3; i++) await sleep(150);
  const q = (id) => w.document.querySelector(`a[href$="/${id}"]`);
  assert.match(q('v1').querySelector('.wmx-mk').textContent, /\+30 %.*Bénéfice/);
  assert.match(q('v2').querySelector('.wmx-mk').textContent, /-40 %.*À perte/);
  assert.equal(q('v1').querySelector('.wmx-mk-bid'), null, 'pas de bouton de mise sur ma vente');
  assert.equal(q('v2').querySelector('.wmx-mk-bid'), null);
  assert.ok(q('b1').querySelector('.wmx-mk-bid'), 'bouton présent sur une enchère des autres');
  assert.match(q('b1').querySelector('.wmx-mk').textContent, /Bonne affaire/);
  env.close();
});

test('mise automatique : jamais de surenchère sur soi-même (état réel de l\'enchère contrôlé avant de miser)', async () => {
  // La liste (en retard) dit qu'un rival mène, mais l'état réel de l'enchère dit que c'est moi.
  const stale = auction('z1', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(60) });
  const payload = { selling: [], bidding: [stale], won: [{ winner_id: ME }], history: [] };
  const env = createEnv({ fetchImpl: async (u) => (/\/api\/marketplace\/z1/.test(String(u)) ? json({ auction: { current_bidder_id: ME, current_bid: 9, status: 'active' } }) : json(payload)) });
  const { w, WMX } = env;
  const clicks = fakeBidPages(w, 10);
  env.mem.autoBids = { z1: { mode: 'outbid' } };
  for (const f of WMX.features) await f.init?.();
  await sleep(6500);
  assert.deepEqual(clicks, [], 'aucune mise : le contrôle en direct montre que je mène déjà');
  env.close();
});

test('réglages : podium des raretés prioritaires de l’assistant (aucune priorité par défaut, ordre modifiable, enregistré)', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  WMX.openSettings();
  const wrap = w.document.querySelector('.wmx-rord');
  assert.ok(wrap, 'le podium est dans les réglages');
  assert.equal(wrap.querySelectorAll('.wmx-rord-list li').length, 0, 'aucune priorité au départ');
  const pressed = () => [...w.document.querySelectorAll('.wmx-rord .wmx-seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true').textContent;
  assert.equal(pressed(), 'Aucune priorité');
  [...w.document.querySelectorAll('.wmx-rord .wmx-seg-btn')].find((b) => b.textContent === 'Choisir un ordre').click();
  const rows = () => [...w.document.querySelectorAll('.wmx-rord-list li')].map((li) => li.querySelector('.wmx-rord-r').textContent);
  assert.deepEqual(rows(), ['L', 'UR', 'SR'], 'un podium proposé : légendaires, ultra rares, super rares');
  w.document.querySelectorAll('.wmx-rord-list li')[1].querySelector('button[title="Monter"]').click();
  assert.deepEqual(rows(), ['UR', 'L', 'SR'], 'les ultra rares passent devant');
  [...w.document.querySelectorAll('.wmx-rord-add .wmx-rord-btn')].find((b) => b.textContent === 'R').click();
  assert.deepEqual(rows(), ['UR', 'L', 'SR', 'R'], 'une rareté ajoutée au podium');
  w.document.querySelectorAll('.wmx-rord-list li')[3].querySelector('button[title="Retirer du podium"]').click();
  assert.deepEqual(rows(), ['UR', 'L', 'SR']);
  [...w.document.querySelectorAll('.wmx-modal footer .wmx-btn')].find((b) => b.textContent === 'Appliquer').click();
  await sleep(300);
  assert.equal(WMX.settings.autoSellPriorityRar, 'UR,L,SR', 'l’ordre est enregistré');
  WMX.openSettings();
  [...w.document.querySelectorAll('.wmx-rord .wmx-seg-btn')].find((b) => b.textContent === 'Aucune priorité').click();
  assert.equal(w.document.querySelectorAll('.wmx-rord-list li').length, 0, 'retour à aucune priorité');
  [...w.document.querySelectorAll('.wmx-modal footer .wmx-btn')].find((b) => b.textContent === 'Appliquer').click();
  await sleep(300);
  assert.equal(WMX.settings.autoSellPriorityRar, '', 'plus aucune priorité');
  env.close();
});

test('inventaire : relecture légère des cartes étiquetées (filtre tag_id) : cartes nouvellement étiquetées vues, étiquette retirée prise en compte', async () => {
  const tagV = { id: 'T1', name: 'VENTE' };
  const row = (id, title, rarity, tags) => ({ id, card_id: 'c-' + id, count: 1, starred: false, tags, card: { wikipedia_title: title, rarity, id: 'c-' + id } });
  const calls = [];
  const env = createEnv({ fetchImpl: async (u) => {
    const s = String(u);
    if (!s.includes('/api/my-collection')) return json({});
    const p = new URL(s).searchParams;
    calls.push(p.get('tag_id') || 'tout');
    if (p.get('tag_id') === 'T1') return json({ collection: p.get('page') === '0' ? [row('a', 'Alpha', 'SR', [tagV]), row('c', 'Gamma', 'legendaire', [tagV])] : [] });
    return json({ collection: [] });
  } });
  const { WMX } = env;
  env.mem.invCacheV2 = { t: Date.now(), complete: true, items: [
    { id: 'a', card_id: 'c-a', title: 'Alpha', rarity: 'SR', count: 1, starred: false, tags: [tagV] },
    { id: 'b', card_id: 'c-b', title: 'Beta', rarity: 'R', count: 1, starred: false, tags: [tagV] }, // n'a plus l'étiquette dans le jeu
    { id: 'c', card_id: 'c-c', title: 'Gamma', rarity: 'L', count: 1, starred: false, tags: [] },     // vient d'être étiquetée dans le jeu
  ] };
  await WMX.inventory.ensure();
  assert.equal(await WMX.inventory.refreshTagged(['inconnue']), false, 'étiquette inconnue : on laisse le chargement complet faire');
  assert.equal(calls.length, 0, 'aucune requête dans ce cas');
  assert.equal(await WMX.inventory.refreshTagged(['vente']), true);
  assert.ok(calls.every((c) => c === 'T1'), 'seules les cartes de l’étiquette sont relues, pas toute la collection');
  const by = Object.fromEntries(WMX.inventory.items().map((it) => [it.title, it.tags.map((x) => x.name)]));
  assert.deepEqual(by.Gamma, ['VENTE'], 'la Légendaire nouvellement étiquetée est vue');
  assert.deepEqual(by.Alpha, ['VENTE']);
  assert.deepEqual(by.Beta, [], 'l’étiquette retirée dans le jeu est retirée aussi ici');
  env.close();
});

test('inventaire : contrôle du nombre de cartes par étiquette (1 requête) ; relecture seulement si ce nombre change', async () => {
  const tagV = { id: 'T1', name: 'VENTE' };
  const state = { count: 2, reads: 0, checks: 0 };
  const env = createEnv({ fetchImpl: async (u) => {
    const s = String(u);
    if (!s.includes('/api/my-collection')) return json({});
    const p = new URL(s).searchParams;
    if (p.get('stats') === '1') { state.checks += 1; return json({ collection: [], tagOptions: [{ id: 'T1', name: 'VENTE', cardCount: state.count }] }); }
    if (p.get('tag_id') === 'T1') { state.reads += 1; return json({ collection: [] }); }
    return json({ collection: [] });
  } });
  const { WMX } = env;
  env.mem.invCacheV2 = { t: Date.now(), complete: true, items: [{ id: 'a', card_id: 'c-a', title: 'Alpha', rarity: 'SR', count: 1, starred: false, tags: [tagV] }] };
  await WMX.inventory.ensure();
  assert.equal(await WMX.inventory.syncTagged(['VENTE']), true, 'première vérification : on relit une fois pour s’aligner');
  assert.deepEqual([state.checks, state.reads], [1, 1]);
  assert.equal(await WMX.inventory.syncTagged(['VENTE']), false, 'même nombre de cartes : rien n’est relu');
  assert.deepEqual([state.checks, state.reads], [2, 1], 'une seule requête de contrôle, aucune relecture');
  state.count = 3; // une carte de plus portent l'étiquette
  assert.equal(await WMX.inventory.syncTagged(['VENTE']), true, 'nombre différent : on relit les cartes de l’étiquette');
  assert.deepEqual([state.checks, state.reads], [3, 2]);
  assert.equal(await WMX.inventory.syncTagged(['VENTE'], { force: true }), true, 'relecture forcée (bouton Lancer maintenant)');
  env.close();
});

test('inventaire : une carte partie en vente puis revenue invendue revient dans l’inventaire (elle n’est plus oubliée à vie)', async () => {
  const tagV = { id: 'T1', name: 'VENTE' };
  const row = (id, title, rarity, tags) => ({ id, card_id: 'c-' + id, count: 1, starred: false, tags, card: { wikipedia_title: title, rarity, id: 'c-' + id } });
  const state = { back: false };
  const env = createEnv({ fetchImpl: async (u) => {
    const s = String(u);
    if (!s.includes('/api/my-collection')) return json({});
    const p = new URL(s).searchParams;
    if (p.get('stats') === '1') return json({ collection: [], tagOptions: [{ id: 'T1', name: 'VENTE', cardCount: state.back ? 2 : 1 }] });
    if (p.get('tag_id') === 'T1') return json({ collection: p.get('page') === '0' ? [row('b', 'Beta', 'SR', [tagV]), ...(state.back ? [row('a', 'Alpha légendaire', 'legendaire', [tagV])] : [])] : [] });
    return json({ collection: [] });
  } });
  const { w, WMX } = env;
  env.mem.invCacheV2 = { t: Date.now() - 60000, complete: true, items: [
    { id: 'a', card_id: 'c-a', title: 'Alpha légendaire', rarity: 'L', count: 1, starred: false, tags: [tagV] },
    { id: 'b', card_id: 'c-b', title: 'Beta', rarity: 'SR', count: 1, starred: false, tags: [tagV] },
  ] };
  await WMX.inventory.ensure();
  const titles = () => [...WMX.inventory.items().map((it) => it.title)].sort(); // tableau recréé ici (celui du jeu simulé vient d'un autre « monde » JavaScript)
  w.dispatchEvent(new w.CustomEvent('wmx:discard', { detail: { card_id: 'c-a' } })); // Alpha part en vente : retirée de l'inventaire
  assert.deepEqual(titles(), ['Beta']);
  await sleep(30);
  state.back = true; // l'enchère se termine sans acheteur : Alpha est revenue dans la collection
  await WMX.inventory.syncTagged(['VENTE'], { force: true });
  assert.deepEqual(titles(), ['Alpha légendaire', 'Beta'], 'la carte revenue est de nouveau vue (avant : retirée à vie)');
  env.close();
});

test('assistant de vente : une carte invendue retrouve l’étiquette de vente (le jeu la retire), une carte vendue est oubliée', async () => {
  const now = Date.now();
  const hist = { value: [] };
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [], history: hist.value }) });
  const { WMX } = env;
  env.mem.invCacheV2 = { t: now, complete: true, items: [
    { id: 'i1', card_id: 'c1', title: 'Invendue', rarity: 'R', count: 1, starred: false, tags: [{ name: 'VENTE' }, { name: 'Animaux' }] },
    { id: 'i2', card_id: 'c2', title: 'Vendue', rarity: 'C', count: 1, starred: false, tags: [{ name: 'VENTE' }] },
    { id: 'i3', card_id: 'c3', title: 'Sans étiquette de vente', rarity: 'C', count: 1, starred: false, tags: [{ name: 'Animaux' }] },
  ] };
  await WMX.inventory.ensure();
  WMX.settings.autoSellTags = 'VENTE';
  const calls = [];
  WMX.quick.bulk = (type, items, extra) => calls.push({ type, id: items[0].card_id, extra });
  const R = WMX.autoSell.retag;
  R.remember('c1'); R.remember('c2'); R.remember('c3');
  assert.deepEqual(Object.keys(R.memory()).sort(), ['c1', 'c2'], 'seules les cartes portant l’étiquette de vente sont mémorisées');
  assert.deepEqual(R.memory().c1.tags, ['VENTE'], 'uniquement l’étiquette de vente, pas les autres');
  const end = new Date(now + 1000).toISOString();
  hist.value = [{ card_id: 'c1', status: 'settled_unsold', owned: true, end_at: end }, { card_id: 'c2', status: 'settled_sold', owned: false, end_at: end }];
  await R.pass();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ type: 'tag', id: 'c1', extra: { tag: 'VENTE', add: true } }], 'étiquette remise à la carte invendue seulement');
  assert.equal(R.memory().c2, undefined, 'la carte vendue est oubliée');
  await R.pass();
  assert.equal(calls.length, 1, 'pas de seconde demande tant que la première est en cours');
  env.close();
});

test('collection du jeu : en mode sélection (pas d\'étoile), les cartes redessinées gardent leur moyenne, et le ⚡ revient avec l\'étoile', async () => {
  const rows = [{ id: 'i1', card_id: 'k1', count: 1, starred: false, tags: [], card: { wikipedia_title: 'Alpha', rarity: 'rare', id: 'k1' } }];
  const env = createEnv({ fetchImpl: async (u) => (String(u).includes('/sales') ? json({ summary: { R: { average: 42, count: 5, latest: 40 } } })
    : String(u).includes('/api/my-collection') ? json({ collection: rows }) : json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] })) });
  const { w, WMX } = env;
  w.history.pushState({}, '', '/collection');
  const tile = (star) => `<div class="relative isolate group"><div class="cursor-pointer rounded-2xl overflow-hidden relative"><div class="absolute top-2 left-2">R</div>${star ? '<div class="absolute top-2 right-2"><button aria-label="Ajouter aux favoris (x)"></button></div>' : '<div class="absolute top-2 right-2"><input type="checkbox"></div>'}<h3>Alpha</h3></div></div>`;
  w.document.body.innerHTML = `<main><input placeholder="Rechercher par titre ou catégorie..."><div class="flex flex-wrap justify-center">${tile(false)}</div></main>`;
  for (const f of WMX.features) if (['collection-native', 'quick-auction'].includes(f.name)) await f.init?.();
  await WMX.prices.fetchOne('k1');
  for (let i = 0; i < 40 && !/42 W/.test(w.document.querySelector('.wmx-nt-price')?.textContent || ''); i++) await sleep(200);
  assert.equal(w.document.querySelector('.wmx-nt-price')?.textContent, 'Moy. 42 W', 'moyenne affichée même sans étoile (mode sélection)');
  assert.equal(w.document.querySelectorAll('.wmx-nt-bolt').length, 0, 'pas de ⚡ sans étoile');
  // Sortie du mode sélection : la carte est redessinée avec son étoile, le ⚡ apparaît et la moyenne est toujours là.
  w.document.querySelector('.flex-wrap').innerHTML = tile(true);
  for (let i = 0; i < 30 && !w.document.querySelector('.wmx-nt-bolt'); i++) await sleep(200);
  assert.ok(w.document.querySelector('.wmx-nt-bolt'), '⚡ de retour avec l’étoile');
  assert.equal(w.document.querySelector('.wmx-nt-price')?.textContent, 'Moy. 42 W');
  env.close();
});

test('collection du jeu : prix et bouton ⚡ ajoutés sur les cartes, barre des prix au-dessus de la recherche', async () => {
  const rows = [
    { id: 'i1', card_id: 'k1', count: 1, starred: false, tags: [], card: { wikipedia_title: 'Alpha', rarity: 'rare', id: 'k1' } },
    { id: 'i2', card_id: 'k2', count: 1, starred: true, tags: [], card: { wikipedia_title: 'Beta', rarity: 'commun', id: 'k2' } },
  ];
  const env = createEnv({ fetchImpl: async (u) => (String(u).includes('/sales') ? json({ summary: { R: { average: 42, count: 5, latest: 40 }, C: { average: 3, count: 9, latest: 3 } } })
    : String(u).includes('/api/my-collection') ? json({ collection: rows }) : json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] })) });
  const { w, WMX } = env;
  w.history.pushState({}, '', '/collection');
  const tile = (title, r, starLabel) => `<div class="relative isolate group"><div class="cursor-pointer rounded-2xl overflow-hidden relative">
    <div class="absolute top-2 left-2">${r}</div><div class="absolute top-2 right-2"><button aria-label="${starLabel}"></button></div><h3>${title}</h3></div></div>`;
  w.document.body.innerHTML = `<main><input placeholder="Rechercher par titre ou catégorie..."><div class="flex flex-wrap justify-center">${tile('Alpha', 'R', 'Ajouter aux favoris (x)')}${tile('Beta', 'C', 'Retirer des favoris (x)')}</div></main>`;
  for (const f of WMX.features) if (['collection-native', 'quick-auction'].includes(f.name)) await f.init?.();
  await sleep(600);
  assert.ok(w.document.querySelector('.wmx-nt-bar'), 'barre des prix présente');
  assert.ok(w.document.querySelector('.wmx-nt-bar').compareDocumentPosition(w.document.querySelector('input')) & 4, 'barre avant la recherche');
  // Les prix n'arrivent qu'une fois demandés : on les charge pour vérifier l'affichage.
  await WMX.prices.fetchOne('k1');
  await WMX.prices.fetchOne('k2');
  for (let i = 0; i < 40 && ![...w.document.querySelectorAll('.wmx-nt-price')].every((c) => /\d W$/.test(c.textContent)); i++) await sleep(200);
  const chips = [...w.document.querySelectorAll('.wmx-nt-price')].map((c) => c.textContent);
  assert.deepEqual(chips, ['Moy. 42 W', 'Moy. 3 W']);
  const bolts = [...w.document.querySelectorAll('.wmx-nt-bolt')];
  assert.equal(bolts.length, 2);
  assert.equal(bolts[0].disabled, false);
  assert.equal(bolts[1].disabled, true, 'carte favorite : enchère rapide verrouillée');
  env.close();
});

test('enchères terminées : visibles 15 s puis retirées du tableau et du décompte', async () => {
  const old = auction('o1', { seller_id: 'other', current_bid: 5, current_bidder_id: ME, end_at: new Date(Date.now() - 40_000).toISOString() });
  const live = auction('o2', { seller_id: 'other', current_bid: 5, current_bidder_id: ME, end_at: inMin(30) });
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [old, live], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  for (const f of WMX.features) await f.init?.();
  await sleep(3400);
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  assert.equal(w.document.querySelectorAll('.wmx-auc-row').length, 1, 'l\'enchère terminée depuis 40 s a disparu');
  assert.match(w.document.querySelector('.wmx-dial').textContent, /1 mise/);
  env.close();
});

test('file d\'attente : liste des opérations au survol, retrait d\'une opération en attente', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  const items = ['A', 'B', 'C'].map((n, i) => ({ card_id: 'k' + i, title: 'Carte ' + n, rarity: 'R' }));
  WMX.quick.bulk('favorite', items, { want: 'on' });
  await sleep(400);
  const rows = () => [...w.document.querySelectorAll('.wmx-qrow')];
  assert.equal(rows().length, 3);
  assert.ok(rows()[0].classList.contains('cur'), 'la première est en cours');
  assert.equal(rows()[0].querySelector('.wmx-qx'), null, 'on ne retire pas l\'opération en cours');
  rows()[1].querySelector('.wmx-qx').click();
  await sleep(50);
  assert.deepEqual(rows().map((r) => r.querySelector('.wmx-qt').textContent), ['Carte A', 'Carte C']);
  assert.match(w.document.querySelector('.wmx-qtext').textContent, /File 0\/2/);
  env.close();
});

test('tableau des enchères : une enchère qui sort de la liste ne provoque pas de boucle', async () => {
  // Terminée depuis 14,2 s : encore affichée au chargement, retirée 0,8 s plus tard (tick → renderAll → tick…).
  const edge = auction('e1', { seller_id: 'other', current_bid: 5, current_bidder_id: ME, end_at: new Date(Date.now() - 14_200).toISOString() });
  const live = auction('e2', { seller_id: 'other', current_bid: 5, current_bidder_id: ME, end_at: inMin(30) });
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [edge, live], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  for (const f of WMX.features) await f.init?.();
  await sleep(5500); // charge, puis franchit la limite des 15 s
  w.document.querySelector('.wmx-dial').click();
  await sleep(200);
  assert.deepEqual(errors, []);
  assert.equal(w.document.querySelectorAll('.wmx-auc-row').length, 1);
  env.close();
});

test('annuler une vente : le bouton indique tout de suite « Annulation… » et se bloque', async () => {
  const sale = auction('c1', { current_bid: null, end_at: inMin(30) });
  const env = createEnv({ fetchImpl: async () => json({ selling: [sale], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  for (const f of WMX.features) await f.init?.();
  await sleep(3400);
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  const btn = w.document.querySelector('.wmx-auc-cancel');
  assert.equal(btn.textContent, 'Annuler');
  btn.click();
  assert.match(btn.textContent, /Annulation/);
  assert.equal(btn.disabled, true, 'bloqué : pas de clics répétés');
  assert.ok(btn.querySelector('.wmx-dots'));
  await sleep(300); // laisse l'annulation entrer dans la file avant de fermer la fenêtre de test
  env.close();
});

test('assistant de vente : remplit les emplacements libres avec les cartes étiquetées, jamais sans réglage', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [auction('x1', { card_id: 'busy' })], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { WMX } = env;
  const card = (id, tag, over = {}) => ({ card_id: id, title: 'Carte ' + id, rarity: 'R', count: 1, starred: false, tags: [{ name: tag }], ...over });
  WMX.inventory.items = () => [card('busy', 'VENTE'), card('k1', 'VENTE'), card('k2', 'VENTE'), card('k3', 'VENTE'), card('fav', 'VENTE', { starred: true }), card('autre', 'Animaux')];
  WMX.inventory.isLoading = () => false;
  const got = [];
  WMX.quick.bulk = (type, items) => got.push(type, ...items.map((i) => i.card_id));
  await WMX.autoSell.tick();
  assert.deepEqual(got, [], 'désactivé par défaut : aucune mise en vente');
  Object.assign(WMX.settings, { autoSell: true, autoSellTags: 'vente', autoSellMax: 3 });
  await WMX.autoSell.tick();
  assert.deepEqual(got, ['launch', 'k1', 'k2'], '3 enchères visées, 1 déjà en cours : 2 cartes étiquetées, ni la favorite ni l\'autre étiquette');
  env.close();
});

test('journal d\'activité : entrées en série, rapport copiable', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { WMX } = env;
  await Promise.all([WMX.journal.add('File', 'Mise en vente : A — réussie'), WMX.journal.add('File', 'Annulation : B — échec : lent', 'error')]);
  const list = await WMX.journal.list();
  assert.equal(list.length, 2);
  const rep = await WMX.journal.report();
  assert.match(rep, /\[error\] File — Annulation : B — échec : lent/);
  await WMX.journal.clear();
  assert.equal((await WMX.journal.list()).length, 0);
  env.close();
});

test('réglages : les étiquettes de l\'assistant se choisissent dans un menu déroulant des étiquettes du compte', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  const card = (id, ...tags) => ({ card_id: id, title: id, rarity: 'R', count: 1, starred: false, tags: tags.map((name) => ({ name })) });
  WMX.inventory.items = () => [card('a', 'VENTE'), card('b', 'VENTE', 'Animaux'), card('c', 'Sport')];
  WMX.openSettings();
  const btn = w.document.querySelector('.wmx-tagbtn');
  assert.match(btn.textContent, /VENTE/, 'la sélection actuelle est affichée');
  btn.click();
  const opts = [...w.document.querySelectorAll('.wmx-tagopt')];
  assert.deepEqual(opts.map((o) => o.querySelector('span').textContent), ['Animaux', 'Sport', 'VENTE'], 'les étiquettes du compte, triées');
  assert.equal(opts[2].querySelector('small').textContent, '2', 'avec leur nombre de cartes');
  opts[1].querySelector('input').click();
  assert.match(btn.textContent, /VENTE, Sport/);
  const panel = w.document.querySelector('.wmx-tagpanel');
  assert.ok(panel.style.maxHeight && (panel.style.top !== 'auto' || panel.style.bottom !== 'auto'), 'la liste est placée par rapport à l\'écran, avec une hauteur adaptée (jamais coupée par la fenêtre)');
  btn.click();
  assert.equal(panel.hidden, true, 'un second clic referme la liste');
  env.close();
});

test('style de carte : appliqué à toute carte du jeu (marché, échanges…), retiré quand on le désactive', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  const card = (r) => `<div class="relative rounded-2xl overflow-hidden"><img src="a.jpg"><div class="absolute h-[45%] z-20"></div><div class="absolute top-2 left-2 z-30">${r}</div><div class="absolute top-[45%] z-20"><h3>Titre</h3></div></div>`;
  w.document.body.innerHTML = `<main>${card('UR')}${card('C')}<div class="wmx-modal">${card('L')}</div><div class="relative"><img><div class="absolute h-[45%]"></div></div></main>`;
  WMX.cardStyle.scan();
  const cs = [...w.document.querySelectorAll('main > div.rounded-2xl')];
  assert.ok(cs.every((c) => c.classList.contains('wmx-sty') && c.querySelector('.wmx-sty-sheen')), 'les cartes reconnues à leur structure sont stylées');
  assert.equal(cs[0].dataset.wmxR, 'UR');
  assert.equal(cs[1].dataset.wmxR, 'C');
  assert.equal(w.document.querySelector('.wmx-modal .wmx-sty'), null, 'jamais dans les fenêtres de l\'extension');
  assert.equal(w.document.querySelectorAll('.wmx-sty').length, 2, 'ni sur un élément qui n\'est pas une carte');
  WMX.settings.cardStyle = false;
  WMX.cardStyle.scan();
  assert.equal(w.document.querySelectorAll('.wmx-sty, .wmx-sty-sheen').length, 0, 'style désactivé : tout est retiré');
  env.close();
});

test('style de carte : inclinaison 3D sur toutes les cartes stylées au passage de la souris, remise à zéro en la quittant', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  const card = (r) => `<div class="relative rounded-2xl overflow-hidden"><img src="a.jpg"><div class="absolute h-[45%] z-20"></div><div class="absolute top-2 left-2 z-30">${r}</div><div class="absolute top-[45%] z-20"><h3>Titre</h3></div></div>`;
  w.document.body.innerHTML = `<main>${card('C')}${card('UR')}</main>`;
  WMX.features.find((f) => f.name === 'card-style').init(); // le harnais ne lance pas content.js : on démarre la fonction nous-mêmes
  const [a, b] = [...w.document.querySelectorAll('main > div.rounded-2xl')];
  const move = (el) => el.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }));
  const wait = () => new Promise((r) => setTimeout(r, 80));
  move(a); await wait();
  assert.ok(a.style.getPropertyValue('--wmx-tx') && a.style.getPropertyValue('--wmx-ty'), 'une carte ordinaire reçoit ses angles d\'inclinaison');
  move(b); await wait();
  assert.equal(a.style.getPropertyValue('--wmx-tx'), '', 'la carte quittée est remise à plat');
  assert.ok(b.style.getPropertyValue('--wmx-tx'), 'la nouvelle carte survolée s\'incline');
  b.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }));
  w.document.body.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true }));
  await wait();
  assert.equal(b.style.getPropertyValue('--wmx-tx'), '', 'en sortant des cartes, tout est remis à zéro');
  assert.ok(w.document.documentElement.classList.contains('wmx-tilt'), 'collection : mouvement au survol actif');
  // Le marché (listes) reste calme ; la fiche d'une enchère précise, les échanges et les paquets bougent.
  const goes = async (p) => { w.history.pushState({}, '', p); WMX.cardStyle.scan(); await wait(); return w.document.documentElement.classList.contains('wmx-tilt'); };
  for (const p of ['/marketplace', '/marketplace?tab=mine', '/marketplace/history']) {
    assert.equal(await goes(p), false, `${p} : pas de mouvement`);
    assert.ok(w.document.documentElement.classList.contains('wmx-calm'), `${p} : le zoom natif du jeu est coupé (classe wmx-calm)`);
  }
  move(a); await wait();
  assert.equal(a.style.getPropertyValue('--wmx-tx'), '', 'sur le marché, le pointeur n\'incline rien');
  for (const p of ['/marketplace/3f9c2a10-5b7e-4c11-9d2a-0a1b2c3d4e5f', '/trades', '/pulls', '/collection']) {
    assert.equal(await goes(p), true, `${p} : mouvement actif`);
    assert.equal(w.document.documentElement.classList.contains('wmx-calm'), false, `${p} : pas de page calme`);
  }
  env.close();
});

test('carte shiny (« L✦ shiny ») : rareté Légendaire reconnue, traitement d\'exception, retiré avec le style', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  assert.equal(WMX.normRarity('L✦ shiny'), 'L', 'le texte de la pastille shiny donne la rareté');
  assert.equal(WMX.normRarity('UR'), 'UR');
  assert.equal(WMX.normRarity('rare'), 'R', 'les mots complets passent toujours');
  assert.equal(WMX.normRarity('rien'), null);
  const card = (cls, badge) => `<div class="relative rounded-2xl overflow-hidden ${cls}"><img src="a.jpg"><div class="absolute h-[45%] z-20"></div>${badge}<div class="absolute top-[45%] z-20"><h3>Titre</h3></div></div>`;
  const shinyBadge = '<div class="shiny-badge absolute top-2 left-2">L<span aria-hidden="true">✦</span><span class="sr-only"> shiny</span></div>';
  w.document.body.innerHTML = `<main>${card('shiny-card', shinyBadge)}${card('', '<div class="absolute top-2 left-2">L</div>')}</main>`;
  WMX.cardStyle.scan();
  const [shiny, plain] = [...w.document.querySelectorAll('main > div.rounded-2xl')];
  assert.equal(shiny.dataset.wmxR, 'L', 'la carte shiny est une Légendaire (pas une Commune)');
  assert.equal(shiny.dataset.wmxShiny, '1');
  assert.ok(['veil', 'motes', 'drift', 'glare'].every((k) => shiny.querySelector(`.wmx-sty-${k}`)), 'voile sombre, points noirs (deux couches) et reflet');
  assert.equal(plain.dataset.wmxShiny, undefined, 'une Légendaire ordinaire n\'a pas le traitement shiny');
  WMX.cardStyle.scan();
  assert.equal(shiny.querySelectorAll('.wmx-sty-veil').length, 1, 'rien n\'est ajouté en double au balayage suivant');
  WMX.settings.cardStyle = false;
  WMX.cardStyle.scan();
  assert.equal(w.document.querySelectorAll('.wmx-sty-shiny, [data-wmx-shiny]').length, 0, 'style désactivé : tout est retiré');
  env.close();
});

test('révélation des paquets : la face des cartes reprend cadre, vagues et reflet du style de carte', async () => {
  const env = createEnv({ fetchImpl: async () => json({ summary: {} }) });
  const { w, WMX } = env;
  Object.assign(WMX.settings, { speed: 'instant' });
  const cards = [{ id: 'r1', wikipedia_title: 'Carte UR', rarity: 'UR' }, { id: 'r2', wikipedia_title: 'Carte C', rarity: 'C' }];
  const s = WMX.revealSession();
  s.addPack(cards);
  await s.finish();
  const faces = [...w.document.querySelectorAll('.wmx-face')];
  assert.equal(faces.length, 2);
  assert.ok(faces.every((f) => f.classList.contains('wmx-sty-rv') && f.querySelector('.wmx-sty-sheen') && f.querySelector('.wmx-sty-waves')), 'cadre, vagues et reflet sur chaque face');
  s.close();
  WMX.settings.cardStyle = false;
  const s2 = WMX.revealSession();
  s2.addPack(cards);
  await s2.finish();
  assert.equal(w.document.querySelectorAll('.wmx-face.wmx-sty-rv').length, 0, 'style désactivé : faces simples');
  s2.close();
  env.close();
});

test('prix : une erreur 503 du jeu surchargé est réessayée au lieu d\'abandonner le prix', async () => {
  let n = 0;
  const env = createEnv({ files: ['src/lib/namespace.js', 'src/lib/storage.js', 'src/lib/logic.js', 'src/lib/dom.js', 'src/features/stats.js', 'src/features/prices.js'],
    fetchImpl: async () => (++n <= 2 ? json({}, 503) : json({ summary: { R: { average: 12, count: 5, latest: 11 } } })) });
  const { WMX } = env;
  await WMX.prices.load();
  const r = await WMX.prices.fetchOne('lent');
  assert.ok(r.summary, 'le prix finit par arriver');
  assert.equal(n, 3, 'deux erreurs puis un succès');
  assert.equal(WMX.prices.get('lent', 'R').avg, 12);
  env.close();
});

test('prix : la carte sur laquelle on clique ⚡ passe devant le chargement des prix de l\'ouverture', async () => {
  const seen = [];
  const env = createEnv({ files: ['src/lib/namespace.js', 'src/lib/storage.js', 'src/lib/logic.js', 'src/lib/dom.js', 'src/features/stats.js', 'src/features/prices.js'],
    fetchImpl: async (u) => { seen.push(String(u).match(/cards\/([^/]+)\//)[1]); return json({ summary: { R: { average: 5, count: 3, latest: 5 } } }); } });
  const { WMX } = env;
  await WMX.prices.load();
  await WMX.prices.prefetch(['a', 'b', 'c', 'd'].map((id) => ({ id, rarity: 'R' })));
  await WMX.prices.fetchOne('d'); // déjà demandée (en fin de file) : elle doit passer devant
  assert.equal(seen[seen.length - 1], 'd');
  assert.ok(seen.indexOf('d') <= 1, 'servie juste après celle en cours, avant b et c : ' + seen.join(','));
  env.close();
});

test('assistant de vente : l\'état publié dit pourquoi rien n\'est mis en vente, et « Lancer maintenant » refait une passe', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  const card = (id, over = {}) => ({ card_id: id, title: 'Carte ' + id, rarity: 'R', count: 1, starred: true, tags: [{ name: 'VENTE' }], ...over });
  WMX.inventory.items = () => [card('f1'), card('f2')];
  Object.assign(WMX.settings, { autoSell: true, autoSellTags: 'VENTE', autoSellMax: 3 });
  const got = [];
  WMX.quick.bulk = (type, items) => got.push(...items.map((i) => i.card_id));
  const box = WMX.autoSell.footer();
  assert.match(box.textContent, /en attente d’un onglet actif/, 'avant la première passe');
  await WMX.autoSell.tick();
  assert.match(box.querySelector('.wmx-as-txt').textContent, /aucune carte éligible sur 2 étiquetées/);
  assert.deepEqual(got, []);
  WMX.autoSell.openPanel();
  const txt = w.document.querySelector('.wmx-aspanel').textContent;
  assert.match(txt, /2 favorite \(verrouillée\)/, 'la raison est détaillée dans la fenêtre');
  WMX.inventory.items = () => [card('f1', { starred: false })];
  await WMX.autoSell.runNow();
  assert.deepEqual(got, ['f1'], '« Lancer maintenant » refait une passe tout de suite');
  assert.match(box.querySelector('.wmx-as-txt').textContent, /1 carte mise en file/);
  env.close();
});

test('réglages : « Appliquer » n\'enregistre que les réglages modifiés (n\'écrase pas ceux d\'un autre onglet)', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  Object.assign(WMX.settings, { autoSell: false, quickCoef: 0.9 });
  WMX.openSettings(); // cet onglet a une copie ancienne : autoSell = false
  await WMX.store.set('wmxSettings', { ...WMX.settings, autoSell: true }); // un autre onglet vient d'activer l'assistant
  const input = w.document.querySelector('input[type=number]');
  const row = [...w.document.querySelectorAll('.wmx-setrow')].find((r) => /Coefficient du prix/.test(r.textContent));
  const coef = row.querySelector('input');
  coef.value = '0.8'; coef.dispatchEvent(new w.Event('change', { bubbles: true }));
  [...w.document.querySelectorAll('.wmx-modal footer button')].find((b) => b.textContent === 'Appliquer').click();
  await sleep(100);
  const saved = await WMX.store.get('wmxSettings', {});
  assert.equal(saved.quickCoef, 0.8, 'le réglage modifié est enregistré');
  assert.equal(saved.autoSell, true, 'celui de l\'autre onglet est conservé');
  assert.ok(input);
  env.close();
});

test('assistant de vente : ne remet jamais en vente une carte que le jeu dit ne plus posséder (vendue)', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }],
    history: [{ id: 'h1', card_id: 'vendue', status: 'settled_sold', owned: false }, { id: 'h2', card_id: 'revenue', status: 'settled_unsold', owned: true }] }) });
  const { w, WMX } = env;
  const card = (id) => ({ card_id: id, title: 'Carte ' + id, rarity: 'R', count: 1, starred: false, tags: [{ name: 'VENTE' }] });
  WMX.inventory.items = () => [card('vendue'), card('revenue'), card('autre')];
  Object.assign(WMX.settings, { autoSell: true, autoSellTags: 'VENTE', autoSellMax: 5 });
  const got = [];
  WMX.quick.bulk = (type, items) => got.push(...items.map((i) => i.card_id));
  const gone = [];
  w.addEventListener('wmx:discard', (e) => gone.push(e.detail.card_id));
  await WMX.autoSell.tick();
  assert.deepEqual(got.sort(), ['autre', 'revenue'], 'la carte vendue n\'est pas choisie, celle revenue invendue l\'est');
  assert.deepEqual(gone, ['vendue'], 'elle est retirée de l\'inventaire en mémoire');
  WMX.autoSell.openPanel();
  assert.match(w.document.querySelector('.wmx-aspanel').textContent, /plus dans votre collection/);
  env.close();
});

test('assistant de vente : charge lui-même la collection (hors page Collection) et affiche le prix par défaut des cartes sans vente', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { WMX } = env;
  const card = (id) => ({ card_id: id, title: 'Carte ' + id, rarity: 'R', count: 1, starred: false, tags: [{ name: 'VENTE' }] });
  let list = [];
  let ensured = 0;
  WMX.inventory.ensure = async () => { ensured += 1; list = [card('x1')]; };
  WMX.inventory.items = () => list;
  Object.assign(WMX.settings, { autoSell: true, autoSellTags: 'VENTE', autoSellMax: 3 });
  const got = [];
  WMX.quick.bulk = (type, items) => got.push(...items.map((i) => i.card_id));
  await WMX.autoSell.tick();
  assert.equal(ensured, 1, 'la passe charge la collection si la page ne l\'a pas fait');
  assert.deepEqual(got, ['x1'], 'et choisit ses cartes dedans');
  WMX.prices.has = () => true;
  WMX.prices.get = () => null;
  assert.match(WMX.quick.hint({ card_id: 'x1', rarity: 'R' }), /10 W .*aucune vente/, 'prix par défaut annoncé dans l\'infobulle du ⚡');
  env.close();
});

test('ouverture auto : un rechargement de la page ne l\'arrête pas, les cartes déjà tirées sont gardées, le stock est estimé', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  mem.autoRun = { on: true, t: Date.now() - 20000, buffer: [{ id: 'c1' }, { id: 'c2' }], opened: 2 };
  mem.packsSeen = { packs: 3, max: 10, nextIn: 100, t: Date.now() - 250000 }; // vu il y a ~4 min : 1 paquet de plus
  const f = WMX.features.find((x) => x.name === 'boosters');
  assert.ok(f.match.test('/marketplace'), 'le menu des paquets existe sur toutes les pages, pas seulement sur Paquets');
  await f.init();
  await sleep(1300);
  assert.ok(w.document.documentElement.classList.contains('wmx-auto-on'), 'l\'ouverture auto a repris après le rechargement');
  assert.equal(w.document.querySelector('.wmx-fab-count').textContent, '2', 'avec les paquets déjà ouverts');
  assert.equal(w.document.querySelector('.wmx-fab-txt b').textContent, '~4/10', 'stock estimé depuis la dernière visite de la page Paquets');
  assert.equal((await WMX.store.get('autoRun', null)).buffer.length, 2, 'les cartes mises de côté restent mémorisées');
  env.close();
});

test('ouverture auto : une trace ancienne n\'est pas relancée, mais les cartes tirées sont montrées', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  mem.autoRun = { on: true, t: Date.now() - 10 * 60000, buffer: [{ id: 'c1' }], opened: 1 };
  let shown = null;
  WMX.reveal = (cards) => { shown = cards; };
  await WMX.features.find((x) => x.name === 'boosters').init();
  await sleep(300);
  assert.ok(!w.document.documentElement.classList.contains('wmx-auto-on'), 'pas de reprise après une longue absence');
  assert.deepEqual(shown, [{ id: 'c1' }], 'les cartes déjà tirées sont montrées');
  assert.equal(await WMX.store.get('autoRun', null), null, 'la trace est effacée');
  env.close();
});

test('bulle des enchères : la pastille est visible dès le chargement, même si les enchères tardent à arriver', async () => {
  const env = createEnv({ fetchImpl: async () => { throw new Error('jeu lent'); } });
  const { w, WMX } = env;
  WMX.features.find((x) => x.name === 'auctions').init();
  await sleep(1300);
  const bubble = w.document.querySelector('.wmx-bubble');
  assert.equal(bubble.hidden, false, 'la bulle est affichée sans attendre le premier chargement réussi');
  assert.match(bubble.querySelector('.wmx-dial-txt').textContent, /…/, 'avec un état « chargement », pas de faux zéros');
  env.close();
});

test('jeu lent : si le jeu efface <body> en finissant de s\'afficher, la bulle des enchères et le menu des paquets sont remis', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  WMX.features.find((x) => x.name === 'auctions').init();
  await WMX.features.find((x) => x.name === 'boosters').init();
  assert.ok(w.document.querySelector('.wmx-bubble') && w.document.querySelector('.wmx-panel'), 'présents au départ');
  w.document.body.replaceChildren(); // le jeu remplace le contenu de la page
  assert.equal(w.document.querySelector('.wmx-bubble'), null, 'effacés');
  await sleep(1300);
  assert.ok(w.document.querySelector('.wmx-bubble'), 'la bulle des enchères est revenue');
  assert.ok(w.document.querySelector('.wmx-panel') && w.document.querySelector('.wmx-pdial'), 'le menu des paquets aussi');
  env.close();
});

test('ouverture auto : l\'échéance survit au rechargement, et changer l\'intervalle la recalcule une seule fois', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  const due = Date.now() + 7 * 60000;
  mem.autoRun = { on: true, t: Date.now() - 5000, buffer: [], opened: 0, nextAt: due };
  await WMX.features.find((x) => x.name === 'boosters').init();
  await sleep(300);
  assert.equal((await WMX.store.get('autoRun', null)).nextAt, due, 'l\'échéance d\'avant le rechargement est conservée (pas de nouveau tirage au sort)');
  const [min, max] = w.document.querySelectorAll('.wmx-body input[type=number]');
  min.value = '1'; max.value = '1'; max.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(100);
  const after = (await WMX.store.get('autoRun', null)).nextAt;
  assert.ok(after > Date.now() + 50000 && after < Date.now() + 70000, 'intervalle 1–1 min : échéance recalculée à ~1 min');
  env.close();
});

test('statistiques : retenues pendant l\'ouverture auto (pas de spoil de la répartition), comptées d\'un coup à l\'arrêt', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { WMX } = env;
  WMX.stats.hold();
  await WMX.stats.record([{ rarity: 'UR' }, { rarity: 'C' }]);
  await WMX.stats.record([{ rarity: 'C' }]);
  let s = await WMX.stats.get();
  assert.equal(s.cards, 0, 'rien n\'est compté pendant l\'ouverture');
  assert.equal(s.rarity.UR, 0, 'l\'UR tirée ne se voit pas dans la répartition');
  await WMX.stats.release();
  s = await WMX.stats.get();
  assert.equal(s.packs, 2); assert.equal(s.cards, 3); assert.equal(s.rarity.UR, 1); assert.equal(s.rarity.C, 2);
  await WMX.stats.record([{ rarity: 'R' }]);
  assert.equal((await WMX.stats.get()).rarity.R, 1, 'ensuite, l\'enregistrement redevient immédiat');
  env.close();
});

test('stock plein hors de la page Paquets : avertissement et bouton pour y retourner (auto active)', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  mem.autoRun = { on: true, t: Date.now() - 3000, buffer: [], opened: 0, nextAt: Date.now() + 5 * 60000 };
  mem.packsSeen = { packs: 10, max: 10, nextIn: null, t: Date.now() - 60000 };
  const nav = [];
  w.addEventListener('wmx:navigate', (e) => nav.push(e.detail));
  await WMX.features.find((x) => x.name === 'boosters').init();
  await sleep(1300);
  const warn = w.document.querySelector('.wmx-fullwarn');
  assert.equal(warn.hidden, false, 'l\'avertissement est affiché');
  assert.match(warn.textContent, /Stock plein \(~10\/10\)/);
  warn.querySelector('button').click();
  assert.deepEqual(nav, ['/pulls'], 'le bouton ramène sur la page Paquets');
  assert.equal(WMX.RARITY_RGB.SR, '244 114 182', 'SR en rose');
  env.close();
});

test('bulle des enchères : colonnes adaptatives, titres vers le Marché, largeur réglable', async () => {
  const future = (m) => new Date(Date.now() + m * 60000).toISOString();
  const bid = { id: 'b1', status: 'active', card: { wikipedia_title: 'Carte B', rarity: 'C' }, end_at: future(30), base_amount: 5, current_bid: 6, current_bidder_id: 'x' };
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [bid], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  WMX.features.find((x) => x.name === 'auctions').init();
  await WMX.auctions.refresh();
  const nav = [];
  w.addEventListener('wmx:navigate', (e) => nav.push(e.detail));
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  const panel = w.document.querySelector('.wmx-bubble-panel');
  assert.equal(panel.dataset.mode, 'one', 'une seule colonne quand il n\'y a pas de vente');
  assert.match(panel.textContent, /Mes enchères \(1\)/);
  assert.ok(!/Aucune vente/.test(panel.textContent), 'aucune note ni place vide pour la partie absente');
  assert.equal(w.document.querySelectorAll('.wmx-auc-col').length, 1);
  assert.equal(panel.querySelectorAll('.wmx-auc-note').length, 0);
  w.document.querySelector('.wmx-auc-h3link').click();
  assert.deepEqual(nav, ['/marketplace'], 'le titre mène au Marché');
  const grips = panel.querySelectorAll('.wmx-bubble-grip');
  assert.equal(grips.length, 4, 'un bord de chaque côté, en haut et en bas');
  env.close();
});

test('cadran des paquets : visible sur toutes les pages (menu replié), rouge avec une alerte quand le stock est plein même sans ouverture auto', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  mem.packsSeen = { packs: 10, max: 10, nextIn: null, t: Date.now() - 30000 };
  await WMX.features.find((x) => x.name === 'boosters').init(); // page « /collection » : pas la page Paquets
  await sleep(1300);
  const dial = w.document.querySelector('.wmx-pdial');
  assert.ok(dial && !dial.classList.contains('gone'), 'le cadran est visible hors de la page Paquets, sans ouverture auto');
  assert.equal(w.document.querySelector('.wmx-panel').hidden, true, 'le menu complet est replié');
  assert.ok(dial.classList.contains('full'), 'cadran rouge : stock plein');
  assert.match(dial.textContent, /~10\/10/);
  const warn = w.document.querySelector('.wmx-fullwarn');
  assert.equal(warn.hidden, false);
  assert.match(warn.textContent, /ne se régénèrent plus/, 'sans auto : le message invite à aller ouvrir les paquets');
  warn.querySelector('.wmx-qclear').click();
  assert.equal(warn.hidden, true, 'masquable');
  env.close();
});

test('bulle des enchères : hauteur réglable (mémorisée), en-tête et ligne de l\'assistant toujours présents, quatre bords à saisir', async () => {
  const future = (m) => new Date(Date.now() + m * 60000).toISOString();
  const bid = { id: 'b1', status: 'active', card: { wikipedia_title: 'Carte B', rarity: 'C' }, end_at: future(30), base_amount: 5, current_bid: 6, current_bidder_id: 'x' };
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [bid], won: [{ winner_id: ME }], history: [] }) });
  const { w, mem, WMX } = env;
  mem.auctionBubbleSize = { h: 300, one: 400 };
  WMX.features.find((x) => x.name === 'auctions').init();
  await sleep(50);
  await WMX.auctions.refresh();
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  const panel = w.document.querySelector('.wmx-bubble-panel');
  assert.equal(panel.style.height, '300px', 'la hauteur choisie est reprise');
  assert.equal(panel.style.width, '400px', 'et la largeur de cette disposition');
  assert.equal(panel.querySelectorAll('.wmx-bubble-grip').length, 4, 'gauche, droite, haut, bas');
  assert.ok(panel.querySelector('.wmx-bubble-head') && panel.querySelector('.wmx-as-line'), 'en-tête et assistant de vente restent dans le panneau');
  assert.match(w.document.querySelector('.wmx-dial').textContent, /1 mise/, 'le cadran dit « mises »');
  assert.match(panel.querySelector('.wmx-bubble-head').textContent, /Enchères et ventes/, 'l\'en-tête garde « Enchères »');
  const grip = panel.querySelector('.wmx-bubble-grip.t');
  grip.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(panel.style.height, '', 'double-clic : hauteur d\'origine');
  env.close();
});

test('menu des paquets : déplaçable (position mémorisée et reprise), bouton replier centré (chevrons dessinés), cadran au-dessus de celui des enchères', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  mem.panelPos = { x: 120, y: 90 };
  await WMX.features.find((x) => x.name === 'boosters').init();
  const panel = w.document.querySelector('.wmx-panel');
  assert.ok(panel.classList.contains('moved'), 'la position choisie est reprise');
  assert.equal(panel.style.left, '120px'); assert.equal(panel.style.top, '90px');
  assert.ok(panel.querySelector('.wmx-fold svg'), 'bouton replier : chevrons dessinés, centrés');
  panel.querySelector('.wmx-head').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(panel.classList.contains('moved'), false, 'double-clic sur l\'en-tête : retour à l\'emplacement d\'origine');
  assert.equal(await WMX.store.get('panelPos', 'absent'), 'absent', 'position effacée');
  env.close();
});

test('menu des paquets : ouvert depuis une autre page, il reste ouvert en arrivant sur la page Paquets (« Tout ouvrir » ne le referme pas)', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, mem, WMX } = env;
  mem.panelCollapsed = true; // préférence d'affichage de la page Paquets : replié
  await WMX.features.find((x) => x.name === 'boosters').init();
  const panel = w.document.querySelector('.wmx-panel');
  w.document.querySelector('.wmx-pdial').click();
  assert.ok(panel.classList.contains('open'), 'ouvert depuis le cadran');
  w.history.pushState({}, '', '/pulls');
  w.document.documentElement.dataset.wmxRoute = '/pulls';
  await sleep(80);
  assert.ok(panel.classList.contains('open'), 'toujours ouvert sur la page Paquets');
  env.close();
});

test('mise automatique « sous un délai » : remise à chaque surenchère adverse tant que le compteur est sous le délai', async () => {
  const a = auction('b9', { seller_id: 'other', current_bid: 8, current_bidder_id: 'rival', end_at: inMin(0.3) }); // ~18 s restantes, délai de 35 s
  let clicks = [];
  const fetchImpl = async (url) => {
    const bid = 8 + 2 * clicks.length; // chaque mise de ma part est aussitôt surenchérie par un rival
    if (/\/api\/marketplace\/b9/.test(String(url))) return json({ auction: { current_bidder_id: 'rival', current_bid: bid, status: 'active' } });
    return json({ selling: [], bidding: [{ ...a, current_bid: bid }], won: [{ winner_id: ME }], history: [] });
  };
  const env = createEnv({ fetchImpl });
  clicks = fakeBidPages(env.w, 7);
  env.mem.autoBids = { b9: { mode: 'time', secs: 35 } };
  for (const f of env.WMX.features) await f.init?.();
  for (let i = 0; i < 30 && clicks.length < 2; i++) await sleep(500);
  assert.ok(clicks.length >= 2, 'surenchère adverse après ma mise, toujours sous 35 s : l\'extension remise une 2e fois');
  assert.ok(env.mem.autoBids.b9, 'et la règle reste active (une mise aussitôt dépassée n\'est pas un échec)');
  env.close();
});

test('page d\'une enchère : moyenne du marché et verdict sous « Mise actuelle » (une seule fois, mis à jour quand la mise change)', async () => {
  const id = '9d5a646b-6447-4245-ac06-c47abb5e144d';
  const auctionJson = { auction: { id, seller_id: 'other', card_id: 'c-x', base_amount: 10, current_bid: 33, status: 'active', snapshot_rarity: 'L', end_at: inMin(10), card: { wikipedia_title: 'Carte X', rarity: 'L' } } };
  const env = createEnv({ fetchImpl: async () => json(auctionJson) });
  const { w, WMX } = env;
  w.document.documentElement.classList.add('wmx-hide-desc', 'wmx-hide-stats'); // la balise <html> porte des classes de l'extension (réglages d'affichage) : ne doit rien empêcher
  w.history.pushState({}, '', '/marketplace/' + id);
  w.document.body.innerHTML = '<main><div class="box"><div class="flex"><span>Mise actuelle</span><span id="v">33</span></div><div>Meneur : X</div></div></main>';
  WMX.prices.get = () => ({ avg: 100, count: 5, last: 98 });
  WMX.prices.fresh = () => true;
  await WMX.features.find((x) => x.name === 'market').init();
  await sleep(700);
  const chip = w.document.querySelector('.wmx-dk');
  assert.ok(chip, 'une ligne moyenne + verdict est ajoutée');
  assert.match(chip.textContent, /Moy\. 100 W/); assert.match(chip.textContent, /-67 % · Bonne affaire/);
  assert.equal(w.document.querySelectorAll('.wmx-dk').length, 1, 'une seule');
  w.document.getElementById('v').textContent = '120'; // la mise monte en direct
  await sleep(700);
  assert.match(w.document.querySelector('.wmx-dk').textContent, /\+20 % · Trop cher/, 'le verdict suit la mise affichée');
  assert.equal(w.document.querySelectorAll('.wmx-dk').length, 1);
  env.close();
});

test('bulle des enchères : moyenne du marché et verdict à côté de la mise actuelle', async () => {
  const future = (m) => new Date(Date.now() + m * 60000).toISOString();
  const bid = { id: 'b1', status: 'active', card_id: 'c1', snapshot_rarity: 'C', card: { wikipedia_title: 'Carte B', rarity: 'C' }, end_at: future(30), base_amount: 5, current_bid: 60, current_bidder_id: 'x' };
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [bid], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  WMX.prices.get = () => ({ avg: 100, count: 5, last: 98 });
  WMX.prices.fresh = () => true;
  WMX.features.find((x) => x.name === 'auctions').init();
  await WMX.auctions.refresh();
  w.document.querySelector('.wmx-dial').click();
  await sleep(100);
  const mk = w.document.querySelector('.wmx-auc-mk');
  assert.ok(mk, 'la moyenne est affichée dans la bulle');
  assert.match(mk.textContent, /Moy\. 100 W/); assert.match(mk.textContent, /-40 % · Bonne affaire/);
  env.close();
});

test('notifications : temporaires avec anneau et disparition, alertes rouges persistantes avec croix, même clé = remplacement', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { w, WMX } = env;
  const q = (s) => [...w.document.querySelectorAll(s)];
  WMX.toast('Enchère lancée.', 300);
  WMX.notify({ kind: 'alert', key: 'game-block', title: 'Vérification humaine demandée', text: 'Faites la vérification.' });
  await sleep(30);
  assert.equal(q('.wmx-note').length, 2);
  assert.ok(q('.wmx-note')[0].querySelector('.wmx-note-ring'), 'la temporaire a son anneau');
  assert.ok(!q('.wmx-note.alert')[0].querySelector('.wmx-note-ring'), 'l’alerte n’a pas d’anneau');
  assert.ok(q('.wmx-note.alert')[0].querySelector('.wmx-note-x'), 'l’alerte a sa croix');
  WMX.notify({ kind: 'alert', key: 'game-block', title: 'Limite du site atteinte', text: 'Pause.' });
  await sleep(30);
  assert.equal(q('.wmx-note.alert').length, 1, 'même clé : remplacée, pas empilée');
  assert.match(q('.wmx-note.alert')[0].textContent, /Limite du site/);
  await sleep(600);
  assert.equal(q('.wmx-note:not(.alert)').length, 0, 'la temporaire a disparu');
  assert.equal(q('.wmx-note.alert').length, 1, 'l’alerte reste');
  q('.wmx-note.alert .wmx-note-x')[0].click();
  await sleep(300);
  assert.equal(q('.wmx-note').length, 0, 'la croix ferme l’alerte');
  env.close();
});

test('refus du jeu : vérification humaine, limite d\'automatisation ou refus simple, expliqués en clair', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { WMX } = env;
  assert.match(WMX.explainRefusal('POST /api/marketplace → 403 [« Vérification humaine requise »]').title, /vérifier que vous êtes humain/);
  const hv = WMX.explainRefusal('POST /api/marketplace → 403 [serveur Vercel · « {"error":"Vérification anti-bot requise.","code":"human_verification_required"} »]');
  assert.equal(hv.kind, 'human');
  assert.ok(!/[{}]|code|403|human_verification/.test(`${hv.title} ${hv.text} ${hv.short}`), 'aucun JSON, code ni numéro d’erreur dans le texte lu par la personne');
  assert.match(hv.hint, /human_verification_required/, 'le détail technique reste disponible (info-bulle)');
  const lim = WMX.explainRefusal('POST /api/marketplace → 403 [serveur x · « Trop de requêtes automatisées. L’automatisation n’est pas autorisée »]');
  assert.equal(lim.kind, 'limit');
  assert.match(lim.title, /trop vite/);
  assert.match(lim.hint, /Trop de requêtes automatisées/, 'le message du jeu reste en détail technique');
  const plain = WMX.explainRefusal('POST /api/marketplace → 403 [« Désolé, réessayez plus tard »]');
  assert.match(plain.text, /Le jeu dit : « Désolé, réessayez plus tard »/, 'un message simple du jeu est repris');
  assert.match(WMX.explainRefusal('POST /api/marketplace → 403').title, /refusé/);
  env.close();
});

test('toutes les notifications de problème : titre commun, texte sans code ni jargon, détail technique seulement en info-bulle', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  const q = (s) => [...w.document.querySelectorAll(s)];
  WMX.toast('Le bouton « Miser » n’est pas apparu : rien n’a été misé.', 6000, { kind: 'warn' });
  WMX.reportError('prix', 503, 'GET /api/cards/abc/sales');
  WMX.reportError('marché', 0);
  await sleep(50);
  const notes = q('.wmx-note.warn');
  assert.equal(notes.length, 3);
  for (const n of notes) {
    assert.match(n.querySelector('b').textContent, /Ça n’a pas marché/, 'un problème a toujours le même titre');
    assert.ok(!/\b(40\d|50\d|429|403|http|api|json|post|get)\b/i.test(n.querySelector('span').textContent), `texte lisible, sans code : « ${n.querySelector('span').textContent} »`);
  }
  const withHint = notes.find((n) => /serveur/.test(n.textContent));
  assert.match(withHint.title, /sales/, 'le détail technique est en info-bulle');
  env.close();
});

test('vérification humaine du jeu dans le cadre d’automatisation : montrée au centre de l’écran, puis l’extension reprend quand elle est faite', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  assert.equal(await WMX.askHumanCheck('work'), 'none', 'pas de cadre : rien à montrer');
  WMX.prepareCardSheets('work'); // crée le cadre (jsdom ne charge pas la page : on y met nous-mêmes la fenêtre de vérification du jeu)
  const frame = w.document.querySelector('iframe.wmx-work');
  const fd = frame.contentDocument;
  if (!fd.body) (fd.documentElement || fd.appendChild(fd.createElement('html'))).append(fd.createElement('body')); // jsdom : cadre vide sans <body>
  assert.equal(await WMX.askHumanCheck('work'), 'none', 'cadre sans vérification (le jeu n’a affiché qu’un message) : none');
  fd.body.textContent = 'Vérification rapide — cochez la case';
  const pending = WMX.askHumanCheck('work');
  await sleep(400);
  assert.ok(frame.classList.contains('wmx-on') && frame.classList.contains('wmx-human'), 'le cadre devient visible, en fenêtre');
  assert.match(w.document.querySelector('.wmx-note.alert').textContent, /Cochez la case/);
  fd.body.textContent = ''; // la personne a fait la vérification : la fenêtre du jeu disparaît
  assert.equal(await pending, 'done');
  assert.ok(!frame.classList.contains('wmx-on') && !frame.classList.contains('wmx-human'), 'le cadre est de nouveau caché');
  await sleep(300); // la notification joue sa sortie (180 ms) avant d'être retirée
  assert.equal(w.document.querySelector('.wmx-note.alert'), null, 'la notification disparaît');
  env.close();
});

test('notice du jeu (bandeau « trop de requêtes automatisées ») reprise en alerte rouge ; le texte d\'une carte ne déclenche rien', async () => {
  const env = createEnv({ fetchImpl: async () => json({ selling: [], bidding: [], won: [{ winner_id: ME }], history: [] }) });
  const { w } = env;
  const d = w.document;
  const card = d.createElement('div'); card.innerHTML = '<h3>Automatisation</h3><p>vérification humaine, trop de requêtes</p>'; d.body.append(card);
  await sleep(50);
  assert.equal(d.querySelectorAll('.wmx-note').length, 0, 'une carte n’est pas une notification du jeu');
  const t = d.createElement('div'); t.setAttribute('role', 'alert'); t.textContent = 'Trop de requêtes automatisées. L’automatisation n’est pas autorisée — voir le règlement.'; d.body.append(t);
  await sleep(50);
  const a = d.querySelector('.wmx-note.alert');
  assert.ok(a, 'alerte affichée');
  assert.match(a.textContent, /trop vite/);
  assert.match(a.title, /voir le règlement/, 'le texte exact du jeu est en info-bulle');
  assert.ok(a.querySelector('.wmx-note-x') && a.querySelector('.wmx-note-act'));
  env.close();
});
