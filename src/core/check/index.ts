/**
 * Calcul du rapport `check` — pur. Compare les strings détectées dans le code
 * aux catalogues (source + cibles) et produit un diagnostic.
 *
 * Sémantique (modèle zéro-mutation) :
 * - une string détectée = string brute encore dans le code (non câblée en `t()`).
 * - `uncatalogued` = strings détectées absentes du catalogue source → `sync` les ajouterait.
 * - `missingByLocale` = clés du catalogue source absentes d'une locale cible.
 */

import type { Catalog, ExtractedString } from '../types.js';
import { orphanKeys, placeholdersMatch } from '../catalog/index.js';
import type { CatalogReferences } from '../scan/references.js';

export interface CheckInput {
  sourceLocale?: string;
  references?: CatalogReferences;
  strings: ExtractedString[];
  filesScanned: number;
  parseErrors: string[];
  sourceCatalog: Catalog;
  targetCatalogs: Record<string, Catalog>;
}

export interface CheckReport {
  invalidByLocale?: Record<string, string[]>;
  filesScanned: number;
  parseErrors: string[];
  detected: { total: number; safe: number; review: number };
  /** Valeurs détectées absentes du catalogue source (un `sync` les cataloguerait). */
  uncatalogued: string[];
  sourceKeyCount: number;
  missingByLocale: Record<string, string[]>;
  totalMissing: number;
  /**
   * Clés du catalogue source dont le texte n'est plus détecté dans le code
   * (`sync --prune` les retire). Informatif — n'affecte pas `ok`, une string
   * temporairement invisible au scan (fichier ignoré, erreur de parsing) ne
   * doit pas faire échouer la CI.
   */
  orphanedKeys: string[];
  /** true si aucun travail en attente : rien à cataloguer et traductions complètes. */
  ok: boolean;
}

export function buildCheckReport(input: CheckInput): CheckReport {
  const { strings, filesScanned, parseErrors, sourceCatalog, targetCatalogs } = input;

  let safe = 0;
  let review = 0;
  for (const s of strings) {
    if (s.safety === 'safe') safe++;
    else review++;
  }

  const cataloguedValues = new Set(Object.values(sourceCatalog));
  const uncatalogued = [
    ...new Set(strings.map(s => s.value).filter(v => !cataloguedValues.has(v))),
  ];

  const sourceKeys = Object.keys(sourceCatalog);
  const missingByLocale: Record<string, string[]> = {};
  let totalMissing = 0;
  const invalidByLocale: Record<string, string[]> = {};
  const invalidSource = sourceKeys.filter(
    key => !placeholdersMatch(sourceCatalog[key], sourceCatalog[key]),
  );
  if (invalidSource.length) invalidByLocale[input.sourceLocale ?? 'source'] = invalidSource;
  for (const [locale, catalog] of Object.entries(targetCatalogs)) {
    const missing = sourceKeys.filter(key => !Object.hasOwn(catalog, key));
    missingByLocale[locale] = missing;
    totalMissing += missing.length;
    const invalid = sourceKeys.filter(
      key => Object.hasOwn(catalog, key) && !placeholdersMatch(sourceCatalog[key], catalog[key]),
    );
    if (invalid.length) invalidByLocale[locale] = invalid;
  }

  const orphanedKeys = orphanKeys(
    sourceCatalog,
    strings.map(s => s.value),
    input.references,
  );

  return {
    invalidByLocale,
    filesScanned,
    parseErrors,
    detected: { total: strings.length, safe, review },
    uncatalogued,
    sourceKeyCount: sourceKeys.length,
    missingByLocale,
    totalMissing,
    orphanedKeys,
    ok:
      parseErrors.length === 0 &&
      uncatalogued.length === 0 &&
      totalMissing === 0 &&
      Object.keys(invalidByLocale).length === 0,
  };
}
