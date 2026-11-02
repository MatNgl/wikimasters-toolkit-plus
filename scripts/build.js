// Version publiable : copie l'extension dans dist/ (le dossier à charger dans chrome://extensions : manifest.json à sa racine), sans les
// outils de développement (rechargement automatique, permission « alarms », version_name), et crée release/wikimasters-toolkit-plus-<version>.zip
// pour le Chrome Web Store.
// Usage : node scripts/build.js [version]
// Sans argument, le numéro de version monte d'un cran à chaque build (1.0.1, 1.0.2, …) : le numéro du ZIP dit toujours quelle est la dernière
// version construite. Il est mémorisé dans package.json ("storeVersion") ; les anciens ZIP de release/ sont supprimés.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bump = (v) => { const p = v.split('.').map(Number); p[2] += 1; return p.join('.'); };
const version = process.argv[2] || bump(pj.storeVersion || '1.0.0');
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

fs.rmSync(pkg, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const old of fs.readdirSync(out)) if (/^wikimasters-toolkit-plus-.*.zip$/.test(old)) fs.rmSync(path.join(out, old));
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
const entries = [...files, 'manifest.json', ...(fs.existsSync(path.join(pkg, 'LICENSE')) ? ['LICENSE'] : [])].sort();
const chunks = [];
const central = [];
let offset = 0;
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
for (const name of entries) {
  const data = fs.readFileSync(path.join(pkg, name));
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
const cdSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
const zip = path.join(out, `wikimasters-toolkit-plus-${version}.zip`);
fs.writeFileSync(zip, Buffer.concat([...chunks, ...central, end]));
console.log(`${entries.length} fichiers, ${(fs.statSync(zip).size / 1024).toFixed(0)} Ko -> ${path.relative(root, zip)}`);
pj.storeVersion = version;
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pj, null, 2) + String.fromCharCode(10));
