/**
 * Point d'entrée bibliothèque de next-auto-i18n (v3).
 *
 * Expose l'API programmatique (commandes, pipelines, core, providers) pour une
 * intégration dans un script. Importer ce module n'exécute pas le CLI.
 */

// API de haut niveau (commandes)
export { runInit, type RunInitOptions, type RunInitResult } from './commands/init.js';
export {
  runSyncCommand,
  type RunSyncCommandOptions,
  type RunSyncCommandResult,
} from './commands/sync.js';
export {
  runCheck,
  type RunCheckOptions,
  type RunCheckResult,
  type CheckOutputFormat,
} from './commands/check.js';
export {
  runAddLocale,
  type RunAddLocaleOptions,
  type RunAddLocaleResult,
} from './commands/add-locale.js';
export {
  runCleanBackups,
  runRestoreBackups,
  findProjectBackups,
  type CleanBackupsOptions,
  type CleanBackupsResult,
  type RestoreBackupsOptions,
  type RestoreBackupsResult,
} from './commands/backups.js';
export { startWatchSync, type WatchSyncOptions, type WatchHandle } from './commands/watch.js';

// Configuration
export {
  loadConfig,
  saveConfig,
  buildConfig,
  isValidConfig,
  ConfigNotFoundError,
  ConfigInvalidError,
  validateConfig,
  CONFIG_FILENAME,
  CONFIG_SCHEMA_PATH,
  PROVIDER_API_KEY_ENV,
  SUPPORTED_PROVIDERS,
  type AutoI18nConfig,
  type ProviderName,
} from './config/index.js';

// Pipelines (orchestration)
export {
  scanProject,
  scanAdditionalReferences,
  type ProjectScanResult,
  type ScanProjectOptions,
} from './pipeline/scan.js';
export { runSync, type RunSyncInput, type SyncReport } from './pipeline/sync.js';
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

// Erreurs d'I/O et utilitaires de sécurité
export { CatalogParseError } from './adapters/fs/index.js';
export { assertInsideProject, staysInsideProject } from './utils/paths.js';

// Providers de traduction (DeepL, Google, OpenAI, Gemini, Anthropic ou custom)
export {
  createProvider,
  DeepLProvider,
  GoogleTranslateProvider,
  LlmTranslateProvider,
  TranslationError,
  type LlmProviderName,
  type ProviderOptions,
  type TranslationTone,
  type TranslationProvider,
  type TranslateParams,
  type TranslationErrorKind,
} from './adapters/translation/index.js';

// Core (extraction, filtres, clés, catalogue, check, guide, write) — purs
export * from './core/index.js';
