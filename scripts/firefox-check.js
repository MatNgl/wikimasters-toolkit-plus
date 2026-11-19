// Vérification dans un VRAI Firefox (sans compte ni jeu) des points où Firefox diffère de Chrome pour les scripts d'extension :
//  1. le verrou entre onglets WMX.lock (src/lib/namespace.js, le vrai fichier de l'extension) : attente, exclusivité, ifAvailable, steal,
//     erreur remontée, verrou tenu longtemps (onglet meneur). Sous Firefox, navigator.locks appelé directement échoue (« Permission denied
//     to access property "then" ») : c'est ce qui bloquait la file des mises en vente et les mises ;
//  2. la saisie d'un prix dans un formulaire d'un cadre de la page, comme la mise en vente (setter natif + événement « input », vu par une page
//     qui suit la valeur comme React) ;
//  3. une requête du script d'extension vers le site (GET et POST) : cookies et origine de la page envoyés.
// Usage : npm run check:firefox   (Firefox installé ; télécharge web-ext via npx la première fois). Ne touche à aucun autre Firefox ouvert.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const FIREFOX = process.env.FIREFOX || ['C:/Program Files/Mozilla Firefox/firefox.exe', '/usr/bin/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox'].find((p) => fs.existsSync(p));
if (!FIREFOX) { console.error('Firefox introuvable (variable FIREFOX pour donner son chemin)'); process.exit(2); }
const PORT = 8765;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmx-fx-'));
fs.copyFileSync(path.join(root, 'src/lib/namespace.js'), path.join(dir, 'namespace.js'));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'wmx-firefox-check', version: '1.0',
  host_permissions: [`http://127.0.0.1/*`],
  browser_specific_settings: { gecko: { id: 'wmx-firefox-check@local' } },
  content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['namespace.js', 'check.js'], run_at: 'document_idle' }],
}));
fs.writeFileSync(path.join(dir, 'check.js'), `(async () => {
  if (window.top !== window) return;
  const out = {};
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const t0 = Date.now();
  try { out.result = JSON.stringify(await WMX.lock('t1', async () => { await wait(300); return { v: 42 }; })); out.waited = Date.now() - t0 >= 290; } catch (e) { out.resultErr = String(e); }
  try {
    const order = [];
    const a = WMX.lock('t2', async () => { order.push('a1'); await wait(250); order.push('a2'); return 1; });
    const b = WMX.lock('t2', async () => { order.push('b'); return 2; });
    out.both = JSON.stringify(await Promise.all([a, b])); out.order = order.join(',');
  } catch (e) { out.orderErr = String(e); }
  try {
    let inner = null;
    await WMX.lock('t3', async () => { inner = await WMX.lock('t3', { ifAvailable: true }, async (l) => (l ? 'got' : 'none')); });
    out.ifAvailHeld = inner; out.ifAvailFree = await WMX.lock('t3', { ifAvailable: true }, async (l) => (l ? 'got' : 'none'));
  } catch (e) { out.ifAvailErr = String(e); }
  try { await WMX.lock('t4', async () => { throw new Error('boom'); }); out.thrown = 'non'; } catch (e) { out.thrown = String(e.message); }
  try {
    let held = false; let stolen = '';
    WMX.lock('t5', () => new Promise(() => { held = true; })).catch((e) => { stolen = e.name; });
    await wait(150);
    out.leaderHeld = held; out.leaderOther = await WMX.lock('t5', { ifAvailable: true }, async (l) => (l ? 'got' : 'none'));
    out.steal = await WMX.lock('t5', { steal: true }, async () => 'stolen'); await wait(100); out.stolenName = stolen;
  } catch (e) { out.leaderErr = String(e); }
  try {
    const f = document.querySelector('iframe');
    await new Promise((ok) => { if (f.contentDocument?.readyState === 'complete' && f.contentDocument.querySelector('input')) ok(); else f.addEventListener('load', ok); });
    const d = f.contentDocument; const w = f.contentWindow; const input = d.querySelector('input');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, '137');
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await wait(100);
    out.frameInput = d.documentElement.dataset.seen || 'rien'; out.frameValue = input.value;
    d.querySelector('button').click(); await wait(50); out.frameClick = d.documentElement.dataset.clicked || 'non';
  } catch (e) { out.frameErr = String(e); }
  // Vue étendue : localStorage partagé avec la page (lu par page-hook.js) et aller-retour d'événements page → extension → page (chaînes JSON).
  try {
    localStorage.setItem('wmxCheck', 'on');
    window.addEventListener('wmx:ask', (e) => { const d = JSON.parse(String(e.detail)); window.dispatchEvent(new CustomEvent('wmx:answer', { detail: JSON.stringify({ id: d.id, body: 'ok-' + d.id }) })); });
    window.dispatchEvent(new CustomEvent('wmx:go'));
    await wait(300);
    out.pageSawStorage = document.documentElement.dataset.ls || 'rien';
    out.roundTrip = document.documentElement.dataset.rt || 'rien';
  } catch (e) { out.bridgeErr = String(e); }
  try { out.get = await (await fetch('/echo')).text(); out.post = await (await fetch('/echo', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).text(); } catch (e) { out.fetchErr = String(e); }
  await fetch('/report', { method: 'POST', body: JSON.stringify(out) });
})();`);

