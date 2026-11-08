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
  assert.equal(ids({ priorityRar: ['UR'] }), 'bacd', 'une rareté prioritaire passe avant les autres (puis meilleure moyenne)');
  assert.equal(ids({ priorityRar: ['L', 'ur'], order: 'avg' }), 'dbac', 'plusieurs raretés prioritaires, dans l’ordre donné (casse sans importance)');
});
