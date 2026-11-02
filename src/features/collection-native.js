// Collection du jeu (/collection) : on y ajoute, sans la remplacer,
//  - une barre au-dessus de la recherche : valeur estimée, état des prix et bouton « Charger les prix… » ;
//  - sur chaque carte : la moyenne du marché et le bouton ⚡ (enchère rapide) à côté de l'étoile ★ du jeu.
// Tout le reste (sélection, étiquettes, favoris, défausse en lot) est la fonction native du jeu, instantanée.
// Les cartes sont reconnues par leur titre et leur rareté (affichés par le jeu) grâce à l'inventaire (inventory.js).
(() => {
  const { el } = WMX.dom;
  let bar = null;
  let timer = null;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const isPage = () => /^\/collection\/?$/.test(location.pathname);
  /** Carte affichée par le jeu : l'élément arrondi cliquable qui contient le titre (h3). */
  const cardOf = (h3) => h3.closest('[class*="cursor-pointer"][class*="rounded-2xl"]') || h3.closest('[class*="rounded-2xl"]');
  const starBtn = (card) => card.querySelector('button[aria-label*="favoris"]');

  function boltFor(card) {
    const q = WMX.quick;
    const item = card._wmxItem;
    const b = card.querySelector('.wmx-nt-bolt');
    if (!q || !b) return;
    if (!item) { b.disabled = true; b.textContent = '⚡'; b.title = 'Collection en cours de chargement…'; return; }
    const st = q.stateOf(item.card_id);
    const starred = /^retirer/i.test(starBtn(card)?.getAttribute('aria-label') || '') || item.starred;
    b.textContent = { queued: '⏳', working: '…', cancelling: '…' }[st] || '⚡';
    b.className = `wmx-nt-bolt${st === 'live' ? ' live' : ''}${st === 'queued' ? ' queued' : ''}${st === 'working' || st === 'cancelling' ? ' busy' : ''}`;
    b.title = q.hint({ ...item, starred });
    b.disabled = starred && st === 'idle';
  }

  function paint(card) {
    const h3 = card.querySelector('h3');
    if (!h3) return;
    const title = norm(h3.textContent);
    const rarity = WMX.normRarity(norm(card.querySelector('div.absolute.top-2.left-2')?.textContent)) || 'C';
    const item = WMX.inventory.find(title, rarity);
    card._wmxItem = item;
    const chip = card.querySelector('.wmx-nt-price');
    if (chip) chip.textContent = item ? WMX.inventory.priceText(item) : 'Moy. …';
    boltFor(card);
  }

  function decorate(card) {
    if (!card.querySelector('.wmx-nt-price')) {
      card.append(el('span', { class: 'wmx-nt-price' }, 'Moy. …'));
    }
    if (!card.querySelector('.wmx-nt-bolt')) {
      const host = starBtn(card)?.parentElement;
      if (host) {
        const b = el('button', { type: 'button', class: 'wmx-nt-bolt', 'aria-label': 'Enchère rapide' }, '⚡');
        b.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation(); // le clic ne doit pas ouvrir la fiche du jeu
          const item = card._wmxItem;
          if (!item) return WMX.toast?.('La collection est encore en cours de chargement : réessayez dans un instant.');
          const starred = /^retirer/i.test(starBtn(card)?.getAttribute('aria-label') || '') || item.starred;
          WMX.quick?.toggle({ ...item, starred });
        });
        b.addEventListener('mouseenter', () => WMX.prepareCardSheets?.('work')); // le cadre d'automatisation charge dès qu'on vise ⚡
        host.append(b);
      }
    }
    paint(card);
  }

  /** Barre « valeur · prix · bouton » placée juste avant la ligne de recherche du jeu. */
  function ensureBar() {
    if (bar?.isConnected) return;
    const input = [...document.querySelectorAll('input')].find((i) => /Rechercher par titre/i.test(i.placeholder || ''));
    const grid = document.querySelector('main h3')?.closest('[class*="flex-wrap"]');
    if (!input) return;
    let row = input;
    while (row.parentElement && !(grid && row.parentElement.contains(grid)) && row.parentElement !== document.body) row = row.parentElement;
    bar = bar || WMX.inventory.makePriceBar('wmx-nt-bar');
    row.before(bar);
  }

  function scan() {
    if (!isPage()) return;
    ensureBar();
    for (const h3 of document.querySelectorAll('main h3')) {
      const card = cardOf(h3);
      if (card && card.querySelector('div.absolute.top-2.left-2') && starBtn(card)) decorate(card); // seulement les vraies cartes (rareté + étoile)
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 200); };
  const repaintAll = () => { if (isPage()) document.querySelectorAll('main h3').forEach((h3) => { const c = cardOf(h3); if (c?.querySelector('.wmx-nt-price')) paint(c); }); };

  WMX.register({
    name: 'collection-native',
    match: /^\/collection/,
    init() {
      WMX.inventory.ensure();
      WMX.onApi(({ path, data }) => { if (/^\/api\/my-collection\/?$/.test(path)) { WMX.inventory.learn(data?.collection); schedule(); } });
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      WMX.inventory.onChange(() => { clearTimeout(window.__wmxNtRepaint); window.__wmxNtRepaint = setTimeout(repaintAll, 150); });
      WMX.quick?.onChange(() => { clearTimeout(window.__wmxNtRepaint); window.__wmxNtRepaint = setTimeout(repaintAll, 150); });
      window.addEventListener('wmx:fav', repaintAll);
      schedule();
    },
  });
  WMX.collectionNative = { scan };
})();
