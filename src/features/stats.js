// Statistiques d'ouverture : paquets, cartes, répartition des raretés.
(() => {
  const ALIASES = {
    legendaire: 'L', ultra_rare: 'UR', super_rare: 'SR', rare: 'R', peu_commun: 'PC', commun: 'C',
  };
  WMX.normRarity = (r) => {
    const s = String(r || '').toLowerCase().trim();
    return ALIASES[s] || (WMX.RARITIES.includes(r) ? r : WMX.RARITIES.find((x) => x.toLowerCase() === s) || null);
  };

  const empty = () => ({ packs: 0, cards: 0, rarity: Object.fromEntries(WMX.RARITIES.map((r) => [r, 0])), since: Date.now() });
  WMX.stats = {
    async get() { return WMX.store.get('stats', empty()); },
    async reset() { await WMX.store.set('stats', empty()); },
    async record(cards) {
      const s = await this.get();
      s.packs += 1;
      for (const c of cards) {
        const r = WMX.normRarity(c.rarity);
        s.cards += 1;
        if (r) s.rarity[r] += 1;
      }
      await WMX.store.set('stats', s);
    },
  };

  WMX.register({
    name: 'stats',
    init() {
      // Une réponse POST dont le chemin évoque l'ouverture d'un paquet et contenant des cartes.
      WMX.onApi(({ path, method, data }) => {
        if (method !== 'POST' || !/pull|pack|open|booster/i.test(path)) return;
        const cards = WMX.findCards(data);
        if (cards.length) WMX.stats.record(cards);
      });
    },
  });
})();
