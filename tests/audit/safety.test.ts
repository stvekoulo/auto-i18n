import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSync } from '../../src/pipeline/sync';
import { runSyncCommand } from '../../src/commands/sync';
import { runInit } from '../../src/commands/init';
import { runCheck } from '../../src/commands/check';
import { loadConfig } from '../../src/config';
import { collectSourceFiles, readCatalog, writeCatalog } from '../../src/adapters/fs';

import { validateConfig } from '../../src/config';

const dirs: string[] = [];
const config = JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'] });
const base = {
  sourceLocale: 'fr',
  targetLocales: ['en'],
  messagesDir: 'messages',
  provider: { name: 'fake', translate: async (texts: string[]) => texts.map(t => `EN:${t}`) },
};
async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-audit-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('audit — conservation des catalogues', () => {
  it.each([
    'const t = useTranslations(); return <h1>{t("bonjour")}</h1>;',
    'const tr = useTranslations(); return <h1>{tr("bonjour")}</h1>;',
    'const t = useTranslations(); return <h1>{t.rich("bonjour", {})}</h1>;',
  ])('--prune conserve les clés câblées : %s', async body => {
    const dir = await project({
      'app/page.tsx': `'use client'; export function Page(){ ${body} }`,
      'messages/fr.json': '{"bonjour":"Bonjour","vieux":"Ancien texte"}',
      'messages/en.json': '{"bonjour":"Hello","vieux":"Old text"}',
    });
    const report = await runSync({ ...base, projectRoot: dir, prune: true });
    expect(report.prunedKeys).toEqual(['vieux']);
    expect(await readCatalog(join(dir, 'messages/fr.json'))).toHaveProperty('bonjour', 'Bonjour');
    expect(await readCatalog(join(dir, 'messages/en.json'))).toHaveProperty('bonjour', 'Hello');
  });

  it('--prune refuse un scan incomplet avant toute écriture', async () => {
    const dir = await project({
      'app/page.tsx': 'export function Page() { return <h1>',
      'messages/fr.json': '{"bonjour":"Bonjour"}',
    });
    await expect(runSync({ ...base, projectRoot: dir, prune: true })).rejects.toThrow(/scan|pars/i);
    expect(await readFile(join(dir, 'messages/fr.json'), 'utf8')).toBe('{"bonjour":"Bonjour"}');
  });

  it('--prune conserve tout si une clé est calculée dynamiquement', async () => {
    const dir = await project({
      'app/page.tsx':
        'export function Page({key}) { const t = useTranslations(); return <h1>{t(key)}</h1>; }',
      'messages/fr.json': '{"bonjour":"Bonjour"}',
      'messages/en.json': '{"bonjour":"Hello"}',
    });
    const report = await runSync({ ...base, projectRoot: dir, prune: true });
    expect(report.prunedKeys).toEqual([]);
  });

  it('ne modifie pas la source si un catalogue cible est invalide', async () => {
    const dir = await project({
      'app/page.tsx': 'export function Page(){return <h1>Bonjour</h1>}',
      'messages/fr.json': '{}',
      'messages/en.json': '{invalid',
    });
    await expect(runSync({ ...base, projectRoot: dir })).rejects.toThrow();
    expect(await readFile(join(dir, 'messages/fr.json'), 'utf8')).toBe('{}');
  });

  it('remonte une erreur de lecture au lieu de traiter un dossier comme un catalogue vide', async () => {
    const dir = await project({});
    await mkdir(join(dir, 'fr.json'));
    await expect(readCatalog(join(dir, 'fr.json'))).rejects.toThrow();
  });

  it('nettoie le temporaire si le remplacement atomique échoue', async () => {
    const dir = await project({});
    await mkdir(join(dir, 'fr.json'));
    await expect(writeCatalog(join(dir, 'fr.json'), { a: 'A' })).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['fr.json']);
  });

  it('remonte une erreur de parcours au lieu de déclarer le scan vide', async () => {
    const dir = await project({ 'app/page.tsx': 'export default 1;' });
    await expect(collectSourceFiles(join(dir, 'app/page.tsx'))).rejects.toThrow();
  });
});

