import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSync } from '../../src/pipeline/sync';
import type { TranslateParams, TranslationProvider } from '../../src/adapters/translation';

let tmpDirs: string[] = [];

class FakeProvider implements TranslationProvider {
  readonly name = 'fake';
  translate(texts: string[], params: TranslateParams): Promise<string[]> {
    return Promise.resolve(texts.map(t => `${params.targetLocale}:${t}`));
  }
}

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-sync-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

async function readJson(dir: string, rel: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(dir, rel), 'utf-8'));
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

describe('pipeline/sync — runSync', () => {
  it('catalogue la source et écrit la traduction cible', async () => {
    const dir = await makeProject({
      'app/page.tsx': 'export default function P(){ return <h1>Bonjour</h1>; }',
    });

    const report = await runSync({ projectRoot: dir, ...base });

    expect(report.addedKeys).toEqual(['bonjour']);
    expect(await readJson(dir, 'messages/fr.json')).toEqual({ bonjour: 'Bonjour' });
    expect(await readJson(dir, 'messages/en.json')).toEqual({ bonjour: 'en:Bonjour' });
  });

  it('réutilise les clés existantes (merge stable)', async () => {
    const dir = await makeProject({
      'app/page.tsx':
        'export default function P(){ return (<div><h1>Bonjour</h1><p>Nouveau</p></div>); }',
      'messages/fr.json': JSON.stringify({ bonjour: 'Bonjour' }),
      'messages/en.json': JSON.stringify({ bonjour: 'Hi' }),
    });

    const report = await runSync({ projectRoot: dir, ...base });

    expect(report.reusedKeys).toContain('bonjour');
    expect(report.addedKeys).toContain('nouveau');
    const en = await readJson(dir, 'messages/en.json');
    expect(en.bonjour).toBe('Hi'); // préservé
    expect(en.nouveau).toBe('en:Nouveau'); // traduit
  });

  it('signale les strings module-scope comme à revoir', async () => {
    const dir = await makeProject({
      'lib/data.ts': "export const items = ['Accueil', 'Contact'];",
    });

    const report = await runSync({ projectRoot: dir, ...base });

    expect(report.detected.review).toBeGreaterThanOrEqual(2);
    expect(report.reviewStrings.every(s => s.reviewReason === 'module_scope')).toBe(true);
  });
});
