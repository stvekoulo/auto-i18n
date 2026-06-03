/**
 * Commande `sync` — met à jour les catalogues et traduit le manquant.
 * Ne modifie jamais le code source.
 */

import { loadConfig } from '../config/index.js';
import { loadEnv, getApiKey } from '../utils/env.js';
import { createProvider } from '../adapters/translation/index.js';
import { runSync, type SyncReport } from '../pipeline/sync.js';
import { renderSyncReport } from '../reporting/sync.js';

export interface RunSyncCommandOptions {
  projectRoot: string;
}

export interface RunSyncCommandResult {
  report: SyncReport;
  exitCode: number;
}

export async function runSyncCommand(
  options: RunSyncCommandOptions,
): Promise<RunSyncCommandResult> {
  const { projectRoot } = options;
  const config = await loadConfig(projectRoot);

  loadEnv(projectRoot);
  const apiKey = getApiKey(config.apiKeyEnv);
  if (!apiKey) {
    throw new Error(
      `Clé API introuvable (${config.apiKeyEnv}). Ajoutez-la dans .env.local ou lancez "init".`,
    );
  }

  const provider = createProvider(config.provider, apiKey);

  const report = await runSync({
    projectRoot,
    provider,
    sourceLocale: config.sourceLocale,
    targetLocales: config.targetLocales,
    messagesDir: config.messagesDir,
    ignore: config.ignore,
  });

  renderSyncReport(projectRoot, report);

  return { report, exitCode: report.translation.failed.length > 0 ? 1 : 0 };
}
