/**
 * Types du core — purs, sans aucune dépendance I/O.
 *
 * Le core ne lit ni n'écrit jamais sur le disque ni sur le réseau : il transforme
 * de la donnée en donnée. Tout effet de bord vit dans `src/adapters`.
 */

/** Nature syntaxique d'une string détectée dans le code source. */
export type StringKind =
  | 'jsx-text'
  | 'jsx-attribute'
  | 'template'
  | 'string-literal';

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

/** Une string traduisible détectée, enrichie de ses métadonnées. */
export interface ExtractedString extends SourceLocation {
  value: string;
  kind: StringKind;
  scope: Scope;
  safety: Safety;
  reviewReason?: ReviewReason;
  /** Présent pour `kind === 'template'` avec interpolation. */
  variables?: string[];
}

/** Identité stable d'une occurrence (dé-duplication, comparaison). */
export function occurrenceId(loc: SourceLocation & { value: string }): string {
  return `${loc.file}:${loc.line}:${loc.column}:${loc.value}`;
}

/** Catalogue de messages : clé i18n → texte source. */
export type Catalog = Record<string, string>;
