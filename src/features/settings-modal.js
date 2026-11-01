// Fenêtre flottante « Paramètres de l'extension » (mêmes principes que le modal de l'ancienne extension,
// avec notre style et nos réglages). Les changements ne sont appliqués qu'avec « Appliquer ».
(() => {
  const { el } = WMX.dom;
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

  WMX.DEFAULTS = {
    speed: 'normal', order: 'rarity', images: true,
    stopOn: 'off', reserve: 0, fullStockOpen: true, anticipate: true,
  };

  const SECTIONS = [
    {
      title: 'Révélation',
      desc: 'Animation et ordre d’affichage des cartes après l’ouverture.',
      items: [
        { key: 'speed', type: 'select', label: 'Vitesse de révélation', desc: 'Durée des secousses et des retournements.',
          options: [['normal', 'Normale'], ['fast', 'Rapide'], ['instant', 'Instantanée']] },
        { key: 'order', type: 'select', label: 'Ordre des cartes', desc: 'Du plus commun au plus rare, ou dans l’ordre du tirage.',
          options: [['rarity', 'Par rareté'], ['draw', 'Du tirage']] },
        { key: 'images', type: 'toggle', label: 'Images et descriptions Wikipédia', desc: 'Affiche l’illustration et la description de chaque carte (une requête vers Wikipédia par carte).' },
      ],
    },
    {
      title: 'Ouverture automatique',
      desc: 'À chaque fin d’intervalle, « Ouvrir automatiquement » ouvre tous les paquets disponibles (au-dessus de la réserve).',
      items: [
        { key: 'stopOn', type: 'select', label: 'S’arrêter sur une belle carte', desc: 'Arrête l’ouverture auto dès qu’une carte de cette rareté (ou mieux) est tirée.',
          options: [['off', 'Jamais'], ['SR', 'SR ou mieux'], ['UR', 'UR ou mieux'], ['L', 'Légendaire']] },
        { key: 'reserve', type: 'select', label: 'Réserve de paquets', desc: 'Paquets gardés en stock : l’auto n’ouvre que s’il en reste plus.', number: true,
          options: [...Array(10).keys()].map((i) => [i, plural(i, 'paquet')]) },
        { key: 'fullStockOpen', type: 'toggle', label: 'Ouvrir quand le stock est plein', desc: 'À 10/10, ouvre aussitôt les paquets au-dessus de la réserve pour ne pas bloquer la régénération.' },
        { key: 'anticipate', type: 'toggle', label: 'Anticiper le blocage du stock', desc: 'Ouvre un paquet plus tôt si le stock risque d’être plein avant la prochaine ouverture planifiée.' },
      ],
    },
    {
      title: 'Données',
      desc: 'Historique de vos tirages, conservé sur cet ordinateur.',
      items: [
        { type: 'action', label: 'Historique par jour', desc: 'Paquets, cartes et raretés tirés chaque jour.', button: 'Exporter en CSV', run: () => WMX.stats.exportCsv() },
      ],
    },
  ];

  WMX.openSettings = function openSettings() {
    if (document.querySelector('.wmx-modal-backdrop')) return;
    let draft = { ...WMX.settings };
    const content = el('div', { class: 'wmx-modal-body' });

    const control = (it) => {
      if (it.type === 'select') {
        const s = el('select', { class: 'wmx-input wmx-select' }, ...it.options.map(([v, l]) => el('option', { value: String(v) }, l)));
        s.value = String(draft[it.key]);
        s.addEventListener('change', () => { draft[it.key] = it.number ? Number(s.value) : s.value; });
        return s;
      }
      if (it.type === 'toggle') {
        const b = el('button', { class: 'wmx-switch', role: 'switch', 'aria-checked': String(!!draft[it.key]) });
        b.addEventListener('click', () => { draft[it.key] = !draft[it.key]; b.setAttribute('aria-checked', String(draft[it.key])); });
        return b;
      }
      return el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: it.run }, it.button);
    };

    const render = () => {
      content.replaceChildren(...SECTIONS.map((sec) => el('section', { class: 'wmx-sec' },
        el('h3', {}, sec.title), el('p', {}, sec.desc),
        el('div', { class: 'wmx-rows' }, ...sec.items.map((it) =>
          el('div', { class: 'wmx-setrow' }, el('div', {}, el('strong', {}, it.label), el('small', {}, it.desc)), control(it)))))));
    };
    render();

    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const modal = el('div', { class: 'wmx-modal', role: 'dialog', 'aria-label': 'Paramètres de l’extension' },
      el('header', {}, el('div', {}, el('h2', {}, 'Paramètres de l’extension'), el('p', {}, 'Réglez uniquement ce dont vous avez besoin.')),
        el('button', { class: 'wmx-close', title: 'Fermer', onclick: close }, '×')),
      content,
      el('footer', {}, el('span', {}, 'Les changements s’appliquent avec « Appliquer ».'),
        el('div', {},
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => { draft = { ...WMX.DEFAULTS }; render(); } }, 'Valeurs par défaut'),
          el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: close }, 'Annuler'),
          el('button', { class: 'wmx-btn', onclick: () => {
            Object.assign(WMX.settings, draft);
            WMX.store.set('wmxSettings', WMX.settings);
            close();
          } }, 'Appliquer'))));
    const backdrop = el('div', { class: 'wmx-modal-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, modal);
    document.body.append(backdrop);
  };
})();
