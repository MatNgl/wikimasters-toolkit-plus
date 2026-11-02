// Fonctions pures (sans DOM ni stockage) : testables avec `npm test` (dossier tests/).
(function (root) {
  const HOUR = 3600 * 1000;

  const L = {
    HOUR,
    /** Seuil de ventes à partir duquel une moyenne est jugée stable. */
    STABLE_SALES: 10,
    /** Durée de validité d'un prix : 48 h, ou 96 h pour une carte très vendue (sa moyenne bouge peu). */
    priceTtl(summary, stableSales = 10) {
      const counts = Object.values(summary || {}).map((s) => Number(s?.count) || 0);
      return (counts.length && Math.max(...counts) >= stableSales ? 96 : 48) * HOUR;
    },
    /** Entrée de cache { t, s } encore valable ? */
    isFresh(entry, now = Date.now()) {
      return !!entry && Number.isFinite(entry.t) && now - entry.t < L.priceTtl(entry.s);
    },
    /** Pause (en secondes) après un refus du jeu : grandit à chaque refus consécutif ; Retry-After l'emporte s'il est plus long. */
    limitWait(blocks, retryAfterSec = 0) {
      const own = Math.min(60, 6 * Math.max(1, blocks));
      const ra = Number.isFinite(retryAfterSec) ? Math.min(120, Math.max(0, retryAfterSec)) : 0;
      return Math.max(own, ra);
    },
    /** Écart entre deux requêtes : ralenti après un refus, retrouvé très progressivement après des succès. */
    nextGap(gap, blocked, base = 600, max = 2500) {
      return blocked ? Math.min(max, Math.round(gap * 1.5)) : Math.max(base, Math.round(gap * 0.98));
    },
    /** Temps restant lisible. */
    fmtLeft(ms) {
      if (ms <= 0) return 'Terminée';
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
    },
    /** « ok » | « low » (moins de 5 min : rouge) | « urgent » (moins de 2 min : alerte) | « ended ». */
    timeState(ms) {
      if (ms <= 0) return 'ended';
      if (ms < 2 * 60 * 1000) return 'urgent';
      if (ms < 5 * 60 * 1000) return 'low';
      return 'ok';
    },
    /** Valeur moyenne d'un paquet, ou null sans paquet. */
    packAverage(totalValue, packs) {
      return packs > 0 && Number.isFinite(totalValue) ? Math.round(totalValue / packs) : null;
    },
    /** Nombre de couronnes selon le nombre de cartes ouvertes : 1 jusqu'à 7 cartes, 2 jusqu'à 14, 3 au-delà. */
    crownCount(cards) {
      return cards >= 15 ? 3 : cards >= 8 ? 2 : cards >= 1 ? 1 : 0;
    },
    /** Indices (dans `values`) des cartes les plus chères qui reçoivent une couronne ; les cartes sans prix n'en reçoivent pas. */
    crownIndexes(values) {
      const n = L.crownCount(values.length);
      return values.map((v, i) => [Number(v), i]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, n).map(([, i]) => i);
    },
    /** Message clair pour un échec réseau ou un code HTTP. */
    friendlyError(status) {
      if (status === 0 || status == null) return 'Connexion impossible : vérifiez votre réseau.';
      if (status === 401) return 'Session expirée : reconnectez-vous au jeu.';
      if (status === 403 || status === 429) return 'Le jeu limite les requêtes : l’extension patiente avant de reprendre.';
      if (status === 404) return 'Élément introuvable : le jeu a peut-être changé cette adresse.';
      if (status >= 500) return 'Le serveur du jeu ne répond pas correctement (erreur ' + status + ').';
      return 'Réponse inattendue du jeu (erreur ' + status + ').';
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  if (root.WMX) root.WMX.logic = L;
})(typeof window !== 'undefined' ? window : globalThis);
