WMX.dom = {
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
  async waitFor(fn, timeout = 5000, step = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await WMX.dom.sleep(step); }
    return null;
  },
};
