/**
 * Chargement et validation de la configuration `auto-i18n.config.json`.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export const CONFIG_FILENAME = 'auto-i18n.config.json';

export interface AutoI18nConfig {
  sourceLocale: string;
  targetLocales: string[];
  provider: string;
  apiKeyEnv: string;
  messagesDir: string;
  ignore: string[];
}

const DEFAULTS: Omit<AutoI18nConfig, 'sourceLocale' | 'targetLocales'> = {
  provider: 'deepl',
  apiKeyEnv: 'AUTO_I18N_DEEPL_KEY',
  messagesDir: './messages',
  ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
};

/**
 * Valide les champs requis. Les champs optionnels (provider, apiKeyEnv,
 * messagesDir, ignore) reçoivent leur valeur par défaut au chargement.
 */
export function isValidConfig(value: unknown): value is Pick<AutoI18nConfig, 'sourceLocale' | 'targetLocales'> {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sourceLocale === 'string' &&
    Array.isArray(c.targetLocales) &&
    c.targetLocales.every(l => typeof l === 'string')
  );
}

export function buildConfig(sourceLocale: string, targetLocales: string[]): AutoI18nConfig {
  return { sourceLocale, targetLocales, ...DEFAULTS };
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
