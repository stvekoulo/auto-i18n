#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join, relative } from 'path';
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

const MAX_FILES_DISPLAY = 10;
const MAX_REWRITE_DISPLAY = 15;

function logFileList(
  entries: Array<[string, number]>,
  projectRoot: string,
  suffix: (n: number) => string,
): void {
  for (const [file, count] of entries.slice(0, MAX_FILES_DISPLAY)) {
    const rel = relative(projectRoot, file);
    logger.dim(`  ${rel.padEnd(60)} ${suffix(count)}`);
  }
  if (entries.length > MAX_FILES_DISPLAY) {
    const more = entries.length - MAX_FILES_DISPLAY;
    logger.dim(`  ... et ${more} autre${more > 1 ? 's' : ''} fichier${more > 1 ? 's' : ''}`);
  }
}

/** Regroupe une liste de ExtractedString par fichier et retourne les entrées triées. */
function groupByFile(strings: Array<{ filePath: string }>): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const s of strings) {
    map.set(s.filePath, (map.get(s.filePath) ?? 0) + 1);
  }
  return [...map.entries()];
}

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

      if (strings.length === 0) {
        logger.warn('Aucune string traduisible trouvée — arrêt');
        return;
      }

      const scanEntries = groupByFile(strings);
      const fileCount = scanEntries.length;
      logger.success(`${strings.length} strings trouvées dans ${fileCount} fichier${fileCount > 1 ? 's' : ''}`);
      logFileList(scanEntries, projectRoot, n => `${n} string${n > 1 ? 's' : ''}`);

      // 3. Génération fichier source
      logger.step('Génération des clés');
      const genResult = await generateMessages(strings, {
        sourceLocale,
        messagesDir: config.messagesDir,
      });
      const keyCount = Object.keys(genResult.messages).length;
      logger.success(`${keyCount} clés générées → ${relative(projectRoot, genResult.outputPath)}`);

      // Dry-run : montrer un aperçu et demander confirmation
      if (options.dryRun) {
        const fileDetails = scanEntries.map(([filePath, stringCount]) => ({
          filePath: relative(projectRoot, filePath),
          stringCount,
        }));
        const sampleKeys = Object.entries(genResult.messages)
          .slice(0, 5)
          .map(([key, value]) => ({ value, key }));

        const proceed = await askConfirmDryRun({
          stringsFound: strings.length,
          keysGenerated: keyCount,
          filesToRewrite: fileCount,
          targetLocales,
          fileDetails,
          sampleKeys,
          messagesPath: relative(projectRoot, genResult.outputPath),
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
      if (transResult.totalTranslated > 0) {
        logger.success(`${transResult.totalTranslated} strings traduites`);
      }
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

        // Détail par fichier modifié
        const modifiedDetails = rwResult.details.filter(d => !d.skipped);
        for (const d of modifiedDetails.slice(0, MAX_REWRITE_DISPLAY)) {
          const rel = relative(projectRoot, d.filePath);
          if (d.error) {
            logger.warn(`${rel} — erreur: ${d.error}`);
          } else {
            logger.success(`${rel} — ${d.replaced} remplacement${d.replaced > 1 ? 's' : ''}`);
          }
        }
        if (modifiedDetails.length > MAX_REWRITE_DISPLAY) {
          const more = modifiedDetails.length - MAX_REWRITE_DISPLAY;
          logger.dim(`  ... et ${more} autre${more > 1 ? 's' : ''} fichier${more > 1 ? 's' : ''} modifié${more > 1 ? 's' : ''}`);
        }

        const skippedCount = rwResult.details.filter(d => d.skipped && !d.error).length;
        if (skippedCount > 0) {
          logger.dim(`${skippedCount} fichier${skippedCount > 1 ? 's' : ''} sans modification nécessaire`);
        }

        logger.success(
          `Total : ${rwResult.totalReplaced} remplacement${rwResult.totalReplaced > 1 ? 's' : ''} dans ${rwResult.filesModified} fichier${rwResult.filesModified > 1 ? 's' : ''}`,
        );
        if (rwResult.filesModified > 0) {
          logger.dim('Backups disponibles dans *.backup');
        }

        // Avertir sur les strings module-scope non réécrites
        if (rwResult.moduleScopeStrings.length > 0) {
          const count = rwResult.moduleScopeStrings.length;
          logger.warn(
            `${count} string${count > 1 ? 's' : ''} module-scope non réécrite${count > 1 ? 's' : ''} (traductions disponibles dans le JSON)`,
          );
          const byFile = new Map<string, typeof rwResult.moduleScopeStrings>();
          for (const s of rwResult.moduleScopeStrings) {
            const list = byFile.get(s.filePath) ?? [];
            list.push(s);
            byFile.set(s.filePath, list);
          }
          for (const [file, items] of byFile) {
            const rel = relative(projectRoot, file);
            for (const item of items) {
              const preview = item.value.length > 50 ? item.value.slice(0, 50) + '…' : item.value;
              logger.dim(`  ${rel}:${item.line}  "${preview}"  →  ${item.key}`);
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

      let existingMessages: Record<string, string> = {};
      try {
        existingMessages = JSON.parse(await readFile(sourcePath, 'utf-8')) as Record<string, string>;
      } catch {
        logger.warn(`Impossible de lire ${relative(projectRoot, sourcePath)} — régénération complète`);
      }

      const existingCount = Object.keys(existingMessages).length;
      logger.info(`${existingCount} clé${existingCount > 1 ? 's' : ''} existante${existingCount > 1 ? 's' : ''} dans ${config.sourceLocale}.json`);

      // 1. Scan — trouve uniquement les strings non encore internationalisées
      logger.step('Scan du projet');
      const strings = await scanProject(projectRoot, { ignorePatterns: config.ignore });

      if (strings.length > 0) {
        const scanEntries = groupByFile(strings);
        const fileCount = scanEntries.length;
        logger.success(`${strings.length} string${strings.length > 1 ? 's' : ''} trouvée${strings.length > 1 ? 's' : ''} dans ${fileCount} fichier${fileCount > 1 ? 's' : ''}`);
        logFileList(scanEntries, projectRoot, n => `${n} string${n > 1 ? 's' : ''}`);

        // 2. Générer les clés — merge stable avec les existantes
        logger.step('Mise à jour des clés');
        const genResult = await generateMessages(strings, {
          sourceLocale: config.sourceLocale,
          messagesDir: config.messagesDir,
          existingMessages,
        });

        if (genResult.newCount > 0) {
          logger.success(`${genResult.newCount} nouvelle${genResult.newCount > 1 ? 's' : ''} clé${genResult.newCount > 1 ? 's' : ''} ajoutée${genResult.newCount > 1 ? 's' : ''} → ${relative(projectRoot, genResult.outputPath)}`);
          logger.dim(`Total : ${Object.keys(genResult.messages).length} clés`);
        } else {
          logger.success(`Aucune nouvelle clé — ${Object.keys(genResult.messages).length} clés existantes inchangées`);
        }

        // 3. Réécrire le code pour les nouvelles strings
        logger.step('Réécriture des composants');
        const filePaths = [...new Set(strings.map(s => s.filePath))];
        try {
          const rwResult = await rewriteFiles(filePaths, {
            keyMap: genResult.keyMap,
            silent: true,
          });

          const modifiedDetails = rwResult.details.filter(d => !d.skipped);
          for (const d of modifiedDetails.slice(0, MAX_REWRITE_DISPLAY)) {
            const rel = relative(projectRoot, d.filePath);
            if (d.error) {
              logger.warn(`${rel} — erreur: ${d.error}`);
            } else {
              logger.success(`${rel} — ${d.replaced} remplacement${d.replaced > 1 ? 's' : ''}`);
            }
          }
          if (modifiedDetails.length > MAX_REWRITE_DISPLAY) {
            const more = modifiedDetails.length - MAX_REWRITE_DISPLAY;
            logger.dim(`  ... et ${more} autre${more > 1 ? 's' : ''} fichier${more > 1 ? 's' : ''} modifié${more > 1 ? 's' : ''}`);
          }

          const skippedCount = rwResult.details.filter(d => d.skipped && !d.error).length;
          if (skippedCount > 0) {
            logger.dim(`${skippedCount} fichier${skippedCount > 1 ? 's' : ''} sans modification nécessaire`);
          }

          if (rwResult.filesModified > 0) {
            logger.success(`Total : ${rwResult.totalReplaced} remplacement${rwResult.totalReplaced > 1 ? 's' : ''} dans ${rwResult.filesModified} fichier${rwResult.filesModified > 1 ? 's' : ''}`);
            logger.dim('Backups disponibles dans *.backup');
          }

          if (rwResult.moduleScopeStrings.length > 0) {
            const count = rwResult.moduleScopeStrings.length;
            logger.warn(`${count} string${count > 1 ? 's' : ''} module-scope non réécrite${count > 1 ? 's' : ''} (traductions disponibles dans le JSON)`);
            const byFile = new Map<string, typeof rwResult.moduleScopeStrings>();
            for (const s of rwResult.moduleScopeStrings) {
              const list = byFile.get(s.filePath) ?? [];
              list.push(s);
              byFile.set(s.filePath, list);
            }
            for (const [file, items] of byFile) {
              const rel = relative(projectRoot, file);
              for (const item of items) {
                const preview = item.value.length > 50 ? item.value.slice(0, 50) + '…' : item.value;
                logger.dim(`  ${rel}:${item.line}  "${preview}"  →  ${item.key}`);
              }
            }
            logger.dim('  → Déplacez ces const dans vos composants pour utiliser t("clé")');
          }
        } catch (rwErr) {
          logger.warn(`Réécriture partielle (${rwErr instanceof Error ? rwErr.message : String(rwErr)})`);
          logger.dim('Certains fichiers n\'ont pas pu être réécrits. Vérifiez manuellement.');
        }
      } else {
        logger.success('Toutes les strings sont déjà internationalisées');
      }

      // 4. Traduction incrémentale — toujours exécutée (nouvelles locales, clés manquantes…)
      logger.step('Synchronisation des traductions');
      const transResult = await translateMessages({
        sourceLocale: config.sourceLocale,
        targetLocales: config.targetLocales,
        messagesDir: config.messagesDir,
        apiKey,
      });

      if (transResult.totalTranslated > 0) {
        logger.success(`${transResult.totalTranslated} string${transResult.totalTranslated > 1 ? 's' : ''} traduite${transResult.totalTranslated > 1 ? 's' : ''}`);
      } else {
        logger.success('Toutes les traductions sont à jour');
      }
      if (transResult.skipped.length > 0) {
        logger.dim(`Déjà à jour : ${transResult.skipped.join(', ')}`);
      }

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

      // Mettre à jour routing.ts si présent
      const allLocales = [config.sourceLocale, ...config.targetLocales];
      logger.step('Mise à jour de la configuration Next.js');
      await injectAll({
        projectRoot,
        locales: allLocales,
        defaultLocale: config.sourceLocale,
        silent: true,
      });
      logger.success(`Langues actives : ${allLocales.join(', ')}`);
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

program.parse();
