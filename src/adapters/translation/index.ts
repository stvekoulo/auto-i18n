/**
 * Fabrique de provider de traduction (`deepl`, `google`, `openai`, `gemini`, `anthropic`).
 */

import { DeepLProvider } from './deepl.js';
import { GoogleTranslateProvider } from './google.js';
import { LlmTranslateProvider } from './llm.js';
import { TranslationError, type ProviderOptions, type TranslationProvider } from './types.js';

export * from './types.js';
export { DeepLProvider } from './deepl.js';
export { GoogleTranslateProvider } from './google.js';
export { LlmTranslateProvider, type LlmProviderName } from './llm.js';

export function createProvider(
  name: string,
  apiKey: string,
  options?: ProviderOptions,
): TranslationProvider {
  switch (name) {
    case 'deepl':
      return new DeepLProvider(apiKey);
    case 'google':
      return new GoogleTranslateProvider(apiKey);
    case 'openai':
    case 'gemini':
    case 'anthropic':
      return new LlmTranslateProvider(name, apiKey, options);
    default:
      throw new TranslationError(`Provider de traduction inconnu : "${name}".`, 'provider', false);
  }
}
