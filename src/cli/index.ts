#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join, relative } from 'path';
import { readFile, access } from 'fs/promises';
import { logger } from '../utils/logger.js';
import { loadConfig, saveConfig, buildConfig, findMissingKeys, CONFIG_FILENAME } from '../utils/config.js';
import { loadEnv, getApiKey, saveApiKeyToEnv, ensureGitignore } from '../utils/env.js';
import { isPackageInstalled } from '../utils/deps.js';
import { askSourceLocale, askTargetLocales, askApiKey, askConfirmDryRun } from './prompts.js';
import { translateMessages } from '../translator/index.js';
import { generateDoc, type FileDocEntry } from './doc-generator.js';
import {
  analyzeProject,
  applyInjectionPlan,
  applyProjectChanges,
  buildInjectionPlan,
  planProjectChanges,
  reportAnalysisSummary,
  reportInjectionResult,
  reportRunResult,
  type AnalysisResult,
} from '../engine/index.js';

async function readExistingMessages(
  messagesDir: string,
  sourceLocale: string,
): Promise<Record<string, string>> {
  const sourcePath = join(resolve(messagesDir), `${sourceLocale}.json`);
  try {
    return JSON.parse(await readFile(sourcePath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function buildGuideEntries(
  projectRoot: string,
  analysis: AnalysisResult,
): FileDocEntry[] {
  const entries: FileDocEntry[] = [];

  for (const [filePath, fileStrings] of analysis.stringsByFile) {
    const relevantStrings = fileStrings.filter(s =>
      analysis.selectedStrings.some(selected =>
        selected.filePath === s.filePath &&
        selected.line === s.line &&
        selected.column === s.column &&
        selected.value === s.value,
      ),
    );
    if (relevantStrings.length === 0) continue;

    const moduleScopeValues = new Set(
      analysis.moduleScopeOccurrences
        .filter(item => item.filePath === filePath)
        .map(item => item.value),
    );

    entries.push({
      filePath,
      relPath: relative(projectRoot, filePath),
      strings: relevantStrings,
      moduleScopeValues,
    });
  }

  return entries;
}

const program = new Command();

program
  .name('next-auto-i18n')
  .description("Automatise l'internationalisation d'un projet React / Next.js")
  .version('0.7.3');

program
  .command('init')
  .description("Initialise l'i18n : scan, traduction et réécriture du projet")
  .option('--dry-run', 'Prévisualise les changements sans modifier les fichiers')
  .option('--locale <locales>', 'Langues cibles (séparées par des virgules)')
  .action(async (options: { dryRun?: boolean; locale?: string }) => {
    const projectRoot = process.cwd();

    try {
      // 1. Configuration interactive
      logger.step('Configuration');

      const sourceLocale = await askSourceLocale();
      const targetLocales = options.locale
        ? options.locale.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== sourceLocale)
        : await askTargetLocales(sourceLocale);

      if (targetLocales.length === 0) {
        logger.error('Aucune langue cible valide');
        process.exit(1);
      }

      // Clé API
      loadEnv(projectRoot);
      let apiKey = getApiKey('AUTO_I18N_DEEPL_KEY');

      if (!apiKey) {
        apiKey = await askApiKey();
        await saveApiKeyToEnv(projectRoot, 'AUTO_I18N_DEEPL_KEY', apiKey);
        logger.success('Clé API sauvegardée dans .env.local');
      }

      // .gitignore
      const added = await ensureGitignore(projectRoot, ['.env.local', '*.backup']);
      if (added.length > 0) {
        logger.success(`.gitignore mis à jour (${added.join(', ')})`);
      }

      // Sauvegarder config
      const config = buildConfig(sourceLocale, targetLocales);
      await saveConfig(projectRoot, config);
      logger.success(`${CONFIG_FILENAME} créé`);

      logger.step('Scan du projet');
      const analysis = await analyzeProject({
        projectRoot,
        ignorePatterns: config.ignore,
        includeModuleScope: true,
      });

      if (analysis.selectedStrings.length === 0) {
        logger.warn('Aucune string traduisible trouvée — arrêt');
        return;
      }

      reportAnalysisSummary(projectRoot, analysis);

      const plan = await planProjectChanges({
        projectRoot,
        analysis,
        sourceLocale,
        targetLocales,
        messagesDir: config.messagesDir,
        apiKey,
        shouldRewrite: true,
        shouldTranslate: true,
        shouldInject: true,
      });

      const keyCount = Object.keys(plan.messagesPlan.messages).length;

      // Dry-run : montrer un aperçu et demander confirmation
      if (options.dryRun) {
        const fileDetails = [...analysis.stringsByFile.entries()].map(([filePath, fileStrings]) => ({
          filePath: relative(projectRoot, filePath),
          stringCount: fileStrings.length,
        }));
        const sampleKeys = Object.entries(plan.messagesPlan.messages)
          .slice(0, 5)
          .map(([key, value]) => ({ value, key }));

        const proceed = await askConfirmDryRun({
          stringsFound: analysis.selectedStrings.length,
          keysGenerated: keyCount,
          filesToRewrite: plan.rewritePlan.filePaths.length,
          targetLocales,
          fileDetails,
          sampleKeys,
          messagesPath: join(config.messagesDir, `${sourceLocale}.json`),
        });
        if (!proceed) {
          logger.warn('Abandon');
          return;
        }
      }

      logger.step('Vérification des dépendances');
      const hasNextIntl = await isPackageInstalled(projectRoot, 'next-intl');
      if (!hasNextIntl) {
        logger.warn('next-intl non trouvé — il devrait être installé automatiquement via peerDependencies');
        logger.dim('Si ce n\'est pas le cas, installez manuellement : npm install next-intl');
      } else {
        logger.success('next-intl installé');
      }

      const result = await applyProjectChanges(plan, projectRoot);
      reportRunResult(projectRoot, result);

      logger.blank();
      logger.success('Internationalisation configurée avec succès !');
      logger.dim(`Langues : ${sourceLocale} → ${targetLocales.join(', ')}`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Rescanne le projet, intègre les nouvelles strings et synchronise les traductions')
  .action(async () => {
    const projectRoot = process.cwd();

    try {
      const config = await loadConfig(projectRoot);
      loadEnv(projectRoot);
      const apiKey = getApiKey(config.apiKeyEnv);

      if (!apiKey) {
        logger.error(`Clé API introuvable (${config.apiKeyEnv}). Lancez "next-auto-i18n init" d'abord.`);
        process.exit(1);
      }

      const sourcePath = join(resolve(config.messagesDir), `${config.sourceLocale}.json`);

      try {
        await access(sourcePath);
      } catch {
        logger.error(`Fichier source introuvable : ${relative(projectRoot, sourcePath)}`);
        logger.dim('Lancez "next-auto-i18n init" d\'abord.');
        process.exit(1);
      }

      const existingMessages = await readExistingMessages(config.messagesDir, config.sourceLocale);

      const existingCount = Object.keys(existingMessages).length;
      logger.info(`${existingCount} clé${existingCount > 1 ? 's' : ''} existante${existingCount > 1 ? 's' : ''} dans ${config.sourceLocale}.json`);

      logger.step('Scan du projet');
      const analysis = await analyzeProject({
        projectRoot,
        ignorePatterns: config.ignore,
        existingMessages,
        includeModuleScope: true,
      });

      if (analysis.selectedStrings.length > 0) {
        reportAnalysisSummary(projectRoot, analysis);
      } else {
        logger.success('Toutes les strings sont déjà internationalisées');
      }

      const plan = await planProjectChanges({
        projectRoot,
        analysis,
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        messagesDir: config.messagesDir,
        existingMessages,
        apiKey,
        shouldRewrite: true,
        shouldTranslate: true,
        shouldInject: false,
      });

      const result = await applyProjectChanges(plan, projectRoot);
      reportRunResult(projectRoot, result);

      logger.blank();
      logger.success('Synchronisation terminée');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('add-locale <locale>')
  .description('Ajoute une nouvelle langue cible (ex: auto-i18n add-locale ar)')
  .action(async (locale: string) => {
    const projectRoot = process.cwd();

    try {
      const config = await loadConfig(projectRoot);
      loadEnv(projectRoot);
      const apiKey = getApiKey(config.apiKeyEnv);

      if (!apiKey) {
        logger.error(`Clé API introuvable (${config.apiKeyEnv}). Lancez "auto-i18n init" d'abord.`);
        process.exit(1);
      }

      const normalizedLocale = locale.trim().toLowerCase();

      if (config.targetLocales.includes(normalizedLocale)) {
        logger.warn(`${normalizedLocale} est déjà dans les langues cibles`);
        return;
      }

      config.targetLocales.push(normalizedLocale);
      await saveConfig(projectRoot, config);
      logger.success(`${normalizedLocale} ajouté à ${CONFIG_FILENAME}`);

      // Traduire
      logger.step(`Traduction vers ${normalizedLocale.toUpperCase()}`);
      const transResult = await translateMessages({
        sourceLocale: config.sourceLocale,
        targetLocales: [normalizedLocale],
        messagesDir: config.messagesDir,
        apiKey,
      });
      logger.success(`${transResult.totalTranslated} strings traduites`);
      logger.dim(`Fichier créé : ${join(config.messagesDir, `${normalizedLocale}.json`)}`);

      const allLocales = [config.sourceLocale, ...config.targetLocales];
      logger.step('Mise à jour de la configuration Next.js');
      const injectionPlan = await buildInjectionPlan({
        projectRoot,
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        shouldInject: true,
      });
      const injectionApplyResult = await applyInjectionPlan(injectionPlan, projectRoot);
      reportInjectionResult(injectionApplyResult.injectionResult);
      for (const action of injectionApplyResult.manualActions) {
        logger.warn(action);
      }

      if (injectionApplyResult.status === 'partial') {
        logger.warn('Configuration Next.js mise à jour partiellement.');
      } else {
        logger.success(`Langues actives : ${allLocales.join(', ')}`);
      }
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('missing')
  .description('Affiche les strings non traduites dans les fichiers de messages')
  .action(async () => {
    const projectRoot = process.cwd();

    try {
      const config = await loadConfig(projectRoot);
      const messagesDir = resolve(config.messagesDir);
      const sourcePath = join(messagesDir, `${config.sourceLocale}.json`);

      let source: Record<string, string>;
      try {
        await access(sourcePath);
        source = JSON.parse(await readFile(sourcePath, 'utf-8'));
      } catch {
        logger.error(`Fichier source introuvable : ${sourcePath}`);
        logger.dim('Lancez "auto-i18n init" d\'abord.');
        process.exit(1);
      }

      const sourceKeys = Object.keys(source);
      logger.info(`${sourceKeys.length} clé${sourceKeys.length > 1 ? 's' : ''} dans ${config.sourceLocale}.json`);
      let totalMissing = 0;

      for (const locale of config.targetLocales) {
        const targetPath = join(messagesDir, `${locale}.json`);
        let target: Record<string, string> = {};

        try {
          await access(targetPath);
          target = JSON.parse(await readFile(targetPath, 'utf-8'));
        } catch {
          logger.warn(`${locale}.json introuvable — toutes les clés manquent`);
          totalMissing += sourceKeys.length;
          continue;
        }

        const missing = findMissingKeys(source, target);
        if (missing.length > 0) {
          logger.warn(`${locale} — ${missing.length} clé${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''} / ${sourceKeys.length}`);
          for (const key of missing) {
            logger.dim(`  ${key}`);
          }
          totalMissing += missing.length;
        } else {
          logger.success(`${locale} — complet (${sourceKeys.length} clés)`);
        }
      }

      logger.blank();
      if (totalMissing === 0) {
        logger.success('Toutes les traductions sont complètes');
      } else {
        logger.info(`${totalMissing} clé${totalMissing > 1 ? 's' : ''} manquante${totalMissing > 1 ? 's' : ''} au total`);
        logger.dim('Lancez "auto-i18n sync" pour les traduire.');
      }
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const extractCmd = program
  .command('extract')
  .description("Extrait et traduit les strings — génère un guide d'intégration sans modifier les fichiers source")
  .option('--locale <locales>', 'Langues cibles (séparées par des virgules)')
  .option('--out <path>', 'Chemin du guide Markdown (défaut: i18n-guide.md)')
  .option('--inject', 'Configure next.config, middleware.ts, i18n/routing.ts, i18n/request.ts et app/[locale]/')
  .option('--switcher', 'Injecte uniquement le Language Switcher flottant (sans --inject)')
  .option('--no-module-scope', 'Exclut les strings dans les const module-scope de la détection et de la traduction')
  .action(async (options: { locale?: string; out?: string; inject?: boolean; switcher?: boolean; moduleScope: boolean }) => {
    const projectRoot = process.cwd();

    try {
      // 1. Configuration
      logger.step('Configuration');
      let config;
      let apiKey: string | undefined;
      try {
        config = await loadConfig(projectRoot);
        loadEnv(projectRoot);
        apiKey = getApiKey(config.apiKeyEnv);
        logger.success(`Configuration chargée (${config.sourceLocale} → ${config.targetLocales.join(', ')})`);
      } catch {
        const sourceLocale = await askSourceLocale();
        const targetLocales = options.locale
          ? options.locale.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== sourceLocale)
          : await askTargetLocales(sourceLocale);

        if (targetLocales.length === 0) {
          logger.error('Aucune langue cible valide');
          process.exit(1);
        }

        loadEnv(projectRoot);
        apiKey = getApiKey('AUTO_I18N_DEEPL_KEY');
        if (!apiKey) {
          apiKey = await askApiKey();
          await saveApiKeyToEnv(projectRoot, 'AUTO_I18N_DEEPL_KEY', apiKey);
          logger.success('Clé API sauvegardée dans .env.local');
        }

        config = buildConfig(sourceLocale, targetLocales);
      }

      if (!apiKey) {
        logger.error(`Clé API introuvable (${config!.apiKeyEnv}). Ajoutez-la dans .env.local.`);
        process.exit(1);
      }

      logger.step('Scan du projet');
      const existingMessages = await readExistingMessages(config.messagesDir, config.sourceLocale);
      if (Object.keys(existingMessages).length > 0) {
        logger.dim(`${Object.keys(existingMessages).length} clé${Object.keys(existingMessages).length > 1 ? 's' : ''} existante${Object.keys(existingMessages).length > 1 ? 's' : ''} chargées`);
      }

      const analysis = await analyzeProject({
        projectRoot,
        ignorePatterns: config.ignore,
        existingMessages,
        includeModuleScope: options.moduleScope,
      });

      if (analysis.selectedStrings.length === 0 && Object.keys(existingMessages).length === 0) {
        logger.warn('Aucune string traduisible trouvée — arrêt');
        return;
      }

      if (analysis.selectedStrings.length > 0) {
        reportAnalysisSummary(projectRoot, analysis);
      }

      const plan = await planProjectChanges({
        projectRoot,
        analysis,
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        messagesDir: config.messagesDir,
        existingMessages,
        apiKey,
        shouldRewrite: false,
        shouldTranslate: true,
        shouldInject: Boolean(options.inject),
        switcherOnly: Boolean(options.switcher && !options.inject),
      });

      const result = await applyProjectChanges(plan, projectRoot);
      reportRunResult(projectRoot, result);

      // 8. Génération du guide Markdown
      logger.step('Génération du guide');
      const outputPath = resolve(options.out ?? 'i18n-guide.md');
      const date = new Date().toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

      await generateDoc({
        projectRoot,
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        messagesDir: config.messagesDir,
        keyMap: plan.messagesPlan.keyMap,
        files: buildGuideEntries(projectRoot, analysis),
        outputPath,
        date,
      });

      if (analysis.moduleScopeOccurrences.length > 0) {
        logger.warn(`${analysis.moduleScopeOccurrences.length} string${analysis.moduleScopeOccurrences.length > 1 ? 's' : ''} module-scope détectée${analysis.moduleScopeOccurrences.length > 1 ? 's' : ''} (action manuelle requise — voir guide)`);
      }

      logger.success(`Guide généré : ${relative(projectRoot, outputPath)}`);
      logger.blank();
      logger.success('Extraction terminée — aucun fichier source modifié');
      logger.dim('Consultez le guide pour intégrer les traductions manuellement.');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

extractCmd
  .command('sync')
  .description('Rescanne le projet, intègre les nouvelles strings et synchronise les traductions — sans modifier les fichiers source')
  .option('--inject', 'Configure next.config, middleware.ts, i18n/routing.ts, i18n/request.ts et app/[locale]/')
  .option('--switcher', 'Injecte uniquement le Language Switcher flottant (sans --inject)')
  .option('--no-module-scope', 'Exclut les strings dans les const module-scope de la détection et de la traduction')
  .action(async (options: { inject?: boolean; switcher?: boolean; moduleScope: boolean }) => {
    const projectRoot = process.cwd();

    try {
      const config = await loadConfig(projectRoot);
      loadEnv(projectRoot);
      const apiKey = getApiKey(config.apiKeyEnv);

      if (!apiKey) {
        logger.error(`Clé API introuvable (${config.apiKeyEnv}). Lancez "next-auto-i18n init" d'abord.`);
        process.exit(1);
      }

      const sourcePath = join(resolve(config.messagesDir), `${config.sourceLocale}.json`);

      try {
        await access(sourcePath);
      } catch {
        logger.error(`Fichier source introuvable : ${relative(projectRoot, sourcePath)}`);
        logger.dim('Lancez "next-auto-i18n init" ou "next-auto-i18n extract" d\'abord.');
        process.exit(1);
      }

      const existingMessages = await readExistingMessages(config.messagesDir, config.sourceLocale);

      const existingCount = Object.keys(existingMessages).length;
      logger.info(`${existingCount} clé${existingCount > 1 ? 's' : ''} existante${existingCount > 1 ? 's' : ''} dans ${config.sourceLocale}.json`);

      logger.step('Scan du projet');
      const analysis = await analyzeProject({
        projectRoot,
        ignorePatterns: config.ignore,
        existingMessages,
        includeModuleScope: options.moduleScope,
      });

      if (analysis.selectedStrings.length > 0) {
        reportAnalysisSummary(projectRoot, analysis);
        logger.dim('Mode extract — les fichiers source ne seront pas modifiés');
      } else {
        logger.success('Toutes les strings sont déjà dans les fichiers de traduction');
      }

      const plan = await planProjectChanges({
        projectRoot,
        analysis,
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        messagesDir: config.messagesDir,
        existingMessages,
        apiKey,
        shouldRewrite: false,
        shouldTranslate: true,
        shouldInject: Boolean(options.inject),
        switcherOnly: Boolean(options.switcher && !options.inject),
      });

      const result = await applyProjectChanges(plan, projectRoot);
      reportRunResult(projectRoot, result);

      logger.blank();
      logger.success('Synchronisation terminée — aucun fichier source modifié');
      logger.dim('Lancez "next-auto-i18n extract" pour générer le guide d\'intégration complet.');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
