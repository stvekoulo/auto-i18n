# next-auto-i18n

> Automatise l'internationalisation d'un projet React / Next.js en une seule commande.

**next-auto-i18n** scanne votre code, extrait les strings traduisibles, les traduit via DeepL, et reconfigure votre projet pour utiliser [next-intl](https://next-intl-docs.vercel.app/) — sans intervention manuelle.

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
- Remplace les strings en dur par `t("cle")`
- Configure `layout.tsx`, `next.config`, `middleware.ts`, `i18n/routing.ts`

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

- `layout.tsx` : ajoute `NextIntlClientProvider` + `getMessages()`
- `next.config` : wrappe avec `createNextIntlPlugin`
- `middleware.ts` : cree avec le routing i18n
- `i18n/routing.ts` : definit les locales

## Securite

- La cle API n'est **jamais** dans le code source
- `.env.local` et `*.backup` sont ajoutes au `.gitignore`
- Mode `--dry-run` pour verifier avant modification
- Backups automatiques (`*.backup`) avant chaque reecriture

## Developpement

```bash
git clone https://github.com/stevenkoulo/next-auto-i18n.git
cd next-auto-i18n
npm install
npm test        # vitest
npm run build   # tsc
npm run dev -- init  # test local
```

## Licence

MIT
