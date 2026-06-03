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

  it('est idempotent (ne réécrit pas l\'existant)', async () => {
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
