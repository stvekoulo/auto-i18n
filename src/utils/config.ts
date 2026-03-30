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

const DEFAULT_CONFIG: Partial<AutoI18nConfig> = {
  provider: 'deepl',
  apiKeyEnv: 'AUTO_I18N_DEEPL_KEY',
  messagesDir: './messages',
  ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
};

export function validateConfig(config: unknown): config is AutoI18nConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.sourceLocale === 'string' &&
    Array.isArray(c.targetLocales) &&
    c.targetLocales.every((l: unknown) => typeof l === 'string') &&
    typeof c.messagesDir === 'string'
  );
}

export async function loadConfig(projectRoot: string): Promise<AutoI18nConfig> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  const raw = await readFile(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!validateConfig(parsed)) {
    throw new Error(`Configuration invalide dans ${CONFIG_FILENAME}`);
  }

  return { ...DEFAULT_CONFIG, ...parsed } as AutoI18nConfig;
}

export async function saveConfig(
  projectRoot: string,
  config: AutoI18nConfig,
): Promise<string> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}

export function buildConfig(
  sourceLocale: string,
  targetLocales: string[],
): AutoI18nConfig {
  return {
    sourceLocale,
    targetLocales,
    provider: DEFAULT_CONFIG.provider!,
    apiKeyEnv: DEFAULT_CONFIG.apiKeyEnv!,
    messagesDir: DEFAULT_CONFIG.messagesDir!,
    ignore: DEFAULT_CONFIG.ignore!,
  };
}

export function findMissingKeys(
  source: Record<string, string>,
  target: Record<string, string>,
): string[] {
  return Object.keys(source).filter(k => !(k in target));
}
