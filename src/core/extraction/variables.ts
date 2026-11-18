/**
 * Normalisation des variables interpolées et échappement ICU des segments statiques.
 */

import type { TemplateVariable } from '../types.js';

const IDENTIFIER_TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*/g;
const PLURAL_VAR_RE = /count|total|num|qty|quantity|amount|length/i;

const RESERVED_LITERAL_EXPRESSIONS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'super',
  'void',
]);

/**
 * Dérive un nom d'argument ICU valide depuis une expression JS quelconque.
 * `user.name` → `userName`, `items[0].label` → `itemsLabel`, `count` → `count`.
 */
export function toIcuName(expression: string): string {
  const trimmed = expression.trim();
  if (RESERVED_LITERAL_EXPRESSIONS.has(trimmed)) return 'value';
  const tokens = trimmed.match(IDENTIFIER_TOKEN_RE) ?? [];
  if (tokens.length === 0) return 'value';
  const [first, ...rest] = tokens;
  const candidate = first + rest.map(t => t[0].toUpperCase() + t.slice(1)).join('');
  return RESERVED_LITERAL_EXPRESSIONS.has(candidate) ? 'value' : candidate;
}

export function isPluralCandidate(variables: TemplateVariable[]): boolean {
  return variables.some(v => PLURAL_VAR_RE.test(v.expression));
}

/** Nomme les variables d'une template literal, sans collision ni doublon. */
export class TemplateVariables {
  private readonly byExpression = new Map<string, string>();
  private readonly used = new Set<string>();
  readonly list: TemplateVariable[] = [];

  nameFor(expression: string): string {
    const known = this.byExpression.get(expression);
    if (known) return known;

    const base = toIcuName(expression);
    let name = base;
    for (let suffix = 2; this.used.has(name); suffix++) name = `${base}${suffix}`;

    this.used.add(name);
    this.byExpression.set(expression, name);
    this.list.push({ expression, name });
    return name;
  }
}

/**
 * Échappe un segment littéral d'une template expression pour ICU MessageFormat :
 * - les accolades littérales `{` et `}` deviennent `'{'` et `'}'` ;
 * - une apostrophe `'` placée juste avant une interpolation `{var}` (ou devant `{`/`}`)
 *   est doublée (`''`) afin qu'ICU ne capture pas `{var}` comme texte littéral quoté.
 */
export function escapeIcuTemplateSegment(segment: string, beforePlaceholder: boolean): string {
  let out = segment
    .replace(/'([{}])/g, "''$1")
    .replace(/\{/g, "'{'")
    .replace(/\}/g, "'}'");
  if (beforePlaceholder && out.endsWith("'") && !out.endsWith("''")) {
    out = `${out.slice(0, -1)}''`;
  }
  return out;
}
