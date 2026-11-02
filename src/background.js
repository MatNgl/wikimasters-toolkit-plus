// Mise à jour automatique (extension chargée depuis un dossier) : toutes les minutes, on relit le manifest du dossier ;
// si la version a changé, l'extension se recharge toute seule. Il reste à actualiser (F5) l'onglet du jeu : les scripts
// de l'ancienne version y restent actifs jusque-là. Désactivable dans les paramètres (« Mise à jour automatique »).
const PERIOD_MIN = 1;

async function check() {
  try {
    const { wmxSettings } = await chrome.storage.local.get('wmxSettings');
    if (wmxSettings?.autoReload === false) return;
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const disk = await res.json();
    const cur = chrome.runtime.getManifest();
    if (disk.version !== cur.version || disk.version_name !== cur.version_name) chrome.runtime.reload();
  } catch (_) { /* fichier en cours d'écriture ou indisponible : on réessaie à la prochaine minute */ }
}

chrome.alarms.create('wmx-autoreload', { periodInMinutes: PERIOD_MIN });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'wmx-autoreload') check(); });
chrome.runtime.onStartup.addListener(check);
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('wmx-autoreload', { periodInMinutes: PERIOD_MIN }));
