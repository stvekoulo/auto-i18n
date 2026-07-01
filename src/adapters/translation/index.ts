/**
 * Fabrique de provider de traduction. Point d'extension : ajouter un provider
 * revient à l'enregistrer ici, sans toucher au core ni aux pipelines.
 */

import { DeepLProvider } from './deepl.js';
import { GoogleTranslateProvider } from './google.js';
import { TranslationError, type TranslationProvider } from './types.js';

export * from './types.js';
export { DeepLProvider } from './deepl.js';
export { GoogleTranslateProvider } from './google.js';

export function createProvider(name: string, apiKey: string): TranslationProvider {
  switch (name) {
    case 'deepl':
      return new DeepLProvider(apiKey);
    case 'google':
      return new GoogleTranslateProvider(apiKey);
    default:
      throw new TranslationError(`Provider de traduction inconnu : "${name}".`, 'provider', false);
  }
}
