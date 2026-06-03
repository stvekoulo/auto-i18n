import { describe, it, expect } from 'vitest';
import {
  buildSourceCatalog,
  missingKeys,
  staleKeys,
  extractPlaceholders,
  placeholdersMatch,
  mergeTranslations,
} from '../../src/core/catalog';

describe('core/catalog — buildSourceCatalog', () => {
  it('crée des clés pour des valeurs nouvelles et trie le catalogue', () => {
    const { catalog, added, reused } = buildSourceCatalog(['Save', 'Cancel']);
    expect(catalog).toEqual({ cancel: 'Cancel', save: 'Save' });
    expect(added.sort()).toEqual(['cancel', 'save']);
    expect(reused).toEqual([]);
    // Tri alphabétique des clés.
    expect(Object.keys(catalog)).toEqual(['cancel', 'save']);
  });

  it('réutilise les clés existantes par valeur (merge stable)', () => {
    const existing = { save: 'Save' };
    const { keyMap, added, reused } = buildSourceCatalog(['Save', 'Cancel'], existing);
    expect(keyMap.get('Save')).toBe('save');
    expect(added).toEqual(['cancel']);
    expect(reused).toEqual(['save']);
  });

  it('dé-duplique les valeurs identiques', () => {
    const { catalog } = buildSourceCatalog(['Hello', 'Hello']);
    expect(Object.keys(catalog)).toEqual(['hello']);
  });

  it('désambiguïse deux valeurs produisant la même clé de base', () => {
    const { catalog } = buildSourceCatalog(['Save!', 'Save?']);
    expect(Object.keys(catalog).sort()).toEqual(['save', 'save_2']);
  });
});

describe('core/catalog — diff', () => {
  it('détecte les clés manquantes et obsolètes', () => {
    const source = { a: '1', b: '2' };
    const target = { a: 'x', c: 'y' };
    expect(missingKeys(source, target)).toEqual(['b']);
    expect(staleKeys(source, target)).toEqual(['c']);
  });
});

describe('core/catalog — placeholders', () => {
  it('extrait et compare les placeholders', () => {
    expect(extractPlaceholders('Hi {name}, you have {count} msgs')).toEqual(['{count}', '{name}']);
    expect(placeholdersMatch('Hi {name}', 'Bonjour {name}')).toBe(true);
    expect(placeholdersMatch('Hi {name}', 'Bonjour')).toBe(false);
    expect(placeholdersMatch('Hi {name}', 'Bonjour {nom}')).toBe(false);
  });
});

describe('core/catalog — mergeTranslations', () => {
  it('fusionne, élague les clés obsolètes et trie', () => {
    const source = { a: 'A', b: 'B' };
    const existing = { a: 'old', z: 'obsolete' };
    const fresh = { b: 'B-trad' };
    const merged = mergeTranslations(source, existing, fresh);
    expect(merged).toEqual({ a: 'old', b: 'B-trad' });
    expect(Object.keys(merged)).toEqual(['a', 'b']);
  });
});
