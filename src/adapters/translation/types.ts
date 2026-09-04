/**
 * Contrat d'un provider de traduction, et utilitaires HTTP partagés par les
 * implémentations. Le core ne dépend jamais d'un provider concret : il manipule
 * cette interface, ce qui rend DeepL substituable.
 */

/** Delai au-dela duquel une requete provider est abandonnee. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Retire toute occurrence de la cle API d'un texte destine a l'affichage.
 *
 * Le corps d'erreur d'un provider est repris tel quel dans les messages : sans
 * ce filtre, une reponse qui renvoie la requete en echo publierait la cle dans
 * les logs de CI.
 */
export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

/** Tronque un detail d'erreur provider pour garder les messages lisibles. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Lit un en-tete `Retry-After` (secondes ou date HTTP) en millisecondes. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

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
  'auth' | 'quota' | 'rate_limit' | 'network' | 'bad_request' | 'provider';

/** Erreur normalisée, indépendante du provider concret. */
export class TranslationError extends Error {
  constructor(
    message: string,
    public readonly kind: TranslationErrorKind,
    public readonly retryable: boolean,
    public readonly status?: number,
    /** Delai demande par le provider (en-tete `Retry-After`), si fourni. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}
