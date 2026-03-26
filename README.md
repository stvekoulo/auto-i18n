# next-auto-i18n

![npm version](https://img.shields.io/npm/v/next-auto-i18n)
![npm downloads](https://img.shields.io/npm/dm/next-auto-i18n)
![license](https://img.shields.io/npm/l/next-auto-i18n)

> Automatise l'internationalisation d'un projet React / Next.js en une seule commande.

**next-auto-i18n** scanne votre code, extrait les strings traduisibles, les traduit via DeepL, et reconfigure votre projet pour utiliser [next-intl](https://next-intl-docs.vercel.app/) — sans intervention manuelle.

**[Documentation complete](./DOCUMENTATION.md)**

## Installation

```bash
npm install -D next-auto-i18n
```

Ou directement via npx :

```bash
npx next-auto-i18n init
```

## Pre-requis

- Node.js >= 18
- Un projet Next.js (App Router)
- Une cle API DeepL ([inscription gratuite](https://www.deepl.com/pro-api))

## Utilisation rapide

```bash
npx next-auto-i18n init
```

Le CLI vous guide interactivement :

1. Langue source (ex: `fr`)
2. Langues cibles (ex: `en, es, de`)
3. Cle API DeepL

Et en quelques secondes :

- Scanne tous vos composants via AST
- Genere `messages/fr.json` avec les cles i18n
- Traduit automatiquement vers chaque langue cible
- Installe `next-intl` automatiquement si absent
- Remplace les strings en dur par `t("cle")`
- Configure `next.config`, `middleware.ts` (ou `proxy.ts` sur Next.js 16+)
- Genere `i18n/routing.ts` + `i18n/request.ts` (requis pour les Server Components)
- Cree la structure `app/[locale]/` requise par le App Router next-intl
- Injecte un **Language Switcher flottant** (personnalisable) pour changer de langue

## Commandes

### `next-auto-i18n init`

Initialisation complete du projet.

```bash
next-auto-i18n init              # mode interactif
next-auto-i18n init --dry-run    # preview sans modification
next-auto-i18n init --locale en,es,de  # langues cibles en ligne de commande
```

### `next-auto-i18n sync`

Rescanne le projet et traduit les nouvelles strings (mode incrementiel).

```bash
next-auto-i18n sync
```

### `next-auto-i18n add-locale <locale>`

Ajoute une nouvelle langue et traduit toutes les cles existantes.

```bash
next-auto-i18n add-locale ar
```

### `next-auto-i18n missing`

Affiche les cles non traduites par langue.

```bash
next-auto-i18n missing
```

## Configuration

Le fichier `auto-i18n.config.json` est genere automatiquement :

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

La cle API est stockee dans `.env.local` (jamais commitee) :

```bash
AUTO_I18N_DEEPL_KEY=votre-cle-ici
```

## Fonctionnement

### 1. Scan AST

Analyse les fichiers `.tsx`, `.jsx`, `.ts`, `.js` via [ts-morph](https://ts-morph.com/) :

- Texte JSX : `<p>Bonjour</p>`
- Attributs : `placeholder="Rechercher..."`
- Template literals : `` `Bienvenue ${name}` ``

Ignore automatiquement les classNames, imports, strings techniques, fichiers de config.

### 2. Generation des cles

Chaque string devient une cle i18n normalisee :

| String | Cle |
|--------|-----|
| `Bonjour` | `bonjour` |
| `Ajouter au panier` | `ajouter_au_panier` |
| `` `Bienvenue ${name}` `` | `bienvenue_name` |

### 3. Traduction DeepL

- Appel batch avec protection des placeholders (`{name}` -> `<x>name</x>`)
- Mode incrementiel : seules les cles manquantes sont traduites
- Compatible DeepL Free (500k chars/mois) et Pro

### 4. Reecriture des composants

| Avant | Apres |
|-------|-------|
| `<p>Bonjour</p>` | `<p>{t("bonjour")}</p>` |
| `placeholder="Chercher"` | `placeholder={t("chercher")}` |
| `` `Salut ${name}` `` | `t("salut_name", { name })` |

- Server Components : `await getTranslations()` (next-intl/server)
- Client Components : `useTranslations()` (next-intl)

### 5. Injection config Next.js

- `next.config` : wrappe avec `createNextIntlPlugin`
- `middleware.ts` / `proxy.ts` : routing i18n (proxy.ts si Next.js >= 16)
- `i18n/routing.ts` : definit les locales
- `i18n/request.ts` : configuration `getRequestConfig` pour les Server Components
- `app/[locale]/layout.tsx` : cree avec `NextIntlClientProvider` + `LanguageSwitcher`
- `app/[locale]/page.tsx` : la page existante est deplacee ici
- `app/layout.tsx` : simplifie en HTML shell (`<html><body>{children}</body></html>`)

### 6. Language Switcher

Un composant flottant est automatiquement genere dans `components/LanguageSwitcher.tsx` et inclus dans `app/[locale]/layout.tsx` (dans le provider). Personnalisable via `SWITCHER_CONFIG` : position, theme (light/dark), couleur d'accent, offset.

## Securite

- La cle API n'est **jamais** dans le code source
- `.env.local` et `*.backup` sont ajoutes au `.gitignore`
- Mode `--dry-run` pour verifier avant modification
- Backups automatiques (`*.backup`) avant chaque reecriture

## Developpement

```bash
git clone https://github.com/stvekoulo/next-auto-i18n.git
cd next-auto-i18n
npm install
npm test        # vitest
npm run build   # tsc
npm run dev -- init  # test local
```

## Licence

MIT
