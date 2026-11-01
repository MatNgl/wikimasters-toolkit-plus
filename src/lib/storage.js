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
