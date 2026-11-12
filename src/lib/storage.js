WMX.store = {
  async get(key, fallback) {
    try {
      const r = await chrome.storage.local.get(key);
      return r[key] ?? fallback;
    } catch (_) { return fallback; }
  },
  async set(key, value) {
    try { await chrome.storage.local.set({ [key]: value }); } catch (e) {
      // Écriture refusée (souvent : place pleine) : plus silencieuse, sinon la collection ou les prix se relisent de zéro à chaque F5 sans qu'on sache pourquoi.
      const msg = String(e?.message || e);
      if (!/context invalidated/i.test(msg) && !WMX.store.failed.has(key)) {
        WMX.store.failed.add(key);
        console.warn('[WMX] mémoire : écriture refusée pour', key, msg);
        if (key !== 'activityLog') WMX.journal?.add('Mémoire', `« ${key} » n’a pas pu être enregistré (${msg.slice(0, 120)}) : il sera relu au prochain chargement`, 'warn');
      }
    }
  },
  /** Clés dont l'écriture a déjà échoué (signalé une fois chacune). */
  failed: new Set(),
};

/** Faux dès que l'extension a été rechargée/désactivée : le script resté dans l'onglet doit alors s'arrêter. */
WMX.alive = () => {
  try { return !!chrome.runtime?.id; } catch (_) { return false; }
};

WMX.onStorage = (cb) => {
  try { chrome.storage.onChanged.addListener(cb); } catch (_) { /* contexte invalidé */ }
};
