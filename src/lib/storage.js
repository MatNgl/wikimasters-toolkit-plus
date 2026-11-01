WMX.store = {
  async get(key, fallback) {
    try {
      const r = await chrome.storage.local.get(key);
      return r[key] ?? fallback;
    } catch (_) { return fallback; }
  },
  async set(key, value) {
    try { await chrome.storage.local.set({ [key]: value }); } catch (_) {}
  },
};

/** Faux dès que l'extension a été rechargée/désactivée : le script resté dans l'onglet doit alors s'arrêter. */
WMX.alive = () => {
  try { return !!chrome.runtime?.id; } catch (_) { return false; }
};

WMX.onStorage = (cb) => {
  try { chrome.storage.onChanged.addListener(cb); } catch (_) { /* contexte invalidé */ }
};
