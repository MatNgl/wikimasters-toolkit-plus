// Vue étendue de la Collection : la page du jeu est servie depuis la copie (collection-view.js + relais de page-hook.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEnv, ROOT } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } });
const RAR = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
const TAG = { id: 'tag-vente', name: 'VENTE', color: '#f00', user_id: 'me', created_at: '2026-10-01T00:00:00Z' };
/** Carte de la copie (format d'inventory.js, version 3 avec la ligne entière). */
function item(i, extra = {}) {
  const rarity = RAR[i % 6];
  return { id: `row-${i}`, card_id: `card-${i}`, title: `Carte ${String(i).padStart(3, '0')}`, rarity, image: `https://img/${i}.jpg`, lang: 'fr', count: 1, starred: i % 50 === 0,
    at: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(), tags: i % 10 === 0 ? [{ ...TAG }] : [],
    x: { cat: i === 7 ? 'Footballeur français' : `catégorie ${i}`, rr: rarity, atk: 10, def: 20, qs: 1, pv: 100, cc: '2026-01-01', wu: 'https://fr.wikipedia.org/wiki/x', hide: false, img: `https://img/${i}.jpg`, uid: 'me', sh: false }, ...extra };
}
function setup(n = 250, prefs = { on: true, size: 100, price: false }, fetchImpl = async () => json({ collection: [] })) {
  const env = createEnv({ fetchImpl });
  env.mem.invCacheV2 = { t: Date.now(), complete: true, v: 3, items: Array.from({ length: n }, (_, i) => item(i)) };
  env.mem.collView = prefs;
  // Moyennes : la carte n°i vaut i W (les plus récentes sont donc les plus chères), sauf la n°3, sans moyenne.
  env.mem.priceCache = Object.fromEntries(Array.from({ length: n }, (_, i) => [`card-${i}`, { t: Date.now(), s: i === 3 ? {} : { [RAR[i % 6]]: { average: i, count: 3, latest: i } } }]));
  return env;
}
const init = async (env) => { await env.WMX.inventory.ensure(); await env.WMX.prices.load(); await env.WMX.features.find((f) => f.name === 'collection-view').init(); };
const list = (env, q) => JSON.parse(env.WMX.collView.serve('list', `/api/my-collection?${q}`));
const stats = (env, q, real = { totalUnique: null, rarityCounts: {}, tagOptions: [TAG] }) => JSON.parse(env.WMX.collView.serve('stats', `/api/my-collection/stats?${q}`, real));

