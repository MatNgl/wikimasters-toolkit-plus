const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib/logic.js');

const H = L.HOUR;

test('priceTtl / isFresh : un prix est valable 4 jours', () => {
  const now = 1_000_000_000_000;
  assert.equal(L.priceTtl(), 96 * H);
  assert.equal(L.isFresh(null, now), false);
  assert.equal(L.isFresh({ t: now - 95 * H, s: { UR: { count: 1 } } }, now), true);
  assert.equal(L.isFresh({ t: now - 97 * H, s: { UR: { count: 40 } } }, now), false);
  assert.equal(L.isFresh({ s: {} }, now), false);
});

test('priceBatch : les prix jamais chargés d\'abord, l\'actualisation seulement ensuite', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const has = (it) => it.id !== 1;
  const fresh = (it) => it.id === 2 || it.id === 1;
  const a = L.priceBatch(items, has, fresh);
  assert.deepEqual(a.missing.map((i) => i.id), [1]);
  assert.deepEqual(a.stale.map((i) => i.id), [3, 4]);
  assert.deepEqual(a.todo.map((i) => i.id), [1], 'les prix périmés attendent que tout ait été chargé une fois');
  assert.equal(a.refresh, false);
  const b = L.priceBatch(items, () => true, fresh);
  assert.deepEqual(b.todo.map((i) => i.id), [3, 4]);
  assert.equal(b.refresh, true);
  assert.deepEqual(L.priceBatch(items, () => true, () => true).todo, []);
});

test('limitWait : croît, plafonne à 60 s, suit Retry-After', () => {
  assert.equal(L.limitWait(1), 6);
  assert.equal(L.limitWait(2), 12);
  assert.equal(L.limitWait(50), 60);
  assert.equal(L.limitWait(1, 30), 30);
  assert.equal(L.limitWait(1, 9999), 120);
  assert.equal(L.limitWait(3, NaN), 18);
});

test('nextGap : ralentit au refus, récupère lentement, reste borné', () => {
  assert.equal(L.nextGap(600, true), 900);
  assert.equal(L.nextGap(2000, true), 2500);
  assert.equal(L.nextGap(2500, true), 2500);
  assert.equal(L.nextGap(1000, false), 980);
  assert.equal(L.nextGap(600, false), 600);
});

test('fmtLeft', () => {
  assert.equal(L.fmtLeft(0), 'Terminée');
  assert.equal(L.fmtLeft(-5), 'Terminée');
  assert.equal(L.fmtLeft(95_000), '1 min 35 s');
  assert.equal(L.fmtLeft(3 * H + 41 * 60_000), '3 h 41 min');
});

test('timeState : seuils 5 min (rouge) et 2 min (alerte)', () => {
  assert.equal(L.timeState(0), 'ended');
  assert.equal(L.timeState(119_000), 'urgent');
  assert.equal(L.timeState(120_000), 'low');
  assert.equal(L.timeState(299_000), 'low');
  assert.equal(L.timeState(300_000), 'ok');
});

test('packAverage', () => {
  assert.equal(L.packAverage(1000, 4), 250);
  assert.equal(L.packAverage(1001, 3), 334);
  assert.equal(L.packAverage(500, 0), null);
  assert.equal(L.packAverage(NaN, 2), null);
});

test('crownCount / crownIndexes : 1 couronne (<8 cartes), 2 (<15), 3 ensuite', () => {
  assert.equal(L.crownCount(0), 0);
  assert.equal(L.crownCount(5), 1);
  assert.equal(L.crownCount(8), 2);
  assert.equal(L.crownCount(15), 3);
  assert.deepEqual(L.crownIndexes([5, 50, 20, 0, 7]), [1]);
  assert.deepEqual(L.crownIndexes([5, 50, 20, 9, 7, 3, 2, 80]), [7, 1]);
  assert.deepEqual(L.crownIndexes([0, 0, 0]), []);
  assert.deepEqual(L.crownIndexes([10, 10, 3]), [0]); // égalité : le premier tiré
});

test('friendlyError : messages lisibles', () => {
  assert.match(L.friendlyError(0), /connexion internet/);
  assert.match(L.friendlyError(401), /expiré/);
  assert.match(L.friendlyError(429), /trop vite/);
  assert.match(L.friendlyError(503), /serveur du jeu/);
  assert.match(L.friendlyError(418), /inattendue/);
  for (const s of [0, 401, 403, 404, 429, 500, 503, 418]) assert.ok(!/\d{3}|erreur/i.test(L.friendlyError(s)), `statut ${s} : aucun code d’erreur dans le message`);
});

