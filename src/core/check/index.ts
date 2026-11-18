/**
 * Calcul du rapport `check` — pur.
 */

import type { Catalog, ExtractedString } from '../types.js';
import { orphanKeys, placeholdersMatch } from '../catalog/index.js';
import type { CatalogReferences } from '../scan/references.js';

export interface CheckInput {
  sourceLocale?: string;
  references?: CatalogReferences;
  extraValues?: Iterable<string>;
  outdatedKeys?: string[];
  strings: ExtractedString[];
  filesScanned: number;
  parseErrors: string[];
  sourceCatalog: Catalog;
  targetCatalogs: Record<string, Catalog>;
}

export interface CheckReport {
  invalidByLocale?: Record<string, string[]>;
  /** Clés dont le texte source a été modifié depuis la dernière traduction. */
  outdatedKeys: string[];
  filesScanned: number;
  parseErrors: string[];
  detected: { total: number; safe: number; review: number };
  uncatalogued: string[];
  sourceKeyCount: number;
  missingByLocale: Record<string, string[]>;
  totalMissing: number;
  orphanedKeys: string[];
  ok: boolean;
}

export function buildCheckReport(input: CheckInput): CheckReport {
  const { strings, filesScanned, parseErrors, sourceCatalog, targetCatalogs } = input;
  const outdated = input.outdatedKeys ?? [];

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

  const allPresentValues = [...strings.map(s => s.value), ...(input.extraValues ?? [])];
  const orphanedKeys = orphanKeys(sourceCatalog, allPresentValues, input.references);

  return {
    invalidByLocale,
    outdatedKeys: outdated,
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
      outdated.length === 0 &&
      Object.keys(invalidByLocale).length === 0,
  };
}
