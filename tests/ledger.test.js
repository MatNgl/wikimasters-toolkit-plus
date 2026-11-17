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
  // Survol d'une barre : infobulle avec le montant, la date, et le nombre de ventes / achats / reventes.
  assert.doesNotMatch(txt, /Une vente est rapprochée du plus ancien achat/, 'plus de paragraphe explicatif');
  assert.match(box.querySelector('.wmx-lg-info').getAttribute('title'), /rapproché/, 'l’explication est au survol du ⓘ');
  const hits = [...box.querySelectorAll('.wmx-lg-chart .hit')];
  hits.at(-1).dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 }));
  const tip = w.document.querySelector('.wmx-lg-tip');
  assert.ok(!tip.hidden, 'infobulle affichée');
  assert.match(tip.textContent, /\d+ ventes? · \d+ achats? · \d+ reventes?/);
  assert.match(tip.textContent, /plus-value réalisée/, 'le montant est nommé');
  assert.match(tip.textContent, /Flux net : /, 'le flux net (ventes − achats) est donné à côté');
  hits.at(-1).dispatchEvent(new w.MouseEvent('mouseleave', { bubbles: true }));
  box.querySelector('.wmx-lg-chart').dispatchEvent(new w.MouseEvent('mouseleave'));
  assert.ok(tip.hidden, 'cachée en quittant le graphique');
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

test('plus-values : moyenne au jour de l’achat lue dans la base (ventes des autres joueurs), colonnes Moyenne / Prix d’achat / Prix de vente ; infobulle par-dessus la page', async () => {
  const ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6ImFiYyJ9.signatureABC';
  const D = 24 * 3600000;
  const at = (days) => new Date(Date.now() - days * D).toISOString();
  const row = (id, title, rarity, price, days, role) => ({ id, card_id: `c-${title}`, seller_id: role === 'sell' ? ME : 'autre', winner_id: role === 'buy' ? ME : 'autre', status: 'settled_sold',
    final_price: price, settled_at: at(days), snapshot_rarity: rarity, is_shiny: false, card: { wikipedia_title: title, rarity, image_url: '', hide_image: false } });
  const mine = { buy: [row('b-Tours', 'Tours', 'L', 1500, 0.05, 'buy'), row('b-Gard', 'Gard', 'UR', 400, 0.04, 'buy')], sell: [row('s-Tours', 'Tours', 'L', 1900, 0.01, 'sell'), row('s-Tam', 'Tam', 'SR', 30, 0.01, 'sell')] };
  // Ventes d'autres joueurs avant les opérations : Tours (L) ~1 200 la semaine avant l'achat, Tam (SR) 25.
  const others = [row('o1', 'Tours', 'L', 1100, 1, 'x'), row('o2', 'Tours', 'L', 1200, 2, 'x'), row('o3', 'Tours', 'L', 1300, 3, 'x'), row('o4', 'Tam', 'SR', 25, 1, 'x')];
  const asked = [];
  const env = createEnv({ fetchImpl: async (u) => {
    const url = String(u);
    if (url.includes('/_next/')) return { ok: true, status: 200, text: async () => `var a="https://abcproj.supabase.co",b="${ANON}";` };
    if (url.includes('/rest/v1/auctions')) {
      if (url.includes(`winner_id=eq.${ME}`)) return json(mine.buy);
      if (url.includes(`seller_id=eq.${ME}`)) return json(mine.sell);
      asked.push(decodeURIComponent(url));
      return json([...others, ...mine.buy, ...mine.sell]);
    }
    return json({});
  } });
  const { w, WMX } = env;
  w.document.head.insertAdjacentHTML('beforeend', '<script src="https://www.wiki-masters.com/_next/static/chunks/app.js"></script>');
  w.document.cookie = 'sb-abcproj-auth-token=base64-' + Buffer.from(JSON.stringify({ access_token: 'jeton', user: { id: ME } })).toString('base64');
  await WMX.ledger.importAll(true);
  const r = await WMX.ledger.fillAverages();
  assert.equal(r.ok, true);
  assert.ok(asked.length >= 1 && asked.every((u) => /status=eq\.settled_sold/.test(u) && /or=\(and\(card_id\.eq\./.test(u)), 'ventes conclues des cartes concernées, sur une fenêtre de dates');
  const reg = await WMX.ledger.data();
  assert.deepEqual({ ...reg.buys['b-Tours'].avgAt }, { v: 1200, n: 3, w: 7 }, 'moyenne de la semaine avant l’achat (pas celle d’aujourd’hui)');
  assert.equal(reg.buys['b-Gard'].avgAt, null, 'aucune vente avant : pas de moyenne');
  assert.equal(reg.sells['s-Tam'].avgAt.v, 25);
  const box = w.document.createElement('div');
  w.document.body.append(box);
  await WMX.ledger.render(box);
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Mois').click(); // opérations de l'heure passée : visibles dans le mois
  await sleep(50);
  const heads = [...box.querySelectorAll('.wmx-lg-ops th')].map((th) => th.textContent.replace(/[▲▼↕]/g, '').trim());
  assert.deepEqual(heads.slice(3), ['Moyenne', 'Prix d’achat', 'Prix de vente', 'Plus-value', 'Détention']);
  const rowOf = (t) => [...box.querySelectorAll('.wmx-lg-ops tbody tr')].find((tr) => tr.textContent.includes(t));
  const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s/g, ' '));
  const resale = cells(rowOf('Tours'));
  assert.match(resale[3], /1 200 W/, 'Revente : moyenne au jour de l’achat');
  assert.match(resale[4], /1 500 W\s*\+25 % \/ moy\./, 'prix d’achat et écart à la moyenne');
  assert.match(resale[5], /1 900 W/);
  const buy = cells(rowOf('Gard'));
  assert.equal(buy[3], '—');
  assert.equal(buy[5], '', 'achat : prix de vente vide');
  const sell = cells(rowOf('Tam'));
  assert.match(sell[3], /25 W/);
  assert.equal(sell[4], 'non achetée');
  // Infobulle du graphique : dans <body>, en position fixe, jamais dans le bloc du graphique (pas de défilement créé).
  box.querySelectorAll('.wmx-lg-chart .hit')[0].dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 790 }));
  const tip = w.document.querySelector('.wmx-lg-tip');
  assert.equal(tip.parentElement, w.document.body);
  assert.ok(tip.classList.contains('wmx-floattip'));
  assert.ok(!box.querySelector('.wmx-lg-tip'));
  assert.ok(parseInt(tip.style.top, 10) < 790, 'près du bas de l’écran : au-dessus du curseur');
  await sleep(700);
  env.close();
});

