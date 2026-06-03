/**
 * Adapter projet — détecte la forme du projet Next.js cible (lecture seule).
 */

import { join } from 'path';
import { readText, fileExists } from '../fs/index.js';

export interface ProjectInfo {
  root: string;
  /** Chemin du layout racine, ou null si introuvable. */
  layoutPath: string | null;
  /** true si le projet utilise `src/app` plutôt que `app`. */
  useSrc: boolean;
  /** Répertoire `app` effectif (app/ ou src/app/), ou null. */
  appDir: string | null;
  /** Version majeure de Next détectée dans node_modules, ou null. */
  nextMajor: number | null;
  /** true si `next-intl` est installé. */
  hasNextIntl: boolean;
}

/** Cherche le layout racine dans app/ ou src/app/. */
export async function findLayoutFile(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    join(projectRoot, 'app', 'layout.tsx'),
    join(projectRoot, 'src', 'app', 'layout.tsx'),
    join(projectRoot, 'app', 'layout.jsx'),
    join(projectRoot, 'src', 'app', 'layout.jsx'),
  ]) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

/** Cherche next.config.{ts,mjs,js}. */
export async function findNextConfig(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    join(projectRoot, 'next.config.ts'),
    join(projectRoot, 'next.config.mjs'),
    join(projectRoot, 'next.config.js'),
  ]) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function detectNextMajor(projectRoot: string): Promise<number | null> {
  try {
    const pkg = JSON.parse(
      await readText(join(projectRoot, 'node_modules', 'next', 'package.json')),
    ) as { version?: string };
    const major = parseInt(pkg.version?.split('.')[0] ?? '', 10);
    return Number.isNaN(major) ? null : major;
  } catch {
    return null;
  }
}

async function isPackageInstalled(projectRoot: string, name: string): Promise<boolean> {
  return fileExists(join(projectRoot, 'node_modules', name, 'package.json'));
}

export async function detectProject(projectRoot: string): Promise<ProjectInfo> {
  const layoutPath = await findLayoutFile(projectRoot);
  const useSrc = layoutPath ? layoutPath.includes(join('src', 'app')) : false;
  const appDir = layoutPath
    ? join(projectRoot, useSrc ? 'src' : '', 'app')
    : null;

  const [nextMajor, hasNextIntl] = await Promise.all([
    detectNextMajor(projectRoot),
    isPackageInstalled(projectRoot, 'next-intl'),
  ]);

  return { root: projectRoot, layoutPath, useSrc, appDir, nextMajor, hasNextIntl };
}
