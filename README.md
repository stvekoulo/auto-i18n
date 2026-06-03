# next-auto-i18n

![npm version](https://img.shields.io/npm/v/next-auto-i18n)
![npm downloads](https://img.shields.io/npm/dm/next-auto-i18n)
![license](https://img.shields.io/npm/l/next-auto-i18n)

> CLI d'internationalisation pour Next.js App Router : détecte les textes, génère les clés, traduit via DeepL et installe l'infrastructure `next-intl` — **sans jamais réécrire votre code applicatif**.

`next-auto-i18n` scanne votre projet, extrait les chaînes traduisibles, génère des clés stables, remplit et traduit les catalogues `messages/*.json`, et met en place l'infrastructure `next-intl` (fichiers additifs). Plutôt que de muter votre JSX — source de la plupart des erreurs — il produit un **guide d'intégration précis** qui vous dit, fichier par fichier et ligne par ligne, comment câbler chaque `t()`.

> **Vous venez de la 0.x ?** Cette `1.0` est une refonte majeure (le code source n'est plus réécrit). Voir le [guide de migration](./MIGRATION.md).

## Philosophie

- **Zéro mutation du code source.** L'outil ne touche pas à vos composants. Il détecte, catalogue, traduit, et explique.
- **Fichiers additifs uniquement.** L'infra `next-intl` n'est créée que si elle est absente ; rien n'est écrasé.
- **Déterministe et idempotent.** Mêmes entrées → mêmes clés. Les exécutions répétées sont sûres.
- **Conservateur sur l'ambigu.** Les strings hors composant ou au JSX sensible sont signalées « à revoir », pas forcées.

## Installation

```bash
npm install -D next-auto-i18n next-intl
```

## Prérequis

- Node.js `>= 18`
- Un projet Next.js avec App Router
- `next-intl`
- Une clé API DeepL ([gratuite ici](https://www.deepl.com/pro-api))

## Démarrage rapide

```bash
npx next-auto-i18n init
```

`init` vous demande la langue source, les langues cibles et la clé DeepL, puis :

1. crée `auto-i18n.config.json` et stocke la clé dans `.env.local`
2. installe l'infra `next-intl` manquante (`i18n/routing.ts`, `i18n/request.ts`, middleware, plugin `next.config`, `LanguageSwitcher`)
3. remplit `messages/<source>.json` et traduit les langues cibles
4. génère `i18n-guide.md` — la marche à suivre pour câbler vos `t()`

## Commandes

### `init`

Mise en place complète (une fois).

```bash
next-auto-i18n init
next-auto-i18n init --source fr --locale en,es,de
next-auto-i18n init --guide docs/i18n.md
```

### `sync`

La commande du quotidien : rescanne, met à jour le catalogue source (merge stable) et traduit uniquement le manquant.

```bash
next-auto-i18n sync
```

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
  "$schema": "./node_modules/next-auto-i18n/schema/auto-i18n.config.schema.json",
  "sourceLocale": "fr",
  "targetLocales": ["en", "es"],
  "provider": "deepl",
  "apiKeyEnv": "AUTO_I18N_DEEPL_KEY",
  "messagesDir": "./messages",
  "ignore": ["node_modules", ".next", "**/*.test.*", "**/*.spec.*"]
}
```

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

Pour chaque fichier, le guide indique le runtime (`client`/`server`), le hook à utiliser (`useTranslations` ou `await getTranslations`), et un tableau : ligne, texte détecté, clé générée, remplacement suggéré. Les strings hors composant (niveau module) sont signalées séparément, ainsi que la mise en place manuelle de `app/[locale]/`.

## Architecture

```
src/
  core/        logique pure (extraction, filtres, clés, catalogue, check, guide) — zéro I/O
  adapters/    I/O : fs, détection projet, scaffold, providers de traduction
  pipeline/    orchestration (scan, sync, translate) combinant core + adapters
  commands/    init / sync / check
  reporting/   rendu terminal + JSON
  cli/         entrée commander
```

Le core est testable sans système de fichiers ni réseau ; le provider de traduction est abstrait (DeepL aujourd'hui, extensible).

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
