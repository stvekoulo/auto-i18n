import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSyncCommand } from '../../src/commands/sync.js';
import { runCheck } from '../../src/commands/check.js';
import { runAddLocale } from '../../src/commands/add-locale.js';
import { runCleanBackups, runRestoreBackups } from '../../src/commands/backups.js';
import { startWatchSync } from '../../src/commands/watch.js';

const dirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-cmds-'));
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

describe('v3 — Nouvelles commandes CLI (add-locale, backups, check --format github, watch)', () => {
  it('add-locale met à jour config + routing.ts et traduit la nouvelle langue', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({
        sourceLocale: 'fr',
        targetLocales: ['en'],
      }),
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'i18n/routing.ts':
        "import { defineRouting } from 'next-intl/routing';\nexport const routing = defineRouting({\n  locales: ['fr', 'en'],\n  defaultLocale: 'fr',\n});\n",
      'app/page.tsx': 'export default async function Page() { return <h1>Bonjour</h1>; }',
      'messages/fr.json': JSON.stringify({ bonjour: 'Bonjour' }),
      'messages/en.json': JSON.stringify({ bonjour: 'Hello' }),
    });

    const res = await runAddLocale({
      projectRoot: dir,
      locales: ['es'],
      provider: { name: 'mock', translate: async texts => texts.map(t => `ES:${t}`) },
    });

    expect(res.exitCode).toBe(0);
    expect(res.addedLocales).toEqual(['es']);

    const cfg = JSON.parse(await readFile(join(dir, 'auto-i18n.config.json'), 'utf-8'));
    expect(cfg.targetLocales).toEqual(['en', 'es']);

    const routing = await readFile(join(dir, 'i18n/routing.ts'), 'utf-8');
    expect(routing).toContain("'es'");

    const esCatalog = JSON.parse(await readFile(join(dir, 'messages/es.json'), 'utf-8'));
    expect(esCatalog).toEqual({ bonjour: 'ES:Bonjour' });
  });

  it('supporte --no-backup, restore et clean-backups sur les composants modifiés', async () => {
    const original =
      "'use client';\nexport function Btn() {\n  return <button>Valider</button>;\n}\n";
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'] }),
      'app/layout.tsx': 'export default function L({children}){ return children; }',
      'components/Btn.tsx': original,
      'messages/fr.json': JSON.stringify({ valider: 'Valider' }),
      'messages/en.json': JSON.stringify({ valider: 'Submit' }),
    });

    // 1. Avec backup (par défaut) puis restore :
    await runSyncCommand({ projectRoot: dir, write: true });
    expect(await readFile(join(dir, 'components/Btn.tsx'), 'utf-8')).toContain('{t("valider")}');
    const restored = await runRestoreBackups({ projectRoot: dir });
    expect(restored.restoredFiles).toHaveLength(1);
    expect(await readFile(join(dir, 'components/Btn.tsx'), 'utf-8')).toBe(original);

    // 2. Avec noBackup: true : aucun fichier .backup créé
    await runSyncCommand({ projectRoot: dir, write: true, noBackup: true });
    expect(await readFile(join(dir, 'components/Btn.tsx'), 'utf-8')).toContain('{t("valider")}');
    expect((await readdir(join(dir, 'components'))).filter(f => f.includes('.backup'))).toEqual([]);

    // 3. clean-backups supprime les fichiers .backup résiduels
    await writeFile(join(dir, 'components/Btn.tsx.backup'), original, 'utf-8');
    const cleaned = await runCleanBackups({ projectRoot: dir });
    expect(cleaned.removedFiles).toHaveLength(1);
    expect((await readdir(join(dir, 'components'))).filter(f => f.includes('.backup'))).toEqual([]);
  });

  it('check --format github émet des annotations ::warning et ::error', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'] }),
      'app/page.tsx': 'export default function Page() { return <h1>Nouveau</h1>; }',
      'messages/fr.json': JSON.stringify({ ancien: 'Ancien' }),
      'messages/en.json': JSON.stringify({}),
    });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(msg => logs.push(String(msg)));

    const res = await runCheck({ projectRoot: dir, format: 'github' });
    expect(res.exitCode).toBe(1);
    expect(logs.some(l => l.startsWith('::warning file=app/page.tsx,line=1'))).toBe(true);
    expect(logs.some(l => l.startsWith('::error title=Traductions manquantes (en)::'))).toBe(true);
  });

  it('startWatchSync détecte la modification d’un composant et synchronise automatiquement', async () => {
    const dir = await makeProject({
      'auto-i18n.config.json': JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'] }),
      'src/App.tsx': 'export function App() { return <h1>Initial</h1>; }',
      'messages/fr.json': JSON.stringify({ initial: 'Initial' }),
      'messages/en.json': JSON.stringify({ initial: 'EN:Initial' }),
    });

    let syncRuns = 0;
    let resolveSecond!: () => void;
    const syncedPromise = new Promise<void>(resolve => {
      resolveSecond = resolve;
    });

    const watcher = await startWatchSync({
      projectRoot: dir,
      debounceMs: 60,
      provider: { name: 'mock', translate: async texts => texts.map(t => `EN:${t}`) },
      onSync: () => {
        syncRuns++;
        if (syncRuns >= 1) resolveSecond();
      },
    });

    try {
      await writeFile(
        join(dir, 'src/App.tsx'),
        'export function App() { return <h1>Ajouté en direct</h1>; }',
        'utf-8',
      );
      await syncedPromise;
      const en = JSON.parse(await readFile(join(dir, 'messages/en.json'), 'utf-8'));
      expect(en['ajoute_en_direct']).toBe('EN:Ajouté en direct');
    } finally {
      watcher.close();
    }
  });
});
