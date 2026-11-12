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
      const when = rule.mode === 'outbid' ? 'dès surenchère' : rule.secs < 120 ? `sous ${rule.secs} s` : `sous ${Math.round(rule.secs / 60)} min`;
      const cap = L.capLabel(rule);
      return `${rule.watch ? 'Veille' : 'Auto'} · ${when}${cap ? ` · ${cap}` : ''}`;
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
      // Dans la fenêtre de surenchère (compteur sous le délai choisi ; moins d'1 min pour « dès surenchère ») : actualisation toutes les 2 s,
      // pour voir une surenchère adverse au plus vite et répondre avant la fin.
      if (items.some(({ rule, msLeft }) => msLeft > 0 && msLeft <= (rule.mode === 'outbid' ? 60000 : rule.secs * 1000))) return 2000;
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
     * Moyenne du marché + verdict d'une enchère, prêts à afficher (bulle des enchères, page d'une enchère).
     * role « sale » : une de MES ventes (bénéfice / prix du marché / à perte) ; sinon une enchère à acheter (bonne affaire / correct / trop cher).
     * p = { avg, count, last } ou null (aucune vente sur le marché pour cette rareté).
     */
    priceNote(role, price, p) {
      const v = role === 'sale' ? L.saleVerdict(price, p && p.avg, p && p.count) : L.dealVerdict(price, p && p.avg, p && p.count);
      const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
      return {
        kind: v.kind,
        avg: p ? 'Moy. ' + fmt(p.avg) + ' W' : 'Sans vente',
        verdict: v.kind === 'unknown' ? v.label : (v.pct > 0 ? '+' : '') + v.pct + ' % · ' + v.label,
        title: (role === 'sale' ? 'Votre vente comparée à la moyenne du marché. ' : '') + (p
          ? 'Moyenne de ' + p.count + ' vente' + (p.count > 1 ? 's' : '') + ' de cette rareté · dernière vente ' + fmt(p.last) + ' W' + (v.low ? ' · peu de ventes : estimation fragile' : '')
          : 'Aucune vente de cette rareté sur le marché'),
      };
    },
    /**
     * Verdict d'une de MES ventes : le prix (mise reçue ou, à défaut, prix de départ) comparé à la moyenne du marché.
     * Au-dessus de la moyenne : bénéfice ; en dessous : à perte ; pile sur la moyenne (écart arrondi à 0 %) : prix du marché.
     * (Pour une enchère à ACHETER, les mots sont autres : voir dealVerdict.)
     */
    saleVerdict(price, avg, count) {
      const p = Number(price);
      const a = Number(avg);
      if (!(a > 0) || !(p >= 0)) return { kind: 'unknown', label: 'Prix inconnu', pct: 0, low: false };
      const ratio = p / a;
      const pct = Math.round((ratio - 1) * 100);
      const low = Number(count) < 3;
      if (pct > 0) return { kind: 'profit', label: 'Bénéfice', pct, low };
      if (pct === 0) return { kind: 'even', label: 'Prix du marché', pct, low };
      return { kind: 'loss', label: 'À perte', pct, low };
    },
    /**
     * Assistant de vente : quelles cartes mettre en vente pour remplir les emplacements libres.
     * items : cartes de l'inventaire { card_id, title, rarity, starred, count, tags: [{ name }] }.
     * o : { tags: [noms], free: emplacements à remplir, busy: Set(card_id) déjà en vente/en file, skip: { card_id: jusqu'à (ms) },
     *       log: { card_id: [dates de mise en vente auto] }, cap: moyenne maximale (W), now, perDay: mises en vente max par carte et par 24 h, avg: (carte) => moyenne ou null }.
     * Jamais une carte favorite, déjà en vente, écartée (annulée à la main, échecs répétés) ou déjà remise en vente trop souvent ;
     * les cartes les plus chères d'abord.
     */
    pickAutoSell(items, o) { return L.autoSellPlan(items, o).eligible.slice(0, Math.max(0, o.free || 0)); },
    /**
     * Mêmes règles que pickAutoSell, détaillées : `tagged` (cartes portant une étiquette choisie), `eligible` (triées, les plus chères d'abord)
     * et `excluded` : chaque carte étiquetée mise de côté avec sa raison ('gone' | 'favorite' | 'busy' | 'skipped' | 'capped' | 'perDay' | 'later' : rareté
     * suivante, qui attend la fin de `after`) et, pour 'skipped', la date de fin de l'écart. Sert à expliquer pourquoi telle carte n'est pas (re)mise en vente.
     * Avec une liste de raretés : `byRar` (par rareté : eligible, waiting, onSale, capped, favorite, gone), `current` (rareté servie), `outside`.
     */
    autoSellPlan(items, o) {
      const key = (s) => String(s || '').trim().toLowerCase();
      const keys = new Set((o.tags || []).map(key).filter(Boolean));
      const day = 24 * L.HOUR;
      const perDay = o.perDay || 4;
      const avg = (it) => (o.avg && o.avg(it)) || 0;
      // o.priorityRar : raretés à vendre, dans l'ordre (ex. ['UR', 'SR']). Liste vide : toutes les raretés. Liste donnée : SEULES ces raretés sont vendues
      // (les autres sont comptées dans `outside`, jamais mises en vente). o.strict (vrai par défaut) : on ne passe à la rareté suivante que lorsque la
      // rareté en cours n'a plus AUCUNE carte à vendre : ni éligible, ni écartée pour un temps (en file, écart, limite du jour), ni en vente (o.pending :
      // [{ card_id, rarity }] cartes mises en vente par l'assistant, qui reviendront si elles ne trouvent pas preneur). Une favorite, une carte trop chère ou
      // disparue ne retient jamais la rareté (sinon l'assistant resterait bloqué indéfiniment).
      const only = [...new Set((o.priorityRar || []).map((r) => String(r).trim().toUpperCase()).filter(Boolean))];
      const strict = o.strict !== false && only.length > 0;
      const plan = { tagged: 0, eligible: [], excluded: [], outside: 0, order: only, current: null, byRar: {} };
      const stat = (r) => (plan.byRar[r] = plan.byRar[r] || { eligible: 0, waiting: 0, onSale: 0, capped: 0, favorite: 0, gone: 0 });
      only.forEach(stat);
      const counted = new Set();
      if (!keys.size) return plan;
      for (const it of items || []) {
        if (!(it.count > 0) || !(it.tags || []).some((t) => keys.has(key(t.name)))) continue;
        plan.tagged += 1;
        if (only.length && !only.includes(it.rarity)) { plan.outside += 1; continue; }
        counted.add(it.card_id);
        let why = null;
        let until = null;
        if (o.gone && o.gone(it)) why = 'gone';
        else if (it.starred) why = 'favorite';
        else if (o.busy && o.busy.has(it.card_id)) why = 'busy';
        else if ((o.skip && o.skip[it.card_id]) > o.now) { why = 'skipped'; until = o.skip[it.card_id]; }
        else if (o.cap > 0 && avg(it) > o.cap) why = 'capped';
        else if (((o.log && o.log[it.card_id]) || []).filter((t) => o.now - t < day).length >= perDay) why = 'perDay';
        const s = stat(it.rarity);
        if (why) {
          plan.excluded.push({ card_id: it.card_id, title: it.title, rarity: it.rarity, reason: why, until, avg: avg(it) });
          if (why === 'capped') s.capped += 1; else if (why === 'favorite') s.favorite += 1; else if (why === 'gone') s.gone += 1; else s.waiting += 1;
        } else { plan.eligible.push(it); s.eligible += 1; }
      }
      for (const p of o.pending || []) if (p && plan.byRar[p.rarity] && !counted.has(p.card_id)) { counted.add(p.card_id); plan.byRar[p.rarity].onSale += 1; } // une carte déjà comptée (revenue, étiquetée) ne l'est pas deux fois
      // Ordre de mise en vente : par défaut la meilleure moyenne d'abord. o.order : 'avg' | 'avgLow' (moyenne la plus basse d'abord) | 'rarityHigh' | 'rarityLow'
      // (raretés hautes / basses d'abord, puis meilleure moyenne). Avec une liste de raretés : d'abord l'ordre de la liste, puis o.order dans chaque rareté.
      const rank = { L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0 };
      const pri = only;
      const prank = (it) => { const i = pri.indexOf(it.rarity); return i < 0 ? pri.length : i; };
      if (strict) {
        const left = (r) => { const s = plan.byRar[r]; return s.eligible + s.waiting + s.onSale; };
        plan.current = only.find((r) => left(r) > 0) || null;
        const later = plan.eligible.filter((it) => it.rarity !== plan.current);
        plan.eligible = plan.eligible.filter((it) => it.rarity === plan.current);
        for (const it of later) plan.excluded.push({ card_id: it.card_id, title: it.title, rarity: it.rarity, reason: 'later', until: null, avg: avg(it), after: plan.current });
      }
      plan.excluded.sort((a, b) => prank(a) - prank(b) || (rank[b.rarity] ?? 0) - (rank[a.rarity] ?? 0));
      const by = {
        avg: (a, b) => avg(b) - avg(a),
        avgLow: (a, b) => avg(a) - avg(b),
        rarityHigh: (a, b) => (rank[b.rarity] ?? 0) - (rank[a.rarity] ?? 0) || avg(b) - avg(a),
        rarityLow: (a, b) => (rank[a.rarity] ?? 0) - (rank[b.rarity] ?? 0) || avg(b) - avg(a),
      }[o.order] || ((a, b) => avg(b) - avg(a));
      plan.eligible.sort((a, b) => prank(a) - prank(b) || by(a, b) || String(a.title).localeCompare(String(b.title)));
      return plan;
    },
    /**
     * Défausse par critères : quelles cartes (et combien d'exemplaires) défausser.
     * items : cartes de l'inventaire { card_id, title, rarity, count, starred, image, tags: [{ name }] }.
     * o : {
     *   rarities: ['C', 'PC'] (vide : aucune carte — il faut choisir), tag: '' (toutes) | nom d'étiquette (seulement les cartes qui la portent),
     *   includeTagged: false (sans étiquette précise : les cartes étiquetées sont gardées), keepOne: garder 1 exemplaire (seulement les doublons),
     *   maxAvg: ne jamais défausser une carte dont la moyenne atteint ce montant (0 : pas de seuil), unpriced: 'keep' | 'discard' (prix jamais chargé),
     *   keepImage: garder les cartes avec image, onlyNoImage: seulement les cartes sans image, protectTags: [noms] jamais défaussées,
     *   busy: Set(card_id) en vente ou en file, avg: (carte) => moyenne ou 0, priced: (carte) => vrai si le prix a été chargé (même « sans vente »)
     * }.
     * Jamais une favorite, jamais une carte en vente ou en file. Rend { cards: [{ ...carte, copies, avg }], copies, value, byRar: { R: exemplaires }, kept: { raison: n } }.
     */
    discardPlan(items, o = {}) {
      const key = (s) => String(s || '').trim().toLowerCase();
      const rar = new Set((o.rarities || []).map((r) => String(r).trim().toUpperCase()));
      const tag = key(o.tag);
      const protect = new Set((o.protectTags || []).map(key).filter(Boolean));
      const avg = (it) => (o.avg && o.avg(it)) || 0;
      const plan = { cards: [], copies: 0, value: 0, byRar: {}, kept: {} };
      const keep = (why) => { plan.kept[why] = (plan.kept[why] || 0) + 1; };
      for (const it of items || []) {
        if (!(it.count > 0) || !rar.has(it.rarity)) continue;
        const names = (it.tags || []).map((t) => key(t.name));
        if (tag ? !names.includes(tag) : (names.length && !o.includeTagged)) continue; // hors du choix (pas compté comme « gardée »)
        const a = avg(it);
        let why = null;
        if (it.starred) why = 'favorite';
        else if (o.busy && o.busy.has(it.card_id)) why = 'busy';
        else if (names.some((n) => protect.has(n))) why = 'protected';
        else if (o.keepImage && it.image) why = 'image';
        else if (o.onlyNoImage && it.image) why = 'image';
        else if (o.maxAvg > 0 && a >= o.maxAvg) why = 'value';
        else if (o.unpriced !== 'discard' && o.priced && !o.priced(it)) why = 'unpriced';
        else if (o.keepOne && it.count < 2) why = 'single';
        if (why) { keep(why); continue; }
        const copies = o.keepOne ? it.count - 1 : it.count;
        plan.cards.push({ ...it, copies, avg: a });
        plan.copies += copies;
        plan.value += a * copies;
        plan.byRar[it.rarity] = (plan.byRar[it.rarity] || 0) + copies;
      }
      const rank = { L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0 };
      plan.cards.sort((x, y) => (rank[y.rarity] ?? 0) - (rank[x.rarity] ?? 0) || y.avg - x.avg || String(x.title).localeCompare(String(y.title)));
      return plan;
    },
    /** Stock maximum de paquets, quel que soit le compte. */
    PACK_MAX: 10,
    /** Recharge d'un paquet (secondes) : 3 min en compte Pro, 10 min en compte classique. */
    packRegen(account) { return account === 'pro' ? 180 : 600; },
    /**
     * Type de compte d'après le texte de la page Paquets : 'pro' (encadré « Pack PRO du jour », à ouvrir ou déjà réclamé, « Reviens demain »),
     * 'classic' (proposition de passer Pro), ou null (rien de concluant : page pas encore affichée).
     */
    packAccount(text) {
      const s = String(text || '');
      if (/pack\s+pro\s+du\s+jour/i.test(s)) return 'pro';
      if (/(passe[rz]?|deviens|devenir|abonne[rz]?|essaie[rz]?|découvre[rz]?)\b[^.\n]{0,40}\bpro\b/i.test(s)) return 'classic';
      return null;
    },
    /**
     * Stock de paquets estimé à `now` d'après un relevé de la page Paquets : snap = { packs, t, nextAt (date d'arrivée du prochain paquet, ms) }
     * (ancien format accepté : nextIn en secondes au moment t). Les paquets suivants arrivent toutes les `regenS` secondes, jusqu'à 10.
     * Rend { packs, max, nextIn (s, null si plein ou inconnu), nextAt, fullAt (date où le stock sera plein) } ou null sans relevé.
     */
    packEstimate(snap, now, regenS) {
      if (!snap || !Number.isFinite(snap.t)) return null;
      const max = L.PACK_MAX;
      const step = Math.max(1, regenS || 600) * 1000;
      let packs = Math.min(max, Math.max(0, Math.floor(Number(snap.packs) || 0)));
      let nextAt = Number.isFinite(snap.nextAt) ? snap.nextAt : (Number.isFinite(snap.nextIn) ? snap.t + snap.nextIn * 1000 : null);
      if (packs >= max) return { packs: max, max, nextIn: null, nextAt: null, fullAt: null };
      if (nextAt == null) return { packs, max, nextIn: null, nextAt: null, fullAt: null };
      if (now >= nextAt) {
        const n = 1 + Math.floor((now - nextAt) / step);
        packs = Math.min(max, packs + n);
        nextAt += n * step;
      }
      if (packs >= max) return { packs: max, max, nextIn: null, nextAt: null, fullAt: null };
      return { packs, max, nextIn: Math.max(0, (nextAt - now) / 1000), nextAt, fullAt: nextAt + (max - packs - 1) * step };
    },
    /** Message clair pour un échec réseau ou un code HTTP. */
    friendlyError(status) {
      if (status === 0 || status == null) return 'Pas de connexion au jeu : vérifiez votre connexion internet.';
      if (status === 401) return 'Votre connexion au jeu a expiré : reconnectez-vous.';
      if (status === 403 || status === 429) return 'Le jeu trouve que ça va trop vite : l’extension patiente avant de reprendre.';
      if (status === 404) return 'Le jeu ne retrouve pas cet élément : il a peut-être changé son site.';
      if (status >= 500) return 'Le serveur du jeu a un souci en ce moment. Réessayez dans quelques minutes.';
      return 'Le jeu a répondu de façon inattendue. Réessayez dans un instant.';
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  if (root.WMX) root.WMX.logic = L;
})(typeof window !== 'undefined' ? window : globalThis);
