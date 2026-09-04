/**
 * Pool de workers pour le scan de fichiers.
 *
 * Le scan est le seul travail vraiment gourmand en CPU du package : lire un
 * fichier coûte une microseconde, le parser en coûte mille. Une concurrence
 * `async` n'y change rien puisque tout s'exécute sur le même thread — seuls de
 * vrais threads répartissent la charge.
 *
 * Le pool ne s'active qu'au-delà d'un seuil de fichiers : démarrer un worker
 * implique d'y recharger ts-morph, ce qui coûte plusieurs centaines de
 * millisecondes. En dessous du seuil, le scan en ligne est plus rapide.
 */

import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { FileScanOutcome, ScanRequest, ScanResponse } from './protocol.js';

/**
 * Seuil d'activation du pool, en fichiers.
 *
 * Démarrer un worker recharge ts-morph (~400 ms, ~570 ms pour quatre en
 * parallèle) et le scan en ligne repart de zéro pendant ce temps. Mesures sur
 * 8 threads logiques, fichier de composant représentatif :
 *
 * | fichiers | thread principal | 3 workers | rapport |
 * | -------: | ---------------: | --------: | ------: |
 * |     1500 |          1698 ms |   2226 ms |   0,76x |
 * |     2500 |          3038 ms |   3484 ms |   0,87x |
 * |     3500 |          3854 ms |   3664 ms |   1,05x |
 * |     4500 |          5260 ms |   4407 ms |   1,19x |
 * |     6000 |          6677 ms |   5346 ms |   1,25x |
 *
 * En dessous du seuil, le pool serait une régression : on n'y touche pas.
 */
export const WORKER_THRESHOLD = 3500;

/** Fichiers envoyés en un seul message. Assez gros pour amortir l'aller-retour. */
const CHUNK_SIZE = 25;

/** Plafond de sécurité sur une machine à très nombreux cœurs. */
const MAX_WORKERS = 6;

/**
 * Nombre de workers à démarrer pour `fileCount` fichiers, ou `0` pour rester
 * sur le thread principal.
 */
export function plannedWorkerCount(
  fileCount: number,
  parallelism: number = availableParallelism(),
): number {
  if (fileCount < WORKER_THRESHOLD) return 0;

  // `availableParallelism` compte les threads logiques. Le parsing sature la
  // bande passante mémoire et ne tire presque rien de l'hyperthreading : on
  // vise les cœurs physiques, moins celui que garde le thread principal.
  // Mesuré sur 6000 fichiers / 8 threads : 3 workers 5346 ms, 2 workers
  // 6065 ms, 4 workers 6184 ms.
  const workers = Math.min(Math.floor(parallelism / 2) - 1, MAX_WORKERS);
  return workers >= 2 ? workers : 0;
}

/** Chemin du worker compilé, ou `null` si on tourne depuis les sources TypeScript. */
export function resolveWorkerPath(): string | null {
  const url = new URL('./scan-worker.js', import.meta.url);
  if (url.protocol !== 'file:') return null;
  const path = fileURLToPath(url);
  return existsSync(path) ? path : null;
}

/**
 * Scanne `files` sur plusieurs threads. Renvoie `null` — sans rien consommer —
 * si le pool n'est pas applicable : trop peu de fichiers, pas assez de cœurs,
 * ou worker compilé introuvable. L'appelant retombe alors sur le scan en ligne.
 *
 * `workerPath` permet de désigner le worker explicitement, pour les
 * empaqueteurs qui déplacent les fichiers émis hors de leur arborescence
 * d'origine (et pour les tests, qui tournent depuis les sources TypeScript).
 */
export async function scanFilesInWorkers(
  files: string[],
  blacklist: string[] | undefined,
  workerCount = plannedWorkerCount(files.length),
  explicitWorkerPath?: string,
): Promise<FileScanOutcome[] | null> {
  if (workerCount === 0) return null;
  const workerPath = explicitWorkerPath ?? resolveWorkerPath();
  if (!workerPath) return null;

  const results = new Array<FileScanOutcome>(files.length);
  let cursor = 0;

  const runWorker = (worker: Worker): Promise<void> =>
    new Promise((resolve, reject) => {
      // L'index de départ du lot en vol, pour replacer les résultats en ordre.
      let pending = -1;

      const sendNext = (): void => {
        if (cursor >= files.length) {
          resolve();
          return;
        }
        pending = cursor;
        cursor = Math.min(cursor + CHUNK_SIZE, files.length);
        worker.postMessage({
          files: files.slice(pending, cursor),
          blacklist,
        } satisfies ScanRequest);
      };

      worker.on('message', (response: ScanResponse) => {
        for (let i = 0; i < response.outcomes.length; i++) {
          results[pending + i] = response.outcomes[i];
        }
        sendNext();
      });
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Worker de scan interrompu (code ${code}).`));
      });

      sendNext();
    });

  const workers = Array.from({ length: workerCount }, () => new Worker(workerPath));
  try {
    await Promise.all(workers.map(runWorker));
    return results;
  } finally {
    await Promise.all(workers.map(w => w.terminate()));
  }
}
