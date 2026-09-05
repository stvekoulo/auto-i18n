# Changelog

## [2.1.0] - 2026-09-05

### Added

- **`sync --prune`** : retire du catalogue source les clés dont le texte a disparu du code, et par ricochet de chaque locale cible. Le merge stable de `sync` n'a jamais retiré de clé de son côté — un texte supprimé du code laissait sa clé traduite s'accumuler indéfiniment. Sans `--prune`, ces clés orphelines sont seulement signalées (`SyncReport.orphanedKeys`), jamais supprimées.
- **`check` rapporte les clés orphelines** (`CheckReport.orphanedKeys`) — n'affecte jamais le code de sortie : une string temporairement invisible au scan (fichier ignoré, erreur de parsing) ne doit pas faire échouer la CI.

### Fixed

- **Écriture non atomique des catalogues.** `writeCatalog` faisait un `writeFile` direct ; un processus tué en pleine écriture (disque plein, CI annulée) laissait un JSON tronqué, sans sauvegarde pour ce fichier. Écrit désormais dans un fichier temporaire puis `rename()` (atomique, POSIX et Windows/NTFS).
- **Une seule string à placeholders incohérents faisait perdre toute la locale.** `translateOneLocale` jetait dès la première clé fautive, ce qui rejetait aussi les traductions déjà obtenues pour les autres clés du même lot. Les traductions valides sont désormais conservées ; seule la clé fautive reste manquante (retentée au prochain `sync`).

## [2.0.0] - 2026-09-04

Passe de durcissement : correction de défauts qui cassaient ou corrompaient les projets utilisateurs, fermeture des fuites de clé API, et remise à niveau des dépendances.

**Breaking changes**

- **Node.js `>= 22.12`** requis (18 et 20 sont en fin de vie).
- **Les variables d'interpolation sont renommées en identifiants ICU.** Un texte `` `Bonjour ${user.name}` `` produisait la clé `"Bonjour {user.name}"` — un message qu'ICU MessageFormat refuse au runtime. Il produit désormais `"Bonjour {userName}"`. Les catalogues existants contenant des placeholders à points doivent être corrigés à la main (voir `MIGRATION.md`).
- **Une configuration invalide arrête la commande** au lieu d'être ignorée en silence.
- **Un catalogue `messages/*.json` illisible arrête la commande** au lieu d'être traité comme vide puis écrasé.
- `ExtractedString.variables` passe de `string[]` à `TemplateVariable[]` (`{ expression, name }`) — concerne l'usage programmatique.
- `isValidConfig` est désormais stricte ; `validateConfig` renvoie la liste des problèmes.

### Fixed

- **`sync --write` générait du JavaScript invalide.** Une template literal avec une expression composée produisait `t("clé", { user.name })`, une `SyntaxError` dans le build de l'utilisateur.
- **Ordre des clés non déterministe.** Le tri passait par `localeCompare`, dont le résultat dépend des données ICU du build Node et de la locale de l'hôte : le même catalogue s'ordonnait différemment en local et en CI, avec un diff fantôme à chaque exécution. Tri par point de code.
- **Fichiers cassés comptés comme vides.** Le parser TypeScript est tolérant : un fichier invalide ressortait « scanné, 0 string » et `parseErrors` n'était jamais renseigné.
- **Sauvegardes écrasées.** Un second `sync --write` détruisait le `.backup` d'origine. Le nom est maintenant choisi de façon atomique (`.backup`, `.backup.2`, …) et `.gitignore` couvre `*.backup*`.
- **Décompte des strings câblées** faussé par les valeurs absentes du catalogue.
- `?` dans un pattern `ignore` agissait comme quantificateur d'expression régulière au lieu de correspondre à un caractère.
- La sortie du CLI n'est plus tronquée sur un tube : `check --json | jq` recevait du JSON coupé.

### Security

