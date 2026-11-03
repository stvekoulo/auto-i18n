import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepLProvider, GoogleTranslateProvider } from '../../src/adapters/translation';
import { buildCheckReport } from '../../src/core/check';

afterEach(() => vi.unstubAllGlobals());
describe('upgrade — providers et messages', () => {
  it.each([new DeepLProvider('dummy'), new GoogleTranslateProvider('dummy')])(
    'récupère les langues supportées sans traduction (%s)',
    async provider => {
      vi.stubGlobal('fetch', async (_url: string, request: RequestInit) => {
        expect(request.method ?? 'GET').toBe('GET');
        return new Response(
          JSON.stringify(
            provider.name === 'deepl'
              ? [{ language: 'FR', name: 'French' }]
              : { data: { languages: [{ language: 'fr' }] } },
          ),
        );
      });
      const languages = await provider.listLanguages('target');
      expect(languages[0].language.toLowerCase()).toBe('fr');
    },
  );
  it.each([new DeepLProvider('dummy'), new GoogleTranslateProvider('dummy')])(
    'borne les lots par taille UTF-8 (%s)',
    async provider => {
      const sizes: number[] = [];
      vi.stubGlobal('fetch', async (_url: string, request: RequestInit) => {
        sizes.push(Buffer.byteLength(String(request.body)));
        const body = JSON.parse(String(request.body));
        const texts: string[] = body.text ?? body.q;
        return new Response(
          JSON.stringify(
            provider.name === 'deepl'
              ? { translations: texts.map(text => ({ text })) }
              : { data: { translations: texts.map(translatedText => ({ translatedText })) } },
          ),
        );
      });
      const out = await provider.translate(
        Array.from({ length: 10 }, () => 'é'.repeat(10_000)),
        { sourceLocale: 'fr', targetLocale: 'en' },
      );
      expect(out).toHaveLength(10);
      expect(sizes.length).toBeGreaterThan(1);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(
        provider.name === 'deepl' ? 128 * 1024 : 100_000,
      );
    },
  );

  it.each([new DeepLProvider('dummy'), new GoogleTranslateProvider('dummy')])(
    'refuse un texte trop volumineux avant le réseau (%s)',
    async provider => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(
        provider.translate(['é'.repeat(100_000)], { sourceLocale: 'fr', targetLocale: 'en' }),
      ).rejects.toThrow(/volumineux|taille/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('normalise la locale source régionale pour DeepL', async () => {
    let source: string | undefined;
    vi.stubGlobal('fetch', async (_url: string, request: RequestInit) => {
      source = JSON.parse(String(request.body)).source_lang;
      return new Response(JSON.stringify({ translations: [{ text: 'Hello' }] }));
    });
    await new DeepLProvider('dummy').translate(['Bonjour'], {
      sourceLocale: 'fr-FR',
      targetLocale: 'en-US',
    });
    expect(source).toBe('FR');
  });

  it('fait échouer check sur un message ICU invalide ou une variable perdue', () => {
    const result = buildCheckReport({
      strings: [],
      filesScanned: 0,
      parseErrors: [],
      sourceCatalog: { title: 'Bonjour {name}' },
      targetCatalogs: { en: { title: 'Hello {name' } },
    });
    expect(result.ok).toBe(false);
  });

  it.each([new DeepLProvider('dummy'), new GoogleTranslateProvider('dummy')])(
    'traduit les textes des branches ICU sans altérer la grammaire (%s)',
    async provider => {
      vi.stubGlobal('fetch', async (_url: string, request: RequestInit) => {
        const body = JSON.parse(String(request.body));
        const texts: string[] = body.text ?? body.q;
        for (const text of texts) {
          const protectedText =
            text.match(/<(?:x|span)\b[^>]*>[\s\S]*?<\/(?:x|span)>/g)?.join('') ?? '';
          expect(protectedText).not.toContain('chat');
        }
        const translated = texts.map(text => text.replaceAll('chat', 'cat'));
        return new Response(
          JSON.stringify(
            provider.name === 'deepl'
              ? { translations: translated.map(text => ({ text })) }
              : { data: { translations: translated.map(translatedText => ({ translatedText })) } },
          ),
        );
      });
      const [out] = await provider.translate(['{count, plural, one {# chat} other {# chats}}'], {
        sourceLocale: 'fr',
        targetLocale: 'en',
      });
      expect(out).toBe('{count, plural, one {# cat} other {# cats}}');
    },
  );
});
