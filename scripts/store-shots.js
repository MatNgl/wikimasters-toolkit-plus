// Met des captures d'écran brutes (1280×801) au format du Chrome Web Store (1280×800, PNG) dans release/store-screenshots/.
// Usage : node scripts/store-shots.js   (la liste ci-dessous donne le fichier source, le nom de sortie et les zones à flouter)
// Le store accepte 5 captures au plus : les n° 1 à 5 sont l'ordre conseillé, 6 et 7 sont en réserve.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SRC = 'C:/Users/Matthéo/.claude/projects/C--Users-Matth-o-Documents-Projets-web-extension-wikim/861aa464-f29e-448c-9378-3fab3b74aefd/tool-results/';
const SHOTS = [
  { from: 'mcp-claude-in-chrome-blob-1793659430980-kx4zy5.jpg', to: '1-collection-prix-et-eclair.png' },
  { from: 'mcp-claude-in-chrome-blob-1793659528328-t66yte.jpg', to: '2-marche-moyenne-et-verdict.png', blur: [{ left: 370, top: 569, width: 790, height: 22 }] }, // pseudos des vendeurs
  { from: 'mcp-claude-in-chrome-blob-1793659559870-5sod6k.jpg', to: '3-menu-des-tirages.png', blur: [{ left: 296, top: 676, width: 290, height: 20 }] }, // ligne de version de développement
  { from: 'mcp-claude-in-chrome-blob-1793659598961-ehl2sg.jpg', to: '4-resultat-de-15-tirages.png', blur: [{ left: 1050, top: 116, width: 158, height: 216, sigma: 18 }, { left: 724, top: 116, width: 154, height: 216, sigma: 18 }] }, // personnalités politiques
  { from: 'mcp-claude-in-chrome-blob-1793659339426-bfztte.jpg', to: '5-tableau-de-bord.png', blur: [{ left: 786, top: 324, width: 462, height: 24, sigma: 12 }, { left: 786, top: 502, width: 462, height: 24, sigma: 12 }] }, // noms de cartes sensibles
  { from: 'mcp-claude-in-chrome-blob-1793659477569-pwbpfb.jpg', to: '6-reserve-style-de-carte.png' },
  { from: 'mcp-claude-in-chrome-blob-1793659617002-x35ar7.jpg', to: '7-reserve-parametres-a-savoir.png' },
];

(async () => {
  const out = path.resolve(__dirname, '../release/store-screenshots');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const s of SHOTS) {
    const buf = await sharp(SRC + s.from).resize(1280, 800, { fit: 'cover', position: 'top' }).png().toBuffer();
    let pipe = sharp(buf);
    if (s.blur?.length) {
      const parts = [];
      for (const { sigma = 9, ...r } of s.blur) parts.push({ input: await sharp(buf).extract(r).blur(sigma).toBuffer(), left: r.left, top: r.top });
      pipe = sharp(buf).composite(parts);
    }
    await pipe.png().toFile(path.join(out, s.to));
    const m = await sharp(path.join(out, s.to)).metadata();
    console.log(s.to, m.width + 'x' + m.height);
  }
})();
