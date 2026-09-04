import { describe, it, expect } from 'vitest';
import { translateCatalogs, retryDelayMs } from '../../src/pipeline/translate';
import {
  TranslationError,
  type TranslateParams,
  type TranslationProvider,
} from '../../src/adapters/translation';

class FakeProvider implements TranslationProvider {
  readonly name = 'fake';
  calls = 0;
  constructor(private readonly fn: (texts: string[], p: TranslateParams) => Promise<string[]>) {}
  translate(texts: string[], params: TranslateParams): Promise<string[]> {
    this.calls++;
    return this.fn(texts, params);
  }
}

describe('pipeline/translate — translateCatalogs', () => {
  it('traduit les clés manquantes et marque updated', async () => {
    const provider = new FakeProvider(async texts => texts.map(t => `EN:${t}`));
    const result = await translateCatalogs({
      provider,
      sourceLocale: 'fr',
      sourceCatalog: { a: 'A', b: 'B' },
      targetLocales: ['en'],
      existingTargets: { en: {} },
    });
    expect(result.totalTranslated).toBe(2);
    const en = result.byLocale[0];
    expect(en.status).toBe('updated');
    expect(en.catalog).toEqual({ a: 'EN:A', b: 'EN:B' });
  });

  it('ne traduit que le manquant (merge incrémental)', async () => {
    const provider = new FakeProvider(async texts => texts.map(t => `EN:${t}`));
    const result = await translateCatalogs({
      provider,
      sourceLocale: 'fr',
      sourceCatalog: { a: 'A', b: 'B' },
      targetLocales: ['en'],
      existingTargets: { en: { a: 'déjà' } },
    });
    expect(result.totalTranslated).toBe(1);
    expect(result.byLocale[0].catalog).toEqual({ a: 'déjà', b: 'EN:B' });
  });

  it('marque up_to_date sans appeler le provider', async () => {
    const provider = new FakeProvider(async texts => texts);
    const result = await translateCatalogs({
      provider,
      sourceLocale: 'fr',
      sourceCatalog: { a: 'A' },
      targetLocales: ['en'],
      existingTargets: { en: { a: 'A-en' } },
    });
    expect(provider.calls).toBe(0);
    expect(result.byLocale[0].status).toBe('up_to_date');
  });

  it('échoue la locale si un placeholder est perdu', async () => {
    const provider = new FakeProvider(async () => ['Bonjour']); // {name} perdu
    const result = await translateCatalogs({
      provider,
      sourceLocale: 'fr',
      sourceCatalog: { greet: 'Hi {name}' },
      targetLocales: ['en'],
      existingTargets: { en: {} },
    });
    expect(result.failed).toEqual(['en']);
    expect(result.byLocale[0].error?.kind).toBe('placeholder');
  });

  it('réessaie sur erreur retryable puis réussit', async () => {
    let attempt = 0;
    const provider = new FakeProvider(async texts => {
      attempt++;
      if (attempt === 1) throw new TranslationError('429', 'rate_limit', true);
      return texts.map(t => `EN:${t}`);
    });
    const result = await translateCatalogs({
      provider,
      sourceLocale: 'fr',
      sourceCatalog: { a: 'A' },
      targetLocales: ['en'],
      existingTargets: { en: {} },
      maxRetries: 3,
    });
    expect(attempt).toBe(2);
    expect(result.byLocale[0].status).toBe('updated');
  });

  it('échoue sans réessayer sur erreur non-retryable', async () => {
    const provider = new FakeProvider(async () => {
      throw new TranslationError('403', 'auth', false);
    });
    const result = await translateCatalogs({
      provider,
      sourceLocale: 'fr',
      sourceCatalog: { a: 'A' },
      targetLocales: ['en'],
      existingTargets: { en: {} },
    });
    expect(provider.calls).toBe(1);
    expect(result.byLocale[0].status).toBe('failed');
    expect(result.byLocale[0].error?.kind).toBe('auth');
  });
});

describe('pipeline/translate — délai entre tentatives', () => {
  it('respecte le Retry-After du provider', () => {
    expect(retryDelayMs(1, 2000)).toBe(2000);
  });

  it('plafonne un Retry-After déraisonnable', () => {
    expect(retryDelayMs(1, 10 * 60_000)).toBe(30_000);
  });

  it('croît exponentiellement et reste dans la fenêtre de jitter', () => {
    // random() figé aux bornes : le délai doit rester dans [plafond/2, plafond].
    expect(retryDelayMs(1, undefined, () => 0)).toBe(250);
    expect(retryDelayMs(1, undefined, () => 1)).toBe(500);
    expect(retryDelayMs(3, undefined, () => 0)).toBe(1000);
    expect(retryDelayMs(3, undefined, () => 1)).toBe(2000);
  });

  it('plafonne la croissance exponentielle', () => {
    expect(retryDelayMs(50, undefined, () => 1)).toBe(30_000);
  });
});