test('vue étendue : pages de 100 cartes, nombre de pages juste pour le jeu (qui compte par 50), tris du jeu, filtres et recherche depuis la copie', async () => {
  const env = setup();
  await init(env);
  const st = stats(env, 'sort=rarity');
  assert.equal(st.total, 150, '250 cartes en pages de 100 = 3 pages ; le jeu calcule total / 50 = 3');
  assert.equal(st.tagOptions[0].name, 'VENTE', 'les étiquettes et leurs nombres viennent du jeu');
  assert.equal(st.rarityCounts.L, 42, 'nombre de cartes par rareté (comme le jeu)');
  const p0 = list(env, 'sort=rarity&page=0&stats=0');
  assert.equal(p0.collection.length, 100);
  assert.equal(list(env, 'sort=rarity&page=2&stats=0').collection.length, 50, 'dernière page : le reste');
  assert.ok(p0.collection.slice(0, 42).every((r) => r.card.rarity === 'L'), 'tri « Rareté » : légendaires d’abord');
  assert.ok(p0.collection[0].obtained_at > p0.collection[1].obtained_at, 'puis les plus récentes');
  // Ligne identique à celle du jeu (ce que la page affiche).
  const r = p0.collection[0];
  assert.deepEqual(Object.keys(r).sort(), ['card', 'card_id', 'count', 'id', 'is_shiny', 'obtained_at', 'starred', 'tags', 'user_id']);
  assert.deepEqual(Object.keys(r.card).sort(), ['atk', 'category', 'created_at', 'def', 'hide_image', 'id', 'image_url', 'lang', 'pageviews', 'q_score', 'rarity', 'wikipedia_title', 'wikipedia_url']);
  // Filtres du jeu : raretés multiples, étiquette, sans étiquette, recherche titre ou catégorie (sans accents ni majuscules).
  assert.ok(list(env, 'sort=rarity&rarity=UR&rarity=SR&page=0&stats=0').collection.every((x) => ['UR', 'SR'].includes(x.card.rarity)));
  assert.equal(stats(env, 'sort=rarity&rarity=UR&rarity=SR').total, 50, '84 cartes UR + SR : 1 page');
  assert.equal(stats(env, 'sort=rarity&rarity=UR').rarityCounts.L, 42, 'les nombres par rareté ignorent le filtre de rareté (comme le jeu)');
  assert.equal(list(env, `sort=name&tag_id=${TAG.id}&page=0&stats=0`).collection.length, 25);
  assert.equal(list(env, 'sort=name&untagged=1&page=0&stats=0').collection.every((x) => !x.tags.length), true);
  assert.deepEqual(list(env, 'sort=rarity&q=FOOTBALLEUR%20FRANCAIS&page=0&stats=0').collection.map((x) => x.card.wikipedia_title), ['Carte 007']);
  assert.equal(list(env, 'sort=name&page=0&stats=0').collection[0].card.wikipedia_title, 'Carte 000', 'tri « Nom »');
  assert.ok(list(env, 'sort=starred&page=0&stats=0').collection.slice(0, 5).every((x) => x.starred), 'tri « Favoris »');
  assert.equal(list(env, 'sort=added&page=0&stats=0').collection[0].id, 'row-249', 'tri « Date d’ajout »');
  assert.equal(env.WMX.collView.serve('list', '/api/my-collection?sort=name&page=0&stats=1'), null, 'lecture avec nombres : laissée au jeu');
  env.close();
});

test('vue étendue : tri « Moyenne (plus chères) » sur toute la collection, cartes sans moyenne à la fin ; désactivée : rien n’est servi', async () => {
  const env = setup(250, { on: true, size: 50, price: true });
  await init(env);
  assert.equal(stats(env, 'sort=rarity').total, 250, 'pages de 50 : le vrai total');
  const p0 = list(env, 'sort=rarity&page=0&stats=0').collection;
  assert.deepEqual(p0.slice(0, 3).map((x) => x.card_id), ['card-249', 'card-248', 'card-247'], 'les plus chères d’abord, toutes raretés');
  const last = list(env, 'sort=rarity&page=4&stats=0').collection;
  assert.equal(last.at(-1).card_id, 'card-3', 'carte sans moyenne : à la fin');
  env.WMX.collView.setPrice(false);
  stats(env, 'sort=rarity');
  assert.equal(list(env, 'sort=rarity&page=0&stats=0').collection[0].card.rarity, 'L', 'tri du jeu revenu');
  env.WMX.collView.setOn(false);
  assert.equal(env.WMX.collView.serve('list', '/api/my-collection?sort=rarity&page=0&stats=0'), null, 'vue désactivée : la page du jeu demande au serveur');
  await sleep(20);
  assert.equal(env.mem.collView.on, false);
  env.close();
});

