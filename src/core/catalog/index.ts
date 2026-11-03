/**
 * Modèle de catalogue de messages : construction, merge incrémental, diff,
 * et validation des placeholders. Pur, sans I/O.
 */

import { compareCodePoints, type Catalog } from '../types.js';
import { KeyAllocator } from '../keys/index.js';
import type { CatalogReferences } from '../scan/references.js';

export interface BuiltCatalog {
  /** Catalogue complet (existant + nouvelles clés), trié alphabétiquement. */
  catalog: Catalog;
  /** valeur source → clé i18n (utile pour le guide / un futur codemod). */
  keyMap: Map<string, string>;
  /** Clés nouvellement créées lors de ce build. */
  added: string[];
  /** Clés réutilisées depuis le catalogue existant. */
  reused: string[];
}

function sortCatalog(catalog: Catalog): Catalog {
  return Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => compareCodePoints(a, b)));
}

/**
 * Construit le catalogue source à partir de valeurs uniques détectées, en
 * réutilisant les clés du catalogue existant (merge stable et déterministe).
 *
 * @param values   Valeurs de strings (ordre = ordre d'apparition souhaité).
 * @param existing Catalogue source déjà présent (clé → valeur).
 */
export function buildSourceCatalog(values: string[], existing: Catalog = {}): BuiltCatalog {
  const valueToKey = new Map<string, string>();
  for (const [key, value] of Object.entries(existing)) {
    // Première clé gagnante en cas de doublons de valeur dans l'existant.
    if (!valueToKey.has(value)) valueToKey.set(value, key);
  }

  const allocator = new KeyAllocator(Object.keys(existing));
  const keyMap = new Map<string, string>();
  const added: string[] = [];
  const reused: string[] = [];

  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);

    const existingKey = valueToKey.get(value);
    if (existingKey) {
      keyMap.set(value, existingKey);
      reused.push(existingKey);
      continue;
    }

    const key = allocator.allocate(value);
    keyMap.set(value, key);
    added.push(key);
  }

  const catalog: Catalog = { ...existing };
  for (const [value, key] of keyMap) {
    catalog[key] = value;
  }

  return { catalog: sortCatalog(catalog), keyMap, added, reused };
}

/** Clés présentes dans `source` mais absentes de `target`. */
export function missingKeys(source: Catalog, target: Catalog): string[] {
  return Object.keys(source).filter(key => !Object.hasOwn(target, key));
}

/** Clés présentes dans `target` mais plus dans `source` (obsolètes). */
export function staleKeys(source: Catalog, target: Catalog): string[] {
  return Object.keys(target).filter(key => !Object.hasOwn(source, key));
}

/**
 * Clés du catalogue source dont le texte n'est plus détecté dans le code.
 *
 * `buildSourceCatalog` ne retire jamais une clé de son côté (merge additif :
 * l'historique des traductions déjà payées ne doit pas disparaître au moindre
 * scan incomplet). Une string supprimée du code laisse donc sa clé accumulée
 * indéfiniment dans le catalogue — `check` la signale, `sync --prune` la retire.
 */
export function orphanKeys(
  sourceCatalog: Catalog,
  scannedValues: Iterable<string>,
  references?: CatalogReferences,
): string[] {
  if (references?.dynamic) return [];
  const present = new Set(scannedValues);
  const mentioned = new Set(references?.literals);
  return Object.keys(sourceCatalog).filter(
    key =>
      !present.has(sourceCatalog[key]) &&
      !mentioned.has(key) &&
      !key.split('.').some((_, index, parts) => mentioned.has(parts.slice(index).join('.'))),
  );
}

/** Retire `keysToRemove` d'un catalogue (utilisé par `sync --prune`). */
export function pruneCatalog(catalog: Catalog, keysToRemove: readonly string[]): Catalog {
  if (keysToRemove.length === 0) return catalog;
  const drop = new Set(keysToRemove);
  const pruned: Catalog = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (!drop.has(key)) pruned[key] = value;
  }
  return pruned;
}

export { extractPlaceholders, placeholdersMatch } from './icu.js';

/** Trie un catalogue cible et garde uniquement les clés présentes en source. */
export function mergeTranslations(
  source: Catalog,
  existingTarget: Catalog,
  newTranslations: Catalog,
): Catalog {
  const merged: Catalog = { ...existingTarget, ...newTranslations };
  // On ne conserve que les clés encore présentes dans la source.
  const pruned: Catalog = {};
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(merged, key)) pruned[key] = merged[key];
  }
  return sortCatalog(pruned);
}
