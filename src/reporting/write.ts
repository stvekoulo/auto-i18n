/**
 * Rendu terminal du rapport `sync --write` : résumé + aperçu diff en dry-run.
 */

import { relative } from 'path';
import chalk from 'chalk';
import { diffLines } from 'diff';
import { logger } from '../utils/logger.js';
import type { WriteReport, FileWriteOutcome } from '../pipeline/write.js';
import type { WriteSkipReason } from '../core/write/index.js';

const MAX_FILES_SHOWN = 10;

const SKIP_LABELS: Record<WriteSkipReason, string> = {
  no_host: 'aucune fonction composant/hook identifiable',
  server_not_async: 'composant serveur non-async (câblage manuel requis)',
  t_conflict: '`t` déjà utilisé pour autre chose dans ce scope',
  concise_body: 'fonction fléchée à corps concis (pas de bloc `{ }`)',
};

function printDiff(before: string, after: string): void {
  for (const part of diffLines(before, after)) {
    const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.dim;
    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    if (!part.added && !part.removed) continue; // n'affiche que les lignes changées
    for (const line of part.value.split('\n')) {
      if (line.length === 0) continue;
      console.log(color(`    ${prefix} ${line}`));
    }
  }
}

function printSkips(file: FileWriteOutcome, projectRoot: string): void {
  logger.dim(
    `  ${relative(projectRoot, file.file)} — 0 câblée(s), ${file.skipped.length} ignorée(s)`,
  );
  for (const skip of file.skipped.slice(0, 3)) {
    logger.dim(`    L${skip.line} "${skip.value}" — ${SKIP_LABELS[skip.reason]}`);
  }
}

export function renderWriteReport(projectRoot: string, report: WriteReport): void {
  logger.blank();
  logger.step(report.dryRun ? 'Câblage automatique (dry-run)' : 'Câblage automatique');

  if (report.stringsWritten === 0 && report.stringsSkipped === 0) {
    logger.dim('  Rien à câbler automatiquement.');
    return;
  }

  const verb = report.dryRun ? 'seraient câblée(s)' : 'câblée(s)';
  logger.success(
    `${report.stringsWritten} string(s) ${verb} dans ${report.filesChanged} fichier(s)`,
  );
  if (report.stringsSkipped > 0) {
    logger.warn(
      `${report.stringsSkipped} string(s) safe laissée(s) au guide (fonction hôte ambiguë ou serveur non-async)`,
    );
  }

  const changed = report.files.filter(f => f.written > 0);
  const skippedOnly = report.files.filter(f => f.written === 0 && f.skipped.length > 0);

  for (const file of changed.slice(0, MAX_FILES_SHOWN)) {
    logger.blank();
    logger.info(`${relative(projectRoot, file.file)} — ${file.written} câblée(s)`);
    if (report.dryRun) printDiff(file.before, file.after);
  }
  if (changed.length > MAX_FILES_SHOWN) {
    logger.dim(`  ... et ${changed.length - MAX_FILES_SHOWN} autre(s) fichier(s) modifié(s)`);
  }

  if (skippedOnly.length > 0) {
    logger.blank();
    for (const file of skippedOnly.slice(0, MAX_FILES_SHOWN)) {
      printSkips(file, projectRoot);
    }
  }

  if (!report.dryRun && changed.length > 0) {
    logger.blank();
    logger.dim('  Chaque fichier modifié a une sauvegarde .backup à côté.');
  }
}
