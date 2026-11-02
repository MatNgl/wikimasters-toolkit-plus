# Bilan — WikiMasters Toolkit+ (v0.16.0)

## Fait
**Paquets** — « Tout ouvrir » et ouverture automatique (intervalle min/max, arrêt sur belle carte), écran de révélation façon gacha trié par rareté (prix, ★, ⚡, couronnes sur les cartes les plus chères, « Paquet n/N »), statistiques (répartition, valeur moyenne d'un paquet), menu centré qui sort d'un cadran, visible partout tant que l'auto tourne.
**Collection** (page native enrichie) — barre au-dessus de la recherche (valeur estimée, état des prix, « Charger les prix… » par rareté ou étiquette), moyenne du marché et ⚡ sur chaque carte, style de carte plein cadre pour toutes les raretés (description et attaque/défense au choix), sélection / étiquettes / favoris / défausse = fonctions natives.
**Tableau de bord** — valeur, valeur par rareté, top 10, courbe dans le temps.
**Marché** — moyenne et verdict (bonne affaire / correct / trop cher), « Miser le minimum » avec file d'attente, bénéfice/perte sur mes ventes, pas de bouton sur mes ventes.
**Échanges** — bouton « Valeurs » (cartes, wikibidous, total, écart) : testé sur une fausse offre seulement.
**Enchères** — bouton rond à anneau (temps restant, surenchéri, fin imminente), bulle (mes mises | mes ventes, déplaçable, en-tête fixe, ⚙, ↻), clic sur le nom → l'enchère, annulation (« Annulation… »), alertes (surenchéri, < 2 min), mises automatiques (dès surenchère / X s avant la fin) avec plafond fixe ou selon la moyenne du marché (± %), réglages par défaut, un seul onglet exécute les mises, contrôle de l'état réel avant chaque mise (jamais de surenchère sur soi-même), file d'attente survolable.
**Prix** — valables 4 jours, jamais rechargés tout seuls, prix jamais chargés d'abord ; une requête à la fois (2 si le jeu est lent), pauses adaptatives.
**Qualité** — 35 tests automatiques (fonctions pures + essais jsdom), mise à jour automatique de l'extension (développement), bannière « actualiser » après mise à jour, messages d'erreur clairs, README et docs à jour.

**Assistant de vente** (0.15) — désactivé par défaut. Garde N enchères actives (3 par défaut) avec les cartes portant les étiquettes choisies (ex. VENTE) et remet en vente les invendues. Garde-fous : jamais une favorite, prix de départ plafonné (500 W), une vente annulée à la main écarte la carte 12 h, deux échecs la mettent de côté 6 h, 4 mises en vente auto par carte et par jour. Testé en réel : sélection, plafond, annulation.
**Journal d'activité** (0.15) — Paramètres → Journal : actions de la file, de l'assistant et incidents ; « Copier le diagnostic ». Détection d'une page de collection modifiée par le jeu.
**Défausse** — uniquement celle, native, du jeu (sélection) ; l'ancienne défausse carte par carte de l'extension est supprimée.
**Annulation de vente** — validée en réel : le cadre invisible reste ouvert jusqu'à la confirmation du serveur (0.14.6), bouton « Annulation… ».

## À surveiller / ne fonctionne pas encore
- Valeurs d'échange : jamais vues sur une vraie offre.
- Notifications du navigateur : autorisation jamais accordée en test.
- Écrans étroits / mobile : non testés (la fenêtre de test ne se redimensionne pas).
- Le jeu est parfois très lent (3 à 8 s par requête) : ouverture d'une fiche 3 à 28 s, défausse via l'extension ~11 s par carte (celle du jeu est instantanée), chargement de l'inventaire plusieurs minutes.
- L'ouverture automatique ne s'exécute que sur la page Paquets (elle se met en pause ailleurs).
- Dépendance aux classes CSS du jeu : un changement de design du jeu peut casser l'ajout des prix et du ⚡ sur la collection.
- Mise à jour automatique : réservée au développement, à retirer d'une version publiée.

## Évolutions décidées
**Style de carte global (0.16)** : appliqué à toute carte affichée par le jeu (reconnue à sa structure : collection, marché + fiche d'enchère, « Toutes les cartes », fenêtre d'échange) et à l'écran de révélation des paquets. Vérifié en réel sur ces pages ; profil, guilde, batailles et demandes d'amis : pas de carte disponible pour tester, couverts par la même détection. Ouverture de paquets en arrière-plan : possible. Refusés : veille du marché, bilan gains/dépenses, complétion de collection, tendance des prix.

## Publication (Chrome Web Store) — liste de contrôle
1. Retirer l'actualisation automatique et la permission `alarms` de la version publiée.
2. Politique de confidentialité : données uniquement locales ; requêtes vers wiki-masters.com et fr.wikipedia.org (images, descriptions).
3. Justifier chaque permission (storage ; accès au site du jeu).
4. Vérifier les conditions d'utilisation de WikiMasters (automatisation : ouverture auto, mises auto) et, idéalement, l'accord de l'éditeur.
5. Captures d'écran, description, icône (déjà faite), compte développeur.
6. Mode « non répertoriée » possible pour un petit cercle d'utilisateurs avant une publication publique.
