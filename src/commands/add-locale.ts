/**
 * Commande `add-locale` — ajoute une ou plusieurs langues cibles à un projet déjà initialisé,
 * met à jour la configuration et le routage/i18n reconnu, puis traduit les nouveaux catalogues.
 */

import { join } from 'node:path';
import {
  loadConfig,
  saveConfig,
  validateConfig,
  ConfigInvalidError,
  CONFIG_FILENAME,
} from '../config/index.js';
import { fileExists, readText, writeText } from '../adapters/fs/index.js';
import { localeIdentifier } from '../adapters/scaffold/templates/react-i18next.js';
import { createProvider, type TranslationProvider } from '../adapters/translation/index.js';
import { resolveProjectApiKey } from '../utils/env.js';
import { withProjectLock } from '../adapters/fs/lock.js';
import { runSync, type SyncReport } from '../pipeline/sync.js';
import { renderSyncReport } from '../reporting/sync.js';
import { logger } from '../utils/logger.js';

export interface RunAddLocaleOptions {
  projectRoot: string;
  locales: string[];
  dryRun?: boolean;
  provider?: TranslationProvider;
}

export interface RunAddLocaleResult {
  addedLocales: string[];
  syncReport: SyncReport;
  exitCode: number;
}

async function patchNextRoutingFile(projectRoot: string, newLocales: string[]): Promise<void> {
  for (const rel of [join('i18n', 'routing.ts'), join('src', 'i18n', 'routing.ts')]) {
    const full = join(projectRoot, rel);
    if (!(await fileExists(full))) continue;
    const raw = await readText(full);
    const updated = raw.replace(/locales\s*:\s*\[([^\]]*)\]/, (match, inner: string) => {
      const missing = newLocales.filter(
        l => !inner.includes(`'${l}'`) && !inner.includes(`"${l}"`),
      );
      if (missing.length === 0) return match;
      const trimmed = inner.trim().replace(/,\s*$/, '');
      const appended = missing.map(l => `'${l}'`).join(', ');
      return `locales: [${trimmed ? `${trimmed}, ${appended}` : appended}]`;
    });
    if (updated !== raw) await writeText(full, updated);
    return;
  }
}

async function patchReactI18nFile(
  projectRoot: string,
  messagesRelHint: string,
  newLocales: string[],
): Promise<void> {
  for (const rel of [join('src', 'i18n.ts'), 'i18n.ts']) {
    const full = join(projectRoot, rel);
    if (!(await fileExists(full))) continue;
    let content = await readText(full);
    for (const locale of newLocales) {
      const ident = localeIdentifier(locale);
      if (content.includes(ident)) continue;
      const importMatch = /import\s+messages_\w+\s+from\s+['"](.+)\/[^/'"]+\.json['"];?/.exec(
        content,
      );
      const basePath = importMatch ? importMatch[1] : messagesRelHint;
      content = `import ${ident} from '${basePath}/${locale}.json';\n` + content;
      content = content.replace(
        /resources\s*:\s*\{/,
        `resources: {\n    '${locale}': { translation: ${ident} },`,
      );
    }
    await writeText(full, content);
    return;
  }
}

export async function runAddLocale(options: RunAddLocaleOptions): Promise<RunAddLocaleResult> {
  const { projectRoot, dryRun = false } = options;
  return withProjectLock(
    projectRoot,
    async () => {
      const config = await loadConfig(projectRoot);
      const existingLower = new Set(config.targetLocales.map(l => l.toLowerCase()));
      const addedLocales = options.locales
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !existingLower.has(l.toLowerCase()));

      const nextTargets = [...config.targetLocales, ...addedLocales];
      const updatedConfig = { ...config, targetLocales: nextTargets };
      const problems = validateConfig(updatedConfig);
      if (problems.length > 0) {
        throw new ConfigInvalidError(join(projectRoot, CONFIG_FILENAME), problems);
      }

      if (!dryRun && addedLocales.length > 0) {
        await saveConfig(projectRoot, updatedConfig);
        await patchNextRoutingFile(projectRoot, addedLocales);
        await patchReactI18nFile(projectRoot, '../messages', addedLocales);
        logger.success(`Langue(s) ajoutée(s) à la configuration : ${addedLocales.join(', ')}`);
      }

      const apiKey = options.provider
        ? undefined
        : await resolveProjectApiKey(projectRoot, updatedConfig.apiKeyEnv);
      const provider =
        options.provider ??
        (() => {
          if (!apiKey) {
            throw new Error(
              `Clé API introuvable (${updatedConfig.apiKeyEnv}). Ajoutez-la dans .env.local.`,
            );
          }
          return createProvider(updatedConfig.provider, apiKey, { model: updatedConfig.model });
        });

      const syncReport = await runSync({
        projectRoot,
        provider,
        sourceLocale: updatedConfig.sourceLocale,
        targetLocales: updatedConfig.targetLocales,
        messagesDir: updatedConfig.messagesDir,
        ignore: updatedConfig.ignore,
        rootDirs: updatedConfig.rootDirs,
        catalogFormat: updatedConfig.catalogFormat,
        namespaceByFile: updatedConfig.namespaceByFile,
        tone: updatedConfig.tone,
        glossary: updatedConfig.glossary,
        dryRun,
      });

      renderSyncReport(projectRoot, syncReport);

      return {
        addedLocales,
        syncReport,
        exitCode:
          syncReport.translation.failed.length > 0 || syncReport.parseErrors.length > 0 ? 1 : 0,
      };
    },
    dryRun,
  );
}
