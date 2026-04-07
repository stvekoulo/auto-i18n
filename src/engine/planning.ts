import { join, resolve } from 'path';
import { access, readFile } from 'fs/promises';
import { resolveMessages } from '../generator/index.js';
import type { AnalysisResult, InjectionPlan, ProjectPlan } from './types.js';
import { findLayoutFile } from '../injector/layout-injector.js';
import { findNextConfig } from '../injector/config-injector.js';
import { buildOccurrenceId } from '../scanner/string-extractor.js';

export interface PlanProjectChangesInput {
  projectRoot: string;
  analysis: AnalysisResult;
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  existingMessages?: Record<string, string>;
  apiKey?: string;
  shouldRewrite: boolean;
  shouldTranslate: boolean;
  shouldInject: boolean;
  switcherOnly?: boolean;
}

export interface BuildInjectionPlanInput {
  projectRoot: string;
  sourceLocale: string;
  targetLocales: string[];
  shouldInject: boolean;
  switcherOnly?: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildInjectionPlan(input: BuildInjectionPlanInput): Promise<InjectionPlan> {
  const { projectRoot, sourceLocale, targetLocales, shouldInject, switcherOnly = false } = input;
  const locales = [sourceLocale, ...targetLocales];
  const decisions: InjectionPlan['decisions'] = [];
  const injectionBlocked: string[] = [];

  if (!shouldInject && !switcherOnly) {
    decisions.push({
      target: 'all',
      status: 'blocked',
      message: 'Injection désactivée pour cette exécution.',
      reasonCode: 'disabled',
    });
    return {
      enabled: false,
      switcherOnly,
      locales,
      defaultLocale: sourceLocale,
      decisions,
      injectionBlocked,
    };
  }

  if (switcherOnly) {
    const layoutPath = await findLayoutFile(projectRoot);
    const switcherBlocked = !layoutPath;
    decisions.push({
      target: 'switcher',
      status: switcherBlocked ? 'blocked' : 'applicable',
      message: switcherBlocked
        ? 'layout.tsx introuvable pour injecter le LanguageSwitcher.'
        : 'LanguageSwitcher injectable automatiquement.',
      reasonCode: switcherBlocked ? 'layout_missing' : 'switcher_safe',
    });
    if (switcherBlocked) injectionBlocked.push('switcher');

    return {
      enabled: true,
      switcherOnly: true,
      locales,
      defaultLocale: sourceLocale,
      decisions,
      injectionBlocked,
    };
  }

  const layoutPath = await findLayoutFile(projectRoot);
  if (!layoutPath) {
    decisions.push({
      target: 'localeStructure',
      status: 'blocked',
      message: 'layout.tsx introuvable pour une injection sûre.',
      reasonCode: 'layout_missing',
    });
    injectionBlocked.push('localeStructure');
  } else {
    const layoutContent = await readFile(layoutPath, 'utf-8');
    const isComplexLayout = /export\s+const\s+metadata|<Script\b|dangerouslySetInnerHTML|suppressHydrationWarning/.test(layoutContent);
    decisions.push({
      target: 'localeStructure',
      status: isComplexLayout ? 'manual_required' : 'applicable',
      message: isComplexLayout
        ? 'Layout complexe détecté: restructuration automatique non garantie.'
        : 'Locale structure compatible avec une injection automatique.',
      reasonCode: isComplexLayout ? 'layout_complex' : 'layout_safe',
    });
    if (isComplexLayout) injectionBlocked.push('localeStructure');
  }

  const nextConfigPath = await findNextConfig(projectRoot);
  if (!nextConfigPath) {
    decisions.push({
      target: 'config',
      status: 'blocked',
      message: 'next.config introuvable.',
      reasonCode: 'next_config_missing',
    });
    injectionBlocked.push('config');
  } else {
    const nextConfigContent = await readFile(nextConfigPath, 'utf-8');
    const alreadyConfigured = nextConfigContent.includes('withNextIntl');
    decisions.push({
      target: 'config',
      status: alreadyConfigured ? 'already_present' : 'applicable',
      message: alreadyConfigured ? 'next.config déjà configuré.' : 'next.config compatible pour injection.',
      reasonCode: alreadyConfigured ? 'already_present' : 'config_safe',
    });
  }

  const middlewareExists = await fileExists(join(projectRoot, 'middleware.ts')) || await fileExists(join(projectRoot, 'proxy.ts'));
  decisions.push({
    target: 'middleware',
    status: middlewareExists ? 'already_present' : 'applicable',
    message: middlewareExists ? 'middleware/proxy déjà présent.' : 'middleware/proxy injectable automatiquement.',
    reasonCode: middlewareExists ? 'already_present' : 'middleware_safe',
  });

  const routingExists = await fileExists(join(projectRoot, 'i18n', 'routing.ts')) || await fileExists(join(projectRoot, 'src', 'i18n', 'routing.ts'));
  decisions.push({
    target: 'routing',
    status: routingExists ? 'already_present' : 'applicable',
    message: routingExists ? 'routing.ts déjà présent.' : 'routing.ts injectable automatiquement.',
    reasonCode: routingExists ? 'already_present' : 'routing_safe',
  });

  const requestExists = await fileExists(join(projectRoot, 'i18n', 'request.ts')) || await fileExists(join(projectRoot, 'src', 'i18n', 'request.ts'));
  decisions.push({
    target: 'request',
    status: requestExists ? 'already_present' : 'applicable',
    message: requestExists ? 'request.ts déjà présent.' : 'request.ts injectable automatiquement.',
    reasonCode: requestExists ? 'already_present' : 'request_safe',
  });

  const switcherExists = await fileExists(join(projectRoot, 'components', 'LanguageSwitcher.tsx')) || await fileExists(join(projectRoot, 'components', 'LanguageSwitcher.jsx'));
  decisions.push({
    target: 'switcher',
    status: switcherExists ? 'already_present' : 'applicable',
    message: switcherExists ? 'LanguageSwitcher déjà présent.' : 'LanguageSwitcher injectable automatiquement.',
    reasonCode: switcherExists ? 'already_present' : 'switcher_safe',
  });

  return {
    enabled: shouldInject || switcherOnly,
    switcherOnly,
    locales,
    defaultLocale: sourceLocale,
    decisions,
    injectionBlocked,
  };
}

export async function planProjectChanges(input: PlanProjectChangesInput): Promise<ProjectPlan> {
  const {
    analysis,
    sourceLocale,
    targetLocales,
    messagesDir,
    existingMessages = {},
    apiKey,
    shouldRewrite,
    shouldTranslate,
    shouldInject,
    switcherOnly = false,
  } = input;

  const resolvedMessages = resolveMessages(analysis.selectedStrings, existingMessages);
  const filePaths = [...new Set(analysis.selectedStrings.map(item => item.filePath))];
  const injectionPlan = await buildInjectionPlan(input);
  const existingValues = new Set(Object.values(existingMessages));
  const newKeys = [...resolvedMessages.keyMap.entries()]
    .filter(([value]) => !existingValues.has(value))
    .map(([, key]) => key);
  const reusedKeys = [...resolvedMessages.keyMap.entries()]
    .filter(([value]) => existingValues.has(value))
    .map(([, key]) => key);
  const unsafeIds = new Set(
    analysis.candidates
      .filter(item => item.status === 'unsafe_to_rewrite')
      .map(item => buildOccurrenceId(item)),
  );
  const rewriteBlocked = analysis.candidates
    .filter(item => item.status === 'unsafe_to_rewrite' || item.status === 'module_scope')
    .map(item => item.filePath);
  const manualActions = [
    ...(analysis.summary.moduleScopeCount > 0 ? ['Des strings module-scope nécessitent une intégration manuelle.'] : []),
    ...(analysis.candidates.some(item => unsafeIds.has(buildOccurrenceId(item))) ? ['Certaines strings JSX ambiguës ont été exclues de la réécriture automatique.'] : []),
    ...injectionPlan.decisions
      .filter(item => item.status === 'manual_required')
      .map(item => item.message),
  ];

  return {
    analysis,
    messagesPlan: {
      ...resolvedMessages,
      outputPath: join(resolve(messagesDir), `${sourceLocale}.json`),
      filePaths,
      newKeys,
      reusedKeys,
    },
    translationPlan: {
      sourceLocale,
      targetLocales,
      messagesDir,
      apiKey,
      enabled: shouldTranslate,
      translationTargets: shouldTranslate ? targetLocales : [],
    },
    rewritePlan: {
      filePaths,
      enabled: shouldRewrite,
      rewriteTargets: shouldRewrite ? filePaths : [],
      rewriteBlocked: [...new Set(rewriteBlocked)],
    },
    injectionPlan,
    manualActions,
  };
}