test('plus-values : sans moyenne du jour (historique illisible), la moyenne actuelle du cache est montrée (≈ … actuelle) au lieu de « … » ; relevée au moment de l’achat si récente ; clic sur la carte : enchères avec leur identifiant', async () => {
  const env = createEnv({ fetchImpl: async (u) => {
    const s = String(u);
    if (/\/api\/marketplace\/cards\/[^/]+\/sales/.test(s)) return json({ error: 'pro_only' }, 400); // historique complet refusé
    return json({});
  } });
  const { w, WMX } = env;
  // Cache des moyennes : Tours (L) 1 300 W, relevée il y a 1 h.
  env.mem.priceCache = { 'c-Tours': { t: Date.now() - 3600000, s: { L: { average: 1300, count: 9, latest: 1250 } } }, 'c-Louis IX': { t: Date.now() - 3600000, s: { L: { average: 3000, count: 4, latest: 3100 } } } };
  await WMX.prices.load();
  const payload = { won: [won('a-old', 'Tours', 'L', 1500, 24 * 20), won('a-new', 'Louis IX', 'L', 2700, 1)], history: [sold('v-old', 'Tours', 'L', 1742, 24 * 19)], selling: [], bidding: [] };
  await WMX.ledger.ingest(payload);
  const reg = await WMX.ledger.data();
  assert.equal(reg.buys['a-new'].avgSeen.v, 3000, 'achat d’il y a 1 h : moyenne relevée à ce moment-là');
  assert.equal(reg.buys['a-old'].avgSeen, undefined, 'achat ancien : pas de relevé');
  await WMX.ledger.fillAverages(); // base introuvable, historique du jeu refusé : abandon après 5 échecs au plus (ici 1 carte)
  const box = w.document.createElement('div');
  w.document.body.append(box);
  await WMX.ledger.render(box);
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Achat-revente').click();
  await sleep(50);
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Mois').click();
  await sleep(50);
  // Revente ancienne : remonter jusqu'à son mois si besoin.
  for (let i = 0; i < 3 && !box.querySelector('.wmx-lg-ops tbody tr'); i++) { box.querySelector('.wmx-lg-arrow').click(); await sleep(50); }
  const tr = box.querySelector('.wmx-lg-ops tbody tr');
  assert.ok(tr, 'la revente est listée');
  const td = [...tr.querySelectorAll('td')];
  assert.match(td[3].textContent, /^≈ 1\s?300 W$/, 'moyenne actuelle (≈), sans mention « actuelle »');
  assert.match(td[3].title, /moyenne actuelle/, 'expliquée au survol');
  assert.doesNotMatch(box.querySelector('.wmx-lg-ops').textContent, /…/, 'plus de « … » qui ne partent jamais');
  assert.match(td[4].textContent, /\+15,4 % \/ moy\.$/);
  assert.match(box.querySelector('.wmx-lg-ops th[aria-sort] .wmx-lg-sort[title*="AU JOUR DE L’ACHAT"]')?.closest('th').textContent || '', /Moyenne/, 'survol du titre « Moyenne » : au jour de l’achat');
  // Clic sur la carte : l'enchère d'achat et celle de revente, identifiants et liens.
  tr.querySelector('.wmx-lg-card').click();
  const det = tr.nextElementSibling;
  assert.ok(det.classList.contains('wmx-lg-detail'));
  assert.match(det.textContent, /Achat.*1\s?500 W.*Enchère a-old/s);
  assert.match(det.textContent, /Revente.*1\s?742 W.*Enchère v-old/s);
  assert.deepEqual([...det.querySelectorAll('a')].map((a) => a.getAttribute('href')), ['/marketplace/a-old', '/marketplace/v-old']);
  tr.querySelector('.wmx-lg-card').click();
  assert.ok(!tr.nextElementSibling?.classList.contains('wmx-lg-detail'), 'second clic : repliée');
  // Cartes en stock : Louis IX, moyenne relevée à l'achat (3 000), sans « ≈ ».
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Tout').click();
  await sleep(50);
  const stockRow = [...box.querySelectorAll('.wmx-lg-stock tbody tr')].find((r) => r.textContent.includes('Louis IX'));
  assert.match(stockRow.querySelectorAll('td')[2].textContent, /^3\s?000 W$/);
  await sleep(700);
  env.close();
});

