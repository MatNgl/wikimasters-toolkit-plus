// Statistiques d'ouverture : paquets, cartes, répartition des raretés.
(() => {
  const ALIASES = {
    legendaire: 'L', ultra_rare: 'UR', super_rare: 'SR', rare: 'R', peu_commun: 'PC', commun: 'C',
  };
  WMX.normRarity = (r) => {
    const s = String(r || '').toLowerCase().trim();
    return ALIASES[s] || (WMX.RARITIES.includes(r) ? r : WMX.RARITIES.find((x) => x.toLowerCase() === s) || null);
  };

  const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
  const empty = () => ({ packs: 0, cards: 0, rarity: Object.fromEntries(WMX.RARITIES.map((r) => [r, 0])), since: Date.now(), value: 0, valuedPacks: 0 });
  WMX.stats = {
    async get() { return WMX.store.get('stats', empty()); },
    async reset() { await WMX.store.set('stats', empty()); },
    /** Valeur (somme des moyennes du marché) d'un lot de `packs` paquets dont TOUS les prix sont connus. */
    async addValue(value, packs) {
      const s = await this.get();
      s.value = (s.value || 0) + value;
      s.valuedPacks = (s.valuedPacks || 0) + packs;
      await WMX.store.set('stats', s);
    },
    async record(cards) {
      const s = await this.get();
      s.packs += 1;
      for (const c of cards) {
        const r = WMX.normRarity(c.rarity);
        s.cards += 1;
        if (r) s.rarity[r] += 1;
      }
      await WMX.store.set('stats', s);
      // Historique par jour (conservé même après « Réinitialiser les statistiques »).
      const h = await WMX.store.get('history', {});
      const d = (h[today()] ||= { packs: 0, cards: 0, rarity: Object.fromEntries(WMX.RARITIES.map((r) => [r, 0])) });
      d.packs += 1;
      for (const c of cards) {
        const r = WMX.normRarity(c.rarity);
        d.cards += 1;
        if (r) d.rarity[r] += 1;
      }
      await WMX.store.set('history', h);
    },
    async exportCsv() {
      const h = await WMX.store.get('history', {});
      const rows = ['date,paquets,cartes,' + WMX.RARITIES.join(',')];
      for (const day of Object.keys(h).sort()) rows.push([day, h[day].packs, h[day].cards, ...WMX.RARITIES.map((r) => h[day].rarity[r])].join(','));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
      a.download = 'wikimasters-historique.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
