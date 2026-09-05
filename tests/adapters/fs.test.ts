import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'fs/promises';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import {
  readCatalog,
  writeCatalog,
  backupFile,
  collectSourceFiles,
  CatalogParseError,
} from '../../src/adapters/fs';

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

describe('adapters/fs — writeCatalog', () => {
  it('écrit de façon atomique, sans fichier temporaire résiduel', async () => {
    const dir = await makeDir();
    const path = join(dir, 'fr.json');

    await writeCatalog(path, { greet: 'Bonjour' });

    expect(await readCatalog(path)).toEqual({ greet: 'Bonjour' });
    expect((await readdir(dir)).filter(f => f.includes('.tmp-'))).toEqual([]);
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

describe('adapters/fs — patterns ignore', () => {
  it('traite `?` comme un caractère unique, pas comme un quantificateur', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'a1.tsx'), 'export default 1;', 'utf-8');
    await writeFile(join(dir, 'app', 'ab.tsx'), 'export default 1;', 'utf-8');
    await writeFile(join(dir, 'app', 'a.tsx'), 'export default 1;', 'utf-8');

    const files = await collectSourceFiles(dir, { ignorePatterns: ['app/a?.tsx'] });

    expect(files.map(f => basename(f)).sort()).toEqual(['a.tsx']);
  });
});
