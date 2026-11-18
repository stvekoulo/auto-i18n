/**
 * Pipeline de scan : collecte les fichiers (adapter fs), les scanne, puis
 * agrège le résultat. Inclut aussi un scan différentiel des dossiers hors `rootDirs`
 * pour garantir la parité de détection des références entre `check` et `sync --prune`.
 */

import { collectSourceFiles, type CollectOptions } from '../adapters/fs/index.js';
import { scanOneFile } from '../adapters/worker/scan-file.js';
import { scanFilesInWorkers, plannedWorkerCount } from '../adapters/worker/pool.js';
import type { FileScanOutcome } from '../adapters/worker/protocol.js';
import type { IgnoredString } from '../core/scan/index.js';
import type { ExtractedString, Runtime } from '../core/types.js';
import type { FilterOptions } from '../core/filters/index.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import type { CatalogReferences } from '../core/scan/references.js';

export interface ScanProjectOptions extends CollectOptions, FilterOptions {
  concurrency?: number;
  workers?: number;
  workerPath?: string;
}

export interface ProjectScanResult {
  references: CatalogReferences;
  strings: ExtractedString[];
  ignored: IgnoredString[];
  parseErrors: string[];
  filesScanned: number;
  scannedFiles: string[];
  fileRuntimes: Map<string, Runtime>;
  workersUsed: number;
}

const DEFAULT_CONCURRENCY = 16;

async function scanFileList(
  files: string[],
  options: ScanProjectOptions,
): Promise<{ outcomes: FileScanOutcome[]; workersUsed: number }> {
  const workerCount = options.workers ?? plannedWorkerCount(files.length);
  let outcomes: FileScanOutcome[] | null = null;
  if (workerCount > 0) {
    outcomes = await scanFilesInWorkers(files, options.blacklist, workerCount, options.workerPath);
  }
  const workersUsed = outcomes === null ? 0 : workerCount;
  outcomes ??= await mapWithConcurrency(files, options.concurrency ?? DEFAULT_CONCURRENCY, file =>
    scanOneFile(file, options.blacklist),
  );
  return { outcomes, workersUsed };
}

function aggregateOutcomes(
  files: string[],
  outcomes: FileScanOutcome[],
  workersUsed: number,
): ProjectScanResult {
  const strings: ExtractedString[] = [];
  const ignored: IgnoredString[] = [];
  const parseErrors: string[] = [];
  const fileRuntimes = new Map<string, Runtime>();
  const literals = new Set<string>();
  let dynamic = false;

  for (const outcome of outcomes) {
    for (const literal of outcome.references.literals) literals.add(literal);
    dynamic ||= outcome.references.dynamic;
    if (outcome.parseError) {
      parseErrors.push(outcome.file);
      continue;
    }
    strings.push(...outcome.strings);
    ignored.push(...outcome.ignored);
    if (outcome.runtime) fileRuntimes.set(outcome.file, outcome.runtime);
  }

  return {
    references: { literals: [...literals], dynamic },
    strings,
    ignored,
    parseErrors,
    filesScanned: files.length,
    scannedFiles: files,
    fileRuntimes,
    workersUsed,
  };
}

/** Scanne tout le projet et agrège les strings détectées. */
export async function scanProject(
  projectRoot: string,
  options: ScanProjectOptions = {},
): Promise<ProjectScanResult> {
  const files = await collectSourceFiles(projectRoot, options);
  const { outcomes, workersUsed } = await scanFileList(files, options);
  return aggregateOutcomes(files, outcomes, workersUsed);
}

/**
 * Scanne uniquement les fichiers applicatifs non couverts par un premier scan
 * (ex. hors `rootDirs` ou exclus de l'extraction), sans jamais reparser deux fois un fichier.
 */
export async function scanAdditionalReferences(
  projectRoot: string,
  alreadyScanned: readonly string[],
): Promise<{ references: CatalogReferences; values: string[]; parseErrors: string[] }> {
  const seen = new Set(alreadyScanned);
  const allFiles = await collectSourceFiles(projectRoot, { allRoots: true });
  const deltaFiles = allFiles.filter(f => !seen.has(f));
  if (deltaFiles.length === 0) {
    return { references: { literals: [], dynamic: false }, values: [], parseErrors: [] };
  }
  const { outcomes } = await scanFileList(deltaFiles, {});
  const agg = aggregateOutcomes(deltaFiles, outcomes, 0);
  return {
    references: agg.references,
    values: agg.strings.map(s => s.value),
    parseErrors: agg.parseErrors,
  };
}
