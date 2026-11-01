// Cache de prix moyens par carte, alimenté par les réponses du marché et des échanges.
(() => {
  WMX.prices = {
    async all() { return WMX.store.get('prices', {}); },
    async update(entries) {
      const p = await this.all();
      for (const [id, price] of entries) {
        const h = p[id] || { n: 0, avg: 0 };
        h.avg = (h.avg * h.n + price) / (h.n + 1);
        h.n += 1; h.last = price; h.t = Date.now();
        p[id] = h;
      }
      await WMX.store.set('prices', p);
    },
  };

  WMX.register({
    name: 'prices',
    init() {
      WMX.onApi(({ path, data }) => {
        if (!/marketplace|history/i.test(path)) return;
        const rows = WMX.findCards(data).filter((c) => c.id != null && Number(c.price ?? c.final_price) > 0);
        WMX.prices.update(rows.map((c) => [c.card_id ?? c.id, Number(c.price ?? c.final_price)]));
      });
    },
  });
})();
