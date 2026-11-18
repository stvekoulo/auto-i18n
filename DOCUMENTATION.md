# next-auto-i18n — Documentation

**Internationalisation incrémentale et câblage sûr pour Next.js App Router, React/Vite et Expo.**

> Ce document complète le [README](./README.md). L'outil privilégie toujours la sûreté : toute situation ambiguë est signalée dans le guide plutôt que réécrite au hasard.

---

## Prérequis

- **Node.js `>= 22.13.0`**
- Un projet **Next.js App Router** (`next-intl`), **React / Vite** (`i18next` + `react-i18next`), ou **Expo / React Native** (`expo-localization` + `i18next` + `react-i18next`)
- Une clé API pour l'un des providers supportés : **DeepL**, **Google Translate**, **Google Gemini**, **OpenAI** ou **Anthropic Claude**

## Commandes CLI

### `init`

Mise en place initiale, à exécuter une seule fois :

```bash
next-auto-i18n init [--source <locale>] [--locale <l1,l2>] [--provider <name>] [--guide <path>]
```

- Refuse d'écraser un `auto-i18n.config.json` déjà existant.
- Vérifie que `--guide` reste confiné à l'intérieur de la racine du projet.
- Met à jour `.gitignore` (`.env.local`, `*.backup*`), enregistre la clé dans `.env.local` (`0600`), crée l'infrastructure manquante (Next.js, React/Vite ou Expo), traduit les catalogues et génère `i18n-guide.md`.

### `sync`

Synchronisation incrémentale au quotidien :

```bash
next-auto-i18n sync [--write] [--no-backup] [--prune] [--dry-run] [--watch]
```

- **Merge stable :** les clés existantes sont conservées.
- **Re-traduction des textes source modifiés :** une empreinte SHA-256 légère (`.auto-i18n-hashes.json`) détecte automatiquement si le texte source d'une clé existante a été corrigé dans `<sourceLocale>.json` et retraduit uniquement les clés modifiées.
- **`--write` :** câble les chaînes `safe` dans les composants client, les fonctions fléchées à corps concis (`() => <span/>`), les fonctions serveur déjà `async` et `export async function generateMetadata()`.
- **`--no-backup` :** désactive la création des fichiers `.backup` lorsque votre dépôt Git gère déjà l'historique.
- **`--prune` :** retire les clés orphelines après vérification différentielle dans tous les dossiers applicatifs du dépôt.
- **`--watch` :** surveille les dossiers applicatifs (`fs.watch` récursif) et lance une synchronisation coalescée à chaque sauvegarde.

### `add-locale`

```bash
next-auto-i18n add-locale <l1,l2> [--dry-run]
```

Valide les nouveaux codes de langue, met à jour `auto-i18n.config.json`, complète `i18n/routing.ts` (Next.js) ou `src/i18n.ts` (React/Expo), et traduit immédiatement les nouvelles locales.

### `restore` et `clean-backups`

```bash
next-auto-i18n restore [--dry-run]
next-auto-i18n clean-backups [--dry-run]
```

- `restore` rétablit chaque fichier modifié depuis sa sauvegarde `.backup` d'origine puis supprime ses sauvegardes.
- `clean-backups` nettoie l'ensemble des fichiers `*.backup*` du projet.

### `check`

Diagnostic en lecture seule pour la CI :

```bash
next-auto-i18n check [--json] [--format text|json|github]
```

- Code de sortie `1` en cas d'erreur de syntaxe, de chaîne non cataloguée, de traduction manquante, de texte source modifié non retraduit (`outdatedKeys`) ou de message ICU invalide (`invalidByLocale`).
- `--format github` émet des annotations `::warning` et `::error` directement sur les lignes concernées dans GitHub Actions.

### `languages`

```bash
next-auto-i18n languages --provider deepl|google [--source] [--json]
```

---

## Extraction, Filtres et Sûreté AST

