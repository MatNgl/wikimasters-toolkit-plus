// Images promotionnelles du Chrome Web Store : petite 440×280 (obligatoire) et grande 1400×560, en PNG 24 bits sans transparence.
// Usage : node scripts/promo.js   -> release/promo/
// Les cartes viennent de la capture « Animaux » de la collection (cartes neutres, prix et éclair visibles).
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SRC = 'C:/Users/Matthéo/.claude/projects/C--Users-Matth-o-Documents-Projets-web-extension-wikim/861aa464-f29e-448c-9378-3fab3b74aefd/tool-results/mcp-claude-in-chrome-blob-1793659430980-kx4zy5.jpg';
const ICON = path.resolve(__dirname, '../icons/icon-128.png');
// Cartes de la première ligne de la capture (160×224) : Berger de Beauce, Blaireau, Canis lupus, Panthère des neiges, Boxer.
const CARDS = [313, 499, 685, 871, 1057].map((left) => ({ left, top: 339, width: 160, height: 224 }));
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/** Une carte aux coins arrondis, mise à l'échelle `h`, pivotée de `deg`, avec une ombre : PNG transparent. */
async function card(i, h, deg) {
  const w = Math.round((160 / 224) * h);
  const r = Math.round(h * 0.07);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  const face = await sharp(SRC).extract(CARDS[i]).resize(w, h).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const pad = Math.round(h * 0.12);
  const shadow = await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg width="${w + pad * 2}" height="${h + pad * 2}"><rect x="${pad}" y="${pad + pad * 0.3}" width="${w}" height="${h}" rx="${r}" fill="#000" fill-opacity="0.7"/></svg>`), left: 0, top: 0 }])
    .blur(pad * 0.35).png().toBuffer();
  const base = await sharp(shadow).composite([{ input: face, left: pad, top: pad }]).png().toBuffer();
  return sharp(base).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

const bg = (w, h) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1411"/><stop offset="1" stop-color="#14382c"/></linearGradient>
  <radialGradient id="l" cx="0.78" cy="0.5" r="0.55"><stop offset="0" stop-color="#2dd4a0" stop-opacity="0.28"/><stop offset="1" stop-color="#2dd4a0" stop-opacity="0"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#l)"/></svg>`);

const text = (w, h, parts) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT}">${parts}</svg>`);

async function make(name, W, H, layout) {
  const layers = [];
  const add = (input, left, top) => layers.push({ input, left: Math.round(left), top: Math.round(top) });
  await layout(add);
  const out = path.resolve(__dirname, '../release/promo');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, name);
  await sharp(bg(W, H)).composite(layers).flatten({ background: '#0a1411' }).removeAlpha().png().toFile(file);
  const m = await sharp(file).metadata();
  console.log(name, `${m.width}x${m.height}`, `canaux ${m.channels}`, `alpha ${m.hasAlpha}`);
}

(async () => {
  // --- 440 × 280 ---
  await make('petite-440x280.png', 440, 280, async (add) => {
    add(await card(3, 150, 7), 318, 98);
    add(await card(0, 150, -7), 226, 104);
    add(await card(2, 178, 0), 268, 72);
    add(await sharp(ICON).resize(44, 44).png().toBuffer(), 22, 22);
    add(text(440, 280, `
      <text x="76" y="44" font-size="14" font-weight="600" fill="#7fe8c6" letter-spacing="1">WIKIMASTERS</text>
      <text x="22" y="108" font-size="34" font-weight="800" fill="#ffffff">Toolkit+</text>
      <text x="22" y="140" font-size="15" font-weight="600" fill="#d7e6df">Prix du marché</text>
      <text x="22" y="162" font-size="15" font-weight="600" fill="#d7e6df">Paquets en un clic</text>
      <text x="22" y="184" font-size="15" font-weight="600" fill="#d7e6df">Enchères automatiques</text>
      <rect x="22" y="236" width="150" height="24" rx="12" fill="#ffffff" fill-opacity="0.1"/>
      <text x="34" y="253" font-size="12" font-weight="600" fill="#b9cbc3">Extension non officielle</text>`), 0, 0);
  });

  // --- 1400 × 560 ---
  await make('grande-1400x560.png', 1400, 560, async (add) => {
    add(await card(3, 350, 8), 1060, 120);
    add(await card(0, 350, -8), 730, 120);
    add(await card(2, 400, 0), 895, 80);
    add(await sharp(ICON).resize(72, 72).png().toBuffer(), 64, 64);
    add(text(1400, 560, `
      <text x="152" y="102" font-size="26" font-weight="600" fill="#7fe8c6" letter-spacing="3">WIKIMASTERS</text>
      <text x="62" y="212" font-size="86" font-weight="800" fill="#ffffff">Toolkit+</text>
      <text x="64" y="272" font-size="30" font-weight="600" fill="#d7e6df">Tous vos paquets d'un clic.</text>
      <text x="64" y="312" font-size="30" font-weight="600" fill="#d7e6df">Le vrai prix de chaque carte.</text>
      <text x="64" y="352" font-size="30" font-weight="600" fill="#d7e6df">Des enchères qui se jouent seules.</text>
      <rect x="64" y="440" width="270" height="40" rx="20" fill="#ffffff" fill-opacity="0.1"/>
      <text x="84" y="467" font-size="19" font-weight="600" fill="#b9cbc3">Extension non officielle</text>`), 0, 0);
  });
})();
