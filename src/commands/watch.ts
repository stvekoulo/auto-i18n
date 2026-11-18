/**
 * Mode `sync --watch` : surveille les fichiers applicatifs et déclenche une
 * synchronisation coalescée (sans boucle infinie sur les catalogues ou verrous).
 */

import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { extname, join, normalize, relative } from 'node:path';
import { loadConfig } from '../config/index.js';
import { fileExists } from '../adapters/fs/index.js';
import type { TranslationProvider } from '../adapters/translation/index.js';
import { runSyncCommand, type RunSyncCommandResult } from './sync.js';
import { logger } from '../utils/logger.js';

const WATCHED_EXTS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs']);

const DEFAULT_WATCH_ROOTS = [
  'app',
  'src',
  'pages',
  'components',
  'lib',
  'hooks',
  'utils',
  'ui',
  'features',
  'shared',
  'screens',
];

export interface WatchSyncOptions {
  projectRoot: string;
  debounceMs?: number;
  write?: boolean;
  noBackup?: boolean;
  provider?: TranslationProvider;
  onSync?: (result: RunSyncCommandResult) => void;
  onError?: (error: unknown) => void;
}

export interface WatchHandle {
  close(): void;
}

export async function startWatchSync(options: WatchSyncOptions): Promise<WatchHandle> {
  const { projectRoot, debounceMs = 250, write = false, noBackup = false } = options;
  const config = await loadConfig(projectRoot);
  const candidateRoots = config.rootDirs ?? DEFAULT_WATCH_ROOTS;
  const messagesRel = normalize(config.messagesDir).replace(/\\/g, '/').replace(/^\.\//, '');

  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let rerunPending = false;
  let closed = false;

  async function trigger(): Promise<void> {
    if (closed) return;
    if (running) {
      rerunPending = true;
      return;
    }
    running = true;
    try {
      const res = await runSyncCommand({
        projectRoot,
        write,
        noBackup,
        provider: options.provider,
      });
      options.onSync?.(res);
    } catch (err) {
      if (options.onError) options.onError(err);
      else logger.error(err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
      if (rerunPending && !closed) {
        rerunPending = false;
        void trigger();
      }
    }
  }

  function schedule(changedRelPath: string): void {
    if (closed) return;
    const norm = changedRelPath.replace(/\\/g, '/');
    if (
      norm.includes('.auto-i18n.lock') ||
      norm.includes('.backup') ||
      norm.includes('node_modules') ||
      (messagesRel && norm.startsWith(messagesRel))
    ) {
      return;
    }
    if (!WATCHED_EXTS.has(extname(norm)) || norm.endsWith('.d.ts')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void trigger();
    }, debounceMs);
  }

  for (const rootName of candidateRoots) {
    const absDir = join(projectRoot, rootName);
    if (!(await fileExists(absDir))) continue;
    const watcher = fsWatch(absDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = relative(projectRoot, join(absDir, String(filename)));
      schedule(rel);
    });
    watchers.push(watcher);
  }

  logger.info('Surveillance active (--watch). Appuyez sur Ctrl+C pour arrêter.');

  return {
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
