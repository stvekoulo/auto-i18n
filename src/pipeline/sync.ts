/**
 * Pipeline `sync` : scanne le projet, met à jour le catalogue source (merge
 * stable), traduit les clés manquantes et écrit les catalogues cibles.
 *
 * Ne réécrit jamais le code source (modèle zéro-mutation).
 */

import { join, resolve } from 'path';
import { scanProject } from './scan.js';
import { translateCatalogs, type TranslateCatalogsResult } from './translate.js';
import { buildSourceCatalog } from '../core/catalog/index.js';
import type { Catalog, ExtractedString, Runtime } from '../core/types.js';
import { readCatalog, writeCatalog, ensureDir } from '../adapters/fs/index.js';
import type { TranslationProvider } from '../adapters/translation/index.js';

export interface RunSyncInput {
  projectRoot: string;
  provider: TranslationProvider;
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  ignore?: string[];
}

export interface SyncReport {
  filesScanned: number;
  parseErrors: string[];
  detected: { total: number; safe: number; review: number };
  reviewStrings: ExtractedString[];
  addedKeys: string[];
  reusedKeys: string[];
  sourceKeyCount: number;
  translation: TranslateCatalogsResult;
  /** Données brutes pour la génération du guide d'intégration. */
  strings: ExtractedString[];
  keyMap: Map<string, string>;
  fileRuntimes: Map<string, Runtime>;
}

export async function runSync(input: RunSyncInput): Promise<SyncReport> {
  const { projectRoot, provider, sourceLocale, targetLocales, messagesDir, ignore } = input;

  const scan = await scanProject(projectRoot, { ignorePatterns: ignore });

  const absMessagesDir = resolve(projectRoot, messagesDir);
  await ensureDir(absMessagesDir);
  const sourcePath = join(absMessagesDir, `${sourceLocale}.json`);
  const existingSource = await readCatalog(sourcePath);

  const values = scan.strings.map(s => s.value);
  const {
    catalog: sourceCatalog,
    keyMap,
    added,
    reused,
  } = buildSourceCatalog(values, existingSource);
  await writeCatalog(sourcePath, sourceCatalog);

  const existingTargets: Record<string, Catalog> = {};
  for (const locale of targetLocales) {
    existingTargets[locale] = await readCatalog(join(absMessagesDir, `${locale}.json`));
  }

  const translation = await translateCatalogs({
    provider,
    sourceLocale,
    sourceCatalog,
    targetLocales,
    existingTargets,
  });

  for (const result of translation.byLocale) {
    if (result.status === 'failed') continue; // on préserve le fichier existant
    await writeCatalog(join(absMessagesDir, `${result.locale}.json`), result.catalog);
  }

  let safe = 0;
  let review = 0;
  const reviewStrings: ExtractedString[] = [];
  for (const s of scan.strings) {
    if (s.safety === 'safe') safe++;
    else {
      review++;
      reviewStrings.push(s);
    }
  }

  return {
    filesScanned: scan.filesScanned,
    parseErrors: scan.parseErrors,
    detected: { total: scan.strings.length, safe, review },
    reviewStrings,
    addedKeys: added,
    reusedKeys: reused,
    sourceKeyCount: Object.keys(sourceCatalog).length,
    translation,
    strings: scan.strings,
    keyMap,
    fileRuntimes: scan.fileRuntimes,
  };
}
