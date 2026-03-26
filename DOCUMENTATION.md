<p align="center">
  <h1 align="center">next-auto-i18n</h1>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/next-auto-i18n"><img src="https://img.shields.io/npm/v/next-auto-i18n" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/next-auto-i18n"><img src="https://img.shields.io/npm/dm/next-auto-i18n" alt="npm downloads"></a>
  <a href="https://github.com/stvekoulo/next-auto-i18n/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/next-auto-i18n" alt="license"></a>
</p>

<p align="center"><strong>Translate your Next.js project automatically in under 5 minutes.</strong></p>

next-auto-i18n is a CLI tool that fully automates internationalization (i18n) in existing Next.js projects. It scans your codebase via AST, extracts translatable strings, translates them through DeepL, rewrites your components to use `t("key")` calls, and configures [next-intl](https://next-intl-docs.vercel.app/) — all in a single command.

---

## Table of Contents

- [Why next-auto-i18n?](#why-next-auto-i18n)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Commands](#commands)
- [How It Works](#how-it-works)
- [Supported String Types](#supported-string-types)
- [Safety & Backups](#safety--backups)
- [DeepL API](#deepl-api)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why next-auto-i18n?

### Manual setup vs next-auto-i18n

| | Manual i18n setup | next-auto-i18n |
|---|---|---|
| **Time** | 4-8 hours (medium project) | < 5 minutes |
| **Steps** | 6+ manual steps across dozens of files | 1 command |
| **Human error** | Missed strings, typos in keys, broken config | Zero — AST-powered, deterministic |
| **Translations** | Copy-paste into Google Translate | Automated via DeepL API |
| **Maintenance** | Re-scan manually after every change | `next-auto-i18n sync` |

- **Zero manual work** — from raw project to fully translated site in one command
- **AST-powered scanning** — finds every translatable string, including dynamic template literals
- **Incremental by design** — `sync` only translates what changed, preserving existing translations
- **Safe** — automatic backups, `--dry-run` mode, and `.gitignore` management

---

## Prerequisites

- **Node.js >= 18**
- **A Next.js project** using the App Router (`app/` directory)
- **A DeepL API key** — [sign up for free](https://www.deepl.com/pro-api) (500,000 characters/month at no cost)

---

## Installation

```bash
# Run directly without installing (recommended)
npx next-auto-i18n init

# Or install globally
npm install -g next-auto-i18n
next-auto-i18n init

# Or as a dev dependency
npm install -D next-auto-i18n
npx next-auto-i18n init
```

---

## Quick Start

### 1. Run the init command

```bash
npx next-auto-i18n init
```

### 2. Answer the prompts

```
▸ Configuration
? Source locale (ISO code): fr
? Target locales (comma-separated): en, es
? DeepL API key: ********
  ✓ API key saved to .env.local
  ✓ .gitignore updated (.env.local, *.backup)
  ✓ auto-i18n.config.json created
```

### 3. Watch it work

```
▸ Scanning project
  ✓ 47 strings found

▸ Generating keys
  ✓ 42 keys generated → ./messages/fr.json

▸ Translating via DeepL
  ✓ Translation EN (42 strings)
  ✓ Translation ES (42 strings)
  ✓ 84 strings translated

▸ Checking dependencies
  ✓ next-intl installed

▸ Rewriting components
  ✓ 47 replacements in 12 files

▸ Checking dependencies
  ✓ next-intl installed

▸ Rewriting components
  ✓ 47 replacements in 12 files

▸ Configuring Next.js
  ✓ next.config configured
  ✓ middleware.ts created
  ✓ i18n/routing.ts created
  ✓ i18n/request.ts created
  ✓ LanguageSwitcher created
  ✓ app/[locale]/ structured

  ✓ Internationalization configured successfully!
  Languages: fr → en, es
  Backups available in *.backup
```

### 4. Start your app

```bash
npm run dev
```

Your site now supports `fr`, `en`, and `es`. A **floating language switcher** appears at the bottom-right corner, allowing users to switch languages instantly. Visit `/en` or `/es` to see the translations.

---

## Configuration

### auto-i18n.config.json

Generated automatically by `next-auto-i18n init`. This file is safe to commit.

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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sourceLocale` | `string` | — | ISO code of your source language (e.g. `"fr"`) |
| `targetLocales` | `string[]` | — | List of target language codes (e.g. `["en", "es"]`) |
| `provider` | `string` | `"deepl"` | Translation provider |
| `apiKeyEnv` | `string` | `"AUTO_I18N_DEEPL_KEY"` | Name of the environment variable holding the API key |
| `messagesDir` | `string` | `"./messages"` | Directory where JSON translation files are stored |
| `ignore` | `string[]` | `["node_modules", ".next", "**/*.test.*", "**/*.spec.*"]` | Glob patterns of files/directories to skip |

### .env.local

The DeepL API key is stored in `.env.local` and **never** in the config file.

```bash
# .env.local (auto-generated, never committed)
AUTO_I18N_DEEPL_KEY=your-deepl-api-key-here
```

next-auto-i18n automatically adds `.env.local` and `*.backup` to your `.gitignore`.

---

## Commands

### `next-auto-i18n init`

Full project initialization: scan, translate, rewrite, and configure.

```bash
next-auto-i18n init                      # Interactive mode
next-auto-i18n init --dry-run            # Preview changes, ask before applying
next-auto-i18n init --locale en,es,de    # Skip locale prompt
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Scans and generates keys, then shows a summary and asks for confirmation before translating, rewriting, or modifying config files |
| `--locale <locales>` | Comma-separated target locales, skips the interactive prompt |

**Example output with `--dry-run`:**

```
▸ Scanning project
  ✓ 47 strings found

▸ Generating keys
  ✓ 42 keys generated → ./messages/fr.json

  Strings found:      47
  Keys generated:     42
  Files to rewrite:   12
  Target locales:     en, es

? Apply these changes? (Y/n)
```

---

### `next-auto-i18n sync`

Re-scans the project and translates only new or modified strings. Existing translations are preserved.

```bash
next-auto-i18n sync
```

**Example output:**

```
▸ Scanning project
  ✓ 53 strings found

▸ Updating keys
  ✓ 48 keys → ./messages/fr.json

▸ Incremental translation
  ✓ Translation EN (6 strings)
  ✓ Translation ES (6 strings)
  ✓ 12 new translations
```

Use `sync` after adding new components, changing text, or removing strings.

---

### `next-auto-i18n add-locale <locale>`

Adds a new target language and translates all existing keys into it.

```bash
next-auto-i18n add-locale ar
next-auto-i18n add-locale pt-BR
next-auto-i18n add-locale zh
```

**Example output:**

```
  ✓ ar added to auto-i18n.config.json

▸ Translating to AR
  ✓ Translation AR (42 strings)
  ✓ 42 strings translated
```

---

### `next-auto-i18n missing`

Reports untranslated keys per target locale.

```bash
next-auto-i18n missing
```

**Example output:**

```
  ✓ en — complete
  ⚠ es — 3 missing keys
    new_feature_title
    new_feature_description
    cta_button
  ✓ de — complete

  ℹ 3 missing keys total
  Run "next-auto-i18n sync" to translate them.
```

---

## How It Works

```
npx next-auto-i18n init
        │
        ▼
┌──────────────────────────────────────┐
│  1. Interactive Configuration        │
│     Source locale, targets, API key  │
│     → auto-i18n.config.json         │
│     → .env.local                    │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│  2. AST Scan                         │
│     Parses .tsx/.jsx/.ts/.js files   │
│     Extracts 3 types of strings:    │
│     • JSX text: <p>Hello</p>        │
│     • Attributes: placeholder="..." │
│     • Template literals: `Hello`    │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│  3. Key Generation                   │
│     messages/fr.json                 │
│     { "hello": "Bonjour",           │
│       "welcome_name": "Bienvenue {name}" }  │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│  4. DeepL Translation                │
│     messages/en.json                 │
│     messages/es.json                 │
│     Batched, placeholder-safe       │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│  5. Dependency Check                 │
│     Auto-installs next-intl if      │
│     missing (npm / yarn / pnpm)     │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│  6. Component Rewriting              │
│     <p>Bonjour</p>                   │
│     → <p>{t("hello")}</p>           │
│                                      │
│     + useTranslations / getTranslations  │
│     + import statements              │
└──────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────┐
│  7. Next.js Config Injection         │
│     • next.config → createNextIntlPlugin   │
│     • middleware.ts or proxy.ts            │
│     • i18n/routing.ts → locale list        │
│     • i18n/request.ts → Server Components  │
│     • LanguageSwitcher.tsx → widget        │
│     • app/[locale]/layout.tsx → provider   │
│     • app/[locale]/page.tsx (moved)        │
│     • app/layout.tsx → HTML shell          │
└──────────────────────────────────────┘
        │
        ▼
   ✓ i18n-ready site with language switcher
```

### Generated Project Structure

After running `next-auto-i18n init`, your project will have this structure:

```
your-project/
├── app/
│   ├── layout.tsx              ← Simplified to HTML shell (<html><body>{children}</body></html>)
│   ├── globals.css             ← Untouched
│   └── [locale]/
│       ├── layout.tsx          ← NEW — NextIntlClientProvider + LanguageSwitcher
│       └── page.tsx            ← Moved from app/page.tsx
│
├── components/
│   └── LanguageSwitcher.tsx    ← NEW — floating language switcher widget
│
├── i18n/
│   ├── routing.ts              ← NEW — locale definitions
│   └── request.ts              ← NEW — Server Component config (getRequestConfig)
│
├── messages/
│   ├── fr.json                 ← NEW — source language keys
│   ├── en.json                 ← NEW — translated
│   └── es.json                 ← NEW — translated
│
├── middleware.ts               ← NEW — i18n routing (proxy.ts on Next.js >= 16)
├── next.config.ts              ← Modified — wrapped with createNextIntlPlugin
└── auto-i18n.config.json       ← NEW — tool configuration
```

All modified files have a `.backup` copy created automatically before any change.

---

### AST Scanning

The scanner uses [ts-morph](https://ts-morph.com/) to parse TypeScript/JSX via AST (Abstract Syntax Tree). This means it understands your code structure, not just raw text.

**What gets detected:**

- JSX text content: `<h1>Welcome</h1>`
- Translatable HTML attributes: `placeholder`, `alt`, `title`, `aria-label`, `aria-placeholder`, `aria-description`, `aria-details`, `label`, `content`
- Static template literals: `` `Hello world` ``
- Dynamic template literals: `` `Hello ${name}` `` (converted to `t("key", { name })`)

**What gets ignored automatically:**

- Technical strings: CSS classes, hex colors, URLs, routes, MIME types, env vars
- Technical attributes: `className`, `id`, `type`, `href`, `src`, `key`, `style`, etc.
- Technical keywords: CSS values (`flex`, `grid`, `bold`...), HTTP methods, HTML input types, boolean values, encoding names
- Short/numeric strings: empty strings, pure numbers, single characters
- Config files: `next.config.*`, `tailwind.config.*`, `vite.config.*`, etc.
- Test files: `*.test.*`, `*.spec.*`
- Directories: `node_modules`, `.next`, `.git`, `dist`, `build`, `out`, `coverage`, `public`

### API Key Security

- The DeepL API key is **never** stored in config files or source code
- It lives exclusively in `.env.local`, which is automatically added to `.gitignore`
- The config file only stores the **name** of the environment variable (`AUTO_I18N_DEEPL_KEY`), not the value

---

## Supported String Types

### JSX Text

```tsx
// Before
<h1>Bienvenue sur notre site</h1>
<p>Découvrez nos produits</p>

// After
<h1>{t("bienvenue_sur_notre_site")}</h1>
<p>{t("decouvrez_nos_produits")}</p>
```

### HTML Attributes

```tsx
// Before
<input placeholder="Rechercher un produit" />
<img alt="Photo de profil" />
<button title="Fermer la fenêtre">X</button>
<div aria-label="Menu principal">...</div>

// After
<input placeholder={t("rechercher_un_produit")} />
<img alt={t("photo_de_profil")} />
<button title={t("fermer_la_fenetre")}>X</button>
<div aria-label={t("menu_principal")}>...</div>
```

**Supported attributes:** `placeholder`, `alt`, `title`, `aria-label`, `aria-placeholder`, `aria-description`, `aria-details`, `label`, `content`

### Static Template Literals

```tsx
// Before
const greeting = `Bonjour le monde`;

// After
const greeting = t("bonjour_le_monde");
```

### Dynamic Template Literals

```tsx
// Before
const message = `Bienvenue ${userName}, vous avez ${count} messages`;

// After
const message = t("bienvenue_username_vous_avez_count", { userName, count });
```

The corresponding JSON entry uses ICU-style placeholders:

```json
{
  "bienvenue_username_vous_avez_count": "Bienvenue {userName}, vous avez {count} messages"
}
```

### Language Switcher

next-auto-i18n automatically generates a floating language switcher widget and injects it into your layout. Users can change the language directly from the browser — no extra setup needed.

**Features:**
- Floating pill button at the bottom-right corner with the current locale flag and name
- Animated dropdown listing all configured locales with flags and native names
- Active language highlighted with a checkmark
- Click outside to close
- Hover effects and smooth animations
- Works with both `app/` and `src/app/` project structures

**Customization:**

The generated `components/LanguageSwitcher.tsx` file contains a `SWITCHER_CONFIG` block at the top that you can modify:

```tsx
const SWITCHER_CONFIG = {
  /** Position: 'bottom-right' | 'bottom-left' */
  position: 'bottom-right',
  /** Theme: 'light' | 'dark' */
  theme: 'light',
  /** Accent color for the active locale highlight */
  accentColor: '#2563eb',
  /** Offset from screen edges in pixels */
  offset: 24,
  /** Border radius of the dropdown in pixels */
  borderRadius: 12,
};
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Corner of the screen where the widget appears |
| `theme` | `'light' \| 'dark'` | `'light'` | Color scheme of the widget |
| `accentColor` | `string` | `'#2563eb'` | Color used for the active locale highlight |
| `offset` | `number` | `24` | Distance from screen edges in pixels |
| `borderRadius` | `number` | `12` | Border radius of the dropdown popup |

> **Note:** The "Made by Steven Koulo" attribution is required by the license and must not be removed.

---

### Server Components vs Client Components

next-auto-i18n automatically detects whether a file is a Server Component or a Client Component:

**Server Components** (no `'use client'` directive):

```tsx
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const t = await getTranslations();
  return <h1>{t("hello")}</h1>;
}
```

**Client Components** (has `'use client'` directive):

```tsx
"use client";
import { useTranslations } from "next-intl";

export default function Button() {
  const t = useTranslations();
  return <button>{t("submit")}</button>;
}
```

---

## Safety & Backups

### `--dry-run` mode

Preview everything next-auto-i18n will do before it makes any changes:

```bash
next-auto-i18n init --dry-run
```

In dry-run mode, the tool:
1. Scans your project and extracts strings
2. Generates keys and shows a summary
3. Asks for your confirmation before proceeding
4. Only applies changes if you confirm

### Automatic backups

Before modifying any file, next-auto-i18n creates a `.backup` copy:

```
app/layout.tsx          → app/layout.tsx.backup
app/page.tsx            → app/page.tsx.backup
next.config.ts          → next.config.ts.backup
```

### Restoring from backup

To revert a single file:

```bash
cp app/page.tsx.backup app/page.tsx
```

To revert all changes:

```bash
# Restore all backup files
for f in $(find . -name "*.backup" -not -path "*/node_modules/*"); do
  cp "$f" "${f%.backup}"
done
```

To clean up backup files after you're satisfied:

```bash
find . -name "*.backup" -not -path "*/node_modules/*" -delete
```

### Idempotency

All operations are idempotent. Running `next-auto-i18n init` twice will not duplicate imports, providers, or configuration. The tool detects what's already in place and skips it.

---

## DeepL API

### Getting a free API key

1. Go to [deepl.com/pro-api](https://www.deepl.com/pro-api)
2. Sign up for a **DeepL API Free** account
3. Copy your API key from the account dashboard

### Free plan limits

| | DeepL API Free | DeepL API Pro |
|---|---|---|
| Characters/month | 500,000 | Unlimited (pay-per-use) |
| Cost | Free | $5.49/million characters |
| API endpoint | `api-free.deepl.com` | `api.deepl.com` |

500,000 characters is enough for most projects. A medium-sized Next.js app typically has 5,000-20,000 characters of translatable text.

next-auto-i18n automatically detects whether your key is Free (ends with `:fx`) or Pro and uses the correct endpoint.

### Storing the API key

The API key is stored in `.env.local` and loaded via `dotenv`:

```bash
# .env.local
AUTO_I18N_DEEPL_KEY=your-api-key-here
```

You can also set it as a system environment variable:

```bash
export AUTO_I18N_DEEPL_KEY=your-api-key-here
next-auto-i18n init
```

### Placeholder protection

Dynamic strings containing variables like `{name}` are protected during translation using XML tags. DeepL preserves XML tags in output, ensuring placeholders are never translated:

```
Input:  "Bienvenue <x>name</x>"
Output: "Welcome <x>name</x>"
→ Restored: "Welcome {name}"
```

---

## Troubleshooting

### "Invalid or unauthorized API key" (403)

Your DeepL API key is invalid or expired.

```
✗ DeepL API error (403): clé API invalide ou non autorisée
```

**Fix:** Verify your key at [deepl.com/your-account/keys](https://www.deepl.com/your-account/keys) and update `.env.local`:

```bash
# .env.local
AUTO_I18N_DEEPL_KEY=your-correct-key-here
```

---

### "Quota exceeded" (456)

You've used all 500,000 free characters for the current month.

```
✗ DeepL API error (456): quota de traduction dépassé
```

**Fix:** Wait for the monthly reset, upgrade to DeepL Pro, or reduce the scope by translating fewer locales at once.

---

### "No translatable strings found"

The scanner found no strings in your project.

```
⚠ No translatable string found — stopping
```

**Fix:** Make sure your components contain actual text (not just variables or technical strings). Check that your source files are in `app/` or `src/app/` and use `.tsx`, `.jsx`, `.ts`, or `.js` extensions.

---

### "layout.tsx not found"

The injector can't find your root layout file.

```
⚠ layout.tsx — layout.tsx introuvable
```

**Fix:** Ensure you have `app/layout.tsx` or `src/app/layout.tsx` in your project. next-auto-i18n checks both locations.

---

### "auto-i18n.config.json not found"

You're running `sync`, `add-locale`, or `missing` before `init`.

```
✗ ENOENT: no such file or directory, open 'auto-i18n.config.json'
```

**Fix:** Run `next-auto-i18n init` first to generate the config file.

---

### "Too many requests" (429)

DeepL rate limit reached.

```
✗ DeepL API error (429): trop de requêtes
```

**Fix:** Wait a few seconds and retry. next-auto-i18n sends translations in batches of 50 strings to minimize this, but it can still occur with very large projects. Simply re-run the command.

---

## Contributing

### Setup

```bash
git clone https://github.com/stvekoulo/next-auto-i18n.git
cd next-auto-i18n
npm install
```

### Development

```bash
# Run the CLI in dev mode (no build needed)
npm run dev -- init --dry-run

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npx vitest
```

### Project structure

```
next-auto-i18n/
├── src/
│   ├── cli/              # CLI entry point + interactive prompts
│   ├── scanner/          # AST parsing + string extraction + filtering
│   ├── generator/        # Key generation + JSON file creation
│   ├── translator/       # DeepL API client + translation orchestration
│   ├── rewriter/         # JSX/attribute rewriting via AST
│   ├── injector/         # Next.js config injection:
│   │   ├── config-injector.ts         # next.config wrapping
│   │   ├── middleware-injector.ts     # middleware.ts / proxy.ts
│   │   ├── routing-injector.ts        # i18n/routing.ts
│   │   ├── request-injector.ts        # i18n/request.ts
│   │   ├── switcher-injector.ts       # LanguageSwitcher component
│   │   ├── locale-structure-injector.ts  # app/[locale]/ structure
│   │   └── layout-injector.ts         # layout utilities
│   └── utils/            # Config, env, logger, dependency utilities
├── tests/                # Vitest test suites (298 tests)
└── DOCUMENTATION.md      # This file
```

### Running tests

```bash
npm test
```

The test suite covers all modules:

| Module | Tests |
|--------|-------|
| Scanner (filters) | 109 |
| Generator (key-builder) | 39 |
| Rewriter | 33 |
| Injector | 25 |
| Translator (DeepL) | 23 |
| Generator | 20 |
| Scanner (string-extractor) | 20 |
| CLI (config, env) | 18 |
| Translator (orchestration) | 11 |
| **Total** | **298** |

### Submitting changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write tests for your changes
4. Ensure all tests pass: `npm test`
5. Ensure the build succeeds: `npm run build`
6. Submit a Pull Request

---

## Roadmap

### v1.x — Enhancements

- [x] `next-auto-i18n sync` — rescan and incremental update
- [x] `next-auto-i18n missing` — report untranslated keys
- [x] Floating language switcher widget (auto-injected, customizable)
- [x] Automatic `next-intl` dependency installation
- [x] `app/[locale]/` structure auto-creation (required by next-intl App Router)
- [x] `i18n/request.ts` generation (required for Server Components)
- [x] Dynamic `<html lang>` attribute
- [x] Next.js 16 `proxy.ts` detection
- [x] Scan scope limited to Next.js conventional directories
- [ ] `--watch` mode — auto-sync on file changes
- [ ] Support for Vite + React (without Next.js)
- [ ] Custom key naming strategies

### v2.0 — Multi-provider support

- [ ] OpenAI (GPT-4) as translation provider
- [ ] Google Cloud Translation API
- [ ] Configurable provider via `auto-i18n.config.json`

### v3.0 — Ecosystem

- [ ] Web dashboard for team translation management
- [ ] CI/CD integration (GitHub Actions)
- [ ] Public API for programmatic access

---

## License

[MIT](./LICENSE) — Steven KOULO
