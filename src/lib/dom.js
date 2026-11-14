// Quand le jeu est lent, il finit parfois de s'afficher APRÈS le chargement de l'extension et remplace alors le contenu de <body> (et les
// attributs de <html>) : les éléments que l'extension y avait ajoutés disparaissent (bulle des enchères, menu des paquets). On les remet.
const kept = new Set();
setInterval(() => {
  if (!WMX.alive?.() || !document.body) return;
  for (const n of kept) if (!n.isConnected) document.body.append(n);
}, 1000);

// Conteneurs de l'extension : une modification DANS l'un d'eux n'a pas à relancer les balayages de la page (sinon l'extension se réveille elle-même en boucle).
// Pas de sélecteur « classe commençant par wmx- » : <html> en porte plusieurs et correspondrait à tout.
const OWN = '.wmx-mk, .wmx-mk-acts, .wmx-nt-price, .wmx-nt-bolt, .wmx-notes, .wmx-bubble, .wmx-qchip, .wmx-panel, .wmx-cplus, .wmx-dk, .wmx-dw, .wmx-sty-shiny, .wmx-sty-waves, .wmx-sty-sheen, .wmx-modal-backdrop, .wmx-sheet-frame, .wmx-pre-back, .wmx-pdial, .wmx-cover, .wmx-toast, .wmx-dlg-back, .wmx-dc-run, .wmx-pp-bar, .wmx-tv-wrap';
WMX.dom = {
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
