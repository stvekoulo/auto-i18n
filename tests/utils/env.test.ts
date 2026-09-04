import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveApiKeyToEnv } from '../../src/utils/env';

let tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-env-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map(d => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('utils/env — saveApiKeyToEnv', () => {
  it('remplace la ligne existante sans toucher aux autres', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, '.env.local'), 'OTHER=1\nAUTO_I18N_DEEPL_KEY=old\n', 'utf-8');

    await saveApiKeyToEnv(dir, 'AUTO_I18N_DEEPL_KEY', 'new');

    const content = await readFile(join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('OTHER=1');
    expect(content).toContain('AUTO_I18N_DEEPL_KEY=new');
    expect(content).not.toContain('old');
  });

  it('traite un nom de variable exotique comme du texte, pas comme un motif', async () => {
    // `apiKeyEnv` vient du fichier de config : il ne doit jamais être compilé
    // tel quel en expression régulière.
    const dir = await makeDir();
    await saveApiKeyToEnv(dir, 'A.*B', 'v');

    const content = await readFile(join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('A.*B=v');
  });

  it('insère la valeur littéralement, même si elle contient $&', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, '.env.local'), 'K=old\n', 'utf-8');

    await saveApiKeyToEnv(dir, 'K', 'a$&b');

    expect(await readFile(join(dir, '.env.local'), 'utf-8')).toContain('K=a$&b');
  });

  it('crée le fichier en 0600 sur un système POSIX', async () => {
    const dir = await makeDir();
    await saveApiKeyToEnv(dir, 'K', 'secret');

    const mode = (await stat(join(dir, '.env.local'))).mode & 0o777;
    // Windows n'expose pas les bits POSIX : on vérifie seulement l'absence
    // d'accès pour les autres là où la notion existe.
    if (process.platform !== 'win32') expect(mode).toBe(0o600);
  });
});
