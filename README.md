# next-auto-i18n

![npm version](https://img.shields.io/npm/v/next-auto-i18n)
![npm downloads](https://img.shields.io/npm/dm/next-auto-i18n)
![license](https://img.shields.io/npm/l/next-auto-i18n)

> CLI d'internationalisation pour Next.js App Router (et, en scaffold basique, React/Vite) : détecte les textes, génère les clés, traduit (DeepL ou Google Translate) et installe l'infrastructure i18n — **sans jamais réécrire votre code applicatif par défaut**.

`next-auto-i18n` scanne votre projet, extrait les chaînes traduisibles, génère des clés stables, remplit et traduit les catalogues `messages/*.json`, et met en place l'infrastructure i18n (fichiers additifs — `next-intl` sur Next.js, `react-i18next` sinon). Plutôt que de muter votre JSX par défaut — source de la plupart des erreurs — il produit un **guide d'intégration précis** qui vous dit, fichier par fichier et ligne par ligne, comment câbler chaque `t()`. Pour les cas non ambigus (composant client, ou composant serveur déjà `async`), `sync --write` peut aussi câbler ces `t()` à votre place, en toute sécurité.

> **Vous venez de la 1.x ou de la 0.x ?** La `2.0` change le nommage des variables d'interpolation, exige Node 22.12 et refuse une configuration invalide. Voir le [guide de migration](./MIGRATION.md).

## Philosophie

- **Zéro mutation du code source par défaut.** L'outil ne touche pas à vos composants tant que vous ne le demandez pas explicitement. Il détecte, catalogue, traduit, et explique.
- **Câblage automatique opt-in, jamais aveugle.** `sync --write` ne câble que les cas prouvables sans ambiguïté (voir [Câblage automatique](#câblage-automatique-sync---write)) ; tout le reste va dans le guide.
- **Fichiers additifs uniquement.** L'infra `next-intl` n'est créée que si elle est absente ; rien n'est écrasé.
- **Déterministe et idempotent.** Mêmes entrées → mêmes clés. Les exécutions répétées sont sûres.
- **Optimisé sur mesure, pas au jugé.** Le scan bascule sur un pool de workers au-delà de 3 500 fichiers, seuil issu du banc d'essai ; en dessous, le thread principal reste plus rapide et le pool ne démarre pas.
- **Conservateur sur l'ambigu.** Les strings hors composant ou au JSX sensible sont signalées « à revoir », pas forcées.

## Installation

```bash
# Next.js App Router
npm install -D next-auto-i18n
npm install next-intl

# React / Vite (sans Next.js)
npm install -D next-auto-i18n
npm install i18next react-i18next
```

## Prérequis

- Node.js `>= 22.12`
- Un projet Next.js App Router (`next-intl`) **ou** un projet React/Vite (`react-i18next`)
- Une clé API DeepL ([gratuite ici](https://www.deepl.com/pro-api)) ou Google Translate ([voir la doc](https://cloud.google.com/translate/docs/setup))

## Démarrage rapide

```bash
npx next-auto-i18n init
```

`init` vous demande la langue source, les langues cibles, le provider de traduction (DeepL ou Google Translate) et la clé API correspondante, puis :

1. crée `auto-i18n.config.json` et stocke la clé dans `.env.local`
2. installe l'infra i18n manquante — sur Next.js : `i18n/routing.ts`, `i18n/request.ts`, middleware, plugin `next.config`, `LanguageSwitcher` ; sinon (React/Vite) : `src/i18n.ts`, import ajouté au point d'entrée, `LanguageSwitcher` (voir [Projets React/Vite](#projets-reactvite-hors-nextjs))
3. remplit `messages/<source>.json` et traduit les langues cibles
4. génère `i18n-guide.md` — la marche à suivre pour câbler vos `t()`

## Commandes

### `init`

Mise en place complète (une fois).

```bash
next-auto-i18n init
next-auto-i18n init --source fr --locale en,es,de
next-auto-i18n init --provider google
next-auto-i18n init --guide docs/i18n.md
```

### `sync`

La commande du quotidien : rescanne, met à jour le catalogue source (merge stable) et traduit uniquement le manquant.

```bash
next-auto-i18n sync
```

#### Câblage automatique (`sync --write`)

```bash
next-auto-i18n sync --write --dry-run   # aperçu (diff), n'écrit rien
next-auto-i18n sync --write             # câble pour de vrai (avec .backup)
```

`--write` câble mécaniquement les strings `safe` en `t()`, mais seulement quand c'est prouvable sans ambiguïté :

- **composant client** (`'use client'`) → toujours éligible (`useTranslations()`) ;
- **composant serveur** → seulement s'il est **déjà `async`** (jamais de conversion sync → async, trop risqué pour les types) ;
- il faut une **fonction hôte identifiable** (nom en PascalCase, hook `useXxx`, ou export par défaut) ;
- si un `t` existe déjà dans le scope sans venir de `useTranslations`/`getTranslations`, le fichier est laissé de côté (collision).

Tout ce qui ne remplit pas ces conditions (scope module, fonction hôte ambiguë, composant serveur non-async, corps de fonction concis) reste dans le guide, à câbler à la main.

### `check`

Diagnostic **read-only**, pensé pour la CI. Code de sortie ≠ 0 si du travail est en attente (strings non cataloguées ou traductions manquantes).

```bash
next-auto-i18n check
next-auto-i18n check --json
```

## Configuration

`auto-i18n.config.json` (seuls `sourceLocale` et `targetLocales` sont requis) :

```json
{
  "$schema": "https://raw.githubusercontent.com/stvekoulo/next-auto-i18n/main/schema/auto-i18n.config.schema.json",
  "sourceLocale": "fr",
  "targetLocales": ["en", "es"],
  "provider": "deepl",
  "apiKeyEnv": "AUTO_I18N_DEEPL_KEY",
  "messagesDir": "./messages",
  "ignore": ["node_modules", ".next", "**/*.test.*", "**/*.spec.*"],
  "rootDirs": ["app", "src", "components"]
}
```

`provider` accepte `"deepl"` ou `"google"` (Google Translate).

`rootDirs` liste les dossiers de premier niveau à scanner. Sans ce champ, la liste par défaut est utilisée (`app`, `src`, `pages`, `components`, `lib`, `hooks`, `utils`, `ui`, `features`, `shared`) : **renseignez-le si votre code applicatif vit ailleurs**, sinon le scan ne trouvera rien.

La configuration est validée au chargement — champ inconnu, code de langue invalide, langue à la fois source et cible, provider inconnu, `messagesDir` sortant du projet : tous les problèmes sont listés d'un coup et la commande s'arrête.

Le champ `$schema` (ajouté automatiquement par `init`) active l'**autocomplétion, la validation et les infobulles dans VSCode** lorsque vous éditez la config.

## Usage programmatique

L'API est aussi utilisable depuis un script (l'import n'exécute pas le CLI) :

```ts
import { runCheck, runSync } from 'next-auto-i18n';

const { report } = await runCheck({ projectRoot: process.cwd() });
console.log(report.totalMissing, 'traductions manquantes');
```

La clé API vit dans `.env.local` :

```bash
AUTO_I18N_DEEPL_KEY=votre-cle
```

## Ce que fait le guide

Pour chaque fichier, le guide indique le runtime (`client`/`server`), le hook à utiliser (`useTranslations` ou `await getTranslations`), et un tableau : ligne, texte détecté, clé générée, remplacement suggéré. Les strings hors composant (niveau module) sont signalées séparément, tout comme les **candidats pluriels probables** (variable de type compteur), avec une suggestion de syntaxe ICU MessageFormat. La mise en place manuelle de `app/[locale]/` est aussi documentée.

> Le guide suppose `next-intl`. Sur un projet React/Vite, adaptez ses suggestions à `react-i18next` : `const { t } = useTranslation();` remplace `useTranslations()`/`getTranslations()`. `sync --write` est désactivé sur ces projets (voir la section suivante).

## Projets React/Vite (hors Next.js)

Si `next-auto-i18n` ne trouve pas de `app/layout.tsx`, il considère le projet comme du React/Vite « nu » et scaffold `react-i18next` à la place de `next-intl` :

- **`src/i18n.ts`** — initialise `i18next` avec `initReactI18next`, en chargeant directement les catalogues `messages/<locale>.json` déjà remplis par `sync` (pas de chargement HTTP paresseux, un `import` par locale).
- **Point d'entrée** — un `import './i18n';` est ajouté en première ligne de `src/main.tsx` (ou `src/index.tsx`), avec une sauvegarde `.backup`. Si aucun point d'entrée reconnu n'existe, l'action passe en `manual`.
- **`LanguageSwitcher`** — même composant que côté Next.js dans l'esprit, mais basé sur `i18n.changeLanguage(locale)` plutôt que sur le routing.

Catalogues, traduction, détection de pluriels et `check` fonctionnent à l'identique des deux côtés (c'est le même `core`). Ce qui **ne l'est pas encore** : le guide d'intégration reste écrit pour next-intl — sur React/Vite, câblez `t()` à la main en suivant le tableau du guide (ligne, texte, clé) mais avec `const { t } = useTranslation();`. `sync --write` est **désactivé** sur ces projets (le codemod injecte des imports `next-intl`, ce qui casserait un projet qui ne l'a pas).

## Architecture

```
src/
  core/        logique pure (extraction, filtres, clés, catalogue, check, guide, write) — zéro I/O
  adapters/    I/O : fs, détection projet, scaffold, providers de traduction (DeepL, Google)
  pipeline/    orchestration (scan, sync, translate, write) combinant core + adapters
  commands/    init / sync / check
  reporting/   rendu terminal + JSON
  cli/         entrée commander
```

Le core est testable sans système de fichiers ni réseau ; le provider de traduction est abstrait (DeepL, Google Translate, extensible).

## Développement

```bash
git clone https://github.com/stvekoulo/next-auto-i18n.git
cd next-auto-i18n
npm install
npm run build
npm test
```

## Licence

MIT — [Steven KOULO](https://github.com/stvekoulo)
