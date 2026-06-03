/**
 * Provider DeepL. Protège les placeholders `{var}` via des balises XML ignorées
 * par DeepL, puis les restaure. Normalise les erreurs en {@link TranslationError}.
 */

import { TranslationError, type TranslateParams, type TranslationProvider } from './types.js';

const DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

const BATCH_SIZE = 50;

interface DeepLResponse {
  translations: Array<{ text: string; detected_source_language: string }>;
}

function protectPlaceholders(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{([^}]+)\}/g, (_, name: string) => `<x>${name}</x>`);
}

function restorePlaceholders(text: string): string {
  return text
    .replace(/<x>\s*([^<]*?)\s*<\/x>/gi, '{$1}')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#34;/g, '"');
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
      text: texts.map(protectPlaceholders),
      target_lang: params.targetLocale.toUpperCase(),
      tag_handling: 'xml',
      tag_handling_version: 'v2',
      ignore_tags: ['x'],
    };
    if (params.sourceLocale) body['source_lang'] = params.sourceLocale.toUpperCase();

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new TranslationError(
        `Erreur réseau : impossible de contacter DeepL. (${String(err)})`,
        'network',
        true,
      );
    }

    if (!response.ok) {
      throw this.errorForStatus(response.status, await response.text().catch(() => ''));
    }

    const data = (await response.json()) as DeepLResponse;
    return data.translations.map(t => restorePlaceholders(t.text));
  }

  private errorForStatus(status: number, detail: string): TranslationError {
    switch (status) {
      case 403:
        return new TranslationError(
          'Clé API DeepL invalide ou non autorisée (403). Vérifiez votre clé.',
          'auth', false, status,
        );
      case 456:
        return new TranslationError(
          'Quota DeepL dépassé pour ce mois (456).',
          'quota', false, status,
        );
      case 429:
        return new TranslationError(
          'Trop de requêtes DeepL (429). Nouvel essai dans un instant.',
          'rate_limit', true, status,
        );
      case 400:
        return new TranslationError(
          'Requête DeepL invalide (400). Vérifiez le code de langue cible.',
          'bad_request', false, status,
        );
      default:
        return new TranslationError(
          `Erreur DeepL inattendue (${status}): ${detail}`,
          'provider', status >= 500, status,
        );
    }
  }
}
