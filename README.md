# next-auto-i18n

![npm version](https://img.shields.io/npm/v/next-auto-i18n)
![npm downloads](https://img.shields.io/npm/dm/next-auto-i18n)
![license](https://img.shields.io/npm/l/next-auto-i18n)

> CLI d’internationalisation pour projets Next.js App Router, avec scan AST, génération de messages, traduction DeepL, réécriture prudente et injection `next-intl`.

`next-auto-i18n` scanne votre code, extrait les strings traduisibles, génère les clés i18n, remplit les fichiers `messages/*.json`, traduit via DeepL et applique les mutations sûres du projet. Quand une réécriture ou une injection n’est pas jugée fiable, le CLI s’arrête proprement sur cette cible et renvoie une action manuelle recommandée au lieu de modifier silencieusement votre code.

La version actuelle est pensée pour être **utile en automatique**, mais aussi **conservatrice** sur les cas ambigus.

Le complément de documentation se trouve dans [DOCUMENTATION.md](./DOCUMENTATION.md).

## Installation

```bash
npm install -D next-auto-i18n next-intl
```

Ou directement :

```bash
npx next-auto-i18n init
```

## Prérequis

- Node.js `>= 18`
- Un projet Next.js avec App Router
- `next-intl` installé dans le projet
- Une clé API DeepL

## Ce que le package fait vraiment

- Scan AST des fichiers `.tsx`, `.jsx`, `.ts`, `.js`
- Extraction des strings JSX, attributs traduisibles et template literals
- Génération incrémentale des clés dans `messages/<locale>.json`
- Traduction DeepL avec validation des placeholders
- Réécriture automatique des cas sûrs
- Détection des cas risqués : module-scope, JSX ambigu, fichiers non parsables
- Injection Next.js conservatrice : applique ce qui est sûr, bloque ce qui doit rester manuel
- Reporting structuré : `success`, `partial`, `failed`, diagnostics et actions manuelles

## Ce que le package ne promet pas

- Il ne réécrit pas tous les cas JSX complexes.
- Il ne force pas la restructuration `app/[locale]` si le layout racine paraît trop personnalisé.
- Il ne “corrige pas quand même” un projet ambigu.
- Il ne garantit pas un projet 100% migré sans validation humaine sur les cas avancés.

## Démarrage rapide

```bash
npx next-auto-i18n init
```

Le CLI vous guide sur :

1. la locale source
2. les locales cibles
3. la clé DeepL

Puis il :

- crée `auto-i18n.config.json`
- alimente `messages/<sourceLocale>.json`
- traduit les locales cibles
- réécrit les fichiers sûrs
- tente les injections Next.js sûres
- signale clairement les parties à traiter manuellement

## Commandes

### `next-auto-i18n init`

Initialise le projet : scan, messages, traduction, réécriture, injection.

```bash
next-auto-i18n init
next-auto-i18n init --dry-run
next-auto-i18n init --locale en,es,de
```

`--dry-run` montre d’abord un aperçu et demande confirmation avant d’appliquer.

### `next-auto-i18n sync`

Rescanne le projet, fusionne les nouvelles strings et synchronise les traductions sans régénérer toute la base.

```bash
next-auto-i18n sync
```

### `next-auto-i18n extract`

Génère ou met à jour les fichiers `messages/*.json`, traduit, puis produit un guide Markdown sans modifier les fichiers source applicatifs.

```bash
next-auto-i18n extract
next-auto-i18n extract --out docs/i18n-guide.md
next-auto-i18n extract --inject
next-auto-i18n extract --switcher
next-auto-i18n extract --no-module-scope
```

### `next-auto-i18n extract sync`

Version incrémentale de `extract`.

```bash
next-auto-i18n extract sync
next-auto-i18n extract sync --inject
next-auto-i18n extract sync --switcher
next-auto-i18n extract sync --no-module-scope
```

### `next-auto-i18n add-locale <locale>`

Ajoute une locale cible, traduit les clés existantes et met à jour l’infrastructure Next.js avec les mêmes garde-fous que le reste du moteur.

```bash
next-auto-i18n add-locale ar
```

### `next-auto-i18n missing`

Affiche les clés manquantes par locale cible.

```bash
next-auto-i18n missing
```

## Modèle de sécurité

- `.env.local` et `*.backup` sont ajoutés au `.gitignore`
- les placeholders de traduction sont validés avant écriture
- les réécritures ambiguës sont exclues au lieu d’être appliquées de force
- les injecteurs Next.js retournent `applicable`, `already_present`, `manual_required` ou `blocked`
- le run global peut finir en `partial` avec actions manuelles listées

## Compatibilité

### Structures de projet

| Structure | Statut | Notes |
|---|---|---|
| `app/` | supporté | cas principal |
| `src/app/` | supporté | supporté par le scanner et les injecteurs |
| `components/`, `ui/`, `features/`, `shared/` | supporté au scan | scan AST étendu |
| monorepo avec conventions très custom | partiel | dépend de la structure réellement scannée |

### Réécriture AST

| Cas | Statut | Comportement |
|---|---|---|
| texte JSX simple | supporté | réécriture automatique |
| attributs traduisibles | supporté | réécriture automatique |
| template literals simples | supporté | génération de clé + réécriture |
| strings module-scope | partiel | traduites, mais intégration souvent manuelle |
| JSX inline ambigu ou espaces sensibles | conservateur | exclu de la réécriture auto |
| fichier non parsable | bloqué | diagnostic remonté, aucune mutation |

### Injection Next.js

| Cible | Statut | Comportement |
|---|---|---|
| `next.config.*` | supporté | injection si sûre, sinon blocage explicite |
| `middleware.ts` / `proxy.ts` | supporté | création prudente selon contexte |
| `i18n/routing.ts` | supporté | création ou skip si déjà présent |
| `i18n/request.ts` | supporté | création ou skip si déjà présent |
| `LanguageSwitcher` | supporté | injecteur isolé possible |
| `app/[locale]/` | conservateur | refus explicite sur layout complexe |

### Versions et dépendances

| Élément | Statut |
|---|---|
| Node.js 18+ | requis |
| Next.js App Router | requis |
| `next-intl` | requis |
| DeepL Free / Pro | supporté |

## Exemples de comportement

### Cas sûr

```tsx
<p>Bonjour</p>
```

devient :

```tsx
<p>{t("bonjour")}</p>
```

### Cas module-scope

```tsx
const items = ['Accueil', 'Contact'];
```

Le package peut générer les messages, mais laissera une action manuelle plutôt que d’injecter `t()` à un endroit où il n’est pas accessible.

### Cas layout complexe

Si le layout racine contient de la logique sensible ou certains patterns considérés à risque, l’injection de `app/[locale]` est marquée `manual required`. Les autres injections sûres peuvent continuer.

## Configuration

Le fichier `auto-i18n.config.json` est généré automatiquement :

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

La clé API est stockée dans `.env.local` :

```bash
AUTO_I18N_DEEPL_KEY=votre-cle
```

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
