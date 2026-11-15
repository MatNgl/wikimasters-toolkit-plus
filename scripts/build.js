// Version publiable : copie l'extension dans dist/ (le dossier à charger dans chrome://extensions : manifest.json à sa racine), sans les
// outils de développement (rechargement automatique, permission « alarms », version_name), et crée release/wikimasters-toolkit-plus-<version>.zip
// pour le Chrome Web Store, et release/wikimasters-toolkit-plus-<version>-firefox.zip pour addons.mozilla.org (même contenu, avec
// l'identifiant Firefox de l'extension et la déclaration de collecte de données exigés par Mozilla).
// Usage : node scripts/build.js [version]
// UN SEUL numéro de version : celui de manifest.json. La version de développement et celle du store portent le même numéro (le ZIP construit
// s'appelle comme la version chargée en développement). Chaque modification monte ce numéro d'un cran dans manifest.json (le rechargement
// automatique de la version de développement en dépend) ; le store accepte des numéros qui sautent, tant qu'ils montent.
// Un numéro donné en argument remplace celui du manifest (cas exceptionnel). Les anciens ZIP de release/ sont supprimés.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const version = process.argv[2] || JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
const pkg = path.join(root, 'dist');
const out = path.join(root, 'release');

const SKIP = new Set(['src/background.js']);
const files = [];
const walk = (rel) => {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel + '/' + e.name;
    if (e.isDirectory()) walk(r);
    else if (!SKIP.has(r)) files.push(r);
  }
};
walk('src');
walk('icons');

// fs.rmSync ne supprime rien, sans erreur, sous Windows avec Node 24.2 quand le chemin contient un caractère accentué (« Matthéo ») :
// suppression faite à la main (unlink / rmdir), qui marche partout.
function removeAll(p) {
  if (!fs.existsSync(p)) return;
  if (fs.lstatSync(p).isDirectory()) { for (const e of fs.readdirSync(p)) removeAll(path.join(p, e)); fs.rmdirSync(p); } else fs.unlinkSync(p);
}
removeAll(pkg);
if (fs.existsSync(pkg)) { console.error('Impossible de vider dist/'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const removed = [];
for (const old of fs.readdirSync(out)) {
  if (!/^wikimasters-toolkit-plus-.*\.zip$/.test(old)) continue;
  try { removeAll(path.join(out, old)); removed.push(old); } catch (e) { console.warn(`Ancien ZIP non supprimé (${e.code}) : ${old}`); }
}
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(pkg, f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(pkg, f));
}

const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
m.version = version;
delete m.version_name;
delete m.background;
m.permissions = (m.permissions || []).filter((p) => p !== 'alarms');
fs.writeFileSync(path.join(pkg, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
for (const f of ['LICENSE']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(pkg, f));

// Vérifie que chaque fichier cité dans le manifest existe bien dans le paquet.
const cited = [...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]), m.action?.default_popup, ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})].filter(Boolean);
const missing = cited.filter((f) => !fs.existsSync(path.join(pkg, f)));
if (missing.length) { console.error('Fichiers manquants :', missing); process.exit(1); }

// --- ZIP minimal (méthode « deflate »), sans dépendance ---
// Firefox : identifiant fixe (ne JAMAIS le changer : c'est lui qui relie les versions entre elles sur addons.mozilla.org), Firefox 140 au
// minimum (scripts dans la page « world: MAIN » et déclaration de collecte de données), aucune donnée collectée.
const FIREFOX = { gecko: { id: 'wikimasters-toolkit-plus@matngl', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } };
const entries = [...files, 'manifest.json', ...(fs.existsSync(path.join(pkg, 'LICENSE')) ? ['LICENSE'] : [])].sort();
function writeZip(zip, manifest) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const name of entries) {
    const data = name === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') : fs.readFileSync(path.join(pkg, name));
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdSize = central.reduce((n, x) => n + x.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zip, Buffer.concat([...chunks, ...central, end]));
  console.log(`${entries.length} fichiers, ${(fs.statSync(zip).size / 1024).toFixed(0)} Ko -> ${path.relative(root, zip)}`);
}
const zip = path.join(out, `wikimasters-toolkit-plus-${version}.zip`);
const zipFx = path.join(out, `wikimasters-toolkit-plus-${version}-firefox.zip`);
writeZip(zip, m);
writeZip(zipFx, { ...m, browser_specific_settings: FIREFOX });
const built = new Set([path.basename(zip), path.basename(zipFx)]);
if (removed.filter((f) => !built.has(f)).length) console.log(`Anciens ZIP supprimés : ${removed.filter((f) => !built.has(f)).join(', ')}`);
const left = fs.readdirSync(out).filter((f) => /^wikimasters-toolkit-plus-.*\.zip$/.test(f) && !built.has(f));
if (left.length) { console.error(`Anciens ZIP encore présents : ${left.join(', ')}`); process.exit(1); }
