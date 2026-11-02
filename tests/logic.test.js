const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib/logic.js');

const H = L.HOUR;

test('priceTtl : 48 h par défaut, 96 h pour une carte très vendue', () => {
  assert.equal(L.priceTtl({}), 48 * H);
  assert.equal(L.priceTtl({ UR: { count: 3 } }), 48 * H);
  assert.equal(L.priceTtl({ UR: { count: 9 }, R: { count: 2 } }), 48 * H);
  assert.equal(L.priceTtl({ UR: { count: 10 } }), 96 * H);
  assert.equal(L.priceTtl({ UR: { count: 1 }, R: { count: 25 } }), 96 * H);
  assert.equal(L.priceTtl(undefined), 48 * H);
});

test('isFresh : respecte les deux durées', () => {
  const now = 1_000_000_000_000;
  assert.equal(L.isFresh(null, now), false);
  assert.equal(L.isFresh({ t: now - 47 * H, s: { UR: { count: 1 } } }, now), true);
  assert.equal(L.isFresh({ t: now - 49 * H, s: { UR: { count: 1 } } }, now), false);
  assert.equal(L.isFresh({ t: now - 49 * H, s: { UR: { count: 40 } } }, now), true);
  assert.equal(L.isFresh({ t: now - 97 * H, s: { UR: { count: 40 } } }, now), false);
  assert.equal(L.isFresh({ s: {} }, now), false);
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
  assert.match(L.friendlyError(0), /réseau/);
  assert.match(L.friendlyError(401), /Session expirée/);
  assert.match(L.friendlyError(429), /limite/);
  assert.match(L.friendlyError(503), /503/);
  assert.match(L.friendlyError(418), /418/);
});

test('parseAutoRule : normalise et refuse les valeurs invalides', () => {
  assert.deepEqual(L.parseAutoRule({ mode: 'outbid' }), { mode: 'outbid' });
  assert.deepEqual(L.parseAutoRule({ mode: 'outbid', cap: '120' }), { mode: 'outbid', cap: 120 });
  assert.deepEqual(L.parseAutoRule({ mode: 'time', amount: 30, unit: 's' }), { mode: 'time', secs: 30 });
  assert.deepEqual(L.parseAutoRule({ mode: 'time', amount: 2, unit: 'min', cap: 50 }), { mode: 'time', secs: 120, cap: 50 });
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 1, unit: 's' }).secs, 5); // plancher 5 s
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 99999, unit: 'min' }).secs, 6 * 3600);
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 0 }), null);
  assert.equal(L.parseAutoRule({ mode: 'time', amount: 'abc' }), null);
  assert.equal(L.parseAutoRule({ mode: 'x' }), null);
  assert.equal(L.parseAutoRule(), null);
});

test('autoLabel', () => {
  assert.equal(L.autoLabel({ mode: 'outbid' }), 'Auto · dès surenchère');
  assert.equal(L.autoLabel({ mode: 'time', secs: 30 }), 'Auto · à 30 s');
  assert.equal(L.autoLabel({ mode: 'time', secs: 300, cap: 80 }), 'Auto · à 5 min · max 80 W');
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
});
