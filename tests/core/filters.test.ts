import { describe, it, expect } from 'vitest';
import { getIgnoreReason, isIgnorable } from '../../src/core/filters';

describe('core/filters — getIgnoreReason', () => {
  it('ignore les valeurs vides et les nombres', () => {
    expect(getIgnoreReason('')).toBe('empty');
    expect(getIgnoreReason('   ')).toBe('empty');
    expect(getIgnoreReason('42')).toBe('numeric');
    expect(getIgnoreReason('-3.14')).toBe('numeric');
  });

  it('ignore les valeurs CSS, couleurs et fonctions de couleur', () => {
    expect(getIgnoreReason('16px')).toBe('css_value');
    expect(getIgnoreReason('2rem')).toBe('css_value');
    expect(getIgnoreReason('#fff')).toBe('hex_color');
    expect(getIgnoreReason('#a1b2c3')).toBe('hex_color');
    expect(getIgnoreReason('rgba(0,0,0,0.5)')).toBe('css_function_color');
  });

  it('ignore les URLs, protocoles et routes', () => {
    expect(getIgnoreReason('https://example.com')).toBe('absolute_url');
    expect(getIgnoreReason('mailto:a@b.com')).toBe('protocol_url');
    expect(getIgnoreReason('//cdn.example.com/x')).toBe('protocol_relative_url');
    expect(getIgnoreReason('/dashboard/settings')).toBe('route');
  });

  it('ignore les mots-clés techniques et identifiants', () => {
    expect(getIgnoreReason('flex')).toBe('technical_keyword');
    expect(getIgnoreReason('POST')).toBe('technical_keyword');
    expect(getIgnoreReason('camelCaseName')).toBe('camel_case_identifier');
    expect(getIgnoreReason('API_BASE_URL')).toBe('env_var');
  });

  it('ignore les classes CSS et tokens Tailwind', () => {
    expect(getIgnoreReason('flex items-center gap-4')).toBe('css_class_string');
    expect(getIgnoreReason('text-sm')).toBe('single_css_token');
  });

  it('ignore les nombres avec affixe et les symboles', () => {
    expect(getIgnoreReason('29€')).toBe('numeric_with_affix');
    expect(getIgnoreReason('1500+')).toBe('numeric_with_affix');
    expect(getIgnoreReason('★')).toBe('symbol_or_emoji');
  });

  it('conserve le vrai texte humain', () => {
    expect(getIgnoreReason('Bonjour le monde')).toBeNull();
    expect(getIgnoreReason('Gérez vos projets')).toBeNull();
    expect(getIgnoreReason('Welcome')).toBeNull();
  });

  it('respecte la blacklist configurable', () => {
    expect(getIgnoreReason('Acme', { blacklist: ['Acme'] })).toBe('blacklist');
    expect(getIgnoreReason('Acme')).toBeNull();
  });

  it('isIgnorable reflète getIgnoreReason', () => {
    expect(isIgnorable('flex')).toBe(true);
    expect(isIgnorable('Bonjour')).toBe(false);
  });
});
