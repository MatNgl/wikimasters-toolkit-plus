chrome.storage.local.get('stats').then(({ stats }) => {
  const out = document.getElementById('out');
  if (!stats) { out.textContent = 'Aucune statistique pour le moment.'; return; }
  const rows = Object.entries(stats.rarity).map(([r, n]) =>
    `<tr><td>${r}</td><td>${n}</td><td>${stats.cards ? ((n / stats.cards) * 100).toFixed(1) : 0} %</td></tr>`).join('');
  out.innerHTML = `<p>${stats.packs} paquets · ${stats.cards} cartes</p><table>${rows}</table>`;
});