- **Clé Google Translate déplacée de l'URL vers l'en-tête `x-goog-api-key`** — une URL est enregistrée par les journaux d'accès, les proxys et les traces d'erreur.
- **Corps d'erreur provider masqués et tronqués** avant affichage : une réponse renvoyant la requête en écho publiait la clé dans les journaux de CI.
- **`apiKeyEnv` échappé** avant compilation en expression régulière, et valeur insérée littéralement (un `$&` dans la clé ne peut plus altérer `.env.local`).
- **`.env.local` créé en mode `0600`.**
- **`messagesDir` ne peut plus sortir de la racine du projet** — les catalogues y étaient écrits sans autre contrôle.
- **Délai maximal de 30 s par requête provider.** Sans signal d'abandon, un service qui ne répond pas figeait le CLI indéfiniment.

### Changed

- **Réessais** en backoff exponentiel avec jitter, respectant `Retry-After`. Le délai linéaire de 150 ms épuisait les tentatives bien avant la réouverture d'une fenêtre de rate-limit.
- **Locales traduites en parallèle** (4 à la fois) au lieu d'une par une.
- **Une seule traversée d'AST** par fichier au lieu de cinq (285 ms → 81 ms sur 300 fichiers).
- **`sync` n'exige une clé API que s'il y a du texte à traduire** : un projet déjà complet se synchronise sans secret.
- Catalogues cibles lus et écrits en parallèle.
- Dépendances : `ora` supprimée (déclarée, jamais importée), `inquirer` remplacée par `@inquirer/prompts` (typée nativement — le shim `src/types/inquirer.d.ts` disparaît), `ts-morph` 22 → 28 (TypeScript embarqué 5.4 → 6.0), `chalk` / `commander` / `dotenv` / `diff` aux majeures courantes. **Arbre de production : 95 → 40 paquets** (installation propre des seules dépendances publiées, peers optionnels exclus des deux côtés).
- Le champ `$schema` des configs générées pointe vers l'URL publiée, le chemin `node_modules` ne résolvant ni sous Yarn PnP ni depuis un paquet hissé en monorepo.
- Outillage de développement : ESLint 9 → 10, `typescript-eslint` 8.69, `eslint-config-prettier` 9 → 10, Vitest 4 → 5, TypeScript 5.9 → 6.0.3 — la même version que celle embarquée par ts-morph 28, donc le compilateur qui construit le paquet et le parseur qui lit votre code s'accordent. TypeScript 7 a été essayé puis écarté : `typescript-eslint` refuse toute majeure ≥ 7 (typescript-eslint#10940).
- **Couverture de tests mesurée** (`npm run test:coverage`) avec des seuils vérifiés en CI. 105 → 186 tests : provider DeepL (le mapping d'erreurs, `Retry-After` et le masquage de la clé n'avaient aucun test là où Google en avait), rendu terminal, et le pool de workers.

### Added

- **Pool de workers pour le scan** (`node:worker_threads`), activé au-delà de 3 500 fichiers. Le parsing est le seul travail vraiment gourmand en CPU du package, et une concurrence `async` ne le répartit sur aucun cœur supplémentaire. Le seuil et le nombre de workers viennent du banc d'essai, pas de l'intuition : démarrer un worker y recharge ts-morph (~400 ms), coût que le parallélisme ne rattrape qu'à partir de plusieurs milliers de fichiers — 0,76x à 1 500 fichiers, 1,05x à 3 500, 1,25x à 6 000. En dessous du seuil le pool ne démarre pas, donc aucun projet ne ralentit. `scanProject` accepte `workers` et `workerPath` ; `ProjectScanResult.workersUsed` dit quel régime a servi.
- **`rootDirs`** en configuration : dossiers de premier niveau à scanner. La liste était figée, donc un projet organisé sous `modules/` ou `views/` ne scannait rien tout en signalant un succès.
- **CI GitHub Actions** : lint, format, types, tests avec couverture, build et `npm pack` sur Node 22 et 24.
- **`SECURITY.md`**, `.nvmrc`.
- 40 tests de régression supplémentaires (105 → 145).

## [1.1.0] - 2026-07-02

### Added

