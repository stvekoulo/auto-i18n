/**
 * Commande `init` — installe l'infra next-intl (fichiers additifs), crée la
 * config, génère et traduit les catalogues, puis écrit le guide d'intégration.
 * Ne modifie jamais le code source des composants.
 */

import { resolve, relative, dirname } from 'path';
import { buildConfig, saveConfig } from '../config/index.js';
import { saveApiKeyToEnv, ensureGitignore } from '../utils/env.js';
import { detectProject } from '../adapters/project/index.js';
import { scaffoldProject, type ScaffoldTargetResult } from '../adapters/scaffold/index.js';
import { writeText, ensureDir } from '../adapters/fs/index.js';
import { createProvider, type TranslationProvider } from '../adapters/translation/index.js';
import { runSync, type SyncReport } from '../pipeline/sync.js';
import { buildGuideModel, buildGuide } from '../core/guide/index.js';
import { renderScaffold } from '../reporting/init.js';
import { renderSyncReport } from '../reporting/sync.js';
import { logger } from '../utils/logger.js';

export interface RunInitOptions {
  projectRoot: string;
  sourceLocale: string;
  targetLocales: string[];
  apiKey: string;
  /** Provider injectable (tests). Sinon dérivé de la config. */
  provider?: TranslationProvider;
  /** Chemin du guide (défaut: i18n-guide.md). */
  guidePath?: string;
}

export interface RunInitResult {
  scaffold: ScaffoldTargetResult[];
  syncReport: SyncReport;
  guidePath: string;
  exitCode: number;
}

function formatDate(): string {
  return new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export async function runInit(options: RunInitOptions): Promise<RunInitResult> {
  const { projectRoot, sourceLocale, targetLocales, apiKey } = options;

  const config = buildConfig(sourceLocale, targetLocales);

  await ensureGitignore(projectRoot, ['.env.local', '*.backup']);
  await saveApiKeyToEnv(projectRoot, config.apiKeyEnv, apiKey);
  await saveConfig(projectRoot, config);

  const project = await detectProject(projectRoot);
  if (!project.hasNextIntl) {
    logger.warn('next-intl introuvable — installez-le : npm install next-intl');
  }

  logger.step('Infrastructure next-intl');
  const scaffold = await scaffoldProject(project, {
    locales: [sourceLocale, ...targetLocales],
    defaultLocale: sourceLocale,
  });
  renderScaffold(projectRoot, scaffold);

  logger.step('Catalogues et traduction');
  const provider = options.provider ?? createProvider(config.provider, apiKey);
  const syncReport = await runSync({
    projectRoot,
    provider,
    sourceLocale,
    targetLocales,
    messagesDir: config.messagesDir,
    ignore: config.ignore,
  });
  renderSyncReport(projectRoot, syncReport);

  logger.step("Guide d'intégration");
  const guideModel = buildGuideModel({
    projectRoot,
    sourceLocale,
    targetLocales,
    date: formatDate(),
    strings: syncReport.strings,
    keyMap: syncReport.keyMap,
    fileRuntimes: syncReport.fileRuntimes,
  });
  const guidePath = resolve(projectRoot, options.guidePath ?? 'i18n-guide.md');
  await ensureDir(dirname(guidePath));
  await writeText(guidePath, buildGuide(guideModel));
  logger.success(`Guide écrit : ${relative(projectRoot, guidePath)}`);

  return {
    scaffold,
    syncReport,
    guidePath,
    exitCode: syncReport.translation.failed.length > 0 ? 1 : 0,
  };
}
