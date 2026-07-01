import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCheck } from '../../src/commands/check';

let tmpDirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-check-'));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
  return dir;
}

const CONFIG = JSON.stringify({
  sourceLocale: 'fr',
  targetLocales: ['en'],
  messagesDir: './messages',
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('commands/check — runCheck', () => {
  it('signale les strings non cataloguées et sort en code 1', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = await makeProject({
      'auto-i18n.config.json': CONFIG,
      'app/page.tsx': 'export default function Page(){ return <h1>Bonjour</h1>; }',
    });

    const { report, exitCode } = await runCheck({ projectRoot: dir });

    expect(report.detected.total).toBe(1);
    expect(report.uncatalogued).toEqual(['Bonjour']);
    expect(exitCode).toBe(1);
  });

  it('sort en code 0 quand le catalogue et les traductions sont complets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = await makeProject({
      'auto-i18n.config.json': CONFIG,
      'app/page.tsx': 'export default function Page(){ return <h1>Bonjour</h1>; }',
      'messages/fr.json': JSON.stringify({ bonjour: 'Bonjour' }),
      'messages/en.json': JSON.stringify({ bonjour: 'Hello' }),
    });

    const { report, exitCode } = await runCheck({ projectRoot: dir });

    expect(report.uncatalogued).toEqual([]);
    expect(report.totalMissing).toBe(0);
    expect(report.ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  it('détecte les traductions manquantes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = await makeProject({
      'auto-i18n.config.json': CONFIG,
      'app/page.tsx': 'export default function Page(){ return <h1>Bonjour</h1>; }',
      'messages/fr.json': JSON.stringify({ bonjour: 'Bonjour' }),
      'messages/en.json': JSON.stringify({}),
    });

    const { report, exitCode } = await runCheck({ projectRoot: dir });

    expect(report.missingByLocale.en).toEqual(['bonjour']);
    expect(exitCode).toBe(1);
  });

  it('émet du JSON en mode json', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const dir = await makeProject({
      'auto-i18n.config.json': CONFIG,
      'app/page.tsx': 'export default function Page(){ return <h1>Bonjour</h1>; }',
    });

    await runCheck({ projectRoot: dir, json: true });

    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.detected.total).toBe(1);
  });
});