// Page de test : un cadre dont le champ suit sa valeur comme React (propriété « value » posée sur l'élément, changement vu à l'événement input).
const FRAME = `<!doctype html><input type="number" value="5"><button>Lancer</button><script>
  const i = document.querySelector('input'); let tracked = i.value;
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(i, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { tracked = String(v); desc.set.call(this, v); } });
  document.addEventListener('input', () => { if (i.value !== tracked) { tracked = i.value; document.documentElement.dataset.seen = 'change:' + i.value; } });
  document.querySelector('button').addEventListener('click', () => { document.documentElement.dataset.clicked = 'oui'; });
</script>`;
let child = null;
const finish = (code, msg) => {
  console.log(msg);
  try { if (child?.pid) execSync(process.platform === 'win32' ? `taskkill /PID ${child.pid} /T /F` : `kill -9 -${child.pid}`, { stdio: 'ignore' }); } catch (_) { /* déjà arrêté */ }
  server.close();
  process.exit(code);
};
const server = http.createServer((req, res) => {
  if (req.url === '/report') {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.end('ok');
      const r = JSON.parse(b);
      const get = JSON.parse(r.get || '{}'); const post = JSON.parse(r.post || '{}');
      const checks = [
        ['verrou : résultat rendu après l’attente', r.result === '{"v":42}' && r.waited],
        ['verrou : exclusivité (la 2e demande attend la 1re)', r.order === 'a1,a2,b' && r.both === '[1,2]'],
        ['verrou : ifAvailable (pris / libre)', r.ifAvailHeld === 'none' && r.ifAvailFree === 'got'],
        ['verrou : erreur de la fonction remontée', r.thrown === 'boom'],
        ['verrou : tenu longtemps (onglet meneur), puis pris avec steal', r.leaderHeld === true && r.leaderOther === 'none' && r.steal === 'stolen' && r.stolenName === 'AbortError'],
        ['cadre : prix saisi et vu par la page (comme React)', r.frameInput === 'change:137' && r.frameValue === '137'],
        ['cadre : clic sur un bouton', r.frameClick === 'oui'],
        ['vue étendue : localStorage commun à l’extension et à la page', r.pageSawStorage === 'on'],
        ['vue étendue : question de la page, réponse de l’extension (événements)', r.roundTrip === 'ok-7'],
        ['requête GET : cookies de la page', get.cookie === 'sess=abc'],
        ['requête POST : cookies et origine de la page', post.cookie === 'sess=abc' && post.origin === `http://127.0.0.1:${PORT}`],
      ];
      for (const [label, ok] of checks) console.log(`${ok ? 'OK  ' : 'ÉCHEC'}  ${label}`);
      const bad = checks.filter(([, ok]) => !ok).length;
      if (bad) console.log('Détail :', b);
      finish(bad ? 1 : 0, bad ? `${bad} vérification(s) en échec sous Firefox` : 'Firefox : tout est bon');
    });
    return;
  }
  if (req.url === '/echo') { res.end(JSON.stringify({ method: req.method, cookie: req.headers.cookie || null, origin: req.headers.origin || null })); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (req.url === '/frame') { res.end(FRAME); return; }
  res.setHeader('set-cookie', 'sess=abc; Path=/');
  // Script de la page (comme page-hook.js) : lit le localStorage écrit par l'extension et lui pose une question par événement.
  res.end('<!doctype html><meta charset="utf-8"><title>wmx</title><iframe src="/frame"></iframe><script>window.addEventListener("wmx:answer", (e) => { document.documentElement.dataset.rt = JSON.parse(String(e.detail)).body; }); window.addEventListener("wmx:go", () => { document.documentElement.dataset.ls = localStorage.getItem("wmxCheck") || "rien"; window.dispatchEvent(new CustomEvent("wmx:ask", { detail: JSON.stringify({ id: 7 }) })); });</script>');
});
server.listen(PORT, '127.0.0.1', () => {
  const q = (s) => `"${s}"`; // chemins avec espaces (« Program Files »)
  const cmd = `npx --yes web-ext@8 run --source-dir ${q(dir)} --firefox ${q(FIREFOX)} --start-url ${q(`http://127.0.0.1:${PORT}/`)} --no-reload --no-input --arg=-headless`;
  child = spawn(cmd, { stdio: 'ignore', shell: true, detached: process.platform !== 'win32' });
});
setTimeout(() => finish(1, 'Pas de réponse de Firefox en 120 s'), 120000);
