import { TranslationError } from './types.js';

/** Borne le corps JSON réellement envoyé, après protection XML/HTML des textes. */
export function translationBatches(
  texts: string[],
  body: (batch: string[]) => unknown,
  maxBytes: number,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  for (const text of texts) {
    const candidate = [...current, text];
    if (
      candidate.length > 50 ||
      Buffer.byteLength(JSON.stringify(body(candidate)), 'utf8') > maxBytes
    ) {
      if (current.length) batches.push(current);
      current = [text];
      if (Buffer.byteLength(JSON.stringify(body(current)), 'utf8') > maxBytes) {
        throw new TranslationError(
          'Texte trop volumineux pour la taille maximale d’une requête de traduction.',
          'bad_request',
          false,
        );
      }
    } else current = candidate;
  }
  if (current.length) batches.push(current);
  return batches;
}
