/**
 * Empreintes déterministes des textes du catalogue source.
 *
 * Permet de détecter lorsqu'un texte source existant a été modifié manuellement
 * dans `<sourceLocale>.json` afin de re-traduire automatiquement ses clés cibles.
 */

import { createHash } from 'node:crypto';
import { compareCodePoints, type Catalog } from '../types.js';

export function hashSourceText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export function computeSourceHashes(catalog: Catalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(catalog).sort(compareCodePoints)) {
    out[key] = hashSourceText(catalog[key]);
  }
  return out;
}

/**
 * Clés déjà enregistrées dans `previousHashes` dont le texte source actuel a changé.
 * Si `previousHashes` est vide (premier passage), renvoie `[]` pour préserver l'existant.
 */
export function findOutdatedKeys(
  sourceCatalog: Catalog,
  previousHashes: Record<string, string> = {},
): string[] {
  return Object.keys(sourceCatalog).filter(
    key =>
      Object.hasOwn(previousHashes, key) &&
      previousHashes[key] !== hashSourceText(sourceCatalog[key]),
  );
}
