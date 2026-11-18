import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit } from '../../src/commands/init.js';
import { saveApiKeyToEnv, resolveProjectApiKey } from '../../src/utils/env.js';
import { assertInsideProject } from '../../src/utils/paths.js';
import { collectSourceFiles } from '../../src/adapters/fs/index.js';
import { withProjectLock } from '../../src/adapters/fs/lock.js';

const dirs: string[] = [];

async function makeDir(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-sec-'));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, text, 'utf-8');
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

describe('v3 — Sécurité chemins, env isolé, verrou et collecte fichiers', () => {
  it('S2 : refuse un --guide qui sort de la racine du projet avant tout effet de bord', async () => {
    const dir = await makeDir({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
    });
    await expect(
      runInit({
        projectRoot: dir,
        sourceLocale: 'fr',
        targetLocales: ['en'],
        apiKey: 'test-key',
        guidePath: '../outside.md',
        provider: { name: 'mock', translate: async t => t },
      }),
    ).rejects.toThrow(/intérieur du projet|hors du projet/i);
  });

  it('S2 : détecte une évasion par lien symbolique / jonction via assertInsideProject', async () => {
    const root = await makeDir();
    const outside = await makeDir();
    const link = join(root, 'linked-out');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assertInsideProject(root, join(link, 'fr.json'))).rejects.toThrow(
      /intérieur du projet|hors du projet/i,
    );
  });

  it('S3 : rejette les sauts de ligne dans saveApiKeyToEnv et préserve # sans polluer process.env', async () => {
    const dirA = await makeDir();
    const dirB = await makeDir();

    await expect(saveApiKeyToEnv(dirA, 'AUTO_I18N_GOOGLE_KEY', 'bad\nEVIL=1')).rejects.toThrow(
      /invalide|saut de ligne/i,
    );

    await saveApiKeyToEnv(dirA, 'AUTO_I18N_GOOGLE_KEY', 'secret #avec diese');
    expect(await resolveProjectApiKey(dirA, 'AUTO_I18N_GOOGLE_KEY')).toBe('secret #avec diese');
    expect(process.env.AUTO_I18N_GOOGLE_KEY).toBeUndefined();
    expect(await resolveProjectApiKey(dirB, 'AUTO_I18N_GOOGLE_KEY')).toBeUndefined();
  });

  it('S4 : signale explicitement un verrou orphelin dont le PID est terminé', async () => {
    const dir = await makeDir({
      '.auto-i18n.lock/owner.json': JSON.stringify({
        pid: 999_999_999,
        startedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    await expect(withProjectLock(dir, async () => 1)).rejects.toThrow(/999999999/);
  });

  it('B11 : supporte les globs {a,b}, préfixe ./, rootDirs monorepo et ignore .d.ts / middleware / +api', async () => {
    const dir = await makeDir({
      'middleware.ts': 'export default function m() {}',
      'proxy.ts': 'export default function p() {}',
      'next-env.d.ts': '/// <reference types="next" />',
      'playwright.config.ts': 'export default {};',
      'apps/web/src/Page.tsx': 'export function Page(){ return <h1>Bonjour</h1>; }',
      'apps/web/src/types.d.ts': 'export type X = string;',
      'apps/web/src/Button.stories.tsx': 'export const Primary = {};',
      'apps/web/src/app/api/users+api.ts': 'export function GET(){}',
      'apps/api/src/index.ts': 'export const secret = "interne";',
    });

    const files = await collectSourceFiles(dir, {
      rootDirs: ['./apps/web/src'],
      ignorePatterns: ['./apps/web/src/**/*.{stories,mdx}.{ts,tsx}'],
    });
    expect(files).toEqual([join(dir, 'apps', 'web', 'src', 'Page.tsx')]);
  });
});
