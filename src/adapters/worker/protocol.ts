/**
 * Contrat de messages entre le thread principal et les workers de scan.
 *
 * Tout ce qui traverse la frontière doit survivre à l'algorithme de clonage
 * structuré : uniquement des données, jamais un nœud d'AST. C'est possible
 * parce que le scan ne renvoie que des objets plats — le codemod `--write`,
 * lui, reparse dans le thread principal et n'emprunte pas ce chemin.
 */

import type { IgnoredString } from '../../core/scan/index.js';
import type { ExtractedString, Runtime } from '../../core/types.js';

/** Résultat du scan d'un fichier, sérialisable tel quel. */
export interface FileScanOutcome {
  file: string;
  strings: ExtractedString[];
  ignored: IgnoredString[];
  runtime: Runtime | null;
  parseError: boolean;
}

/** Thread principal → worker : un lot de fichiers à traiter. */
export interface ScanRequest {
  files: string[];
  blacklist?: string[];
}

/** Worker → thread principal : les résultats du lot précédent. */
export interface ScanResponse {
  outcomes: FileScanOutcome[];
}
