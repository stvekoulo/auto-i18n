/**
 * Provider Google Cloud Translation (API v2 "Basic"). Protège les placeholders
 * `{var}` en `format: 'html'` via `<span translate="no">`, puis les restaure.
 * Normalise les erreurs en {@link TranslationError}, comme le provider DeepL.
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
import { listProviderLanguages } from './languages.js';

const GOOGLE_TRANSLATE_API = 'https://translation.googleapis.com/language/translate/v2';

interface GoogleTranslateResponse {
  data: {
    translations: Array<{ translatedText: string; detectedSourceLanguage?: string }>;
  };
}

interface GoogleErrorResponse {
  error?: { code: number; message: string; status?: string };
}

function protectPlaceholders(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const complex = protectComplexIcu(text, escape, value => `<span translate="no">${value}</span>`);
  if (complex !== null) return complex;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{([^}]+)\}/g, (_, name: string) => `<span translate="no">{${name}}</span>`);
}

function restorePlaceholders(text: string): string {
  return text
    .replace(/<span translate="no">([\s\S]*?)<\/span>/gi, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#34;/g, '"');
}

export class GoogleTranslateProvider implements TranslationProvider {
  readonly name = 'google';

  constructor(private readonly apiKey: string) {
    if (!apiKey?.trim()) {
      throw new TranslationError('Clé API Google Translate manquante.', 'auth', false);
    }
  }

  listLanguages(type: 'source' | 'target' = 'target') {
    return listProviderLanguages('google', this.apiKey, type);
  }

  async translate(texts: string[], params: TranslateParams): Promise<string[]> {
    if (texts.length === 0) return [];

    const results: string[] = [];
    for (const batch of translationBatches(texts, batch => this.body(batch, params), 100_000)) {
      results.push(...(await this.translateBatch(batch, params)));
    }
    return results;
  }

  private body(texts: string[], params: TranslateParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      q: texts.map(protectPlaceholders),
      target: params.targetLocale.toLowerCase(),
      format: 'html',
    };
    if (params.sourceLocale) body['source'] = params.sourceLocale.toLowerCase();
    return body;
  }

  private async translateBatch(texts: string[], params: TranslateParams): Promise<string[]> {
    const body = this.body(texts, params);

    let response: Response;
    try {
      // Clé passée en en-tête, jamais en query string : une URL finit dans les
      // journaux d'accès, l'historique du proxy et les traces d'erreur.
      response = await fetch(GOOGLE_TRANSLATE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new TranslationError(
        timedOut
          ? `Délai dépassé (${REQUEST_TIMEOUT_MS / 1000}s) en contactant Google Translate.`
          : `Erreur réseau : impossible de contacter Google Translate. (${this.safe(String(err))})`,
        'network',
        true,
      );
    }

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as GoogleErrorResponse | null;
      throw this.errorForStatus(response, detail?.error?.message ?? '');
    }

    const data = (await response.json()) as GoogleTranslateResponse;
    const translated = Array.isArray(data?.data?.translations)
      ? data.data.translations.map(t => t?.translatedText)
      : undefined;
    assertTranslations(translated, texts.length, this.name);
    return translated.map(restorePlaceholders);
  }

  /** Neutralise la clé API avant tout affichage. */
  private safe(text: string): string {
    return redactSecret(text, this.apiKey);
  }

  private errorForStatus(response: Response, rawDetail: string): TranslationError {
    const status = response.status;
    const detail = truncate(this.safe(rawDetail));
    switch (status) {
      case 400:
        return new TranslationError(
          `Requête Google Translate invalide (400). Vérifiez le code de langue cible. ${detail}`,
          'bad_request',
          false,
          status,
        );
      case 403:
        return new TranslationError(
          `Clé API Google Translate invalide, quota dépassé ou API non activée (403). ${detail}`,
          'auth',
          false,
          status,
        );
      case 429:
        return new TranslationError(
          'Trop de requêtes Google Translate (429). Nouvel essai dans un instant.',
          'rate_limit',
          true,
          status,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      default:
        return new TranslationError(
          `Erreur Google Translate inattendue (${status}): ${detail}`,
          'provider',
          status >= 500,
          status,
        );
    }
  }
}
