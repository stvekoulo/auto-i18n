# Changelog

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