test('parseAutoRule : normalise et refuse les valeurs invalides', () => {
  assert.deepEqual(L.parseAutoRule({ mode: 'outbid' }), { mode: 'outbid' });
  assert.deepEqual(L.parseAutoRule({ mode: 'outbid', cap: '120' }), { mode: 'outbid', capMode: 'abs', cap: 120 });
  assert.deepEqual(L.parseAutoRule({ mode: 'time', amount: 30, unit: 's' }), { mode: 'time', secs: 30 });
  assert.deepEqual(L.parseAutoRule({ mode: 'time', amount: 2, unit: 'min', cap: 50 }), { mode: 'time', secs: 120, capMode: 'abs', cap: 50 });
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 1, unit: 's' }).secs, 5); // plancher 5 s
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 99999, unit: 'min' }).secs, 6 * 3600);
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 0 }), null);
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 'abc' }), null);
  assert.equal(L.parseAutoRule({ mode: 'x' }), null);
  assert.equal(L.parseAutoRule(), null);
});

test('autoLabel', () => {
  assert.equal(L.autoLabel({ mode: 'outbid' }), 'Auto · dès surenchère');
  assert.equal(L.autoLabel({ mode: 'time', secs: 30 }), 'Auto · sous 30 s');
  assert.equal(L.autoLabel({ mode: 'time', secs: 300, cap: 80 }), 'Auto · sous 5 min · max 80 W');
  assert.equal(L.autoLabel(null), '');
});

test('autoBidDue : jamais si on mène, si c\'est fini, en pause, ou au-dessus du plafond', () => {
  const ok = { leading: false, msLeft: 20_000, cooldownOk: true, minBid: 10 };
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, msLeft: 3_600_000 }), true);
  assert.equal(L.autoBidDue({ mode: 'time', secs: 30 }, ok), true);
  assert.equal(L.autoBidDue({ mode: 'time', secs: 30 }, { ...ok, msLeft: 31_000 }), false);
  assert.equal(L.autoBidDue({ mode: 'time', secs: 30 }, { ...ok, leading: true }), false);
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, leading: true }), false);
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, msLeft: 0 }), false);
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, cooldownOk: false }), false);
  assert.equal(L.autoBidDue({ mode: 'outbid', cap: 9 }, ok), false);
  assert.equal(L.autoBidDue({ mode: 'outbid', cap: 10 }, ok), true);
  assert.equal(L.autoBidDue({ mode: 'outbid', cap: 9 }, { ...ok, minBid: null }), true); // minimum inconnu : le contrôle se fait au moment de miser
  assert.equal(L.autoBidDue(null, ok), false);
});

test('autoPollMs : rapide près de l\'échéance', () => {
  assert.equal(L.autoPollMs([]), 0);
  assert.equal(L.autoPollMs([{ rule: { mode: 'outbid' }, msLeft: 9e6 }]), 4000);
  assert.equal(L.autoPollMs([{ rule: { mode: 'time', secs: 30 }, msLeft: 3_600_000 }]), 10000);
  assert.equal(L.autoPollMs([{ rule: { mode: 'time', secs: 30 }, msLeft: 49_000 }]), 4000);
  assert.equal(L.autoPollMs([{ rule: { mode: 'time', secs: 35 }, msLeft: 20_000 }]), 2000, 'dans la fenêtre « sous 35 s » : toutes les 2 s');
  assert.equal(L.autoPollMs([{ rule: { mode: 'outbid' }, msLeft: 40_000 }]), 2000, 'dès surenchère, dans la dernière minute');
});

test('dealVerdict : bonne affaire / correct / trop cher / inconnu', () => {
  assert.deepEqual(L.dealVerdict(80, 100, 10), { kind: 'deal', label: 'Bonne affaire', pct: -20, low: false });
  assert.equal(L.dealVerdict(85, 100, 10).kind, 'deal');
  assert.equal(L.dealVerdict(86, 100, 10).kind, 'fair');
  assert.equal(L.dealVerdict(115, 100, 10).kind, 'fair');
  assert.equal(L.dealVerdict(116, 100, 10).kind, 'high');
  assert.equal(L.dealVerdict(150, 100, 2).low, true);
  assert.equal(L.dealVerdict(10, undefined, 0).kind, 'unknown');
  assert.equal(L.dealVerdict(10, 0, 5).kind, 'unknown');
  assert.equal(L.dealVerdict(0, 100, 5).kind, 'deal');
});

