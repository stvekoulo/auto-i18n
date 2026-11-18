import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProject } from '../../src/adapters/project/index.js';
import { scaffoldProject } from '../../src/adapters/scaffold/index.js';
import { scanContent } from '../../src/core/scan/index.js';
import { buildGuide, buildGuideModel } from '../../src/core/guide/index.js';
import { parseSource, getSyntaxErrors } from '../../src/core/extraction/index.js';

const dirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-expo-'));
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

describe('v3 — Support Expo / React Native, Scaffold messagesDir/Switcher et Guide metadata', () => {
  it('détecte un projet Expo Router et génère un scaffold React Native natif sans DOM HTML', async () => {
    const dir = await makeProject({
      'app.json': JSON.stringify({ expo: { name: 'MonApp', slug: 'mon-app' } }),
      'src/app/_layout.tsx':
        'import { Stack } from "expo-router";\nexport default function RootLayout() { return <Stack />; }\n',
      'node_modules/expo-localization/package.json': JSON.stringify({
        name: 'expo-localization',
        version: '17.0.0',
      }),
    });

    const project = await detectProject(dir);
    expect(project.framework).toBe('expo');

    const res = await scaffoldProject(project, {
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
      messagesDir: './messages',
    });
    expect(res.every(r => r.status === 'created')).toBe(true);

    const i18nTs = await readFile(join(dir, 'src', 'i18n.ts'), 'utf-8');
    expect(i18nTs).toContain('expo-localization');
    expect(getSyntaxErrors(parseSource(i18nTs, 'i18n.ts'))).toEqual([]);

    const switcher = await readFile(
      join(dir, 'src', 'components', 'LanguageSwitcher.tsx'),
      'utf-8',
    );
    expect(switcher).toContain("from 'react-native'");
    expect(switcher).toContain('Pressable');
    expect(switcher).not.toContain('<div');
    expect(switcher).not.toContain('document.addEventListener');
    expect(getSyntaxErrors(parseSource(switcher, 'LanguageSwitcher.tsx'))).toEqual([]);

    const layout = await readFile(join(dir, 'src', 'app', '_layout.tsx'), 'utf-8');
    expect(layout).toContain("import '../i18n';");
  });

  it('B9 : propage un messagesDir personnalisé dans request.ts (Next.js) et i18n.ts (React/Vite)', async () => {
    const nextDir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
    });
    await scaffoldProject(await detectProject(nextDir), {
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
      messagesDir: './src/locales',
    });
    const reqTs = await readFile(join(nextDir, 'i18n', 'request.ts'), 'utf-8');
    expect(reqTs).toContain('../src/locales/${locale}.json');

    const viteDir = await makeProject({
      'src/main.tsx': "import App from './App';\n",
    });
    await scaffoldProject(await detectProject(viteDir), {
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
      messagesDir: './src/locales',
    });
    const viteI18n = await readFile(join(viteDir, 'src', 'i18n.ts'), 'utf-8');
    expect(viteI18n).toContain("from './locales/fr.json'");
  });

  it('B10 : le LanguageSwitcher Next.js préserve la route sans préfixe (/tarifs -> /en/tarifs) et gère Escape/ARIA', async () => {
    const dir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
    });
    await scaffoldProject(await detectProject(dir), {
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
    });
    const switcher = await readFile(join(dir, 'components', 'LanguageSwitcher.tsx'), 'utf-8');
    expect(switcher).toContain('hasLocalePrefix');
    expect(switcher).toContain('Escape');
    expect(switcher).toContain('aria-expanded');
    expect(getSyntaxErrors(parseSource(switcher, 'LanguageSwitcher.tsx'))).toEqual([]);
  });

  it('génère une section dédiée generateMetadata dans le guide quand export const metadata est détecté', () => {
    const code =
      "export const metadata = { title: 'Accueil', description: 'Plateforme scolaire' };\n";
    const scan = scanContent(code, '/proj/app/page.tsx');
    expect(scan.strings.every(s => s.reviewReason === 'nextjs_metadata')).toBe(true);

    const guide = buildGuide(
      buildGuideModel({
        projectRoot: '/proj',
        sourceLocale: 'fr',
        targetLocales: ['en'],
        date: '18 novembre 2026',
        strings: scan.strings,
        keyMap: new Map([
          ['Accueil', 'accueil'],
          ['Plateforme scolaire', 'plateforme_scolaire'],
        ]),
        fileRuntimes: new Map([['/proj/app/page.tsx', 'server']]),
        framework: 'next-intl',
      }),
    );
    expect(guide).toContain('generateMetadata');
  });
});
