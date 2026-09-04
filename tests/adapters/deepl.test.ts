import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeepLProvider } from '../../src/adapters/translation/deepl';
import { TranslationError } from '../../src/adapters/translation/types';
import { createProvider } from '../../src/adapters/translation';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

function translations(texts: string[]) {
  return { translations: texts.map(text => ({ text, detected_source_language: 'FR' })) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adapters/translation/deepl — DeepLProvider', () => {
  it('refuse une clé API vide', () => {
    expect(() => new DeepLProvider('')).toThrow(TranslationError);
    expect(() => new DeepLProvider('   ')).toThrow(TranslationError);
  });

  it('renvoie [] sans appeler fetch pour une liste vide', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await new DeepLProvider('key').translate([], {
      sourceLocale: 'fr',
      targetLocale: 'en',
    });

    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('protège les placeholders par des balises ignorées puis les restaure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(translations(['Hello <x>name</x>, welcome'])));
    vi.stubGlobal('fetch', fetchMock);

    const [out] = await new DeepLProvider('key').translate(['Bonjour {name}, bienvenue'], {
      sourceLocale: 'fr',
      targetLocale: 'en',
    });

    expect(out).toBe('Hello {name}, welcome');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.text).toEqual(['Bonjour <x>name</x>, bienvenue']);
    expect(body.ignore_tags).toEqual(['x']);
    expect(body.target_lang).toBe('EN');
    expect(body.source_lang).toBe('FR');
  });

  it('échappe les chevrons du texte source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(translations(['&lt;b&gt; gras'])));
    vi.stubGlobal('fetch', fetchMock);

    const [out] = await new DeepLProvider('key').translate(['<b> gras'], {
      sourceLocale: 'fr',
      targetLocale: 'en',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toEqual(['&lt;b&gt; gras']);
    expect(out).toBe('<b> gras');
  });

  it('passe la clé en en-tête Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(translations(['x'])));
    vi.stubGlobal('fetch', fetchMock);

    await new DeepLProvider('key').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('key');
    expect((init.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key key');
  });

  it('choisit le point d\'entrée gratuit pour une clé suffixée ":fx"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(translations(['x'])));
    vi.stubGlobal('fetch', fetchMock);

    await new DeepLProvider('abc:fx').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' });
    expect(fetchMock.mock.calls[0][0]).toContain('api-free.deepl.com');

    await new DeepLProvider('abc').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.deepl.com/v2/translate');
  });

  it('découpe en lots de 50 textes', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { text: string[] };
      return jsonResponse(translations(body.text));
    });
    vi.stubGlobal('fetch', fetchMock);

    const inputs = Array.from({ length: 120 }, (_, i) => `t${i}`);
    const out = await new DeepLProvider('key').translate(inputs, {
      sourceLocale: 'fr',
      targetLocale: 'en',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(out).toHaveLength(120);
    expect(out[119]).toBe('t119');
  });

  it.each([
    [400, 'bad_request', false],
    [403, 'auth', false],
    [429, 'rate_limit', true],
    [456, 'quota', false],
    [500, 'provider', true],
  ] as const)('mappe le statut %i vers kind=%s (retryable=%s)', async (status, kind, retryable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('oops', status)));

    await expect(
      new DeepLProvider('key').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toMatchObject({ kind, retryable, status });
  });

  it('reprend le délai demandé par Retry-After sur un 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse('slow down', 429, { 'retry-after': '3' })),
    );

    await expect(
      new DeepLProvider('key').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toMatchObject({ kind: 'rate_limit', retryAfterMs: 3000 });
  });

  it("ne laisse jamais la clé API fuiter dans le message d'erreur", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse('rejected key sk-secret-42', 500)),
    );

    const provider = new DeepLProvider('sk-secret-42');
    const params = { sourceLocale: 'fr', targetLocale: 'en' };

    await expect(provider.translate(['x'], params)).rejects.toThrow(/\*\*\*/);
    await expect(provider.translate(['x'], params)).rejects.not.toThrow(/sk-secret-42/);
  });

  it('signale une erreur réseau comme réessayable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    await expect(
      new DeepLProvider('key').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it("distingue un dépassement de délai d'une panne réseau", async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(
      new DeepLProvider('key').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toThrow(/Délai dépassé/);
  });

  it('abandonne la requête au bout du délai imparti', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(translations(['x'])));
    vi.stubGlobal('fetch', fetchMock);

    await new DeepLProvider('key').translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('adapters/translation — createProvider', () => {
  it('construit le provider demandé', () => {
    expect(createProvider('deepl', 'k').name).toBe('deepl');
    expect(createProvider('google', 'k').name).toBe('google');
  });

  it('refuse un provider inconnu', () => {
    expect(() => createProvider('chatgpt', 'k')).toThrow(TranslationError);
  });
});
