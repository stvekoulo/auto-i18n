/**
 * Scan d'un fichier unique — le travail élémentaire, identique qu'il tourne
 * sur le thread principal ou dans un worker.
 */

import { readText } from '../fs/index.js';
import { scanContent } from '../../core/scan/index.js';
import type { FileScanOutcome } from './protocol.js';

function unreadable(file: string): FileScanOutcome {
  return { file, strings: [], ignored: [], runtime: null, parseError: true };
}

/**
 * Lit et scanne un fichier. Illisible, non parsable ou syntaxiquement invalide :
 * le fichier ressort en `parseError` plutôt qu'en résultat vide, pour être
 * signalé au lieu d'être compté comme « scanné, 0 string ».
 */
export async function scanOneFile(file: string, blacklist?: string[]): Promise<FileScanOutcome> {
  let content: string;
  try {
    content = await readText(file);
  } catch {
    return unreadable(file);
  }

  try {
    const result = scanContent(content, file, { blacklist });
    if (result.syntaxErrors.length > 0) return unreadable(file);
    return {
      file,
      strings: result.strings,
      ignored: result.ignored,
      runtime: result.runtime,
      parseError: false,
    };
  } catch {
    return unreadable(file);
  }
}
