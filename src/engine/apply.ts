import { writeMessages } from '../generator/index.js';
import { rewriteFiles } from '../rewriter/index.js';
import { translateMessages } from '../translator/index.js';
import {
  injectLanguageSwitcher,
  injectLocaleStructure,
  injectMiddleware,
  injectNextConfig,
  injectRequest,
  injectRouting,
  type InjectAllResult,
} from '../injector/index.js';
import type {
  InjectionDecision,
  InjectionPlan,
  ProjectPlan,
  ProjectRunResult,
} from './types.js';

type InjectionTarget = Exclude<InjectionDecision['target'], 'all'>;

interface ApplyInjectionPlanResult {
  injectionResult: InjectAllResult;
  status: ProjectRunResult['status'];
  manualActions: string[];
}

function createEmptyInjectionResult(): InjectAllResult {
  return {
    config: { ok: false, skipped: true },
    middleware: { ok: false, skipped: true },
    routing: { ok: false, skipped: true },
    request: { ok: false, skipped: true },
    switcher: { ok: false, skipped: true },
    localeStructure: { ok: false, skipped: true },
  };
}

function uniqueManualActions(actions: string[]): string[] {
  return [...new Set(actions)];
}

function toInjectAllKey(target: InjectionTarget): keyof InjectAllResult {
  return target;
}

function createDecisionMap(plan: InjectionPlan): Map<InjectionTarget, InjectionDecision> {
  return new Map(
    plan.decisions
      .filter((decision): decision is InjectionDecision & { target: InjectionTarget } => decision.target !== 'all')
      .map(decision => [decision.target, decision]),
  );
}

async function applyApplicableInjectionTarget(
  target: InjectionTarget,
  plan: InjectionPlan,
  projectRoot: string,
  injectionResult: InjectAllResult,
): Promise<void> {
  switch (target) {
    case 'config': {
      const result = await injectNextConfig(projectRoot, { silent: true });
      injectionResult.config = { ok: true, skipped: result.skipped };
      return;
    }
    case 'middleware': {
      const result = await injectMiddleware(projectRoot, { silent: true });
      injectionResult.middleware = { ok: true, skipped: result.skipped, warning: result.warning };
      return;
    }
    case 'routing': {
      const result = await injectRouting(projectRoot, {
        locales: plan.locales,
        defaultLocale: plan.defaultLocale,
      }, { silent: true });
      injectionResult.routing = { ok: true, skipped: result.skipped };
      return;
    }
    case 'request': {
      const result = await injectRequest(projectRoot, { silent: true });
      injectionResult.request = { ok: true, skipped: result.skipped };
      return;
    }
    case 'switcher': {
      const result = await injectLanguageSwitcher(projectRoot, { silent: true });
      injectionResult.switcher = { ok: true, skipped: result.skipped };
      return;
    }
    case 'localeStructure': {
      const result = await injectLocaleStructure(projectRoot, plan.locales, plan.defaultLocale, { silent: true });
      injectionResult.localeStructure = { ok: true, skipped: result.skipped };
      return;
    }
  }
}

export async function applyInjectionPlan(
  plan: InjectionPlan,
  projectRoot: string,
): Promise<ApplyInjectionPlanResult> {
  const decisionMap = createDecisionMap(plan);
  const manualActions: string[] = [];
  const injectionResult = createEmptyInjectionResult();
  let status: ProjectRunResult['status'] = 'success';

  const targets: InjectionTarget[] = plan.switcherOnly
    ? ['switcher']
    : ['config', 'middleware', 'routing', 'request', 'switcher', 'localeStructure'];

  for (const target of targets) {
    const decision = decisionMap.get(target);
    const resultKey = toInjectAllKey(target);

    if (!decision) {
      injectionResult[resultKey] = { ok: false, skipped: true, error: 'Aucun plan d’injection disponible.' };
      manualActions.push(`Aucun plan d’injection disponible pour ${target}.`);
      status = 'partial';
      continue;
    }

    if (decision.status === 'already_present') {
      injectionResult[resultKey] = { ok: true, skipped: true };
      continue;
    }

    if (decision.status === 'blocked' || decision.status === 'manual_required') {
      injectionResult[resultKey] = { ok: false, skipped: true, error: decision.message };
      manualActions.push(decision.message);
      status = 'partial';
      continue;
    }

    try {
      await applyApplicableInjectionTarget(target, plan, projectRoot, injectionResult);
    } catch (err) {
      injectionResult[resultKey] = {
        ok: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
      };
      manualActions.push(`Injection ${target} à vérifier manuellement.`);
      status = 'partial';
    }
  }

  return {
    injectionResult,
    status,
    manualActions: uniqueManualActions(manualActions),
  };
}

