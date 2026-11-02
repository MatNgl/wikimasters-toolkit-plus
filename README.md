# WikiMasters Toolkit+

Extension Chrome (Manifest V3) pour [WikiMasters](https://www.wiki-masters.com) : jeu de cartes à collectionner basé sur Wikipédia (boosters, collection, échanges, marché aux enchères).

## Installer en développement
1. `chrome://extensions` → activer le **mode développeur**
2. **Charger l'extension non empaquetée** → sélectionner ce dossier
3. Ouvrir https://www.wiki-masters.com

> Désactivez l'ancienne extension « WM Toolkit » pendant les tests pour éviter les doublons.

## État (v0.1.0 – squelette)
| Fonction | État |
|---|---|
| Hook `fetch` + enregistrement de la forme des API (`apiShapes`) | fait |
| Statistiques (paquets, cartes, raretés) + popup | fait, à valider sur un vrai paquet |
| Ouverture groupée avec délai | brouillon (pilote le bouton natif) |
| Cache de prix moyens | brouillon |
| Filtre valeur dans la collection | brouillon (sélecteurs à confirmer) |
| Enchère rapide sur le marché | à faire |

Voir [docs/ROADMAP.md](docs/ROADMAP.md) et [docs/API-NOTES.md](docs/API-NOTES.md).

## Principes
- L'extension agit comme l'utilisateur : elle clique sur les boutons du jeu, elle ne forge pas d'appels.
- Délais configurables entre actions, pas de rafales.
- Données stockées localement (`chrome.storage.local`), rien n'est envoyé à un tiers.

## Tests
Les fonctions pures (`src/lib/logic.js`) sont testées avec Node : `npm test`.
