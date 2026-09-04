<p align="center">
  <h1 align="center">next-auto-i18n — Documentation</h1>
</p>

<p align="center"><strong>Internationalisation zéro-mutation pour Next.js App Router.</strong></p>

> Ce document complète le [README](./README.md). En cas de divergence, le README fait foi pour les garanties publiques. L'outil préfère toujours signaler un cas à revoir plutôt que de modifier votre code à risque.

---

## Table des matières

- [Principe](#principe)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Démarrage rapide](#démarrage-rapide)
- [Commandes](#commandes)
  - [init](#init)
  - [sync](#sync)
  - [check](#check)
- [Câblage automatique (`sync --write`)](#câblage-automatique-sync---write)
- [Configuration](#configuration)
- [Comment ça marche](#comment-ça-marche)
- [Types de strings détectées](#types-de-strings-détectées)
- [Filtrage (ce qui est ignoré)](#filtrage-ce-qui-est-ignoré)
- [Strings « à revoir »](#strings--à-revoir-)
- [Pluriels probables](#pluriels-probables)
- [Le guide d'intégration](#le-guide-dintégration)
- [Infrastructure next-intl générée](#infrastructure-next-intl-générée)
- [Projets React/Vite (react-i18next)](#projets-reactvite-react-i18next)
- [Traduction et providers](#traduction-et-providers)
- [Intégration CI](#intégration-ci)
- [Architecture du code](#architecture-du-code)
- [Dépannage](#dépannage)

---

## Principe

L'erreur que commettent les outils « tout automatiques » est de **réécrire le JSX** de l'utilisateur pour y injecter `t()`. Sur du code réel — ternaires, fragments, espaces inline, composants imbriqués, client/serveur — cette réécriture casse régulièrement le rendu.

`next-auto-i18n` adopte le modèle inverse, **zéro-mutation** :

1. **Détecter** les textes traduisibles (analyse AST en lecture seule).
2. **Cataloguer** : générer des clés stables et remplir `messages/<source>.json`.
3. **Traduire** les langues cibles via DeepL ou Google Translate.
4. **Installer** l'infra i18n manquante (fichiers additifs) — `next-intl` si un `app/layout.tsx` Next.js est détecté, `react-i18next` sinon.
5. **Expliquer** : produire un guide qui dit où et comment câbler chaque `t()`.

Votre code applicatif n'est jamais modifié, à deux mutations ciblées et sauvegardées (`.backup`) près : l'enrobage de `next.config.*` par `withNextIntl` (Next.js), et l'ajout d'un `import './i18n'` au point d'entrée (React/Vite) — chacune seulement si la structure est reconnue, sinon `manual`.

## Prérequis

- Node.js `>= 18`
- Next.js App Router avec `next-intl`, **ou** un projet React/Vite avec `react-i18next`
- Une clé API DeepL (Free ou Pro) ou Google Translate

## Installation

```bash
# Next.js App Router
npm install -D next-auto-i18n
npm install next-intl

# React / Vite
npm install -D next-auto-i18n
npm install i18next react-i18next
```

## Démarrage rapide

```bash
npx next-auto-i18n init
```

Puis ouvrez `i18n-guide.md` et suivez-le pour câbler vos `t()`. Relancez `sync` à chaque fois que vous ajoutez du texte.

## Commandes

### init

Mise en place complète, à exécuter une fois.

```bash
next-auto-i18n init [--source <locale>] [--locale <l1,l2>] [--provider <name>] [--guide <path>]
```

| Option              | Effet                                    |
| ------------------- | ---------------------------------------- |
| `--source <locale>` | Langue source (sinon demandée)           |
| `--locale <l1,l2>`  | Langues cibles (sinon demandées)         |
| `--provider <name>` | Provider de traduction (sinon demandé)   |
| `--guide <path>`    | Chemin du guide (défaut `i18n-guide.md`) |

Étapes : `.gitignore` (`.env.local`, `*.backup`) → `.env.local` (clé) → `auto-i18n.config.json` → scaffold infra → catalogues + traduction → guide.

### sync

À lancer régulièrement. Rescanne, met à jour le catalogue source (merge stable : les clés existantes sont préservées) et traduit uniquement les clés manquantes des langues cibles.

```bash
next-auto-i18n sync
```

Code de sortie ≠ 0 si une locale n'a pas pu être traduite.

### check

Diagnostic en lecture seule, pour la CI. N'écrit rien.

```bash
next-auto-i18n check [--json]
```

Rapporte : fichiers scannés, strings détectées (sûres / à revoir), strings non encore cataloguées (un `sync` les ajouterait), traductions manquantes par locale, fichiers non parsables. **Code de sortie 1** s'il reste du travail (non catalogué ou non traduit), 0 sinon.

## Câblage automatique (`sync --write`)

```bash
next-auto-i18n sync --write [--dry-run]
```

Par défaut, `next-auto-i18n` ne modifie jamais votre code (modèle zéro-mutation). `--write` est une option **opt-in** qui câble mécaniquement en `t()` le sous-ensemble des strings `safety: 'safe'` pour lequel c'est prouvable sans ambiguïté. C'est délibérément restrictif :

| Condition                                                                            | Comportement                                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Composant client (`'use client'`)                                                    | Toujours éligible → injecte `import { useTranslations } from 'next-intl'` et `const t = useTranslations();`                  |
| Composant serveur déjà `async`                                                       | Éligible → injecte `import { getTranslations } from 'next-intl/server'` et `const t = await getTranslations();`              |
| Composant serveur **non** `async`                                                    | Ignoré (`server_not_async`) — convertir une fonction sync en async automatiquement est trop risqué pour les signatures/types |
| Fonction hôte non identifiable (pas PascalCase, pas `useXxx`, pas export par défaut) | Ignoré (`no_host`)                                                                                                           |
| `t` déjà présent dans le scope, mais pas issu de `useTranslations`/`getTranslations` | Ignoré (`t_conflict`) — collision, pas d'écrasement                                                                          |
| Fonction fléchée à corps concis (`() => <div/>` sans bloc)                           | Ignoré (`concise_body`)                                                                                                      |

Dans tous les cas ignorés, la string reste `safe` dans le guide — rien n'est perdu, juste laissé au câblage manuel.

Mécanique interne : les édits sont calculés comme des remplacements de plage `[start, end)` sur le texte source d'origine (jamais de mutation d'AST en direct), puis appliqués en une seule passe. `--dry-run` calcule les mêmes édits et affiche un diff coloré sans toucher au disque ; sans `--dry-run`, chaque fichier modifié est d'abord sauvegardé en `<fichier>.backup`. Le procédé est idempotent : un `t()` déjà en place n'est jamais re-câblé (l'extraction ignore le premier argument des appels `t()`/`translate()`).

## Configuration

`auto-i18n.config.json` à la racine. Seuls `sourceLocale` et `targetLocales` sont requis ; les autres champs ont des défauts.

```json
{
  "sourceLocale": "fr",
  "targetLocales": ["en", "es"],
  "provider": "deepl",
  "apiKeyEnv": "AUTO_I18N_DEEPL_KEY",
  "messagesDir": "./messages",
  "ignore": ["node_modules", ".next", "**/*.test.*", "**/*.spec.*"],
  "rootDirs": ["app", "src", "components"]
}
```

| Champ           | Défaut                | Rôle                                                |
| --------------- | --------------------- | --------------------------------------------------- |
| `sourceLocale`  | —                     | Langue source (requis)                              |
| `targetLocales` | —                     | Langues cibles (requis)                             |
| `provider`      | `deepl`               | Provider de traduction (`deepl` ou `google`)        |
| `apiKeyEnv`     | `AUTO_I18N_DEEPL_KEY` | Variable d'env contenant la clé                     |
| `messagesDir`   | `./messages`          | Dossier des catalogues (doit rester dans le projet) |
| `ignore`        | voir ci-dessus        | Patterns glob à exclure du scan                     |
| `rootDirs`      | liste intégrée        | Dossiers de premier niveau à scanner                |

### Validation

La configuration est validée à chaque chargement et **tous** les problèmes sont rapportés en une passe (`ConfigInvalidError`) :

- champ inconnu (une faute de frappe comme `messageDir` n'est plus ignorée en silence) ;
- `sourceLocale` / `targetLocales` qui ne sont pas des étiquettes de langue (`fr`, `pt-BR`, `zh-Hans-CN`) ;
- doublon dans `targetLocales`, ou langue source présente dans les cibles ;
- `provider` hors de `deepl` / `google` ;
- `apiKeyEnv` qui n'est pas un nom de variable d'environnement valide ;
- `messagesDir` absolu ou remontant hors de la racine du projet.

## Comment ça marche

```
collecte fichiers (adapters/fs)
        │
        ▼
parse + extraction AST (core/extraction)  ── lecture seule
        │
        ▼
filtrage heuristique (core/filters)
        │
        ▼
catalogue source : clés stables + merge (core/catalog, core/keys)
        │
        ├──► écriture messages/<source>.json
        ├──► traduction cibles (pipeline/translate + adapters/translation)
        └──► guide d'intégration (core/guide)
```

Le scan ne descend que dans les dossiers applicatifs courants (`app`, `src`, `components`, `lib`, `hooks`, `utils`, `ui`, `features`, `shared`, `pages`) et ignore `node_modules`, `.next`, `dist`, `messages`, `i18n`, etc.

## Performance du scan

Le scan est le seul travail réellement gourmand en CPU du package : lire un fichier coûte une microseconde, le parser en coûte mille. Deux régimes, choisis automatiquement, pour un résultat identique :

- **En dessous de 3 500 fichiers** — concurrence `async` bornée sur le thread principal.
- **Au-delà** — un pool de workers (`node:worker_threads`), à condition que la machine ait assez de cœurs.

Le seuil vient de la mesure, pas de l'intuition : démarrer un worker y recharge ts-morph (environ 400 ms, 570 ms pour quatre en parallèle), coût que le parallélisme ne rattrape qu'à partir de plusieurs milliers de fichiers. Sur 8 threads logiques, avec un fichier de composant représentatif :

| Fichiers | Thread principal | 3 workers | Rapport |
| -------: | ---------------: | --------: | ------: |
|     1500 |          1698 ms |   2226 ms |   0,76x |
|     2500 |          3038 ms |   3484 ms |   0,87x |
|     3500 |          3854 ms |   3664 ms |   1,05x |
|     4500 |          5260 ms |   4407 ms |   1,19x |
|     6000 |          6677 ms |   5346 ms |   1,25x |

Le nombre de workers vise les cœurs **physiques** moins celui du thread principal : le parsing sature la bande passante mémoire et ne tire presque rien de l'hyperthreading. Sur 6 000 fichiers et 8 threads logiques : 3 workers 5 346 ms, 2 workers 6 065 ms, 4 workers 6 184 ms.

En usage programmatique, `scanProject` accepte `workers` (`0` force le thread principal) et `workerPath` (pour un empaqueteur qui déplace les fichiers émis). `ProjectScanResult.workersUsed` indique le régime effectivement employé.

## Types de strings détectées

| Type                    | Exemple                   | Câblage suggéré             |
| ----------------------- | ------------------------- | --------------------------- |
| Texte JSX               | `<p>Bonjour</p>`          | `{t("bonjour")}`            |
| Attribut traduisible    | `placeholder="Chercher"`  | `{t("chercher")}`           |
| Template literal        | `` `Bienvenue` ``         | `t("bienvenue")`            |
| Template avec variables | `` `Salut ${name}` ``     | `t("salut_name", { name })` |
| String literal          | `const label = "Valider"` | `t("valider")`              |

Attributs traduisibles : `placeholder`, `alt`, `title`, `aria-label`, `aria-placeholder`, `aria-description`, `aria-details`, `label`, `content`.

## Filtrage (ce qui est ignoré)

Des heuristiques écartent le bruit technique : nombres, valeurs CSS (`16px`), couleurs (`#fff`, `rgba(...)`), URLs et routes, types MIME, variables d'environnement (`API_BASE_URL`), classes CSS / tokens Tailwind (`flex items-center`), mots-clés techniques (`POST`, `flex`…), identifiants camelCase, emojis/symboles seuls. Une `blacklist` personnalisée peut être ajoutée via les options de filtrage.

## Strings « à revoir »

Deux cas ne sont pas marqués « sûrs à câbler automatiquement » :

- **`module_scope`** : string dans une `const` au niveau module (hors composant). `t()` n'y est pas accessible — il faut déplacer la valeur dans un composant/hook, ou la passer via une fonction recevant `t`.
- **`jsx_inline_spacing`** : texte JSX dont l'espacement (saut de ligne, voisins inline) est sensible et pourrait être altéré par un wrap naïf.

Ces strings sont quand même **détectées, cataloguées et traduites** ; elles sont simplement signalées dans le guide avec une note.

## Pluriels probables

Un template literal dont la variable interpolée ressemble à un compteur (`count`, `total`, `num`, `qty`, `quantity`, `amount`, `length`…) — par exemple `` `${count} articles` `` — est signalé comme candidat pluriel plutôt que traité comme un texte figé. `t("clé", { count })` fonctionne toujours, mais `next-intl` sait gérer l'accord singulier/pluriel via ICU MessageFormat ; le guide inclut une section dédiée avec une suggestion prête à adapter :

```json
"count_articles": "{count, plural, one {# ...} other {# articles}}"
```

## Le guide d'intégration

Généré par `init` (et reposant sur les mêmes données que `sync`). Il contient :

- un résumé (nombre de strings, sûres vs à revoir) ;
- un rappel du câblage client (`useTranslations`) vs serveur (`await getTranslations`) ;
- **par fichier** : le runtime détecté, le hook à utiliser, et un tableau `| Ligne | Texte | Clé | Remplacement |` ;
- une note par fichier contenant des strings module-scope ;
- la procédure manuelle de mise en place de `app/[locale]/`.

## Infrastructure next-intl générée

`init` crée uniquement ce qui est **absent** :

| Cible          | Fichier                                      | Statut possible                         |
| -------------- | -------------------------------------------- | --------------------------------------- |
| Routing        | `i18n/routing.ts` (ou `src/i18n/`)           | créé / déjà présent                     |
| Request config | `i18n/request.ts`                            | créé / déjà présent                     |
| Middleware     | `middleware.ts` (ou `proxy.ts` si Next ≥ 16) | créé / déjà présent                     |
| Plugin Next    | `next.config.*`                              | enrobé (backup) / déjà présent / manuel |
| Switcher       | `components/LanguageSwitcher.tsx`            | créé / déjà présent                     |

`app/[locale]/` n'est **jamais** restructuré automatiquement : la marche à suivre est dans le guide.

## Projets React/Vite (react-i18next)

Framework détecté automatiquement : si aucun `app/layout.tsx` (ni `src/app/layout.tsx`) n'est trouvé, `init` scaffold `react-i18next` au lieu de `next-intl`. Aucune option à passer.

| Cible          | Fichier                                        | Statut possible                                |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| Config i18n    | `src/i18n.ts`                                  | créé / déjà présent                            |
| Point d'entrée | `src/main.tsx` (ou `main.ts(x)`/`index.ts(x)`) | import ajouté (backup) / déjà présent / manuel |
| Switcher       | `src/components/LanguageSwitcher.tsx`          | créé / déjà présent                            |

`src/i18n.ts` importe directement chaque `messages/<locale>.json` (pas de chargement HTTP paresseux) et appelle `i18next.use(initReactI18next).init({ resources, lng, fallbackLng })`. Ce fichier, comme `LanguageSwitcher.tsx`, n'est jamais re-scanné par la suite (évite le bruit des codes de langue dans les catalogues).

**Limite connue** : le guide d'intégration reste écrit pour l'API next-intl (`useTranslations`/`getTranslations`). Sur un projet react-i18next, le tableau du guide (ligne, texte détecté, clé) reste valable, mais remplacez le remplacement suggéré par `const { t } = useTranslation();` puis `t("clé")`. `sync --write` est désactivé sur un projet détecté react-i18next (le codemod injecte des imports `next-intl`, ce qui casserait un projet qui ne l'a pas) — tout reste dans le guide.

## Traduction et providers

DeepL est le provider par défaut ; Google Translate (`"provider": "google"`) est aussi supporté. Les deux protègent les placeholders `{var}` (balises XML pour DeepL, `<span translate="no">` en HTML pour Google) avant traduction, puis les restaurent ; toute traduction qui perdrait un placeholder fait échouer proprement la locale concernée (sans écraser le fichier existant). Les erreurs réseau / 429 / 5xx sont réessayées (3 tentatives, backoff exponentiel avec jitter, en respectant l'en-tête `Retry-After` s'il est fourni) ; 403 (auth/quota) / 400 échouent immédiatement. Chaque requête est abandonnée au bout de 30 secondes. La clé API voyage en en-tête HTTP et est masquée dans tout message d'erreur reprenant une réponse du provider.

Les locales sont traduites en parallèle (4 à la fois). Si rien n'est à traduire, aucune clé API n'est requise : un projet déjà complet se synchronise sans secret.

Le provider est derrière l'interface `TranslationProvider` (`src/adapters/translation`). Ajouter un provider revient à l'enregistrer dans `createProvider` sans toucher au reste.

## Intégration CI

```yaml
# Échoue si des textes ne sont pas catalogués ou traduits
- run: npx next-auto-i18n check
```

`check --json` émet le rapport complet sur stdout pour un traitement automatisé.

## Architecture du code

```
src/
  core/        pur, zéro I/O — extraction, filters, keys, catalog, scan, check, guide, write
  adapters/    I/O — fs, project (détection), scaffold, translation (deepl, google)
  pipeline/    orchestration — scan, sync, translate, write
  commands/    init, sync, check
  reporting/   rendu terminal + JSON
  config/      chargement/validation de la config
  cli/         entrée commander + prompts
  utils/       logger, env, concurrency
```

Le `core` n'importe aucun module d'I/O et se teste sans système de fichiers ni réseau. Les pipelines combinent core + adapters ; les commandes ajoutent le chargement de config/env et le rendu.

## Dépannage

| Symptôme                        | Cause / solution                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Configuration introuvable`     | Lancez `init` d'abord.                                                                                          |
| `Clé API introuvable`           | Renseignez `AUTO_I18N_DEEPL_KEY` dans `.env.local`.                                                             |
| `next.config — action manuelle` | Structure non reconnue : enrobez votre export avec `withNextIntl()` à la main.                                  |
| Une string n'est pas détectée   | Vérifiez qu'elle n'est pas filtrée (technique/CSS) ni déjà dans un `t()`.                                       |
| Une string est « à revoir »     | Voir [Strings « à revoir »](#strings--à-revoir-).                                                               |
| Fichier « non parsable »        | Syntaxe invalide : le fichier est ignoré sans modification et signalé par `check`.                              |
| `Configuration invalide`        | Corrigez les points listés dans le message (tous sont rapportés d'un coup).                                     |
| `Catalogue illisible`           | Un `messages/*.json` existant n'est pas du JSON à plat. Corrigez ou supprimez-le : l'outil refuse de l'écraser. |
| Scan qui ne trouve aucun texte  | Votre code n'est pas sous un dossier scanné par défaut : renseignez `rootDirs`.                                 |

---

MIT — [Steven KOULO](https://github.com/stvekoulo)
