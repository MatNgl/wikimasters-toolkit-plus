// Filtre « valeur » dans la collection (s'ajoute aux filtres natifs).
(() => {
  const { el } = WMX.dom;
  WMX.register({
    name: 'collection-filter',
    match: /^\/collection/,
    init() {
      const min = el('input', { class: 'wmx-input', type: 'number', placeholder: 'Valeur min (W)' });
      const max = el('input', { class: 'wmx-input', type: 'number', placeholder: 'Valeur max (W)' });
      const apply = async () => {
        const prices = await WMX.prices.all();
        const lo = Number(min.value) || 0, hi = Number(max.value) || Infinity;
        document.querySelectorAll('[data-card-id]').forEach((card) => {
          const v = prices[card.dataset.cardId]?.avg;
          card.style.display = v == null || (v >= lo && v <= hi) ? '' : 'none';
        });
      };
      min.addEventListener('input', apply); max.addEventListener('input', apply);
      document.body.append(el('div', { class: 'wmx-bar wmx-bar--top' }, min, max));
    },
  });
})();
