/**
 * Rendu terminal (et JSON) du rapport `check`.
 */

import { relative } from 'path';
import { logger } from '../utils/logger.js';
import type { CheckReport } from '../core/check/index.js';

const MAX_LIST = 15;

export function renderCheckJson(report: CheckReport): void {
  console.log(JSON.stringify(report, null, 2));
}

export function renderCheckReport(projectRoot: string, report: CheckReport): void {
  logger.info(`${report.filesScanned} fichier${report.filesScanned > 1 ? 's' : ''} scanné${report.filesScanned > 1 ? 's' : ''}`);

  logger.info(
    `${report.detected.total} string${report.detected.total > 1 ? 's' : ''} traduisible${report.detected.total > 1 ? 's' : ''} détectée${report.detected.total > 1 ? 's' : ''} ` +
    `(${report.detected.safe} sûre${report.detected.safe > 1 ? 's' : ''}, ${report.detected.review} à revoir)`,
  );

  if (report.uncatalogued.length > 0) {
    logger.warn(`${report.uncatalogued.length} string${report.uncatalogued.length > 1 ? 's' : ''} non encore cataloguée${report.uncatalogued.length > 1 ? 's' : ''} — lancez "sync"`);
    for (const value of report.uncatalogued.slice(0, MAX_LIST)) {
      logger.dim(`  "${value}"`);
    }
    if (report.uncatalogued.length > MAX_LIST) {
      logger.dim(`  ... et ${report.uncatalogued.length - MAX_LIST} autre(s)`);
    }
  } else if (report.sourceKeyCount > 0) {
    logger.success('Catalogue source à jour avec le code');
  }

  if (report.sourceKeyCount > 0) {
    logger.info(`${report.sourceKeyCount} clé${report.sourceKeyCount > 1 ? 's' : ''} dans le catalogue source`);
  }

  for (const [locale, missing] of Object.entries(report.missingByLocale)) {
    if (missing.length === 0) {
      logger.success(`${locale} — complet`);
    } else {
      logger.warn(`${locale} — ${missing.length} clé${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''}`);
    }
  }

  if (report.parseErrors.length > 0) {
    logger.warn(`${report.parseErrors.length} fichier${report.parseErrors.length > 1 ? 's' : ''} non parsable${report.parseErrors.length > 1 ? 's' : ''} (ignoré${report.parseErrors.length > 1 ? 's' : ''})`);
    for (const file of report.parseErrors.slice(0, MAX_LIST)) {
      logger.dim(`  ${relative(projectRoot, file)}`);
    }
  }

  logger.blank();
  if (report.ok) {
    logger.success('Tout est à jour');
  } else {
    logger.warn('Travail en attente — voir ci-dessus');
  }
}
