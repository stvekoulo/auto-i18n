/**
 * Gestion des sauvegardes `.backup` créées par `sync --write` et le scaffold :
 * - `runCleanBackups`   : supprime les fichiers `*.backup*` du projet
 * - `runRestoreBackups` : restaure chaque fichier depuis sa sauvegarde initiale puis nettoie
 */

import { copyFile, readdir, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { withProjectLock } from '../adapters/fs/lock.js';
import { assertInsideProject } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.tmp',
  '.expo',
  '.auto-i18n.lock',
]);

const BACKUP_SUFFIX_RE = /\.backup(?:\.(\d+))?$/;

export interface BackupEntry {
  backupPath: string;
  originalPath: string;
  order: number;
}

export async function findProjectBackups(projectRoot: string): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (SKIP_DIRS.has(item.name)) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!item.isFile()) continue;
      const match = BACKUP_SUFFIX_RE.exec(item.name);
      if (!match) continue;
      const originalPath = full.slice(0, full.length - match[0].length);
      const order = match[1] ? Number.parseInt(match[1], 10) : 1;
      entries.push({ backupPath: full, originalPath, order });
    }
  }

  await walk(projectRoot);
  return entries.sort((a, b) => a.originalPath.localeCompare(b.originalPath) || a.order - b.order);
}

export interface CleanBackupsOptions {
  projectRoot: string;
  dryRun?: boolean;
}

export interface CleanBackupsResult {
  removedFiles: string[];
  dryRun: boolean;
}

export async function runCleanBackups(options: CleanBackupsOptions): Promise<CleanBackupsResult> {
  const { projectRoot, dryRun = false } = options;
  return withProjectLock(
    projectRoot,
    async () => {
      const backups = await findProjectBackups(projectRoot);
      const removedFiles: string[] = [];
      for (const b of backups) {
        await assertInsideProject(projectRoot, b.backupPath);
        if (!dryRun) await unlink(b.backupPath);
        removedFiles.push(b.backupPath);
      }
      logger.success(
        `${removedFiles.length} sauvegarde(s) ${dryRun ? 'détectée(s) (aperçu)' : 'supprimée(s)'}.`,
      );
      return { removedFiles, dryRun };
    },
    dryRun,
  );
}

export interface RestoreBackupsOptions {
  projectRoot: string;
  dryRun?: boolean;
}

export interface RestoreBackupsResult {
  restoredFiles: string[];
  removedBackups: string[];
  dryRun: boolean;
}

export async function runRestoreBackups(
  options: RestoreBackupsOptions,
): Promise<RestoreBackupsResult> {
  const { projectRoot, dryRun = false } = options;
  return withProjectLock(
    projectRoot,
    async () => {
      const backups = await findProjectBackups(projectRoot);
      const grouped = new Map<string, BackupEntry[]>();
      for (const b of backups) {
        const list = grouped.get(b.originalPath) ?? [];
        list.push(b);
        grouped.set(b.originalPath, list);
      }

      const restoredFiles: string[] = [];
      const removedBackups: string[] = [];

      for (const [originalPath, list] of grouped) {
        await assertInsideProject(projectRoot, originalPath);
        // `list[0]` est la sauvegarde `.backup` initiale (avant toute réécriture ultérieure).
        const earliest = list[0];
        if (!dryRun) {
          await copyFile(earliest.backupPath, originalPath);
          for (const b of list) {
            await assertInsideProject(projectRoot, b.backupPath);
            await unlink(b.backupPath);
            removedBackups.push(b.backupPath);
          }
        } else {
          for (const b of list) removedBackups.push(b.backupPath);
        }
        restoredFiles.push(originalPath);
        logger.info(
          `${dryRun ? '[aperçu] ' : ''}Restauré : ${relative(projectRoot, originalPath)}`,
        );
      }

      logger.success(
        `${restoredFiles.length} fichier(s) ${dryRun ? 'seraient restauré(s)' : 'restauré(s)'}.`,
      );
      return { restoredFiles, removedBackups, dryRun };
    },
    dryRun,
  );
}
