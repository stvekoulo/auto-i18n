import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  saveConfig,
  buildConfig,
  validateConfig,
  findMissingKeys,
  CONFIG_FILENAME,
} from '../../src/utils/config';
import { ensureGitignore, saveApiKeyToEnv } from '../../src/utils/env';

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-cli-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('buildConfig', () => {
  it('construit une config avec les valeurs par défaut', () => {
    const config = buildConfig('fr', ['en', 'es']);
    expect(config.sourceLocale).toBe('fr');
    expect(config.targetLocales).toEqual(['en', 'es']);
    expect(config.provider).toBe('deepl');
    expect(config.apiKeyEnv).toBe('AUTO_I18N_DEEPL_KEY');
    expect(config.messagesDir).toBe('./messages');
    expect(config.ignore).toContain('node_modules');
  });
});

describe('validateConfig', () => {
  it('valide une config correcte', () => {
    expect(validateConfig({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: './messages',
    })).toBe(true);
  });

  it('rejette un objet incomplet', () => {
    expect(validateConfig({ sourceLocale: 'fr' })).toBe(false);
  });

  it('rejette null', () => {
    expect(validateConfig(null)).toBe(false);
  });

  it('rejette des targetLocales non-array', () => {
    expect(validateConfig({
      sourceLocale: 'fr',
      targetLocales: 'en',
      messagesDir: './messages',
    })).toBe(false);
  });
});

describe('saveConfig / loadConfig', () => {
  it('sauvegarde et relit une config', async () => {
    const dir = await makeTmpDir();
    const config = buildConfig('fr', ['en', 'de']);

    await saveConfig(dir, config);

    const loaded = await loadConfig(dir);
    expect(loaded.sourceLocale).toBe('fr');
    expect(loaded.targetLocales).toEqual(['en', 'de']);
    expect(loaded.provider).toBe('deepl');
  });

  it('lance une erreur si le fichier est absent', async () => {
    const dir = await makeTmpDir();
    await expect(loadConfig(dir)).rejects.toThrow();
  });

  it('lance une erreur si la config est invalide', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, CONFIG_FILENAME), '{"foo": "bar"}', 'utf-8');
    await expect(loadConfig(dir)).rejects.toThrow('invalide');
  });
});

describe('findMissingKeys', () => {
  it('retourne les clés absentes du target', () => {
    const source = { hello: 'Bonjour', bye: 'Au revoir', thanks: 'Merci' };
    const target = { hello: 'Hello' };
    expect(findMissingKeys(source, target)).toEqual(['bye', 'thanks']);
  });

  it('retourne un tableau vide si tout est traduit', () => {
    const source = { hello: 'Bonjour' };
    const target = { hello: 'Hello' };
    expect(findMissingKeys(source, target)).toEqual([]);
  });

  it('retourne toutes les clés si le target est vide', () => {
    const source = { a: '1', b: '2' };
    expect(findMissingKeys(source, {})).toEqual(['a', 'b']);
  });
});

describe('ensureGitignore', () => {
  it('crée .gitignore si absent et ajoute les entrées', async () => {
    const dir = await makeTmpDir();

    const added = await ensureGitignore(dir, ['.env.local', '*.backup']);

    expect(added).toEqual(['.env.local', '*.backup']);
    const content = await readFile(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('.env.local');
    expect(content).toContain('*.backup');
    expect(content).toContain('# auto-i18n');
  });

  it("n'ajoute pas d'entrée déjà présente", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, '.gitignore'), '.env.local\nnode_modules\n', 'utf-8');

    const added = await ensureGitignore(dir, ['.env.local', '*.backup']);

    expect(added).toEqual(['*.backup']);
    const content = await readFile(join(dir, '.gitignore'), 'utf-8');
    // .env.local ne doit apparaître qu'une fois
    const count = content.split('.env.local').length - 1;
    expect(count).toBe(1);
  });

  it("retourne un tableau vide si tout est déjà présent", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, '.gitignore'), '.env.local\n*.backup\n', 'utf-8');

    const added = await ensureGitignore(dir, ['.env.local', '*.backup']);

    expect(added).toEqual([]);
  });
});

describe('saveApiKeyToEnv', () => {
  it('crée .env.local avec la clé', async () => {
    const dir = await makeTmpDir();

    await saveApiKeyToEnv(dir, 'AUTO_I18N_DEEPL_KEY', 'my-key-123');

    const content = await readFile(join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTO_I18N_DEEPL_KEY=my-key-123');
  });

  it('met à jour une clé existante', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, '.env.local'), 'AUTO_I18N_DEEPL_KEY=old-key\nOTHER=value\n', 'utf-8');

    await saveApiKeyToEnv(dir, 'AUTO_I18N_DEEPL_KEY', 'new-key');

    const content = await readFile(join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('AUTO_I18N_DEEPL_KEY=new-key');
    expect(content).not.toContain('old-key');
    expect(content).toContain('OTHER=value');
  });

  it('ajoute sans dupliquer', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, '.env.local'), 'EXISTING=hello\n', 'utf-8');

    await saveApiKeyToEnv(dir, 'AUTO_I18N_DEEPL_KEY', 'key');

    const content = await readFile(join(dir, '.env.local'), 'utf-8');
    expect(content).toContain('EXISTING=hello');
    expect(content).toContain('AUTO_I18N_DEEPL_KEY=key');
  });
});

describe('missing — scénario fichiers', () => {
  it('détecte les clés manquantes dans un fichier cible', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'messages'), { recursive: true });

    const source = { hello: 'Bonjour', bye: 'Au revoir', thanks: 'Merci' };
    const target = { hello: 'Hello' };

    await writeFile(join(dir, 'messages', 'fr.json'), JSON.stringify(source), 'utf-8');
    await writeFile(join(dir, 'messages', 'en.json'), JSON.stringify(target), 'utf-8');

    const sourceData = JSON.parse(await readFile(join(dir, 'messages', 'fr.json'), 'utf-8'));
    const targetData = JSON.parse(await readFile(join(dir, 'messages', 'en.json'), 'utf-8'));

    const missing = findMissingKeys(sourceData, targetData);
    expect(missing).toEqual(['bye', 'thanks']);
  });
});
