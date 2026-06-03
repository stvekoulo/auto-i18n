/**
 * Contrat d'un provider de traduction. Le core ne dépend jamais d'un provider
 * concret : il manipule cette interface, ce qui rend DeepL substituable.
 */

export interface TranslateParams {
  sourceLocale: string;
  targetLocale: string;
}

export interface TranslationProvider {
  readonly name: string;
  /**
   * Traduit `texts` vers `targetLocale`. L'ordre de sortie correspond à l'entrée.
   * Les placeholders `{var}` doivent être préservés tels quels.
   */
  translate(texts: string[], params: TranslateParams): Promise<string[]>;
}

export type TranslationErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'bad_request'
  | 'provider';

/** Erreur normalisée, indépendante du provider concret. */
export class TranslationError extends Error {
  constructor(
    message: string,
    public readonly kind: TranslationErrorKind,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}
