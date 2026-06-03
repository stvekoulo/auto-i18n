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
- [Configuration](#configuration)
- [Comment ça marche](#comment-ça-marche)
- [Types de strings détectées](#types-de-strings-détectées)
- [Filtrage (ce qui est ignoré)](#filtrage-ce-qui-est-ignoré)
- [Strings « à revoir »](#strings--à-revoir-)
- [Le guide d'intégration](#le-guide-dintégration)
- [Infrastructure next-intl générée](#infrastructure-next-intl-générée)
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
3. **Traduire** les langues cibles via DeepL.
4. **Installer** l'infra `next-intl` manquante (fichiers additifs).
5. **Expliquer** : produire un guide qui dit où et comment câbler chaque `t()`.

Votre code applicatif n'est jamais modifié. Le seul fichier existant éventuellement touché est `next.config.*` (enrobage `withNextIntl`, avec backup `.backup`), et seulement si sa structure est reconnue.

## Prérequis

- Node.js `>= 18`
- Next.js App Router (`app/` ou `src/app/`)
- `next-intl`
- Une clé API DeepL (Free ou Pro)

## Installation

```bash
npm install -D next-auto-i18n next-intl
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
next-auto-i18n init [--source <locale>] [--locale <l1,l2>] [--guide <path>]
```

| Option | Effet |
|---|---|
| `--source <locale>` | Langue source (sinon demandée) |
| `--locale <l1,l2>` | Langues cibles (sinon demandées) |
| `--guide <path>` | Chemin du guide (défaut `i18n-guide.md`) |

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

## Configuration

`auto-i18n.config.json` à la racine. Seuls `sourceLocale` et `targetLocales` sont requis ; les autres champs ont des défauts.

```json
{
  "sourceLocale": "fr",
  "targetLocales": ["en", "es"],
  "provider": "deepl",
  "apiKeyEnv": "AUTO_I18N_DEEPL_KEY",
  "messagesDir": "./messages",
  "ignore": ["node_modules", ".next", "**/*.test.*", "**/*.spec.*"]
}
```

| Champ | Défaut | Rôle |
|---|---|---|
| `sourceLocale` | — | Langue source (requis) |
| `targetLocales` | — | Langues cibles (requis) |
| `provider` | `deepl` | Provider de traduction |
| `apiKeyEnv` | `AUTO_I18N_DEEPL_KEY` | Variable d'env contenant la clé |
| `messagesDir` | `./messages` | Dossier des catalogues |
| `ignore` | voir ci-dessus | Patterns glob à exclure du scan |

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

## Types de strings détectées

| Type | Exemple | Câblage suggéré |
|---|---|---|
| Texte JSX | `<p>Bonjour</p>` | `{t("bonjour")}` |
| Attribut traduisible | `placeholder="Chercher"` | `{t("chercher")}` |
| Template literal | `` `Bienvenue` `` | `t("bienvenue")` |
| Template avec variables | `` `Salut ${name}` `` | `t("salut_name", { name })` |
| String literal | `const label = "Valider"` | `t("valider")` |

Attributs traduisibles : `placeholder`, `alt`, `title`, `aria-label`, `aria-placeholder`, `aria-description`, `aria-details`, `label`, `content`.

## Filtrage (ce qui est ignoré)

Des heuristiques écartent le bruit technique : nombres, valeurs CSS (`16px`), couleurs (`#fff`, `rgba(...)`), URLs et routes, types MIME, variables d'environnement (`API_BASE_URL`), classes CSS / tokens Tailwind (`flex items-center`), mots-clés techniques (`POST`, `flex`…), identifiants camelCase, emojis/symboles seuls. Une `blacklist` personnalisée peut être ajoutée via les options de filtrage.

## Strings « à revoir »

Deux cas ne sont pas marqués « sûrs à câbler automatiquement » :

- **`module_scope`** : string dans une `const` au niveau module (hors composant). `t()` n'y est pas accessible — il faut déplacer la valeur dans un composant/hook, ou la passer via une fonction recevant `t`.
- **`jsx_inline_spacing`** : texte JSX dont l'espacement (saut de ligne, voisins inline) est sensible et pourrait être altéré par un wrap naïf.

Ces strings sont quand même **détectées, cataloguées et traduites** ; elles sont simplement signalées dans le guide avec une note.

## Le guide d'intégration

Généré par `init` (et reposant sur les mêmes données que `sync`). Il contient :

- un résumé (nombre de strings, sûres vs à revoir) ;
- un rappel du câblage client (`useTranslations`) vs serveur (`await getTranslations`) ;
- **par fichier** : le runtime détecté, le hook à utiliser, et un tableau `| Ligne | Texte | Clé | Remplacement |` ;
- une note par fichier contenant des strings module-scope ;
- la procédure manuelle de mise en place de `app/[locale]/`.

## Infrastructure next-intl générée

`init` crée uniquement ce qui est **absent** :

| Cible | Fichier | Statut possible |
|---|---|---|
| Routing | `i18n/routing.ts` (ou `src/i18n/`) | créé / déjà présent |
| Request config | `i18n/request.ts` | créé / déjà présent |
| Middleware | `middleware.ts` (ou `proxy.ts` si Next ≥ 16) | créé / déjà présent |
| Plugin Next | `next.config.*` | enrobé (backup) / déjà présent / manuel |
| Switcher | `components/LanguageSwitcher.tsx` | créé / déjà présent |

`app/[locale]/` n'est **jamais** restructuré automatiquement : la marche à suivre est dans le guide.

## Traduction et providers

DeepL est le provider par défaut. Les placeholders `{var}` sont protégés par des balises XML ignorées par DeepL, puis restaurés ; toute traduction qui perdrait un placeholder fait échouer proprement la locale concernée (sans écraser le fichier existant). Les erreurs réseau / 429 / 5xx sont réessayées (3 tentatives) ; 403 / quota échouent immédiatement.

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
  core/        pur, zéro I/O — extraction, filters, keys, catalog, scan, check, guide
  adapters/    I/O — fs, project (détection), scaffold, translation (provider + deepl)
  pipeline/    orchestration — scan, sync, translate
  commands/    init, sync, check
  reporting/   rendu terminal + JSON
  config/      chargement/validation de la config
  cli/         entrée commander + prompts
  utils/       logger, env
```

Le `core` n'importe aucun module d'I/O et se teste sans système de fichiers ni réseau. Les pipelines combinent core + adapters ; les commandes ajoutent le chargement de config/env et le rendu.

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| `Configuration introuvable` | Lancez `init` d'abord. |
| `Clé API introuvable` | Renseignez `AUTO_I18N_DEEPL_KEY` dans `.env.local`. |
| `next.config — action manuelle` | Structure non reconnue : enrobez votre export avec `withNextIntl()` à la main. |
| Une string n'est pas détectée | Vérifiez qu'elle n'est pas filtrée (technique/CSS) ni déjà dans un `t()`. |
| Une string est « à revoir » | Voir [Strings « à revoir »](#strings--à-revoir-). |
| Fichier « non parsable » | Syntaxe invalide ou non supportée : le fichier est ignoré sans modification. |

---

MIT — [Steven KOULO](https://github.com/stvekoulo)
