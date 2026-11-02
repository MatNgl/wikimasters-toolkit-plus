// Fonctions pures (sans DOM ni stockage) : testables avec `npm test` (dossier tests/).
(function (root) {
  const HOUR = 3600 * 1000;

  const L = {
    HOUR,
    /** Durée de validité d'un prix : 4 jours pour toutes les cartes. Un prix plus ancien n'est rechargé que sur demande. */
    priceTtl() {
      return 96 * HOUR;
    },
    /** Entrée de cache { t, s } encore valable ? */
    isFresh(entry, now = Date.now()) {
      return !!entry && Number.isFinite(entry.t) && now - entry.t < L.priceTtl(entry.s);
    },
    /**
     * Plan d'un chargement de prix : d'abord les cartes dont le prix n'a JAMAIS été chargé ; ce n'est qu'une fois toutes passées
     * au moins une fois qu'on actualise celles dont le prix a plus de 4 jours. Ne touche jamais un prix encore valable.
     * `has(it)` : un prix a déjà été chargé ; `fresh(it)` : il a moins de 4 jours.
     */
    priceBatch(items, has, fresh) {
      const missing = items.filter((it) => !has(it));
      const stale = items.filter((it) => has(it) && !fresh(it));
      return { missing, stale, todo: missing.length ? missing : stale, refresh: !missing.length && stale.length > 0 };
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
    /**
     * Règle de mise automatique saisie par l'utilisateur → règle normalisée, ou null si invalide.
     * mode « outbid » : dès qu'on est surenchéri ; mode « time » : quand il reste `amount` secondes (ou minutes).
     * Plafond : capMode « abs » (valeur `cap` en W) ou « avg » (moyenne du marché + `capPct` %, négatif = sous la moyenne) ; sinon aucun.
     */
    parseAutoRule({ mode, amount, unit, capMode, cap, capPct } = {}) {
      const rule = {};
      const c = Math.floor(Number(cap));
      if ((capMode === 'abs' || (capMode === undefined && cap !== undefined)) && Number.isFinite(c) && c > 0) { rule.capMode = 'abs'; rule.cap = c; }
      else if (capMode === 'avg' && Number.isFinite(Number(capPct)) && capPct !== '' && capPct !== null) { rule.capMode = 'avg'; rule.capPct = Math.min(500, Math.max(-90, Math.round(Number(capPct)))); }
      if (mode === 'outbid') return { mode, ...rule };
      if (mode !== 'time') return null;
      const n = Number(amount) * (unit === 'min' ? 60 : 1);
      if (!Number.isFinite(n) || n <= 0) return null;
      return { mode, secs: Math.min(6 * 3600, Math.max(5, Math.round(n))), ...rule };
    },
    /** Plafond en W d'une règle (selon la moyenne du marché si besoin), ou null : pas de plafond, ou moyenne inconnue (à demander). */
    resolveCap(rule, avg) {
      if (!rule) return null;
      if (rule.capMode === 'avg') return avg > 0 ? Math.max(1, Math.round(avg * (1 + (Number(rule.capPct) || 0) / 100))) : null;
      return rule.cap > 0 ? rule.cap : null; // « abs » ou règle ancienne (plafond seul)
    },
    capLabel(rule) {
      if (!rule) return '';
      if (rule.capMode === 'avg') return rule.capPct ? `max moy. ${rule.capPct > 0 ? '+' : ''}${rule.capPct} %` : 'max moyenne';
      return rule.cap ? `max ${rule.cap} W` : '';
    },
    autoLabel(rule) {
      if (!rule) return '';
      const when = rule.mode === 'outbid' ? 'dès surenchère' : rule.secs < 120 ? `à ${rule.secs} s` : `à ${Math.round(rule.secs / 60)} min`;
      const cap = L.capLabel(rule);
      return `Auto · ${when}${cap ? ` · ${cap}` : ''}`;
    },
    /** Part de la fenêtre restante (1 = au moins `windowMs` restantes, 0 = terminée). */
    ringFraction(ms, windowMs = 3600000) {
      return Math.min(1, Math.max(0, ms / windowMs));
    },
    /** Couleur de l'anneau : vert (loin) → jaune → rouge (proche de la fin). */
    ringColor(fraction) {
      return `hsl(${Math.round(130 * Math.min(1, Math.max(0, fraction)))} 85% 52%)`;
    },
    /** Faut-il miser maintenant ? st = { leading, msLeft, minBid (ou null), cooldownOk }. */
    autoBidDue(rule, st) {
      if (!rule || st.leading || st.msLeft <= 0 || !st.cooldownOk) return false;
      const capW = st.capW !== undefined ? st.capW : (rule.cap > 0 ? rule.cap : null);
      if (capW != null && st.minBid && st.minBid > capW) return false;
      return rule.mode === 'outbid' ? true : st.msLeft <= rule.secs * 1000;
    },
    /** Cadence d'actualisation (ms) quand des mises automatiques existent : rapide près de l'échéance, 0 s'il n'y en a pas. */
    autoPollMs(items) {
      if (!items.length) return 0;
      const near = items.some(({ rule, msLeft }) => rule.mode === 'outbid' || msLeft <= rule.secs * 1000 + 20000);
      return near ? 4000 : 10000;
    },
    /**
     * Verdict d'une enchère : prix (mise actuelle ou de départ) comparé à la moyenne du marché.
     * ≤ 85 % de la moyenne : bonne affaire ; jusqu'à 115 % : prix correct ; au-delà : trop cher.
     */
    dealVerdict(price, avg, count) {
      const p = Number(price);
      const a = Number(avg);
      if (!(a > 0) || !(p >= 0)) return { kind: 'unknown', label: 'Prix inconnu', pct: 0, low: false };
      const ratio = p / a;
      const pct = Math.round((ratio - 1) * 100);
      const low = Number(count) < 3;
      if (ratio <= 0.85) return { kind: 'deal', label: 'Bonne affaire', pct, low };
      if (ratio <= 1.15) return { kind: 'fair', label: 'Prix correct', pct, low };
      return { kind: 'high', label: 'Trop cher', pct, low };
    },
    /**
     * Verdict d'une de MES ventes : le prix (mise reçue ou, à défaut, prix de départ) comparé à la moyenne du marché.
     * ≥ 105 % : bénéfice ; entre 95 % et 105 % : prix du marché ; en dessous : vendu sous la moyenne (à perte).
     */
    saleVerdict(price, avg, count) {
      const p = Number(price);
      const a = Number(avg);
      if (!(a > 0) || !(p >= 0)) return { kind: 'unknown', label: 'Prix inconnu', pct: 0, low: false };
      const ratio = p / a;
      const pct = Math.round((ratio - 1) * 100);
      const low = Number(count) < 3;
      if (ratio >= 1.05) return { kind: 'profit', label: 'Bénéfice', pct, low };
      if (ratio >= 0.95) return { kind: 'even', label: 'Prix du marché', pct, low };
      return { kind: 'loss', label: 'À perte', pct, low };
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
