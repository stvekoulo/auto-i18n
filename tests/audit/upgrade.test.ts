import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSync } from '../../src/pipeline/sync';
import { parseSource, getSyntaxErrors } from '../../src/core/extraction';
import { computeWriteEdits, applyEdits } from '../../src/core/write';
import { buildGuide, buildGuideModel } from '../../src/core/guide';
import { scanContent } from '../../src/core/scan';
import { placeholdersMatch } from '../../src/core/catalog';
import { collectSourceFiles } from '../../src/adapters/fs';
import { detectProject } from '../../src/adapters/project';

const dirs: string[] = [];
async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-upgrade-'));
  dirs.push(dir);
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), value);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const base = {
  sourceLocale: 'fr',
  targetLocales: ['en'],
  messagesDir: 'messages',
  provider: { name: 'fake', translate: async (texts: string[]) => texts.map(t => `EN:${t}`) },
};

describe('upgrade — sûreté', () => {
  it('refuse une synchronisation concurrente sur le même projet', async () => {
    const dir = await project({
      'app/page.tsx': 'export function Page(){return <h1>Bonjour</h1>}',
    });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const first = runSync({
      ...base,
      projectRoot: dir,
      provider: {
        name: 'wait',
        translate: async texts => {
          entered();
          await gate;
          return texts;
        },
      },
    });
    await started;
    const second = runSync({ ...base, projectRoot: dir });
    const check = expect(second).rejects.toThrow(/cours|verrou/i);
    release();
    await check;
    await first;
  });

  it('préserve les références dans les dossiers exclus du scan de traduction', async () => {
    const dir = await project({
      'modules/page.tsx': 'export function Page(){return <h1>{t("bonjour")}</h1>}',
      'messages/fr.json': '{"bonjour":"Bonjour"}',
      'messages/en.json': '{"bonjour":"Hello"}',
    });
    const report = await runSync({ ...base, projectRoot: dir, rootDirs: ['app'], prune: true });
    expect(report.prunedKeys).toEqual([]);
    expect(JSON.parse(await readFile(join(dir, 'messages/fr.json'), 'utf8'))).toEqual({
      bonjour: 'Bonjour',
    });
  });

  it('applique **/ aussi aux fichiers à la racine', async () => {
    const dir = await project({
      'page.tsx': 'export default 1;',
      'app/page.tsx': 'export default 1;',
    });
    expect(await collectSourceFiles(dir, { ignorePatterns: ['**/page.tsx'] })).toEqual([]);
  });

  it('accepte des pluriels ICU traduits et refuse un ICU invalide', () => {
    expect(
      placeholdersMatch(
        '{count, plural, one {# chat} other {# chats}}',
        '{count, plural, one {# cat} other {# cats}}',
      ),
    ).toBe(true);
    expect(placeholdersMatch('Hello {name}', 'Hello {name')).toBe(false);
    expect(
      placeholdersMatch(
        '{n, plural, one {one} other {many}}',
        '{m, plural, one {one} other {many}}',
      ),
    ).toBe(false);
  });
});

describe('upgrade — React/Vite', () => {
  it.each([
    'app/layout.js',
    'src/app/layout.js',
    'app/[locale]/layout.tsx',
    'src/app/[locale]/layout.tsx',
  ])('reconnaît un layout Next.js moderne : %s', async file => {
    const dir = await project({
      [file]: 'export default function Layout({children}){return children}',
    });
    expect((await detectProject(dir)).framework).toBe('next-intl');
  });
  it('câble un composant React sans directive use client', () => {
    const content = 'export function App(){ return <h1>Bonjour</h1>; }';
    const result = computeWriteEdits(
      parseSource(content),
      'App.tsx',
      'client',
      new Map([['Bonjour', 'bonjour']]),
      'react-i18next',
    );
    const output = applyEdits(content, result.edits);
    expect(result.written).toBe(1);
    expect(output).toContain("from 'react-i18next'");
    expect(output).toContain('const { t } = useTranslation();');
    expect(output).not.toContain('next-intl');
    expect(getSyntaxErrors(parseSource(output))).toEqual([]);
  });

  it('réutilise le hook React sans le dupliquer', () => {
    const content =
      "import {useTranslation} from 'react-i18next'; export function App(){const {t} = useTranslation();return <h1>Bonjour</h1>}";
    const result = computeWriteEdits(
      parseSource(content),
      'App.tsx',
      'client',
      new Map([['Bonjour', 'bonjour']]),
      'react-i18next',
    );
    expect(result.written).toBe(1);
    expect(applyEdits(content, result.edits).match(/useTranslation\(\)/g)).toHaveLength(1);
  });

  it('produit un guide React sans instructions Next.js', () => {
    const content = 'export function App(){return <h1>Bonjour</h1>}';
    const scan = scanContent(content, '/app/src/App.tsx');
    const guide = buildGuide(
      buildGuideModel({
        projectRoot: '/app',
        sourceLocale: 'fr',
        targetLocales: ['en'],
        date: 'test',
        strings: scan.strings,
        keyMap: new Map([['Bonjour', 'bonjour']]),
        fileRuntimes: new Map(),
        framework: 'react-i18next',
      }),
    );
    expect(guide).toContain('useTranslation');
    expect(guide).not.toContain('next-intl');
    expect(guide).not.toContain('app/[locale]');
  });
});
