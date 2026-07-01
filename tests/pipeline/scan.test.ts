import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanProject } from '../../src/pipeline/scan';

let tmpDirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-scan-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('pipeline/scan — scanProject (concurrence)', () => {
  it('scanne plusieurs fichiers en parallèle et agrège un résultat déterministe', async () => {
    const dir = await makeProject({
      'app/a.tsx': 'export default function A(){ return <h1>Un</h1>; }',
      'app/b.tsx': 'export default function B(){ return <h1>Deux</h1>; }',
      'app/c.tsx': 'export default function C(){ return <h1>Trois</h1>; }',
    });

    const result = await scanProject(dir, { concurrency: 2 });

    expect(result.filesScanned).toBe(3);
    expect(result.parseErrors).toEqual([]);
    expect(result.strings.map(s => s.value).sort()).toEqual(['Deux', 'Trois', 'Un']);
    expect(result.fileRuntimes.size).toBe(3);
  });

  it('produit le même résultat quelle que soit la concurrence', async () => {
    const dir = await makeProject({
      'app/a.tsx': 'export default function A(){ return <h1>Un</h1>; }',
      'app/b.tsx': 'export default function B(){ return <h1>Deux</h1>; }',
    });

    const sequential = await scanProject(dir, { concurrency: 1 });
    const parallel = await scanProject(dir, { concurrency: 8 });

    expect(parallel.strings.map(s => s.value)).toEqual(sequential.strings.map(s => s.value));
  });
});