test('vue étendue : relais de page-hook.js — la page du jeu reçoit 100 cartes sans requête au serveur ; nombres des étiquettes demandés au jeu ; autres usages jamais servis', async () => {
  const asked = [];
  const env = setup(250, { on: true, size: 100, price: false }, async (u) => { asked.push(String(u)); return String(u).includes('/stats?') ? json({ total: 250, totalUnique: null, rarityCounts: {}, tagOptions: [TAG] }) : json({ collection: [{ id: 'serveur' }] }); });
  const { w } = env;
  await init(env);
  // jsdom n'a pas Response (les navigateurs, si) : version minimale pour le relais.
  w.Response = class { constructor(body, o = {}) { this._b = String(body); this.status = o.status || 200; this.ok = this.status < 300; } async json() { return JSON.parse(this._b); } async text() { return this._b; } clone() { return this; } };
  w.eval(fs.readFileSync(path.join(ROOT, 'src/page-hook.js'), 'utf8'));
  assert.equal(w.localStorage.getItem('wmxCollView'), 'on', 'mode copié pour page-hook.js (lu dès le début du chargement)');
  w.dispatchEvent(new w.CustomEvent('wmx:coll-ready', { detail: JSON.stringify({ ok: true }) }));
  const before = asked.length;
  const s = await (await w.fetch('/api/my-collection/stats?sort=rarity')).json();
  assert.equal(s.total, 150);
  const l = await (await w.fetch('/api/my-collection?sort=rarity&page=1&stats=0')).json();
  assert.equal(l.collection.length, 100);
  assert.notEqual(l.collection[0].id, 'serveur');
  assert.equal(asked.slice(before).filter((u) => /\/api\/my-collection\?/.test(u) && !/sort=added/.test(u)).length, 0, 'la liste ne part pas au serveur');
  const friend = await (await w.fetch('/api/my-collection?owned_by=bob&page=0')).json();
  assert.equal(friend.collection[0].id, 'serveur', 'collection d’un ami : demandée au jeu');
  w.history.pushState({}, '', '/marketplace');
  const away = await (await w.fetch('/api/my-collection?sort=rarity&page=0&stats=0')).json();
  assert.equal(away.collection[0].id, 'serveur', 'hors de la page Collection : jamais servi');
  await sleep(150); // relais des réponses du jeu (écrit après coup)
  env.close();
});

test('vue étendue : défausse, favori et étiquettes envoyés par la page du jeu appliqués à la copie ; nouvelles cartes relues (paquets, achats)', async () => {
  const fresh = [{ id: 'row-new', card_id: 'card-new', count: 1, starred: false, user_id: 'me', is_shiny: false, obtained_at: '2026-11-19T10:00:00Z', tags: [],
    card: { id: 'card-new', wikipedia_title: 'Tirée à l’instant', rarity: 'L', category: 'nouvelle', image_url: '', lang: 'fr', hide_image: false } }];
  const env = setup(60, { on: true, size: 100, price: false }, async (u) => (/sort=added&page=0/.test(String(u)) ? json({ collection: [...fresh, ...Array.from({ length: 3 }, (_, i) => ({ id: `row-${59 - i}` }))], pendingTradeCardIds: ['row-5'] }) : json({ collection: [] })));
  const { w, WMX } = env;
  await init(env);
  const api = (detail) => w.dispatchEvent(new w.CustomEvent('wmx:api', { detail }));
  api({ url: '/api/user-cards/bulk-discard', method: 'POST', status: 200, data: { ok: true }, req: { card_ids: ['row-1', 'row-2'] } });
  await sleep(30);
  assert.equal(WMX.inventory.items().length, 58, 'défausse en lot : retirées de la copie');
  api({ url: 'https://abc.supabase.co/rest/v1/user_cards?id=in.(row-4,row-6)', method: 'PATCH', status: 204, data: null, req: { starred: true } });
  api({ url: 'https://abc.supabase.co/rest/v1/user_card_tags', method: 'POST', status: 201, data: null, req: [{ user_card_id: 'row-4', tag_id: TAG.id }] });
  api({ url: `https://abc.supabase.co/rest/v1/user_card_tags?user_card_id=eq.row-10&tag_id=eq.${TAG.id}`, method: 'DELETE', status: 204, data: null, req: null });
  await sleep(30);
  const byId = (id) => WMX.inventory.items().find((it) => it.id === id);
  assert.equal(byId('row-4').starred, true);
  assert.equal(byId('row-6').starred, true);
  assert.deepEqual([...byId('row-4').tags.map((t) => t.name)], ['VENTE'], 'étiquette posée');
  assert.equal(byId('row-10').tags.length, 0, 'étiquette retirée');
  api({ url: '/api/user-cards/bulk-discard', method: 'POST', status: 403, data: { code: 'automation_limit' }, req: { card_ids: ['row-8'] } });
  await sleep(30);
  assert.ok(byId('row-8'), 'défausse refusée par le jeu : la carte reste');
  await WMX.collView.sync(true);
  assert.ok(byId('row-new'), 'carte tirée à l’instant : ajoutée (tri « Date d’ajout » du jeu)');
  const p = JSON.parse(WMX.collView.serve('list', '/api/my-collection?sort=added&page=0&stats=0'));
  assert.equal(p.collection[0].card.wikipedia_title, 'Tirée à l’instant');
  assert.deepEqual([...p.pendingTradeCardIds], ['row-5'], 'cartes en échange : comme le jeu');
  env.close();
});

