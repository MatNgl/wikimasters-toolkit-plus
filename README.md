# WikiMasters Toolkit+

Extension Chrome (Manifest V3) pour [WikiMasters](https://www.wiki-masters.com) : jeu de cartes à collectionner basé sur Wikipédia (boosters, collection, échanges, marché aux enchères). Elle enrichit les pages du jeu sans les remplacer.

## Installer en développement
1. `chrome://extensions` → activer le **mode développeur**
2. **Charger l'extension non empaquetée** → sélectionner ce dossier
3. Ouvrir https://www.wiki-masters.com (F5 après chaque mise à jour)

> Désactivez l'ancienne extension « WM Toolkit » : elle fait doublon (barres d'outils, prix).
> L'extension surveille son dossier et se recharge toute seule quand la version change (réglable : Paramètres → « Mise à jour automatique »). Il reste à actualiser (F5) les onglets du jeu.

## Fonctions
| Page | Ce que l'extension ajoute |
|---|---|
| **Paquets** | « Tout ouvrir » et ouverture automatique (intervalle min/max, arrêt sur belle carte), écran de révélation façon gacha trié par rareté (prix, ★ favori, ⚡ enchère rapide, couronnes sur les cartes les plus chères), statistiques (répartition, valeur moyenne d'un paquet) |
| **Collection** | barre au-dessus de la recherche (valeur estimée, état des prix, « Charger les prix… » par rareté ou étiquette), moyenne du marché et bouton ⚡ sur chaque carte ; sélection / étiquettes / favoris / défausse en lot : fonctions natives du jeu |
| **Tableau de bord** | valeur estimée, valeur par rareté, top 10 des cartes, courbe de la valeur |
| **Marché** | moyenne et verdict (bonne affaire / prix correct / trop cher) sous chaque enchère, bouton « Miser le minimum » (file d'attente), verdict bénéfice/perte sur mes ventes |
| **Échanges** | bouton « Valeurs » sur chaque offre (cartes, wikibidous, total, écart) |
| **Partout** | bulle « Enchères » (mes mises, mes ventes, surenchère au minimum, annulation), alertes (surenchéri, moins de 2 min), mises automatiques (dès surenchère ou X s avant la fin) |

## Règles de prix
Un prix est valable 4 jours. Rien n'est rechargé automatiquement : au chargement demandé, les prix jamais chargés passent d'abord, l'actualisation (> 4 jours) seulement ensuite. Source : `GET /api/marketplace/cards/{id}/sales?scope=summary` (une requête à la fois, pauses adaptatives si le jeu limite).

## Principes
- L'extension agit comme l'utilisateur : elle lit les réponses du jeu et pilote ses boutons ; les rares appels directs sont des lectures.
- Aucune action définitive (défausse, mise) sans demande explicite ; jamais de surenchère sur soi-même ; un seul onglet exécute les mises automatiques.
- Données stockées localement (`chrome.storage.local`), rien n'est envoyé à un tiers.
- Aucun contournement de la vérification humaine du jeu.

## Structure
- `src/lib/` : `logic.js` (fonctions pures testées), stockage, DOM, écoute des API
- `src/features/` : une fonction par fichier (`inventory.js`, `collection-native.js`, `dashboard.js`, `market.js`, `trades.js`, `auctions.js`, `quick-auction.js`, `prices.js`, `boosters.js`, `reveal.js`, …)
- `src/background.js` : mise à jour automatique

## Tests
`npm install` puis `npm test` : tests unitaires des fonctions pures et essais de fumée (jsdom) qui exécutent la bulle, les mises automatiques, les prix, les couronnes, le marché, les échanges et la collection.

Voir [docs/PLAN.md](docs/PLAN.md) (historique) et [docs/API-NOTES.md](docs/API-NOTES.md).
