// Après une mise à jour de l'extension (rechargement automatique), les onglets du jeu gardent l'ancien code, dont les chronomètres
// s'arrêtent : on l'indique clairement avec un bouton « Actualiser » au lieu de laisser une interface figée.
(() => {
  WMX.register({
    name: 'update-banner',
    init() {
      const t = setInterval(() => {
        if (WMX.alive()) return;
        clearInterval(t);
        const { el } = WMX.dom;
        const chip = el('div', { class: 'wmx-stale' },
          el('span', {}, 'L’extension a été mise à jour : cette page affiche d’anciennes données.'),
          el('button', { class: 'wmx-btn', onclick: () => location.reload() }, 'Actualiser'));
        document.body.append(chip);
      }, 2000);
    },
  });
})();
