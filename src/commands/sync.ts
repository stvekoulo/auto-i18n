/**
 * Commande `sync` — met à jour les catalogues et traduit le manquant.
 *
 * Par défaut, ne modifie jamais le code source (modèle zéro-mutation). Avec
 * `write: true`, câble en plus mécaniquement les strings `safe` en `t()` —
 * voir `pipeline/write.ts` pour les garanties de sûreté. Le codemod injecte
 * des imports `next-intl` : il est désactivé sur un projet détecté react-i18next
 * pour ne jamais injecter un import qui n'existe pas dans ce projet.
 */

import { loadConfig } from '../config/index.js';
import { loadEnv, getApiKey } from '../utils/env.js';
import { createProvider } from '../adapters/translation/index.js';
import { detectProject } from '../adapters/project/index.js';
import { runSync, type SyncReport } from '../pipeline/sync.js';
import { runWrite, type WriteReport } from '../pipeline/write.js';
import { renderSyncReport } from '../reporting/sync.js';
import { renderWriteReport } from '../reporting/write.js';
import { logger } from '../utils/logger.js';

export interface RunSyncCommandOptions {
  projectRoot: string;
  /** Câble mécaniquement les strings safe en `t()` (opt-in). */
  write?: boolean;
  /** Avec `write`, calcule les changements sans les écrire sur disque. */
  dryRun?: boolean;
}

export interface RunSyncCommandResult {
  report: SyncReport;
  writeReport?: WriteReport;
  exitCode: number;
}

export async function runSyncCommand(
  options: RunSyncCommandOptions,
): Promise<RunSyncCommandResult> {
  const { projectRoot, write = false, dryRun = false } = options;
  const config = await loadConfig(projectRoot);

  loadEnv(projectRoot);

  // Fabrique plutôt que provider : un projet déjà entièrement traduit se
  // synchronise sans clé API, ce qui débloque la CI et les contributeurs.
  const provider = () => {
    const apiKey = getApiKey(config.apiKeyEnv);
    if (!apiKey) {
      throw new Error(
        `Clé API introuvable (${config.apiKeyEnv}). Ajoutez-la dans .env.local ou lancez "init".`,
      );
    }
    return createProvider(config.provider, apiKey);
  };

  const report = await runSync({
    projectRoot,
    provider,
    sourceLocale: config.sourceLocale,
    targetLocales: config.targetLocales,
    messagesDir: config.messagesDir,
    ignore: config.ignore,
    rootDirs: config.rootDirs,
  });

  renderSyncReport(projectRoot, report);

  let writeReport: WriteReport | undefined;
  if (write) {
    const project = await detectProject(projectRoot);
    if (project.framework === 'react-i18next') {
      logger.warn(
        '--write désactivé : projet react-i18next détecté (le codemod ne câble que next-intl pour le moment) — voir le guide.',
      );
    } else {
      writeReport = await runWrite({
        strings: report.strings,
        keyMap: report.keyMap,
        fileRuntimes: report.fileRuntimes,
        dryRun,
      });
      renderWriteReport(projectRoot, writeReport);
    }
  }

  return { report, writeReport, exitCode: report.translation.failed.length > 0 ? 1 : 0 };
}
