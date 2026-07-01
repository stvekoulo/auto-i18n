/**
 * Pipeline de scan : collecte les fichiers (adapter fs), les parse et les scanne
 * (core), puis agrège le résultat. Combine core (pur) et adapters (I/O).
 *
 * La lecture + le parsing de chaque fichier sont indépendants (aucun état
 * partagé) : on les exécute avec une concurrence bornée pour accélérer les
 * gros projets sans saturer les descripteurs de fichiers.
 */

import { collectSourceFiles, readText, type CollectOptions } from '../adapters/fs/index.js';
import { scanContent, type IgnoredString } from '../core/scan/index.js';
import type { ExtractedString, Runtime } from '../core/types.js';
import type { FilterOptions } from '../core/filters/index.js';

export interface ScanProjectOptions extends CollectOptions, FilterOptions {
  /** Nombre de fichiers traités en parallèle (défaut 16). */
  concurrency?: number;
}

export interface ProjectScanResult {
  strings: ExtractedString[];
  ignored: IgnoredString[];
  /** Fichiers non parsables (syntaxe invalide) — aucune mutation, juste signalés. */
  parseErrors: string[];
  filesScanned: number;
  /** Runtime détecté par fichier (chemin absolu → client/server). */
  fileRuntimes: Map<string, Runtime>;
}

const DEFAULT_CONCURRENCY = 16;

interface FileScanOutcome {
  file: string;
  strings: ExtractedString[];
  ignored: IgnoredString[];
  runtime: Runtime | null;
  parseError: boolean;
}

async function scanOneFile(file: string, blacklist?: string[]): Promise<FileScanOutcome> {
  let content: string;
  try {
    content = await readText(file);
  } catch {
    return { file, strings: [], ignored: [], runtime: null, parseError: true };
  }

  try {
    const result = scanContent(content, file, { blacklist });
    return {
      file,
      strings: result.strings,
      ignored: result.ignored,
      runtime: result.runtime,
      parseError: false,
    };
  } catch {
    return { file, strings: [], ignored: [], runtime: null, parseError: true };
  }
}

/** Applique `worker` sur `items` avec au plus `concurrency` exécutions simultanées. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function runNext(): Promise<void> {
    const index = next++;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

/** Scanne tout le projet et agrège les strings détectées. */
export async function scanProject(
  projectRoot: string,
  options: ScanProjectOptions = {},
): Promise<ProjectScanResult> {
  const files = await collectSourceFiles(projectRoot, options);
  const outcomes = await mapWithConcurrency(
    files,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    file => scanOneFile(file, options.blacklist),
  );

  const strings: ExtractedString[] = [];
  const ignored: IgnoredString[] = [];
  const parseErrors: string[] = [];
  const fileRuntimes = new Map<string, Runtime>();

  for (const outcome of outcomes) {
    if (outcome.parseError) {
      parseErrors.push(outcome.file);
      continue;
    }
    strings.push(...outcome.strings);
    ignored.push(...outcome.ignored);
    fileRuntimes.set(outcome.file, outcome.runtime as Runtime);
  }

  return { strings, ignored, parseErrors, filesScanned: files.length, fileRuntimes };
}
