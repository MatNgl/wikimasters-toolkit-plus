// Ouverture groupée : pilote le bouton natif du jeu (pas d'appel API forgé),
// avec un délai configurable entre deux ouvertures.
(() => {
  const { el, findByText, sleep } = WMX.dom;
  let running = false;

  async function openAll(delayMs) {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 50 && running; i++) {
        const btn = findByText('ouvrir', 'button, [role=button], div[class*=cursor-pointer]');
        const left = document.body.innerText.match(/(\d+)\s*\/\s*10\s*paquets?/i);
        if (!btn || (left && Number(left[1]) === 0)) break;
        btn.click();
        await sleep(delayMs);
      }
    } finally { running = false; }
  }

  WMX.register({
    name: 'boosters',
    match: /^\/pulls/,
    async init() {
      const delay = await WMX.store.get('openDelayMs', 1500);
      const bar = el('div', { class: 'wmx-bar' },
        el('button', { class: 'wmx-btn', onclick: () => openAll(delay) }, 'Tout ouvrir (WMX)'),
        el('button', { class: 'wmx-btn', onclick: () => { running = false; } }, 'Stop'));
      document.body.append(bar);
    },
  });
})();