test('vue étendue : boutons dans la barre du jeu (même apparence que ses menus) ; activer, changer la taille et le tri par moyenne relancent la liste du jeu', async () => {
  const env = setup(120, { on: false, size: 100, price: false });
  const { w } = env;
  const main = w.document.createElement('main');
  main.innerHTML = `<div class="flex flex-col gap-3 md:flex-row"><input placeholder="Rechercher par titre ou catégorie..."><div class="flex w-full min-w-0 flex-row gap-2" id="bar">
    <div class="relative"><button aria-label="Filtrer par étiquette" class="native-btn">Toutes les étiquettes</button></div>
    <div class="relative"><button aria-label="Trier la collection" class="native-btn"><span>Rareté</span></button></div></div></div>
    <div id="chips">${RAR.map((r) => `<button>${r}</button>`).join('')}</div>`;
  w.document.body.append(main);
  const chipClicks = [];
  main.querySelectorAll('#chips button').forEach((b) => b.addEventListener('click', () => chipClicks.push(b.textContent)));
  await init(env);
  const tools = main.querySelector('#bar > .wmx-cv-tools');
  assert.ok(tools, 'boutons ajoutés à côté des menus du jeu');
  const [toggle, size] = tools.children;
  assert.ok(toggle.className.includes('native-btn'), 'même apparence que les menus du jeu');
  assert.equal(size.hidden, true, 'taille cachée tant que la vue est désactivée');
  assert.ok(!toggle.querySelector('.wmx-cv-dot') && toggle.querySelector('.wmx-logo'), 'seulement l’icône, sans voyant');
  assert.equal(toggle.classList.contains('wmx-cv-on'), false, 'désactivée : comme les autres menus');
  toggle.click();
  await sleep(350);
  assert.equal(env.mem.collView.on, true);
  assert.equal(w.localStorage.getItem('wmxCollView'), 'on');
  assert.deepEqual(chipClicks, ['L', 'L'], 'liste du jeu relancée (filtre coché puis décoché)');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(toggle.classList.contains('wmx-cv-on'), true, 'activée : contour vert');
  assert.equal(size.hidden, false);
  size.click();
  const opt = [...w.document.querySelectorAll('.wmx-cv-menu button')].find((b) => b.textContent === '500 cartes');
  opt.click();
  await sleep(350);
  assert.equal(env.mem.collView.size, 500);
  assert.match(size.textContent, /500 \/ page/);
  // Menu de tri du jeu ouvert : l'option « Moyenne (plus chères) » est ajoutée.
  const menu = w.document.createElement('ul');
  menu.innerHTML = ['Rareté', 'Nom', 'Favoris', 'Date d’ajout'].map((t, i) => `<li role="none"><button role="option" aria-selected="${i === 0}" class="${i === 0 ? 'sel' : 'off'}"><span>${t}</span></button></li>`).join('');
  w.document.body.append(menu);
  await sleep(150);
  const price = menu.querySelector('.wmx-cv-price');
  assert.ok(price, 'tri « Moyenne » ajouté au menu du jeu');
  assert.equal(price.textContent, 'Moyenne (plus chères)');
  price.click();
  await sleep(350);
  assert.equal(env.mem.collView.price, true);
  assert.equal(main.querySelector('[aria-label="Trier la collection"] span').textContent, 'Moyenne', 'le menu du jeu affiche « Moyenne »');
  env.close();
});

