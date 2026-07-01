import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { scaffoldProject } from '../../src/adapters/scaffold';
import { detectProject } from '../../src/adapters/project';

let tmpDirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-scaffold-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

function statusOf(results: Awaited<ReturnType<typeof scaffoldProject>>, target: string) {
  return results.find(r => r.target === target)?.status;
}

const opts = { locales: ['fr', 'en'], defaultLocale: 'fr' };

afterEach(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('adapters/scaffold — scaffoldProject', () => {
  it('crée les fichiers manquants', async () => {
    const dir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'next.config.mjs': 'const config = {};\nexport default config;',
    });
    const results = await scaffoldProject(await detectProject(dir), opts);

    expect(statusOf(results, 'routing')).toBe('created');
    expect(statusOf(results, 'request')).toBe('created');
    expect(statusOf(results, 'middleware')).toBe('created');
    expect(statusOf(results, 'switcher')).toBe('created');
    expect(statusOf(results, 'config')).toBe('created');

    await access(join(dir, 'i18n', 'routing.ts'));
    await access(join(dir, 'components', 'LanguageSwitcher.tsx'));
    const routing = await readFile(join(dir, 'i18n', 'routing.ts'), 'utf-8');
    expect(routing).toContain("locales: ['fr', 'en']");

    const nextConfig = await readFile(join(dir, 'next.config.mjs'), 'utf-8');
    expect(nextConfig).toContain('withNextIntl');
    expect(nextConfig).toContain('createNextIntlPlugin');
  });

  it('respecte src/app et y place les fichiers', async () => {
    const dir = await makeProject({
      'src/app/layout.tsx': 'export default function L({children}){ return children; }',
    });
    await scaffoldProject(await detectProject(dir), opts);
    await access(join(dir, 'src', 'i18n', 'routing.ts'));
    await access(join(dir, 'src', 'components', 'LanguageSwitcher.tsx'));
  });

  it("est idempotent (ne réécrit pas l'existant)", async () => {
    const dir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'i18n/routing.ts': '// custom',
      'middleware.ts': '// custom',
    });
    const results = await scaffoldProject(await detectProject(dir), opts);

    expect(statusOf(results, 'routing')).toBe('already_present');
    expect(statusOf(results, 'middleware')).toBe('already_present');
    expect(await readFile(join(dir, 'i18n', 'routing.ts'), 'utf-8')).toBe('// custom');
  });

  it('passe config en manual si pas de next.config', async () => {
    const dir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
    });
    const results = await scaffoldProject(await detectProject(dir), opts);
    expect(statusOf(results, 'config')).toBe('manual');
  });

  it('crée proxy.ts pour Next 16+', async () => {
    const dir = await makeProject({
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'node_modules/next/package.json': JSON.stringify({ version: '16.0.0' }),
    });
    const results = await scaffoldProject(await detectProject(dir), opts);
    expect(statusOf(results, 'middleware')).toBe('created');
    await access(join(dir, 'proxy.ts'));
  });
});

describe('adapters/scaffold — scaffoldProject (react-i18next, sans Next.js)', () => {
  it('détecte react-i18next en absence de layout Next.js', async () => {
    const dir = await makeProject({ 'src/main.tsx': "import App from './App';\n" });
    const project = await detectProject(dir);
    expect(project.framework).toBe('react-i18next');
  });

  it("scaffold la config i18n, l'import du point d'entrée et le switcher", async () => {
    const dir = await makeProject({
      'src/main.tsx': "import App from './App';\nrender(<App />);\n",
    });
    const results = await scaffoldProject(await detectProject(dir), opts);

    expect(statusOf(results, 'react-i18n-config')).toBe('created');
    expect(statusOf(results, 'react-entry')).toBe('created');
    expect(statusOf(results, 'switcher')).toBe('created');

    const config = await readFile(join(dir, 'src', 'i18n.ts'), 'utf-8');
    expect(config).toContain("import fr from '../messages/fr.json'");
    expect(config).toContain("import en from '../messages/en.json'");
    expect(config).toContain("lng: 'fr'");
    expect(config).toContain('initReactI18next');

    const entry = await readFile(join(dir, 'src', 'main.tsx'), 'utf-8');
    expect(entry.startsWith("import './i18n';\n")).toBe(true);
    expect(entry).toContain("import App from './App';");

    const switcher = await readFile(
      join(dir, 'src', 'components', 'LanguageSwitcher.tsx'),
      'utf-8',
    );
    expect(switcher).toContain('react-i18next');
    expect(switcher).not.toContain('next-intl');
  });

  it("n'ajoute pas l'import une seconde fois (idempotent)", async () => {
    const dir = await makeProject({
      'src/main.tsx': "import './i18n';\nimport App from './App';\n",
    });
    const results = await scaffoldProject(await detectProject(dir), opts);
    expect(statusOf(results, 'react-entry')).toBe('already_present');
    const entry = await readFile(join(dir, 'src', 'main.tsx'), 'utf-8');
    expect(entry.match(/import '\.\/i18n'/g)).toHaveLength(1);
  });

  it("passe react-entry en manual si aucun point d'entrée reconnu", async () => {
    const dir = await makeProject({
      'src/App.tsx': 'export default function App(){ return null; }',
    });
    const results = await scaffoldProject(await detectProject(dir), opts);
    expect(statusOf(results, 'react-entry')).toBe('manual');
  });
});
