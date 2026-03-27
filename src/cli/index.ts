#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join } from 'path';
import { readFile, access } from 'fs/promises';
import { logger } from '../utils/logger.js';
import { loadConfig, saveConfig, buildConfig, findMissingKeys, CONFIG_FILENAME } from '../utils/config.js';
import { loadEnv, getApiKey, saveApiKeyToEnv, ensureGitignore } from '../utils/env.js';
import { isPackageInstalled } from '../utils/deps.js';
import { askSourceLocale, askTargetLocales, askApiKey, askConfirmDryRun } from './prompts.js';
import { scanProject } from '../scanner/index.js';
import { generateMessages } from '../generator/index.js';
import { translateMessages } from '../translator/index.js';
import { rewriteFiles } from '../rewriter/index.js';
import { injectAll } from '../injector/index.js';

const program = new Command();

program
  .name('next-auto-i18n')
  .description("Automatise l'internationalisation d'un projet React / Next.js")
  .version('0.1.0');

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

      // 2. Scan
      logger.step('Scan du projet');
      const strings = await scanProject(projectRoot, {
        ignorePatterns: config.ignore,
      });
      logger.success(`${strings.length} strings trouvées`);

      if (strings.length === 0) {
        logger.warn('Aucune string traduisible trouvée — arrêt');
        return;
      }

      // 3. Génération fichier source
      logger.step('Génération des clés');
      const genResult = await generateMessages(strings, {
        sourceLocale,
        messagesDir: config.messagesDir,
      });
      logger.success(`${Object.keys(genResult.messages).length} clés générées → ${genResult.outputPath}`);

      // Dry-run : montrer un aperçu et demander confirmation
      if (options.dryRun) {
        const uniqueFiles = new Set(strings.map(s => s.filePath));
        const proceed = await askConfirmDryRun({
          stringsFound: strings.length,
          keysGenerated: Object.keys(genResult.messages).length,
          filesToRewrite: uniqueFiles.size,
          targetLocales,
        });
        if (!proceed) {
          logger.warn('Abandon');
          return;
        }
      }

      // 4. Traduction
      logger.step('Traduction via DeepL');
      const transResult = await translateMessages({
        sourceLocale,
        targetLocales,
        messagesDir: config.messagesDir,
        apiKey,
      });
      logger.success(`${transResult.totalTranslated} strings traduites`);
      if (transResult.skipped.length > 0) {
        logger.dim(`Déjà à jour : ${transResult.skipped.join(', ')}`);
      }

      // 5. Vérification de next-intl (installé via peerDependencies)
      logger.step('Vérification des dépendances');
      const hasNextIntl = await isPackageInstalled(projectRoot, 'next-intl');
      if (!hasNextIntl) {
        logger.warn('next-intl non trouvé — il devrait être installé automatiquement via peerDependencies');
        logger.dim('Si ce n\'est pas le cas, installez manuellement : npm install next-intl');
      } else {
        logger.success('next-intl installé');
      }

      // 6. Réécriture des composants
      logger.step('Réécriture des composants');
      const filePaths = [...new Set(strings.map(s => s.filePath))];
      try {
        const rwResult = await rewriteFiles(filePaths, {
          keyMap: genResult.keyMap,
          silent: true,
        });
        logger.success(
          `${rwResult.totalReplaced} remplacements dans ${rwResult.filesModified} fichier${rwResult.filesModified > 1 ? 's' : ''}`,
        );

        // Avertir sur les strings module-scope (traduites dans le JSON mais non réécrites)
        if (rwResult.moduleScopeStrings.length > 0) {
          const count = rwResult.moduleScopeStrings.length;
          logger.warn(
            `${count} string${count > 1 ? 's' : ''} module-scope non réécrite${count > 1 ? 's' : ''} (traductions disponibles dans le JSON)`,
          );
          // Grouper par fichier pour un affichage lisible
          const byFile = new Map<string, typeof rwResult.moduleScopeStrings>();
          for (const s of rwResult.moduleScopeStrings) {
            const list = byFile.get(s.filePath) ?? [];
            list.push(s);
            byFile.set(s.filePath, list);
          }
          for (const [file, items] of byFile) {
            for (const item of items) {
              const preview = item.value.length > 50 ? item.value.slice(0, 50) + '...' : item.value;
              logger.dim(`  ${file}:${item.line}  "${preview}" → ${item.key}`);
            }
          }
          logger.dim('  → Déplacez ces const dans vos composants pour utiliser t("clé")');
        }
      } catch (rwErr) {
        logger.warn(
          `Réécriture partielle (${rwErr instanceof Error ? rwErr.message : String(rwErr)})`,
        );
        logger.dim('Certains fichiers n\'ont pas pu être réécrits. Vérifiez manuellement.');
      }

      // 7. Injection config Next.js
      logger.step('Configuration Next.js');
      const injResult = await injectAll({
        projectRoot,
        locales: [sourceLocale, ...targetLocales],
        defaultLocale: sourceLocale,
        silent: true,
      });

      if (injResult.config.ok) logger.success('next.config configuré');
      else if (injResult.config.error) logger.warn(`next.config — ${injResult.config.error}`);

      if (injResult.middleware.ok) {
        if (injResult.middleware.warning) logger.warn(injResult.middleware.warning);
        else logger.success('middleware.ts créé');
      }

      if (injResult.routing.ok) logger.success('i18n/routing.ts créé');

      if (injResult.request.ok) logger.success('i18n/request.ts créé');
      else if (injResult.request.error) logger.warn(`i18n/request.ts — ${injResult.request.error}`);

      if (injResult.switcher.ok) logger.success('LanguageSwitcher créé');
      else if (injResult.switcher.error) logger.warn(`LanguageSwitcher — ${injResult.switcher.error}`);

      if (injResult.localeStructure.ok) logger.success('app/[locale]/ structuré');
      else if (injResult.localeStructure.error) logger.warn(`app/[locale]/ — ${injResult.localeStructure.error}`);

      // Terminé
      logger.blank();
      logger.success('Internationalisation configurée avec succès !');
      logger.dim(`Langues : ${sourceLocale} → ${targetLocales.join(', ')}`);
      logger.dim('Backups disponibles dans *.backup');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Rescanne le projet et met à jour les traductions existantes')
  .action(async () => {
    const projectRoot = process.cwd();

    try {
      const config = await loadConfig(projectRoot);
      loadEnv(projectRoot);
      const apiKey = getApiKey(config.apiKeyEnv);

      if (!apiKey) {
        logger.error(`Clé API introuvable (${config.apiKeyEnv}). Lancez "auto-i18n init" d'abord.`);
        process.exit(1);
      }

      // Re-scan
      logger.step('Scan du projet');
      const strings = await scanProject(projectRoot, {
        ignorePatterns: config.ignore,
      });
      logger.success(`${strings.length} strings trouvées`);

      if (strings.length === 0) {
        logger.warn('Aucune string trouvée');
        return;
      }

      // Re-génération (met à jour le fichier source)
      logger.step('Mise à jour des clés');
      const genResult = await generateMessages(strings, {
        sourceLocale: config.sourceLocale,
        messagesDir: config.messagesDir,
      });
      logger.success(`${Object.keys(genResult.messages).length} clés → ${genResult.outputPath}`);

      // Traduction incrémentale
      logger.step('Traduction incrémentale');
      const transResult = await translateMessages({
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        messagesDir: config.messagesDir,
        apiKey,
      });

      if (transResult.totalTranslated > 0) {
        logger.success(`${transResult.totalTranslated} nouvelles traductions`);
      } else {
        logger.success('Toutes les traductions sont à jour');
      }
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

      // Ajouter au config
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

      // Mettre à jour routing.ts si présent
      const allLocales = [config.sourceLocale, ...config.targetLocales];
      await injectAll({
        projectRoot,
        locales: allLocales,
        defaultLocale: config.sourceLocale,
        silent: true,
      });
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
          logger.warn(`${locale} — ${missing.length} clé${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''}`);
          for (const key of missing) {
            logger.dim(`  ${key}`);
          }
          totalMissing += missing.length;
        } else {
          logger.success(`${locale} — complet`);
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

program.parse();
