/**
 * Pipeline de traduction : pour chaque locale cible, traduit les clés manquantes
 * via un {@link TranslationProvider}, valide les placeholders, et fusionne.
 *
 * Ne touche pas au disque : prend les catalogues en entrée, les renvoie en sortie.
 * Le provider est injecté → testable avec un faux provider.
 */

import type { Catalog } from '../core/types.js';
import { missingKeys, placeholdersMatch, mergeTranslations } from '../core/catalog/index.js';
import {
  TranslationError,
  type TranslationProvider,
  type TranslationErrorKind,
} from '../adapters/translation/index.js';

export interface TranslateCatalogsInput {
  provider: TranslationProvider;
  sourceLocale: string;
  sourceCatalog: Catalog;
  targetLocales: string[];
  existingTargets: Record<string, Catalog>;
  maxRetries?: number;
}

export interface LocaleTranslation {
  locale: string;
  catalog: Catalog;
  translated: number;
  status: 'updated' | 'up_to_date' | 'failed';
  error?: { message: string; kind: TranslationErrorKind | 'placeholder' };
}

export interface TranslateCatalogsResult {
  byLocale: LocaleTranslation[];
  totalTranslated: number;
  failed: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateWithRetry(
  provider: TranslationProvider,
  texts: string[],
  sourceLocale: string,
  targetLocale: string,
  maxRetries: number,
): Promise<string[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await provider.translate(texts, { sourceLocale, targetLocale });
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TranslationError && error.retryable;
      if (!retryable || attempt === maxRetries) throw error;
      await delay(150 * attempt);
    }
  }
  throw lastError;
}

export async function translateCatalogs(
  input: TranslateCatalogsInput,
): Promise<TranslateCatalogsResult> {
  const {
    provider,
    sourceLocale,
    sourceCatalog,
    targetLocales,
    existingTargets,
    maxRetries = 3,
  } = input;

  const byLocale: LocaleTranslation[] = [];
  const failed: string[] = [];
  let totalTranslated = 0;

  for (const locale of targetLocales) {
    const existing = existingTargets[locale] ?? {};
    const keys = missingKeys(sourceCatalog, existing);

    if (keys.length === 0) {
      byLocale.push({
        locale,
        catalog: mergeTranslations(sourceCatalog, existing, {}),
        translated: 0,
        status: 'up_to_date',
      });
      continue;
    }

    try {
      const texts = keys.map(k => sourceCatalog[k]);
      const translations = await translateWithRetry(
        provider,
        texts,
        sourceLocale,
        locale,
        maxRetries,
      );

      const fresh: Catalog = {};
      for (let i = 0; i < keys.length; i++) {
        const src = sourceCatalog[keys[i]];
        const out = translations[i];
        if (!placeholdersMatch(src, out)) {
          throw new TranslationError(
            `Placeholders incohérents pour "${keys[i]}" (${locale}).`,
            'provider',
            false,
          );
        }
        fresh[keys[i]] = out;
      }

      byLocale.push({
        locale,
        catalog: mergeTranslations(sourceCatalog, existing, fresh),
        translated: keys.length,
        status: 'updated',
      });
      totalTranslated += keys.length;
    } catch (error) {
      const kind =
        error instanceof TranslationError
          ? /[Pp]laceholder/.test(error.message)
            ? 'placeholder'
            : error.kind
          : 'provider';
      byLocale.push({
        locale,
        catalog: mergeTranslations(sourceCatalog, existing, {}),
        translated: 0,
        status: 'failed',
        error: { message: error instanceof Error ? error.message : String(error), kind },
      });
      failed.push(locale);
    }
  }

  return { byLocale, totalTranslated, failed };
}
