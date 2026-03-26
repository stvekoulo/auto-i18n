# Changelog

## [0.2.0] - 2026-03-26

### Added

- **Language Switcher** : composant flottant genere automatiquement et injecte dans le layout, permettant aux utilisateurs de changer de langue depuis le navigateur. Personnalisable (position, theme, couleur d'accent, taille).
- **Auto-install next-intl** : detection automatique du package manager (npm/yarn/pnpm) et installation de `next-intl` si absent.
- **Attribution** : tag "Made by Steven Koulo" integre au widget (requis par la licence).

### Fixed

- **Scanner** : les template literals dans `className`, `style`, `id`, `href`, `src` et autres attributs non traduisibles ne sont plus extraits.
- **Rewriter** : les crashes AST sur les structures complexes (ternaires, expressions imbriquees) sont desormais absorbes gracieusement (try/catch).
- **Pipeline** : la reecriture de chaque fichier est isolee — un fichier en erreur n'arrete plus le reste du pipeline.
- **CLI** : l'etape d'injection (middleware, routing, layout) s'execute meme si la reecriture echoue partiellement.

### Changed

- Mise a jour de vitest 1.6.x vers 4.1.x pour compatibilite Node.js 25.

## [0.1.0] - 2026-03-26

### Initial release

- **Scanner** : extraction AST des strings JSX, attributs et template literals
- **Generator** : generation des cles i18n et du fichier `messages/<locale>.json`
- **Translator** : traduction automatique via DeepL API (batch, incrementiel)
- **Rewriter** : reecriture des composants React (`t("cle")`, `useTranslations`, `getTranslations`)
- **Injector** : configuration automatique de Next.js (`layout.tsx`, `next.config`, `middleware.ts`, `i18n/routing.ts`)
- **CLI** : commandes `init`, `sync`, `add-locale`, `missing`
- Mode `--dry-run` pour preview sans modification
- Backups automatiques (`*.backup`)
- Support Server Components et Client Components
- Protection des placeholders lors de la traduction
