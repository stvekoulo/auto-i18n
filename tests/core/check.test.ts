import { describe, it, expect } from 'vitest';
import { buildCheckReport } from '../../src/core/check';
import type { ExtractedString } from '../../src/core/types';

function str(value: string, safety: 'safe' | 'review' = 'safe'): ExtractedString {
  return { value, kind: 'jsx-text', file: 'C.tsx', line: 1, column: 1, scope: 'component', safety };
}

describe('core/check — buildCheckReport', () => {
  it('signale les strings non cataloguées', () => {
    const report = buildCheckReport({
      strings: [str('Bonjour'), str('Au revoir')],
      filesScanned: 1,
      parseErrors: [],
      sourceCatalog: { bonjour: 'Bonjour' },
      targetCatalogs: {},
    });
    expect(report.uncatalogued).toEqual(['Au revoir']);
    expect(report.ok).toBe(false);
  });

  it('compte les strings sûres vs à revoir', () => {
    const report = buildCheckReport({
      strings: [str('A', 'safe'), str('B', 'review'), str('C', 'review')],
      filesScanned: 1,
      parseErrors: [],
      sourceCatalog: { a: 'A', b: 'B', c: 'C' },
      targetCatalogs: {},
    });
    expect(report.detected).toEqual({ total: 3, safe: 1, review: 2 });
  });

  it('détecte les traductions manquantes par locale', () => {
    const report = buildCheckReport({
      strings: [],
      filesScanned: 0,
      parseErrors: [],
      sourceCatalog: { a: 'A', b: 'B' },
      targetCatalogs: { en: { a: 'A-en' }, es: { a: 'A-es', b: 'B-es' } },
    });
    expect(report.missingByLocale).toEqual({ en: ['b'], es: [] });
    expect(report.totalMissing).toBe(1);
    expect(report.ok).toBe(false);
  });

  it('est ok quand tout est catalogué et traduit', () => {
    const report = buildCheckReport({
      strings: [str('Bonjour')],
      filesScanned: 1,
      parseErrors: [],
      sourceCatalog: { bonjour: 'Bonjour' },
      targetCatalogs: { en: { bonjour: 'Hello' } },
    });
    expect(report.uncatalogued).toEqual([]);
    expect(report.totalMissing).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('signale les clés orphelines sans affecter ok (CI ne doit pas casser)', () => {
    const report = buildCheckReport({
      strings: [str('Bonjour')],
      filesScanned: 1,
      parseErrors: [],
      sourceCatalog: { bonjour: 'Bonjour', vieux: 'Texte disparu' },
      targetCatalogs: { en: { bonjour: 'Hello', vieux: 'Old' } },
    });
    expect(report.orphanedKeys).toEqual(['vieux']);
    expect(report.ok).toBe(true);
  });

  it('dé-duplique les valeurs non cataloguées', () => {
    const report = buildCheckReport({
      strings: [str('X'), str('X')],
      filesScanned: 1,
      parseErrors: [],
      sourceCatalog: {},
      targetCatalogs: {},
    });
    expect(report.uncatalogued).toEqual(['X']);
  });
});