test('saleVerdict : bénéfice / prix du marché / à perte', () => {
  assert.deepEqual(L.saleVerdict(120, 100, 10), { kind: 'profit', label: 'Bénéfice', pct: 20, low: false });
  assert.equal(L.saleVerdict(104, 100, 10).kind, 'profit', 'au-dessus de la moyenne : bénéfice, sans zone intermédiaire');
  assert.equal(L.saleVerdict(101, 100, 10).kind, 'profit');
  assert.equal(L.saleVerdict(100, 100, 10).kind, 'even', 'pile sur la moyenne');
  assert.equal(L.saleVerdict(96, 100, 10).kind, 'loss', 'en dessous de la moyenne : à perte');
  assert.equal(L.saleVerdict(96, 100, 10).label, 'À perte');
  assert.notEqual(L.dealVerdict(96, 100, 10).label, 'À perte', 'achat et vente n’emploient pas les mêmes mots');
  assert.equal(L.saleVerdict(60, 100, 1).low, true);
  assert.equal(L.saleVerdict(60, null, 0).kind, 'unknown');
});

test('plafond selon la moyenne : parseAutoRule, resolveCap, capLabel', () => {
  assert.deepEqual(L.parseAutoRule({ mode: 'outbid', capMode: 'avg', capPct: 30 }), { mode: 'outbid', capMode: 'avg', capPct: 30 });
  assert.deepEqual(L.parseAutoRule({ mode: 'outbid', capMode: 'avg', capPct: 0 }), { mode: 'outbid', capMode: 'avg', capPct: 0 });
  assert.equal(L.parseAutoRule({ mode: 'outbid', capMode: 'avg', capPct: -500 }).capPct, -90);
  assert.equal(L.parseAutoRule({ mode: 'outbid', capMode: 'avg', capPct: 'x' }).capMode, undefined);
  assert.equal(L.parseAutoRule({ mode: 'outbid', capMode: 'none', cap: 10 }).capMode, undefined);
  assert.equal(L.resolveCap({ capMode: 'avg', capPct: 30 }, 100), 130);
  assert.equal(L.resolveCap({ capMode: 'avg', capPct: 0 }, 42), 42);
  assert.equal(L.resolveCap({ capMode: 'avg', capPct: -20 }, 50), 40);
  assert.equal(L.resolveCap({ capMode: 'avg', capPct: 30 }, null), null, 'moyenne inconnue');
  assert.equal(L.resolveCap({ capMode: 'abs', cap: 80 }, 10), 80);
  assert.equal(L.resolveCap({ cap: 80 }, 10), 80, 'règle ancienne');
  assert.equal(L.resolveCap({ mode: 'outbid' }, 10), null);
  assert.equal(L.capLabel({ capMode: 'avg', capPct: 30 }), 'max moy. +30 %');
  assert.equal(L.capLabel({ capMode: 'avg', capPct: -10 }), 'max moy. -10 %');
  assert.equal(L.capLabel({ capMode: 'avg', capPct: 0 }), 'max moyenne');
  assert.equal(L.autoLabel({ mode: 'outbid', capMode: 'avg', capPct: 20 }), 'Auto · dès surenchère · max moy. +20 %');
  const ok = { leading: false, msLeft: 20_000, cooldownOk: true, minBid: 60 };
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, capW: 54 }), false);
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, capW: 60 }), true);
  assert.equal(L.autoBidDue({ mode: 'outbid' }, { ...ok, capW: null }), true);
});

test('anneau du compte à rebours : part restante et couleur', () => {
  assert.equal(L.ringFraction(0), 0);
  assert.equal(L.ringFraction(1_800_000), 0.5);
  assert.equal(L.ringFraction(9e9), 1);
  assert.equal(L.ringColor(1), 'hsl(130 85% 52%)');
  assert.equal(L.ringColor(0), 'hsl(0 85% 52%)');
  assert.equal(L.ringColor(0.5), 'hsl(65 85% 52%)');
});

test('assistant de vente : cartes éligibles, ordre et garde-fous', () => {
  const now = 1_000_000_000_000;
  const card = (id, tags, over = {}) => ({ card_id: id, title: id, rarity: 'R', count: 1, starred: false, tags: tags.map((name) => ({ name })), ...over });
  const items = [card('a', ['VENTE']), card('b', ['vente ']), card('c', ['Autre']), card('d', ['VENTE'], { starred: true }),
    card('e', ['VENTE']), card('f', ['VENTE']), card('g', ['VENTE']), card('h', ['VENTE'], { count: 0 })];
  const avg = { a: 10, b: 50, e: 30, f: 20, g: 40 };
  const o = { tags: ['VENTE'], free: 10, busy: new Set(['e']), skip: { f: now + 1000 }, log: { g: [now - 1000, now - 2000, now - 3000, now - 4000] }, now, avg: (it) => avg[it.card_id] };
  assert.deepEqual(L.pickAutoSell(items, o).map((i) => i.card_id), ['b', 'a'],
    'étiquette (sans tenir compte de la casse), pas de favorite, pas de carte en vente/écartée/déjà trop remise en vente, les plus chères d\'abord');
  assert.deepEqual(L.pickAutoSell(items, { ...o, free: 1 }).map((i) => i.card_id), ['b'], 'au plus le nombre d\'emplacements libres');
  assert.deepEqual(L.pickAutoSell(items, { ...o, free: 0 }), []);
  assert.deepEqual(L.pickAutoSell(items, { ...o, tags: [] }), [], 'sans étiquette choisie : rien');
  assert.deepEqual(L.pickAutoSell(items, { ...o, now: now + 2 * 24 * 3600_000 }).map((i) => i.card_id), ['b', 'g', 'f', 'a'],
    'deux jours plus tard : l\'écart de f et le compteur de g ont expiré (e reste en vente)');
});

