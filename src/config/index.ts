/**
 * Chargement et validation de la configuration `auto-i18n.config.json`.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export const CONFIG_FILENAME = 'auto-i18n.config.json';

/** Chemin du schéma JSON dans le package installé (autocomplétion VSCode). */
export const CONFIG_SCHEMA_PATH =
  './node_modules/next-auto-i18n/schema/auto-i18n.config.schema.json';

export interface AutoI18nConfig {
  /** Référence au schéma JSON — active l'autocomplétion dans l'éditeur. */
  $schema?: string;
  sourceLocale: string;
  targetLocales: string[];
  provider: string;
  apiKeyEnv: string;
  messagesDir: string;
  ignore: string[];
}

/** Variable d'env par défaut pour chaque provider connu. */
export const PROVIDER_API_KEY_ENV: Record<string, string> = {
  deepl: 'AUTO_I18N_DEEPL_KEY',
  google: 'AUTO_I18N_GOOGLE_KEY',
};

const DEFAULTS: Omit<AutoI18nConfig, 'sourceLocale' | 'targetLocales'> = {
  provider: 'deepl',
  apiKeyEnv: PROVIDER_API_KEY_ENV.deepl,
  messagesDir: './messages',
  ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
};

/**
 * Valide les champs requis. Les champs optionnels (provider, apiKeyEnv,
 * messagesDir, ignore) reçoivent leur valeur par défaut au chargement.
 */
export function isValidConfig(
  value: unknown,
): value is Pick<AutoI18nConfig, 'sourceLocale' | 'targetLocales'> {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sourceLocale === 'string' &&
    Array.isArray(c.targetLocales) &&
    c.targetLocales.every(l => typeof l === 'string')
  );
}

export function buildConfig(
  sourceLocale: string,
  targetLocales: string[],
  provider: string = DEFAULTS.provider,
): AutoI18nConfig {
  return {
    $schema: CONFIG_SCHEMA_PATH,
    sourceLocale,
    targetLocales,
    ...DEFAULTS,
    provider,
    apiKeyEnv: PROVIDER_API_KEY_ENV[provider] ?? DEFAULTS.apiKeyEnv,
  };
}

export class ConfigNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Configuration introuvable : ${path}. Lancez "next-auto-i18n init" d'abord.`);
    this.name = 'ConfigNotFoundError';
  }
}

export async function loadConfig(projectRoot: string): Promise<AutoI18nConfig> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    throw new ConfigNotFoundError(configPath);
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isValidConfig(parsed)) {
    throw new Error(`Configuration invalide dans ${CONFIG_FILENAME}`);
  }
  return { ...DEFAULTS, ...parsed };
}

export async function saveConfig(projectRoot: string, config: AutoI18nConfig): Promise<string> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}
