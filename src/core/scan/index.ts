/**
 * Scan d'un fichier : extraction + filtrage heuristique.
 *
 * Pur (prend un AST déjà parsé). La collecte des fichiers sur disque est faite
 * par `src/adapters/fs`, qui fournit ici le contenu déjà lu.
 */

import type { SourceFile } from 'ts-morph';
import type { ExtractedString, Runtime } from '../types.js';
import { extractStrings, detectRuntime } from '../extraction/index.js';
import { getIgnoreReason, type FilterOptions, type IgnoreReason } from '../filters/index.js';
import { parseSource, getSyntaxErrors } from '../extraction/parse.js';

export interface IgnoredString {
  value: string;
  file: string;
  line: number;
  column: number;
  reason: IgnoreReason;
}

export interface FileScanResult {
  /** Strings retenues comme traduisibles. */
  strings: ExtractedString[];
  /** Strings écartées par les heuristiques (utile pour le diagnostic). */
  ignored: IgnoredString[];
  /** Runtime du fichier (client/server) — pour guider le câblage. */
  runtime: Runtime;
  /** Erreurs de syntaxe ; non vide ⇒ le reste du résultat n'est pas fiable. */
  syntaxErrors: string[];
}

/** Scanne un AST déjà parsé. */
export function scanSourceFile(
  sourceFile: SourceFile,
  file: string,
  options: FilterOptions = {},
): FileScanResult {
  const syntaxErrors = getSyntaxErrors(sourceFile);
  const runtime = detectRuntime(sourceFile);
  // Arbre partiel : l'extraction ressortirait vide ou fausse. On s'arrête ici.
  if (syntaxErrors.length > 0) return { strings: [], ignored: [], runtime, syntaxErrors };

  const strings: ExtractedString[] = [];
  const ignored: IgnoredString[] = [];

  for (const candidate of extractStrings(sourceFile, file)) {
    const reason = getIgnoreReason(candidate.value, options);
    if (reason) {
      ignored.push({
        value: candidate.value,
        file: candidate.file,
        line: candidate.line,
        column: candidate.column,
        reason,
      });
    } else {
      strings.push(candidate);
    }
  }

  return { strings, ignored, runtime, syntaxErrors };
}

/** Scanne un contenu source brut (parse + scan). Pratique pour les tests. */
export function scanContent(
  content: string,
  file: string,
  options: FilterOptions = {},
): FileScanResult {
  return scanSourceFile(parseSource(content, file), file, options);
}
