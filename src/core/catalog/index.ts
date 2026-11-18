/**
 * Modèle de catalogue de messages : construction, merge incrémental, diff,
 * catalogues imbriqués, empreintes source et validation des placeholders. Pur, sans I/O.
 */

import { compareCodePoints, type Catalog } from '../types.js';
import { KeyAllocator } from '../keys/index.js';
import type { CatalogReferences } from '../scan/references.js';

export interface BuiltCatalog {
  catalog: Catalog;
  keyMap: Map<string, string>;
  added: string[];
  reused: string[];
}

function sortCatalog(catalog: Catalog): Catalog {
  return Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => compareCodePoints(a, b)));
}

export function buildSourceCatalog(
  values: string[],
  existing: Catalog = {},
  namespacesByValue?: ReadonlyMap<string, string>,
): BuiltCatalog {
  const valueToKey = new Map<string, string>();
  for (const [key, value] of Object.entries(existing)) {
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

    const key = allocator.allocate(value, namespacesByValue?.get(value));
    keyMap.set(value, key);
    added.push(key);
  }

  const catalog: Catalog = { ...existing };
  for (const [value, key] of keyMap) {
    catalog[key] = value;
  }

  return { catalog: sortCatalog(catalog), keyMap, added, reused };
}

export function missingKeys(source: Catalog, target: Catalog): string[] {
  return Object.keys(source).filter(key => !Object.hasOwn(target, key));
}

export function staleKeys(source: Catalog, target: Catalog): string[] {
  return Object.keys(target).filter(key => !Object.hasOwn(source, key));
}

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
export { flattenCatalog, unflattenCatalog, type NestedCatalog } from './flatten.js';
export { hashSourceText, computeSourceHashes, findOutdatedKeys } from './hashes.js';

export function mergeTranslations(
  source: Catalog,
  existingTarget: Catalog,
  newTranslations: Catalog,
): Catalog {
  const merged: Catalog = { ...existingTarget, ...newTranslations };
  const pruned: Catalog = {};
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(merged, key)) pruned[key] = merged[key];
  }
  return sortCatalog(pruned);
}
