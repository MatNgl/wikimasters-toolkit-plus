# Plan de la suite

Légende : ✅ fait et vérifié · 🟡 écrit, à tester · ⬜ à faire

## 1. Paquets (page `/pulls`)
| | Élément | Détail |
|---|---|---|
| ✅ | Ouverture groupée masquée | pilote le bouton natif, cartes lues dans `POST /api/packs/open` |
| ✅ | Sortie de l'écran natif | flèche ronde puis « Continuer » |
| ✅ | Statistiques cumulées | paquets, cartes, répartition par rareté |
| ✅ | Style des cartes du jeu | couleurs, bordures, halos relevés sur le marché ; image + description via l'API Wikipédia |
| ✅ | Écran progressif | 5 cartes neutres par paquet ouvert, compteur « N paquets restants » |
| ✅ | Vitesse | pas de 100–120 ms, pause entre paquets 0,3 s par défaut |
| ✅ | Statistiques en barres colorées | |
| ✅ | Bouton « Passer » | toutes les cartes retournées d'un coup |
| ✅ | Ouverture auto (min/max, badge, arrêt → révélation) | testée avec 2 paquets, intervalle 5–6 s |
| 🟡 | Reprise de la révélation après rechargement de la page | cartes mémorisées ; non observé en conditions réelles |
| ⬜ | Test d'une carte UR / SR / L à la révélation | aucune n'est encore tombée pendant les essais |
| ⬜ | Cas où la vérification humaine demande un clic | l'extension attend, l'utilisateur clique |
| ⬜ | Animation légendaire du jeu | impossible à déclencher depuis l'extension ; on garde notre halo |

## 2. Collection (`/collection`)
- ⬜ Filtre par valeur (min/max) : cartes identifiées par `data-wm-card-id` ; prix depuis le cache.
- ⬜ Vérifier avec l'ancienne extension désactivée que `data-wm-card-id` vient bien du jeu.
- ⬜ Tri par valeur, filtres rareté / nom / favori / date d'ajout à compléter si manquants.

## 3. Marché (`/marketplace`)
- ⬜ Capter les réponses de `/api/marketplace` et l'historique pour alimenter le cache de prix (moyenne sur N ventes, exclusion des extrêmes).
- ⬜ Récapitulatif des prix + paramètres (N ventes, coefficient).
- ⬜ Bouton d'enchère rapide : découvrir l'endpoint/le flux natif de mise en vente (à observer, rien d'envoyé sans action de l'utilisateur).

## 4. Échanges (`/trades`)
- ⬜ Valeur totale + aperçu des cartes (existe dans l'ancienne extension).

## 5. Qualité
- ⬜ Page d'options (réglages persistants, export CSV/JSON).
- ⬜ Icônes de l'extension.
- ⬜ Tests unitaires des fonctions pures (tri, normalisation des raretés, moyennes de prix).
- ⬜ Gestion d'erreurs : endpoints modifiés, sélecteurs introuvables, message clair dans le panneau.
- ⬜ Publication éventuelle sur le Chrome Web Store (politique de confidentialité, captures).

## Règles
- Aucun contournement de la vérification humaine du jeu.
- Aucune action d'achat, d'enchère ou de vente sans clic explicite de l'utilisateur.
