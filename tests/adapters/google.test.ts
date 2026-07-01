import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleTranslateProvider } from '../../src/adapters/translation/google';
import { TranslationError } from '../../src/adapters/translation/types';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adapters/translation/google — GoogleTranslateProvider', () => {
  it('refuse une clé API vide', () => {
    expect(() => new GoogleTranslateProvider('')).toThrow(TranslationError);
  });

  it('traduit et restaure les placeholders {var}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          translations: [{ translatedText: 'Hello <span translate="no">{name}</span>' }],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleTranslateProvider('key');
    const [out] = await provider.translate(['Bonjour {name}'], {
      sourceLocale: 'fr',
      targetLocale: 'en',
    });

    expect(out).toBe('Hello {name}');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('key=key');
    const body = JSON.parse(init.body as string) as { q: string[]; target: string };
    expect(body.target).toBe('en');
    expect(body.q[0]).toContain('<span translate="no">{name}</span>');
  });

  it('découpe en lots de 50 textes', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { q: string[] };
      return jsonResponse({
        data: { translations: body.q.map(q => ({ translatedText: q })) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleTranslateProvider('key');
    const texts = Array.from({ length: 120 }, (_, i) => `texte ${i}`);
    const out = await provider.translate(texts, { sourceLocale: 'fr', targetLocale: 'en' });

    expect(fetchMock).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(out).toHaveLength(120);
  });

  it.each([
    [400, 'bad_request', false],
    [403, 'auth', false],
    [429, 'rate_limit', true],
    [500, 'provider', true],
  ] as const)('mappe le statut %i vers kind=%s (retryable=%s)', async (status, kind, retryable) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: status, message: 'oops' } }, status));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleTranslateProvider('key');
    await expect(
      provider.translate(['x'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toMatchObject({ kind, retryable });
  });

  it('renvoie [] sans appeler fetch pour une liste vide', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleTranslateProvider('key');
    const out = await provider.translate([], { sourceLocale: 'fr', targetLocale: 'en' });

    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
