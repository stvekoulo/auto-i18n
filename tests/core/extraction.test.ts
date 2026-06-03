import { describe, it, expect } from 'vitest';
import { parseSource, extractStrings, detectRuntime } from '../../src/core/extraction';
import { scanContent } from '../../src/core/scan';
import type { ExtractedString } from '../../src/core/types';

function extract(content: string): ExtractedString[] {
  return extractStrings(parseSource(content, 'C.tsx'), 'C.tsx');
}

function valueOf(strings: ExtractedString[], value: string): ExtractedString | undefined {
  return strings.find(s => s.value === value);
}

describe('core/extraction — kinds', () => {
  it('extrait le texte JSX', () => {
    const s = extract('export default () => <p>Bonjour</p>;');
    expect(valueOf(s, 'Bonjour')?.kind).toBe('jsx-text');
  });

  it('extrait les attributs traduisibles, pas les techniques', () => {
    const s = extract('export default () => <input placeholder="Chercher" className="x" />;');
    expect(valueOf(s, 'Chercher')?.kind).toBe('jsx-attribute');
    expect(valueOf(s, 'x')).toBeUndefined();
  });

  it('extrait les template literals avec leurs variables', () => {
    const s = extract('export default function C(){ const name = "x"; return <p>{`Salut ${name}`}</p>; }');
    const t = valueOf(s, 'Salut {name}');
    expect(t?.kind).toBe('template');
    expect(t?.variables).toEqual(['name']);
  });

  it('ignore le premier argument des appels t()', () => {
    const s = extract('export default function C(){ return <p>{t("deja_clef")}</p>; }');
    expect(valueOf(s, 'deja_clef')).toBeUndefined();
  });
});

describe('core/extraction — scope & safety', () => {
  it('marque les strings module-scope comme review', () => {
    const s = extract("const items = ['Accueil', 'Contact'];");
    const accueil = valueOf(s, 'Accueil');
    expect(accueil?.scope).toBe('module');
    expect(accueil?.safety).toBe('review');
    expect(accueil?.reviewReason).toBe('module_scope');
  });

  it('marque le texte JSX simple comme safe / component', () => {
    const s = extract('export default function C(){ return <p>Bonjour</p>; }');
    const b = valueOf(s, 'Bonjour');
    expect(b?.scope).toBe('component');
    expect(b?.safety).toBe('safe');
  });

  it('marque le texte JSX inline ambigu (newline dans le padding) comme review', () => {
    // "texte" suivi d'un saut de ligne puis d'un élément inline → espacement sensible.
    const content = 'export default function C(){ return (<p>texte\n<a>x</a></p>); }';
    const s = extract(content);
    const inline = valueOf(s, 'texte');
    expect(inline?.safety).toBe('review');
    expect(inline?.reviewReason).toBe('jsx_inline_spacing');
  });
});

describe('core/extraction — detectRuntime', () => {
  it('détecte un composant client', () => {
    expect(detectRuntime(parseSource("'use client';\nexport default () => null;", 'C.tsx'))).toBe('client');
  });

  it('considère server par défaut', () => {
    expect(detectRuntime(parseSource('export default () => null;', 'C.tsx'))).toBe('server');
  });
});

describe('core/scan — filtrage intégré', () => {
  it('sépare strings retenues et ignorées par heuristique', () => {
    // L'URL est extraite (string literal en contexte valide) puis filtrée.
    const { strings, ignored } = scanContent(
      'export default function C(){ const u = "https://x.com"; return <p>Valider</p>; }',
      'C.tsx',
    );
    expect(strings.some(s => s.value === 'Valider')).toBe(true);
    expect(ignored.some(i => i.value === 'https://x.com' && i.reason === 'absolute_url')).toBe(true);
  });
});