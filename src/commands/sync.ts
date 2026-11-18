/**
 * Commande `sync` — met à jour les catalogues et traduit le manquant.
 *
 * Par défaut, ne modifie jamais le code source. Avec `write: true`, câble en plus
 * mécaniquement les strings `safe` en `t()` (avec sauvegarde `.backup` sauf `noBackup`).
 */

import { loadConfig } from '../config/index.js';
import { resolveProjectApiKey } from '../utils/env.js';
import { createProvider, type TranslationProvider } from '../adapters/translation/index.js';
import { detectProject } from '../adapters/project/index.js';
import { runSync, type SyncReport } from '../pipeline/sync.js';
import { runWrite, type WriteReport } from '../pipeline/write.js';
import { renderSyncReport } from '../reporting/sync.js';
import { renderWriteReport } from '../reporting/write.js';
import { withProjectLock } from '../adapters/fs/lock.js';

export interface RunSyncCommandOptions {
  projectRoot: string;
  write?: boolean;
  dryRun?: boolean;
  prune?: boolean;
  /** N'écrit pas de fichier `.backup` lors de `--write`. */
  noBackup?: boolean;
  /** Provider injectable (tests ou intégrations programmatiques). */
  provider?: TranslationProvider;
}

export interface RunSyncCommandResult {
  report: SyncReport;
  writeReport?: WriteReport;
  exitCode: number;
}

export async function runSyncCommand(
  options: RunSyncCommandOptions,
): Promise<RunSyncCommandResult> {
  return withProjectLock(options.projectRoot, () => syncLocked(options), options.dryRun);
}

async function syncLocked(options: RunSyncCommandOptions): Promise<RunSyncCommandResult> {
  const { projectRoot, write = false, dryRun = false, prune = false, noBackup = false } = options;
  const config = await loadConfig(projectRoot);
  const preResolvedKey = options.provider
    ? undefined
    : await resolveProjectApiKey(projectRoot, config.apiKeyEnv);

  const provider =
    options.provider ??
    (() => {
      if (!preResolvedKey) {
        throw new Error(
          `Clé API introuvable (${config.apiKeyEnv}). Ajoutez-la dans .env.local ou lancez "init".`,
        );
      }
      return createProvider(config.provider, preResolvedKey, { model: config.model });
    });

  const report = await runSync({
    projectRoot,
    provider,
    sourceLocale: config.sourceLocale,
    targetLocales: config.targetLocales,
    messagesDir: config.messagesDir,
    ignore: config.ignore,
    rootDirs: config.rootDirs,
    catalogFormat: config.catalogFormat,
    namespaceByFile: config.namespaceByFile,
    tone: config.tone,
    glossary: config.glossary,
    prune,
    dryRun,
  });

  renderSyncReport(projectRoot, report);

  let writeReport: WriteReport | undefined;
  if (write) {
    const project = await detectProject(projectRoot);
    writeReport = await runWrite({
      projectRoot,
      strings: report.strings,
      keyMap: report.keyMap,
      fileRuntimes: report.fileRuntimes,
      dryRun,
      noBackup,
      framework: project.framework,
    });
    renderWriteReport(projectRoot, writeReport);
  }

  return {
    report,
    writeReport,
    exitCode: report.translation.failed.length > 0 || report.parseErrors.length > 0 ? 1 : 0,
  };
}
