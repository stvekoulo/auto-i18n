# Audit de next-auto-i18n — 3 novembre 2026

Audit du dépôt `E:\DEVS\auto-i18n`, branche `main`, à partir de `e97f086` (2.1.0). Ce rapport décrit les corrections préparées pour la version 2.2.0 et leurs vérifications. Le statut de publication doit être vérifié séparément dans le registre npm.

## Évaluation

La séparation `core` / adapters / pipelines / commandes est saine : les règles d'extraction et de catalogue peuvent être testées sans réseau. Les sauvegardes exclusives, les providers injectables et le pool de scan constituent une base utile à conserver.

Les défauts les plus importants concernaient la perte de traductions, les modifications effectuées pendant un aperçu et la génération de code dans des scopes ambigus. Ils ont été reproduits avec des tests puis corrigés. La remise à niveau comprend **57 nouveaux cas de régression**, la documentation de migration et l'actualisation des dépendances.

## Anomalies corrigées

P1 : perte de données, modification inattendue ou code applicatif cassé. P2 : résultat incorrect, CI trompeuse ou défaut de robustesse.

| Priorité | Déclencheur et comportement antérieur                                                                                                                                                    | Correction et sources                                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Après `sync --write`, le texte source disparaissait ; `sync --prune` supprimait alors sa clé et ses traductions, même si `t('clé')` l'utilisait encore.                                  | Références littérales et alias de traduction identifiés pris en compte. Un appel à clé dynamique conserve toutes les clés. `src/core/scan/references.ts`, `src/core/catalog/index.ts`, `src/pipeline/sync.ts`.                    |
| P1       | Une erreur de syntaxe rendait le scan partiel, mais la purge supprimait les clés des fichiers non lus.                                                                                   | Refus de la purge avant toute écriture si le scan signale un fichier illisible ou non parsable ; les erreurs de parcours des dossiers remontent également au lieu de produire un scan vide. `src/pipeline/sync.ts`.               |
| P1       | `sync --write --dry-run` écrivait quand même les catalogues et pouvait déclencher des traductions facturées.                                                                             | Aperçu propagé aux pipelines : aucune écriture, sauvegarde ou requête API. Statut `pending` et rapport distinguant les suppressions prévues. `src/commands/sync.ts`, `src/pipeline/{sync,translate}.ts`, `src/reporting/sync.ts`. |
| P1       | `runInit` acceptait des options invalides, puis écrivait configuration, clé API et scaffold ; une locale contenant un chemin pouvait sortir du dossier des messages.                     | Validation avant les effets de bord. `src/commands/init.ts`.                                                                                                                                                                      |
| P1       | Relancer `init` remplaçait silencieusement la configuration, notamment les dossiers personnalisés et les exclusions.                                                                     | Refus si la configuration existe déjà, avec orientation vers `sync`. `src/commands/init.ts`.                                                                                                                                      |
| P1       | La source était modifiée avant de découvrir un JSON cible invalide ; les erreurs de lecture autres qu'un fichier absent étaient traitées comme un catalogue vide.                        | Lecture et validation des catalogues avant la première écriture ; seul `ENOENT` donne un catalogue vide. `src/pipeline/sync.ts`, `src/adapters/fs/index.ts`.                                                                      |
| P1       | Le codemod réutilisait un paramètre `t` quelconque, un traducteur avec namespace ou un identifiant masqué ; un import aliasé pouvait laisser un hook inexistant dans le code généré.     | Refus conservateur des liaisons ambiguës, des namespaces et des collisions d'import ; choix de l'hôte le plus proche. Analyse mémorisée par fonction hôte. `src/core/write/{index,bindings}.ts`.                                  |
| P2       | `check` pouvait réussir malgré un fichier non parsable. `sync` et `init` pouvaient réussir après une erreur partielle de placeholders.                                                   | Codes de sortie non nuls ; les traductions valides d'une locale partiellement traduite restent enregistrées. `src/core/check/index.ts`, `src/commands/{sync,init}.ts`, `src/pipeline/translate.ts`.                               |
| P2       | Une clé telle que `constructor` semblait déjà présente dans un catalogue vide à cause de l'opérateur `in`.                                                                               | Vérification des propriétés propres avec `Object.hasOwn`. `src/core/{catalog,check}/index.ts`.                                                                                                                                    |
| P2       | Une configuration Google sans `apiKeyEnv` héritait du nom de variable DeepL.                                                                                                             | Défaut dérivé du provider choisi. `src/config/index.ts`.                                                                                                                                                                          |
| P2       | Des locales comme `pt-BR` généraient des propriétés JS non quotées ; `in` devenait un identifiant d'import réservé.                                                                      | Clés de ressources quotées et identifiants préfixés `messages_`. `src/adapters/scaffold/templates.ts`.                                                                                                                            |
| P2       | Le scaffold React conservait l'interpolation i18next `{{name}}`, incompatible avec les messages générés `{name}`.                                                                        | Délimiteurs simples configurés explicitement pour les nouveaux scaffolds. Migration manuelle documentée pour les installations existantes. `src/adapters/scaffold/templates.ts`, `MIGRATION.md`.                                  |
| P1       | Les clés d'alias ou de `t.rich()` étaient extraites comme du texte brut. Les templates tagués pouvaient être réécrits alors qu'ils appartiennent à une autre grammaire, par exemple SQL. | Détection partagée des traducteurs ; exclusion des clés, namespaces de factories reconnus et templates tagués. `src/core/extraction/index.ts`, `src/core/scan/references.ts`.                                                     |
| P1       | Une clé manuelle contenant des guillemets était interpolée sans échappement dans le JS généré.                                                                                           | Littéral produit par `JSON.stringify`. `src/core/write/index.ts`.                                                                                                                                                                 |
| P2       | Une réponse provider trop courte pouvait décaler les correspondances entre lots ; une réponse surnuméraire ou vide pouvait être acceptée.                                                | Validation de chaque lot et du résultat des providers personnalisés : nombre exact, chaînes non vides. `src/adapters/translation/{types,deepl,google}.ts`, `src/pipeline/translate.ts`.                                           |
| P2       | Les écritures atomiques partageaient un temporaire par PID, et un renommage échoué laissait ce fichier en place.                                                                         | Nom unique et suppression du temporaire en `finally`. `src/adapters/fs/index.ts`. Cela ne constitue pas un verrou entre synchronisations concurrentes.                                                                            |
| P1       | `fr` et `FR`, ou `pt-BR` et `pt-br`, pouvaient désigner le même fichier sous Windows.                                                                                                    | Doublons et collision source/cible détectés sans tenir compte de la casse. `src/config/index.ts`.                                                                                                                                 |
| P2       | Node 22.12 était annoncé et testé en CI, alors que des dépendances installées exigent 22.13 sur la branche Node 22.                                                                      | Minimum, `.nvmrc` et CI alignés sur 22.13 ; ajout de Windows à la matrice de validation. `package.json`, `.nvmrc`, `.github/workflows/ci.yml`.                                                                                    |

