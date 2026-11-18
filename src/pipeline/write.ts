/**
 * Pipeline `write` (opt-in, `sync --write`) : câble mécaniquement les strings
 * `safety: 'safe'` en `t()` dans le code source, fichier par fichier.
 */

import { readText, writeText, backupFile } from '../adapters/fs/index.js';
import { parseSource } from '../core/extraction/index.js';
import { computeWriteEdits, applyEdits, type WriteSkip } from '../core/write/index.js';
import type { ExtractedString, Runtime, TranslationFramework } from '../core/types.js';
import { assertInsideProject } from '../utils/paths.js';

export interface RunWriteInput {
  projectRoot?: string;
  strings: ExtractedString[];
  keyMap: Map<string, string>;
  fileRuntimes: Map<string, Runtime>;
  dryRun?: boolean;
  /** Désactive la création des fichiers `.backup` (ex. dépôt Git propre). */
  noBackup?: boolean;
  framework?: TranslationFramework;
}

export interface FileWriteOutcome {
  file: string;
  written: number;
  skipped: WriteSkip[];
  before: string;
  after: string;
}

export interface WriteReport {
  dryRun: boolean;
  noBackup?: boolean;
  files: FileWriteOutcome[];
  filesChanged: number;
  stringsWritten: number;
  stringsSkipped: number;
}

export async function runWrite(input: RunWriteInput): Promise<WriteReport> {
  const { strings, keyMap, fileRuntimes, dryRun = false, noBackup = false } = input;

  const safeFiles = new Set(strings.filter(s => s.safety === 'safe').map(s => s.file));

  const files: FileWriteOutcome[] = [];
  let stringsWritten = 0;
  let stringsSkipped = 0;

  for (const file of safeFiles) {
    if (input.projectRoot) {
      await assertInsideProject(input.projectRoot, file);
    }
    const runtime = fileRuntimes.get(file) ?? 'server';
    let before: string;
    try {
      before = await readText(file);
    } catch {
      continue;
    }

    const sourceFile = parseSource(before, file);
    const result = computeWriteEdits(sourceFile, file, runtime, keyMap, input.framework);
    stringsSkipped += result.skipped.length;

    if (result.edits.length === 0) {
      if (result.skipped.length > 0) {
        files.push({ file, written: 0, skipped: result.skipped, before, after: before });
      }
      continue;
    }

    const after = applyEdits(before, result.edits);
    stringsWritten += result.written;
    files.push({ file, written: result.written, skipped: result.skipped, before, after });

    if (!dryRun) {
      if (!noBackup) await backupFile(file);
      await writeText(file, after);
    }
  }

  return {
    dryRun,
    noBackup,
    files,
    filesChanged: files.filter(f => f.written > 0).length,
    stringsWritten,
    stringsSkipped,
  };
}
