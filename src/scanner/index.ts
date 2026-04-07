import { readdir } from 'fs/promises';
import { join, extname, relative } from 'path';
import { parseFile } from './ast-parser.js';
import { extractStrings, type ExtractedString } from './string-extractor.js';
import { getIgnoreReason, shouldIgnore, type FilterOptions, type IgnoreReason } from './filters.js';

export type { ExtractedString, StringType } from './string-extractor.js';

const SCANNABLE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs']);

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out',
  '.turbo', '.cache', 'coverage', '.vercel', 'public',
  'i18n', 'messages',
]);

const GENERATED_FILES = new Set([
  'LanguageSwitcher.tsx',
  'LanguageSwitcher.jsx',
]);

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

const NEXT_APP_DIRS = new Set([
  'app', 'src', 'pages', 'components', 'lib', 'hooks', 'utils',
  'ui', 'features', 'shared',
]);

export interface ScanOptions {
  ignoreDirs?: string[];
  ignoreFiles?: string[];
  ignorePatterns?: string[];
  rootDirs?: string[];
  filter?: FilterOptions;
  verbose?: boolean;
}

export interface IgnoredString {
  string: ExtractedString;
  reason: IgnoreReason;
}

export interface ScanParseError {
  filePath: string;
  reason: 'unparseable_context';
}

export interface ScanProjectDetailedResult {
  extracted: ExtractedString[];
  ignored: IgnoredString[];
  parseErrors: ScanParseError[];
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function collectFiles(rootDir: string, options: ScanOptions): Promise<string[]> {
  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
  const ignoreFiles = new Set(options.ignoreFiles ?? []);
  const ignoreRegexes = (options.ignorePatterns ?? []).map(globToRegex);
  const allowedRootDirs = new Set(options.rootDirs ?? [...NEXT_APP_DIRS]);
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
        if (depth === 0 && !allowedRootDirs.has(entry.name)) {
          if (options.verbose) {
            console.warn(`[scan] top-level directory skipped: ${entry.name}`);
          }
          continue;
        }
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!SCANNABLE_EXTENSIONS.has(extname(entry.name))) continue;
      if (CONFIG_FILE_NAMES.has(entry.name)) continue;
      if (ignoreFiles.has(entry.name)) continue;
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

/**
 * @param rootPath - Chemin racine du projet à scanner
 * @param options  - Options de scan et de filtrage
 */
export async function scanProject(
  rootPath: string,
  options: ScanOptions = {},
): Promise<ExtractedString[]> {
  const detailed = await scanProjectDetailed(rootPath, options);
  return detailed.extracted;
}

export async function scanProjectDetailed(
  rootPath: string,
  options: ScanOptions = {},
): Promise<ScanProjectDetailedResult> {
  const files = await collectFiles(rootPath, options);
  const allStrings: ExtractedString[] = [];
  const ignored: IgnoredString[] = [];
  const parseErrors: ScanParseError[] = [];

  for (const filePath of files) {
    try {
      const sourceFile = parseFile(filePath);
      const extracted = extractStrings(sourceFile, filePath);
      for (const candidate of extracted) {
        const reason = getIgnoreReason(candidate.value, options.filter);
        if (reason) {
          ignored.push({ string: candidate, reason });
        } else {
          allStrings.push(candidate);
        }
      }
    } catch {
      parseErrors.push({ filePath, reason: 'unparseable_context' });
      if (options.verbose) {
        console.warn(`[scan] parse skipped: ${relative(rootPath, filePath)}`);
      }
    }
  }

  return { extracted: allStrings, ignored, parseErrors };
}
