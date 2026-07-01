#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { loadEnv, getApiKey } from '../utils/env.js';
import {
  askSourceLocale,
  askTargetLocales,
  askApiKey,
  askProvider,
  parseLocales,
} from './prompts.js';
import { PROVIDER_API_KEY_ENV } from '../config/index.js';
import { runInit } from '../commands/init.js';
import { runSyncCommand } from '../commands/sync.js';
import { runCheck } from '../commands/check.js';

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
  .description('Internationalisation pour projets Next.js App Router (sans réécrire votre code)')
  .version(readVersion());

program.addHelpText(
  'after',
  `
Exemples :
  $ next-auto-i18n init                      Mise en place interactive
  $ next-auto-i18n init --source fr --locale en,es,de
  $ next-auto-i18n sync                      Met à jour catalogues + traduit le manquant
  $ next-auto-i18n sync --write --dry-run    Aperçu du câblage automatique des strings sûres
  $ next-auto-i18n sync --write              Câble les strings sûres en t() (avec .backup)
  $ next-auto-i18n check                     Diagnostic (CI) — code de sortie ≠ 0 si travail en attente
  $ next-auto-i18n check --json              Rapport machine pour scripts/CI

Documentation : https://github.com/stvekoulo/next-auto-i18n#readme`,
);

program
  .command('init')
  .description(
    "Installe l'infra next-intl, génère et traduit les catalogues, et produit le guide d'intégration",
  )
  .option('--source <locale>', 'Langue source (code ISO)')
  .option('--locale <locales>', 'Langues cibles (séparées par des virgules)')
  .option('--provider <name>', 'Provider de traduction (deepl, google)')
  .option('--guide <path>', "Chemin du guide d'intégration", 'i18n-guide.md')
  .action(
    async (options: { source?: string; locale?: string; provider?: string; guide?: string }) => {
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

        const provider = options.provider?.trim().toLowerCase() ?? (await askProvider());
        const apiKeyEnv = PROVIDER_API_KEY_ENV[provider] ?? PROVIDER_API_KEY_ENV.deepl;
        const apiKey = getApiKey(apiKeyEnv) ?? (await askApiKey(provider));

        const { exitCode } = await runInit({
          projectRoot,
          sourceLocale,
          targetLocales,
          providerName: provider,
          apiKey,
          guidePath: options.guide,
        });

        logger.blank();
        logger.success(`Terminé — ${sourceLocale} → ${targetLocales.join(', ')}`);
        process.exit(exitCode);
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command('sync')
  .description('Rescanne le projet, met à jour les catalogues et traduit le manquant')
  .option(
    '--write',
    'Câble en plus les strings sûres en t() (composants client, ou serveur déjà async)',
    false,
  )
  .option('--dry-run', 'Avec --write, affiche le diff sans écrire sur disque', false)
  .action(async (options: { write?: boolean; dryRun?: boolean }) => {
    try {
      const { exitCode } = await runSyncCommand({
        projectRoot: process.cwd(),
        write: options.write,
        dryRun: options.dryRun,
      });
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