Les tests ajoutés sont regroupés dans `tests/audit/`. Le test existant de scaffold a été adapté aux nouveaux identifiants d'import ; celui des traductions partielles vérifie désormais aussi la remontée de l'échec.

## Dépendances

- Le premier `npm audit` signalait **20 alertes : 17 modérées et 3 élevées**, en comptant les dépendances affectées par propagation.
- Les mises à jour compatibles incluent notamment Vitest et coverage 5.1.0, ESLint 10.14.0, typescript-eslint 8.72.1, Inquirer 8.7.5 et les correctifs transitifs de Vite, brace-expansion et source-map-js.
- `minimatch` est forcé en `^11.0.4` dans le dépôt ; le contrôle npm après installation ne signale **aucune vulnérabilité connue** dans ce verrou.
- TypeScript reste en 6.0.3 et dotenv en 17.4.2 : une migration majeure n'est pas nécessaire pour ces corrections et demanderait sa propre validation.

**Distribution corrigée :** `npm run release:pack` assemble une copie de publication avec ts-morph et sa fermeture de dépendances résolue. La copie embarquée de @ts-morph/common déclare la version corrigée de minimatch ; le code JavaScript amont reste inchangé et les licences sont conservées (voir `THIRD_PARTY_NOTICES.md`). Le dépôt de développement conserve `package-lock.json` et ses overrides, sans dépendance embarquée dans son manifeste. Cette séparation préserve `npm ci` et évite de dépendre d’un override qui ne se propagerait pas au consommateur. La publication directe du checkout est bloquée ; le tarball validé est l’artefact à publier.
Sources : [avis minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249), [règles npm sur les overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides), [interpolation i18next](https://www.i18next.com/translation-function/interpolation), [namespaces next-intl](https://next-intl.dev/docs/usage/translations).

## Validation

| Contrôle local                                   | Résultat                                                  |
| ------------------------------------------------ | --------------------------------------------------------- |
| Compilation TypeScript et vérification des types | Réussies                                                  |
| ESLint, Prettier, `git diff --check`             | Réussis                                                   |
| Suite Windows / Node 26.13                       | **251 tests réussis, 28 fichiers**                        |
| Couverture des lignes                            | **95,65 %**                                               |
| Couverture des branches                          | **83,66 %**                                               |
| Seuils de couverture du dépôt                    | Respectés, sans abaissement                               |
| Suite sous Node 22.13                            | **251 tests réussis ; CLI compilé vérifié**               |
| Import de la bibliothèque compilée               | Réussi ; aucun lancement du CLI à l'import                |
| `npm audit` sur le verrou local                  | **0 alerte**                                              |
| `npm pack --dry-run`                             | Réussi ; worker compilé, types et nouveaux modules inclus |

La CI couvre Ubuntu / Windows et Node 22.13 / 24 ; les résultats distants sont consultables dans GitHub Actions. Les échanges de traduction des tests utilisent des réponses simulées : aucun appel facturé DeepL ou Google n'a été nécessaire. Les vrais workers et les écritures atomiques ont été exercés sur Windows hors du bac à sable, qui bloque certains renommages.

## Suivi des points restants de l’audit initial

| Point initial                               | Traitement dans 2.2.0                                                                                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications réelles Next.js et Vite        | Paquet assemblé installé dans les deux fixtures, boucle init/write/prune/check, builds de production et rendus traduits vérifiés. Détails dans `COMPATIBILITY.md`.                                                     |
| Dépendance minimatch chez les consommateurs | Fermeture ts-morph embarquée avec minimatch 11.0.4 ; arbre npm, audit et workers du paquet contrôlés dans un consommateur isolé.                                                                                       |
| Guide et câblage React/Vite                 | Guide spécifique et codemod `useTranslation()` disponibles, avec refus des scopes ambigus et fonctions async.                                                                                                          |
| ICU, locales et taille des lots             | Parseur FormatJS, contrôle des messages existants, protection de la grammaire pendant la traduction des branches, découverte des langues et lots bornés par taille UTF-8.                                              |
| Synchronisations concurrentes               | Verrou inter-processus réentrant dans une même opération ; nettoyage à la sortie normale et après erreur.                                                                                                              |
| Références et exclusions                    | Analyse supplémentaire des références dans les autres dossiers applicatifs avant purge, correction du glob `**/`, maintien conservateur en cas de clés dynamiques.                                                     |
| Nouveaux frameworks                         | Builds et rendus sur Next.js 16.4.5, Vite 8.3.5, React 19.3.1 et leurs bibliothèques i18n actuelles ; contrôle hebdomadaire des versions latest. Détection étendue aux layouts JavaScript et aux layouts app/[locale]. |
| Documentation et présentation               | README refondu avec un workflow SVG propre au CLI, migration 2.1 → 2.2, compatibilité, sécurité et procédure de release documentées.                                                                                   |

## Limites conservées et documentées

- L’atomicité porte sur chaque fichier ; un arrêt forcé entre plusieurs écritures n’équivaut pas à une transaction globale. Un passage suivant reprend les traductions manquantes. Un verrou résiduel n’est à retirer qu’après vérification de l’arrêt du processus.
- L’analyse de références est conservatrice : elle peut conserver des clés devenues inutiles et ne prouve pas tous les usages dans des wrappers personnalisés ou du code généré externe.
- Les routes Next.js et le provider de layout restent à intégrer ; les fichiers existants ne sont pas remplacés automatiquement.
- Le scaffold React utilise l’interpolation simple i18next ; ses pluriels natifs nécessitent une adaptation des clés, distincte d’ICU.
- Les appels facturés DeepL/Google ne font pas partie des tests locaux : les échanges de traduction sont simulés. Les applications, leurs compilations, le rendu HTTP Next.js et le rendu React sont réels.
- Les versions réellement testées figurent dans `COMPATIBILITY.md`. Les futurs contrôles latest détectent des dérives ; ils ne garantissent pas à l’avance toutes les versions futures.

La version 2.2.0 est décrite dans `CHANGELOG.md` ; `MIGRATION.md` indique les adaptations d’une installation existante.
