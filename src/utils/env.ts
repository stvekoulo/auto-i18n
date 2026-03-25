import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';

/**
 * Charge les variables d'environnement depuis `.env.local` puis `.env`.
 */
export function loadEnv(projectRoot: string): void {
  dotenvConfig({ path: join(projectRoot, '.env.local') });
  dotenvConfig({ path: join(projectRoot, '.env') });
}

/**
 * Retourne la valeur d'une variable d'environnement liée à la clé API.
 */
export function getApiKey(envVar: string): string | undefined {
  return process.env[envVar];
}

/**
 * Sauvegarde la clé API dans `.env.local`.
 * Ajoute la ligne si absente, ne duplique pas.
 */
export async function saveApiKeyToEnv(
  projectRoot: string,
  envVar: string,
  value: string,
): Promise<void> {
  const envPath = join(projectRoot, '.env.local');
  let content = '';

  try {
    await access(envPath);
    content = await readFile(envPath, 'utf-8');
  } catch {
    // fichier absent — on le crée
  }

  const line = `${envVar}=${value}`;
  const regex = new RegExp(`^${envVar}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + line + '\n';
  }

  await writeFile(envPath, content, 'utf-8');
}

/**
 * Ajoute les entrées manquantes au `.gitignore` du projet.
 */
export async function ensureGitignore(
  projectRoot: string,
  entries: string[],
): Promise<string[]> {
  const gitignorePath = join(projectRoot, '.gitignore');
  let content = '';

  try {
    await access(gitignorePath);
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // fichier absent — on le crée
  }

  const lines = content.split('\n').map(l => l.trim());
  const added: string[] = [];

  for (const entry of entries) {
    if (!lines.includes(entry)) {
      added.push(entry);
    }
  }

  if (added.length > 0) {
    const suffix = (content.length > 0 && !content.endsWith('\n') ? '\n' : '')
      + '\n# auto-i18n\n'
      + added.join('\n')
      + '\n';
    await writeFile(gitignorePath, content + suffix, 'utf-8');
  }

  return added;
}
