/**
 * Provider Google Cloud Translation (API v2 "Basic"). Protège les placeholders
 * `{var}` en `format: 'html'` via `<span translate="no">`, puis les restaure.
 * Normalise les erreurs en {@link TranslationError}, comme le provider DeepL.
 */

import { TranslationError, type TranslateParams, type TranslationProvider } from './types.js';

const GOOGLE_TRANSLATE_API = 'https://translation.googleapis.com/language/translate/v2';

const BATCH_SIZE = 50;

interface GoogleTranslateResponse {
  data: {
    translations: Array<{ translatedText: string; detectedSourceLanguage?: string }>;
  };
}

interface GoogleErrorResponse {
  error?: { code: number; message: string; status?: string };
}

function protectPlaceholders(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{([^}]+)\}/g, (_, name: string) => `<span translate="no">{${name}}</span>`);
}

function restorePlaceholders(text: string): string {
  return text
    .replace(/<span translate="no">\s*(\{[^}]*\})\s*<\/span>/gi, '$1')
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

  async translate(texts: string[], params: TranslateParams): Promise<string[]> {
    if (texts.length === 0) return [];

    const results: string[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      results.push(...(await this.translateBatch(batch, params)));
    }
    return results;
  }

  private async translateBatch(texts: string[], params: TranslateParams): Promise<string[]> {
    const body: Record<string, unknown> = {
      q: texts.map(protectPlaceholders),
      target: params.targetLocale.toLowerCase(),
      format: 'html',
    };
    if (params.sourceLocale) body['source'] = params.sourceLocale.toLowerCase();

    let response: Response;
    try {
      response = await fetch(`${GOOGLE_TRANSLATE_API}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new TranslationError(
        `Erreur réseau : impossible de contacter Google Translate. (${String(err)})`,
        'network',
        true,
      );
    }

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as GoogleErrorResponse | null;
      throw this.errorForStatus(response.status, detail?.error?.message ?? '');
    }

    const data = (await response.json()) as GoogleTranslateResponse;
    return data.data.translations.map(t => restorePlaceholders(t.translatedText));
  }

  private errorForStatus(status: number, detail: string): TranslationError {
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
