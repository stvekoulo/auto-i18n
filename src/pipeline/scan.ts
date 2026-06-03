/**
 * Pipeline de scan : collecte les fichiers (adapter fs), les parse et les scanne
 * (core), puis agrège le résultat. Combine core (pur) et adapters (I/O).
 */

import { collectSourceFiles, readText, type CollectOptions } from '../adapters/fs/index.js';
import { scanContent, type IgnoredString } from '../core/scan/index.js';
import type { ExtractedString, Runtime } from '../core/types.js';
import type { FilterOptions } from '../core/filters/index.js';

export interface ScanProjectOptions extends CollectOptions, FilterOptions {}

export interface ProjectScanResult {
  strings: ExtractedString[];
  ignored: IgnoredString[];
  /** Fichiers non parsables (syntaxe invalide) — aucune mutation, juste signalés. */
  parseErrors: string[];
  filesScanned: number;
  /** Runtime détecté par fichier (chemin absolu → client/server). */
  fileRuntimes: Map<string, Runtime>;
}

/** Scanne tout le projet et agrège les strings détectées. */
export async function scanProject(
  projectRoot: string,
  options: ScanProjectOptions = {},
): Promise<ProjectScanResult> {
  const files = await collectSourceFiles(projectRoot, options);
  const strings: ExtractedString[] = [];
  const ignored: IgnoredString[] = [];
  const parseErrors: string[] = [];
  const fileRuntimes = new Map<string, Runtime>();

  for (const file of files) {
    let content: string;
    try {
      content = await readText(file);
    } catch {
      parseErrors.push(file);
      continue;
    }

    try {
      const result = scanContent(content, file, { blacklist: options.blacklist });
      strings.push(...result.strings);
      ignored.push(...result.ignored);
      fileRuntimes.set(file, result.runtime);
    } catch {
      parseErrors.push(file);
    }
  }

  return { strings, ignored, parseErrors, filesScanned: files.length, fileRuntimes };
}
