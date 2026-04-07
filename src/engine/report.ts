import { relative } from 'path';
import { logger } from '../utils/logger.js';
import type { AnalysisResult, ProjectRunResult } from './types.js';
import type { InjectAllResult } from '../injector/index.js';

const MAX_FILES_DISPLAY = 10;
const MAX_REWRITE_DISPLAY = 15;

function groupByFile(strings: Array<{ filePath: string }>): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const item of strings) {
    map.set(item.filePath, (map.get(item.filePath) ?? 0) + 1);
  }
  return [...map.entries()];
}

export function reportAnalysisSummary(projectRoot: string, analysis: AnalysisResult, noun = 'string'): void {
  if (analysis.selectedStrings.length === 0) {
    logger.warn('Aucune string traduisible trouvée — arrêt');
    return;
  }

  const grouped = groupByFile(analysis.selectedStrings);
  logger.success(
    `${analysis.selectedStrings.length} ${noun}${analysis.selectedStrings.length > 1 ? 's' : ''} trouvée${analysis.selectedStrings.length > 1 ? 's' : ''} dans ${grouped.length} fichier${grouped.length > 1 ? 's' : ''}`,
  );

  for (const [file, count] of grouped.slice(0, MAX_FILES_DISPLAY)) {
    logger.dim(`  ${relative(projectRoot, file).padEnd(60)} ${count} ${noun}${count > 1 ? 's' : ''}`);
  }
  if (grouped.length > MAX_FILES_DISPLAY) {
    const more = grouped.length - MAX_FILES_DISPLAY;
    logger.dim(`  ... et ${more} autre${more > 1 ? 's' : ''} fichier${more > 1 ? 's' : ''}`);
  }
}

export function reportInjectionResult(injResult: InjectAllResult): void {
  const ok = (msg: string) => logger.success(msg);
  const warn = (msg: string) => logger.warn(msg);

  if (injResult.config.ok) ok('next.config configuré');
  else if (injResult.config.error) warn(`next.config — ${injResult.config.error}`);

  if (injResult.middleware.ok) {
    if (injResult.middleware.warning) warn(injResult.middleware.warning);
    else ok('middleware.ts créé');
  } else if (injResult.middleware.error) warn(`middleware.ts — ${injResult.middleware.error}`);

  if (injResult.routing.ok) ok('i18n/routing.ts créé');
  else if (injResult.routing.error) warn(`i18n/routing.ts — ${injResult.routing.error}`);

  if (injResult.request.ok) ok('i18n/request.ts créé');
  else if (injResult.request.error) warn(`i18n/request.ts — ${injResult.request.error}`);

  if (injResult.switcher.ok) ok('LanguageSwitcher créé');
  else if (injResult.switcher.error) warn(`LanguageSwitcher — ${injResult.switcher.error}`);

  if (injResult.localeStructure.ok) ok('app/[locale]/ structuré');
  else if (injResult.localeStructure.error) warn(`app/[locale]/ — ${injResult.localeStructure.error}`);
}

export function reportRunResult(projectRoot: string, result: ProjectRunResult): void {
  const { plan, translationResult, rewriteResult, injectionResult } = result;

  if (result.status === 'partial') {
    logger.warn('Exécution partielle: certaines étapes nécessitent une vérification manuelle.');
  } else if (result.status === 'failed') {
    logger.error('Exécution échouée.');
  }

  logger.success(`${Object.keys(plan.messagesPlan.messages).length} clés générées → ${relative(projectRoot, plan.messagesPlan.outputPath)}`);
  if (plan.messagesPlan.newCount > 0) {
    logger.dim(`Dont ${plan.messagesPlan.newCount} nouvelle${plan.messagesPlan.newCount > 1 ? 's' : ''}`);
  }
  if (plan.messagesPlan.reusedKeys.length > 0) {
    logger.dim(`${plan.messagesPlan.reusedKeys.length} clé${plan.messagesPlan.reusedKeys.length > 1 ? 's' : ''} réutilisée${plan.messagesPlan.reusedKeys.length > 1 ? 's' : ''}`);
  }

  if (translationResult) {
    if (translationResult.totalTranslated > 0) {
      logger.success(`${translationResult.totalTranslated} strings traduites`);
    } else {
      logger.success('Toutes les traductions sont à jour');
    }
    if (translationResult.skipped.length > 0) {
      logger.dim(`Déjà à jour : ${translationResult.skipped.join(', ')}`);
    }
    if (translationResult.failed.length > 0) {
      logger.warn(`Échec traduction : ${translationResult.failed.join(', ')}`);
      for (const locale of translationResult.failed) {
        const reason = translationResult.failureReasons[locale];
        if (reason) logger.dim(`  ${locale} — ${reason}`);
      }
    }
  }

  if (rewriteResult) {
    const modifiedDetails = rewriteResult.details.filter(item => !item.skipped);
    for (const detail of modifiedDetails.slice(0, MAX_REWRITE_DISPLAY)) {
      const rel = relative(projectRoot, detail.filePath);
      if (detail.error) logger.warn(`${rel} — erreur: ${detail.error}`);
      else logger.success(`${rel} — ${detail.replaced} remplacement${detail.replaced > 1 ? 's' : ''}`);
    }
    if (modifiedDetails.length > MAX_REWRITE_DISPLAY) {
      const more = modifiedDetails.length - MAX_REWRITE_DISPLAY;
      logger.dim(`  ... et ${more} autre${more > 1 ? 's' : ''} fichier${more > 1 ? 's' : ''} modifié${more > 1 ? 's' : ''}`);
    }
    if (rewriteResult.filesModified > 0) {
      logger.success(
        `Total : ${rewriteResult.totalReplaced} remplacement${rewriteResult.totalReplaced > 1 ? 's' : ''} dans ${rewriteResult.filesModified} fichier${rewriteResult.filesModified > 1 ? 's' : ''}`,
      );
      logger.dim('Backups disponibles dans *.backup');
    }
    if (rewriteResult.moduleScopeStrings.length > 0) {
      logger.warn('Des strings module-scope n’ont pas été réécrites automatiquement.');
    }
  }

  if (injectionResult) {
    reportInjectionResult(injectionResult);
  }

  if (plan.rewritePlan.rewriteBlocked.length > 0) {
    logger.warn(`${plan.rewritePlan.rewriteBlocked.length} fichier${plan.rewritePlan.rewriteBlocked.length > 1 ? 's' : ''} avec réécriture bloquée par sécurité.`);
  }

  if (plan.injectionPlan.injectionBlocked.length > 0) {
    logger.warn(`Injection bloquée pour: ${plan.injectionPlan.injectionBlocked.join(', ')}`);
  }

  for (const step of result.stepLogs) {
    if (step.status === 'partial' || step.status === 'failed') {
      logger.dim(`[${step.step}] ${step.status} — ${step.message}`);
    }
  }

  for (const action of result.manualActions) {
    logger.warn(action);
  }
}
