/**
 * Types du core — purs, sans aucune dépendance I/O.
 *
 * Le core ne lit ni n'écrit jamais sur le disque ni sur le réseau : il transforme
 * de la donnée en donnée. Tout effet de bord vit dans `src/adapters`.
 */

/** Nature syntaxique d'une string détectée dans le code source. */
export type StringKind = 'jsx-text' | 'jsx-attribute' | 'template' | 'string-literal';

/**
 * Emplacement d'une string vis-à-vis des fonctions :
 * - `component` : à l'intérieur d'une fonction/composant → `t()` y est accessible.
 * - `module`    : au niveau module (const top-level) → `t()` n'y est pas accessible.
 */
export type Scope = 'component' | 'module';

/**
 * Indique si un remplacement automatique par `t()` serait sûr.
 * - `safe`   : cas non ambigu, câblage mécanique.
 * - `review` : cas à vérifier humainement (module-scope, JSX inline sensible, metadata…).
 */
export type Safety = 'safe' | 'review';

/** Raison pour laquelle une string est marquée `review`. */
export type ReviewReason = 'module_scope' | 'jsx_inline_spacing' | 'nextjs_metadata';

/** Runtime d'un fichier, déterminé par la directive `'use client'`. */
export type Runtime = 'client' | 'server';
export type TranslationFramework = 'next-intl' | 'react-i18next' | 'expo';
export type CatalogFormat = 'flat' | 'nested';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * Variable interpolée d'une template literal.
 *
 * `expression` est le code source d'origine (`user.name`), `name` l'argument
 * ICU dérivé (`userName`).
 */
export interface TemplateVariable {
  /** Expression source, ex. `user.name`. */
  expression: string;
  /** Nom d'argument ICU valide, ex. `userName`. */
  name: string;
}

const JS_SHORTHAND_FORBIDDEN = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
]);

const VALID_JS_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Rend les arguments d'un appel `t()` : `{ count, userName: user.name }`.
 * Forme abrégée seulement si `name === expression` et que c'est un identifiant JS non réservé.
 */
export function formatTranslationArgs(variables: TemplateVariable[]): string {
  return variables
    .map(v =>
      v.name === v.expression &&
      VALID_JS_IDENT_RE.test(v.name) &&
      !JS_SHORTHAND_FORBIDDEN.has(v.name)
        ? v.name
        : `${v.name}: ${v.expression}`,
    )
    .join(', ');
}

/** Une string traduisible détectée, enrichie de ses métadonnées. */
export interface ExtractedString extends SourceLocation {
  value: string;
  kind: StringKind;
  scope: Scope;
  safety: Safety;
  reviewReason?: ReviewReason;
  /** Indice syntaxique optionnel (`jsx-attribute:placeholder`, `jsx-text:<button>`) pour les LLM. */
  contextHint?: string;
  /** Présent pour `kind === 'template'` avec interpolation. */
  variables?: TemplateVariable[];
  /** true si une variable interpolée ressemble à un compteur (`count`, `total`…). */
  pluralHint?: boolean;
}

/** Identité stable d'une occurrence (dé-duplication, comparaison). */
export function occurrenceId(loc: SourceLocation & { value: string }): string {
  return `${loc.file}:${loc.line}:${loc.column}:${loc.value}`;
}

/** Comparaison par point de code — déterministe sur toute machine. */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Catalogue de messages à plat : clé i18n → texte. */
export type Catalog = Record<string, string>;
