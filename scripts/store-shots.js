// Met des captures d'écran brutes (1280×801) au format du Chrome Web Store (1280×800, PNG) dans dist/store-screenshots/.
// Usage : node scripts/store-shots.js   (la liste ci-dessous donne le fichier source, le nom de sortie et les zones à flouter)
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SRC = 'C:/Users/Matthéo/.claude/projects/C--Users-Matth-o-Documents-Projets-web-extension-wikim/861aa464-f29e-448c-9378-3fab3b74aefd/tool-results/';
const SHOTS = [
  { from: 'mcp-claude-in-chrome-blob-1793659305209-ev2lyf.jpg', to: '1-collection-prix-et-eclair.png' },
  { from: 'mcp-claude-in-chrome-blob-1793659305209-fgl46a.jpg', to: '2-marche-moyenne-et-verdict.png', blur: [{ left: 370, top: 568, width: 790, height: 24 }] }, // pseudos des vendeurs
  { from: 'mcp-claude-in-chrome-blob-1793659339426-bfztte.jpg', to: '3-tableau-de-bord.png' },
  { from: 'mcp-claude-in-chrome-blob-1793659339426-d0yokv.jpg', to: '4-style-de-carte.png' },
  { from: 'mcp-claude-in-chrome-blob-1793659357696-oyjfoq.jpg', to: '5-bulle-des-encheres.png' },
];

(async () => {
  const out = path.resolve(__dirname, '../dist/store-screenshots');
  fs.mkdirSync(out, { recursive: true });
  for (const s of SHOTS) {
    let img = sharp(SRC + s.from).resize(1280, 800, { fit: 'cover', position: 'top' });
    const buf = await img.png().toBuffer();
    let pipe = sharp(buf);
    if (s.blur?.length) {
      const parts = [];
      for (const r of s.blur) parts.push({ input: await sharp(buf).extract(r).blur(9).toBuffer(), left: r.left, top: r.top });
      pipe = sharp(buf).composite(parts);
    }
    await pipe.png().toFile(path.join(out, s.to));
    const m = await sharp(path.join(out, s.to)).metadata();
    console.log(s.to, m.width + 'x' + m.height);
  }
})();
