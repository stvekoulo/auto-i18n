import { DeepLError } from './deepl.js';

export type TranslationErrorKind = 'provider' | 'network' | 'placeholder';

export function validateTranslation(source: string, translated: string): boolean {
  const sourcePlaceholders = extractPlaceholders(source);
  const translatedPlaceholders = extractPlaceholders(translated);
  return JSON.stringify(sourcePlaceholders) === JSON.stringify(translatedPlaceholders);
}

function extractPlaceholders(text: string): string[] {
  const matches = text.match(/\{([^}]+)\}/g) ?? [];
  return [...new Set(matches)].sort();
}

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof DeepLError)) return false;
  if (error.code === 429) return true;
  return /réseau|network|timeout|tempor/i.test(error.message);
}

export function classifyTranslationError(error: unknown): TranslationErrorKind {
  if (error instanceof DeepLError && /placeholder/i.test(error.message)) return 'placeholder';
  if (isRetryableError(error)) return 'network';
  return 'provider';
}
