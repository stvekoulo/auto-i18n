import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmTranslateProvider } from '../../src/adapters/translation/llm.js';
import { runAddLocale } from '../../src/commands/add-locale.js';
import { runCleanBackups, runRestoreBackups } from '../../src/commands/backups.js';
import { loadEnv, getApiKey } from '../../src/utils/env.js';
import { readCatalog, CatalogParseError } from '../../src/adapters/fs/index.js';
import { flattenCatalog, unflattenCatalog } from '../../src/core/catalog/index.js';
import { namespaceFromFilePath } from '../../src/core/keys/index.js';
import { parseSource, extractStrings } from '../../src/core/extraction/index.js';
import { computeWriteEdits, applyEdits } from '../../src/core/write/index.js';
import { buildGuide, buildGuideModel } from '../../src/core/guide/index.js';
import { renderCheckGithub } from '../../src/reporting/check-github.js';

const dirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-edges-'));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, text, 'utf-8');
  }
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

describe('v3 — Cas limites complémentaires (LLM erreurs, React add-locale, Expo guide, nested)', () => {
  it('LlmTranslateProvider gère 401, 429 Retry-After, 500, erreur réseau, JSON invalide et fences markdown', async () => {
    expect(() => new LlmTranslateProvider('openai', '   ')).toThrow(/manquante/i);

    const provider = new LlmTranslateProvider('openai', 'sk-secret-xyz');
    expect(await provider.translate([], { sourceLocale: 'fr', targetLocale: 'en' })).toEqual([]);

    // 1. Réponse entourée de ```json ... ```
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"translations":["Hello"]}\n```' } }],
        }),
        { status: 200 },
      ),
    );
    expect(
      await provider.translate(['Bonjour'], {
        sourceLocale: 'fr',
        targetLocale: 'en',
        tone: 'informal',
      }),
    ).toEqual(['Hello']);

    // 2. 401 masque le secret
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('invalid key sk-secret-xyz', { status: 401 }),
    );
    await expect(
      provider.translate(['Bonjour'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toThrow(/\*\*\*/);

    // 3. 429 retryable avec Retry-After
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }),
    );
    await expect(
      provider.translate(['Bonjour'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toMatchObject({ kind: 'rate_limit', retryable: true, retryAfterMs: 2000 });

    // 4. 500 retryable
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(
      provider.translate(['Bonjour'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toMatchObject({ retryable: true });

    // 5. JSON malformé
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), {
        status: 200,
      }),
    );
    await expect(
      provider.translate(['Bonjour'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toThrow(/illisible/i);

    // 6. Erreur réseau
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline sk-secret-xyz'));
    await expect(
      provider.translate(['Bonjour'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toThrow(/\*\*\*/);
  });

  it('add-locale met aussi à jour src/i18n.ts sur un projet React/Vite et supporte dryRun', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'] }),
      'src/i18n.ts':
        "import i18next from 'i18next';\nimport messages_fr from '../messages/fr.json';\ni18next.init({\n  resources: {\n    'fr': { translation: messages_fr },\n  },\n});\n",
      'src/App.tsx': 'export function App() { return <h1>Bonjour</h1>; }',
      'messages/fr.json': JSON.stringify({ bonjour: 'Bonjour' }),
      'messages/en.json': JSON.stringify({ bonjour: 'Hello' }),
    });

    const dry = await runAddLocale({
      projectRoot: dir,
      locales: ['de'],
      dryRun: true,
      provider: { name: 'mock', translate: async t => t },
    });
    expect(dry.addedLocales).toEqual(['de']);

    await runAddLocale({
      projectRoot: dir,
      locales: ['de'],
      provider: { name: 'mock', translate: async texts => texts.map(t => `DE:${t}`) },
    });
    const i18nTs = await readFile(join(dir, 'src/i18n.ts'), 'utf-8');
    expect(i18nTs).toContain("import messages_de from '../messages/de.json'");
    expect(i18nTs).toContain("'de': { translation: messages_de }");
  });

  it('couvre loadEnv, backups dryRun, entités numériques JSX, imports fusionnés, namespaces et guide Expo', async () => {
    const dir = await makeProject({
      '.env.local': 'CUSTOM_TEST_V3_KEY=val123\n',
      'src/A.tsx': 'export const x = 1;',
      'src/A.tsx.backup': 'export const x = 0;',
    });
    loadEnv(dir);
    expect(getApiKey('CUSTOM_TEST_V3_KEY')).toBe('val123');
    delete process.env.CUSTOM_TEST_V3_KEY;

    expect((await runRestoreBackups({ projectRoot: dir, dryRun: true })).dryRun).toBe(true);
    expect((await runCleanBackups({ projectRoot: dir, dryRun: true })).dryRun).toBe(true);

    // Entités numériques décimales et hexadécimales dans JsxText
    const jsx = extractStrings(
      parseSource('<p>L&#39;été &#x26; l&#39;hiver</p>', 'T.tsx'),
      'T.tsx',
    );
    expect(jsx[0].value).toBe("L'été & l'hiver");

    // Fusion d'import dans un import next-intl existant non-type + réutilisation d'un namespace
    const code =
      "'use client';\nimport { useLocale } from 'next-intl';\nexport function Hero() {\n  return <h1>Bienvenue</h1>;\n}\n";
    const sf = parseSource(code, 'Hero.tsx');
    const edits = computeWriteEdits(
      sf,
      'Hero.tsx',
      'client',
      new Map([['Bienvenue', 'bienvenue']]),
    );
    expect(applyEdits(code, edits.edits)).toContain(
      "import { useLocale, useTranslations } from 'next-intl';",
    );

    const nsCode =
      "'use client';\nimport { useTranslations } from 'next-intl';\nexport function Hero() {\n  const t = useTranslations('Hero');\n  return <h1>Bienvenue</h1>;\n}\n";
    const nsEdits = computeWriteEdits(
      parseSource(nsCode, 'Hero.tsx'),
      'Hero.tsx',
      'client',
      new Map([['Bienvenue', 'Hero.bienvenue']]),
    );
    expect(applyEdits(nsCode, nsEdits.edits)).toContain('{t("bienvenue")}');

    // Garde anti-chevauchement
    expect(() =>
      applyEdits('abcdef', [
        { start: 1, end: 4, replacement: 'X' },
        { start: 2, end: 5, replacement: 'Y' },
      ]),
    ).toThrow(/Chevauchement/);

    // Namespaces depuis chemins + catalogues imbriqués multi-niveaux & invalides
    expect(namespaceFromFilePath('/p/app/dashboard/page.tsx')).toBe('Dashboard');
    expect(namespaceFromFilePath('/p/app/page.tsx')).toBe('Page');
    expect(unflattenCatalog({ 'A.B.c': '1', 'A.B.d': '2' })).toEqual({
      A: { B: { c: '1', d: '2' } },
    });
    expect(() => flattenCatalog({ bad: [1, 2] as unknown as string })).toThrow();

    await writeFile(join(dir, 'bad-nested.json'), JSON.stringify({ a: [1] }), 'utf-8');
    await expect(readCatalog(join(dir, 'bad-nested.json'), 'nested')).rejects.toBeInstanceOf(
      CatalogParseError,
    );

    // Guide Expo et annotations GitHub complètes
    const guide = buildGuide(
      buildGuideModel({
        framework: 'expo',
        projectRoot: '/p',
        sourceLocale: 'fr',
        targetLocales: ['en'],
        date: 'test',
        strings: jsx,
        keyMap: new Map([[jsx[0].value, 'ete_hiver']]),
        fileRuntimes: new Map(),
      }),
    );
    expect(guide).toContain("from 'react-native'");

    const ghLogs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(m => ghLogs.push(String(m)));
    renderCheckGithub(
      '/p',
      {
        filesScanned: 1,
        parseErrors: ['/p/src/Broken.tsx'],
        detected: { total: 0, safe: 0, review: 0 },
        uncatalogued: [],
        sourceKeyCount: 1,
        missingByLocale: { en: [] },
        totalMissing: 0,
        outdatedKeys: ['k1'],
        invalidByLocale: { en: ['k1'] },
        orphanedKeys: [],
        ok: false,
      },
      [],
    );
    expect(ghLogs.some(l => l.includes('Broken.tsx'))).toBe(true);
    expect(ghLogs.some(l => l.includes('Traductions obsolètes'))).toBe(true);
    expect(ghLogs.some(l => l.includes('ICU invalide'))).toBe(true);
  });
});
