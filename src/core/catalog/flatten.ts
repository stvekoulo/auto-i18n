/**
 * Aplatissement / dé-aplatissement déterministe des catalogues JSON imbriqués (`nested`).
 *
 * Permet au pipeline interne de manipuler un unique format `Catalog` (`Record<string, string>`)
 * tout en lisant et écrivant des arborescences `{ "Header": { "title": "Bonjour" } }`.
 */

import { compareCodePoints, type Catalog } from '../types.js';

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export type NestedCatalog = { [key: string]: string | NestedCatalog };

export function flattenCatalog(input: Record<string, unknown>, prefix = ''): Catalog {
  const out: Catalog = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_SEGMENTS.has(key)) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[fullKey] = value;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(out, flattenCatalog(value as Record<string, unknown>, fullKey));
    } else {
      throw new Error(`la clé "${fullKey}" doit contenir une chaîne ou un sous-objet JSON`);
    }
  }
  return out;
}

export function unflattenCatalog(catalog: Catalog): NestedCatalog {
  const root: NestedCatalog = {};
  const sortedKeys = Object.keys(catalog).sort(compareCodePoints);

  for (const fullKey of sortedKeys) {
    const parts = fullKey
      .split('.')
      .filter(part => part.length > 0 && !FORBIDDEN_SEGMENTS.has(part));
    if (parts.length === 0) continue;

    let cursor: NestedCatalog = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const existing = cursor[segment];
      if (typeof existing === 'object' && existing !== null) {
        cursor = existing;
      } else {
        const branch: NestedCatalog = {};
        cursor[segment] = branch;
        cursor = branch;
      }
    }
    cursor[parts[parts.length - 1]] = catalog[fullKey];
  }
  return root;
}
