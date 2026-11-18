/**
 * Adapter système de fichiers — fonctions I/O feuilles, sans logique métier.
 */

import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  access,
  rename,
  unlink,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { join, extname, relative, posix } from 'node:path';
import type { Catalog, CatalogFormat } from '../../core/types.js';
import { flattenCatalog, unflattenCatalog } from '../../core/catalog/flatten.js';

const SCANNABLE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs']);

// prettier-ignore
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out',
  '.turbo', '.cache', 'coverage', '.vercel', 'public', '.expo',
  '.tmp', '.auto-i18n.lock', '.agents', '.codex', '.idea', '.vscode',
  'i18n', 'messages',
]);

/** Fichiers d'infrastructure générés — jamais re-scannés. */
const GENERATED_FILES = new Set([
  'LanguageSwitcher.tsx',
  'LanguageSwitcher.jsx',
  'i18n.ts',
  'i18n.js',
  'middleware.ts',
  'middleware.js',
  'proxy.ts',
  'proxy.js',
]);

const CONFIG_FILE_RE = /(?:^|\.)config\.(?:ts|js|mjs|cjs|mts|cts)$/i;
const EXPO_API_ROUTE_RE = /\+api\.(?:ts|tsx|js|jsx)$/i;

/** Dossiers racine où il est pertinent de scanner du code applicatif par défaut. */
// prettier-ignore
const DEFAULT_ROOT_DIRS = [
  'app', 'src', 'pages', 'components', 'lib', 'hooks', 'utils',
  'ui', 'features', 'shared', 'screens',
];

export interface CollectOptions {
  /** Référence de sûreté : visiter aussi les dossiers applicatifs non configurés. */
  allRoots?: boolean;
  ignoreDirs?: string[];
  ignorePatterns?: string[];
  rootDirs?: string[];
}

function normalizePosixRel(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

function matchesAnyGlob(relPath: string, fileName: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const p = normalizePosixRel(raw);
    if (!p) continue;
    if (p.startsWith('**/')) {
      const tail = p.slice(3);
      if (posix.matchesGlob(relPath, tail) || posix.matchesGlob(fileName, tail)) return true;
    }
    if (posix.matchesGlob(relPath, p) || posix.matchesGlob(fileName, p)) return true;
  }
  return false;
}

function isDirAllowedByRoots(relDir: string, roots: string[]): boolean {
  return roots.some(r => relDir === r || relDir.startsWith(`${r}/`) || r.startsWith(`${relDir}/`));
}

function isFileInsideRoots(relFile: string, roots: string[], explicitRoots: boolean): boolean {
  if (!relFile.includes('/')) return !explicitRoots;
  return roots.some(r => relFile.startsWith(`${r}/`));
}

/** Liste récursivement les fichiers source scannables d'un projet. */
export async function collectSourceFiles(
  rootDir: string,
  options: CollectOptions = {},
): Promise<string[]> {
  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
  const patterns = options.ignorePatterns ?? [];
  const explicitRoots = options.rootDirs !== undefined;
  const roots = (options.rootDirs ?? DEFAULT_ROOT_DIRS).map(normalizePosixRel).filter(Boolean);
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relPath = normalizePosixRel(relative(rootDir, fullPath));

      if (entry.isDirectory()) {
        if (!options.allRoots && !isDirAllowedByRoots(relPath, roots)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) continue;
      if (!SCANNABLE_EXTENSIONS.has(extname(entry.name))) continue;
      if (GENERATED_FILES.has(entry.name)) continue;
      if (CONFIG_FILE_RE.test(entry.name) || entry.name === '.eslintrc.js') continue;
      if (EXPO_API_ROUTE_RE.test(entry.name)) continue;
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      if (entry.name.startsWith('.')) continue;
      if (!options.allRoots && !isFileInsideRoots(relPath, roots, explicitRoots)) continue;
      if (patterns.length > 0 && matchesAnyGlob(relPath, entry.name, patterns)) continue;

      files.push(fullPath);
    }
  }

  await walk(rootDir);
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

const MAX_BACKUPS = 100;

export async function backupFile(path: string): Promise<string> {
  for (let n = 1; n <= MAX_BACKUPS; n++) {
    const backupPath = n === 1 ? `${path}.backup` : `${path}.backup.${n}`;
    try {
      await copyFile(path, backupPath, constants.COPYFILE_EXCL);
      return backupPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Trop de sauvegardes pour ${path} (${MAX_BACKUPS}). Faites le ménage.`);
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export class CatalogParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`Catalogue illisible : ${path} — ${detail}. Corrigez ou supprimez ce fichier.`);
    this.name = 'CatalogParseError';
  }
}

export async function readCatalog(path: string, format: CatalogFormat = 'flat'): Promise<Catalog> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }

  const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new CatalogParseError(path, err instanceof Error ? err.message : 'JSON invalide');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CatalogParseError(path, 'objet JSON attendu');
  }

  if (format === 'nested') {
    try {
      return flattenCatalog(parsed as Record<string, unknown>);
    } catch (err) {
      throw new CatalogParseError(path, err instanceof Error ? err.message : 'catalogue invalide');
    }
  }

  const catalog: Catalog = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '__proto__') continue;
    if (typeof value !== 'string') {
      throw new CatalogParseError(
        path,
        `la clé "${key}" n'est pas une chaîne (catalogue à plat attendu)`,
      );
    }
    catalog[key] = value;
  }
  return catalog;
}

export async function writeCatalog(
  path: string,
  catalog: Catalog,
  format: CatalogFormat = 'flat',
): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const payload = format === 'nested' ? unflattenCatalog(catalog) : catalog;
  try {
    await writeFile(tmpPath, JSON.stringify(payload, null, 2) + '\n', {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await rename(tmpPath, path);
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}
