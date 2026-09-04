import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readCatalog, backupFile, CatalogParseError } from '../../src/adapters/fs';

const BOM = String.fromCharCode(0xfeff);

let tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-fs-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map(d => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('adapters/fs — readCatalog', () => {
  it('renvoie un catalogue vide si le fichier est absent', async () => {
    const dir = await makeDir();
    expect(await readCatalog(join(dir, 'fr.json'))).toEqual({});
  });

  it('lève une erreur sur un JSON invalide plutôt que de repartir de zéro', async () => {
    // Le traiter comme vide retraduirait tout puis écraserait le fichier.
    const dir = await makeDir();
    const path = join(dir, 'fr.json');
    await writeFile(path, '{ "a": "b",', 'utf-8');
    await expect(readCatalog(path)).rejects.toBeInstanceOf(CatalogParseError);
  });

  it('refuse un catalogue imbriqué au lieu de le tronquer', async () => {
    const dir = await makeDir();
    const path = join(dir, 'fr.json');
    await writeFile(path, JSON.stringify({ Home: { title: 'x' } }), 'utf-8');
    await expect(readCatalog(path)).rejects.toBeInstanceOf(CatalogParseError);
  });

  it('tolère un BOM et ignore __proto__', async () => {
    const dir = await makeDir();
    const path = join(dir, 'fr.json');
    await writeFile(path, BOM + '{"__proto__":"x","a":"b"}', 'utf-8');
    const catalog = await readCatalog(path);
    expect(catalog).toEqual({ a: 'b' });
    expect(Object.getPrototypeOf(catalog)).toBe(Object.prototype);
  });
});

describe('adapters/fs — backupFile', () => {
  it("n'écrase jamais une sauvegarde existante", async () => {
    const dir = await makeDir();
    const path = join(dir, 'page.tsx');

    await writeFile(path, 'v1', 'utf-8');
    const first = await backupFile(path);

    await writeFile(path, 'v2', 'utf-8');
    const second = await backupFile(path);

    expect(second).not.toBe(first);
    expect(await readFile(first, 'utf-8')).toBe('v1');
    expect(await readFile(second, 'utf-8')).toBe('v2');
  });
});
