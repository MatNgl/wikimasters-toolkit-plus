// Style de carte de l'extension, appliqué PARTOUT où le jeu affiche une carte (collection, marché et fiche d'enchère, « Toutes les cartes »,
// fenêtre d'échange, profil, guilde, batailles…) : le jeu utilise un seul composant de carte (un cadre arrondi avec l'illustration, une
// pastille de rareté en haut à gauche et un bloc de texte à partir de 45 % de la hauteur) ; on le reconnaît à cette structure, donc
// peu importe la page. L'écran de révélation des paquets (reveal.js) reprend les mêmes ornements.
// Plein cadre : l'illustration occupe toute la carte, le texte flotte sur un dégradé sombre, un cadre lumineux reprend la couleur de la
// rareté, un fin motif de vagues et un reflet brillant s'y ajoutent (le reflet tourne en continu sur les Légendaires, au survol pour les
// autres). Réglages (Paramètres → Aspect des cartes) : style, description, attaque/défense.
(() => {
  const { el } = WMX.dom;
  const WAVES = '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="20" viewBox="0 0 56 20"><path d="M0 10 Q14 0 28 10 T56 10" fill="none" stroke="white" stroke-width="1"/><path d="M0 18 Q14 8 28 18 T56 18" fill="none" stroke="white" stroke-width="1" opacity=".6"/></svg>';
  document.documentElement.style.setProperty('--wmx-waves', `url("data:image/svg+xml;utf8,${encodeURIComponent(WAVES)}")`);

  const BADGE = 'div.absolute.top-2.left-2';
  const ART = 'div[class*="h-[45%]"]';
  const TEXT = 'div[class*="top-[45%]"]';
  const isOn = () => WMX.settings?.cardStyle !== false;

  /** Cartes du jeu présentes dans la page (jamais celles de l'extension : fenêtres, bulle, révélation). */
  function cards() {
    const out = [];
    for (const art of document.querySelectorAll(ART)) {
      const root = art.parentElement;
      if (!root || out.includes(root) || root.closest('.wmx-modal, .wmx-bubble, .wmx-overlay')) continue;
      if (root.querySelector(`:scope > ${TEXT}`) && root.querySelector(`:scope > ${BADGE}`)) out.push(root);
    }
    return out;
  }

  /** Exception shiny : voile sombre, points noirs qui tombent et dérivent, reflet doux qui suit le pointeur et légère inclinaison 3D. */
  function setShiny(card, shiny) {
    if (!shiny) {
      if (card.dataset.wmxShiny) { delete card.dataset.wmxShiny; card.querySelectorAll('.wmx-sty-shiny').forEach((e) => e.remove()); }
      return;
    }
    card.dataset.wmxShiny = '1';
    if (!card.querySelector(':scope > .wmx-sty-veil')) {
      card.append(...['veil', 'motes', 'drift', 'glare'].map((k) => el('span', { class: `wmx-sty-shiny wmx-sty-${k}` })));
    }
    if (card._wmxTilt) return;
    card._wmxTilt = true;
    let raf = 0;
    card.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1)));
        card.style.setProperty('--wmx-mx', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--wmx-my', `${(y * 100).toFixed(1)}%`);
        card.style.setProperty('--wmx-tx', `${((x - 0.5) * 14).toFixed(2)}deg`);
        card.style.setProperty('--wmx-ty', `${((0.5 - y) * 14).toFixed(2)}deg`);
      });
    });
    card.addEventListener('pointerleave', () => {
      cancelAnimationFrame(raf);
      for (const k of ['--wmx-mx', '--wmx-my', '--wmx-tx', '--wmx-ty']) card.style.removeProperty(k);
    });
  }

  function apply(card) {
    const on = isOn();
    const was = card.classList.contains('wmx-sty');
    if (!on) {
      if (was) {
        card.classList.remove('wmx-sty', 'wmx-sty-a', 'wmx-sty-lg', 'wmx-sty-contain');
        card.querySelectorAll('.wmx-sty-waves, .wmx-sty-sheen, .wmx-sty-shiny').forEach((e) => e.remove());
        delete card.dataset.wmxShiny;
      }
      return;
    }
    const badge = card.querySelector(`:scope > ${BADGE}`);
    const badgeText = String(badge?.textContent || '').replace(/\s+/g, ' ').trim();
    const rarity = WMX.normRarity(badgeText) || 'C';
    // Carte « shiny » (variante spéciale du jeu, pastille « L✦ shiny » : calque onyx + lignes dorées) : traitement d'exception.
    const shiny = card.classList.contains('shiny-card') || !!badge?.classList.contains('shiny-badge') || /\bshiny\b/i.test(badgeText);
    if (!was) { card.classList.add('wmx-sty', 'wmx-sty-a'); }
    setShiny(card, shiny);
    if (card.dataset.wmxR !== rarity || !card.style.getPropertyValue('--wmx-rgb')) {
      card.dataset.wmxR = rarity;
      card.style.setProperty('--wmx-rgb', WMX.RARITY_RGB[rarity] || '255 255 255');
    }
    if (!card.querySelector(':scope > .wmx-sty-waves')) card.append(el('span', { class: 'wmx-sty-waves' }), el('span', { class: 'wmx-sty-sheen' }));
    card.classList.toggle('wmx-sty-lg', card.offsetWidth > 200); // grande carte (fiche d'une enchère) : textes plus grands
    // Image PNG / paysage : entière (contain) sur un fond flouté, au lieu d'être rognée.
    const art = card.querySelector(`${ART} img, :scope > img`);
    const wide = () => art && (/\.(png|svg)(\?|$)/i.test(art.currentSrc || art.src || '') || (art.naturalWidth && art.naturalWidth / art.naturalHeight > 1.25));
    const check = () => card.classList.toggle('wmx-sty-contain', !!wide());
    if (art) { check(); if (!art.complete) art.addEventListener('load', check, { once: true }); }
  }

  /** Description et attaque/défense : affichées ou masquées selon les Paramètres (classes sur la page, lues par le CSS). */
  const syncFlags = () => {
    const s = WMX.settings || {};
    document.documentElement.classList.toggle('wmx-hide-desc', s.cardShowDesc === false);
    document.documentElement.classList.toggle('wmx-hide-stats', s.cardShowStats === false);
  };

  let timer = null;
  function scan() {
    syncFlags();
    for (const c of cards()) apply(c);
    if (!isOn()) document.querySelectorAll('.wmx-sty').forEach((c) => { if (!c.closest('.wmx-face')) apply(c); }); // style retiré : on nettoie aussi les cartes déjà décorées
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { try { scan(); } catch (_) { /* page fermée */ } }, 150); };

  WMX.cardStyle = { apply, scan, cards };
  WMX.register({
    name: 'card-style',
    match: /./,
    init() {
      scan();
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('wmx:settings', scan);
      // Le jeu peut réécrire la classe d'une carte (rendu React) et effacer notre style : un contrôle léger toutes les 3 s le rétablit.
      const tick = setInterval(() => {
        try { if (document.visibilityState === 'visible' && WMX.alive()) scan(); } catch (_) { clearInterval(tick); } // page fermée ou extension rechargée : on s'arrête
      }, 3000);
    },
  });
})();
