import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, buildConfig, isValidConfig, ConfigNotFoundError, CONFIG_SCHEMA_PATH } from '../../src/config';

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
