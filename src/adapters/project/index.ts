/**
 * Adapter projet — détecte la forme du projet cible (lecture seule).
 *
 * Deux familles supportées pour le scaffold : `next-intl` (projet Next.js App
 * Router, détecté via `app/layout.tsx`) et `react-i18next` (React/Vite sans
 * Next.js — scaffold plus simple : config i18n + provider + switcher).
 */

import { join } from 'path';
import { readText, fileExists } from '../fs/index.js';

export type Framework = 'next-intl' | 'react-i18next';

export interface ProjectInfo {
  root: string;
  framework: Framework;
  /** Chemin du layout racine, ou null si introuvable (implique React/Vite). */
  layoutPath: string | null;
  /** true si le projet utilise `src/app` plutôt que `app`. */
  useSrc: boolean;
  /** Répertoire `app` effectif (app/ ou src/app/), ou null. */
  appDir: string | null;
  /** Version majeure de Next détectée dans node_modules, ou null. */
  nextMajor: number | null;
  /** true si `next-intl` est installé. */
  hasNextIntl: boolean;
  /** Point d'entrée React (src/main.tsx, src/index.tsx…), ou null. */
  reactEntryFile: string | null;
  /** true si `react-i18next` est installé. */
  hasReactI18next: boolean;
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

/** Cherche le point d'entrée d'une app React/Vite (hors Next.js). */
export async function findReactEntryFile(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    join(projectRoot, 'src', 'main.tsx'),
    join(projectRoot, 'src', 'main.ts'),
    join(projectRoot, 'src', 'main.jsx'),
    join(projectRoot, 'src', 'index.tsx'),
    join(projectRoot, 'src', 'index.ts'),
    join(projectRoot, 'src', 'index.jsx'),
  ]) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

export async function detectProject(projectRoot: string): Promise<ProjectInfo> {
  const layoutPath = await findLayoutFile(projectRoot);
  const useSrc = layoutPath ? layoutPath.includes(join('src', 'app')) : false;
  const appDir = layoutPath ? join(projectRoot, useSrc ? 'src' : '', 'app') : null;
  const framework: Framework = layoutPath ? 'next-intl' : 'react-i18next';

  const [nextMajor, hasNextIntl, hasReactI18next, reactEntryFile] = await Promise.all([
    detectNextMajor(projectRoot),
    isPackageInstalled(projectRoot, 'next-intl'),
    isPackageInstalled(projectRoot, 'react-i18next'),
    framework === 'react-i18next' ? findReactEntryFile(projectRoot) : Promise.resolve(null),
  ]);

  return {
    root: projectRoot,
    framework,
    layoutPath,
    useSrc,
    appDir,
    nextMajor,
    hasNextIntl,
    reactEntryFile,
    hasReactI18next,
  };
}
