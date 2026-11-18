import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProvider,
  DeepLProvider,
  GoogleTranslateProvider,
} from '../../src/adapters/translation/index.js';
import { protectComplexIcu } from '../../src/adapters/translation/icu.js';
import { buildConfig, validateConfig } from '../../src/config/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('v3 — Providers (DeepL, Google, OpenAI, Gemini, Anthropic) et Config', () => {
  it("B8.1 : ne double-décode pas &amp;lt; en chevron '<' dans DeepL et Google", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      const target = String(url);
      if (target.includes('deepl')) {
        return new Response(
          JSON.stringify({
            translations: [
              {
                text: 'Use &amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt;',
                detected_source_language: 'FR',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            translations: [{ translatedText: 'Use &amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt;' }],
          },
        }),
        { status: 200 },
      );
    });

    const deepl = new DeepLProvider('deepl-key:fx');
    expect(
      await deepl.translate(['Utilisez &lt;b&gt;gras&lt;/b&gt;'], {
        sourceLocale: 'fr',
        targetLocale: 'en',
      }),
    ).toEqual(['Use &lt;b&gt;bold&lt;/b&gt;']);

    const google = new GoogleTranslateProvider('goog-key');
    expect(
      await google.translate(['Utilisez &lt;b&gt;gras&lt;/b&gt;'], {
        sourceLocale: 'fr',
        targetLocale: 'en',
      }),
    ).toEqual(['Use &lt;b&gt;bold&lt;/b&gt;']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('B8.2 : protège les balises riches ICU <link>...</link> même sans plural/select', () => {
    const out = protectComplexIcu(
      "J'accepte les <link>conditions</link>",
      s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      s => `<x data-icu="1">${s}</x>`,
    );
    expect(out).not.toBeNull();
    expect(out).toContain('<x data-icu="1">&lt;link&gt;</x>');
    expect(out).toContain('conditions');
    expect(out).toContain('<x data-icu="1">&lt;/link&gt;</x>');
  });

  it('B8.3 : normalise les locales régionales DeepL (zh-CN -> ZH-HANS, fr-CA -> FR) et passe formality', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ translations: [{ text: 'Translated', detected_source_language: 'EN' }] }),
        { status: 200 },
      );
    });

    const deepl = new DeepLProvider('deepl-key:fx');
    await deepl.translate(['Hello'], {
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      tone: 'formal',
    });
    await deepl.translate(['Hello'], {
      sourceLocale: 'en',
      targetLocale: 'fr-CA',
      tone: 'informal',
    });

    expect(bodies[0]).toMatchObject({ target_lang: 'ZH-HANS', formality: 'prefer_more' });
    expect(bodies[1]).toMatchObject({ target_lang: 'FR', formality: 'prefer_less' });
  });

  it('v3 LLM : supporte OpenAI, Gemini et Anthropic avec contexte UI, glossaire, ton et masquage de secret', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = String(init?.body ?? '');
      calls.push({ url: u, headers, body });

      if (u.includes('openai.com')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ translations: ['Save'] }) } }],
          }),
          { status: 200 },
        );
      }
      if (u.includes('googleapis.com')) {
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ translations: ['Save'] }) }] } },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ translations: ['Save'] }) }],
        }),
        { status: 200 },
      );
    });

    const params = {
      sourceLocale: 'fr',
      targetLocale: 'en',
      tone: 'formal' as const,
      glossary: { SEFODE: 'SEFODE' },
      contexts: ['jsx-text:<button>'],
    };

    const openai = createProvider('openai', 'sk-openai-secret', { model: 'gpt-4o-mini' });
    expect(await openai.translate(['Enregistrer'], params)).toEqual(['Save']);
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-openai-secret');
    expect(calls[0].body).toContain('SEFODE');
    expect(calls[0].body).toContain('jsx-text:<button>');

    const gemini = createProvider('gemini', 'AIza-gemini-secret');
    expect(await gemini.translate(['Enregistrer'], params)).toEqual(['Save']);
    expect(calls[1].url).not.toContain('AIza-gemini-secret');
    expect(calls[1].headers['x-goog-api-key']).toBe('AIza-gemini-secret');

    const anthropic = createProvider('anthropic', 'sk-ant-secret');
    expect(await anthropic.translate(['Enregistrer'], params)).toEqual(['Save']);
    expect(calls[2].headers['x-api-key']).toBe('sk-ant-secret');
  });

  it('v3 Config : valide les nouveaux providers LLM, catalogFormat, tone, glossary et model', () => {
    expect(buildConfig('fr', ['en'], 'openai').apiKeyEnv).toBe('AUTO_I18N_OPENAI_KEY');
    expect(buildConfig('fr', ['en'], 'gemini').apiKeyEnv).toBe('AUTO_I18N_GEMINI_KEY');
    expect(buildConfig('fr', ['en'], 'anthropic').apiKeyEnv).toBe('AUTO_I18N_ANTHROPIC_KEY');

    expect(
      validateConfig({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        tone: 'formal',
        catalogFormat: 'nested',
        namespaceByFile: true,
        glossary: { SEFODE: 'SEFODE' },
      }),
    ).toEqual([]);

    expect(
      validateConfig({
        sourceLocale: 'fr',
        targetLocales: ['en'],
        provider: 'chatgpt',
      }).join(' '),
    ).toContain('"provider" doit valoir');
  });
});
