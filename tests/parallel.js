// Les essais d'un même fichier tournent EN PARALLÈLE : chacun a son propre jsdom (aucun état partagé) et la plupart passent leur temps à attendre
// les minuteries réelles de l'extension (pauses, délais de relecture…). En série, le fichier « smoke » prenait à lui seul ~4 min.
// Usage : const test = require('./parallel')('nom', 8); … test('…', async () => {…}); … test.done(); (à la toute fin du fichier)
const { suite, test: nodeTest } = require('node:test');

module.exports = (name, concurrency = 8) => {
  const list = [];
  const test = (title, opts, fn) => list.push([title, typeof opts === 'function' ? {} : opts, typeof opts === 'function' ? opts : fn]);
  test.done = () => suite(name, { concurrency }, () => { for (const [title, opts, fn] of list) nodeTest(title, opts, fn); });
  return test;
};
