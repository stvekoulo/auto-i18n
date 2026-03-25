# auto-i18n — Spécifications du projet

> Package npm CLI pour React / Next.js — Traduction automatique d'un site web en moins de 5 minutes.

---

## Présentation du projet

**auto-i18n** est un outil en ligne de commande (CLI) qui automatise entièrement la mise en place de l'internationalisation (i18n) dans un projet React ou Next.js existant.

L'objectif est simple : un développeur installe le package, lance une commande, et son projet est entièrement traduit et configuré pour fonctionner en plusieurs langues — sans toucher manuellement à aucun fichier.

### Problème résolu

Aujourd'hui, mettre en place l'i18n dans un projet Next.js demande :
- Installer et configurer manuellement `next-intl` ou `i18next`
- Parcourir tous les fichiers pour trouver les strings en dur
- Créer les fichiers JSON de traduction à la main
- Remplacer chaque string par un appel `t("clé")`
- Modifier le `layout.tsx` et le `next.config.js`

Ce processus prend facilement **plusieurs heures** sur un projet moyen.

**auto-i18n réduit ça à moins de 5 minutes.**

---

## Objectif

```
npx auto-i18n init
```

Une seule commande qui :
1. Scanne tout le projet via AST
2. Détecte toutes les strings traduisibles
3. Génère les fichiers de traduction JSON
4. Appelle DeepL pour traduire automatiquement
5. Réécrit les composants pour utiliser `t("clé")`
6. Injecte la configuration Next.js i18n

---

## Licence & Modèle économique

| Aspect | Décision |
|--------|----------|
| Licence | **MIT** — 100% open source |
| Prix | **Gratuit** — aucune limitation |
| Distribution | npm public + GitHub |
| Monétisation | Aucune en v1 — SaaS optionnel envisagé plus tard |

---

## Stack technique

| Rôle | Technologie | Raison |
|------|-------------|--------|
| Langage | **Node.js + TypeScript** | Standard ecosystem npm |
| CLI framework | **Commander.js** | Léger, populaire, bien documenté |
| AST parser | **ts-morph** | Support TypeScript natif, API simple |
| Fallback AST | **@babel/parser** | Projets JS sans TypeScript |
| Traduction | **DeepL API** | Meilleure qualité, 500k chars/mois gratuit |
| Runtime i18n | **next-intl** | Standard Next.js App Router |
| Tests | **Vitest** | Rapide, compatible ESM |
| Lint/Format | **ESLint + Prettier** | Standard industrie |

---

## Gestion de la clé API DeepL

- **Chaque développeur utilise sa propre clé DeepL** — le package ne centralise rien
- La clé est demandée interactivement au `init` ou via variable d'environnement
- Elle est stockée dans `.env.local` — **jamais dans le code source**
- Le CLI ajoute automatiquement les entrées nécessaires au `.gitignore`
- DeepL Free = 500 000 caractères/mois — suffisant pour la majorité des projets

```bash
# .env.local (auto-généré, jamais commité)
AUTO_I18N_DEEPL_KEY=your-key-here
```

---

## Workflow complet

```
npx auto-i18n init
        │
        ▼
┌─────────────────────────────────────┐
│  1. Configuration interactive       │
│     - Langue source (ex: fr)        │
│     - Langues cibles (ex: en, es)   │
│     - Clé API DeepL                 │
│     → génère auto-i18n.config.json  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  2. Scan AST du projet              │
│     Détecte 3 types de strings :    │
│     - JSX : <p>Bonjour</p>          │
│     - Attributs : placeholder="..." │
│     - Template literals : `Salut`   │
│     Ignore : classNames, imports,   │
│     variables techniques            │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  3. Génération fichier source       │
│     messages/fr.json                │
│     {                               │
│       "hello": "Bonjour",           │
│       "welcome_user": "Salut {name}"│
│     }                               │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  4. Traduction via DeepL API        │
│     messages/en.json                │
│     messages/es.json                │
│     messages/de.json ...            │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  5. Réécriture AST des composants   │
│     Avant : <p>Bonjour</p>          │
│     Après : <p>{t("hello")}</p>     │
│                                     │
│     Avant : placeholder="Chercher"  │
│     Après : placeholder={t("search")}│
│                                     │
│     Strings dyn : `Salut ${name}`   │
│     Après : t("hello_name",{name})  │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  6. Injection config Next.js        │
│     - Modifie layout.tsx            │
│       → ajoute NextIntlClientProvider│
│     - Modifie next.config.ts/js     │
│       → ajoute config i18n          │
│     - Crée middleware.ts si absent  │
└─────────────────────────────────────┘
        │
        ▼
   Site i18n opérationnel ✓
```

---

## Structure du projet (repo)

