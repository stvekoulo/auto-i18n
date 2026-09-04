/**
 * Pipeline de scan : collecte les fichiers (adapter fs), les scanne, puis
 * agrège le résultat.
 *
 * Le scan de chaque fichier est indépendant (aucun état partagé), ce qui
 * autorise deux régimes :
 * - petit projet : concurrence `async` bornée sur le thread principal ;
 * - gros projet : un pool de workers, parce que le parsing est gourmand en CPU
 *   et qu'une concurrence `async` ne le répartit sur aucun cœur supplémentaire.
 *
 * Le choix est automatique et le résultat identique dans les deux cas.
 */

import { collectSourceFiles, type CollectOptions } from '../adapters/fs/index.js';
import { scanOneFile } from '../adapters/worker/scan-file.js';
import { scanFilesInWorkers, plannedWorkerCount } from '../adapters/worker/pool.js';
import type { FileScanOutcome } from '../adapters/worker/protocol.js';
import type { IgnoredString } from '../core/scan/index.js';
import type { ExtractedString, Runtime } from '../core/types.js';
import type { FilterOptions } from '../core/filters/index.js';
import { mapWithConcurrency } from '../utils/concurrency.js';

export interface ScanProjectOptions extends CollectOptions, FilterOptions {
  /** Fichiers traités en parallèle sur le thread principal (défaut 16). */
  concurrency?: number;
  /**
   * Workers à démarrer. `0` force le scan sur le thread principal ; absent,
   * le pool décide selon le nombre de fichiers et de cœurs disponibles.
   */
  workers?: number;
  /**
   * Chemin du worker de scan compilé. Utile aux empaqueteurs qui déplacent les
   * fichiers émis hors de leur arborescence d'origine ; sinon résolu tout seul.
   */
  workerPath?: string;
}

export interface ProjectScanResult {
  strings: ExtractedString[];
  ignored: IgnoredString[];
  /** Fichiers non parsables (syntaxe invalide) — aucune mutation, juste signalés. */
  parseErrors: string[];
  filesScanned: number;
  /** Runtime détecté par fichier (chemin absolu → client/server). */
  fileRuntimes: Map<string, Runtime>;
  /** Workers réellement utilisés (`0` = scan sur le thread principal). */
  workersUsed: number;
}

const DEFAULT_CONCURRENCY = 16;

/** Scanne tout le projet et agrège les strings détectées. */
export async function scanProject(
  projectRoot: string,
  options: ScanProjectOptions = {},
): Promise<ProjectScanResult> {
  const files = await collectSourceFiles(projectRoot, options);

  const workerCount = options.workers ?? plannedWorkerCount(files.length);
  let outcomes: FileScanOutcome[] | null = null;
  if (workerCount > 0) {
    outcomes = await scanFilesInWorkers(files, options.blacklist, workerCount, options.workerPath);
  }

  // `null` : pool inapplicable (trop peu de fichiers, pas assez de cœurs, ou
  // exécution depuis les sources TypeScript sans worker compilé).
  const workersUsed = outcomes === null ? 0 : workerCount;
  outcomes ??= await mapWithConcurrency(files, options.concurrency ?? DEFAULT_CONCURRENCY, file =>
    scanOneFile(file, options.blacklist),
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
    if (outcome.runtime) fileRuntimes.set(outcome.file, outcome.runtime);
  }

  return {
    strings,
    ignored,
    parseErrors,
    filesScanned: files.length,
    fileRuntimes,
    workersUsed,
  };
}
