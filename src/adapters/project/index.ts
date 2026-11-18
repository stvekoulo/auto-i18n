/**
 * Adapter projet — détecte la forme du projet cible (lecture seule) :
 * - `next-intl` : Next.js App Router (`app/layout.*` ou `src/app/layout.*`)
 * - `expo`      : Expo / React Native (`app.json` expo, `node_modules/expo`, ou `app/_layout.*`)
 * - `react-i18next` : React / Vite web hors Next.js
 */

import { join } from 'node:path';
import { readText, fileExists } from '../fs/index.js';

export type Framework = 'next-intl' | 'react-i18next' | 'expo';

export interface ProjectInfo {
  root: string;
  framework: Framework;
  layoutPath: string | null;
  useSrc: boolean;
  appDir: string | null;
  nextMajor: number | null;
  hasNextIntl: boolean;
  reactEntryFile: string | null;
  hasReactI18next: boolean;
  expoEntryFile: string | null;
  hasExpoLocalization: boolean;
}

export async function findLayoutFile(projectRoot: string): Promise<string | null> {
  for (const directory of ['app', join('src', 'app')]) {
    for (const scope of ['', '[locale]']) {
      for (const extension of ['tsx', 'jsx', 'js', 'ts']) {
        const candidate = join(projectRoot, directory, scope, `layout.${extension}`);
        if (await fileExists(candidate)) return candidate;
      }
    }
  }
  return null;
}

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
    const major = Number.parseInt(pkg.version?.split('.')[0] ?? '', 10);
    return Number.isNaN(major) ? null : major;
  } catch {
    return null;
  }
}

async function isPackageInstalled(projectRoot: string, name: string): Promise<boolean> {
  return fileExists(join(projectRoot, 'node_modules', name, 'package.json'));
}

async function hasExpoManifest(projectRoot: string): Promise<boolean> {
  if (await isPackageInstalled(projectRoot, 'expo')) return true;
  try {
    const raw = JSON.parse(await readText(join(projectRoot, 'app.json'))) as Record<
      string,
      unknown
    >;
    return typeof raw?.expo === 'object' && raw.expo !== null;
  } catch {
    return false;
  }
}

export async function findExpoEntryFile(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    join(projectRoot, 'src', 'app', '_layout.tsx'),
    join(projectRoot, 'src', 'app', '_layout.jsx'),
    join(projectRoot, 'app', '_layout.tsx'),
    join(projectRoot, 'app', '_layout.jsx'),
    join(projectRoot, 'App.tsx'),
    join(projectRoot, 'App.jsx'),
  ]) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

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
  const [nextMajor, hasNextIntl, hasReactI18next, hasExpoLoc, isExpo, expoEntry] =
    await Promise.all([
      detectNextMajor(projectRoot),
      isPackageInstalled(projectRoot, 'next-intl'),
      isPackageInstalled(projectRoot, 'react-i18next'),
      isPackageInstalled(projectRoot, 'expo-localization'),
      hasExpoManifest(projectRoot),
      findExpoEntryFile(projectRoot),
    ]);

  const isExpoRouterLayout = !layoutPath && Boolean(expoEntry && expoEntry.includes('_layout.'));
  const framework: Framework = layoutPath
    ? 'next-intl'
    : isExpo || isExpoRouterLayout
      ? 'expo'
      : 'react-i18next';

  const useSrc = layoutPath
    ? layoutPath.includes(join('src', 'app'))
    : Boolean(expoEntry?.includes(join('src', 'app')));
  const appDir = layoutPath ? join(projectRoot, useSrc ? 'src' : '', 'app') : null;
  const reactEntryFile =
    framework === 'react-i18next' ? await findReactEntryFile(projectRoot) : null;

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
    expoEntryFile: framework === 'expo' ? expoEntry : null,
    hasExpoLocalization: hasExpoLoc,
  };
}