test('plus-values : tri par clic sur les colonnes (décroissant puis croissant, cases vides toujours en bas), dans les opérations et dans le stock', async () => {
  const env = createEnv({ fetchImpl: async () => json({}) });
  const { w, WMX } = env;
  const payload = {
    won: [won('b1', 'Alpha', 'R', 100, 3), won('b2', 'Bravo', 'R', 900, 2.5), won('b3', 'Charlie', 'R', 400, 2)],
    history: [sold('s1', 'Alpha', 'R', 300, 1), sold('s2', 'Zoulou', 'C', 50, 0.5)],
    selling: [], bidding: [],
  };
  await WMX.ledger.ingest(payload);
  const box = w.document.createElement('div');
  w.document.body.append(box);
  await WMX.ledger.render(box);
  [...box.querySelectorAll('.wmx-seg-btn')].find((b) => b.textContent === 'Mois').click();
  await sleep(50);
  const names = (sel) => [...box.querySelectorAll(`${sel} tbody tr .wmx-lg-name b`)].map((b) => b.textContent);
  const sortBy = (sel, label) => [...box.querySelectorAll(`${sel} th .wmx-lg-sort`)].find((b) => b.textContent.replace(/[▲▼↕]/g, '').trim() === label).click();
  assert.deepEqual(names('.wmx-lg-ops'), ['Zoulou', 'Alpha', 'Charlie', 'Bravo', 'Alpha'], 'par défaut : les plus récentes d’abord');
  sortBy('.wmx-lg-ops', 'Prix d’achat');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-ops'), ['Bravo', 'Charlie', 'Alpha', 'Alpha', 'Zoulou'], 'plus gros prix d’achat d’abord ; la vente non achetée (vide) en bas');
  assert.equal(box.querySelector('.wmx-lg-ops th.on').getAttribute('aria-sort'), 'descending');
  sortBy('.wmx-lg-ops', 'Prix d’achat');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-ops').slice(0, 3), ['Alpha', 'Alpha', 'Charlie'], 'second clic : croissant');
  assert.equal(names('.wmx-lg-ops').at(-1), 'Zoulou', 'case vide toujours en bas');
  assert.ok(box.querySelector('.wmx-lg-ops th.on .wmx-lg-sorti.asc svg'), 'icône « croissant »');
  sortBy('.wmx-lg-ops', 'Prix d’achat');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-ops'), ['Zoulou', 'Alpha', 'Charlie', 'Bravo', 'Alpha'], 'troisième clic : retour à l’ordre normal');
  assert.ok(!box.querySelector('.wmx-lg-ops th.on'), 'plus aucune colonne triée');
  assert.ok(box.querySelector('.wmx-lg-ops .wmx-lg-sorti.none svg'), 'icône neutre');
  sortBy('.wmx-lg-ops', 'Prix de vente');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-ops').slice(0, 2), ['Alpha', 'Zoulou'], 'plus grosses ventes d’abord (achats sans vente en bas)');
  sortBy('.wmx-lg-ops', 'Carte');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-ops'), ['Zoulou', 'Charlie', 'Bravo', 'Alpha', 'Alpha'], 'carte, 1er clic : décroissant (Z à A)');
  sortBy('.wmx-lg-ops', 'Carte');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-ops'), ['Alpha', 'Alpha', 'Bravo', 'Charlie', 'Zoulou'], '2e clic : de A à Z');
  // Stock : Bravo et Charlie, triables aussi.
  sortBy('.wmx-lg-stock', 'Prix d’achat');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-stock'), ['Bravo', 'Charlie']);
  sortBy('.wmx-lg-stock', 'Prix d’achat');
  await sleep(50);
  assert.deepEqual(names('.wmx-lg-stock'), ['Charlie', 'Bravo']);
  await sleep(700);
  env.close();
});
