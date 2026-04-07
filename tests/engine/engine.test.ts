import { describe, it, expect, afterEach } from 'vitest';
import { access, mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { analyzeProject } from '../../src/engine/analysis';
import { planProjectChanges } from '../../src/engine/planning';
import { applyProjectChanges } from '../../src/engine/apply';

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-engine-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('analyzeProject', () => {
  it('classe les strings module-scope et garde les occurrences JSX réécrivable', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(
      join(dir, 'app', 'page.tsx'),
      `
        const menu = ["Accueil"];
        export default function Page() {
          return <p>Accueil</p>;
        }
      `,
      'utf-8',
    );

    const analysis = await analyzeProject({
      projectRoot: dir,
      includeModuleScope: false,
    });

    expect(analysis.summary.moduleScopeCount).toBe(1);
    expect(analysis.selectedStrings.some(item => item.type === 'jsx-text' && item.value === 'Accueil')).toBe(true);
    expect(analysis.selectedStrings.some(item => item.type === 'string-literal' && item.value === 'Accueil')).toBe(false);
  });

  it('inclut les strings module-scope quand includeModuleScope est activé', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(
      join(dir, 'app', 'page.tsx'),
      `
        const title = "Accueil";
        export default function Page() {
          return <p>Bonjour</p>;
        }
      `,
      'utf-8',
    );

    const analysis = await analyzeProject({
      projectRoot: dir,
      includeModuleScope: true,
    });

    expect(analysis.selectedStrings.some(item => item.type === 'string-literal' && item.value === 'Accueil')).toBe(true);
  });

  it('produit des diagnostics ignored, already_translated et unsafe_to_rewrite', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(
      join(dir, 'app', 'page.tsx'),
      `
        export default function Page() {
          return (
            <div>
              <p>Bonjour</p>
              <p>flex items-center</p>
              <p>
                Salut
                <strong>Jean</strong>
              </p>
            </div>
          );
        }
      `,
      'utf-8',
    );

    const analysis = await analyzeProject({
      projectRoot: dir,
      existingMessages: { bonjour: 'Bonjour' },
      includeModuleScope: true,
    });

    expect(analysis.diagnostics.some(item => item.code === 'css_class_string')).toBe(true);
    expect(analysis.candidates.some(item => item.status === 'already_translated' && item.value === 'Bonjour')).toBe(true);
    expect(analysis.candidates.some(item => item.status === 'unsafe_to_rewrite' && item.value === 'Salut')).toBe(true);
  });
});

describe('planProjectChanges', () => {
  it('construit un plan centralisé avec messages, rewrite et traduction', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'page.tsx'), 'export default function Page() { return <p>Bonjour</p>; }', 'utf-8');

    const analysis = await analyzeProject({
      projectRoot: dir,
      includeModuleScope: true,
    });

    const plan = await planProjectChanges({
      projectRoot: dir,
      analysis,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: './messages',
      existingMessages: {},
      apiKey: 'test-key',
      shouldRewrite: true,
      shouldTranslate: true,
      shouldInject: false,
    });

    expect(plan.messagesPlan.keyMap.get('Bonjour')).toBe('bonjour');
    expect(plan.rewritePlan.filePaths).toHaveLength(1);
    expect(plan.translationPlan.enabled).toBe(true);
    expect(plan.injectionPlan.enabled).toBe(false);
  });

  it('marque l’injection en manual_required pour un layout complexe', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'layout.tsx'), `export const metadata = {}; export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }`, 'utf-8');
    await writeFile(join(dir, 'next.config.ts'), 'const nextConfig = {}; export default nextConfig;', 'utf-8');
    await writeFile(join(dir, 'app', 'page.tsx'), 'export default function Page() { return <p>Bonjour</p>; }', 'utf-8');

    const analysis = await analyzeProject({ projectRoot: dir, includeModuleScope: true });
    const plan = await planProjectChanges({
      projectRoot: dir,
      analysis,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: './messages',
      existingMessages: {},
      shouldRewrite: true,
      shouldTranslate: true,
      shouldInject: true,
    });

    expect(plan.injectionPlan.decisions.some(item => item.target === 'localeStructure' && item.status === 'manual_required')).toBe(true);
    expect(plan.injectionPlan.injectionBlocked).toContain('localeStructure');
  });
});

describe('applyProjectChanges', () => {
  it('retourne un statut partial et des step logs quand une étape échoue partiellement', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'page.tsx'), 'export default function Page() { return <p>Bonjour</p>; }', 'utf-8');

    const analysis = await analyzeProject({ projectRoot: dir, includeModuleScope: true });
    const plan = await planProjectChanges({
      projectRoot: dir,
      analysis,
      sourceLocale: 'fr',
      targetLocales: [],
      messagesDir: join(dir, 'messages'),
      existingMessages: {},
      shouldRewrite: true,
      shouldTranslate: false,
      shouldInject: true,
    });

    const result = await applyProjectChanges(plan, dir);

    expect(result.stepLogs.length).toBeGreaterThan(0);
    expect(['success', 'partial']).toContain(result.status);
  });

  it('n’applique pas la restructuration locale quand le plan la bloque en manual_required', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(
      join(dir, 'app', 'layout.tsx'),
      `export const metadata = {}; export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }`,
      'utf-8',
    );
    await writeFile(join(dir, 'next.config.ts'), 'const nextConfig = {}; export default nextConfig;', 'utf-8');
    await writeFile(join(dir, 'app', 'page.tsx'), 'export default function Page() { return <p>Bonjour</p>; }', 'utf-8');

    const analysis = await analyzeProject({ projectRoot: dir, includeModuleScope: true });
    const plan = await planProjectChanges({
      projectRoot: dir,
      analysis,
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: join(dir, 'messages'),
      existingMessages: {},
      apiKey: 'test-key',
      shouldRewrite: false,
      shouldTranslate: false,
      shouldInject: true,
    });

    const result = await applyProjectChanges(plan, dir);

    await expect(access(join(dir, 'app', '[locale]'))).rejects.toThrow();
    expect(result.status).toBe('partial');
    expect(result.injectionResult?.localeStructure.skipped).toBe(true);
    expect(result.injectionResult?.localeStructure.error).toContain('Layout complexe détecté');
  });
});
