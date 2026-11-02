# Publication sur le Chrome Web Store — dossier

## 0. Point bloquant : les règles de WikiMasters (lues le 2 novembre 2026)
La page [/rules](https://www.wiki-masters.com/rules), section 3 « Pas d'automatisation ni de triche », interdit les « bots, scripts, macros » et « tout outil visant à jouer, ouvrir des paquets, échanger ou interagir à votre place ». La section 8 interdit d'« intercepter le trafic du Service » et de « contourner les limites techniques ». Les [conditions d'utilisation](https://www.wiki-masters.com/terms) (section 6) prévoient avertissement, suspension ou suppression du compte « à leur seule discrétion et sans préavis » pour « utilisation d'automatisation ».

Ce qui, dans l'extension, tombe sous cette lecture : ouverture automatique des paquets, mises automatiques sur les enchères, file d'enchères rapides (⚡), assistant de vente (clics simulés dans des cadres invisibles). Ce qui n'en relève pas clairement (lecture seule) : prix et moyennes affichés, verdicts du marché, tableau de bord, style des cartes, valeurs d'échange, alertes.

Conséquence : publier telle quelle une extension grand public exposerait ses utilisateurs à des sanctions sur leur compte, et le Web Store peut retirer une extension qui enfreint les règles d'un service tiers. À trancher avant toute soumission (voir §1).

## 1. Options
| Option | Contenu | Risque |
|---|---|---|
| A. Autorisation écrite | Écrire à support@wiki-masters.com, décrire les fonctions, demander un accord. Publier toutes les fonctions seulement après réponse positive. | Aucun si accord ; délai |
| B. Version « lecture seule » | Publier sans ouverture auto, mises auto, file ⚡, assistant de vente (code retiré ou désactivé à la compilation). Prix, verdicts, tableau de bord, style de carte, valeurs d'échange, alertes. | Faible ; toujours à signaler à l'éditeur |
| C. Non répertoriée / usage privé | Lien direct pour quelques amis, ou installation en mode développeur. | Reste soumis aux règles du jeu pour chaque utilisateur |

## 2. Modifications techniques de la version publiée
- Retirer `src/background.js` et les permissions `alarms` (rechargement automatique réservé au développement) ; retirer le réglage « Mise à jour automatique » et la bannière associée.
- Garder uniquement `storage` et l'accès à `https://www.wiki-masters.com/*`.
- Retirer `version_name` de développement ; numéro de version propre (1.0.0).
- Pas de code distant, pas de `eval`, pas de script externe : déjà le cas (aucune URL externe dans le code, hormis l'API de Wikipédia).
- Générer le ZIP sans `node_modules`, `tests`, `docs`.
- Selon l'option B : retirer `quick-auction.js`, `auto-sell.js`, la partie « mises automatiques » de `auctions.js`, l'ouverture automatique de `boosters.js`.

## 3. Justification des permissions (formulaire du Web Store)
- **storage** : enregistre en local les réglages, le cache des prix (4 jours), l'inventaire en cache et le journal d'activité.
- **Accès à www.wiki-masters.com** : l'extension n'a de sens que sur ce site ; elle y lit les réponses du jeu pour calculer les prix et valeurs, et ajoute ses éléments aux pages.
- **Wikipédia** : récupération d'un résumé et d'une image (API publique, lecture seule) pour l'écran de révélation des paquets.
- Pas de permission « notifications », « tabs », « cookies », « history ».

## 4. Politique de confidentialité (à héberger sur une page publique, ex. GitHub Pages)
> **WikiMasters Toolkit+ — politique de confidentialité**
> Dernière mise à jour : [date de publication].
> **Éditeur** : [nom], contact : [adresse e-mail].
> **Données** : l'extension ne collecte aucune donnée personnelle et n'envoie rien à un serveur de l'éditeur ni à un tiers. Les réglages, prix, inventaire en cache, statistiques et journal d'activité sont enregistrés uniquement dans le navigateur (`chrome.storage.local`) et supprimés à la désinstallation.
> **Requêtes** : l'extension lit les réponses de www.wiki-masters.com au nom de l'utilisateur connecté et interroge l'API publique de Wikipédia (titre de carte) pour afficher résumé et image. Aucun identifiant, mot de passe ni jeton n'est lu, stocké ou transmis.
> **Cookies, publicité, revente de données** : aucun.
> **Droits** : aucune donnée n'étant détenue par l'éditeur, il n'y a rien à exporter ni à supprimer ; pour toute question : [adresse e-mail].
> L'extension n'est pas affiliée à WikiMasters ni à Wikipédia.

## 5. Fiche du store (brouillon)
**Nom** : WikiMasters Toolkit+
**Résumé (132 car. max)** : Prix du marché, valeur de la collection et aides aux enchères pour WikiMasters. Extension non officielle.
**Description** : Enrichit le jeu WikiMasters sans le remplacer : moyenne du marché et verdict (bonne affaire / correct / trop cher) sous chaque enchère, valeur estimée de la collection, tableau de bord, valeurs des offres d'échange, style de carte plein cadre, bulle des enchères avec alertes. Les données restent dans votre navigateur. Extension non officielle, non affiliée à WikiMasters. [Selon l'option choisie : ajouter ou non les fonctions automatiques, en précisant qu'elles doivent respecter les règles du jeu.]
**Catégorie** : Jeux / Outils. **Langue** : français.

## 6. À fournir
- Compte développeur Chrome Web Store (frais uniques de 5 $).
- Captures 1280×800 (3 à 5) : collection avec prix, bulle des enchères, marché avec verdicts, tableau de bord, style de carte.
- Icône 128×128 : déjà dans `icons/`.
- URL de la politique de confidentialité, adresse de contact, justification des permissions (§3).
- Déclaration « pratiques de données » : aucune donnée collectée.
