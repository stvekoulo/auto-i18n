/**
 * Adapter système de fichiers — fonctions I/O feuilles, sans logique métier.
 */

import { readdir, readFile, writeFile, mkdir, copyFile, access } from 'fs/promises';
import { join, extname, relative } from 'path';
import type { Catalog } from '../../core/types.js';

const SCANNABLE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs']);

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out',
  '.turbo', '.cache', 'coverage', '.vercel', 'public',
  'i18n', 'messages',
]);

/** Composants générés par l'outil — jamais re-scannés. */
const GENERATED_FILES = new Set(['LanguageSwitcher.tsx', 'LanguageSwitcher.jsx']);

const CONFIG_FILE_NAMES = new Set([
  'next.config.ts', 'next.config.js', 'next.config.mjs',
  'vite.config.ts', 'vite.config.js',
  'tailwind.config.ts', 'tailwind.config.js',
  'postcss.config.js', 'postcss.config.ts',
  'jest.config.ts', 'jest.config.js',
  'vitest.config.ts', 'vitest.config.js',
  'eslint.config.js', 'eslint.config.ts',
  '.eslintrc.js', 'babel.config.js',
  'prettier.config.js', 'prettier.config.ts',
]);

/** Dossiers racine où il est pertinent de scanner du code applicatif. */
const DEFAULT_ROOT_DIRS = new Set([
  'app', 'src', 'pages', 'components', 'lib', 'hooks', 'utils',
  'ui', 'features', 'shared',
]);

export interface CollectOptions {
  ignoreDirs?: string[];
  ignorePatterns?: string[];
  rootDirs?: string[];
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Liste récursivement les fichiers source scannables d'un projet. */
export async function collectSourceFiles(
  rootDir: string,
  options: CollectOptions = {},
): Promise<string[]> {
  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
  const ignoreRegexes = (options.ignorePatterns ?? []).map(globToRegex);
  const allowedRootDirs = new Set(options.rootDirs ?? [...DEFAULT_ROOT_DIRS]);
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth === 0 && !allowedRootDirs.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!SCANNABLE_EXTENSIONS.has(extname(entry.name))) continue;
      if (CONFIG_FILE_NAMES.has(entry.name)) continue;
      if (GENERATED_FILES.has(entry.name)) continue;
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      if (entry.name.startsWith('.')) continue;

      if (ignoreRegexes.length > 0) {
        const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
        if (ignoreRegexes.some(re => re.test(relPath) || re.test(entry.name))) continue;
      }

      files.push(fullPath);
    }
  }

  await walk(rootDir, 0);
  return files;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function readText(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf-8');
}

export async function backupFile(path: string): Promise<string> {
  const backupPath = `${path}.backup`;
  await copyFile(path, backupPath);
  return backupPath;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Lit un catalogue JSON ; renvoie `{}` si le fichier est absent ou illisible. */
export async function readCatalog(path: string): Promise<Catalog> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Catalog;
  } catch {
    return {};
  }
}

export async function writeCatalog(path: string, catalog: Catalog): Promise<void> {
  await writeFile(path, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
}
