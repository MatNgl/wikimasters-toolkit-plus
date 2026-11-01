// Fiche d'une carte depuis l'écran de révélation : on ouvre la VRAIE fiche du jeu (étiquettes, mise aux
// enchères, défausse…) en retrouvant la carte dans la Collection. Rien n'est envoyé par l'extension :
// elle ne fait que naviguer, taper dans la recherche du jeu et cliquer sur la carte, comme l'utilisateur.
(() => {
  const { el, sleep, waitFor } = WMX.dom;

  const link = (path) => [...document.querySelectorAll(`a[href="${path}"]`)].find((a) => !a.closest('.wmx-panel, .wmx-overlay, .wmx-return'));
  const searchInput = () => [...document.querySelectorAll('input')].find((i) => /recherch/i.test(i.placeholder || '') && !i.closest('.wmx-panel, .wmx-overlay'));

  /** Saisie compatible React puis Entrée, comme un utilisateur. */
  function search(input, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
  }

  let current = null; // une seule fiche ouverte à la fois

  WMX.openCardDetail = async function openCardDetail(card) {
    const overlay = document.querySelector('.wmx-overlay');
    if (!overlay || current) return;
    const msg = el('span', {}, `Fiche : ${card.wikipedia_title}`);
    const back = el('button', { class: 'wmx-btn' }, '↩ Retour aux cartes');
    const bar = el('div', { class: 'wmx-return' }, msg, back);
    current = bar;
    overlay.classList.add('wmx-away'); // la révélation reste en mémoire, juste masquée
    document.body.append(bar);

    back.addEventListener('click', () => {
      bar.remove();
      current = null;
      overlay.classList.remove('wmx-away');
      link('/pulls')?.click();
    });

    const fail = (t) => { msg.textContent = t; };
    msg.textContent = `Ouverture de la collection pour « ${card.wikipedia_title} »…`;
    link('/collection')?.click();
    const input = await waitFor(searchInput, 45000, 250);
    if (!input) return fail('Collection introuvable : ouvrez-la à la main, puis revenez.');

    search(input, card.wikipedia_title);
    // Après la recherche, la carte attendue apparaît (on la repère par son identifiant, pas par son nom).
    const target = await waitFor(() => document.querySelector(`[data-wm-card-id="${card.id}"]`), 12000, 250);
    if (!target) return fail(`« ${card.wikipedia_title} » n’apparaît pas dans la recherche.`);

    await sleep(300);
    target.click();
    // Si la fiche ne s'est pas ouverte, on clique au centre de la carte, là où la souris atterrirait.
    await sleep(900);
    if (!/Mettre aux enchères/i.test(document.body.innerText)) { // la fiche du jeu affiche ce bouton
      const r = target.getBoundingClientRect();
      document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.4)?.click();
    }
    msg.textContent = `Fiche : ${card.wikipedia_title}`;
  };
})();