test('vue étendue : première activation avec une ancienne copie (sans lignes entières) — relecture complète, puis la vue s’annonce prête aussitôt', async () => {
  const row = (i) => ({ id: `r${i}`, card_id: `c${i}`, count: 1, starred: false, user_id: 'me', is_shiny: false, obtained_at: '2026-11-01T00:00:00Z', tags: [], card: { id: `c${i}`, wikipedia_title: `T${i}`, rarity: 'C', category: 'x', image_url: '', lang: 'fr', hide_image: false } });
  const env = createEnv({ fetchImpl: async (u) => {
    const p = Number(new URL(String(u), 'https://x').searchParams.get('page'));
    return json({ collection: /sort=name/.test(String(u)) && p === 0 ? [row(1), row(2)] : [] });
  } });
  const { w, WMX } = env;
  env.mem.invCacheV2 = { t: Date.now(), complete: true, items: [{ id: 'r1', card_id: 'c1', title: 'T1', rarity: 'C', image: '', lang: 'fr', count: 1, starred: false, at: '', tags: [] }] }; // ancienne copie (v2)
  env.mem.collView = { on: true, size: 100, price: false };
  const announced = [];
  w.addEventListener('wmx:coll-ready', (e) => announced.push(JSON.parse(e.detail).ok));
  await WMX.inventory.ensure();
  await WMX.features.find((f) => f.name === 'collection-view').init();
  assert.equal(WMX.inventory.extReady(), false, 'ancienne copie : pas de vue étendue');
  assert.equal(announced.at(-1), false);
  for (let i = 0; i < 40 && !WMX.inventory.extReady(); i++) await sleep(100);
  assert.equal(WMX.inventory.extReady(), true, 'relecture complète faite');
  await sleep(50);
  assert.equal(announced.at(-1), true, 'la vue s’annonce prête dès la fin de la relecture');
  assert.equal(env.mem.invCacheV2.v, 3, 'copie enregistrée en version 3');
  assert.equal(JSON.parse(WMX.collView.serve('list', '/api/my-collection?sort=rarity&page=0&stats=0')).collection.length, 2);
  env.close();
});

test('vue étendue : copie abîmée (bien moins de cartes que le jeu) jamais montrée — page du jeu le temps de la relecture complète ; deux chargements simultanés : un seul, le cache n’est jamais remplacé par des pages partielles', async () => {
  const env = setup(100, { on: true, size: 100, price: false });
  const { WMX } = env;
  // Deux modules demandent la copie en même temps : le second attend le même chargement (et voit la copie complète).
  const [a, b] = [WMX.inventory.ensure(), WMX.inventory.ensure()];
  assert.equal(a, b, 'même chargement');
  await b;
  assert.equal(WMX.inventory.items().length, 100);
  assert.equal(WMX.inventory.extReady(), true);
  await env.WMX.prices.load();
  await WMX.features.find((f) => f.name === 'collection-view').init();
  let reloads = 0;
  WMX.inventory.reload = () => { reloads += 1; };
  // Le jeu annonce 20 000 cartes, la copie en a 100 : rien n'est servi, relecture complète demandée.
  assert.equal(WMX.collView.serve('stats', '/api/my-collection/stats?sort=rarity', { total: 20000, tagOptions: [] }), null, 'nombres laissés au jeu');
  assert.equal(WMX.collView.serve('list', '/api/my-collection?sort=rarity&page=0&stats=0'), null, 'liste laissée au jeu');
  assert.equal(reloads, 1, 'relecture complète lancée');
  assert.equal(WMX.collView.state().stale, true);
  env.close();
});

