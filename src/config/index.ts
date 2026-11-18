/**
 * Chargement et validation de la configuration `auto-i18n.config.json`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogFormat } from '../core/types.js';
import type { TranslationTone } from '../adapters/translation/types.js';
import { staysInsideProject } from '../utils/paths.js';

export const CONFIG_FILENAME = 'auto-i18n.config.json';

export const CONFIG_SCHEMA_PATH =
  'https://raw.githubusercontent.com/stvekoulo/auto-i18n/main/schema/auto-i18n.config.schema.json';

export const SUPPORTED_PROVIDERS = ['deepl', 'google', 'openai', 'gemini', 'anthropic'] as const;
export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

export interface AutoI18nConfig {
  $schema?: string;
  sourceLocale: string;
  targetLocales: string[];
  provider: string;
  apiKeyEnv: string;
  messagesDir: string;
  ignore: string[];
  rootDirs?: string[];
  /** Modèle optionnel pour les providers LLM (`gpt-4o-mini`, `gemini-2.5-flash`…). */
  model?: string;
  /** Registre de langue (`formal`, `informal`, `neutral`). */
  tone?: TranslationTone;
  /** Format des catalogues JSON (`flat` par défaut, ou `nested` par points). */
  catalogFormat?: CatalogFormat;
  /** Préfixe les nouvelles clés par le nom du fichier/composant en mode `nested`. */
  namespaceByFile?: boolean;
  /** Glossaire métier (`terme source` → `traduction imposée`). */
  glossary?: Record<string, string>;
}

export const PROVIDER_API_KEY_ENV: Record<string, string> = {
  deepl: 'AUTO_I18N_DEEPL_KEY',
  google: 'AUTO_I18N_GOOGLE_KEY',
  openai: 'AUTO_I18N_OPENAI_KEY',
  gemini: 'AUTO_I18N_GEMINI_KEY',
  anthropic: 'AUTO_I18N_ANTHROPIC_KEY',
};

const DEFAULTS: Omit<AutoI18nConfig, 'sourceLocale' | 'targetLocales'> = {
  provider: 'deepl',
  apiKeyEnv: PROVIDER_API_KEY_ENV.deepl,
  messagesDir: './messages',
  ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
};

const KNOWN_KEYS = new Set([
  '$schema',
  'sourceLocale',
  'targetLocales',
  'provider',
  'apiKeyEnv',
  'messagesDir',
  'ignore',
  'rootDirs',
  'model',
  'tone',
  'catalogFormat',
  'namespaceByFile',
  'glossary',
]);

const LOCALE_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_TONES = new Set(['formal', 'informal', 'neutral']);
const VALID_FORMATS = new Set(['flat', 'nested']);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(v => typeof v === 'string')
  );
}

export function validateConfig(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${CONFIG_FILENAME} doit contenir un objet JSON.`];
  }

  const config = value as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(config)) {
    if (!KNOWN_KEYS.has(key)) {
      problems.push(`champ inconnu "${key}" (faute de frappe ?).`);
    }
  }

  const { sourceLocale, targetLocales } = config;

  if (typeof sourceLocale !== 'string' || !LOCALE_RE.test(sourceLocale)) {
    problems.push('"sourceLocale" doit être un code de langue, ex. "fr" ou "pt-BR".');
  }

  if (!isStringArray(targetLocales) || targetLocales.length === 0) {
    problems.push('"targetLocales" doit être un tableau non vide de codes de langue.');
  } else {
    const invalid = targetLocales.filter(l => !LOCALE_RE.test(l));
    if (invalid.length > 0) {
      problems.push(`code de langue invalide dans "targetLocales" : ${invalid.join(', ')}.`);
    }
    const normalizedLocales = targetLocales.map(locale => locale.toLowerCase());
    if (new Set(normalizedLocales).size !== targetLocales.length) {
      problems.push('"targetLocales" contient des doublons.');
    }
    if (
      typeof sourceLocale === 'string' &&
      normalizedLocales.includes(sourceLocale.toLowerCase())
    ) {
      problems.push(`"${sourceLocale}" est à la fois la langue source et une langue cible.`);
    }
  }

  if (config.provider !== undefined) {
    if (
      typeof config.provider !== 'string' ||
      !SUPPORTED_PROVIDERS.includes(config.provider as ProviderName)
    ) {
      problems.push(`"provider" doit valoir ${SUPPORTED_PROVIDERS.join(', ')}.`);
    }
  }

  if (config.apiKeyEnv !== undefined) {
    if (typeof config.apiKeyEnv !== 'string' || !ENV_VAR_NAME_RE.test(config.apiKeyEnv)) {
      problems.push(
        '"apiKeyEnv" doit être un nom de variable d\'environnement valide (lettres, chiffres, _).',
      );
    }
  }

  if (config.messagesDir !== undefined) {
    if (typeof config.messagesDir !== 'string' || config.messagesDir.trim() === '') {
      problems.push('"messagesDir" doit être un chemin non vide.');
    } else if (!staysInsideProject(config.messagesDir)) {
      problems.push('"messagesDir" doit rester à l\'intérieur du projet.');
    }
  }

  if (config.ignore !== undefined && !isStringArray(config.ignore)) {
    problems.push('"ignore" doit être un tableau de patterns glob.');
  }

  if (config.rootDirs !== undefined) {
    if (!isStringArray(config.rootDirs) || config.rootDirs.length === 0) {
      problems.push('"rootDirs" doit être un tableau non vide de noms de dossiers.');
    } else if (config.rootDirs.some(dir => !staysInsideProject(dir))) {
      problems.push('"rootDirs" doit rester à l\'intérieur du projet.');
    }
  }

  if (config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim())) {
    problems.push('"model" doit être une chaîne non vide.');
  }

  if (
    config.tone !== undefined &&
    (typeof config.tone !== 'string' || !VALID_TONES.has(config.tone))
  ) {
    problems.push('"tone" doit valoir formal, informal ou neutral.');
  }

  if (
    config.catalogFormat !== undefined &&
    (typeof config.catalogFormat !== 'string' || !VALID_FORMATS.has(config.catalogFormat))
  ) {
    problems.push('"catalogFormat" doit valoir flat ou nested.');
  }

  if (config.namespaceByFile !== undefined && typeof config.namespaceByFile !== 'boolean') {
    problems.push('"namespaceByFile" doit être un booléen.');
  }

  if (config.glossary !== undefined && !isStringRecord(config.glossary)) {
    problems.push('"glossary" doit être un objet de paires clé/valeur de type chaîne.');
  }

  return problems;
}

export function isValidConfig(value: unknown): value is AutoI18nConfig {
  return validateConfig(value).length === 0;
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

export class ConfigInvalidError extends Error {
  constructor(
    public readonly path: string,
    public readonly problems: string[],
  ) {
    super(`Configuration invalide dans ${path} :\n${problems.map(p => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigInvalidError';
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    throw new ConfigInvalidError(configPath, [
      `JSON illisible — ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }

  const problems = validateConfig(parsed);
  if (problems.length > 0) throw new ConfigInvalidError(configPath, problems);

  const config = parsed as AutoI18nConfig;
  return {
    ...DEFAULTS,
    ...config,
    apiKeyEnv: config.apiKeyEnv ?? PROVIDER_API_KEY_ENV[config.provider ?? DEFAULTS.provider],
  };
}

export async function saveConfig(projectRoot: string, config: AutoI18nConfig): Promise<string> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}
