# Changelog

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