test('assistant de vente : le plafond écarte les cartes trop chères', () => {
  const now = 1_000_000_000_000;
  const items = ['p', 'q', 'r'].map((id) => ({ card_id: id, title: id, rarity: 'C', count: 1, starred: false, tags: [{ name: 'VENTE' }] }));
  const avg = { p: 3700, q: 400, r: 0 };
  const ids = (cap) => L.pickAutoSell(items, { tags: ['VENTE'], free: 5, now, cap, avg: (it) => avg[it.card_id] }).map((i) => i.card_id);
  assert.deepEqual(ids(500), ['q', 'r'], 'la carte à 3 700 W est écartée, celle sans prix connu reste candidate (le plafond est revérifié au lancement)');
  assert.deepEqual(ids(0), ['p', 'q', 'r'], 'sans plafond : toutes, les plus chères en premier');
});

test('assistant de vente : le plan explique la raison de chaque carte mise de côté', () => {
  const now = 1_000_000_000_000;
  const card = (id, over = {}) => ({ card_id: id, title: id, rarity: 'R', count: 1, starred: false, tags: [{ name: 'VENTE' }], ...over });
  const items = [card('ok'), card('fav', { starred: true }), card('busy'), card('skip'), card('cher'), card('jour'), card('autre', { tags: [{ name: 'Sport' }] })];
  const plan = L.autoSellPlan(items, { tags: ['VENTE'], now, cap: 500, busy: new Set(['busy']), skip: { skip: now + 3600_000 }, log: { jour: [now - 1, now - 2, now - 3, now - 4] }, avg: (it) => (it.card_id === 'cher' ? 900 : 10) });
  assert.equal(plan.tagged, 6, 'la carte d\'une autre étiquette n\'est pas comptée');
  assert.deepEqual(plan.eligible.map((i) => i.card_id), ['ok']);
  assert.deepEqual(Object.fromEntries(plan.excluded.map((e) => [e.card_id, e.reason])), { fav: 'favorite', busy: 'busy', skip: 'skipped', cher: 'capped', jour: 'perDay' });
  assert.equal(plan.excluded.find((e) => e.card_id === 'skip').until, now + 3600_000);
});

test('autoBidDue : sous le délai, on surenchérit à CHAQUE fois qu\'un autre nous dépasse (jamais avant le délai, jamais si on mène)', () => {
  const rule = { mode: 'time', secs: 35 };
  const st = { leading: false, msLeft: 30_000, minBid: 12, capW: null, cooldownOk: true };
  assert.equal(L.autoBidDue(rule, st), true, 'sous 35 s, quelqu\'un d\'autre mène : on mise');
  assert.equal(L.autoBidDue(rule, { ...st, leading: true }), false, 'on mène : rien');
  assert.equal(L.autoBidDue(rule, { ...st, minBid: 14 }), true, 'nouvelle surenchère adverse, toujours sous 35 s : on remise');
  assert.equal(L.autoBidDue(rule, { ...st, msLeft: 36_000 }), false, 'avant le délai : rien');
  assert.equal(L.autoBidDue(rule, { ...st, minBid: 14, capW: 13 }), false, 'le plafond reste la seule autre condition');
  assert.equal(L.autoLabel(rule), 'Auto · sous 35 s');
  assert.equal(L.autoLabel({ ...rule, watch: true }), 'Veille · sous 35 s', 'une veille est annoncée comme telle');
});

test('priceNote : moyenne et verdict prêts à afficher (achat, vente, sans vente)', () => {
  const p = { avg: 100, count: 5, last: 98 };
  const buy = L.priceNote('buy', 60, p);
  assert.equal(buy.kind, 'deal'); assert.match(buy.avg, /Moy\. 100 W/); assert.match(buy.verdict, /-40 % · Bonne affaire/);
  assert.equal(L.priceNote('buy', 130, p).kind, 'high');
  assert.equal(L.priceNote('sale', 130, p).kind, 'profit', 'ma vente au-dessus de la moyenne : bénéfice');
  const none = L.priceNote('buy', 50, null);
  assert.equal(none.avg, 'Sans vente'); assert.equal(none.kind, 'unknown');
});

