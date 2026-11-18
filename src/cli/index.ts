#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import { resolveProjectApiKey } from '../utils/env.js';
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
import { runCheck, type CheckOutputFormat } from '../commands/check.js';
import { runAddLocale } from '../commands/add-locale.js';
import { runCleanBackups, runRestoreBackups } from '../commands/backups.js';
import { startWatchSync } from '../commands/watch.js';
import { createProvider } from '../adapters/translation/index.js';

function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

function finish(exitCode: number): void {
  process.exitCode = exitCode;
}

function fail(err: unknown): void {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

const program = new Command();

program
  .name('next-auto-i18n')
  .description(
    'CLI i18n pour Next.js App Router, React/Vite et Expo : extraction, traduction (DeepL/Google/LLM) et câblage sûr',
  )
  .version(readVersion());

program.addHelpText(
  'after',
  `
Exemples :
  $ next-auto-i18n init                      Mise en place interactive
  $ next-auto-i18n init --source fr --locale en,es --provider gemini
  $ next-auto-i18n sync                      Met à jour catalogues + traduit le manquant (et sources modifiées)
  $ next-auto-i18n sync --write --dry-run    Aperçu du câblage automatique des strings sûres
  $ next-auto-i18n sync --write --no-backup  Câble sans créer de fichiers .backup
  $ next-auto-i18n sync --watch              Synchronise en continu à chaque sauvegarde
  $ next-auto-i18n add-locale de,it          Ajoute de nouvelles langues et les traduit
  $ next-auto-i18n restore                   Restaure les fichiers depuis leurs sauvegardes .backup
  $ next-auto-i18n clean-backups             Supprime les fichiers .backup
  $ next-auto-i18n check --format github     Diagnostic CI avec annotations GitHub Actions`,
);

program
  .command('init')
  .description(
    "Installe l'infra i18n (Next.js, React/Vite ou Expo), génère et traduit les catalogues, et écrit le guide",
  )
  .option('--source <locale>', 'Langue source (code ISO)')
  .option('--locale <locales>', 'Langues cibles (séparées par des virgules)')
  .option('--provider <name>', 'Provider (deepl, google, openai, gemini, anthropic)')
  .option('--guide <path>', "Chemin du guide d'intégration", 'i18n-guide.md')
  .action(
    async (options: { source?: string; locale?: string; provider?: string; guide?: string }) => {
      const projectRoot = process.cwd();
      try {
        const sourceLocale = options.source?.trim().toLowerCase() ?? (await askSourceLocale());
        const targetLocales = options.locale
          ? parseLocales(options.locale, sourceLocale)
          : await askTargetLocales(sourceLocale);

        if (targetLocales.length === 0) {
          logger.error('Aucune langue cible valide');
          return finish(1);
        }

        const provider = options.provider?.trim().toLowerCase() ?? (await askProvider());
        const apiKeyEnv = PROVIDER_API_KEY_ENV[provider] ?? PROVIDER_API_KEY_ENV.deepl;
        const apiKey =
          (await resolveProjectApiKey(projectRoot, apiKeyEnv)) ?? (await askApiKey(provider));

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
        finish(exitCode);
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command('sync')
  .description('Rescanne le projet, met à jour les catalogues et traduit le manquant')
  .option('--write', 'Câble en plus les strings sûres en t()', false)
  .option('--no-backup', 'Avec --write : ne crée pas de fichier .backup')
  .option('--dry-run', 'Aperçu sans écriture ni appel API', false)
  .option('--prune', 'Retire du catalogue les clés dont le texte a disparu du code', false)
  .option('--watch', 'Surveille les fichiers et synchronise en continu', false)
  .action(
    async (options: {
      write?: boolean;
      backup?: boolean;
      dryRun?: boolean;
      prune?: boolean;
      watch?: boolean;
    }) => {
      const projectRoot = process.cwd();
      const noBackup = options.backup === false;
      try {
        const { exitCode } = await runSyncCommand({
          projectRoot,
          write: options.write,
          dryRun: options.dryRun,
          prune: options.prune,
          noBackup,
        });
        if (options.watch && !options.dryRun) {
          const handle = await startWatchSync({
            projectRoot,
            write: options.write,
            noBackup,
          });
          process.once('SIGINT', () => handle.close());
          process.once('SIGTERM', () => handle.close());
          return;
        }
        finish(exitCode);
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command('add-locale')
  .description('Ajoute une ou plusieurs langues cibles et traduit les catalogues correspondants')
  .argument('<locales>', 'Code(s) de langue séparés par des virgules (ex: es,de)')
  .option('--dry-run', 'Aperçu sans écriture ni appel API', false)
  .action(async (rawLocales: string, options: { dryRun?: boolean }) => {
    try {
      const locales = rawLocales
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const { exitCode } = await runAddLocale({
        projectRoot: process.cwd(),
        locales,
        dryRun: options.dryRun,
      });
      finish(exitCode);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('restore')
  .description('Restaure les fichiers modifiés depuis leur sauvegarde .backup initiale')
  .option('--dry-run', 'Liste les restaurations prévues sans modifier le disque', false)
  .action(async (options: { dryRun?: boolean }) => {
    try {
      await runRestoreBackups({ projectRoot: process.cwd(), dryRun: options.dryRun });
      finish(0);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('clean-backups')
  .description('Supprime tous les fichiers .backup du projet')
  .option('--dry-run', 'Liste les fichiers .backup sans les supprimer', false)
  .action(async (options: { dryRun?: boolean }) => {
    try {
      await runCleanBackups({ projectRoot: process.cwd(), dryRun: options.dryRun });
      finish(0);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('check')
  .description('Diagnostic read-only (CI) : strings non cataloguées, obsolètes et manquantes')
  .option('--json', 'Sortie JSON', false)
  .option('--format <format>', 'Format de sortie (text, json, github)')
  .action(async (options: { json?: boolean; format?: CheckOutputFormat }) => {
    try {
      const { exitCode } = await runCheck({
        projectRoot: process.cwd(),
        json: options.json,
        format: options.format,
      });
      finish(exitCode);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('languages')
  .description('Liste les langues acceptées par le provider (aucune traduction)')
  .option('--provider <name>', 'Provider (deepl, google)', 'deepl')
  .option('--source', 'Langues source plutôt que cibles', false)
  .option('--json', 'Sortie JSON', false)
  .action(async (options: { provider: string; source: boolean; json: boolean }) => {
    try {
      const envName = PROVIDER_API_KEY_ENV[options.provider];
      const key = envName ? await resolveProjectApiKey(process.cwd(), envName) : undefined;
      const provider = createProvider(options.provider, key ?? '');
      if (!provider.listLanguages) {
        throw new Error('Ce provider ne propose pas la découverte des langues.');
      }
      const languages = await provider.listLanguages(options.source ? 'source' : 'target');
      console.log(
        options.json
          ? JSON.stringify(languages, null, 2)
          : languages.map(l => `${l.language}${l.name ? ` — ${l.name}` : ''}`).join('\n'),
      );
    } catch (error) {
      fail(error);
    }
  });

program.parseAsync().catch(fail);
