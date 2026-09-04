/**
 * Commande `check` — read-only. Scanne le projet, compare aux catalogues et
 * rapporte l'état (strings non cataloguées, traductions manquantes, parse errors).
 * Conçue pour la CI : renvoie un code de sortie ≠ 0 si du travail est en attente.
 */

import { join, resolve } from 'path';
import { loadConfig } from '../config/index.js';
import { scanProject } from '../pipeline/scan.js';
import { readCatalog } from '../adapters/fs/index.js';
import { buildCheckReport, type CheckReport } from '../core/check/index.js';
import { renderCheckReport, renderCheckJson } from '../reporting/check.js';

export interface RunCheckOptions {
  projectRoot: string;
  json?: boolean;
}

export interface RunCheckResult {
  report: CheckReport;
  exitCode: number;
}

/** Exécute le check et renvoie le rapport + code de sortie (n'appelle pas process.exit). */
export async function runCheck(options: RunCheckOptions): Promise<RunCheckResult> {
  const { projectRoot, json = false } = options;
  const config = await loadConfig(projectRoot);

  const scan = await scanProject(projectRoot, {
    ignorePatterns: config.ignore,
  });

  const messagesDir = resolve(projectRoot, config.messagesDir);
  const sourceCatalog = await readCatalog(join(messagesDir, `${config.sourceLocale}.json`));

  const targetCatalogs = Object.fromEntries(
    await Promise.all(
      config.targetLocales.map(
        async locale => [locale, await readCatalog(join(messagesDir, `${locale}.json`))] as const,
      ),
    ),
  );

  const report = buildCheckReport({
    strings: scan.strings,
    filesScanned: scan.filesScanned,
    parseErrors: scan.parseErrors,
    sourceCatalog,
    targetCatalogs,
  });

  if (json) {
    renderCheckJson(report);
  } else {
    renderCheckReport(projectRoot, report);
  }

  return { report, exitCode: report.ok ? 0 : 1 };
}
