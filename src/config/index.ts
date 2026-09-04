/**
 * Chargement et validation de la configuration `auto-i18n.config.json`.
 *
 * La validation est exhaustive et rapporte tous les problèmes d'un coup :
 * corriger un fichier de configuration erreur par erreur est pénible, et une
 * valeur invalide acceptée en silence se paie plus loin (scan vide, écriture
 * hors du projet, provider inconnu).
 */

import { readFile, writeFile } from 'fs/promises';
import { isAbsolute, join, normalize } from 'path';

export const CONFIG_FILENAME = 'auto-i18n.config.json';

/**
 * Référence du schéma JSON écrite dans les configurations générées.
 *
 * URL publique plutôt que chemin `node_modules` : ce dernier ne résout ni sous
 * Yarn PnP ni depuis un paquet hissé à la racine d'un monorepo.
 */
export const CONFIG_SCHEMA_PATH =
  'https://raw.githubusercontent.com/stvekoulo/next-auto-i18n/main/schema/auto-i18n.config.schema.json';

/** Providers de traduction reconnus. */
export const SUPPORTED_PROVIDERS = ['deepl', 'google'] as const;
export type ProviderName = (typeof SUPPORTED_PROVIDERS)[number];

export interface AutoI18nConfig {
  /** Référence au schéma JSON — active l'autocomplétion dans l'éditeur. */
  $schema?: string;
  sourceLocale: string;
  targetLocales: string[];
  provider: string;
  apiKeyEnv: string;
  messagesDir: string;
  ignore: string[];
  /**
   * Dossiers de premier niveau à scanner. Absent = liste par défaut
   * (`app`, `src`, `components`…). À renseigner si le code applicatif vit
   * ailleurs, sinon le scan ne trouve rien.
   */
  rootDirs?: string[];
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

const KNOWN_KEYS = new Set([
  '$schema',
  'sourceLocale',
  'targetLocales',
  'provider',
  'apiKeyEnv',
  'messagesDir',
  'ignore',
  'rootDirs',
]);

/** Étiquette de langue façon BCP 47 : `fr`, `pt-BR`, `zh-Hans-CN`. */
const LOCALE_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/** Vrai si `candidate` reste sous la racine du projet. */
function staysInsideProject(candidate: string): boolean {
  if (isAbsolute(candidate)) return false;
  const normalized = normalize(candidate).replace(/\\/g, '/');
  return normalized !== '..' && !normalized.startsWith('../');
}

/**
 * Renvoie la liste des problèmes d'une configuration brute (vide si valide).
 */
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
    if (new Set(targetLocales).size !== targetLocales.length) {
      problems.push('"targetLocales" contient des doublons.');
    }
    if (typeof sourceLocale === 'string' && targetLocales.includes(sourceLocale)) {
      problems.push(`"${sourceLocale}" est à la fois la langue source et une langue cible.`);
    }
  }

  if (config.provider !== undefined) {
    if (
      typeof config.provider !== 'string' ||
      !SUPPORTED_PROVIDERS.includes(config.provider as ProviderName)
    ) {
      problems.push(`"provider" doit valoir ${SUPPORTED_PROVIDERS.join(' ou ')}.`);
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
      // Les catalogues sont écrits sans autre contrôle : un chemin qui sort de
      // la racine ferait écrire l'outil n'importe où sur la machine.
      problems.push('"messagesDir" doit rester à l\'intérieur du projet.');
    }
  }

  if (config.ignore !== undefined && !isStringArray(config.ignore)) {
    problems.push('"ignore" doit être un tableau de patterns glob.');
  }

  if (config.rootDirs !== undefined) {
    if (!isStringArray(config.rootDirs) || config.rootDirs.length === 0) {
      problems.push('"rootDirs" doit être un tableau non vide de noms de dossiers.');
    }
  }

  return problems;
}

/** Vrai si la configuration brute est exploitable telle quelle. */
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

  return { ...DEFAULTS, ...(parsed as AutoI18nConfig) };
}

export async function saveConfig(projectRoot: string, config: AutoI18nConfig): Promise<string> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}
