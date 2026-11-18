import { readFileSync } from 'node:fs';
import { readFile, writeFile, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

function parseEnvContent(raw: string): Record<string, string> {
  const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed = parseEnv(clean);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Lit `.env` puis `.env.local` en mémoire sans muter `process.env`
 * (évite toute fuite de secret d'un projet vers un autre dans un même processus).
 */
export async function readProjectEnv(projectRoot: string): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {
    try {
      const raw = await readFile(join(projectRoot, name), 'utf-8');
      Object.assign(merged, parseEnvContent(raw));
    } catch {
      // fichier absent — ignoré
    }
  }
  return merged;
}

/** Résout une clé API depuis `process.env` (prioritaire en CI), sinon `.env.local` / `.env`. */
export async function resolveProjectApiKey(
  projectRoot: string,
  envVar: string,
): Promise<string | undefined> {
  if (process.env[envVar]) return process.env[envVar];
  const localEnv = await readProjectEnv(projectRoot);
  return localEnv[envVar] || undefined;
}

/** Compatibilité : charge `.env.local` et `.env` dans `process.env` sans écraser l'existant. */
export function loadEnv(projectRoot: string): void {
  for (const name of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(join(projectRoot, name), 'utf-8');
      for (const [k, v] of Object.entries(parseEnvContent(raw))) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      // fichier absent
    }
  }
}

export function getApiKey(envVar: string): string | undefined {
  return process.env[envVar];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error('Clé API invalide : saut de ligne ou caractère nul interdit.');
  }
  return /[#"'\s]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Écrit (ou met à jour) `envVar` dans `.env.local` (mode `0600` à la création).
 */
export async function saveApiKeyToEnv(
  projectRoot: string,
  envVar: string,
  value: string,
): Promise<void> {
  const serialized = serializeEnvValue(value);
  const envPath = join(projectRoot, '.env.local');
  let content = '';
  let existed = true;

  try {
    await access(envPath);
    content = await readFile(envPath, 'utf-8');
  } catch {
    existed = false;
  }

  const line = `${envVar}=${serialized}`;
  const regex = new RegExp(`^${escapeRegExp(envVar)}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, () => line);
  } else {
    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + line + '\n';
  }

  await writeFile(envPath, content, { encoding: 'utf-8', mode: 0o600 });

  if (!existed) {
    await chmod(envPath, 0o600).catch(() => undefined);
  }
}

export async function ensureGitignore(projectRoot: string, entries: string[]): Promise<string[]> {
  const gitignorePath = join(projectRoot, '.gitignore');
  let content = '';

  try {
    await access(gitignorePath);
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // fichier absent — on le crée
  }

  const lines = content.split('\n').map(l => l.trim());
  const added = entries.filter(entry => !lines.includes(entry));

  if (added.length > 0) {
    const suffix =
      (content.length > 0 && !content.endsWith('\n') ? '\n' : '') +
      '\n# auto-i18n\n' +
      added.join('\n') +
      '\n';
    await writeFile(gitignorePath, content + suffix, 'utf-8');
  }

  return added;
}
