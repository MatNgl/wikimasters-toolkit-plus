// Plus-values : registre des achats et des ventes (ledger.js) et onglet « Plus-values » du tableau de bord.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const ME = 'me-1';
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const card = (title, rarity, extra = {}) => ({ id: `c-${title}`, wikipedia_title: title, rarity, image_url: `https://img/${title}.jpg`, is_shiny: false, ...extra });
const won = (id, title, rarity, price, h) => ({ id, card_id: `c-${title}`, winner_id: ME, seller_id: 'autre', status: 'settled_sold', final_price: price, settled_at: iso(h), snapshot_rarity: rarity, is_shiny: false, card: card(title, rarity) });
const sold = (id, title, rarity, price, h) => ({ id, card_id: `c-${title}`, seller_id: ME, winner_id: 'autre', status: 'settled_sold', final_price: price, settled_at: iso(h), snapshot_rarity: rarity, is_shiny: false, card: card(title, rarity) });

test('plus-values : achats et ventes notés une seule fois (jamais ceux d’un autre joueur), reventes rapprochées, onglet affiché', async () => {
  const payload = {
    won: [won('a1', 'Tours', 'L', 1500, 3), won('a2', 'Louis IX', 'L', 2700, 2), { ...won('x', 'Autre', 'C', 5, 1), winner_id: 'quelqu-un' }],
    history: [sold('v1', 'Tours', 'L', 1742, 1), sold('v2', 'Tam Sir', 'SR', 3, 0.5), { ...sold('v3', 'Invendue', 'C', 4, 0.2), status: 'settled_unsold' }],
    selling: [], bidding: [],
  };
  const env = createEnv({ fetchImpl: async () => json(payload) });
  const { w, WMX } = env;
  assert.equal(await WMX.ledger.ingest(payload), 4, '2 achats + 2 ventes (pas l’achat d’un autre, pas l’invendue)');
  assert.equal(await WMX.ledger.ingest(payload), 0, 'déjà notés : rien de plus');
  const reg = await WMX.ledger.data();
  assert.deepEqual(Object.keys(reg.buys).sort(), ['a1', 'a2']);
  assert.deepEqual(Object.keys(reg.sells).sort(), ['v1', 'v2']);
  const box = w.document.createElement('div');
  w.document.body.append(box);
  await WMX.ledger.render(box);
  const txt = box.textContent;
  assert.match(txt, /plus-value réalisée\s*\+242 W sur 1 revente/, 'Tours : acheté 1 500, revendu 1 742');
  assert.match(txt, /Revente/);
  assert.match(txt, /non achetée/, 'Tam Sir : carte tirée, vendue');
  assert.match(txt, /Cartes achetées en stock/);
  assert.match(txt, /Louis IX/, 'Louis IX reste en stock');
  assert.ok(box.querySelector('.wmx-lg-chart'), 'graphique des plus-values');
  assert.ok(box.querySelector('.wmx-lg-thumb img'), 'images des cartes');
  // Mode « Achat-revente » : seulement les reventes.
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Achat-revente').click();
  await sleep(50);
  assert.match(box.textContent, /Reventes/);
  assert.doesNotMatch(box.querySelector('.wmx-lg-ops').textContent, /Tam Sir/, 'la carte tirée n’est pas une revente');
  // Vue « Mois » : même plus-value sur la période.
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Mois').click();
  await sleep(50);
  assert.match(box.querySelector('.wmx-lg-kpis').textContent, /\+242 W/);
  await sleep(700); // écriture du registre
  env.close();
});

test('plus-values : historique complet lu dans la base du jeu (clé publique du site + session du joueur), en lecture seule, sans doublon', async () => {
  const ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6ImFiYyJ9.signatureABC';
  const asked = [];
  const old = (title, rarity, price, days, role) => ({ id: `${role}-${title}`, card_id: `c-${title}`, seller_id: role === 'sell' ? ME : 'autre', winner_id: role === 'buy' ? ME : 'autre', status: 'settled_sold',
    final_price: price, settled_at: iso(days * 24), snapshot_rarity: rarity, is_shiny: false, card: { wikipedia_title: title, rarity, image_url: '', hide_image: false } });
  const buys = [old('Ancienne', 'L', 1000, 20, 'buy'), old('Tours', 'L', 1500, 0.2, 'buy')];
  const sells = [old('Ancienne', 'L', 1400, 18, 'sell')];
  const env = createEnv({ fetchImpl: async (u, opts = {}) => {
    const url = String(u);
    if (url.includes('/_next/')) return { ok: true, status: 200, text: async () => `var a="https://abcproj.supabase.co",b="${ANON}";` };
    if (url.includes('/rest/v1/auctions')) {
      asked.push({ url, auth: opts.headers?.Authorization, apikey: opts.headers?.apikey, method: opts.method || 'GET' });
      const rows = url.includes(`winner_id=eq.${ME}`) ? buys : url.includes(`seller_id=eq.${ME}`) ? sells : [];
      return json(rows);
    }
    return json({});
  } });
  const { w, WMX } = env;
  w.document.head.insertAdjacentHTML('beforeend', '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>');
  w.document.cookie = 'sb-abcproj-auth-token=base64-' + Buffer.from(JSON.stringify({ access_token: 'jeton-de-session', user: { id: ME } })).toString('base64');
  // Une ligne déjà notée par la méthode des 50 dernières : pas de doublon.
  await WMX.ledger.ingest({ won: [{ ...won('buy-Tours', 'Tours', 'L', 1500, 0.2) }], history: [] });
  const r = await WMX.ledger.importAll(true);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.total, 3);
  assert.equal(r.added, 2, 'Tours était déjà là');
  assert.ok(asked.every((x) => x.method === 'GET'), 'lecture seule');
  assert.ok(asked.every((x) => x.auth === 'Bearer jeton-de-session' && x.apikey === ANON), 'clé publique du site et session du joueur');
  assert.ok(asked.every((x) => /status=eq\.settled_sold/.test(x.url)), 'seulement les enchères conclues');
  const reg = await WMX.ledger.data();
  assert.equal(Object.keys(reg.buys).length, 2);
  assert.equal(Object.keys(reg.sells).length, 1);
  const box = w.document.createElement('div');
  w.document.body.append(box);
  await WMX.ledger.render(box);
  assert.match(box.textContent, /Historique complet lu dans la base du jeu \(3 enchères conclues/);
  assert.match(box.textContent, /plus-value réalisée\s*\+400 W sur 1 revente/, 'Ancienne : achetée 1 000 il y a 20 jours, revendue 1 400');
  assert.ok(!JSON.stringify(env.mem).includes('jeton-de-session'), 'la session n’est jamais enregistrée');
  await sleep(700);
  env.close();
});
