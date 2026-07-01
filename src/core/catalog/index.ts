/**
 * Modèle de catalogue de messages : construction, merge incrémental, diff,
 * et validation des placeholders. Pur, sans I/O.
 */

import type { Catalog } from '../types.js';
import { KeyAllocator } from '../keys/index.js';

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
  return Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
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
  return Object.keys(source).filter(key => !(key in target));
}

/** Clés présentes dans `target` mais plus dans `source` (obsolètes). */
export function staleKeys(source: Catalog, target: Catalog): string[] {
  return Object.keys(target).filter(key => !(key in source));
}

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

/** Ensemble trié des placeholders `{var}` présents dans un texte. */
export function extractPlaceholders(text: string): string[] {
  const matches = text.match(PLACEHOLDER_RE) ?? [];
  return [...new Set(matches)].sort();
}

/** Vrai si `source` et `translated` partagent exactement les mêmes placeholders. */
export function placeholdersMatch(source: string, translated: string): boolean {
  const a = extractPlaceholders(source);
  const b = extractPlaceholders(translated);
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

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
    if (key in merged) pruned[key] = merged[key];
  }
  return sortCatalog(pruned);
}
