chrome.storage.local.get('stats').then(({ stats }) => {
  const out = document.getElementById('out');
  if (!stats) { out.textContent = 'Aucune statistique pour le moment.'; return; }
  const mk = (tag, ...kids) => { const n = document.createElement(tag); n.append(...kids); return n; };
  const rows = Object.entries(stats.rarity).map(([r, n]) =>
    mk('tr', mk('td', r), mk('td', String(n)), mk('td', `${stats.cards ? ((n / stats.cards) * 100).toFixed(1) : 0} %`)));
  out.replaceChildren(mk('p', `${stats.packs} paquets · ${stats.cards} cartes`), mk('table', ...rows));
});
