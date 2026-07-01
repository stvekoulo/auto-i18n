import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSync } from '../../src/pipeline/sync';
import { runWrite } from '../../src/pipeline/write';
import type { TranslateParams, TranslationProvider } from '../../src/adapters/translation';

let tmpDirs: string[] = [];

class FakeProvider implements TranslationProvider {
  readonly name = 'fake';
  translate(texts: string[], params: TranslateParams): Promise<string[]> {
    return Promise.resolve(texts.map(t => `${params.targetLocale}:${t}`));
  }
}

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-write-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  tmpDirs = [];
});

const base = {
  provider: new FakeProvider(),
  sourceLocale: 'fr',
  targetLocales: ['en'],
  messagesDir: './messages',
};

describe('pipeline/write — runWrite', () => {
  it('câble les strings safe sur disque et crée une sauvegarde .backup', async () => {
    const pagePath = 'app/page.tsx';
    const dir = await makeProject({
      [pagePath]: "'use client';\nexport function Page(){ return <h1>Bonjour</h1>; }\n",
    });

    const sync = await runSync({ projectRoot: dir, ...base });
    const write = await runWrite({
      strings: sync.strings,
      keyMap: sync.keyMap,
      fileRuntimes: sync.fileRuntimes,
    });

    expect(write.stringsWritten).toBe(1);
    expect(write.filesChanged).toBe(1);

    const fullPath = join(dir, pagePath);
    const after = await readFile(fullPath, 'utf-8');
    expect(after).toContain('useTranslations');
    expect(after).toContain('{t("bonjour")}');
    expect(await exists(`${fullPath}.backup`)).toBe(true);
    const backup = await readFile(`${fullPath}.backup`, 'utf-8');
    expect(backup).toContain('Bonjour</h1>');
  });

  it('dry-run ne modifie rien sur disque', async () => {
    const pagePath = 'app/page.tsx';
    const original = "'use client';\nexport function Page(){ return <h1>Bonjour</h1>; }\n";
    const dir = await makeProject({ [pagePath]: original });

    const sync = await runSync({ projectRoot: dir, ...base });
    const write = await runWrite({
      strings: sync.strings,
      keyMap: sync.keyMap,
      fileRuntimes: sync.fileRuntimes,
      dryRun: true,
    });

    expect(write.stringsWritten).toBe(1);
    expect(write.dryRun).toBe(true);
    expect(write.files[0].after).toContain('{t("bonjour")}');

    const onDisk = await readFile(join(dir, pagePath), 'utf-8');
    expect(onDisk).toBe(original); // fichier source intact
    expect(await exists(join(dir, `${pagePath}.backup`))).toBe(false);
  });

  it('laisse au guide les strings hors composant/hôte non identifiable', async () => {
    const dir = await makeProject({
      'lib/render.ts': "function render(){ return 'Bonjour'; }",
    });

    const sync = await runSync({ projectRoot: dir, ...base });
    const write = await runWrite({
      strings: sync.strings,
      keyMap: sync.keyMap,
      fileRuntimes: sync.fileRuntimes,
    });

    expect(write.stringsWritten).toBe(0);
    expect(write.stringsSkipped).toBeGreaterThan(0);
  });
});
