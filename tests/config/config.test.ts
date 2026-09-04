import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  buildConfig,
  isValidConfig,
  ConfigNotFoundError,
  ConfigInvalidError,
  validateConfig,
  CONFIG_SCHEMA_PATH,
} from '../../src/config';

let tmpDirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-config-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('config', () => {
  it('valide un config minimal (sourceLocale + targetLocales)', () => {
    expect(isValidConfig({ sourceLocale: 'fr', targetLocales: ['en'] })).toBe(true);
    expect(isValidConfig({ sourceLocale: 'fr' })).toBe(false);
    expect(isValidConfig({ targetLocales: ['en'] })).toBe(false);
    expect(isValidConfig(null)).toBe(false);
  });

  it('applique les défauts au chargement', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'] }),
      'utf-8',
    );
    const config = await loadConfig(dir);
    expect(config.messagesDir).toBe('./messages');
    expect(config.provider).toBe('deepl');
    expect(config.apiKeyEnv).toBe('AUTO_I18N_DEEPL_KEY');
    expect(config.ignore.length).toBeGreaterThan(0);
  });

  it('lève ConfigNotFoundError si absent', async () => {
    const dir = await tmp();
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('buildConfig produit une config complète avec $schema', () => {
    const config = buildConfig('fr', ['en', 'es']);
    expect(config.sourceLocale).toBe('fr');
    expect(config.targetLocales).toEqual(['en', 'es']);
    expect(config.messagesDir).toBe('./messages');
    expect(config.$schema).toBe(CONFIG_SCHEMA_PATH);
    expect(config.provider).toBe('deepl');
    expect(config.apiKeyEnv).toBe('AUTO_I18N_DEEPL_KEY');
  });

  it('buildConfig dérive apiKeyEnv du provider choisi', () => {
    const config = buildConfig('fr', ['en'], 'google');
    expect(config.provider).toBe('google');
    expect(config.apiKeyEnv).toBe('AUTO_I18N_GOOGLE_KEY');
  });

  it('charge une config contenant $schema sans erreur', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({ $schema: CONFIG_SCHEMA_PATH, sourceLocale: 'fr', targetLocales: ['en'] }),
      'utf-8',
    );
    const config = await loadConfig(dir);
    expect(config.sourceLocale).toBe('fr');
  });
});

describe('schema/auto-i18n.config.schema.json', () => {
  it('est un JSON Schema valide avec les champs requis', async () => {
    const raw = await readFile(
      join(import.meta.dirname, '..', '..', 'schema', 'auto-i18n.config.schema.json'),
      'utf-8',
    );
    const schema = JSON.parse(raw);
    expect(schema.$schema).toContain('json-schema.org');
    expect(schema.required).toEqual(['sourceLocale', 'targetLocales']);
    expect(schema.properties.sourceLocale).toBeDefined();
    expect(schema.properties.targetLocales).toBeDefined();
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('config — validation', () => {
  it("rejette un code de langue qui n'en est pas un", () => {
    expect(validateConfig({ sourceLocale: 'français', targetLocales: ['en'] })).toContain(
      '"sourceLocale" doit être un code de langue, ex. "fr" ou "pt-BR".',
    );
  });

  it('accepte les étiquettes BCP 47 étendues', () => {
    expect(validateConfig({ sourceLocale: 'zh-Hans-CN', targetLocales: ['pt-BR'] })).toEqual([]);
  });

  it('refuse une langue à la fois source et cible', () => {
    const problems = validateConfig({ sourceLocale: 'fr', targetLocales: ['fr', 'en'] });
    expect(problems.join(' ')).toContain('à la fois la langue source et une langue cible');
  });

  it('refuse les doublons de langues cibles', () => {
    const problems = validateConfig({ sourceLocale: 'fr', targetLocales: ['en', 'en'] });
    expect(problems.join(' ')).toContain('doublons');
  });

  it('refuse un messagesDir qui sort du projet', () => {
    // Les catalogues sont écrits sans autre contrôle en aval.
    const problems = validateConfig({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: '../../etc',
    });
    expect(problems.join(' ')).toContain("rester à l'intérieur du projet");
    expect(
      validateConfig({ sourceLocale: 'fr', targetLocales: ['en'], messagesDir: '/tmp/x' }).join(
        ' ',
      ),
    ).toContain("rester à l'intérieur du projet");
  });

  it('refuse un provider inconnu', () => {
    const problems = validateConfig({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      provider: 'chatgpt',
    });
    expect(problems.join(' ')).toContain('"provider" doit valoir');
  });

  it("signale une faute de frappe au lieu de l'ignorer", () => {
    const problems = validateConfig({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messageDir: './messages',
    });
    expect(problems.join(' ')).toContain('champ inconnu "messageDir"');
  });

  it('rapporte tous les problèmes en une passe', () => {
    const problems = validateConfig({ sourceLocale: 42, targetLocales: [], provider: 'x' });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('loadConfig lève ConfigInvalidError en listant les problèmes', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({ sourceLocale: 'fr', targetLocales: ['fr'] }),
      'utf-8',
    );
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigInvalidError);
  });

  it('accepte rootDirs', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, 'auto-i18n.config.json'),
      JSON.stringify({ sourceLocale: 'fr', targetLocales: ['en'], rootDirs: ['modules'] }),
      'utf-8',
    );
    expect((await loadConfig(dir)).rootDirs).toEqual(['modules']);
  });
});