export async function applyProjectChanges(plan: ProjectPlan, projectRoot: string): Promise<ProjectRunResult> {
  const diagnostics = [...plan.analysis.diagnostics];
  const modifiedFiles: string[] = [];
  const manualActions: string[] = [...plan.manualActions];
  const stepLogs: ProjectRunResult['stepLogs'] = [];
  let status: ProjectRunResult['status'] = 'success';

  const outputPath = await writeMessages(
    plan.translationPlan.sourceLocale,
    plan.translationPlan.messagesDir,
    plan.messagesPlan,
  );
  modifiedFiles.push(outputPath);
  stepLogs.push({
    step: 'messages',
    status: 'success',
    message: `Messages source écrits dans ${outputPath}`,
  });

  let translationResult;
  if (plan.translationPlan.enabled) {
    try {
      translationResult = await translateMessages({
        sourceLocale: plan.translationPlan.sourceLocale,
        targetLocales: plan.translationPlan.targetLocales,
        messagesDir: plan.translationPlan.messagesDir,
        apiKey: plan.translationPlan.apiKey,
      });
      if (translationResult.failed.length > 0) {
        status = 'partial';
        stepLogs.push({
          step: 'translation',
          status: 'partial',
          message: `Traduction partielle: échec sur ${translationResult.failed.join(', ')}`,
        });
        manualActions.push('Certaines locales n’ont pas pu être traduites automatiquement.');
      } else {
        stepLogs.push({
          step: 'translation',
          status: 'success',
          message: 'Traductions générées avec succès.',
        });
      }
    } catch (err) {
      status = modifiedFiles.length > 0 ? 'partial' : 'failed';
      stepLogs.push({
        step: 'translation',
        status: modifiedFiles.length > 0 ? 'partial' : 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
      manualActions.push('La traduction nécessite une vérification manuelle.');
    }
  } else {
    stepLogs.push({
      step: 'translation',
      status: 'skipped',
      message: 'Traduction désactivée pour cette exécution.',
    });
  }

  let rewriteResult;
  if (plan.rewritePlan.enabled && plan.rewritePlan.filePaths.length > 0) {
    try {
      rewriteResult = await rewriteFiles(plan.rewritePlan.filePaths, {
        keyMap: plan.messagesPlan.keyMap,
        silent: true,
      });
      modifiedFiles.push(...rewriteResult.details.filter(item => !item.skipped).map(item => item.filePath));
      if (rewriteResult.details.some(item => !!item.error)) {
        status = 'partial';
        stepLogs.push({
          step: 'rewrite',
          status: 'partial',
          message: 'Réécriture partielle: certains fichiers ont été ignorés ou ont échoué.',
        });
      } else if (rewriteResult.filesModified === 0) {
        stepLogs.push({
          step: 'rewrite',
          status: 'skipped',
          message: 'Aucun fichier à réécrire automatiquement.',
        });
      } else {
        stepLogs.push({
          step: 'rewrite',
          status: 'success',
          message: `${rewriteResult.filesModified} fichier(s) réécrit(s).`,
        });
      }
      if (rewriteResult.moduleScopeStrings.length > 0) {
        status = 'partial';
        manualActions.push('Des strings module-scope nécessitent une intégration manuelle.');
      }
    } catch (err) {
      status = 'partial';
      stepLogs.push({
        step: 'rewrite',
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
      manualActions.push('La réécriture automatique nécessite une vérification manuelle.');
    }
  } else {
    stepLogs.push({
      step: 'rewrite',
      status: 'skipped',
      message: 'Réécriture désactivée pour cette exécution.',
    });
  }

  let injectionResult;
  if (plan.injectionPlan.enabled) {
    try {
      const injectionApplyResult = await applyInjectionPlan(plan.injectionPlan, projectRoot);
      injectionResult = injectionApplyResult.injectionResult;
      if (injectionApplyResult.status === 'partial') {
        status = 'partial';
      }
      manualActions.push(...injectionApplyResult.manualActions);
    } catch (err) {
      injectionResult = createEmptyInjectionResult();
      status = 'partial';
      manualActions.push('Certaines injections Next.js nécessitent une vérification manuelle.');
      stepLogs.push({
        step: 'injection',
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (!stepLogs.some(step => step.step === 'injection')) {
      stepLogs.push({
        step: 'injection',
        status: Object.values(injectionResult).some(item => !item.ok && !!item.error) ? 'partial' : 'success',
        message: 'Injection Next.js exécutée.',
      });
    }
  } else {
    stepLogs.push({
      step: 'injection',
      status: 'skipped',
      message: 'Injection désactivée pour cette exécution.',
    });
  }

  return {
    status,
    plan,
    messagesWritten: true,
    translationResult,
    rewriteResult,
    injectionResult,
    diagnostics,
    modifiedFiles,
    manualActions: uniqueManualActions(manualActions),
    stepLogs,
  };
}
