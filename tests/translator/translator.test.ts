import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { translateMessages } from '../../src/translator/index';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock deepl.translate pour ne pas faire de vrais appels réseau
vi.mock('../../src/translator/deepl', () => ({
  DeepLError: class DeepLError extends Error {
    constructor(
      message: string,
      public readonly code?: number,
    ) {
      super(message);
      this.name = 'DeepLError';
    }
  },
  translate: vi.fn(),
  BATCH_SIZE: 50,
}));

// Mock ora pour éviter la sortie terminal dans les tests
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

// Import du mock après vi.mock
import { translate } from '../../src/translator/deepl';
const mockTranslate = vi.mocked(translate);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-translator-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function writeJson(path: string, content: Record<string, string>) {
  await writeFile(path, JSON.stringify(content, null, 2), 'utf-8');
}

async function readJson(path: string): Promise<Record<string, string>> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as Record<string, string>;
}

beforeEach(() => {
  mockTranslate.mockReset();
});

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ─── Traduction complète ─────────────────────────────────────────────────────

describe('translateMessages — traduction complète', () => {
  it('traduit toutes les clés et écrit le fichier cible', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), {
      bonjour: 'Bonjour',
      au_revoir: 'Au revoir',
    });

    mockTranslate.mockResolvedValueOnce(['Hello', 'Goodbye']);

    await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    const en = await readJson(join(dir, 'en.json'));
    expect(en['bonjour']).toBe('Hello');
    expect(en['au_revoir']).toBe('Goodbye');
  });

  it('traduit vers plusieurs locales cibles', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), { bonjour: 'Bonjour' });

    mockTranslate
      .mockResolvedValueOnce(['Hello'])   // EN
      .mockResolvedValueOnce(['Hola'])    // ES
      .mockResolvedValueOnce(['Hallo']);  // DE

    const result = await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en', 'es', 'de'],
      messagesDir: dir,
      silent: true,
    });

    expect(result.totalTranslated).toBe(3); // 1 string × 3 locales
    const en = await readJson(join(dir, 'en.json'));
    const es = await readJson(join(dir, 'es.json'));
    const de = await readJson(join(dir, 'de.json'));
    expect(en['bonjour']).toBe('Hello');
    expect(es['bonjour']).toBe('Hola');
    expect(de['bonjour']).toBe('Hallo');
  });

  it('envoie les valeurs (pas les clés) à translate()', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), { bonjour: 'Bonjour' });

    mockTranslate.mockResolvedValueOnce(['Hello']);

    await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    expect(mockTranslate).toHaveBeenCalledWith(
      ['Bonjour'],
      'en',
      expect.objectContaining({ sourceLang: 'fr' }),
    );
  });

  it('les clés du fichier cible sont triées alphabétiquement', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), {
      zebra: 'Zèbre',
      arbre: 'Arbre',
      mangue: 'Mangue',
    });

    mockTranslate.mockResolvedValueOnce(['Zebra', 'Tree', 'Mango']);

    await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    const en = await readJson(join(dir, 'en.json'));
    const keys = Object.keys(en);
    expect(keys).toEqual([...keys].sort());
  });
});

// ─── Mode incrémental ────────────────────────────────────────────────────────

describe('translateMessages — mode incrémental', () => {
  it('ne traduit que les clés manquantes', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), {
      bonjour: 'Bonjour',
      merci: 'Merci',
      au_revoir: 'Au revoir',
    });
    // "bonjour" existe déjà en anglais
    await writeJson(join(dir, 'en.json'), { bonjour: 'Hello' });

    mockTranslate.mockResolvedValueOnce(['Thank you', 'Goodbye']);

    await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    // Vérifie que seules les clés manquantes ont été envoyées
    expect(mockTranslate).toHaveBeenCalledWith(
      expect.arrayContaining(['Merci', 'Au revoir']),
      'en',
      expect.anything(),
    );
    const sentTexts = (mockTranslate.mock.calls[0] as unknown[])[0] as string[];
    expect(sentTexts).not.toContain('Bonjour');
  });

  it('conserve les traductions existantes dans le fichier final', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), { bonjour: 'Bonjour', merci: 'Merci' });
    await writeJson(join(dir, 'en.json'), { bonjour: 'Hello' });

    mockTranslate.mockResolvedValueOnce(['Thank you']);

    await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    const en = await readJson(join(dir, 'en.json'));
    expect(en['bonjour']).toBe('Hello');   // conservée
    expect(en['merci']).toBe('Thank you'); // nouvellement traduite
  });

  it('signale les locales déjà à jour dans result.skipped', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), { bonjour: 'Bonjour' });
    await writeJson(join(dir, 'en.json'), { bonjour: 'Hello' }); // déjà complet

    const result = await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    expect(result.skipped).toContain('en');
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('result.totalTranslated comptabilise uniquement les nouvelles traductions', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), { bonjour: 'Bonjour', merci: 'Merci' });
    await writeJson(join(dir, 'en.json'), { bonjour: 'Hello' }); // 1 existante, 1 manquante

    mockTranslate.mockResolvedValueOnce(['Thank you']);

    const result = await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    expect(result.totalTranslated).toBe(1);
  });
});

// ─── Valeurs sources préservées dans le fichier cible ────────────────────────

describe('translateMessages — placeholders next-intl', () => {
  it('la valeur traduite (avec {name}) est écrite telle quelle dans le JSON', async () => {
    const dir = await makeTmpDir();
    // Le generator a déjà mis "Salut {name}" comme valeur
    await writeJson(join(dir, 'fr.json'), { salut_name: 'Salut {name}' });

    // Le mock simule ce que translate() retourne après restauration des placeholders
    mockTranslate.mockResolvedValueOnce(['Hello {name}']);

    await translateMessages({
      sourceLocale: 'fr',
      targetLocales: ['en'],
      messagesDir: dir,
      silent: true,
    });

    const en = await readJson(join(dir, 'en.json'));
    expect(en['salut_name']).toBe('Hello {name}');
  });
});

// ─── Gestion d'erreurs ───────────────────────────────────────────────────────

describe('translateMessages — gestion d\'erreurs', () => {
  it('propage l\'erreur si translate() échoue', async () => {
    const dir = await makeTmpDir();
    await writeJson(join(dir, 'fr.json'), { bonjour: 'Bonjour' });

    const { DeepLError } = await import('../../src/translator/deepl');
    mockTranslate.mockRejectedValueOnce(new DeepLError('Quota dépassé', 456));

    await expect(
      translateMessages({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        messagesDir: dir,
        silent: true,
      }),
    ).rejects.toThrow('Quota dépassé');
  });

  it('lance une erreur si le fichier source est absent', async () => {
    const dir = await makeTmpDir();
    // Pas de fr.json

    await expect(
      translateMessages({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        messagesDir: dir,
        silent: true,
      }),
    ).rejects.toThrow();
  });
});
