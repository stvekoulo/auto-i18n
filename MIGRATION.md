# Guides de migration

- [1.x → 2.0](#migration-1x--20) — durcissement, nommage ICU, Node 22
- [0.x → 1.0](#migration-0x--10) — refonte zéro-mutation

---

## Migration 1.x → 2.0

La `2.0` ne change pas le modèle : elle corrige des défauts qui cassaient ou corrompaient des projets, et remet les dépendances à niveau. Trois points demandent une action.

### 1. Node.js 22.12 minimum

Node 18 et 20 sont en fin de vie et les dépendances à jour l'exigent. Mettez à jour votre runtime local et vos runners CI. Un `.nvmrc` est fourni.

### 2. Les variables d'interpolation deviennent des identifiants ICU

Avant, un texte comme :

```tsx
<p>{`Bonjour ${user.name}, tu as ${count} messages`}</p>
```

produisait la clé `"Bonjour {user.name}, tu as {count} messages"`. Le placeholder `{user.name}` n'est **pas** un argument ICU valide : `next-intl` refuse ce message au runtime. Et `sync --write` générait `t("clé", { user.name, count })`, une `SyntaxError`.

La `2.0` dérive un identifiant depuis l'expression :

| Expression source | Placeholder de catalogue | Appel généré                               |
| ----------------- | ------------------------ | ------------------------------------------ |
| `count`           | `{count}`                | `t("clé", { count })`                      |
| `user.name`       | `{userName}`             | `t("clé", { userName: user.name })`        |
| `items[0].label`  | `{itemsLabel}`           | `t("clé", { itemsLabel: items[0].label })` |

**Action requise** si vos catalogues contiennent déjà des placeholders à points :

```bash
# Repérer les messages concernés
grep -rn '{[a-zA-Z_$][a-zA-Z0-9_$]*\.' messages/
```

Renommez ces placeholders dans **tous** les fichiers `messages/*.json` (source et cibles), et adaptez les appels `t()` déjà câblés dans votre code. Les clés elles-mêmes ne changent pas — seul le contenu des messages est concerné. Sans placeholder à points, il n'y a rien à faire.

### 3. Configuration et catalogues désormais validés

Ce qui était ignoré en silence lève maintenant une erreur explicite :

- **Configuration invalide** — champ inconnu (`messageDir` au lieu de `messagesDir`), code de langue mal formé, langue à la fois source et cible, doublons, provider inconnu, `messagesDir` sortant du projet. Tous les problèmes sont listés d'un coup.
- **Catalogue illisible** — un `messages/*.json` qui n'est pas du JSON à plat. Auparavant traité comme vide, donc retraduit intégralement **et écrasé**. Corrigez ou supprimez le fichier ; l'outil n'y touche plus tant qu'il est invalide.

Si vos catalogues sont **imbriqués** (`{"Home": {"title": "..."}}`), l'outil ne les a jamais gérés : aplatissez-les avant de passer en 2.0.

### Bon à savoir (aucune action requise)

- Le scan ne descend que dans une liste de dossiers de premier niveau. Si votre code vit ailleurs (`modules/`, `views/`…), renseignez le nouveau champ **`rootDirs`** — auparavant le scan renvoyait zéro texte en signalant un succès.
- `sync` n'exige plus de clé API quand tout est déjà traduit.
- L'ordre des clés dans les catalogues change une fois (tri par point de code au lieu de `localeCompare`). Attendez-vous à un diff unique au premier `sync`, puis à un ordre stable partout, y compris en CI.
- Usage programmatique : `ExtractedString.variables` passe de `string[]` à `TemplateVariable[]` (`{ expression, name }`).

---

## Migration 0.x → 1.0

La version `1.0` est une **refonte majeure**. Le changement de fond : **le package ne réécrit plus votre code source**. Tout le reste en découle.

## TL;DR

- Avant, `init` **modifiait vos composants** (remplaçait le texte par `t()`, injectait imports et `const t`). C'était la principale source d'erreurs.
- Maintenant, l'outil **ne touche pas à votre code** : il détecte, génère les clés, traduit, installe l'infra `next-intl` manquante, et produit un **guide d'intégration** (`i18n-guide.md`) qui vous dit, fichier par fichier et ligne par ligne, comment câbler chaque `t()`.
- Les commandes passent de 6 à 3 : **`init`**, **`sync`**, **`check`**.
- C'est un _breaking change_ → version majeure `1.0.0`.

## Changements de comportement

|                                                     | 0.x                                | 1.0                                                             |
| --------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Code source des composants                          | Réécrit automatiquement            | **Jamais modifié**                                              |
| `app/[locale]/`                                     | Restructuration automatique tentée | **Manuelle** (procédure dans le guide)                          |
| `next.config`                                       | Plugin `withNextIntl` injecté      | Idem, **seule mutation**, avec backup, sinon signalé « manuel » |
| `routing.ts` / `request.ts` / middleware / switcher | Créés                              | Créés **uniquement si absents**                                 |
| Résultat principal                                  | Code migré (parfois cassé)         | Catalogues traduits + **guide d'intégration**                   |

## Changements de commandes

| 0.x                        | 1.0     | Quoi faire                                                                                    |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `init`                     | `init`  | Installe l'infra + catalogues + traduction + guide (ne réécrit plus le code)                  |
| `sync`                     | `sync`  | Inchangé en esprit : rescanne, met à jour le catalogue, traduit le manquant                   |
| `add-locale <l>`           | —       | Ajoutez la locale dans `targetLocales` (config) puis lancez `sync`                            |
| `missing`                  | `check` | `check` est read-only, avec code de sortie pour la CI et `--json`                             |
| `extract` / `extract sync` | —       | C'est devenu le comportement **par défaut** (`init`/`sync` n'écrivent jamais dans votre code) |
| —                          | `check` | **Nouveau** : diagnostic CI (strings non cataloguées, traductions manquantes)                 |

### Équivalences rapides

```bash
# Avant → Maintenant
next-auto-i18n add-locale de   # → ajoutez "de" à targetLocales, puis: next-auto-i18n sync
next-auto-i18n missing         # → next-auto-i18n check
next-auto-i18n extract         # → comportement par défaut de init/sync (zéro réécriture)
```

## Étapes de migration

1. **Mettez à jour** : `npm install -D next-auto-i18n@latest`.
2. **Lancez** `next-auto-i18n sync` (ou `init` si vous repartez de zéro). Vos fichiers source ne seront pas modifiés.
3. **Ouvrez `i18n-guide.md`** et câblez les `t()` indiqués (le guide donne la ligne, la clé, le remplacement et le bon hook `useTranslations` / `await getTranslations`).
4. **Mettez à jour vos scripts** : remplacez `add-locale` / `missing` / `extract` par `init` / `sync` / `check`.
5. **Config** : `messagesDir` n'est plus obligatoire (défaut appliqué). `init` ajoute un champ `$schema` qui active l'autocomplétion dans VSCode ; vous pouvez l'ajouter à la main sur une config existante :
   ```json
   { "$schema": "./node_modules/next-auto-i18n/schema/auto-i18n.config.schema.json" }
   ```

## Si l'ancienne version avait déjà migré votre code

Aucune action requise : vos `t()` existants sont conservés (l'extraction ignore ce qui est déjà dans un `t()`). `sync` se contentera de mettre à jour les catalogues et les traductions.

## Nouveautés DX (1.0.1)

- **Schéma JSON** de configuration → autocomplétion, validation et infobulles dans VSCode.
- **API programmatique** : `import { runCheck, runSync } from 'next-auto-i18n'` (l'import n'exécute pas le CLI).

---

## English summary (for release notes)

**next-auto-i18n 1.0 — major rewrite: zero-mutation model.**

The tool no longer rewrites your source code. Previously, `init` edited your components (wrapping text in `t()`, injecting imports) — the main source of breakage. Now it **detects, generates keys, translates, scaffolds the missing `next-intl` files, and produces an integration guide** (`i18n-guide.md`) that tells you exactly where and how to wire each `t()`. Your code is never touched (the only exception is the `next.config` plugin wrap, done with a backup).

- Commands reduced from 6 to **3**: `init`, `sync`, `check`.
- Removed: `add-locale` (edit `targetLocales` + `sync`), `missing` (→ `check`), `extract` / `extract sync` (now the default behavior).
- New `check` command for CI (exit code ≠ 0 on pending work, `--json`).
- `app/[locale]` is no longer auto-restructured (manual, documented in the guide).
- DX: JSON schema for editor autocomplete, clean library entry point (`import { runCheck } from 'next-auto-i18n'`).

**Migration:** update, run `sync`, follow `i18n-guide.md` to wire `t()`, and rename old commands. Existing `t()` calls are preserved.
