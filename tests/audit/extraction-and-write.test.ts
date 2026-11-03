import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { ts } from 'ts-morph';
import { parseSource, getSyntaxErrors } from '../../src/core/extraction';
import { applyEdits, computeWriteEdits } from '../../src/core/write';
import { reactI18nConfigTemplate } from '../../src/adapters/scaffold/templates';
import { scanContent } from '../../src/core/scan';
describe('audit — codemod conservateur', () => {
  it.each([
    'export function Page(t: number){ return <h1>Bonjour</h1>; }',
    'export function Page({t}){ return <h1>Bonjour</h1>; }',
    'export function Page(){ const t = useTranslations("Home"); return <h1>Bonjour</h1>; }',
    'export function Page(){ return items.map(t => <h1>Bonjour</h1>); }',
    'export function Page(){ return <h1>Bonjour</h1>; }\nimport {useTranslations as tr} from "next-intl";',
    'export function Page(){ return <h1>Bonjour</h1>; }\nimport useTranslations from "other-package";',
  ])('ne câble pas un scope ambigu : %s', body => {
    const text = `'use client';\n${body}`;
    const result = computeWriteEdits(
      parseSource(text),
      'C.tsx',
      'client',
      new Map([['Bonjour', 'bonjour']]),
    );
    expect(result.written).toBe(0);
    expect(applyEdits(text, result.edits)).toBe(text);
  });

  it('échappe les clés manuelles dans le code généré', () => {
    const text = "'use client'; export function Page(){ return <h1>Bonjour</h1>; }";
    const result = computeWriteEdits(
      parseSource(text),
      'C.tsx',
      'client',
      new Map([['Bonjour', 'say"hello']]),
    );
    expect(result.written).toBe(1);
    expect(getSyntaxErrors(parseSource(applyEdits(text, result.edits)))).toEqual([]);
  });
});

describe('audit — scaffold', () => {
  it('génère du TypeScript valide pour les locales régionales', () => {
    const text = reactI18nConfigTemplate({
      locales: ['fr', 'pt-BR', 'zh-Hans', 'in'],
      defaultLocale: 'fr',
      messagesRelativePath: '../messages',
    });
    expect(getSyntaxErrors(parseSource(text, 'i18n.ts'))).toEqual([]);
  });

  it('fournit à i18next les ressources et délimiteurs des catalogues générés', () => {
    const text = reactI18nConfigTemplate({
      locales: ['fr'],
      defaultLocale: 'fr',
      messagesRelativePath: '../messages',
    });
    const js = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    let options: Record<string, unknown> | undefined;
    const i18next = {
      use: () => ({
        init: (input: Record<string, unknown>) => {
          options = input;
        },
      }),
    };
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name === 'i18next') return i18next;
        if (name === 'react-i18next') return { initReactI18next: {} };
        if (name === '../messages/fr.json') return { salut: 'Salut {name}' };
        throw new Error(`Import inattendu : ${name}`);
      },
    });
    expect(options?.resources).toEqual({ fr: { translation: { salut: 'Salut {name}' } } });
    expect(options?.interpolation).toMatchObject({ prefix: '{', suffix: '}', escapeValue: false });
  });
});

describe('audit — extraction', () => {
  it.each([
    'const tr = useTranslations(); return tr("Bonjour");',
    'const t = useTranslations(); return t.rich("Bonjour", {});',
    'const { t: tr } = useTranslation(); return tr("Bonjour");',
  ])('ne retraduit pas les clés existantes : %s', body => {
    const result = scanContent(`export function Page(){ ${body} }`, 'C.tsx');
    expect(result.strings).toEqual([]);
  });

  it('ignore les templates tagués qui appartiennent à une autre grammaire', () => {
    const result = scanContent(
      'export function Page(){ return sql`SELECT name FROM users`; }',
      'C.tsx',
    );
    expect(result.strings).toEqual([]);
  });
});
