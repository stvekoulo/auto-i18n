/**
 * Providers LLM contextuels (`openai`, `gemini`, `anthropic`) via `fetch` natif.
 *
 * Contrairement à la traduction hors-contexte, les LLM reçoivent l'élément UI
 * (`jsx-text:<button>`, `jsx-attribute:placeholder`), le ton (`formal`/`informal`)
 * et le glossaire métier configuré par le projet.
 */

import {
  REQUEST_TIMEOUT_MS,
  TranslationError,
  assertTranslations,
  parseRetryAfter,
  redactSecret,
  truncate,
  type ProviderOptions,
  type TranslateParams,
  type TranslationProvider,
} from './types.js';
import { translationBatches } from './batches.js';

export type LlmProviderName = 'openai' | 'gemini' | 'anthropic';

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-4-5',
};

function buildSystemInstruction(params: TranslateParams): string {
  const parts = [
    `Translate UI strings from "${params.sourceLocale}" to "${params.targetLocale}".`,
    'Preserve EVERY ICU MessageFormat placeholder ({name}, {count, plural, ...}, #) and tag (<link>...</link>) verbatim.',
    'Return ONLY valid JSON of the exact shape: {"translations":["..."]} with the exact same number and order of items.',
  ];
  if (params.tone === 'formal')
    parts.push('Use a polite/formal register (e.g. "vous" in French, "Sie" in German).');
  if (params.tone === 'informal')
    parts.push('Use a friendly/informal register (e.g. "tu" in French).');
  if (params.glossary && Object.keys(params.glossary).length > 0) {
    parts.push(
      `Mandatory glossary (do not alter target terms): ${JSON.stringify(params.glossary)}`,
    );
  }
  return parts.join(' ');
}

function buildUserPayload(texts: string[], contexts?: Array<string | undefined>): string {
  const items = texts.map((text, index) => {
    const ctx = contexts?.[index];
    return ctx ? { index, text, uiContext: ctx } : { index, text };
  });
  return JSON.stringify({ items });
}

function parseJsonTranslations(rawText: string): unknown {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const parsed = JSON.parse(cleaned) as { translations?: unknown } | unknown[];
  return Array.isArray(parsed) ? parsed : parsed?.translations;
}

export class LlmTranslateProvider implements TranslationProvider {
  readonly name: LlmProviderName;
  private readonly model: string;

  constructor(
    provider: LlmProviderName,
    private readonly apiKey: string,
    options: ProviderOptions = {},
  ) {
    if (!apiKey?.trim()) {
      throw new TranslationError(`Clé API ${provider} manquante.`, 'auth', false);
    }
    this.name = provider;
    this.model = options.model?.trim() || DEFAULT_MODELS[provider];
  }

  async translate(texts: string[], params: TranslateParams): Promise<string[]> {
    if (texts.length === 0) return [];

    const batches = translationBatches(texts, batch => ({ items: batch }), 64 * 1024);
    const results: string[] = [];
    let offset = 0;
    for (const batch of batches) {
      const sliceContexts = params.contexts?.slice(offset, offset + batch.length);
      offset += batch.length;
      results.push(
        ...(await this.translateBatch(batch, {
          ...params,
          ...(sliceContexts ? { contexts: sliceContexts } : {}),
        })),
      );
    }
    return results;
  }

  private buildRequest(
    texts: string[],
    params: TranslateParams,
  ): {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const system = buildSystemInstruction(params);
    const user = buildUserPayload(texts, params.contexts);

    if (this.name === 'openai') {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          model: this.model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
      };
    }

    if (this.name === 'gemini') {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        },
      };
    }

    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model: this.model,
        max_tokens: 4096,
        temperature: 0.1,
        system,
        messages: [{ role: 'user', content: user }],
      },
    };
  }

  private extractContent(data: unknown): string {
    const obj = data as Record<string, unknown>;
    if (this.name === 'openai') {
      const choices = obj?.choices as Array<{ message?: { content?: string } }> | undefined;
      return choices?.[0]?.message?.content ?? '';
    }
    if (this.name === 'gemini') {
      const candidates = obj?.candidates as
        Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    const content = obj?.content as Array<{ text?: string }> | undefined;
    return content?.[0]?.text ?? '';
  }

  private async translateBatch(texts: string[], params: TranslateParams): Promise<string[]> {
    const req = this.buildRequest(texts, params);
    let response: Response;
    try {
      response = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new TranslationError(
        timedOut
          ? `Délai dépassé (${REQUEST_TIMEOUT_MS / 1000}s) en contactant ${this.name}.`
          : `Erreur réseau (${this.name}) : ${redactSecret(String(err), this.apiKey)}`,
        'network',
        true,
      );
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const detail = truncate(redactSecret(raw, this.apiKey));
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new TranslationError(
          `Clé API ${this.name} invalide ou non autorisée (${status}). ${detail}`,
          'auth',
          false,
          status,
        );
      }
      if (status === 429) {
        throw new TranslationError(
          `Limite de requêtes ${this.name} atteinte (429).`,
          'rate_limit',
          true,
          status,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      throw new TranslationError(
        `Erreur ${this.name} (${status}) : ${detail}`,
        status === 400 ? 'bad_request' : 'provider',
        status >= 500,
        status,
      );
    }

    const data = await response.json();
    let parsed: unknown;
    try {
      parsed = parseJsonTranslations(this.extractContent(data));
    } catch {
      throw new TranslationError(`Réponse JSON ${this.name} illisible.`, 'provider', false);
    }
    assertTranslations(parsed, texts.length, this.name);
    return parsed;
  }
}
