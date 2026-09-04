import { describe, it, expect } from 'vitest';
import { buildGuideModel, buildGuide } from '../../src/core/guide';
import type { ExtractedString, Runtime } from '../../src/core/types';

function s(partial: Partial<ExtractedString> & { value: string; file: string }): ExtractedString {
  return {
    kind: 'jsx-text',
    line: 1,
    column: 1,
    scope: 'component',
    safety: 'safe',
    ...partial,
  };
}

describe('core/guide — buildGuideModel', () => {
  it('groupe par fichier, attache clés et runtime, trie', () => {
    const model = buildGuideModel({
      projectRoot: '/proj',
      sourceLocale: 'fr',
      targetLocales: ['en'],
      date: '03 juin 2026',
      strings: [
        s({ value: 'Bonjour', file: '/proj/app/page.tsx', line: 5 }),
        s({ value: 'Salut', file: '/proj/app/page.tsx', line: 2 }),
      ],
      keyMap: new Map([
        ['Bonjour', 'bonjour'],
        ['Salut', 'salut'],
      ]),
      fileRuntimes: new Map([['/proj/app/page.tsx', 'client' as Runtime]]),
    });

    expect(model.files).toHaveLength(1);
    expect(model.files[0].relPath).toBe('app/page.tsx');
    expect(model.files[0].runtime).toBe('client');
    // Trié par ligne.
    expect(model.files[0].strings.map(x => x.value)).toEqual(['Salut', 'Bonjour']);
    expect(model.totalStrings).toBe(2);
    expect(model.safeCount).toBe(2);
  });

  it('signale les fichiers avec module-scope', () => {
    const model = buildGuideModel({
      projectRoot: '/proj',
      sourceLocale: 'fr',
      targetLocales: [],
      date: 'x',
      strings: [
        s({
          value: 'Accueil',
          file: '/proj/lib/data.ts',
          scope: 'module',
          safety: 'review',
          reviewReason: 'module_scope',
          kind: 'string-literal',
        }),
      ],
      keyMap: new Map([['Accueil', 'accueil']]),
      fileRuntimes: new Map(),
    });
    expect(model.files[0].hasModuleScope).toBe(true);
    expect(model.reviewCount).toBe(1);
  });
});

describe('core/guide — buildGuide (markdown)', () => {
  it('produit un markdown actionnable', () => {
    const model = buildGuideModel({
      projectRoot: '/proj',
      sourceLocale: 'fr',
      targetLocales: ['en', 'es'],
      date: '03 juin 2026',
      strings: [s({ value: 'Bonjour', file: '/proj/app/page.tsx', line: 3 })],
      keyMap: new Map([['Bonjour', 'bonjour']]),
      fileRuntimes: new Map([['/proj/app/page.tsx', 'server' as Runtime]]),
    });
    const md = buildGuide(model);

    expect(md).toContain("# Guide d'intégration i18n");
    expect(md).toContain("Aucun fichier source n'a été modifié");
    expect(md).toContain('`app/page.tsx`');
    expect(md).toContain('getTranslations');
    expect(md).toContain('{t("bonjour")}');
  });

  it('suggère un appel avec params pour les templates', () => {
    const model = buildGuideModel({
      projectRoot: '/proj',
      sourceLocale: 'fr',
      targetLocales: [],
      date: 'x',
      strings: [
        s({
          value: 'Salut {name}',
          file: '/proj/c.tsx',
          kind: 'template',
          variables: [{ expression: 'name', name: 'name' }],
        }),
      ],
      keyMap: new Map([['Salut {name}', 'salut_name']]),
      fileRuntimes: new Map(),
    });
    expect(buildGuide(model)).toContain('t("salut_name", { name })');
  });

  it('regroupe les candidats pluriels et suggère une syntaxe ICU', () => {
    const model = buildGuideModel({
      projectRoot: '/proj',
      sourceLocale: 'fr',
      targetLocales: [],
      date: 'x',
      strings: [
        s({
          value: '{count} articles',
          file: '/proj/c.tsx',
          kind: 'template',
          variables: [{ expression: 'count', name: 'count' }],
          pluralHint: true,
        }),
      ],
      keyMap: new Map([['{count} articles', 'count_articles']]),
      fileRuntimes: new Map(),
    });

    expect(model.pluralCandidates).toHaveLength(1);
    expect(model.pluralCandidates[0].key).toBe('count_articles');

    const md = buildGuide(model);
    expect(md).toContain('## Pluriels probables');
    expect(md).toContain('⚠ pluriel probable');
    expect(md).toContain('"count_articles": "{count, plural, one {# ...} other {# articles}}"');
  });
});
