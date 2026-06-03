import { describe, it, expect } from 'vitest';
import { buildKey, KeyAllocator } from '../../src/core/keys';

describe('core/keys — buildKey', () => {
  it('produit des clés snake_case sans accents', () => {
    expect(buildKey('Bonjour le monde')).toBe('bonjour_le_monde');
    expect(buildKey('Gérez vos projets')).toBe('gerez_vos_projets');
    expect(buildKey('  Espaces  autour ')).toBe('espaces_autour');
  });

  it('traite les placeholders comme des séparateurs de mots', () => {
    expect(buildKey('Bonjour {name}')).toBe('bonjour_name');
  });

  it('est déterministe', () => {
    expect(buildKey('Same input')).toBe(buildKey('Same input'));
  });

  it('tronque proprement sur une frontière de mot', () => {
    const long = 'mot '.repeat(40).trim();
    const key = buildKey(long);
    expect(key.length).toBeLessThanOrEqual(60);
    expect(key.endsWith('_')).toBe(false);
  });

  it('renvoie "key" pour une entrée sans caractère alphanumérique', () => {
    expect(buildKey('!!!')).toBe('key');
  });
});

describe('core/keys — KeyAllocator', () => {
  it('désambiguïse les collisions', () => {
    const alloc = new KeyAllocator();
    expect(alloc.allocate('Save')).toBe('save');
    expect(alloc.allocate('Save')).toBe('save_2');
    expect(alloc.allocate('Save')).toBe('save_3');
  });

  it('respecte les clés réservées', () => {
    const alloc = new KeyAllocator(['save']);
    expect(alloc.allocate('Save')).toBe('save_2');
    expect(alloc.has('save')).toBe(true);
  });
});
