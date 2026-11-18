/**
 * Pipeline `sync` : scanne le projet, met à jour le catalogue source (plat ou imbriqué),
 * détecte les textes source modifiés, traduit le manquant et écrit de façon atomique.
 */

import { join } from 'node:path';
import { scanProject, scanAdditionalReferences } from './scan.js';
import {
  translateCatalogs,
  type ProviderSource,
  type TranslateCatalogsResult,
} from './translate.js';
import {
  buildSourceCatalog,
  computeSourceHashes,
  findOutdatedKeys,
  orphanKeys,
  pruneCatalog,
} from '../core/catalog/index.js';
import { namespaceFromFilePath } from '../core/keys/index.js';
import type { Catalog, CatalogFormat, ExtractedString, Runtime } from '../core/types.js';
import type { TranslationTone } from '../adapters/translation/types.js';
import { readCatalog, writeCatalog, ensureDir } from '../adapters/fs/index.js';
import { readSourceHashes, writeSourceHashes } from '../adapters/fs/hashes.js';
import { withProjectLock } from '../adapters/fs/lock.js';
import { assertInsideProject } from '../utils/paths.js';

export interface RunSyncInput {
  projectRoot: string;
  provider: ProviderSource;
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  ignore?: string[];
  rootDirs?: string[];
  catalogFormat?: CatalogFormat;
  namespaceByFile?: boolean;
  tone?: TranslationTone;
  glossary?: Record<string, string>;
  prune?: boolean;
  dryRun?: boolean;
}

export interface SyncReport {
  dryRun?: boolean;
  pruneBlockedByDynamicKeys?: boolean;
  filesScanned: number;
  parseErrors: string[];
  detected: { total: number; safe: number; review: number };
  reviewStrings: ExtractedString[];
  addedKeys: string[];
  reusedKeys: string[];
  outdatedKeys: string[];
  sourceKeyCount: number;
  translation: TranslateCatalogsResult;
  orphanedKeys: string[];
  prunedKeys: string[];
  strings: ExtractedString[];
  keyMap: Map<string, string>;
  fileRuntimes: Map<string, Runtime>;
}

export async function runSync(input: RunSyncInput): Promise<SyncReport> {
  return withProjectLock(input.projectRoot, () => syncLocked(input), input.dryRun);
}

async function syncLocked(input: RunSyncInput): Promise<SyncReport> {
  const {
    projectRoot,
    provider,
    sourceLocale,
    targetLocales,
    messagesDir,
    ignore,
    rootDirs,
    catalogFormat = 'flat',
    namespaceByFile = false,
    tone,
    glossary,
    prune = false,
    dryRun = false,
  } = input;

  const absMessagesDir = await assertInsideProject(projectRoot, messagesDir);
  const scan = await scanProject(projectRoot, { ignorePatterns: ignore, rootDirs });
  const extra = await scanAdditionalReferences(projectRoot, scan.scannedFiles);

  if (prune && (scan.parseErrors.length > 0 || extra.parseErrors.length > 0)) {
    throw new Error('Purge refusée : scan incomplet (fichiers illisibles ou non parsables).');
  }

  const combinedRefs = {
    literals: [...new Set([...scan.references.literals, ...extra.references.literals])],
    dynamic: scan.references.dynamic || extra.references.dynamic,
  };

  const sourcePath = join(absMessagesDir, `${sourceLocale}.json`);
  const rawExistingSource = await readCatalog(sourcePath, catalogFormat);
  const previousHashes = await readSourceHashes(absMessagesDir);

  const values = scan.strings.map(s => s.value);
  const namespacesByValue =
    namespaceByFile && catalogFormat === 'nested'
      ? new Map(scan.strings.map(s => [s.value, namespaceFromFilePath(s.file)]))
      : undefined;

  const orphanedKeys = orphanKeys(rawExistingSource, [...values, ...extra.values], combinedRefs);
  const prunedKeys = prune ? orphanedKeys : [];
  const existingSource = prune ? pruneCatalog(rawExistingSource, orphanedKeys) : rawExistingSource;

  const {
    catalog: sourceCatalog,
    keyMap,
    added,
    reused,
  } = buildSourceCatalog(values, existingSource, namespacesByValue);

  const outdated = findOutdatedKeys(sourceCatalog, previousHashes);

  const contextsByKey: Record<string, string> = {};
  for (const s of scan.strings) {
    if (!s.contextHint) continue;
    const key = keyMap.get(s.value);
    if (key && !contextsByKey[key]) contextsByKey[key] = s.contextHint;
  }

  const existingTargets = Object.fromEntries(
    await Promise.all(
      targetLocales.map(
        async locale =>
          [
            locale,
            await readCatalog(join(absMessagesDir, `${locale}.json`), catalogFormat),
          ] as const,
      ),
    ),
  ) as Record<string, Catalog>;

  if (!dryRun) {
    await ensureDir(absMessagesDir);
    await writeCatalog(sourcePath, sourceCatalog, catalogFormat);
  }

  const translation = await translateCatalogs({
    provider,
    sourceLocale,
    sourceCatalog,
    targetLocales,
    existingTargets,
    outdatedKeys: outdated,
    contextsByKey,
    tone,
    glossary,
    dryRun,
  });

  if (!dryRun) {
    await Promise.all(
      translation.byLocale
        .filter(result => result.status !== 'failed')
        .map(result =>
          writeCatalog(
            join(absMessagesDir, `${result.locale}.json`),
            result.catalog,
            catalogFormat,
          ),
        ),
    );
    const updatedHashes = computeSourceHashes(sourceCatalog);
    // Si une clé modifiée a échoué sur au moins une locale, conserver son ancienne empreinte
    // afin qu'elle soit retentée au prochain sync.
    for (const failedKey of translation.failedKeys ?? []) {
      if (Object.hasOwn(previousHashes, failedKey)) {
        updatedHashes[failedKey] = previousHashes[failedKey];
      } else {
        delete updatedHashes[failedKey];
      }
    }
    if (translation.failed.length === 0) {
      await writeSourceHashes(absMessagesDir, updatedHashes);
    }
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
    dryRun,
    pruneBlockedByDynamicKeys: prune && combinedRefs.dynamic,
    filesScanned: scan.filesScanned,
    parseErrors: scan.parseErrors,
    detected: { total: scan.strings.length, safe, review },
    reviewStrings,
    addedKeys: added,
    reusedKeys: reused,
    outdatedKeys: outdated,
    sourceKeyCount: Object.keys(sourceCatalog).length,
    translation,
    orphanedKeys: prune ? [] : orphanedKeys,
    prunedKeys,
    strings: scan.strings,
    keyMap,
    fileRuntimes: scan.fileRuntimes,
  };
}
