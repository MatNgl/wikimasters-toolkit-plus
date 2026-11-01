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

### Ajouts de cette itération (🟡 à tester)
- Pause entre paquets supprimée (« Tout ouvrir » suit le rythme du jeu).
- Ouverture auto : intervalle en minutes (1 à 60), badge rouge, bouton Arrêter rouge.
- Volet ⚙ Paramètres : vitesse et ordre de la révélation, arrêt sur SR/UR/L, réserve de paquets.
- Auto intelligente : stock plein → ouvre tout (au-dessus de la réserve) ; ouverture anticipée si le stock risque d'être plein avant la prochaine ouverture planifiée.
- Historique par jour + export CSV ; menu flottant repliable avec animation.
- À vérifier : durée de régénération déduite du compteur « Prochain dans » (10 min par défaut) ; compte Pro.

### Prochaine étape : actions depuis la révélation
- ⬜ Cartes cliquables dans l'écran de révélation : étiqueter et mettre aux enchères sans quitter l'écran.
- ⬜ Découvrir les requêtes natives (étiquette, mise en vente) : l'enregistreur capte désormais la forme des corps envoyés (`apiShapes[...].request`).
- Fiche native observée : fenêtre sur /collection (sans changement d'URL) avec « Ajouter une étiquette », « Mettre aux enchères », « Défausser ».

## 2. Collection+ (`/collection`)
**Phase 1 (0.2.0, à tester)** : inventaire complet en mémoire (GET /api/my-collection, tri alphabétique stable), grille pleine image, 10/25/50/100 par page, recherche, filtres (rareté, étiquette, sans étiquette, favoris, doublons, valeur min/max), tris (rareté, plus/moins chères, récentes, nom), prix par carte via /api/marketplace/cards/{id}/sales?scope=summary (sans compte Pro) avec progression et pause allongée sur 429, valeur totale, vraie fiche du jeu au clic, onglet tableau de bord (valeur par rareté, top 10, courbe à partir de 2 jours d'historique).
**0.3.1** : entrées « Collection+ » et « Tableau de bord » dans la barre latérale du jeu (sous Collection, aspect distinct), 250 par page, barre de filtres pleine largeur.
**Phase 2 (0.3.0, à tester)** : enchère rapide (⚡ sur la carte, formulaire natif piloté, annulation si le jeu le permet ; réglages coefficient/durée/prudent déjà dans les paramètres).
**Plus tard** : sélection multiple et étiquetage en lot ; analyse (cartes qui montent, stats par étiquette).
- L'ancienne extension n'est plus conservée en parallèle : on ne s'appuie plus sur ses attributs (`data-wm-card-id`).

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
