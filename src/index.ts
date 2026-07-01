/**
 * Point d'entrée bibliothèque de next-auto-i18n.
 *
 * Expose l'API programmatique (commandes, pipelines, core, provider) pour une
 * intégration dans un script. Importer ce module n'exécute pas le CLI.
 */

// API de haut niveau (commandes)
export { runInit, type RunInitOptions, type RunInitResult } from './commands/init.js';
export { runSyncCommand, type RunSyncCommandResult } from './commands/sync.js';
export { runCheck, type RunCheckOptions, type RunCheckResult } from './commands/check.js';

// Configuration
export {
  loadConfig,
  saveConfig,
  buildConfig,
  isValidConfig,
  ConfigNotFoundError,
  CONFIG_FILENAME,
  CONFIG_SCHEMA_PATH,
  PROVIDER_API_KEY_ENV,
  type AutoI18nConfig,
} from './config/index.js';

// Pipelines (orchestration)
export { scanProject, type ProjectScanResult } from './pipeline/scan.js';
export { runSync, type SyncReport } from './pipeline/sync.js';
export {
  translateCatalogs,
  type TranslateCatalogsInput,
  type TranslateCatalogsResult,
} from './pipeline/translate.js';
export {
  runWrite,
  type RunWriteInput,
  type WriteReport,
  type FileWriteOutcome,
} from './pipeline/write.js';

// Provider de traduction (pour brancher un provider custom)
export {
  createProvider,
  DeepLProvider,
  GoogleTranslateProvider,
  TranslationError,
  type TranslationProvider,
  type TranslateParams,
  type TranslationErrorKind,
} from './adapters/translation/index.js';

// Core (extraction, filtres, clés, catalogue, check, guide) — purs
export * from './core/index.js';
