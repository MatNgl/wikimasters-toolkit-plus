// Quand le jeu est lent, il finit parfois de s'afficher APRÈS le chargement de l'extension et remplace alors le contenu de <body> (et les
// attributs de <html>) : les éléments que l'extension y avait ajoutés disparaissent (bulle des enchères, menu des paquets). On les remet.
const kept = new Set();
setInterval(() => {
  if (!WMX.alive?.() || !document.body) return;
  for (const n of kept) if (!n.isConnected) document.body.append(n);
}, 1000);

// Conteneurs de l'extension : une modification DANS l'un d'eux n'a pas à relancer les balayages de la page (sinon l'extension se réveille elle-même en boucle).
// Pas de sélecteur « classe commençant par wmx- » : <html> en porte plusieurs et correspondrait à tout.
const OWN = '.wmx-mk, .wmx-mk-acts, .wmx-nt-price, .wmx-nt-bolt, .wmx-notes, .wmx-bubble, .wmx-qchip, .wmx-panel, .wmx-cplus, .wmx-dk, .wmx-dw, .wmx-sty-shiny, .wmx-sty-waves, .wmx-sty-sheen, .wmx-modal-backdrop, .wmx-sheet-frame, .wmx-pre-back, .wmx-pdial, .wmx-cover, .wmx-toast, .wmx-dlg-back, .wmx-dc-run, .wmx-pp-bar, .wmx-tv-wrap, .wmx-tc-bar';
WMX.dom = {
  /**
   * Dessin SVG fait par l'extension (graphiques, cadrans, icônes), sans innerHTML (signalé par la validation de Firefox) : le texte est lu
   * comme du XML puis ses éléments sont copiés. Sur un <svg> : remplace son contenu ; sur un autre élément : y met le <svg> complet donné.
   */
  svg(node, markup) {
    const NS = 'http://www.w3.org/2000/svg';
    const inSvg = node.namespaceURI === NS;
    const doc = new DOMParser().parseFromString(inSvg ? `<svg xmlns="${NS}">${markup}</svg>` : markup.replace(/^<svg(?![^>]*xmlns=)/, `<svg xmlns="${NS}"`), 'image/svg+xml');
    const root = doc.documentElement;
    if (root.nodeName !== 'svg' || root.getElementsByTagName('parsererror').length) return node;
    node.replaceChildren(...(inSvg ? [...root.childNodes] : [root]).map((n) => document.importNode(n, true)));
    return node;
  },
  /** Vrai si au moins une des modifications observées vient de la page du jeu (et non d'un élément de l'extension). */
  foreign(muts) {
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!t || !t.closest(OWN)) return true;
    }
    return false;
  },
  /** Garde un élément de l'extension dans la page : remis dans <body> s'il en est retiré par le jeu. */
  keepAttached(node) { kept.add(node); return node; },
  /** Retire pour de bon un élément gardé par keepAttached (sinon il est remis dans la page aussitôt : bouton « Fermer » sans effet). */
  release(node) { if (node) { kept.delete(node); node.remove(); } },
  /**
   * Infobulle qui suit la souris, posée dans <body> en position fixe : elle passe PAR-DESSUS la page, sans jamais agrandir son conteneur
   * (avant, placée dans le bloc du graphique, elle le débordait par le bas : une barre de défilement apparaissait et le graphique bougeait).
   * Elle se retourne à gauche ou au-dessus du curseur près des bords de l'écran. Rend { el, show(event), hide() }.
   */
  floatTip(cls = 'wmx-lg-tip') {
    document.querySelectorAll(`body > .wmx-floattip.${cls.split(' ')[0]}`).forEach((n) => n.remove()); // celle d'un graphique redessiné
    const tip = WMX.dom.el('div', { class: `${cls} wmx-floattip`, role: 'tooltip' });
    tip.hidden = true;
    return {
      el: tip,
      show(e) {
        if (!tip.isConnected) document.body.append(tip);
        tip.hidden = false;
        const w = tip.offsetWidth || 270, h = tip.offsetHeight || 120;
        const vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
        let x = e.clientX + 16;
        if (x + w > vw - 8) x = e.clientX - 16 - w;
        let y = e.clientY - 24;
        if (y + h > vh - 8) y = Math.min(e.clientY - 16 - h, vh - 8 - h); // trop bas : au-dessus du curseur
        tip.style.left = `${Math.max(8, x)}px`;
        tip.style.top = `${Math.max(8, y)}px`;
      },
      hide() { tip.hidden = true; },
    };
  },
  /**
   * Icône de l'extension (icons/icon.svg, dessinée en SVG dans la page : rien à charger, même sous Firefox). Identifiants de dégradé uniques par
   * icône (plusieurs icônes dans la page ne se mélangent pas). size : côté en px.
   */
  logo(size = 18) {
    WMX.dom._logoN = (WMX.dom._logoN || 0) + 1;
    const n = WMX.dom._logoN;
    const span = WMX.dom.el('span', { class: 'wmx-logo', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` });
    WMX.dom.svg(span, `<svg viewBox="0 0 128 128" width="${size}" height="${size}"><defs><linearGradient id="wmxlb${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12201a"/><stop offset="1" stop-color="#07100c"/></linearGradient><linearGradient id="wmxlg${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#2dd4a0"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="28" fill="url(#wmxlb${n})"/><rect x="30" y="20" width="68" height="88" rx="12" fill="#0d1713" stroke="url(#wmxlg${n})" stroke-width="4" transform="rotate(-6 64 64)"/><path d="M42 44l10 40 12-28 12 28 10-40" fill="none" stroke="url(#wmxlg${n})" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-6 64 64)"/><circle cx="98" cy="98" r="17" fill="#2dd4a0"/><path d="M98 89v18M89 98h18" stroke="#07100c" stroke-width="5" stroke-linecap="round"/></svg>`);
    return span;
  },
  /** Case à cocher de l'extension (style .wmx-check, coche animée) ; variant 'danger' : rouge, pour une confirmation irréversible. */
  checkbox({ checked = false, variant = '', ...attrs } = {}) {
    const c = WMX.dom.el('input', { type: 'checkbox', class: `wmx-check${variant ? ` wmx-check--${variant}` : ''}`, ...attrs });
    c.checked = !!checked;
    return c;
  },
  el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...children);
    return n;
  },
  /** Bouton ou lien dont le texte correspond (insensible à la casse). */
  findByText(text, selector = 'button, a, [role=button]') {
    const t = text.toLowerCase();
    return [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().toLowerCase().includes(t));
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  /** Bouton dont le texte est exactement `text` (évite « Tout ouvrir » pour « Ouvrir »). */
  findExact(text, selector = 'button, a, [role=button]') {
    const t = text.toLowerCase();
    return [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().toLowerCase() === t && !e.disabled);
  },
  /**
   * Illustration « pleine image » d'une carte : un portrait remplit la carte ; une image paysage ou carrée
   * est affichée en entier (au lieu d'être rognée) sur un fond flou qui complète le haut et le bas.
   */
  artLayers(src, host) {
    const blur = WMX.dom.el('img', { class: 'wmx-art-blur', src, alt: '', loading: 'lazy' });
    const img = WMX.dom.el('img', { class: 'wmx-art-img', src, alt: '', loading: 'lazy' });
    img.addEventListener('load', () => {
      if (img.naturalHeight && img.naturalWidth / img.naturalHeight > 0.85) host.classList.add('wmx-wide');
    });
    img.addEventListener('error', () => { blur.remove(); img.remove(); });
    host.prepend(img);
    host.prepend(blur); // le flou passe dessous
  },
  /** Bord droit de la barre latérale du jeu (elle s'élargit selon l'écran). */
  sidebarRight() {
    const edges = [...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect().right).filter((x) => x > 100 && x < 700);
    return edges.length ? Math.max(...edges) : 256;
  },
  async waitFor(fn, timeout = 5000, step = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await WMX.dom.sleep(step); }
    return null;
  },
};
