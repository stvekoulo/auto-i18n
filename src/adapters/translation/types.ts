/**
 * Contrat d'un provider de traduction, et utilitaires HTTP partagés par les
 * implémentations. Le core ne dépend jamais d'un provider concret.
 */

export const REQUEST_TIMEOUT_MS = 30_000;

export type TranslationTone = 'formal' | 'informal' | 'neutral';

export interface ProviderOptions {
  /** Modèle LLM optionnel (ex. `gpt-4o-mini`, `gemini-2.5-flash`, `claude-haiku-4-5`). */
  model?: string;
}

export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

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
  /** Registre souhaité (`formal` = vouvoiement, `informal` = tutoiement). */
  tone?: TranslationTone;
  /** Glossaire projet à respecter (`terme source` → `traduction imposée`). */
  glossary?: Record<string, string>;
  /** Indices syntaxiques par texte (`jsx-text:<button>`, `jsx-attribute:placeholder`…). */
  contexts?: Array<string | undefined>;
}

export interface TranslationProvider {
  listLanguages?(type?: 'source' | 'target'): Promise<Array<{ language: string; name?: string }>>;
  readonly name: string;
  translate(texts: string[], params: TranslateParams): Promise<string[]>;
}

export type TranslationErrorKind =
  'auth' | 'quota' | 'rate_limit' | 'network' | 'bad_request' | 'provider';

export class TranslationError extends Error {
  constructor(
    message: string,
    public readonly kind: TranslationErrorKind,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export function assertTranslations(
  texts: unknown,
  expectedCount: number,
  provider: string,
): asserts texts is string[] {
  if (
    !Array.isArray(texts) ||
    texts.length !== expectedCount ||
    texts.some(text => typeof text !== 'string' || text.trim() === '')
  ) {
    throw new TranslationError(
      `Réponse ${provider} invalide : ${expectedCount} traductions non vides attendues.`,
      'provider',
      false,
    );
  }
}