- **`sync --write [--dry-run]`** : câble mécaniquement les strings `safety: 'safe'` en `t()`, mais seulement quand c'est prouvable sans ambiguïté — composant client (`useTranslations`), ou composant serveur déjà `async` (`await getTranslations`), avec une fonction hôte identifiable (PascalCase, `useXxx`, ou export par défaut) et aucun `t` conflictuel dans le scope. `--dry-run` affiche le diff sans écrire ; sinon chaque fichier modifié est sauvegardé en `.backup`. Tout le reste (scope module, fonction hôte ambiguë, serveur non-async, corps de fonction concis) reste dans le guide, inchangé.
- **Provider Google Translate** (`"provider": "google"`) en plus de DeepL — même contrat `TranslationProvider`, protection des placeholders `{var}`. `init` demande désormais le provider à utiliser (`--provider deepl|google`).
- **Détection de pluriels probables** : un template literal dont la variable interpolée ressemble à un compteur (`count`, `total`, `length`…) est signalé dans le guide avec une suggestion de syntaxe ICU MessageFormat, plutôt qu'un simple `t(key, { count })`.
- Scan de projet parallélisé (concurrence bornée) — accélère les gros projets sans changer le résultat.
- **Scaffold react-i18next** pour les projets React/Vite hors Next.js (détecté quand aucun `app/layout.tsx` n'est trouvé) : `init` génère `src/i18n.ts` (config `i18next` chargeant les catalogues déjà traduits), ajoute `import './i18n'` au point d'entrée (`src/main.tsx`/`src/index.tsx`, avec backup), et un `LanguageSwitcher` basé sur `useTranslation()`. `next-intl`/`i18next`/`react-i18next` sont désormais tous des peer dependencies optionnelles (un seul des deux couples est nécessaire selon le projet). **Limite connue** : le guide d'intégration reste orienté next-intl (`useTranslations`/`getTranslations`) — sur un projet react-i18next, adaptez ses suggestions à `useTranslation()`. `sync --write` est désormais **désactivé** sur un projet détecté react-i18next (il injecterait sinon des imports `next-intl` inexistants).

### Changed

- Outillage dev : ESLint (flat config, `typescript-eslint`) + Prettier, scripts `lint`/`lint:fix`/`format`/`format:check`. Codebase reformatée en conséquence.
- Retiré `@babel/parser` et `@babel/types` des `dependencies` : vestiges du fallback JS jamais implémenté (l'extraction utilise exclusivement `ts-morph`), inutiles en pratique.

## [1.0.2] - 2026-06-03

### Added

- **`MIGRATION.md`** : guide de migration 0.x → 1.0 (français + résumé anglais pour les notes de release), livré dans le package et lié depuis le README.

## [1.0.1] - 2026-06-03

### Added

- **JSON Schema** (`schema/auto-i18n.config.schema.json`) pour `auto-i18n.config.json` : autocomplétion, validation et infobulles dans VSCode. `init` écrit désormais `"$schema"` dans la config générée.
- **Entrée bibliothèque** (`main`/`types`/`exports`) : `import { runCheck, runSync } from 'next-auto-i18n'` sans exécuter le CLI. Le binaire reste exposé via `bin`.
- Section « Usage programmatique » dans le README et exemples dans `--help`.

### Changed

- `package.json` : `exports` map, `sideEffects: false`, `files` inclut `schema/` et `CHANGELOG.md`, scripts `typecheck` et `test:run`, description à jour.

## [1.0.0] - 2026-06-03 - Refonte majeure (zéro-mutation)

Réécriture complète vers une architecture `core` pur + `adapters`. **Breaking change** : le CLI ne réécrit plus le code source.

### Changed

- **Modèle zéro-mutation** : l'outil ne modifie plus le JSX / les composants. Il détecte, catalogue, traduit et génère un **guide d'intégration** (`i18n-guide.md`) décrivant le câblage `t()` fichier par fichier. C'était la principale source d'erreurs en projet réel.
- **Infra `next-intl` additive** : `i18n/routing.ts`, `i18n/request.ts`, middleware/proxy, plugin `next.config` (avec backup) et `LanguageSwitcher` ne sont créés que s'ils sont absents. Plus de restructuration automatique de `app/[locale]` (instructions dans le guide).
- **Surface réduite à 3 commandes** : `init`, `sync`, `check`.
- **`check`** : nouvelle commande read-only pour la CI (`--json`, code de sortie ≠ 0 si travail en attente).
- **Provider de traduction abstrait** : interface `TranslationProvider` (DeepL implémenté), extensible.
- `auto-i18n.config.json` : seuls `sourceLocale` et `targetLocales` sont requis, le reste reçoit des défauts.

### Removed

- Commandes `add-locale`, `missing`, `extract`, `extract sync` (remplacées par `init`/`sync`/`check`).
- Réécriture AST du code source (`src/rewriter`) et restructuration `app/[locale]` automatique.

### Fixed

- La version affichée par le CLI est désormais lue depuis `package.json` (était figée à `0.7.3`).

### Architecture

- `src/core` (pur, sans I/O, 100 % testable) ← `src/pipeline` (orchestration) ← `src/commands` ← `src/cli`. `src/adapters` (fs, project, scaffold, translation) pour l'I/O. Suite de tests : 66 cas.

## [0.7.3] - 2026-04-07

### Added

- **Commande `extract`** : scanne le projet, génère les fichiers de traduction et produit un guide d'intégration Markdown (`i18n-guide.md`) — **sans modifier aucun fichier source**.
  - `--out <path>` : chemin personnalisé du guide (défaut : `i18n-guide.md`)
  - `--locale <locales>` : langues cibles si aucune config n'existe
  - `--inject` : configure next.config, middleware.ts, i18n/routing.ts, i18n/request.ts et app/[locale]/ après extraction
  - `--switcher` : injecte uniquement le Language Switcher flottant (sans `--inject`)
  - `--no-module-scope` : exclut les strings dans les `const` module-scope de la détection et de la traduction
  - Fonctionne sans `auto-i18n.config.json` (prompts interactifs en fallback)
  - Le guide inclut : résumé, fichiers générés, exemples client/serveur, section module-scope, tableaux par fichier, référence des clés

- **Commande `extract sync`** : sous-commande de `extract` — rescanne le projet, intègre les nouvelles strings et synchronise les traductions **sans réécrire les fichiers source**. Même merge stable que `sync`.
  - `--inject` : configure Next.js après la synchronisation
  - `--switcher` : injecte uniquement le Language Switcher
  - `--no-module-scope` : exclut les strings module-scope du scan et de la traduction

- **Détection des strings module-scope** : les strings dans des `const` à niveau module sont détectées, traduites dans le JSON, et signalées en CLI (fichier + ligne + clé). Le code source n'est pas réécrit (la fonction `t()` n'est accessible qu'à l'intérieur d'un composant).

- **Sortie CLI détaillée** : toutes les commandes affichent des informations enrichies (fichiers scannés, remplacements par fichier, clés nouvelles vs existantes, strings module-scope).

### Fixed

- **Entités HTML DeepL** : `&apos;`, `&#39;`, `&#x27;`, `&quot;`, `&#34;` sont maintenant correctement restaurés — corrige l'affichage `d&apos;exception` au lieu de `d'exception`.
- **`sync` — stabilité des clés** : les clés existantes sont désormais préservées via `existingMessages` (merge stable). Plus de régénération depuis zéro.
- **`sync` — traduction toujours exécutée** : la synchronisation des traductions s'exécute même si le scan ne trouve aucune nouvelle string.
- **`extract` — clé API perdue** : lors du premier lancement sans config, la clé saisie interactivement était ignorée lors du check suivant — corrigé en la transmettant directement.
- **Tests `key-builder`** : limite de troncature corrigée de 40 à 60 dans les tests (correspondant à l'implémentation réelle).

### Changed

- `generateMessages` accepte `existingMessages?: Record<string, string>` pour le merge incrémental stable.
- `GenerateResult` expose `newCount: number`.
- `RewriteResult` expose `moduleScopeStrings: UnrewrittenString[]` et `details: FileRewriteDetail[]`.
- `src/cli/doc-generator.ts` : nouveau module dédié à la génération du guide Markdown.

## [0.3.0] - 2026-03-26

### Added

- **`i18n/request.ts`** : fichier de configuration requis par next-intl pour les Server Components — genere automatiquement avec `getRequestConfig` et fallback sur la locale par defaut.
- **Structure `app/[locale]/`** : creation automatique du dossier dynamique requis par le App Router next-intl. Les pages existantes sont deplacees, un `[locale]/layout.tsx` est genere avec `NextIntlClientProvider` + `LanguageSwitcher`, et le root layout est simplifie en HTML shell pur.
- **`<html lang={locale}>`** : l'attribut `lang` du document HTML est desormais dynamique, refletant la locale active (accessibilite + SEO).
- **Detection Next.js 16** : si la version de Next.js installee est >= 16, l'injecteur genere `proxy.ts` au lieu de `middleware.ts` (convention Next.js 16+).

### Fixed

- **Rewriter ne detruit plus `LanguageSwitcher.tsx`** : les fichiers generes par le package (`LanguageSwitcher.tsx`) sont exclus du scan et de la reecriture AST.
- **`LanguageSwitcher` dans le provider** : le composant est maintenant dans `<NextIntlClientProvider>` (via `[locale]/layout.tsx`), ce qui evite tout crash lie au contexte.
- **TypeScript readonly cast** : `routing.locales as string[]` corrige en `[...routing.locales] as string[]` pour eviter l'erreur de conversion de tuple readonly.
- **Config `ignore` transmis au scanner** : les patterns du champ `ignore` de `auto-i18n.config.json` (ex: `**/*.test.*`) sont maintenant passes a `scanProject` via `ignorePatterns`.
- **Scope de scan limite aux dossiers Next.js** : les fichiers `.mjs` ou `.ts` a la racine du projet ne sont plus scannes. Le scanner ne descend que dans `app/`, `src/`, `pages/`, `components/`, `lib/`, `hooks/`, `utils/`.
- **Dossiers `i18n/` et `messages/` exclus** : ces dossiers generes par le package sont ajoutes aux `DEFAULT_IGNORE_DIRS` internes du scanner.
- **Support glob patterns** dans `ignorePatterns` : les patterns `**/*.test.*` sont desormais correctement interpretes (conversion glob → RegExp).

### Changed

- L'orchestrateur `injectAll()` ne modifie plus le root `layout.tsx` directement — la configuration next-intl passe exclusivement par `app/[locale]/layout.tsx`.
- `InjectAllResult` : remplacement de `layout` par `localeStructure` + ajout de `request`.

## [0.2.0] - 2026-03-26

### Added

- **Language Switcher** : composant flottant genere automatiquement et injecte dans le layout, permettant aux utilisateurs de changer de langue depuis le navigateur. Personnalisable (position, theme, couleur d'accent, taille).
- **Auto-install next-intl** : detection automatique du package manager (npm/yarn/pnpm) et installation de `next-intl` si absent.
- **Attribution** : tag "Made by Steven Koulo" integre au widget (requis par la licence).

### Fixed

- **Scanner** : les template literals dans `className`, `style`, `id`, `href`, `src` et autres attributs non traduisibles ne sont plus extraits.
- **Rewriter** : les crashes AST sur les structures complexes (ternaires, expressions imbriquees) sont desormais absorbes gracieusement (try/catch).
- **Pipeline** : la reecriture de chaque fichier est isolee — un fichier en erreur n'arrete plus le reste du pipeline.
- **CLI** : l'etape d'injection (middleware, routing, layout) s'execute meme si la reecriture echoue partiellement.

### Changed

- Mise a jour de vitest 1.6.x vers 4.1.x pour compatibilite Node.js 25.

## [0.1.0] - 2026-03-26

### Initial release

- **Scanner** : extraction AST des strings JSX, attributs et template literals
- **Generator** : generation des cles i18n et du fichier `messages/<locale>.json`
- **Translator** : traduction automatique via DeepL API (batch, incrementiel)
- **Rewriter** : reecriture des composants React (`t("cle")`, `useTranslations`, `getTranslations`)
- **Injector** : configuration automatique de Next.js (`layout.tsx`, `next.config`, `middleware.ts`, `i18n/routing.ts`)
- **CLI** : commandes `init`, `sync`, `add-locale`, `missing`
- Mode `--dry-run` pour preview sans modification
- Backups automatiques (`*.backup`)
- Support Server Components et Client Components
- Protection des placeholders lors de la traduction
