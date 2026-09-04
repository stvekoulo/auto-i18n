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
import { mapWithConcurrency } from '../utils/concurrency.js';

/**
 * Locales traduites simultanément. Chaque locale est un aller-retour réseau
 * indépendant : les enchaîner multipliait le temps d'attente par leur nombre.
 * Volontairement bas — le provider impose ses propres quotas.
 */
const DEFAULT_LOCALE_CONCURRENCY = 4;

/**
 * Provider, ou fabrique de provider.
 *
 * La fabrique n'est appelée que si au moins une locale a des clés manquantes :
 * un projet déjà entièrement traduit n'a alors besoin d'aucune clé API, ce qui
 * permet à un contributeur sans secret de lancer `sync`.
 */
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
  maxRetries?: number;
  /** Locales traduites en parallèle (défaut 4). */
  concurrency?: number;
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

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attente avant nouvelle tentative.
 *
 * Le délai indiqué par le provider (`Retry-After`) fait autorité. Sinon,
 * croissance exponentielle avec jitter : un backoff fixe de quelques
 * centaines de millisecondes épuise les tentatives avant qu'une fenêtre de
 * rate-limit ne se rouvre, et sans aléa plusieurs locales relancées ensemble
 * repartiraient en même temps.
 */
export function retryDelayMs(attempt: number, retryAfterMs?: number, random = Math.random): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_DELAY_MS);
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return ceiling / 2 + random() * (ceiling / 2);
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
    maxRetries: number;
  },
): Promise<LocaleTranslation> {
  const { provider, sourceLocale, sourceCatalog, existing, maxRetries } = input;
  const keys = missingKeys(sourceCatalog, existing);

  if (keys.length === 0) {
    return {
      locale,
      catalog: mergeTranslations(sourceCatalog, existing, {}),
      translated: 0,
      status: 'up_to_date',
    };
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

    return {
      locale,
      catalog: mergeTranslations(sourceCatalog, existing, fresh),
      translated: keys.length,
      status: 'updated',
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
    maxRetries = 3,
    concurrency = DEFAULT_LOCALE_CONCURRENCY,
  } = input;

  const pending = targetLocales.filter(
    locale => missingKeys(sourceCatalog, existingTargets[locale] ?? {}).length > 0,
  );

  // Rien à traduire : on ne résout pas le provider, donc aucune clé API requise.
  if (pending.length === 0) {
    return {
      byLocale: targetLocales.map(locale => ({
        locale,
        catalog: mergeTranslations(sourceCatalog, existingTargets[locale] ?? {}, {}),
        translated: 0,
        status: 'up_to_date' as const,
      })),
      totalTranslated: 0,
      failed: [],
    };
  }

  // Résolu une fois, en amont : une clé absente échoue proprement ici plutôt
  // qu'en se répétant sur chaque locale.
  const resolved = resolveProvider(provider);

  const byLocale = await mapWithConcurrency(targetLocales, concurrency, locale =>
    translateOneLocale(locale, {
      provider: resolved,
      sourceLocale,
      sourceCatalog,
      existing: existingTargets[locale] ?? {},
      maxRetries,
    }),
  );

  return {
    byLocale,
    totalTranslated: byLocale.reduce((sum, r) => sum + r.translated, 0),
    failed: byLocale.filter(r => r.status === 'failed').map(r => r.locale),
  };
}