test('assistant de vente : ordre des cartes (meilleure moyenne par défaut, ou raretés / moyenne basse), raretés prioritaires d’abord', () => {
  const tag = [{ name: 'VENTE' }];
  const items = [
    { card_id: 'a', title: 'A', rarity: 'C', count: 1, tags: tag, avg: 90 },
    { card_id: 'b', title: 'B', rarity: 'UR', count: 1, tags: tag, avg: 40 },
    { card_id: 'c', title: 'C', rarity: 'R', count: 1, tags: tag, avg: 60 },
    { card_id: 'd', title: 'D', rarity: 'L', count: 1, tags: tag, avg: 10 },
  ];
  const ids = (o) => L.autoSellPlan(items, { tags: ['VENTE'], now: 0, avg: (it) => it.avg, ...o }).eligible.map((x) => x.card_id).join('');
  assert.equal(ids({}), 'acbd', 'par défaut : meilleure moyenne d’abord');
  assert.equal(ids({ order: 'avgLow' }), 'dbca', 'moyenne la plus basse d’abord');
  assert.equal(ids({ order: 'rarityHigh' }), 'dbca', 'raretés les plus hautes d’abord');
  assert.equal(ids({ order: 'rarityLow' }), 'acbd', 'raretés les plus basses d’abord');
  assert.equal(ids({ priorityRar: ['UR'] }), 'b', 'liste de raretés : SEULE l’UR est vendue');
  assert.equal(ids({ priorityRar: ['L', 'ur'] }), 'd', 'ordre strict : les UR attendent la fin des L (casse sans importance)');
  assert.equal(ids({ priorityRar: ['L', 'ur'], strict: false }), 'db', 'sans ordre strict : L puis UR, aucune autre rareté');
});

test('assistant de vente : liste de raretés stricte (une rareté à la fois, cartes en vente comprises)', () => {
  const tag = [{ name: 'VENTE' }];
  const card = (id, rarity, over = {}) => ({ card_id: id, title: id, rarity, count: 1, starred: false, tags: tag, ...over });
  const items = [card('u1', 'UR'), card('u2', 'UR'), card('s1', 'SR'), card('s2', 'SR'), card('c1', 'C')];
  const plan = (o) => L.autoSellPlan(items, { tags: ['VENTE'], now: 0, priorityRar: ['UR', 'SR'], avg: () => 10, ...o });
  let p = plan({});
  assert.deepEqual(p.eligible.map((x) => x.card_id), ['u1', 'u2'], 'UR seulement');
  assert.equal(p.current, 'UR');
  assert.equal(p.outside, 1, 'la commune est hors liste, jamais vendue');
  assert.equal(p.excluded.filter((e) => e.reason === 'later').length, 2, 'les SR attendent');
  p = plan({ busy: new Set(['u1', 'u2']) });
  assert.deepEqual(p.eligible, [], 'UR en file : on attend au lieu de passer aux SR');
  assert.equal(p.current, 'UR');
  p = L.autoSellPlan(items.filter((x) => x.rarity !== 'UR'), { tags: ['VENTE'], now: 0, priorityRar: ['UR', 'SR'], pending: [{ card_id: 'u9', rarity: 'UR' }] });
  assert.deepEqual(p.eligible, [], 'une UR encore en vente (peut revenir invendue) retient les SR');
  assert.equal(p.byRar.UR.onSale, 1);
  p = plan({ cap: 50, avg: (it) => (it.rarity === 'UR' ? 900 : 10) });
  assert.deepEqual(p.eligible.map((x) => x.card_id), ['s1', 's2'], 'des UR trop chères ne bloquent pas la liste');
  assert.equal(p.byRar.UR.capped, 2, 'mais elles sont comptées (signalées dans la bulle)');
  p = plan({ priorityRar: ['L'] });
  assert.equal(p.current, null, 'plus aucune L : rien en cours');
  assert.deepEqual(p.eligible, []);
});