L'analyseur utilise directement le compilateur officiel **`typescript`** (`ts.createSourceFile`, zéro dépendance transitive) :

- **Textes extraits :** `JsxText` (entités HTML/JSX décodées et indentation multi-ligne normalisée), attributs JSX HTML/ARIA (`placeholder`, `alt`, `title`, `aria-*`, `label`, `content`) et attributs **Expo / React Native** (`accessibilityLabel`, `accessibilityHint`, `tabBarLabel`, `headerTitle`, `drawerLabel`, `backButtonTitle`), expressions conditionnelles dans les attributs traduisibles, `StringLiteral` et `TemplateLiteral`.
- **Contextes exclus :** directives `'use client'` / `'use server'`, comparaisons `===` / `!==`, `switch / case`, indexations `obj['cle']`, utilitaires CSS (`cn`, `clsx`, `cva`, `twMerge`…), fichiers `.d.ts`, `middleware.ts`, `proxy.ts`, routes serveur Expo `*+api.ts` et fichiers `*.config.*`.
- **Échappement ICU :** les apostrophes simples adjacentes à un placeholder (`Code '${code}'`) et les accolades littérales sont échappées afin de préserver les variables au runtime dans `next-intl`.
- **Métadonnées Next.js :** `export const metadata = { ... }` est identifié spécifiquement (`nextjs_metadata`) avec un patron de migration vers `generateMetadata()` dans le guide.

---

## Catalogues Plats ou Imbriqués (`catalogFormat`)

Par défaut, les fichiers JSON sont à plat (`"catalogFormat": "flat"`). En configurant :

```json
{
  "catalogFormat": "nested",
  "namespaceByFile": true
}
```

les catalogues sont lus et écrits sous forme d'objets imbriqués (`{ "HeroBanner": { "bienvenue": "Bienvenue" } }`), et `--write` sait également réutiliser un `useTranslations('HeroBanner')` existant lorsque le préfixe correspond.

---

## Providers Classiques et IA Contextuelle

| Provider    | Variable par défaut       | Particularités                                                                                                        |
| ----------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `deepl`     | `AUTO_I18N_DEEPL_KEY`     | Lots 128 Kio, protection XML des balises/ICU, codes régionaux normalisés (`zh-CN` → `ZH-HANS`), `tone` → `formality`. |
| `google`    | `AUTO_I18N_GOOGLE_KEY`    | Lots 100 Ko, protection HTML `<span translate="no">`, clé transmise en en-tête `x-goog-api-key`.                      |
| `gemini`    | `AUTO_I18N_GEMINI_KEY`    | Modèle par défaut `gemini-2.5-flash` ; reçoit le contexte UI (`<button>`, `placeholder`), `tone` et `glossary`.       |
| `openai`    | `AUTO_I18N_OPENAI_KEY`    | Modèle par défaut `gpt-4o-mini` (`json_object`) ; reçoit le contexte UI, `tone` et `glossary`.                        |
| `anthropic` | `AUTO_I18N_ANTHROPIC_KEY` | Modèle par défaut `claude-haiku-4-5` ; reçoit le contexte UI, `tone` et `glossary`.                                   |

---

## Architecture du Code

```text
src/
  core/        pur, zéro I/O — extraction (parse, context, jsx-text, variables), filters, keys, catalog (icu, flatten, hashes), scan, check, guide, write
  adapters/    I/O — fs (collecte, catalogues, hashes, lock), project (Next/Vite/Expo), scaffold (templates dédiés), translation (deepl, google, llm), worker
  pipeline/    orchestration — scan, sync, translate, write
  commands/    init, sync, check, add-locale, backups, watch
  reporting/   rendu terminal, JSON et GitHub Actions
  config/      chargement et validation exhaustive
  cli/         entrée Commander + invites interactives
  utils/       chemins confinés (realpath), env isolé (util.parseEnv), concurrence, logger
```
