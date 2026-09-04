import { readFile, writeFile, access, chmod } from 'fs/promises';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';

export function loadEnv(projectRoot: string): void {
  // `quiet` : depuis dotenv 17, le chargement annonce chaque fichier lu et
  // affiche des conseils publicitaires. Ce bruit n'a rien à faire dans la
  // sortie d'un CLI dont on lit les rapports.
  dotenvConfig({ path: join(projectRoot, '.env.local'), quiet: true });
  dotenvConfig({ path: join(projectRoot, '.env'), quiet: true });
}

export function getApiKey(envVar: string): string | undefined {
  return process.env[envVar];
}

/** Échappe une chaîne destinée à être injectée dans une expression régulière. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Écrit (ou met à jour) `envVar` dans `.env.local`.
 *
 * `envVar` vient de `auto-i18n.config.json`, donc d'une source modifiable : il
 * est échappé avant d'entrer dans une expression régulière, et la valeur est
 * insérée via une fonction de remplacement pour neutraliser les motifs `$&`.
 * Le fichier créé reçoit le mode 0600 puisqu'il contient une clé API ; les
 * permissions d'un `.env.local` préexistant ne sont pas modifiées.
 */
export async function saveApiKeyToEnv(
  projectRoot: string,
  envVar: string,
  value: string,
): Promise<void> {
  const envPath = join(projectRoot, '.env.local');
  let content = '';
  let existed = true;

  try {
    await access(envPath);
    content = await readFile(envPath, 'utf-8');
  } catch {
    existed = false;
  }

  const line = `${envVar}=${value}`;
  const regex = new RegExp(`^${escapeRegExp(envVar)}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, () => line);
  } else {
    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + line + '\n';
  }

  await writeFile(envPath, content, { encoding: 'utf-8', mode: 0o600 });

  if (!existed) {
    // Sans effet réel sur Windows, mais indispensable sur un runner CI POSIX.
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
  const added: string[] = [];

  for (const entry of entries) {
    if (!lines.includes(entry)) {
      added.push(entry);
    }
  }

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
