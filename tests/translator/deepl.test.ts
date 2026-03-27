import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translate, DeepLError, BATCH_SIZE } from '../../src/translator/deepl';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Simule une réponse DeepL réussie. */
function mockSuccess(translations: string[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        translations: translations.map(text => ({ text, detected_source_language: 'FR' })),
      }),
  });
}

/** Simule une réponse d'erreur DeepL. */
function mockError(status: number, body = '') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  process.env['AUTO_I18N_DEEPL_KEY'] = 'test-key:fx';
});

afterEach(() => {
  delete process.env['AUTO_I18N_DEEPL_KEY'];
});

describe('translate — cas normaux', () => {
  it('retourne les textes traduits dans le bon ordre', async () => {
    mockSuccess(['Hello', 'Goodbye']);
    const result = await translate(['Bonjour', 'Au revoir'], 'EN');
    expect(result).toEqual(['Hello', 'Goodbye']);
  });

  it('retourne un tableau vide si texts est vide', async () => {
    const result = await translate([], 'EN');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('envoie le bon corps de requête à DeepL', async () => {
    mockSuccess(['Hello']);
    await translate(['Bonjour'], 'EN');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.target_lang).toBe('EN');
    expect(body.tag_handling).toBe('xml');
    expect(body.tag_handling_version).toBe('v2');
    expect(body.ignore_tags).toContain('x');
  });

  it('utilise l\'endpoint free (api-free.deepl.com) pour les clés ":fx"', async () => {
    mockSuccess(['Hello']);
    process.env['AUTO_I18N_DEEPL_KEY'] = 'my-key:fx';
    await translate(['Bonjour'], 'EN');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('api-free.deepl.com');
  });

  it('utilise l\'endpoint pro (api.deepl.com) pour les clés sans ":fx"', async () => {
    mockSuccess(['Hello']);
    process.env['AUTO_I18N_DEEPL_KEY'] = 'my-pro-key-xyz';
    await translate(['Bonjour'], 'EN');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('api.deepl.com');
    expect(url).not.toContain('api-free');
  });

  it('envoie l\'Authorization header avec la clé API', async () => {
    mockSuccess(['Hello']);
    await translate(['Bonjour'], 'EN');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('DeepL-Auth-Key test-key:fx');
  });

  it('accepte une clé API passée en option (override env)', async () => {
    mockSuccess(['Hello']);
    await translate(['Bonjour'], 'EN', { apiKey: 'override-key:fx' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('DeepL-Auth-Key override-key:fx');
  });
});

describe('translate — préservation des placeholders {varname}', () => {
  it('préserve {name} dans la traduction', async () => {
    mockSuccess(['Hello <x>name</x>!']);
    const result = await translate(['Bonjour {name} !'], 'EN');
    expect(result[0]).toBe('Hello {name}!');
  });

  it('préserve plusieurs placeholders', async () => {
    mockSuccess(['You have <x>count</x> messages, <x>name</x>']);
    const result = await translate(['Vous avez {count} messages, {name}'], 'EN');
    expect(result[0]).toBe('You have {count} messages, {name}');
  });

  it('préserve les placeholders avec expressions composées (user.name)', async () => {
    mockSuccess(['Hello <x>user.name</x>']);
    const result = await translate(['Bonjour {user.name}'], 'EN');
    expect(result[0]).toBe('Hello {user.name}');
  });

  it('envoie les placeholders encapsulés dans <x>...</x> à DeepL', async () => {
    mockSuccess(['Hello <x>name</x>']);
    await translate(['Bonjour {name}'], 'EN');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string[] };
    expect(body.text[0]).toContain('<x>name</x>');
    expect(body.text[0]).not.toContain('{name}');
  });

  it('gère les textes sans placeholder normalement', async () => {
    mockSuccess(['Good morning']);
    const result = await translate(['Bonjour'], 'EN');
    expect(result[0]).toBe('Good morning');
  });

  it('restaure même si DeepL ajoute des espaces autour des balises', async () => {
    mockSuccess(['Hello <x> name </x>!']);
    const result = await translate(['Bonjour {name} !'], 'EN');
    expect(result[0]).toBe('Hello {name}!');
  });

  it('restaure les entités &apos; et &quot; retournées par DeepL', async () => {
    mockSuccess(["It&apos;s an exception"]);
    const result = await translate(["C'est une exception"], 'EN');
    expect(result[0]).toBe("It's an exception");
  });

  it('restaure &#39; et &#x27; retournées par DeepL', async () => {
    mockSuccess(["It&#39;s a test &#x27;value&#x27;"]);
    const result = await translate(["C'est un test 'value'"], 'EN');
    expect(result[0]).toBe("It's a test 'value'");
  });

  it('restaure &quot; retourné par DeepL', async () => {
    mockSuccess(['Say &quot;hello&quot;']);
    const result = await translate(['Dis "bonjour"'], 'EN');
    expect(result[0]).toBe('Say "hello"');
  });

  it('échappe les caractères XML spéciaux dans le texte libre', async () => {
    mockSuccess(['Price &amp; <x>count</x> items']);
    await translate(['Prix & {count} articles'], 'EN');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string[] };
    expect(body.text[0]).toContain('&amp;');
    expect(body.text[0]).toContain('<x>count</x>');
  });
});

describe('translate — batching automatique', () => {
  it(`découpe en batches de ${BATCH_SIZE} strings max`, async () => {
    const texts = Array.from({ length: BATCH_SIZE + 10 }, (_, i) => `Texte ${i}`);
    // Premier batch
    mockSuccess(Array.from({ length: BATCH_SIZE }, (_, i) => `Text ${i}`));
    // Deuxième batch
    mockSuccess(Array.from({ length: 10 }, (_, i) => `Text ${BATCH_SIZE + i}`));

    const result = await translate(texts, 'EN');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(BATCH_SIZE + 10);
  });

  it('premier batch = exactement BATCH_SIZE strings', async () => {
    const texts = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => `Texte ${i}`);
    mockSuccess(Array.from({ length: BATCH_SIZE }, (_, i) => `Text ${i}`));
    mockSuccess(['Last text']);

    await translate(texts, 'EN');

    const firstBody = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { text: string[] };
    expect(firstBody.text).toHaveLength(BATCH_SIZE);
  });

  it('un seul batch si texts.length <= BATCH_SIZE', async () => {
    mockSuccess(['A', 'B', 'C']);
    await translate(['X', 'Y', 'Z'], 'EN');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('translate — gestion des erreurs', () => {
  it('lance DeepLError si la clé API est absente', async () => {
    delete process.env['AUTO_I18N_DEEPL_KEY'];
    await expect(translate(['Bonjour'], 'EN')).rejects.toThrow(DeepLError);
    await expect(translate(['Bonjour'], 'EN')).rejects.toThrow(/manquante/);
  });

  it('lance DeepLError avec code 403 pour clé invalide', async () => {
    expect.assertions(3);
    mockError(403);
    try {
      await translate(['Bonjour'], 'EN');
    } catch (e) {
      const err = e as DeepLError;
      expect(err).toBeInstanceOf(DeepLError);
      expect(err.code).toBe(403);
      expect(err.message).toMatch(/invalide|non autorisée/i);
    }
  });

  it('lance DeepLError avec code 456 pour quota dépassé', async () => {
    expect.assertions(3);
    mockError(456);
    try {
      await translate(['Bonjour'], 'EN');
    } catch (e) {
      const err = e as DeepLError;
      expect(err).toBeInstanceOf(DeepLError);
      expect(err.code).toBe(456);
      expect(err.message).toMatch(/quota/i);
    }
  });

  it('lance DeepLError avec code 429 pour trop de requêtes', async () => {
    expect.assertions(2);
    mockError(429);
    try {
      await translate(['Bonjour'], 'EN');
    } catch (e) {
      const err = e as DeepLError;
      expect(err).toBeInstanceOf(DeepLError);
      expect(err.code).toBe(429);
    }
  });

  it('lance DeepLError sur erreur réseau (fetch rejects)', async () => {
    expect.assertions(2);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    try {
      await translate(['Bonjour'], 'EN');
    } catch (e) {
      const err = e as DeepLError;
      expect(err).toBeInstanceOf(DeepLError);
      expect(err.message).toMatch(/réseau/i);
    }
  });

  it('DeepLError.name === "DeepLError"', async () => {
    expect.assertions(1);
    mockError(403);
    try {
      await translate(['Bonjour'], 'EN');
    } catch (e) {
      expect((e as DeepLError).name).toBe('DeepLError');
    }
  });
});
