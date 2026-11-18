/**
 * Commande `check` — read-only. Scanne le projet, compare aux catalogues (plats ou
 * imbriqués), détecte les textes source modifiés (`outdatedKeys`) et produit un diagnostic.
 */

import { join } from 'node:path';
import { loadConfig } from '../config/index.js';
import { scanProject, scanAdditionalReferences } from '../pipeline/scan.js';
import { readCatalog } from '../adapters/fs/index.js';
import { readSourceHashes } from '../adapters/fs/hashes.js';
import { findOutdatedKeys } from '../core/catalog/index.js';
import { buildCheckReport, type CheckReport } from '../core/check/index.js';
import { renderCheckReport, renderCheckJson } from '../reporting/check.js';
import { renderCheckGithub } from '../reporting/check-github.js';
import { assertInsideProject } from '../utils/paths.js';

export type CheckOutputFormat = 'text' | 'json' | 'github';

export interface RunCheckOptions {
  projectRoot: string;
  json?: boolean;
  format?: CheckOutputFormat;
}

export interface RunCheckResult {
  report: CheckReport;
  exitCode: number;
}

export async function runCheck(options: RunCheckOptions): Promise<RunCheckResult> {
  const { projectRoot, json = false } = options;
  const format: CheckOutputFormat = options.format ?? (json ? 'json' : 'text');
  const config = await loadConfig(projectRoot);
  const catalogFormat = config.catalogFormat ?? 'flat';

  const scan = await scanProject(projectRoot, {
    ignorePatterns: config.ignore,
    rootDirs: config.rootDirs,
  });
  const extra = await scanAdditionalReferences(projectRoot, scan.scannedFiles);

  const messagesDir = await assertInsideProject(projectRoot, config.messagesDir);
  const sourceCatalog = await readCatalog(
    join(messagesDir, `${config.sourceLocale}.json`),
    catalogFormat,
  );
  const previousHashes = await readSourceHashes(messagesDir);
  const outdatedKeys = findOutdatedKeys(sourceCatalog, previousHashes);

  const targetCatalogs = Object.fromEntries(
    await Promise.all(
      config.targetLocales.map(
        async locale =>
          [locale, await readCatalog(join(messagesDir, `${locale}.json`), catalogFormat)] as const,
      ),
    ),
  );

  const report = buildCheckReport({
    sourceLocale: config.sourceLocale,
    strings: scan.strings,
    references: {
      literals: [...new Set([...scan.references.literals, ...extra.references.literals])],
      dynamic: scan.references.dynamic || extra.references.dynamic,
    },
    extraValues: extra.values,
    outdatedKeys,
    filesScanned: scan.filesScanned,
    parseErrors: scan.parseErrors,
    sourceCatalog,
    targetCatalogs,
  });

  if (format === 'json') {
    renderCheckJson(report);
  } else if (format === 'github') {
    renderCheckGithub(projectRoot, report, scan.strings);
  } else {
    renderCheckReport(projectRoot, report);
  }

  return { report, exitCode: report.ok ? 0 : 1 };
}
