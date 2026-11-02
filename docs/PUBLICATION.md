# Publication sur le Chrome Web Store — dossier (version 1.0.0)

## 1. Décision et mention obligatoire
Toutes les fonctions sont publiées. Les règles de WikiMasters ([/rules](https://www.wiki-masters.com/rules), section 3 ; [/terms](https://www.wiki-masters.com/terms), section 6, lues le 2 novembre 2026) interdisent les « bots, scripts, macros » et « tout outil visant à jouer, ouvrir des paquets, échanger ou interagir à votre place », avec sanctions possibles. L'extension le dit donc clairement, aux quatre endroits où l'utilisateur la rencontre :
- **fiche du store** (début de la description, voir §4) ;
- **README** ;
- **Paramètres de l'extension → « À savoir »** (première section) ;
- **rappel unique** au premier lancement (bandeau 20 s) et ligne dans la fenêtre de l'icône.

Texte : « Extension non officielle, développée indépendamment de WikiMasters et non affiliée à WikiMasters ni à Wikipédia. Certaines fonctions (ouverture automatique des paquets, mises automatiques, enchères rapides ⚡, assistant de vente) ne sont pas approuvées par WikiMasters, dont les règles de la communauté interdisent les outils qui jouent ou interagissent à votre place. Elles sont désactivées par défaut ou ne se déclenchent que sur votre demande ; si vous les utilisez, c'est sous votre propre responsabilité et avec modération. »

Garde-fous de conception déjà en place : assistant de vente désactivé par défaut, ouverture automatique désactivée par défaut, jamais de défausse par l'extension, plafonds de prix, 4 mises automatiques par carte et par jour, jamais de surenchère sur soi-même, aucun contournement de la vérification humaine. Risque résiduel : l'éditeur peut modifier ses règles ou sanctionner ; le Web Store peut retirer l'extension sur signalement. Écrire à support@wiki-masters.com reste le moyen de lever ce doute.

## 2. Construire la version publiable
```
npm run build            # ou : node scripts/build.js 1.0.1
```
Crée `release/wikimasters-toolkit-plus-<version>.zip` (≈ 120 Ko, à envoyer au store) et le dossier `dist/` (même contenu, à charger tel quel dans Chrome) : copie de `src/` et `icons/` **sans** `background.js` (rechargement automatique), sans la permission `alarms`, sans `version_name`. Seule permission restante : `storage` + accès à `https://www.wiki-masters.com/*`. Le script vérifie que chaque fichier cité dans le manifest est dans le paquet. La section « Extension / Mise à jour automatique » des Paramètres disparaît d'elle-même de cette version.
Essai avant envoi : `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → dossier `dist` (le manifest.json est à sa racine).

## 3. Justification des permissions (formulaire du store)
- **storage** : enregistre en local les réglages, le cache des prix (4 jours), la copie de la collection, les statistiques et le journal d'activité.
- **Accès à www.wiki-masters.com** : l'extension n'a de sens que sur ce site ; elle y lit les réponses du jeu (prix, collection, enchères) et y ajoute ses éléments.
- **Wikipédia** : API publique, titre de la carte envoyé pour afficher résumé et image (désactivable).
- Aucune permission « tabs », « cookies », « history », « notifications ». Aucun code distant.
- **Pratiques de données** : aucune donnée collectée ni transmise ; cocher « n'est pas vendu à des tiers », « non utilisé hors de la finalité », « non utilisé pour la solvabilité ».

## 4. Fiche du store (à copier)
**Nom** : WikiMasters Toolkit+
**Résumé (132 car. max)** : Prix du marché, valeur de la collection, enchères et outils pour WikiMasters. Extension non officielle.
**Description** :
> ⚠ Extension non officielle, non affiliée à WikiMasters ni à Wikipédia. Certaines fonctions (ouverture automatique des paquets, mises automatiques, enchères rapides ⚡, assistant de vente) ne sont pas approuvées par WikiMasters, dont les règles interdisent les outils qui jouent à votre place. Elles sont désactivées par défaut ou ne se déclenchent que sur votre demande : vous les utilisez sous votre propre responsabilité, avec modération.
>
> Enrichit le jeu WikiMasters sans le remplacer :
> • Marché : moyenne du marché et verdict (bonne affaire / prix correct / trop cher) sous chaque enchère, bénéfice ou perte sur vos ventes.
> • Collection : valeur estimée, moyenne du marché sur chaque carte, chargement des prix par rareté ou par étiquette.
> • Tableau de bord : valeur par rareté, top 10, courbe dans le temps.
> • Échanges : valeur des cartes, des wikibidous et écart de chaque offre.
> • Style de carte plein cadre (anneau de rareté, vagues, reflet) sur toutes les cartes, désactivable.
> • Bulle des enchères : vos mises et ventes, alertes (surenchéri, fin proche), annulation.
> • Fonctions automatiques, à vos risques : ouverture groupée ou automatique des paquets, mises automatiques, mise en vente en un clic (⚡), assistant de vente (désactivé par défaut).
>
> Vos données restent dans votre navigateur : aucune collecte, aucun serveur tiers.
**Catégorie** : Jeux (ou Outils). **Langue** : français.

## 5. Politique de confidentialité
Texte prêt et rempli dans [PRIVACY.md](PRIVACY.md) (éditeur MatNgl, mise à jour du 3 novembre 2026). Le dépôt est public : adresse à donner au store = https://github.com/MatNgl/wikimasters-toolkit-plus/blob/main/docs/PRIVACY.md

## 6. À fournir par l'éditeur
- Compte développeur Chrome Web Store (frais uniques de 5 $) et l'envoi du ZIP.
- Captures 1280×800 (3 à 5) : collection avec prix, bulle des enchères, marché avec verdicts, tableau de bord, style de carte. Attention : elles montrent un compte réel (pseudo, collection) ; à choisir ou flouter.
- Icône 128×128 : déjà dans `icons/`.
- URL de la politique, adresse de contact.
- Option prudente : « Visibilité : non répertoriée » pour un premier lancement auprès d'un petit cercle, puis publique.

## 7. Champs du tableau de bord développeur (à copier-coller)
Tableau de bord : https://chrome.google.com/webstore/devconsole → « Nouvel élément » → envoyer `release/wikimasters-toolkit-plus-1.0.0.zip`. (Cette adresse n'est pas pilotable par un outil d'automatisation : les champs se remplissent à la main.)

**Fiche du store (Store listing)** : nom, résumé, description, catégorie et langue du §4 ; captures `release/store-screenshots/1…5` (1280×800) ; icône 128×128 : `icons/icon-128.png` ; page d'accueil / assistance : https://github.com/MatNgl/wikimasters-toolkit-plus ; e-mail d'assistance : mattheo.naegellen@gmail.com.

**Confidentialité (Privacy practices)**
- *Objectif unique* : « Afficher les prix du marché, la valeur de la collection et des outils d'enchères sur le site du jeu WikiMasters. »
- *Justification « storage »* : « Enregistre localement les réglages, le cache des prix, la copie de la collection, les statistiques et le journal d'activité. »
- *Justification de l'accès à www.wiki-masters.com* : « L'extension n'a de sens que sur ce site : elle y lit les réponses du jeu (prix, collection, enchères) et y ajoute ses éléments. »
- *Code distant* : non.
- *Données collectées* : aucune case cochée (rien n'est transmis hors du navigateur). Cocher les trois attestations (pas de vente de données, pas d'usage hors finalité, pas de solvabilité).
- *URL de la politique* : https://github.com/MatNgl/wikimasters-toolkit-plus/blob/main/docs/PRIVACY.md

**Distribution** : visibilité « Non répertoriée » pour commencer (passage en « Publique » ensuite), régions : toutes.

**Mises à jour** : incrémenter `version` (npm run build 1.0.1), envoyer le nouveau ZIP dans l'élément existant, « Soumettre pour examen ». Une publication sur GitHub ne met pas à jour le store.
