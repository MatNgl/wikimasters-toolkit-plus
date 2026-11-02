// Assistant de vente (désactivé par défaut) : garde des emplacements d'enchères remplis avec les cartes portant l'une des étiquettes
// choisies (Paramètres). Une carte invendue revient dans la collection avec son étiquette : l'assistant la remet donc en vente tout seul.
// Pour vendre des cartes précises, il suffit de leur mettre l'étiquette (sélection native du jeu → « Étiqueter »).
// Tout passe par la file d'attente (mêmes gestes, même prix de départ que le bouton ⚡). Un seul onglet agit à la fois.
// Garde-fous : jamais une carte favorite ; une vente annulée à la main écarte la carte 12 h ; 2 échecs de suite l'écartent 6 h ;
// au plus 4 mises en vente automatiques par carte et par jour ; jamais plus d'enchères actives que le plafond choisi.
(() => {
  const { sleep } = WMX.dom;
  const H = WMX.logic.HOUR;
  const S = { skip: {}, log: {}, fails: {}, leader: !navigator.locks?.request, busy: false };
  const on = () => !!WMX.settings?.autoSell;
  const tags = () => String(WMX.settings?.autoSellTags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const maxActive = () => Math.max(1, Math.min(10, Number(WMX.settings?.autoSellMax) || 3));
  const save = () => { WMX.store.set('autoSellSkip', S.skip); WMX.store.set('autoSellLog', S.log); };

  function skipCard(id, ms) { S.skip[id] = Date.now() + ms; save(); }

  /** Une passe : remplit les emplacements libres avec des cartes éligibles (file vide, inventaire chargé, onglet leader). */
  async function tick() {
    if (!on() || !S.leader || S.busy || !WMX.alive()) return;
    if (WMX.quick.isRunning()) return;
    const items = WMX.inventory.items(); // la liste en cache suffit : l'inventaire se recharge parfois pendant des minutes (jeu lent)
    if (!items.length || !tags().length) return;
    S.busy = true;
    try {
      await WMX.quick.refresh();
      const free = Math.min(maxActive() - WMX.quick.count(), WMX.quick.max() - WMX.quick.count());
      if (free <= 0) return;
      const now = Date.now();
      const busy = new Set(items.filter((it) => WMX.quick.stateOf(it.card_id) !== 'idle').map((it) => it.card_id));
      const picks = WMX.logic.pickAutoSell(items, { tags: tags(), free, busy, skip: S.skip, log: S.log, now, perDay: 4, avg: (it) => WMX.prices.get(it.card_id, it.rarity)?.avg || 0 });
      if (!picks.length) return;
      for (const it of picks) (S.log[it.card_id] = (S.log[it.card_id] || []).filter((t) => now - t < 24 * H)).push(now);
      save();
      WMX.journal?.add('Assistant de vente', `${picks.length} carte${picks.length > 1 ? 's' : ''} mise${picks.length > 1 ? 's' : ''} en file : ${picks.map((p) => p.title).join(', ')}`);
      WMX.quick.bulk('launch', picks);
    } finally { S.busy = false; }
  }

  WMX.register({
    name: 'auto-sell',
    match: /./,
    async init() {
      S.skip = await WMX.store.get('autoSellSkip', {});
      S.log = await WMX.store.get('autoSellLog', {});
      // Un seul onglet pilote l'assistant ; si on le ferme, un autre prend le relais.
      if (navigator.locks?.request) navigator.locks.request('wmx-autosell', () => { S.leader = true; return new Promise(() => {}); });
      WMX.quick.onResult((op, res) => {
        if (op.type === 'cancel') skipCard(op.item.card_id, 12 * H); // vente annulée par vous : l'assistant ne la relance pas
        if (op.type !== 'launch') return;
        if (res.ok) { delete S.fails[op.item.card_id]; return; }
        if (res.skipped || res.limit) return;
        S.fails[op.item.card_id] = (S.fails[op.item.card_id] || 0) + 1;
        if (S.fails[op.item.card_id] >= 2) { skipCard(op.item.card_id, 6 * H); delete S.fails[op.item.card_id]; WMX.journal?.add('Assistant de vente', `${op.item.title} écartée 6 h (deux échecs de suite)`, 'warn'); }
      });
      (async () => { // boucle détachée : init() ne doit pas bloquer le démarrage des autres fonctions
        await sleep(25000); // laisse l'inventaire, les prix et la liste des ventes se charger
        for (;;) {
          if (!WMX.alive()) return;
          try { await tick(); } catch (e) { console.warn('[WMX] assistant de vente', e); }
          await sleep(45000);
        }
      })();
    },
  });
  WMX.autoSell = { tick, skipCard };
})();
