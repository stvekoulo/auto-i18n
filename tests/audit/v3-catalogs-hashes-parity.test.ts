import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSync } from '../../src/pipeline/sync.js';
import { runCheck } from '../../src/commands/check.js';

const dirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-v3cat-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

describe('v3 — Catalogues imbriqués, re-traduction sur texte modifié et parité check/prune', () => {
  it('supporte catalogFormat="nested" avec namespaceByFile=true de bout en bout', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        catalogFormat: 'nested',
        namespaceByFile: true,
      }),
      'src/components/HeroBanner.tsx':
        "'use client';\nexport function HeroBanner() {\n  return <h1>Bienvenue</h1>;\n}\n",
    });

    const syncReport = await runSync({
      projectRoot: dir,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: './messages',
      catalogFormat: 'nested',
      namespaceByFile: true,
      provider: { name: 'mock', translate: async texts => texts.map(t => `EN:${t}`) },
    });

    expect(syncReport.addedKeys).toEqual(['HeroBanner.bienvenue']);
    const rawFr = JSON.parse(await readFile(join(dir, 'messages/fr.json'), 'utf-8'));
    const rawEn = JSON.parse(await readFile(join(dir, 'messages/en.json'), 'utf-8'));
    expect(rawFr).toEqual({ HeroBanner: { bienvenue: 'Bienvenue' } });
    expect(rawEn).toEqual({ HeroBanner: { bienvenue: 'EN:Bienvenue' } });

    const checkRes = await runCheck({ projectRoot: dir, json: true });
    expect(checkRes.exitCode).toBe(0);
  });

  it('détecte et retraduit automatiquement une clé existante dont le texte source a été modifié', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
      }),
      'app/page.tsx': 'export default async function Page() { return <h1>{t("welcome")}</h1>; }',
      'messages/fr.json': JSON.stringify({ welcome: 'Bienvenue' }),
    });

    const provider = {
      name: 'mock',
      translate: async (texts: string[]) => texts.map(t => `EN:${t}`),
    };

    await runSync({
      projectRoot: dir,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: './messages',
      provider,
    });
    expect(JSON.parse(await readFile(join(dir, 'messages/en.json'), 'utf-8'))).toEqual({
      welcome: 'EN:Bienvenue',
    });

    // L'utilisateur corrige le texte français sur la même clé :
    await writeFile(
      join(dir, 'messages/fr.json'),
      JSON.stringify({ welcome: 'Bienvenue chez nous' }),
      'utf-8',
    );

    const midCheck = await runCheck({ projectRoot: dir, json: true });
    expect(midCheck.report.outdatedKeys).toEqual(['welcome']);
    expect(midCheck.exitCode).toBe(1);

    await runSync({
      projectRoot: dir,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: './messages',
      provider,
    });
    expect(JSON.parse(await readFile(join(dir, 'messages/en.json'), 'utf-8'))).toEqual({
      welcome: 'EN:Bienvenue chez nous',
    });
    expect((await runCheck({ projectRoot: dir, json: true })).exitCode).toBe(0);
  });

  it('aligne check et sync sur les références hors rootDirs (aucun faux positif orphelin)', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        rootDirs: ['app'],
      }),
      'app/page.tsx': 'export default function Page() { return <div />; }',
      'modules/Legacy.tsx': 'export function Legacy() { return <p>{t("ancienne_cle")}</p>; }',
      'messages/fr.json': JSON.stringify({ ancienne_cle: 'Ancien texte' }),
      'messages/en.json': JSON.stringify({ ancienne_cle: 'Old text' }),
    });

    const checkRes = await runCheck({ projectRoot: dir, json: true });
    expect(checkRes.report.orphanedKeys).toEqual([]);
    expect(checkRes.exitCode).toBe(0);
  });
});