test('défausse par critères : raretés, étiquette, cartes étiquetées, doublons, seuil, prix inconnu, protections', () => {
  const card = (id, rarity, over = {}) => ({ card_id: id, title: id, rarity, count: 1, starred: false, image: 'x.jpg', tags: [], ...over });
  const items = [
    card('c1', 'C'), card('c2', 'C', { count: 3 }), card('c3', 'C', { tags: [{ name: 'animaux' }] }), card('c4', 'C', { starred: true }),
    card('c5', 'C', { image: '' }), card('c6', 'C'), card('c7', 'C', { tags: [{ name: 'VENTE' }] }), card('p1', 'PC'), card('u1', 'UR'),
  ];
  const avg = { c6: 35, c1: 2, c2: 3, c5: 1, c3: 4, c7: 50 };
  const base = { rarities: ['C'], avg: (it) => avg[it.card_id] || 0, priced: (it) => it.card_id !== 'c1' };
  const ids = (o) => L.discardPlan(items, { ...base, ...o }).cards.map((c) => c.card_id).sort().join(',');
  assert.equal(ids({ unpriced: 'discard' }), 'c1,c2,c5,c6', 'C sans étiquette, jamais la favorite');
  assert.equal(ids({}), 'c2,c5,c6', 'par défaut, une carte au prix jamais chargé est gardée');
  assert.equal(ids({ unpriced: 'discard', includeTagged: true }), 'c1,c2,c3,c5,c6,c7', 'étiquetées comprises');
  assert.equal(ids({ unpriced: 'discard', includeTagged: true, protectTags: ['vente'] }), 'c1,c2,c3,c5,c6', 'étiquette protégée (casse sans importance)');
  assert.equal(ids({ unpriced: 'discard', tag: 'animaux' }), 'c3', 'une étiquette précise');
  assert.equal(ids({ unpriced: 'discard', tags: ['animaux', 'vente'] }), 'c3,c7', 'plusieurs étiquettes');
  assert.equal(ids({ unpriced: 'discard', maxAvg: 20 }), 'c1,c2,c5', 'seuil : la carte à 35 W est gardée');
  assert.equal(ids({ unpriced: 'discard', onlyNoImage: true }), 'c5', 'seulement sans image');
  const one = L.discardPlan(items, { ...base, unpriced: 'discard', keepOne: true });
  assert.deepEqual(one.cards.map((c) => [c.card_id, c.copies]), [['c2', 2]], 'garder 1 exemplaire : seuls les doublons, un exemplaire reste');
  assert.equal(one.kept.single, 3, 'c1, c5 et c6 n’ont qu’un exemplaire');
  const all = L.discardPlan(items, { ...base, unpriced: 'discard', busy: new Set(['c6']) });
  assert.equal(all.copies, 5, 'c1 + 3×c2 + c5 (c6 en vente)');
  assert.deepEqual(all.byRar, { C: 5 });
  assert.equal(all.kept.busy, 1); assert.equal(all.kept.favorite, 1);
  assert.equal(L.discardPlan(items, { ...base, rarities: [] }).copies, 0, 'ni rareté ni étiquette choisie : rien');
  const withRows = items.map((it, i) => ({ ...it, id: `row${i}` }));
  const tr = L.discardPlan(withRows, { ...base, unpriced: 'discard', trade: new Set(['row0']) });
  assert.ok(!tr.cards.some((c) => c.card_id === 'c1'), 'carte proposée dans un échange en cours : jamais défaussée');
  assert.equal(tr.kept.trade, 1);
  const tagged = [...items, card('u2', 'UR', { tags: [{ name: 'animaux' }] }), card('r1', 'R', { tags: [{ name: 'Animaux' }] })];
  assert.equal(L.discardPlan(tagged, { ...base, rarities: [], tags: ['animaux'], unpriced: 'discard' }).cards.map((c) => c.card_id).sort().join(','), 'c3,r1,u2',
    'aucune rareté mais une étiquette : toutes les raretés de cette étiquette');
  assert.equal(L.discardPlan(tagged, { ...base, rarities: ['UR'], tags: ['animaux'], unpriced: 'discard' }).cards.map((c) => c.card_id).join(','), 'u2', 'rareté + étiquette : les deux filtres');
});

test('paquets : type de compte lu sur la page (Pack PRO du jour = Pro, proposition de passer Pro = classique)', () => {
  assert.equal(L.packAccount('10 / 10 paquets disponibles Pack PRO du jour Déjà réclamé aujourd’hui (heure de ton appareil). Reviens demain !'), 'pro');
  assert.equal(L.packAccount('Pack PRO du jour Ouvrir'), 'pro');
  assert.equal(L.packAccount('3 / 10 paquets disponibles Passe à WikiMasters Pro pour plus de paquets'), 'classic');
  assert.equal(L.packAccount('3 / 10 paquets disponibles'), null, 'rien de concluant tant que la page n’est pas finie');
  assert.equal(L.packAccount('0 / 10 paquets disponibles Prochain dans 9:23 Rechargez 10 paquets — 1,99 $ CAD WikiMasters PRO Débloque paquets accélérés, pack premium quotidien, vue du marché, plus de défis et d’enchères actives. Paquets plus vite — un nouveau paquet toutes les 3 minutes au lieu de 10. Pack PRO chaque jour — 15 cartes de rareté ++, gratuit une fois par jour. 9,99 $ CAD / mois — facturé par Stripe S’abonner au PRO'), 'classic', 'page d’un vrai compte classique');
  assert.equal(L.packAccount('Passe Pro ! Avantages du compte Pro : un paquet toutes les 3 min, un Pack PRO du jour… 4,99 € / mois'), 'classic', 'l’offre Pro peut citer le Pack PRO du jour : c’est un compte classique');
  assert.equal(L.packRegen('pro'), 180);
  assert.equal(L.packRegen('classic'), 600);
});

