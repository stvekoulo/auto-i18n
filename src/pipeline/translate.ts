/**
 * Pipeline de traduction : pour chaque locale cible, traduit les clés manquantes
 * (et les clés dont le texte source a changé), valide les placeholders, et fusionne.
 */

import type { Catalog } from '../core/types.js';
import { missingKeys, placeholdersMatch, mergeTranslations } from '../core/catalog/index.js';
import {
  TranslationError,
  type TranslationProvider,
  type TranslationErrorKind,
  type TranslationTone,
} from '../adapters/translation/index.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { assertTranslations } from '../adapters/translation/types.js';

const DEFAULT_LOCALE_CONCURRENCY = 4;

export type ProviderSource = TranslationProvider | (() => TranslationProvider);

function resolveProvider(source: ProviderSource): TranslationProvider {
  return typeof source === 'function' ? source() : source;
}

export interface TranslateCatalogsInput {
  provider: ProviderSource;
  sourceLocale: string;
  sourceCatalog: Catalog;
  targetLocales: string[];
  existingTargets: Record<string, Catalog>;
  /** Clés existantes dont le texte source a changé et qu'il faut retraduire. */
  outdatedKeys?: string[];
  /** Indices UI par clé (`jsx-text:<button>`…) transmis aux providers LLM. */
  contextsByKey?: Record<string, string>;
  tone?: TranslationTone;
  glossary?: Record<string, string>;
  maxRetries?: number;
  concurrency?: number;
  dryRun?: boolean;
}

export interface LocaleTranslation {
  locale: string;
  catalog: Catalog;
  translated: number;
  status: 'updated' | 'up_to_date' | 'failed' | 'pending';
  error?: { message: string; kind: TranslationErrorKind | 'placeholder' };
}

export interface TranslateCatalogsResult {
  byLocale: LocaleTranslation[];
  totalTranslated: number;
  failed: string[];
  /** Clés qui n'ont pas pu être traduites sur au moins une locale. */
  failedKeys: string[];
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function retryDelayMs(attempt: number, retryAfterMs?: number, random = Math.random): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_DELAY_MS);
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return ceiling / 2 + random() * (ceiling / 2);
}

function keysToTranslateFor(
  sourceCatalog: Catalog,
  existing: Catalog,
  outdated: readonly string[],
): string[] {
  const missing = missingKeys(sourceCatalog, existing);
  const extra = outdated.filter(k => Object.hasOwn(sourceCatalog, k));
  return [...new Set([...missing, ...extra])];
}

async function translateWithRetry(
  provider: TranslationProvider,
  texts: string[],
  params: {
    sourceLocale: string;
    targetLocale: string;
    tone?: TranslationTone;
    glossary?: Record<string, string>;
    contexts?: Array<string | undefined>;
  },
  maxRetries: number,
): Promise<string[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await provider.translate(texts, params);
    } catch (error) {
      lastError = error;
      if (!(error instanceof TranslationError) || !error.retryable) throw error;
      if (attempt === maxRetries) throw error;
      await delay(retryDelayMs(attempt, error.retryAfterMs));
    }
  }
  throw lastError;
}

async function translateOneLocale(
  locale: string,
  input: {
    provider: TranslationProvider;
    sourceLocale: string;
    sourceCatalog: Catalog;
    existing: Catalog;
    outdated: readonly string[];
    contextsByKey?: Record<string, string>;
    tone?: TranslationTone;
    glossary?: Record<string, string>;
    maxRetries: number;
  },
): Promise<LocaleTranslation & { badKeys: string[] }> {
  const { provider, sourceLocale, sourceCatalog, existing, outdated, maxRetries } = input;
  const keys = keysToTranslateFor(sourceCatalog, existing, outdated);

  if (keys.length === 0) {
    return {
      locale,
      catalog: mergeTranslations(sourceCatalog, existing, {}),
      translated: 0,
      status: 'up_to_date',
      badKeys: [],
    };
  }

  try {
    const texts = keys.map(k => sourceCatalog[k]);
    const contexts = input.contextsByKey ? keys.map(k => input.contextsByKey?.[k]) : undefined;
    const translations = await translateWithRetry(
      provider,
      texts,
      {
        sourceLocale,
        targetLocale: locale,
        ...(input.tone ? { tone: input.tone } : {}),
        ...(input.glossary ? { glossary: input.glossary } : {}),
        ...(contexts ? { contexts } : {}),
      },
      maxRetries,
    );
    assertTranslations(translations, keys.length, provider.name);

    const fresh: Catalog = {};
    const badKeys: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const src = sourceCatalog[keys[i]];
      const out = translations[i];
      if (placeholdersMatch(src, out)) {
        fresh[keys[i]] = out;
      } else {
        badKeys.push(keys[i]);
      }
    }

    if (badKeys.length === keys.length) {
      throw new TranslationError(
        `Placeholders incohérents pour "${badKeys[0]}" (${locale}).`,
        'provider',
        false,
      );
    }

    return {
      locale,
      catalog: mergeTranslations(sourceCatalog, existing, fresh),
      translated: keys.length - badKeys.length,
      status: 'updated',
      badKeys,
      ...(badKeys.length > 0
        ? {
            error: {
              message: `Placeholders incohérents pour ${badKeys.length} clé(s) (${locale}) : ${badKeys.join(', ')}.`,
              kind: 'placeholder' as const,
            },
          }
        : {}),
    };
  } catch (error) {
    const kind =
      error instanceof TranslationError
        ? /[Pp]laceholder/.test(error.message)
          ? 'placeholder'
          : error.kind
        : 'provider';
    return {
      locale,
      catalog: mergeTranslations(sourceCatalog, existing, {}),
      translated: 0,
      status: 'failed',
      badKeys: keys,
      error: { message: error instanceof Error ? error.message : String(error), kind },
    };
  }
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
    outdatedKeys = [],
    maxRetries = 3,
    concurrency = DEFAULT_LOCALE_CONCURRENCY,
  } = input;

  const pending = targetLocales.filter(
    locale =>
      keysToTranslateFor(sourceCatalog, existingTargets[locale] ?? {}, outdatedKeys).length > 0,
  );

  if (pending.length === 0 || input.dryRun) {
    return {
      byLocale: targetLocales.map(locale => ({
        locale,
        catalog: mergeTranslations(sourceCatalog, existingTargets[locale] ?? {}, {}),
        translated: 0,
        status: pending.includes(locale) ? ('pending' as const) : ('up_to_date' as const),
      })),
      totalTranslated: 0,
      failed: [],
      failedKeys: [],
    };
  }

  const resolved = resolveProvider(provider);

  const detailed = await mapWithConcurrency(targetLocales, concurrency, locale =>
    translateOneLocale(locale, {
      provider: resolved,
      sourceLocale,
      sourceCatalog,
      existing: existingTargets[locale] ?? {},
      outdated: outdatedKeys,
      contextsByKey: input.contextsByKey,
      tone: input.tone,
      glossary: input.glossary,
      maxRetries,
    }),
  );

  const failedKeys = [...new Set(detailed.flatMap(r => r.badKeys))];
  const byLocale: LocaleTranslation[] = detailed.map(({ badKeys: _omit, ...rest }) => rest);

  return {
    byLocale,
    totalTranslated: byLocale.reduce((sum, r) => sum + r.translated, 0),
    failed: byLocale.filter(r => r.error !== undefined).map(r => r.locale),
    failedKeys,
  };
}
