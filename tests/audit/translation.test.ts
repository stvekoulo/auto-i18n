import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeepLProvider,
  GoogleTranslateProvider,
  TranslationError,
} from '../../src/adapters/translation';
import { translateCatalogs } from '../../src/pipeline/translate';

afterEach(() => vi.unstubAllGlobals());

describe('audit — réponses de traduction', () => {
  it.each([
    [new DeepLProvider('dummy'), { translations: [{ text: 'Hello' }] }],
    [
      new GoogleTranslateProvider('dummy'),
      { data: { translations: [{ translatedText: 'Hello' }] } },
    ],
  ] as const)('refuse un lot incomplet (%s)', async (provider, response) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response), { status: 200 }));
    await expect(
      provider.translate(['Bonjour', 'Au revoir'], { sourceLocale: 'fr', targetLocale: 'en' }),
    ).rejects.toBeInstanceOf(TranslationError);
  });

  it.each([
    { translations: [] },
    { translations: ['Hello', 'Bye', 'Extra'] },
    { translations: ['Hello', '   '] },
  ])(
    'ne persiste pas un résultat invalide fourni par un provider custom : $translations',
    async ({ translations }) => {
      const result = await translateCatalogs({
        sourceLocale: 'fr',
        sourceCatalog: { a: 'Bonjour', b: 'Au revoir' },
        targetLocales: ['en'],
        existingTargets: {},
        provider: { name: 'custom', translate: async () => translations },
      });
      expect(result.failed).toEqual(['en']);
      expect(result.byLocale[0].catalog).toEqual({});
      expect(result.totalTranslated).toBe(0);
    },
  );
});
