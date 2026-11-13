// Banc d'essai sans navigateur : charge les scripts de l'extension dans jsdom avec un faux `chrome` et un faux `fetch`.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function createEnv({ fetchImpl, files, now } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.wiki-masters.com/collection', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const mem = {};
  const storeListeners = []; // chrome.storage.onChanged : déclenché à la main par les essais (fireStorage), comme un autre onglet qui écrit
  w.chrome = {
    runtime: { id: 'test', getManifest: () => ({ version: 'test', version_name: 'test' }), getURL: (p) => p },
    storage: {
      local: {
        get: async (k) => (typeof k === 'string' ? (k in mem ? { [k]: JSON.parse(JSON.stringify(mem[k])) } : {}) : {}),
        set: async (o) => { for (const [k, v] of Object.entries(o)) mem[k] = JSON.parse(JSON.stringify(v)); },
      },
      onChanged: { addListener(cb) { storeListeners.push(cb); } },
    },
  };
  if (fetchImpl) w.fetch = fetchImpl;
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ isIntersecting: true, target: el }]); } unobserve() {} disconnect() {} };
  w.Notification = Object.assign(function Notification() {}, { permission: 'denied' });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const list = files || manifest.content_scripts[1].js.filter((f) => !/content\.js$/.test(f));
  for (const f of list) w.eval(`${fs.readFileSync(path.join(ROOT, f), 'utf8')}\n//# sourceURL=${f}`);
  w.WMX.settings = w.WMX.settings || {};
  const fireStorage = (changes) => storeListeners.forEach((cb) => { try { cb(changes, 'local'); } catch (_) { /* écouteur */ } });
  return { w, mem, WMX: w.WMX, fireStorage, close: () => w.close() };
}

module.exports = { createEnv, ROOT };
