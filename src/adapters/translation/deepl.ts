/**
 * Provider DeepL. Protège les placeholders `{var}` et balises ICU via XML,
 * normalise les codes régionaux BCP-47 (`zh-CN` → `ZH-HANS`, `fr-CA` → `FR`) et supporte `tone`.
 */

import {
  REQUEST_TIMEOUT_MS,
  TranslationError,
  parseRetryAfter,
  redactSecret,
  truncate,
  assertTranslations,
  type TranslateParams,
  type TranslationProvider,
} from './types.js';
import { translationBatches } from './batches.js';
import { protectComplexIcu } from './icu.js';
import { escapeXmlText, unescapeHtmlEntities } from './entities.js';
import { listProviderLanguages } from './languages.js';

const DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

const DEEPL_REGIONAL_TARGETS = new Set([
  'EN-GB',
  'EN-US',
  'PT-BR',
  'PT-PT',
  'ES-419',
  'ZH-HANS',
  'ZH-HANT',
]);

interface DeepLResponse {
  translations: Array<{ text: string; detected_source_language: string }>;
}

export function normalizeDeepLTarget(locale: string): string {
  const lower = locale.trim().toLowerCase();
  if (lower === 'zh-cn' || lower === 'zh-sg' || lower.startsWith('zh-hans')) return 'ZH-HANS';
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower.startsWith('zh-hant')) return 'ZH-HANT';
  const upper = lower.toUpperCase();
  if (DEEPL_REGIONAL_TARGETS.has(upper)) return upper;
  return upper.split('-')[0];
}

function protectPlaceholders(text: string): string {
  const complex = protectComplexIcu(text, escapeXmlText, value => `<x data-icu="1">${value}</x>`);
  if (complex !== null) return complex;
  return escapeXmlText(text).replace(/\{([^}]+)\}/g, (_, name: string) => `<x>${name}</x>`);
}

function restorePlaceholders(text: string): string {
  const restoredTags = text
    .replace(/<x\s+data-icu="1">([\s\S]*?)<\/x>/gi, '$1')
    .replace(/<x>\s*([^<]*?)\s*<\/x>/gi, '{$1}');
  return unescapeHtmlEntities(restoredTags);
}

export class DeepLProvider implements TranslationProvider {
  readonly name = 'deepl';

  constructor(private readonly apiKey: string) {
    if (!apiKey?.trim()) {
      throw new TranslationError('Clé API DeepL manquante.', 'auth', false);
    }
  }

  private get apiUrl(): string {
    return this.apiKey.trimEnd().endsWith(':fx') ? DEEPL_FREE_API : DEEPL_PRO_API;
  }

  listLanguages(type: 'source' | 'target' = 'target') {
    return listProviderLanguages('deepl', this.apiKey, type);
  }

  async translate(texts: string[], params: TranslateParams): Promise<string[]> {
    if (texts.length === 0) return [];

    const results: string[] = [];
    for (const batch of translationBatches(texts, batch => this.body(batch, params), 128 * 1024)) {
      results.push(...(await this.translateBatch(batch, params)));
    }
    return results;
  }

  private body(texts: string[], params: TranslateParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      text: texts.map(protectPlaceholders),
      target_lang: normalizeDeepLTarget(params.targetLocale),
      tag_handling: 'xml',
      tag_handling_version: 'v2',
      ignore_tags: ['x'],
    };
    if (params.sourceLocale) body['source_lang'] = params.sourceLocale.split('-')[0].toUpperCase();
    if (params.tone === 'formal') body['formality'] = 'prefer_more';
    else if (params.tone === 'informal') body['formality'] = 'prefer_less';
    return body;
  }

  private async translateBatch(texts: string[], params: TranslateParams): Promise<string[]> {
    const body = this.body(texts, params);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new TranslationError(
        timedOut
          ? `Délai dépassé (${REQUEST_TIMEOUT_MS / 1000}s) en contactant DeepL.`
          : `Erreur réseau : impossible de contacter DeepL. (${this.safe(String(err))})`,
        'network',
        true,
      );
    }

    if (!response.ok) {
      throw this.errorForStatus(response, await response.text().catch(() => ''));
    }

    const data = (await response.json()) as DeepLResponse;
    const translated = Array.isArray(data?.translations)
      ? data.translations.map(t => t?.text)
      : undefined;
    assertTranslations(translated, texts.length, this.name);
    return translated.map(restorePlaceholders);
  }

  private safe(text: string): string {
    return redactSecret(text, this.apiKey);
  }

  private errorForStatus(response: Response, rawDetail: string): TranslationError {
    const status = response.status;
    const detail = truncate(this.safe(rawDetail));
    switch (status) {
      case 403:
        return new TranslationError(
          'Clé API DeepL invalide ou non autorisée (403). Vérifiez votre clé.',
          'auth',
          false,
          status,
        );
      case 456:
        return new TranslationError(
          'Quota DeepL dépassé pour ce mois (456).',
          'quota',
          false,
          status,
        );
      case 429:
        return new TranslationError(
          'Trop de requêtes DeepL (429). Nouvel essai dans un instant.',
          'rate_limit',
          true,
          status,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      case 400:
        return new TranslationError(
          'Requête DeepL invalide (400). Vérifiez le code de langue cible.',
          'bad_request',
          false,
          status,
        );
      default:
        return new TranslationError(
          `Erreur DeepL inattendue (${status}): ${detail}`,
          'provider',
          status >= 500,
          status,
        );
    }
  }
}
