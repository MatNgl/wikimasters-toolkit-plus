// Mise en enchère rapide : à brancher sur le flux natif « vendre » une fois
// les sélecteurs/endpoints confirmés (voir docs/API-NOTES.md).
(() => {
  WMX.register({
    name: 'market',
    match: /^\/marketplace/,
    init() { /* TODO: bouton « Enchère rapide » avec prix de départ = moyenne × coefficient */ },
  });
})();