describe('audit — commandes', () => {
  it('--dry-run laisse les catalogues et composants intacts sans appeler le réseau', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', () => {
      throw new Error('réseau interdit en aperçu');
    });
    const page = "'use client'; export function Page(){return <h1>Bonjour</h1>}";
    const dir = await project({
      'auto-i18n.config.json': config,
      'app/page.tsx': page,
      'app/layout.tsx': 'export default function Layout({children}){return children}',
      'messages/fr.json': '{}',
      'messages/en.json': '{}',
    });
    const result = await runSyncCommand({ projectRoot: dir, write: true, dryRun: true });
    expect(result.writeReport?.stringsWritten).toBe(1);
    expect(await readFile(join(dir, 'messages/fr.json'), 'utf8')).toBe('{}');
    expect(await readFile(join(dir, 'messages/en.json'), 'utf8')).toBe('{}');
    expect(await readFile(join(dir, 'app/page.tsx'), 'utf8')).toBe(page);
    expect(await readdir(join(dir, 'app'))).toEqual(['layout.tsx', 'page.tsx']);
  });

  it('check échoue si un fichier ne peut pas être parsé', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = await project({
      'auto-i18n.config.json': config,
      'app/page.tsx': 'export const x = <h1>',
    });
    expect((await runCheck({ projectRoot: dir, json: true })).exitCode).toBe(1);
  });

  it('annonce une purge prévue comme un aperçu sans prétendre avoir supprimé les clés', async () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => {
      output.push(String(value));
    });
    const dir = await project({
      'auto-i18n.config.json': config,
      'messages/fr.json': '{"vieux":"Ancien texte"}',
      'messages/en.json': '{"vieux":"Old text"}',
    });
    await runSyncCommand({ projectRoot: dir, dryRun: true, prune: true });
    expect(output.join('\n')).toContain('Aperçu terminé');
    expect(output.join('\n')).toContain('à retirer');
    expect(await readCatalog(join(dir, 'messages/fr.json'))).toEqual({ vieux: 'Ancien texte' });
  });

  it('init valide les options avant de modifier le projet', async () => {
    const dir = await project({});
    await expect(
      runInit({
        projectRoot: dir,
        sourceLocale: '../fr',
        targetLocales: ['en'],
        apiKey: 'dummy',
        provider: base.provider,
      }),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it('dérive la variable Google quand apiKeyEnv est omis', async () => {
    const dir = await project({
      'auto-i18n.config.json': JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        provider: 'google',
      }),
    });
    expect((await loadConfig(dir)).apiKeyEnv).toBe('AUTO_I18N_GOOGLE_KEY');
  });

  it('refuse les locales qui désignent le même fichier sur Windows', () => {
    expect(validateConfig({ sourceLocale: 'fr', targetLocales: ['FR'] })).not.toEqual([]);
    expect(validateConfig({ sourceLocale: 'fr', targetLocales: ['pt-BR', 'pt-br'] })).not.toEqual(
      [],
    );
  });

  it('sync remonte les erreurs partielles de placeholders tout en gardant les traductions valides', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ translations: [{ text: 'Hello' }, { text: 'Bye' }] }), {
          status: 200,
        }),
    );
    const dir = await project({
      'auto-i18n.config.json': config,
      '.env.local': 'AUTO_I18N_DEEPL_KEY=dummy',
      'messages/fr.json': '{"a":"Salut {name}","b":"Au revoir"}',
    });
    const result = await runSyncCommand({ projectRoot: dir });
    expect(result.exitCode).toBe(1);
    expect(await readCatalog(join(dir, 'messages/en.json'))).toEqual({ b: 'Bye' });
  });

  it('init préserve une configuration existante au lieu de la réinitialiser', async () => {
    const dir = await project({ 'auto-i18n.config.json': config });
    await expect(
      runInit({
        projectRoot: dir,
        sourceLocale: 'de',
        targetLocales: ['es'],
        apiKey: 'dummy',
        provider: base.provider,
      }),
    ).rejects.toThrow(/sync|existe/i);
    expect(await readFile(join(dir, 'auto-i18n.config.json'), 'utf8')).toBe(config);
    expect(await readdir(dir)).toEqual(['auto-i18n.config.json']);
  });

  it('traduit aussi la clé constructor malgré le prototype des objets JS', async () => {
    const dir = await project({
      'app/page.tsx': 'export function Page(){return <h1>Constructor</h1>}',
    });
    await runSync({ ...base, projectRoot: dir });
    expect(await readCatalog(join(dir, 'messages/en.json'))).toEqual({
      constructor: 'EN:Constructor',
    });
  });
});
