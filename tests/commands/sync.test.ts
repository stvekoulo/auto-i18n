import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSyncCommand } from '../../src/commands/sync';

let tmpDirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-sync-cmd-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

const CONFIG = JSON.stringify({
  sourceLocale: 'fr',
  targetLocales: ['en'],
  messagesDir: './messages',
  apiKeyEnv: 'AUTO_I18N_DEEPL_KEY',
});

function fakeDeepLFetch() {
  return vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { text: string[] };
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () =>
        Promise.resolve({
          translations: body.text.map(t => ({ text: `en:${t}`, detected_source_language: 'fr' })),
        }),
    } as Response;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterEach(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('commands/sync — runSyncCommand --write', () => {
  it('câble les strings safe sur un projet next-intl (Next.js)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', fakeDeepLFetch());
    const dir = await makeProject({
      'auto-i18n.config.json': CONFIG,
      '.env.local': 'AUTO_I18N_DEEPL_KEY=dummy',
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'app/page.tsx': "'use client';\nexport function Page(){ return <h1>Bonjour</h1>; }",
    });

    const { writeReport } = await runSyncCommand({ projectRoot: dir, write: true });

    expect(writeReport).toBeDefined();
    expect(writeReport?.stringsWritten).toBe(1);
    const content = await readFile(join(dir, 'app', 'page.tsx'), 'utf-8');
    expect(content).toContain('useTranslations');
  });

  it("désactive --write sur un projet détecté react-i18next (pas d'import next-intl injecté)", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', fakeDeepLFetch());
    const dir = await makeProject({
      'auto-i18n.config.json': CONFIG,
      '.env.local': 'AUTO_I18N_DEEPL_KEY=dummy',
      // Directive 'use client' pour rendre la string éligible côté core/write (runtime
      // "client") : si le garde-fou du framework n'existait pas, elle serait câblée.
      'src/main.tsx': "'use client';\nexport function App(){ return <h1>Bonjour</h1>; }",
    });

    const { writeReport } = await runSyncCommand({ projectRoot: dir, write: true });

    expect(writeReport).toBeUndefined();
    const content = await readFile(join(dir, 'src', 'main.tsx'), 'utf-8');
    expect(content).not.toContain('next-intl');
  });
});
