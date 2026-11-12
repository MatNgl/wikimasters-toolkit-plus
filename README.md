# WikiMasters Toolkit+

Extension Chrome (Manifest V3) pour [WikiMasters](https://www.wiki-masters.com) : jeu de cartes à collectionner basé sur Wikipédia (boosters, collection, échanges, marché aux enchères). Elle enrichit les pages du jeu sans les remplacer.

> **⚠ Extension non officielle**, développée indépendamment de WikiMasters et non affiliée à WikiMasters ni à Wikipédia. Certaines fonctions (ouverture automatique des paquets, mises automatiques, enchères rapides ⚡, assistant de vente) ne sont **pas approuvées par WikiMasters**, dont les règles de la communauté interdisent les outils qui jouent ou interagissent à votre place. Elles sont désactivées par défaut ou ne se déclenchent que sur votre demande ; vous les utilisez sous votre propre responsabilité, avec modération. Les fonctions de lecture (prix, verdicts, tableau de bord, style des cartes) n'agissent pas à votre place.

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
| **Collection** | barre au-dessus de la recherche (valeur estimée, état des prix, « Charger les prix… » par rareté ou étiquette), moyenne du marché (ou « Sans vente ») et bouton ⚡ (mise en vente en un clic, 10 W par défaut sans vente) sur chaque carte ; sélection / étiquettes / favoris : fonctions natives du jeu ; **« Défausser… »** : défausse par critères (raretés, étiquette ou cartes sans étiquette, garder 1 exemplaire, seuil de valeur, prix inconnu gardé, étiquettes de vente protégées, sans image, cartes récentes), confirmation avec la liste complète, puis l'extension pilote la sélection native du jeu page par page (essai à blanc par défaut) |
| **Toutes les pages** | style de carte « plein cadre » (anneau de rareté, vagues, reflet) sur toutes les cartes affichées par le jeu : collection, marché, échanges, profil, révélation des paquets |
| **Tableau de bord** | valeur estimée, valeur par rareté, top 10 des cartes, courbe de la valeur |
| **Marché** | moyenne et verdict (bonne affaire / prix correct / trop cher) sous chaque enchère, bouton « Miser le minimum » (file d'attente), verdict bénéfice/perte sur mes ventes |
| **Échanges** | bouton « Valeurs » sur chaque offre (cartes, wikibidous, total, écart) |
| **Partout** | cadran des paquets (stock, alerte « stock plein ») ; bulle « Enchères » (mes enchères, mes ventes, redimensionnable, liens vers le Marché, surenchère au minimum, annulation), alertes (surenchéri, moins de 2 min), mises automatiques (dès surenchère ou X s avant la fin) |
| **Assistant de vente** | désactivé par défaut : garde des enchères actives avec les cartes portant les étiquettes choisies (menu des étiquettes du compte), seulement les raretés choisies et dans leur ordre (une rareté à la fois), et remet en vente les invendues ; état et raisons visibles (bulle des enchères, fenêtre « Détails »), plafond de prix, jamais une favorite ni une carte déjà vendue |
| **Réglages** | ⚙ : paquets, enchère rapide, assistant, enchères, style de carte, journal d'activité (« Copier le diagnostic ») |

## Règles de prix
Un prix est valable 4 jours. Rien n'est rechargé automatiquement : au chargement demandé, les prix jamais chargés passent d'abord, l'actualisation (> 4 jours) seulement ensuite. Source : `GET /api/marketplace/cards/{id}/sales?scope=summary` (une requête à la fois, pauses adaptatives si le jeu limite).

## Principes
- L'extension agit comme l'utilisateur : elle lit les réponses du jeu et pilote ses boutons ; les rares appels directs sont des lectures.
- Aucune action définitive sans demande explicite (la défausse passe par la sélection native du jeu, après une confirmation explicite, et s'arrête au moindre écart entre les nombres du jeu et la liste confirmée ; l'assistant de vente est désactivé par défaut) ; jamais de surenchère sur soi-même ; un seul onglet exécute les mises automatiques.
- Données stockées localement (`chrome.storage.local`), rien n'est envoyé à un tiers.
- Aucun contournement de la vérification humaine du jeu.

## Structure
- `src/lib/` : `logic.js` (fonctions pures testées), stockage, DOM, écoute des API
- `src/features/` : une fonction par fichier (`inventory.js`, `collection-native.js`, `dashboard.js`, `market.js`, `trades.js`, `auctions.js`, `quick-auction.js`, `prices.js`, `boosters.js`, `reveal.js`, …)
- `src/lib/journal.js` : journal d'activité ; `src/features/auto-sell.js` : assistant de vente ; `src/features/card-style.js` : style de carte global
- `src/background.js` : mise à jour automatique (développement)

## Version publiable
`npm run build` crée `release/wikimasters-toolkit-plus-<version>.zip` et le dossier `dist/` (extension sans le rechargement automatique ni la permission `alarms`, chargeable dans Chrome). Dossier du Chrome Web Store : [docs/PUBLICATION.md](docs/PUBLICATION.md) ; politique de confidentialité : [docs/PRIVACY.md](docs/PRIVACY.md).

## Tests
`npm install` puis `npm test` : tests unitaires des fonctions pures et essais de fumée (jsdom) qui exécutent la bulle, les mises automatiques, les prix, les couronnes, le marché, les échanges et la collection.

Voir [docs/BILAN.md](docs/BILAN.md) (état actuel), [docs/PUBLICATION.md](docs/PUBLICATION.md), [docs/PLAN.md](docs/PLAN.md) (historique) et [docs/API-NOTES.md](docs/API-NOTES.md).
