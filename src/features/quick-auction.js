// Enchère rapide (bouton ⚡ de Collection+) : un clic met la carte aux enchères avec le prix de départ calculé
// (moyenne du marché × coefficient, mode prudent optionnel) et la durée choisie dans les paramètres ; un second
// clic annule l'enchère si le jeu le permet. Tout passe par le formulaire et les boutons du jeu, pilotés comme
// le ferait l'utilisateur dans le cadre invisible de la Collection : l'extension n'invente aucun appel.
(() => {
  const { el, sleep, waitFor } = WMX.dom;
  const LABELS = { '10min': '10 min', '30min': '30 min', '1h': '1 h', '3h': '3 h', '6h': '6 h', '12h': '12 h' };
  const MINUTES = { '10 min': 10, '30 min': 30, '1 h': 60, '3 h': 180, '6 h': 360, '12 h': 720 };
  const S = { selling: new Map(), max: 10, busy: false };
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => { try { cb(); } catch (_) { /* écouteur obsolète */ } });

  const cfg = () => ({ coef: Number(WMX.settings?.quickCoef) || 0.9, dur: LABELS[WMX.settings?.quickDuration] || '1 h', prudent: !!WMX.settings?.quickPrudent });

  /** Prix de départ : moyenne × coefficient, plafonné à 1,2 × dernière vente en mode prudent, arrondi, 1 W minimum. */
  function startPrice(p) {
    const c = cfg();
    let v = p.avg * c.coef;
    if (c.prudent && p.last) v = Math.min(v, p.last * 1.2);
    return Math.max(1, Math.round(v));
  }

  /** Mes enchères en cours, d'après le même appel que la page Marché (champ `selling`). */
  async function refresh() {
    try {
      const u = new URL('/api/marketplace', location.origin);
      u.searchParams.set('page', '1'); u.searchParams.set('limit', '50'); u.searchParams.set('sort', 'recent'); u.searchParams.set('mine', '1');
      const res = await fetch(u);
      if (!res.ok) return;
      const j = await res.json();
      S.max = j.maxConcurrentAuctions || 10;
      S.selling = new Map((j.selling || []).filter((a) => a.status === 'active').map((a) => [a.card_id, a]));
      notify();
    } catch (_) { /* réseau : on garde l'état précédent */ }
  }

  function setNumber(w, input, v) {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(v));
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
  }

  const fixedAncestor = (w, e) => {
    let m = e;
    while (m && w.getComputedStyle(m).position !== 'fixed') m = m.parentElement;
    return m;
  };

  const SHEET_ERRORS = {
    frame: 'Impossible de charger la fiche pour le moment.',
    notfound: 'Carte introuvable dans la recherche du jeu.',
    nosheet: 'La fiche ne s’est pas ouverte.',
  };

  /** Ouvre la fiche (cachée), le formulaire d'enchère, saisit le prix et la durée, puis lance. */
  async function driveForm(item, price, dur) {
    const r = await WMX.sheet.openInFrame({ id: item.card_id, wikipedia_title: item.title, rarity: item.rarity });
    if (r.error) return { error: SHEET_ERRORS[r.error] };
    const { d, w, root } = r;
    try {
      const open = [...root.querySelectorAll('button')].find((b) => /Mettre aux enchères/i.test(b.textContent));
      if (!open || open.disabled) return { error: 'Le jeu ne permet pas de mettre cette carte aux enchères (déjà en vente, favorite ou en échange ?).' };
      open.click();
      const launch = await waitFor(() => [...d.querySelectorAll('button')].find((b) => /Lancer l.enchère/i.test(b.textContent)), 8000, 150);
      if (!launch) return { error: 'Le formulaire d’enchère ne s’est pas ouvert.' };
      const form = fixedAncestor(w, launch) || d.body;
      const input = form.querySelector('input[aria-label="Mise de départ"], input[type=number]');
      if (!input) return { error: 'Champ « Mise de départ » introuvable.' };
      setNumber(w, input, price);
      const pill = [...form.querySelectorAll('button')].find((b) => b.textContent.trim() === dur);
      pill?.click();
      await sleep(350);
      if (Number(input.value) !== price) return { error: 'Le prix saisi n’a pas été pris en compte : rien n’a été lancé.' };
      launch.click();
      const closed = await waitFor(() => !/Lancer l.enchère/i.test(d.body.innerText), 9000, 200);
      return closed ? { ok: true } : { error: 'Le jeu n’a pas confirmé l’enchère.' };
    } finally {
      WMX.sheet.closeSheet();
    }
  }

  /** Annule une enchère depuis sa page de détail (/marketplace/{id}), chargée dans un cadre invisible. */
  async function cancelAuction(auction) {
    const f = el('iframe', { class: 'wmx-sheet-frame', src: `/marketplace/${auction.id}`, title: 'Annulation', tabindex: '-1' });
    document.body.append(f);
    try {
      const find = (re) => { try { return [...f.contentDocument.querySelectorAll('button')].find((b) => re.test(b.textContent)); } catch (_) { return null; } };
      const btn = await waitFor(() => find(/Annuler et récupérer/i), 90000, 400);
      if (!btn) return { error: 'Annulation impossible : bouton introuvable (enchère déjà misée ou terminée ?).' };
      // L'utilisateur a déjà décidé en cliquant sur ⚡ : la confirmation du jeu (alerte du navigateur) répond « oui »
      // d'elle-même, sans second clic. Réglé juste avant le clic, dans la page d'annulation uniquement.
      // L'extension vit dans un monde JavaScript isolé : modifier `confirm` d'ici ne change pas celui de la page.
      // On injecte donc un petit script DANS la page du cadre (monde principal) avant de cliquer.
      try {
        const d = f.contentDocument;
        const s = d.createElement('script');
        s.textContent = 'window.confirm=function(){return true};window.alert=function(){}';
        d.head.append(s);
        s.remove();
      } catch (_) { /* page non accessible */ }
      btn.click();
      // Une confirmation peut s'afficher : on la valide comme le ferait l'utilisateur.
      const confirm = await waitFor(() => find(/^(Confirmer|Oui|Valider|Annuler la vente|Annuler l.enchère)/i), 2500, 150);
      confirm?.click();
      return { ok: true };
    } finally {
      await sleep(600);
      f.remove();
    }
  }

  async function launch(item) {
    const c = cfg();
    S.busy = true; notify();
    try {
      WMX.toast(`Préparation de l’enchère : ${item.title}…`, 90000);
      let p = WMX.prices.get(item.card_id, item.rarity);
      if (!p) { await WMX.prices.fetchOne(item.card_id); p = WMX.prices.get(item.card_id, item.rarity); }
      if (!p) return WMX.toast('Prix introuvable pour cette carte : aucune enchère lancée.');
      const price = startPrice(p);
      const res = await WMX.sheet.exclusive(() => driveForm(item, price, c.dur));
      if (!res.ok) return WMX.toast(res.error, 7000);
      await sleep(1500);
      await refresh();
      const a = S.selling.get(item.card_id);
      if (!a) return WMX.toast('L’enchère n’a pas pu être confirmée : vérifiez sur le Marché.', 7000);
      const minutes = Math.round((new Date(a.end_at) - Date.now()) / 60000);
      const off = MINUTES[c.dur] && Math.abs(minutes - MINUTES[c.dur]) > 3 ? ` (durée réelle : ${minutes} min)` : '';
      WMX.toast(`Enchère lancée : ${item.title} à ${a.base_amount} W pour ${c.dur}${off}. Recliquez sur ⚡ pour l’annuler.`, 7000);
    } finally {
      S.busy = false; notify();
    }
  }

  async function cancel(item) {
    const a = S.selling.get(item.card_id);
    S.busy = true; notify();
    try {
      WMX.toast(`Annulation de l’enchère : ${item.title}…`, 120000);
      const res = await cancelAuction(a);
      if (!res.ok) return WMX.toast(res.error, 7000);
      await sleep(1500);
      await refresh();
      WMX.toast(S.selling.has(item.card_id) ? 'Le jeu n’a pas annulé l’enchère (déjà misée ?).' : `Enchère annulée : ${item.title} est de retour dans votre collection.`, 7000);
    } finally {
      S.busy = false; notify();
    }
  }

  WMX.quick = {
    refresh,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    isBusy: () => S.busy,
    selling: (cardId) => S.selling.get(cardId) || null,
    count: () => S.selling.size,
    max: () => S.max,
    /** Texte de l'infobulle du bouton ⚡ d'une carte. */
    hint(item) {
      const a = S.selling.get(item.card_id);
      if (a) return `En vente à ${a.base_amount} W${a.current_bid ? ` (mise actuelle ${a.current_bid} W)` : ''} : cliquez pour annuler`;
      if (item.starred) return 'Carte favorite : verrouillée, impossible de la vendre';
      const c = cfg();
      const p = WMX.prices.get(item.card_id, item.rarity);
      return p ? `Enchère rapide : ${startPrice(p)} W pendant ${c.dur} (moyenne ${Math.round(p.avg)} W × ${c.coef})` : 'Enchère rapide (le prix sera chargé au clic)';
    },
    /** Un clic lance l'enchère ; un second clic l'annule. */
    async toggle(item) {
      if (S.busy) return WMX.toast('Une opération d’enchère est déjà en cours…');
      if (S.selling.has(item.card_id)) return cancel(item);
      if (item.starred) return WMX.toast('Carte favorite : le jeu la verrouille, impossible de la vendre.');
      if (S.selling.size >= S.max) return WMX.toast(`Limite de ${S.max} enchères actives atteinte.`);
      return launch(item);
    },
  };
})();
