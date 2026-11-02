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
  pick('Juste avant la fin').click();
  const amount = w.document.querySelector('.wmx-auc-auto .wmx-auc-num');
  amount.value = '45';
  amount.dispatchEvent(new w.Event('input', { bubbles: true }));
  pick('Selon la moyenne').click();
  pick('+30 %').click();
  assert.match(w.document.querySelector('.wmx-auc-preview').textContent, /[Mm]oyenne|Plafond/);
  w.document.querySelector('.wmx-auc-auto .wmx-btn:not(.wmx-btn--ghost)').click();
  await sleep(50);
  assert.match(w.document.querySelector('.wmx-auc-autotag').textContent, /Auto · à 45 s · max moy\. \+30 %/);
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
function fakeBidPages(w, min) {
  const { JSDOM } = require('jsdom');
  const clicks = [];
  const orig = w.document.createElement.bind(w.document);
  w.document.createElement = (tag, ...rest) => {
    const n = orig(tag, ...rest);
    if (String(tag).toLowerCase() === 'iframe') {
      const d = new JSDOM(`<body><input aria-label="Montant de la mise" type="number" min="${min}"><button>Miser</button></body>`).window.document;
      d.querySelector('button').addEventListener('click', () => clicks.push(d.querySelector('input').value));
      Object.defineProperty(n, 'contentDocument', { get: () => d });
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
  assert.equal(r2.env.mem.autoBids.b4, undefined, 'la règle est supprimée');
  r2.env.close();
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
  assert.equal(btn.textContent, 'Miser le minimum');
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
  assert.match(btns[1].textContent, /file d’attente/);
  assert.match(btns[2].textContent, /file d’attente/);
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
  env.close();
});
