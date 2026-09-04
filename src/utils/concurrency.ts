/**
 * Exécution parallèle bornée — partagée par le scan de fichiers et la
 * traduction des locales.
 */

/**
 * Applique `worker` sur `items` avec au plus `concurrency` exécutions
 * simultanées. Les résultats gardent l'ordre des entrées.
 *
 * Les tâches sont tirées d'un curseur partagé par une boucle, jamais par
 * récursion : un appel récursif par élément empile une chaîne de promesses
 * aussi profonde que la liste, ce qui pèse sur un projet de plusieurs milliers
 * de fichiers.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, runWorker));
  return results;
}