test('paquets : stock estimé d’après l’heure exacte du prochain paquet (3 min en Pro, 10 min en classique, 10 au maximum)', () => {
  const t = 1_000_000_000_000;
  const snap = { packs: 3, t, nextAt: t + 60_000 };
  assert.deepEqual(L.packEstimate(snap, t + 30_000, 600), { packs: 3, max: 10, nextIn: 30, nextAt: t + 60_000, fullAt: t + 60_000 + 6 * 600_000 });
  assert.equal(L.packEstimate(snap, t + 60_000, 600).packs, 4, 'le paquet attendu est arrivé');
  assert.equal(L.packEstimate(snap, t + 60_000, 600).nextIn, 600, 'le suivant dans 10 min');
  assert.equal(L.packEstimate(snap, t + 60_000 + 3 * 180_000, 180).packs, 7, 'Pro : un paquet toutes les 3 min');
  assert.equal(L.packEstimate(snap, t + 5 * 3600_000, 600).packs, 10, 'jamais plus de 10, même longtemps après');
  assert.equal(L.packEstimate(snap, t + 5 * 3600_000, 600).nextIn, null, 'stock plein : plus de compte à rebours');
  assert.equal(L.packEstimate({ packs: 3, t, nextIn: 100 }, t + 250_000, 600).packs, 4, 'ancien relevé (compte à rebours) encore lu');
  assert.equal(L.packEstimate({ packs: 12, t, nextAt: null }, t, 600).packs, 10);
  assert.equal(L.packEstimate(null, t, 600), null);
});

test('marché : fraîcheur d’une moyenne (à jour sous 24 h, sinon non à jour depuis X, actualisation en cours)', () => {
  const H = 3600000;
  assert.equal(L.ageText(10 * 60000), 'moins d’une heure');
  assert.equal(L.ageText(5 * H), '5 h');
  assert.equal(L.ageText(49 * H), '2 jours');
  assert.deepEqual(L.priceFreshness(3 * H), { state: 'fresh', icon: '✓', line: 'Moyenne à jour · chargée il y a 3 h' });
  assert.equal(L.priceFreshness(30 * H).state, 'stale');
  assert.match(L.priceFreshness(30 * H).line, /non à jour depuis 1 jour/);
  assert.equal(L.priceFreshness(30 * H, true).state, 'loading');
  assert.match(L.priceFreshness(30 * H, true).line, /actualisation en cours/);
  assert.equal(L.priceFreshness(null, true).state, 'loading');
});

test('plus-values : chaque vente prend l’achat le plus ancien de la même carte (rareté, shiny), achats avant la vente seulement', () => {
  const H = 3600000;
  const buys = [
    { id: 'b1', t: 1 * H, price: 100, card_id: 'x', rarity: 'L', shiny: false },
    { id: 'b2', t: 2 * H, price: 150, card_id: 'x', rarity: 'L', shiny: false },
    { id: 'b3', t: 3 * H, price: 500, card_id: 'x', rarity: 'L', shiny: true },
    { id: 'b4', t: 9 * H, price: 80, card_id: 'y', rarity: 'SR', shiny: false },
  ];
  const sells = [
    { id: 's1', t: 4 * H, price: 160, card_id: 'x', rarity: 'L', shiny: false },
    { id: 's2', t: 5 * H, price: 90, card_id: 'x', rarity: 'L', shiny: false },
    { id: 's3', t: 6 * H, price: 20, card_id: 'z', rarity: 'C', shiny: false },
    { id: 's4', t: 7 * H, price: 70, card_id: 'y', rarity: 'SR', shiny: false }, // l'achat de y est APRÈS : vente d'une carte non achetée
  ];
  const { ops, stock } = L.ledgerPair(buys, sells);
  const by = Object.fromEntries(ops.map((o) => [o.id, o]));
  assert.equal(by.s1.kind, 'resale'); assert.equal(by.s1.buy.id, 'b1'); assert.equal(by.s1.gain, 60); assert.equal(by.s1.hold, 3 * H);
  assert.equal(by.s2.kind, 'resale'); assert.equal(by.s2.buy.id, 'b2'); assert.equal(by.s2.gain, -60);
  assert.equal(by.s3.kind, 'sell'); assert.equal(by.s4.kind, 'sell');
  assert.deepEqual(stock.map((b) => b.id), ['b4', 'b3'], 'la shiny et l’achat postérieur restent en stock');
  assert.equal(ops[0].id, 'b4', 'opérations de la plus récente à la plus ancienne');
  const s = L.ledgerSummary(ops);
  assert.equal(s.gain, 0); assert.equal(s.resales, 2); assert.equal(s.wins, 1); assert.equal(s.losses, 1);
  assert.equal(s.sold, 340); assert.equal(s.nSold, 4); assert.equal(s.soldNotBought, 90);
  assert.equal(s.bought, 830); assert.equal(s.nBought, 4); assert.equal(s.net, 340 - 830);
  assert.equal(Math.round(s.pct), 0);
});

