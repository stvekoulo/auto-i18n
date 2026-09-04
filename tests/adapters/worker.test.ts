import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  plannedWorkerCount,
  resolveWorkerPath,
  scanFilesInWorkers,
  WORKER_THRESHOLD,
} from '../../src/adapters/worker/pool';
import { scanOneFile } from '../../src/adapters/worker/scan-file';
import { scanProject } from '../../src/pipeline/scan';

let tmpDirs: string[] = [];

const COMPONENT = `'use client';
export default function Page({ user }) {
  return (
    <div className="p-4">
      <h1>Tableau de bord</h1>
      <input placeholder="Rechercher" />
      <p>{\`Bonjour \${user.name}\`}</p>
    </div>
  );
}
`;

async function makeProject(fileCount: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-worker-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'app'), { recursive: true });
  await Promise.all(
    Array.from({ length: fileCount }, (_, i) =>
      writeFile(join(dir, 'app', `f${i}.tsx`), COMPONENT, 'utf-8'),
    ),
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map(d => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('adapters/worker — plannedWorkerCount', () => {
  it('reste sur le thread principal en dessous du seuil', () => {
    expect(plannedWorkerCount(0, 8)).toBe(0);
    expect(plannedWorkerCount(WORKER_THRESHOLD - 1, 8)).toBe(0);
  });

  it('démarre des workers à partir du seuil', () => {
    expect(plannedWorkerCount(WORKER_THRESHOLD, 8)).toBe(3);
    expect(plannedWorkerCount(WORKER_THRESHOLD * 10, 8)).toBe(3);
  });

  it('vise les cœurs physiques, pas les threads logiques', () => {
    // Un worker par thread logique se dispute la bande passante mémoire et
    // finit plus lent que la moitié moins de workers.
    expect(plannedWorkerCount(10_000, 16)).toBe(6);
    expect(plannedWorkerCount(10_000, 12)).toBe(5);
  });

  it('plafonne sur une machine à très nombreux cœurs', () => {
    expect(plannedWorkerCount(10_000, 128)).toBe(6);
  });

  it('renonce quand la machine est trop petite pour y gagner', () => {
    expect(plannedWorkerCount(10_000, 4)).toBe(0);
    expect(plannedWorkerCount(10_000, 2)).toBe(0);
    expect(plannedWorkerCount(10_000, 1)).toBe(0);
  });
});

describe('adapters/worker — scanFilesInWorkers', () => {
  it("renonce sans rien consommer quand aucun worker n'est prévu", async () => {
    expect(await scanFilesInWorkers(['/inexistant.tsx'], undefined, 0)).toBeNull();
  });
});

/** Worker compilé, résolu depuis la racine du dépôt (les tests tournent en TS). */
const workerPath =
  resolveWorkerPath() ??
  (() => {
    const built = join(
      import.meta.dirname,
      '..',
      '..',
      'dist',
      'adapters',
      'worker',
      'scan-worker.js',
    );
    return existsSync(built) ? built : null;
  })();

/**
 * Le pool a besoin du worker compilé : un thread Node ne charge pas de
 * TypeScript. La CI lance `npm run build` avant les tests, donc ces cas
 * s'exécutent bien là-bas ; en local, ils demandent un build préalable.
 */
describe.skipIf(!workerPath)('adapters/worker — pool réel (nécessite `npm run build`)', () => {
  it('produit exactement le même résultat que le scan en ligne', async () => {
    const dir = await makeProject(40);

    const viaWorkers = await scanProject(dir, { workers: 2, workerPath: workerPath! });
    const inline = await scanProject(dir, { workers: 0 });

    expect(viaWorkers.workersUsed).toBe(2);
    expect(inline.workersUsed).toBe(0);
    expect(viaWorkers.filesScanned).toBe(40);
    expect(viaWorkers.strings).toEqual(inline.strings);
    expect(viaWorkers.ignored).toEqual(inline.ignored);
    expect([...viaWorkers.fileRuntimes].sort()).toEqual([...inline.fileRuntimes].sort());
  });

  it("conserve l'ordre des fichiers malgré le découpage en lots", async () => {
    // Les lots reviennent dans l'ordre d'achèvement des workers, pas dans
    // celui de l'envoi : chaque résultat doit retrouver son index d'origine.
    const dir = await makeProject(70);
    const files = Array.from({ length: 70 }, (_, i) => join(dir, 'app', `f${i}.tsx`));

    const outcomes = await scanFilesInWorkers(files, undefined, 3, workerPath!);

    expect(outcomes).not.toBeNull();
    expect(outcomes!.map(o => o.file)).toEqual(files);
    expect(outcomes!.every(o => !o.parseError)).toBe(true);
  });

  it('remonte un fichier cassé comme parseError, comme le scan en ligne', async () => {
    const dir = await makeProject(4);
    const broken = join(dir, 'app', 'casse.tsx');
    await writeFile(broken, 'export default function A( { return <p>x</p>; }', 'utf-8');

    const [viaWorker] = (await scanFilesInWorkers([broken], undefined, 2, workerPath!))!;
    const inline = await scanOneFile(broken);

    expect(viaWorker.parseError).toBe(true);
    expect(viaWorker).toEqual(inline);
  });
});
