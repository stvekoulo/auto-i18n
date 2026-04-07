import { describe, it, expect, afterEach } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { ChildProcess, spawn } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const CLI_ENTRY = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');
const TSX_CLI = resolve(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

let tmpDirs: string[] = [];
let activeChildren: ChildProcess[] = [];

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-cli-e2e-'));
  tmpDirs.push(dir);
  return dir;
}

async function writeMockFetchModule(dir: string): Promise<string> {
  const mockDir = await mkdtemp(join(tmpdir(), 'auto-i18n-fetch-mock-'));
  tmpDirs.push(mockDir);
  const mockPath = join(mockDir, 'mock-fetch.mjs');
  await writeFile(
    mockPath,
    `globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body ?? '{}');
      const target = String(body.target_lang ?? 'XX').toUpperCase();
      const texts = Array.isArray(body.text) ? body.text : [];
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            translations: texts.map((text) => ({
              text: '[' + target + '] ' + text,
              detected_source_language: 'FR',
            })),
          };
        },
      };
    };
`,
    'utf-8',
  );
  return mockPath;
}

async function runCli(
  cwd: string,
  args: string[],
  options: { input?: string; mockFetch?: boolean } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env };

  if (options.mockFetch) {
    const mockModule = await writeMockFetchModule(cwd);
    env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${pathToFileURL(mockModule).href}`]
      .filter(Boolean)
      .join(' ');
  }

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, CLI_ENTRY, ...args],
      {
        cwd,
        env,
        stdio: 'pipe',
      },
    );

    let stdout = '';
    let stderr = '';
    activeChildren.push(child);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', code => {
      activeChildren = activeChildren.filter(item => item !== child);
      resolvePromise({
        code,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
      });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

afterEach(async () => {
  for (const child of activeChildren) {
    if (!child.killed) {
      child.kill();
    }
  }
  activeChildren = [];
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('CLI e2e', () => {
  it('missing signale les clés absentes dans les locales cibles', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'messages'), { recursive: true });
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        provider: 'deepl',
        apiKeyEnv: 'AUTO_I18N_DEEPL_KEY',
        messagesDir: './messages',
        ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
      }, null, 2),
      'utf-8',
    );
    await writeFile(join(dir, 'messages', 'fr.json'), JSON.stringify({ bonjour: 'Bonjour', salut: 'Salut' }, null, 2), 'utf-8');
    await writeFile(join(dir, 'messages', 'en.json'), JSON.stringify({ bonjour: 'Hello' }, null, 2), 'utf-8');

    const result = await runCli(dir, ['missing']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('en — 1 clé manquante');
    expect(result.stdout).toContain('salut');
  }, 15000);

  it('extract --inject reste partiel et ne restructure pas app/[locale] sur un layout complexe', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'messages'), { recursive: true });
    await writeFile(
      join(dir, '.env.local'),
      'AUTO_I18N_DEEPL_KEY=test-key\n',
      'utf-8',
    );
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        provider: 'deepl',
        apiKeyEnv: 'AUTO_I18N_DEEPL_KEY',
        messagesDir: './messages',
        ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
      }, null, 2),
      'utf-8',
    );
    await writeFile(
      join(dir, 'app', 'layout.tsx'),
      'export const metadata = {}; export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      'utf-8',
    );
    await writeFile(join(dir, 'next.config.ts'), 'const nextConfig = {}; export default nextConfig;', 'utf-8');
    await writeFile(join(dir, 'app', 'page.tsx'), 'export default function Page() { return <p>Bonjour</p>; }', 'utf-8');
    await writeFile(join(dir, 'messages', 'fr.json'), JSON.stringify({ bonjour: 'Bonjour' }, null, 2), 'utf-8');
    await writeFile(join(dir, 'messages', 'en.json'), JSON.stringify({ bonjour: 'Hello' }, null, 2), 'utf-8');

    const result = await runCli(
      dir,
      ['extract', '--inject'],
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Exécution partielle');
    expect(result.stdout).toContain('Injection bloquée pour: localeStructure');
    await expect(access(join(dir, 'app', '[locale]'))).rejects.toThrow();
  }, 15000);

  it('add-locale ajoute la locale, traduit les messages et respecte les blocages d’injection', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'messages'), { recursive: true });
    await writeFile(
      join(dir, '.env.local'),
      'AUTO_I18N_DEEPL_KEY=test-key\n',
      'utf-8',
    );
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: [],
        provider: 'deepl',
        apiKeyEnv: 'AUTO_I18N_DEEPL_KEY',
        messagesDir: './messages',
        ignore: ['node_modules', '.next', '**/*.test.*', '**/*.spec.*'],
      }, null, 2),
      'utf-8',
    );
    await writeFile(
      join(dir, 'app', 'layout.tsx'),
      'export const metadata = {}; export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      'utf-8',
    );
    await writeFile(join(dir, 'next.config.ts'), 'const nextConfig = {}; export default nextConfig;', 'utf-8');
    await writeFile(join(dir, 'messages', 'fr.json'), JSON.stringify({ bonjour: 'Bonjour' }, null, 2), 'utf-8');

    const result = await runCli(
      dir,
      ['add-locale', 'en'],
      { mockFetch: true },
    );

    const config = JSON.parse(await readFile(join(dir, 'auto-i18n.config.json'), 'utf-8')) as { targetLocales: string[] };
    const enMessages = JSON.parse(await readFile(join(dir, 'messages', 'en.json'), 'utf-8')) as Record<string, string>;

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Configuration Next.js mise à jour partiellement');
    expect(config.targetLocales).toContain('en');
    expect(enMessages.bonjour).toContain('[EN]');
    await expect(access(join(dir, 'app', '[locale]'))).rejects.toThrow();
  }, 15000);
});
