import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runInit } from '../../src/commands/init';
import type { TranslateParams, TranslationProvider } from '../../src/adapters/translation';

let tmpDirs: string[] = [];

class FakeProvider implements TranslationProvider {
  readonly name = 'fake';
  translate(texts: string[], params: TranslateParams): Promise<string[]> {
    return Promise.resolve(texts.map(t => `${params.targetLocale}:${t}`));
  }
}

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-init-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

async function read(dir: string, rel: string): Promise<string> {
  return readFile(join(dir, rel), 'utf-8');
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('commands/init — runInit', () => {
  it("installe l'infra, traduit et écrit le guide", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'app/page.tsx': 'export default function P(){ return <h1>Bonjour</h1>; }',
      'next.config.mjs': 'const config = {};\nexport default config;',
    });

    const result = await runInit({
      projectRoot: dir,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      apiKey: 'dummy',
      provider: new FakeProvider(),
    });

    expect(result.exitCode).toBe(0);

    // Config + env + gitignore
    const config = JSON.parse(await read(dir, 'auto-i18n.config.json'));
    expect(config.sourceLocale).toBe('fr');
    expect(await read(dir, '.env.local')).toContain('AUTO_I18N_DEEPL_KEY=dummy');
    expect(await read(dir, '.gitignore')).toContain('.env.local');

    // Catalogues
    expect(JSON.parse(await read(dir, 'messages/fr.json'))).toEqual({ bonjour: 'Bonjour' });
    expect(JSON.parse(await read(dir, 'messages/en.json'))).toEqual({ bonjour: 'en:Bonjour' });

    // Infra
    expect(await read(dir, 'i18n/routing.ts')).toContain("locales: ['fr', 'en']");

    // Guide
    const guide = await read(dir, 'i18n-guide.md');
    expect(guide).toContain('app/page.tsx');
    expect(guide).toContain('{t("bonjour")}');
  });

  it('respecte un chemin de guide personnalisé', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = await makeProject({
      'app/page.tsx': 'export default function P(){ return <h1>Bonjour</h1>; }',
    });
    const result = await runInit({
      projectRoot: dir,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      apiKey: 'dummy',
      provider: new FakeProvider(),
      guidePath: 'docs/i18n.md',
    });
    expect(result.guidePath.replace(/\\/g, '/')).toContain('docs/i18n.md');
    await readFile(join(dir, 'docs', 'i18n.md'), 'utf-8');
  });
});
