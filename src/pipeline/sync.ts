/**
 * Pipeline `sync` : scanne le projet, met à jour le catalogue source (merge
 * stable), traduit les clés manquantes et écrit les catalogues cibles.
 *
 * Ne réécrit jamais le code source (modèle zéro-mutation).
 */

import { join, resolve } from 'path';
import { scanProject } from './scan.js';
import {
  translateCatalogs,
  type ProviderSource,
  type TranslateCatalogsResult,
} from './translate.js';
import { buildSourceCatalog, orphanKeys, pruneCatalog } from '../core/catalog/index.js';
import type { Catalog, ExtractedString, Runtime } from '../core/types.js';
import { readCatalog, writeCatalog, ensureDir } from '../adapters/fs/index.js';
import { withProjectLock } from '../adapters/fs/lock.js';

export interface RunSyncInput {
  projectRoot: string;
  /** Provider, ou fabrique appelée seulement s'il y a du texte à traduire. */
  provider: ProviderSource;
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  ignore?: string[];
  /** Dossiers racine a scanner (defaut : liste integree). */
  rootDirs?: string[];
  /**
   * Retire du catalogue source (et par ricochet de chaque locale cible) les
   * clés dont le texte n'est plus détecté dans le code. Sans cette option,
   * les clés orphelines sont seulement signalées (`orphanedKeys`), jamais
   * supprimées — un scan incomplet (fichier ignoré par erreur) ne doit pas
   * effacer des traductions au silence.
   */
  prune?: boolean;
  /** Aperçu : aucune écriture ni requête de traduction. */
  dryRun?: boolean;
}

export interface SyncReport {
  dryRun?: boolean;
  /** La purge a été neutralisée en présence de clés de traduction dynamiques. */
  pruneBlockedByDynamicKeys?: boolean;
  filesScanned: number;
  parseErrors: string[];
  detected: { total: number; safe: number; review: number };
  reviewStrings: ExtractedString[];
  addedKeys: string[];
  reusedKeys: string[];
  sourceKeyCount: number;
  translation: TranslateCatalogsResult;
  /** Clés orphelines détectées (texte disparu du code). Vide si `prune` est actif : déjà retirées. */
  orphanedKeys: string[];
  /** Clés retirées, ou prévues en aperçu (non vide seulement avec `prune: true`). */
  prunedKeys: string[];
  /** Données brutes pour la génération du guide d'intégration. */
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
    prune = false,
    dryRun = false,
  } = input;

  const scan = await scanProject(projectRoot, { ignorePatterns: ignore, rootDirs });
  // Avant une suppression, contrôler aussi les références dans les dossiers
  // exclus de la traduction. Les dépendances et sorties générées restent exclues.
  const referenceScan = prune ? await scanProject(projectRoot, { allRoots: true }) : scan;
  if (prune && referenceScan.parseErrors.length > 0) {
    throw new Error('Purge refusée : scan incomplet (fichiers illisibles ou non parsables).');
  }

  const absMessagesDir = resolve(projectRoot, messagesDir);
  const sourcePath = join(absMessagesDir, `${sourceLocale}.json`);
  const rawExistingSource = await readCatalog(sourcePath);

  const values = scan.strings.map(s => s.value);

  // Détection avant toute mutation : la liste rapportée doit refléter l'état
  // réel du catalogue au début du run, que `prune` soit actif ou non.
  const orphanedKeys = orphanKeys(
    rawExistingSource,
    [...values, ...referenceScan.strings.map(s => s.value)],
    referenceScan.references,
  );
  const prunedKeys = prune ? orphanedKeys : [];
  const existingSource = prune ? pruneCatalog(rawExistingSource, orphanedKeys) : rawExistingSource;

  const {
    catalog: sourceCatalog,
    keyMap,
    added,
    reused,
  } = buildSourceCatalog(values, existingSource);

  const existingTargets = Object.fromEntries(
    await Promise.all(
      targetLocales.map(
        async locale =>
          [locale, await readCatalog(join(absMessagesDir, `${locale}.json`))] as const,
      ),
    ),
  ) as Record<string, Catalog>;

  // Valider tous les fichiers avant de modifier le premier catalogue.
  if (!dryRun) {
    await ensureDir(absMessagesDir);
    await writeCatalog(sourcePath, sourceCatalog);
  }

  const translation = await translateCatalogs({
    provider,
    sourceLocale,
    sourceCatalog,
    targetLocales,
    existingTargets,
    dryRun,
  });

  if (!dryRun)
    await Promise.all(
      translation.byLocale
        // Une locale en échec garde son fichier existant intact.
        .filter(result => result.status !== 'failed')
        .map(result => writeCatalog(join(absMessagesDir, `${result.locale}.json`), result.catalog)),
    );

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
    pruneBlockedByDynamicKeys: prune && referenceScan.references.dynamic,
    filesScanned: scan.filesScanned,
    parseErrors: scan.parseErrors,
    detected: { total: scan.strings.length, safe, review },
    reviewStrings,
    addedKeys: added,
    reusedKeys: reused,
    sourceKeyCount: Object.keys(sourceCatalog).length,
    translation,
    orphanedKeys: prune ? [] : orphanedKeys,
    prunedKeys,
    strings: scan.strings,
    keyMap,
    fileRuntimes: scan.fileRuntimes,
  };
}
