/**
 * Adapter système de fichiers — fonctions I/O feuilles, sans logique métier.
 */

import { readdir, readFile, writeFile, mkdir, copyFile, access, rename } from 'fs/promises';
import { constants } from 'fs';
import { join, extname, relative } from 'path';
import type { Catalog } from '../../core/types.js';

const SCANNABLE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs']);

// prettier-ignore
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out',
  '.turbo', '.cache', 'coverage', '.vercel', 'public',
  'i18n', 'messages',
]);

/** Fichiers générés par l'outil — jamais re-scannés. */
const GENERATED_FILES = new Set([
  'LanguageSwitcher.tsx',
  'LanguageSwitcher.jsx',
  'i18n.ts',
  'i18n.js',
]);

// prettier-ignore
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
// prettier-ignore
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
    // `?` est échappé ici puis retraduit plus bas : sans cela il resterait le
    // quantificateur « optionnel » de RegExp et `foo?.ts` ne dirait pas ce que
    // l'auteur du pattern croit.
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\\\?/g, '[^/]');
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

const MAX_BACKUPS = 100;

/**
 * Copie `path` vers une sauvegarde libre et renvoie son chemin.
 *
 * N'écrase jamais une sauvegarde existante : deux `sync --write` successifs
 * détruiraient sinon la version d'origine. `COPYFILE_EXCL` rend le choix du nom
 * atomique plutôt que sujet à une course entre le test et la copie.
 */
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

/**
 * Lit un catalogue JSON à plat.
 *
 * Fichier absent → `{}` (cas normal au premier run). Fichier présent mais
 * invalide → erreur : le traiter comme vide reviendrait à retraduire tout le
 * catalogue puis à écraser le fichier, donc à perdre des traductions.
 */
export async function readCatalog(path: string): Promise<Catalog> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    return {};
  }

  // Un BOM en tête ferait échouer JSON.parse ; certains éditeurs en ajoutent un.
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

  const catalog: Catalog = {};
  for (const [key, value] of Object.entries(parsed)) {
    // Seule clé dont l'affectation toucherait le prototype au lieu de l'objet.
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

/**
 * Écrit un catalogue de façon atomique (fichier temporaire puis `rename`).
 *
 * Un `writeFile` direct laisserait un JSON tronqué si le processus est tué en
 * plein milieu (dry-run, CI annulée, disque plein) : `readCatalog` échouerait
 * ensuite sans qu'aucune sauvegarde n'existe pour ce fichier. `rename` sur un
 * même volume est atomique aussi bien sous POSIX que sous Windows/NTFS.
 */
export async function writeCatalog(path: string, catalog: Catalog): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, path);
}
