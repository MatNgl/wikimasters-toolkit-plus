// Journal d'activité : les dernières actions et incidents de l'extension (file d'attente, assistant de vente, mises automatiques,
// page du jeu inattendue), gardés sur cet ordinateur. Sert à comprendre un échec sans deviner, et à me le transmettre :
// « Copier le diagnostic » (Paramètres) met un résumé prêt à coller.
(() => {
  const KEY = 'activityLog';
  const MAX = 200;
  let chain = Promise.resolve();
  const when = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const version = () => { try { return chrome.runtime.getManifest().version; } catch (_) { return '?'; } };

  WMX.journal = {
    /** level : 'info' | 'warn' | 'error'. Écritures mises en série (aucune entrée écrasée par une autre). */
    add(kind, text, level = 'info') {
      const entry = { t: Date.now(), kind, text: String(text).slice(0, 300), level };
      chain = chain.then(async () => {
        const list = await WMX.store.get(KEY, []);
        list.push(entry);
        await WMX.store.set(KEY, list.slice(-MAX));
      }).catch(() => {});
      return chain;
    },
    list: () => WMX.store.get(KEY, []),
    clear: () => WMX.store.set(KEY, []),
    async report() {
      const list = await WMX.journal.list();
      const head = `WikiMasters Toolkit+ ${version()} · ${location.pathname} · ${new Date().toLocaleString('fr-FR')}`;
      return [head, ...list.map((e) => `${when(e.t)} [${e.level}] ${e.kind} — ${e.text}`)].join('\n');
    },
    async copy() {
      try { await navigator.clipboard.writeText(await WMX.journal.report()); WMX.toast?.('Diagnostic copié : collez-le dans la conversation.', 5000); } catch (_) { WMX.toast?.('Copie impossible : ouvrez le journal et copiez-le à la main.', 6000); }
    },
    async show() {
      if (document.querySelector('.wmx-jbackdrop')) return;
      const { el } = WMX.dom;
      const list = (await WMX.journal.list()).slice().reverse();
      const close = () => back.remove();
      const rows = list.length ? list.map((e) => el('div', { class: `wmx-jrow ${e.level}` }, el('time', {}, when(e.t)), el('b', {}, e.kind), el('span', {}, e.text)))
        : [el('p', { class: 'wmx-jempty' }, 'Rien pour l’instant : le journal se remplit au fil des actions.')];
      const back = el('div', { class: 'wmx-modal-backdrop wmx-jbackdrop', onmousedown: (ev) => { if (ev.target === back) close(); } },
        el('div', { class: 'wmx-modal', role: 'dialog', 'aria-label': 'Journal d’activité' },
          el('header', {}, el('div', {}, el('h2', {}, 'Journal d’activité'), el('p', {}, 'Les 200 derniers événements, du plus récent au plus ancien.')), el('button', { class: 'wmx-close', title: 'Fermer', onclick: close }, '×')),
          el('div', { class: 'wmx-modal-body wmx-jlist' }, ...rows),
          el('footer', {}, el('span', {}, ''), el('div', {},
            el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: () => WMX.journal.copy() }, 'Copier le diagnostic'),
            el('button', { class: 'wmx-btn wmx-btn--ghost', onclick: async () => { await WMX.journal.clear(); close(); } }, 'Vider'),
            el('button', { class: 'wmx-btn', onclick: close }, 'Fermer')))));
      document.body.append(back);
    },
  };
})();
