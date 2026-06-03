#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { loadEnv, getApiKey } from '../utils/env.js';
import { askSourceLocale, askTargetLocales, askApiKey, parseLocales } from './prompts.js';
import { runInit } from '../commands/init.js';
import { runSyncCommand } from '../commands/sync.js';
import { runCheck } from '../commands/check.js';

const API_KEY_ENV = 'AUTO_I18N_DEEPL_KEY';

function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

function fail(err: unknown): never {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const program = new Command();

program
  .name('next-auto-i18n')
  .description("Internationalisation pour projets Next.js App Router (sans réécrire votre code)")
  .version(readVersion());

program
  .command('init')
  .description("Installe l'infra next-intl, génère et traduit les catalogues, et produit le guide d'intégration")
  .option('--source <locale>', 'Langue source (code ISO)')
  .option('--locale <locales>', 'Langues cibles (séparées par des virgules)')
  .option('--guide <path>', "Chemin du guide d'intégration", 'i18n-guide.md')
  .action(async (options: { source?: string; locale?: string; guide?: string }) => {
    const projectRoot = process.cwd();
    try {
      loadEnv(projectRoot);

      const sourceLocale = options.source?.trim().toLowerCase() ?? (await askSourceLocale());
      const targetLocales = options.locale
        ? parseLocales(options.locale, sourceLocale)
        : await askTargetLocales(sourceLocale);

      if (targetLocales.length === 0) {
        logger.error('Aucune langue cible valide');
        process.exit(1);
      }

      const apiKey = getApiKey(API_KEY_ENV) ?? (await askApiKey());

      const { exitCode } = await runInit({
        projectRoot,
        sourceLocale,
        targetLocales,
        apiKey,
        guidePath: options.guide,
      });

      logger.blank();
      logger.success(`Terminé — ${sourceLocale} → ${targetLocales.join(', ')}`);
      process.exit(exitCode);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('sync')
  .description('Rescanne le projet, met à jour les catalogues et traduit le manquant')
  .action(async () => {
    try {
      const { exitCode } = await runSyncCommand({ projectRoot: process.cwd() });
      process.exit(exitCode);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('check')
  .description('Diagnostic read-only (CI) : strings non cataloguées et traductions manquantes')
  .option('--json', 'Sortie JSON', false)
  .action(async (options: { json?: boolean }) => {
    try {
      const { exitCode } = await runCheck({ projectRoot: process.cwd(), json: options.json });
      process.exit(exitCode);
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync();