test('plus-values : périodes jour / semaine (lundi) / mois en heure locale, et décalage', () => {
  const t = new Date(2026, 10, 13, 15, 30).getTime(); // vendredi 13 novembre 2026
  assert.equal(L.periodStart(t, 'day'), new Date(2026, 10, 13).getTime());
  assert.equal(L.periodStart(t, 'week'), new Date(2026, 10, 9).getTime(), 'semaine du lundi 9');
  assert.equal(L.periodStart(t, 'month'), new Date(2026, 10, 1).getTime());
  assert.equal(L.periodShift(new Date(2026, 10, 1).getTime(), 'month', -1), new Date(2026, 9, 1).getTime());
  assert.equal(L.periodShift(new Date(2026, 10, 9).getTime(), 'week', 1), new Date(2026, 10, 16).getTime());
  assert.equal(L.holdText(45 * 60000), '45 min');
  assert.equal(L.holdText(3 * 3600000), '3 h');
  assert.equal(L.holdText(72 * 3600000), '3 j');
});

test('assistant de vente : limite de mises en vente par carte sur 24 h réglable, ou sans limite', () => {
  const now = 10 * 86400000;
  const items = [{ card_id: 'a', title: 'A', rarity: 'R', count: 1, tags: [{ name: 'VENTE' }] }];
  const log = { a: [now - 3600000, now - 7200000, now - 30 * 3600000] }; // 2 dans les dernières 24 h, 1 plus ancienne
  const reason = (perDay) => L.autoSellPlan(items, { tags: ['VENTE'], now, log, perDay }).excluded[0]?.reason || 'eligible';
  assert.equal(reason(2), 'perDay', '2 mises en vente sur 24 h : limite de 2 atteinte');
  assert.equal(reason(3), 'eligible', 'limite de 3 : encore une');
  assert.equal(reason(Infinity), 'eligible', 'sans limite');
  assert.equal(reason(undefined), 'eligible', 'par défaut : 4');
});

test('paquets : le stock maximum est celui affiché par le jeu (« 3 / 20 paquets »), 10 par défaut', () => {
  const t = 1_000_000;
  assert.equal(L.packMax('20'), 20);
  assert.equal(L.packMax(undefined), 10, 'page pas encore lue');
  assert.equal(L.packMax('0', 20), 20, 'valeur illisible : on garde le maximum connu');
  const snap = { packs: 3, max: 20, t, nextAt: t + 60_000 };
  assert.equal(L.packEstimate(snap, t, 180).max, 20);
  assert.equal(L.packEstimate(snap, t + 60_000 + 10 * 180_000, 180).packs, 14, 'plus de 10 : le stock monte jusqu’à 20');
  assert.equal(L.packEstimate(snap, t + 24 * 3600_000, 180).packs, 20, 'plafonné à 20');
  assert.equal(L.packEstimate(snap, t, 180).fullAt, t + 60_000 + 16 * 180_000, 'stock plein après 17 paquets');
  assert.equal(L.packEstimate({ packs: 3, t, nextAt: null }, t, 180).max, 10, 'ancien relevé sans maximum : 10');
});

test('échanges : bilan vu de mon côté (gain, perte, équilibré, prix manquants, cartes sans vente)', () => {
  const c = (avg, priced = true) => ({ avg, priced });
  let b = L.tradeBalance({ w: 0, cards: [c(40)] }, { w: 5, cards: [c(100)] });
  assert.equal(b.kind, 'win'); assert.equal(b.diff, 65); assert.match(b.label, /vous gagnez 65 W \(\+163 %\)/);
  b = L.tradeBalance({ w: 15, cards: [] }, { w: 0, cards: [c(3)] });
  assert.equal(b.kind, 'loss'); assert.match(b.label, /vous perdez 12 W \(-80 %\)/);
  assert.equal(L.tradeBalance({ w: 0, cards: [c(100)] }, { w: 0, cards: [c(97)] }).kind, 'even', '3 % d’écart : équilibré');
  b = L.tradeBalance({ w: 0, cards: [c(100)] }, { w: 0, cards: [c(null, false)] });
  assert.equal(b.kind, 'pending'); assert.equal(b.missing, 1);
  b = L.tradeBalance({ w: 0, cards: [c(null, true)] }, { w: 10, cards: [] });
  assert.equal(b.noSale, 1, 'une carte sans vente compte 0 W'); assert.equal(b.kind, 'win');
});
