// Tourne dans le monde MAIN, au tout début du chargement, dans TOUS les cadres du jeu. Il n'agit que dans les cadres
// créés par l'extension pour annuler une enchère (adresse marquée « #wmx-auto ») : les alertes de confirmation du jeu
// (« Annuler cette enchère et récupérer votre carte ? ») y répondent « oui » d'elles-mêmes. Rien ne change dans la
// page principale, ni dans les autres cadres.
(() => {
  if (window === window.top || !location.hash.includes('wmx-auto')) return;
  window.confirm = () => true;
  window.alert = () => {};
})();