```
auto-i18n/
├── src/
│   ├── cli/
│   │   ├── index.ts           # Entry point CLI (Commander.js)
│   │   └── prompts.ts         # Questions interactives (init)
│   ├── scanner/
│   │   ├── index.ts           # Orchestration du scan
│   │   ├── ast-parser.ts      # Parsing ts-morph / babel
│   │   ├── string-extractor.ts# Extraction des strings traduisibles
│   │   └── filters.ts         # Filtrage strings techniques
│   ├── generator/
│   │   ├── index.ts           # Génération fichiers JSON
│   │   └── key-builder.ts     # Construction des clés i18n
│   ├── translator/
│   │   ├── index.ts           # Orchestration traduction
│   │   └── deepl.ts           # Client DeepL API
│   ├── rewriter/
│   │   ├── index.ts           # Orchestration réécriture
│   │   ├── jsx-rewriter.ts    # Remplacement strings JSX
│   │   └── attr-rewriter.ts   # Remplacement attributs HTML
│   ├── injector/
│   │   ├── index.ts           # Orchestration injection config
│   │   ├── layout-injector.ts # Modification layout.tsx
│   │   └── config-injector.ts # Modification next.config
│   └── utils/
│       ├── config.ts          # Lecture/écriture config
│       ├── env.ts             # Gestion .env et .gitignore
│       └── logger.ts          # Logs CLI colorés
├── tests/
│   ├── scanner/
│   ├── generator/
│   ├── translator/
│   └── rewriter/
├── auto-i18n.config.json      # Config générée (exemple)
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

---

## Fichier de config généré

```json
// auto-i18n.config.json
{
  "sourceLocale": "fr",
  "targetLocales": ["en", "es", "de"],
  "provider": "deepl",
  "apiKeyEnv": "AUTO_I18N_DEEPL_KEY",
  "messagesDir": "./messages",
  "ignore": [
    "node_modules",
    ".next",
    "**/*.test.*",
    "**/*.spec.*"
  ]
}
```

---

## Commandes CLI

```bash
# Initialisation complète (commande principale)
npx auto-i18n init

# Preview sans modifier les fichiers
npx auto-i18n init --dry-run

# Rescanner et mettre à jour les traductions
npx auto-i18n sync

# Ajouter une nouvelle langue
npx auto-i18n add-locale ar

# Voir les strings non traduites
npx auto-i18n missing
```

---

## Cas limites à gérer

| Cas | Comportement attendu |
|-----|---------------------|
| String déjà wrappée dans `t()` | Ignorée, non dupliquée |
| String vide `""` | Ignorée |
| String purement numérique `"42"` | Ignorée |
| className, id, type | Ignorés (liste noire) |
| Template literal dynamique `\`Salut ${name}\`` | Converti en `t("key", { name })` |
| String identique dans plusieurs fichiers | Une seule clé partagée |
| Projet sans TypeScript | Fallback sur @babel/parser |
| Clé DeepL absente | Message d'erreur clair avec lien inscription |

---

## Features de sécurité

- La clé DeepL n'est **jamais** écrite dans `auto-i18n.config.json`
- Le CLI vérifie et met à jour `.gitignore` automatiquement
- Mode `--dry-run` pour vérifier avant toute modification
- Backup automatique des fichiers avant réécriture AST (`*.backup`)

---

## Roadmap

### v1.0 — MVP (objectif initial)
- [x] Spécifications complètes
- [ ] Structure repo + CLI de base
- [ ] Scanner AST (JSX + attributs + template literals)
- [ ] Générateur JSON (fichier source)
- [ ] Client DeepL
- [ ] Réécriture AST des composants
- [ ] Injection config Next.js
- [ ] Mode `--dry-run`
- [ ] README complet

### v1.x — Améliorations
- [ ] Commande `sync` (mise à jour)
- [ ] Commande `missing` (strings manquantes)
- [ ] Mode `--watch`
- [ ] Support Vite + React sans Next.js

### v2.0 — Multi-providers
- [ ] Support OpenAI (GPT-4)
- [ ] Support Google Translate
- [ ] Config provider interchangeable

### v3.0 — Écosystème (optionnel)
- [ ] Dashboard web SaaS pour gestion en équipe
- [ ] CI/CD integration
- [ ] API publique

---

## Pourquoi auto-i18n vs les alternatives ?

| Outil | Problème |
|-------|---------|
| `next-intl` | Runtime seulement — setup manuel total |
| `i18next` | Complexe, verbeux, zéro automatisation |
| `next-translate` | Pas de scan automatique |
| **auto-i18n** | **Scan + traduction + réécriture en une commande** |

L'USP (proposition de valeur unique) : **zéro intervention manuelle**. Le dev ne fait rien d'autre qu'entrer sa clé DeepL.

---

*Document de référence — v1.0 — Projet auto-i18n*
