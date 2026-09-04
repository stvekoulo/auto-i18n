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
 * - `review` : cas à vérifier humainement (module-scope, JSX inline sensible…).
 */
export type Safety = 'safe' | 'review';

/** Raison pour laquelle une string est marquée `review`. */
export type ReviewReason = 'module_scope' | 'jsx_inline_spacing';

/** Runtime d'un fichier, déterminé par la directive `'use client'`. */
export type Runtime = 'client' | 'server';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * Variable interpolée d'une template literal.
 *
 * `expression` est le code source d'origine (`user.name`), `name` l'argument
 * ICU dérivé (`userName`). Les deux sont nécessaires et distincts : ICU
 * MessageFormat n'accepte qu'un identifiant comme nom d'argument, alors que le
 * codemod doit réinjecter l'expression telle quelle côté appelant.
 */
export interface TemplateVariable {
  /** Expression source, ex. `user.name`. */
  expression: string;
  /** Nom d'argument ICU valide, ex. `userName`. */
  name: string;
}

/**
 * Rend les arguments d'un appel `t()` : `{ count, userName: user.name }`.
 * Forme abrégée quand le nom ICU et l'expression coïncident.
 */
export function formatTranslationArgs(variables: TemplateVariable[]): string {
  return variables
    .map(v => (v.name === v.expression ? v.name : `${v.name}: ${v.expression}`))
    .join(', ');
}

/** Une string traduisible détectée, enrichie de ses métadonnées. */
export interface ExtractedString extends SourceLocation {
  value: string;
  kind: StringKind;
  scope: Scope;
  safety: Safety;
  reviewReason?: ReviewReason;
  /** Présent pour `kind === 'template'` avec interpolation. */
  variables?: TemplateVariable[];
  /**
   * true si une variable interpolée ressemble à un compteur (`count`, `total`…) —
   * candidat probable à une forme plurielle ICU plutôt qu'un texte figé.
   */
  pluralHint?: boolean;
}

/** Identité stable d'une occurrence (dé-duplication, comparaison). */
export function occurrenceId(loc: SourceLocation & { value: string }): string {
  return `${loc.file}:${loc.line}:${loc.column}:${loc.value}`;
}

/**
 * Comparaison par point de code — déterministe sur toute machine.
 *
 * `String#localeCompare` dépend des données ICU embarquées dans le build Node
 * et de la locale de l'hôte : le même catalogue s'ordonnerait différemment en
 * local et en CI, produisant un diff fantôme à chaque exécution.
 */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Catalogue de messages : clé i18n → texte source. */
export type Catalog = Record<string, string>;
