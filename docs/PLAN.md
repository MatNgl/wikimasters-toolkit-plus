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
**0.6.1 (à tester)** : bulle flottante « Enchères » en deux colonnes (mes mises avec Surenchérir au minimum proposé | mes ventes avec annulation), chrono rouge sous 5 min, pas de page dédiée ; actualisation 1 min / 8 s ; mise via la page de l'enchère préchargée en cadre invisible.
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

## 0.7.0 (à tester)
- **Fiche** : clics répétés sur une carte = une seule ouverture ; en cliquant une autre carte pendant le chargement, seule la dernière s'ouvre.
- **Prix** : validité 48 h (96 h si la carte a au moins 10 ventes) ; écart entre requêtes adaptatif (ralenti après un refus du jeu, se resserre lentement) ; pause 6, 12, 18… s (60 s max, `Retry-After` respecté) ; jusqu'à 12 essais par carte.
- **Enchères** : alerte unique quand une enchère passe sous 2 min ou qu'on est surenchéri (message + notification du navigateur, réglable), pastille ⚠ de la bulle, ligne rouge ; animation d'ouverture/fermeture depuis la pastille.
- **Paquets** : valeur moyenne d'un paquet dans les statistiques ; couronnes (1 à 3) sur les cartes les plus chères du lot ; le menu ne disparaît plus sur petit écran (réduit en bulle « W ») et s'élargit sur grand écran.
- **Qualité** : fonctions pures dans `src/lib/logic.js` testées par `npm test` ; `WMX.reportError` (message clair, journal des 30 dernières erreurs).
- Restent à faire : lots 3 (mise automatique), 4 (marché/échanges), icône.

## 0.8.0 (à tester après rechargement)
- **Mise automatique** (bulle, bouton ⏱ sur une mise) : « dès que je suis surenchéri » ou « quand il reste X s/min », plafond facultatif, toujours le minimum proposé, 3 échecs de suite = arrêt, alerte à l'arrêt. L'onglet du jeu doit rester ouvert.
- **Marché** : sous chaque enchère visible, moyenne du marché + verdict (≤ 85 % bonne affaire, ≤ 115 % correct, au-delà trop cher).
- **Annulation** : 3 essais espacés quand le serveur du jeu répond 503.
- **Tests** : `npm test` (20+ essais : logique pure + essais de fumée jsdom qui exécutent bulle, mise automatique, prix, couronnes, marché).
- **Icônes** : 3 propositions dans `icons/proposals/` (aperçu : `docs/icones.html`).
- Non fait : valeur des échanges (la fenêtre d'échange du jeu ne donne pas les identifiants de cartes), sélection multiple/étiquetage en lot (existe dans l'ancienne extension).

## 0.9.0 (à tester après rechargement)
- **Marché** : bouton « Miser le minimum » sous chaque enchère (page d'enchère préchargée au survol, aucune navigation) ; devient « Surenchérir (minimum) » si on est dépassé et « ✓ Vous menez » sinon.
- **Échanges** : bouton « Valeurs » sur chaque offre (cartes des deux côtés, moyennes, wikibidous, total, écart) — principe repris de l'ancienne extension, données `/api/trades`.
- **Collection+** : bouton « ☑ Sélectionner » qui ouvre le mode sélection natif du jeu (défausse, étiquettes en lot).

## 0.11.0 — la collection du jeu remplace Collection+
- **Collection+ supprimée.** La collection du jeu (/collection) reçoit : barre au-dessus de la recherche (valeur estimée, état des prix, « Charger les prix… »), moyenne du marché sur chaque carte et bouton ⚡ à côté de l'étoile ★ native. Sélection, étiquettes, favoris et défausse en lot : fonctions natives du jeu (instantanées).
- **Tableau de bord** conservé (entrée de la barre latérale) : valeur, valeur par rareté, top 10, courbe.
- Nouveaux fichiers : `inventory.js` (inventaire + prix), `collection-native.js`, `dashboard.js`. Supprimé : `collection-plus.js`.
- **Prix (0.11.4)** : un prix reste valable 4 jours ; jamais rechargé automatiquement ; au chargement demandé, les prix jamais chargés passent d'abord, l'actualisation (> 4 jours) seulement ensuite. Le tableau de bord passe sous les notifications du jeu (z-index 50 < 100).
