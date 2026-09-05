/**
 * Rendu terminal du rapport `sync`.
 */

import { relative } from 'path';
import { logger } from '../utils/logger.js';
import type { SyncReport } from '../pipeline/sync.js';

const MAX_LIST = 15;

export function renderSyncReport(projectRoot: string, report: SyncReport): void {
  logger.success(
    `${report.detected.total} string${report.detected.total > 1 ? 's' : ''} détectée${report.detected.total > 1 ? 's' : ''} ` +
      `(${report.detected.safe} sûre${report.detected.safe > 1 ? 's' : ''}, ${report.detected.review} à revoir) ` +
      `dans ${report.filesScanned} fichier${report.filesScanned > 1 ? 's' : ''}`,
  );

  logger.success(
    `${report.sourceKeyCount} clé${report.sourceKeyCount > 1 ? 's' : ''} au catalogue source`,
  );
  if (report.addedKeys.length > 0) {
    logger.dim(
      `${report.addedKeys.length} nouvelle${report.addedKeys.length > 1 ? 's' : ''}, ${report.reusedKeys.length} réutilisée${report.reusedKeys.length > 1 ? 's' : ''}`,
    );
  }

  for (const result of report.translation.byLocale) {
    switch (result.status) {
      case 'updated':
        logger.success(
          `${result.locale} — ${result.translated} string${result.translated > 1 ? 's' : ''} traduite${result.translated > 1 ? 's' : ''}`,
        );
        if (result.error) {
          logger.warn(`${result.locale} — ${result.error.message}`);
        }
        break;
      case 'up_to_date':
        logger.dim(`${result.locale} — déjà à jour`);
        break;
      case 'failed':
        logger.warn(`${result.locale} — échec (${result.error?.kind}) : ${result.error?.message}`);
        break;
    }
  }

  if (report.prunedKeys.length > 0) {
    logger.dim(
      `${report.prunedKeys.length} clé${report.prunedKeys.length > 1 ? 's' : ''} orpheline${report.prunedKeys.length > 1 ? 's' : ''} retirée${report.prunedKeys.length > 1 ? 's' : ''} (--prune) : ${report.prunedKeys.join(', ')}`,
    );
  } else if (report.orphanedKeys.length > 0) {
    logger.warn(
      `${report.orphanedKeys.length} clé${report.orphanedKeys.length > 1 ? 's' : ''} orpheline${report.orphanedKeys.length > 1 ? 's' : ''} (texte disparu du code) — lancez "sync --prune" pour les retirer`,
    );
  }

  if (report.detected.review > 0) {
    logger.blank();
    logger.warn(
      `${report.detected.review} string${report.detected.review > 1 ? 's' : ''} à revoir manuellement (module-scope ou JSX ambigu)`,
    );
    for (const s of report.reviewStrings.slice(0, MAX_LIST)) {
      logger.dim(`  ${relative(projectRoot, s.file)}:${s.line} — "${s.value}" (${s.reviewReason})`);
    }
    if (report.reviewStrings.length > MAX_LIST) {
      logger.dim(`  ... et ${report.reviewStrings.length - MAX_LIST} autre(s)`);
    }
  }

  if (report.parseErrors.length > 0) {
    logger.warn(
      `${report.parseErrors.length} fichier${report.parseErrors.length > 1 ? 's' : ''} non parsable${report.parseErrors.length > 1 ? 's' : ''} (ignoré${report.parseErrors.length > 1 ? 's' : ''})`,
    );
  }

  logger.blank();
  if (report.translation.failed.length > 0) {
    logger.warn(`Synchronisation partielle — échec : ${report.translation.failed.join(', ')}`);
  } else {
    logger.success('Synchronisation terminée');
  }
}