test('actions de masse par lots de 100 (limite du jeu) : défausse de 250 cartes en 3 demandes, réponse unique additionnée, arrêt au premier refus ; favoris par lots ; 100 ou moins : demande telle quelle', async () => {
  const sent = [];
  let refuseAt = 0;
  const env = createEnv({ fetchImpl: async (u, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    sent.push({ url: String(u), n: body?.card_ids?.length ?? (String(u).match(/in\.%28([^%]*(%2C[^%]*)*)%29|in\.\(([^)]*)\)/) ? decodeURIComponent(String(u)).match(/in\.\(([^)]*)\)/)[1].split(',').length : null) });
    if (refuseAt && sent.length === refuseAt) return json({ error: 'Maximum 100 cartes par requête' }, 400);
    return /bulk-discard/.test(String(u)) ? json({ discarded: body.card_ids.length, reward: body.card_ids.length * 2 }) : json([], 200);
  } });
  const { w } = env;
  w.Response = class { constructor(b, o = {}) { this._b = String(b); this.status = o.status || 200; this.ok = this.status < 300; } async json() { return JSON.parse(this._b); } clone() { return this; } };
  w.eval(fs.readFileSync(path.join(ROOT, 'src/page-hook.js'), 'utf8'));
  const relayed = [];
  w.addEventListener('wmx:api', (e) => relayed.push(e.detail.req?.card_ids?.length));
  const ids = Array.from({ length: 250 }, (_, i) => `row-${i}`);
  const r = await w.fetch('/api/user-cards/bulk-discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ card_ids: ids }) });
  assert.deepEqual(sent.map((x) => x.n), [100, 100, 50], '3 demandes de 100 au plus');
  const j = await r.json();
  assert.equal(j.discarded, 250, 'nombres additionnés (la page affiche 250 cartes défaussées)');
  assert.equal(j.reward, 500);
  assert.deepEqual(relayed.filter(Boolean), [100, 100, 50], 'chaque lot relayé à l’extension (copie tenue à jour)');
  // Refus au 2e lot : la page reçoit le refus, le 3e ne part pas.
  sent.length = 0; refuseAt = 2;
  const r2 = await w.fetch('/api/user-cards/bulk-discard', { method: 'POST', body: JSON.stringify({ card_ids: ids }) });
  assert.equal(r2.status, 400);
  assert.equal(sent.length, 2, 'arrêt au premier refus');
  refuseAt = 0;
  // Favoris sur 250 cartes (écriture directe dans la base du jeu) : 3 demandes.
  sent.length = 0;
  await w.fetch(`https://abc.supabase.co/rest/v1/user_cards?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ starred: true }) });
  assert.deepEqual(sent.map((x) => x.n), [100, 100, 50]);
  // 100 cartes ou moins : la demande du jeu telle quelle.
  sent.length = 0;
  await w.fetch('/api/user-cards/bulk-discard', { method: 'POST', body: JSON.stringify({ card_ids: ids.slice(0, 100) }) });
  assert.deepEqual(sent.map((x) => x.n), [100]);
  await sleep(150);
  env.close();
});

test('étiquette sur plusieurs cartes : les cartes refusées par le jeu (en vente, vendues) sont ignorées, les autres étiquetées ; « N ajoutées » juste ; copie nettoyée ; autre erreur affichée', async () => {
  let real = null;
  const env = setup(250, undefined, async (u, init = {}) => (real && /supabase/.test(String(u)) ? real(u, init) : json({ collection: [] })));
  const { w, WMX } = env;
  await init(env);
  const gone = new Set(['row-5', 'row-120', 'row-121']); // plus dans la collection du jeu (en vente)
  const sent = [];
  let mode = 'rls';
  w.Response = class { constructor(b, o = {}) { this._b = b == null ? '' : String(b); this.status = o.status || 200; this.ok = this.status < 300; const h = o.headers || {}; this.headers = { get: (k) => h[k.toLowerCase()] ?? null }; } async json() { return JSON.parse(this._b); } async text() { return this._b; } clone() { return this; } };
  w.eval(fs.readFileSync(path.join(ROOT, 'src/page-hook.js'), 'utf8'));
  const res = (status, body, headers = {}) => new w.Response(body == null ? null : JSON.stringify(body), { status, headers });
  // Le relais de page-hook.js appelle la fetch d'origine : celle du test (base du jeu simulée).
  real = async (u, init = {}) => {
    const rows = JSON.parse(init.body);
    sent.push(rows.length);
    if (mode === 'jwt') return res(401, { code: 'PGRST301', message: 'JWT expired' });
    if (rows.some((r) => gone.has(r.user_card_id))) return res(403, { code: '42501', message: 'new row violates row-level security policy for table "user_card_tags"' });
    const added = rows.filter((r) => r.user_card_id !== 'row-10').length; // row-10 a déjà l'étiquette : ignorée par le jeu (sans doublon)
    return res(201, null, { 'content-range': `*/${added}` });
  };
  const relayed = [];
  w.addEventListener('wmx:api', (e) => { if (/user_card_tags/.test(e.detail.url)) relayed.push(...e.detail.req.map((r) => r.user_card_id)); });
  const rows = Array.from({ length: 200 }, (_, i) => ({ user_card_id: `row-${i}`, tag_id: TAG.id }));
  const r = await w.fetch('https://abc.supabase.co/rest/v1/user_card_tags?on_conflict=user_card_id%2Ctag_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,count=exact' }, body: JSON.stringify(rows) });
  assert.ok(r.ok, 'la page reçoit une réussite (pas « Impossible d’appliquer l’étiquette »)');
  assert.equal(r.headers.get('content-range'), '*/196', '200 cartes − 3 refusées − 1 déjà étiquetée = 196 ajoutées (la page affiche aussi les ignorées)');
  assert.ok(sent.length < 40, `peu de demandes (${sent.length})`);
  assert.equal(relayed.length, 197, 'seules les cartes acceptées sont relayées (copie : étiquette ajoutée à celles-là)');
  assert.ok(![...gone].some((id) => relayed.includes(id)));
  await sleep(20);
  const ids = new Set(WMX.inventory.items().map((it) => it.id));
  assert.ok(![...gone].some((id) => ids.has(id)), 'cartes refusées retirées de la copie de la vue étendue');
  assert.equal(ids.size, 247);
  assert.ok(WMX.inventory.items().find((it) => it.id === 'row-7').tags.some((t) => t.id === TAG.id), 'étiquette ajoutée dans la copie');
  // Autre erreur (session expirée) : la page la reçoit telle quelle, rien d'autre ne part.
  mode = 'jwt'; sent.length = 0;
  const r2 = await w.fetch('https://abc.supabase.co/rest/v1/user_card_tags', { method: 'POST', body: JSON.stringify(rows.slice(0, 50)) });
  assert.equal(r2.status, 401);
  assert.equal(sent.length, 1);
  env.close();
});

test('cartes en vente (réponse de « Mes enchères ») : retirées de la copie quand c’est sans ambiguïté', async () => {
  const env = setup(20);
  const { WMX } = env;
  await init(env);
  const dup = { ...WMX.inventory.items().find((it) => it.id === 'row-4'), id: 'row-4b' }; // deux exemplaires de la carte 4 : une seule en vente
  WMX.inventory.items().push(dup);
  const after = (iso) => new Date(Date.parse(iso) + 60000).toISOString();
  const it = (i) => WMX.inventory.items().find((x) => x.id === `row-${i}`);
  WMX.collView.listed([
    { card_id: 'card-2', snapshot_rarity: 'SR', status: 'active', created_at: after(it(2).at) },
    { card_id: 'card-4', snapshot_rarity: 'PC', status: 'active', created_at: after(it(4).at) },
    { card_id: 'card-9', snapshot_rarity: 'R', status: 'expired', created_at: after(it(9).at) },
    { card_id: 'card-11', snapshot_rarity: 'C', status: 'active', created_at: '2026-01-01T00:00:00Z' }, // mise en vente AVANT d'obtenir cet exemplaire
  ]);
  const ids = new Set(WMX.inventory.items().map((x) => x.id));
  assert.ok(!ids.has('row-2'), 'en vente : retirée');
  assert.ok(ids.has('row-4') && ids.has('row-4b'), 'un autre exemplaire gardé : copie laissée (relecture complète)');
  assert.ok(ids.has('row-9'), 'enchère terminée : rien');
  assert.ok(ids.has('row-11'), 'exemplaire obtenu après la mise en vente : gardé');
  env.close();
});

test('icône de l’extension : bouton « Vue étendue », entrée « WikiMasters+ » sous Paramètres, en-tête des Paramètres (dégradés uniques)', async () => {
  const env = setup(10, { on: false, size: 100, price: false });
  const { w, WMX } = env;
  const main = w.document.createElement('main');
  main.innerHTML = '<div><input placeholder="Rechercher"><div id="bar"><div><button aria-label="Filtrer par étiquette">x</button></div><div><button aria-label="Trier la collection"><span>Rareté</span></button></div></div></div>';
  w.document.body.append(main);
  await init(env);
  assert.ok(main.querySelector('.wmx-cv-toggle .wmx-logo svg'), 'icône sur « Vue étendue »');
  WMX.openSettings();
  assert.ok(w.document.querySelector('.wmx-modal .wmx-set-title .wmx-logo svg'), 'icône dans l’en-tête des Paramètres');
  const ids = [...w.document.querySelectorAll('.wmx-logo linearGradient')].map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants de dégradé uniques');
  env.close();
});
