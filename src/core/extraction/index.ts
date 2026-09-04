/**
 * Extraction des strings traduisibles depuis un AST (lecture seule).
 *
 * Produit des {@link ExtractedString} enrichies de leur `scope` (component vs
 * module) et de leur `safety` (sûr à wrapper en `t()` ou à revoir). Aucun effet
 * de bord : on ne modifie jamais l'AST.
 */

import {
  type JsxAttribute,
  type SourceFile,
  type TemplateExpression,
  SyntaxKind,
  Node,
} from 'ts-morph';
import type {
  ExtractedString,
  ReviewReason,
  Runtime,
  Scope,
  StringKind,
  TemplateVariable,
} from '../types.js';

export { parseSource, getSyntaxErrors } from './parse.js';

/** Attributs JSX dont la valeur est du texte présenté à l'utilisateur. */
// prettier-ignore
export const TRANSLATABLE_ATTRIBUTES = new Set([
  'placeholder', 'alt', 'title', 'aria-label', 'aria-placeholder',
  'aria-description', 'aria-details', 'label', 'content',
]);

/** Noms de propriétés dont la valeur est technique (jamais traduisible). */
// prettier-ignore
const TECHNICAL_PROPERTY_NAMES = new Set([
  'key', 'id', 'className', 'class', 'style', 'type',
  'href', 'src', 'srcSet', 'action', 'method', 'target', 'rel',
  'role', 'htmlFor', 'icon', 'color', 'variant', 'size',
  'as', 'component', 'testId', 'dataTestId', 'data-testid', 'data-cy',
  'path', 'route', 'url', 'pattern', 'regex', 'format', 'encoding',
  'charset', 'mime', 'mimeType', 'contentType',
  'orientation', 'direction', 'align', 'justify', 'decorative',
  'backgroundColor', 'borderColor', 'borderRadius', 'border',
  'fontWeight', 'fontSize', 'fontFamily', 'lineHeight',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'padding', 'margin', 'gap', 'display', 'position', 'overflow',
]);

const CSS_UTILITY_CALLEES = /^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/;
const TECHNICAL_CALLEES =
  /^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|addEventListener|removeEventListener)$/;
const T_CALLEES = /^t$|^translate$/;
/** Variable interpolée qui ressemble à un compteur → forme plurielle probable. */
const PLURAL_VAR_RE = /count|total|num|qty|quantity|amount|length/i;

function isPluralCandidate(variables: TemplateVariable[]): boolean {
  return variables.some(v => PLURAL_VAR_RE.test(v.expression));
}

const IDENTIFIER_TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Dérive un nom d'argument ICU valide depuis une expression JS quelconque.
 * `user.name` → `userName`, `items[0].label` → `itemsLabel`, `count` → `count`.
 *
 * ICU MessageFormat ne tolère pas les points ni les appels dans un nom
 * d'argument : sans cette normalisation, le catalogue produit un message que
 * `next-intl` refuse au runtime.
 */
export function toIcuName(expression: string): string {
  const tokens = expression.match(IDENTIFIER_TOKEN_RE) ?? [];
  if (tokens.length === 0) return 'value';
  const [first, ...rest] = tokens;
  return first + rest.map(t => t[0].toUpperCase() + t.slice(1)).join('');
}

/** Nomme les variables d'une template literal, sans collision ni doublon. */
class TemplateVariables {
  private readonly byExpression = new Map<string, string>();
  private readonly used = new Set<string>();
  readonly list: TemplateVariable[] = [];

  /** Renvoie le nom ICU de `expression` (stable pour une même expression). */
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

function getTemplateText(node: Node): string {
  const compiler = node.compilerNode as unknown as Record<string, unknown>;
  return typeof compiler['text'] === 'string' ? compiler['text'] : '';
}

function locationOf(node: Node): { line: number; column: number } {
  return {
    line: node.getStartLineNumber(),
    column: node.getStart() - node.getStartLinePos() + 1,
  };
}

function hasEnclosingFunction(node: Node): boolean {
  let current = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current)
    ) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

function scopeOf(node: Node): Scope {
  return hasEnclosingFunction(node) ? 'component' : 'module';
}

function isFirstArgOfTCall(node: Node): boolean {
  const parent = node.getParent();
  if (!parent || !Node.isCallExpression(parent)) return false;
  if (!T_CALLEES.test(parent.getExpression().getText())) return false;
  const args = parent.getArguments();
  return args.length > 0 && args[0] === node;
}

function isInsideNonTranslatableAttribute(node: Node): boolean {
  let current = node.getParent();
  while (current) {
    if (Node.isJsxAttribute(current)) {
      const name = current.getNameNode().getText();
      return !TRANSLATABLE_ATTRIBUTES.has(name);
    }
    if (Node.isJsxElement(current) || Node.isJsxSelfClosingElement(current)) break;
    current = current.getParent();
  }
  return false;
}

function isInNonExtractableContext(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return true;

  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return true;
  if (Node.isPropertyAssignment(parent) && TECHNICAL_PROPERTY_NAMES.has(parent.getName()))
    return true;
  if (parent.getKind() === SyntaxKind.Parameter) return true;
  if (parent.getKind() === SyntaxKind.BindingElement) return true;
  if (Node.isNewExpression(parent)) return true;

  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    if (TECHNICAL_CALLEES.test(callee) || CSS_UTILITY_CALLEES.test(callee)) return true;
  }

  let current: Node | undefined = parent;
  while (current) {
    if (Node.isImportDeclaration(current) || Node.isExportDeclaration(current)) return true;
    if (Node.isTypeAliasDeclaration(current) || Node.isInterfaceDeclaration(current)) return true;
    if (Node.isEnumDeclaration(current)) return true;
    if (Node.isJsxAttribute(current)) return true;
    if (
      Node.isCallExpression(current) &&
      CSS_UTILITY_CALLEES.test(current.getExpression().getText())
    )
      return true;
    current = current.getParent();
  }

  return false;
}

// ── Sûreté du texte JSX (espacement inline ambigu) ──────────────────────────

function getJsxPadding(rawText: string, trimmed: string): { leading: string; trailing: string } {
  const start = rawText.indexOf(trimmed);
  if (start < 0) return { leading: '', trailing: '' };
  const end = start + trimmed.length;
  return { leading: rawText.slice(0, start), trailing: rawText.slice(end) };
}

/**
 * Le texte JSX est ambigu (saut à la ligne ou padding signifiant entre voisins
 * inline) → un wrap automatique en `t()` pourrait casser l'espacement.
 */
function isUnsafeJsxText(node: Node, leading: string, trailing: string): boolean {
  const prev = node.getPreviousSibling();
  const next = node.getNextSibling();
  const hasInlineNeighbor = Boolean(
    (prev && !Node.isJsxText(prev)) || (next && !Node.isJsxText(next)),
  );
  if (!hasInlineNeighbor) return false;

  if (/[\r\n]/.test(leading) || /[\r\n]/.test(trailing)) return true;

  return (
    (leading.length > 0 && !/^[ \t]+$/.test(leading)) ||
    (trailing.length > 0 && !/^[ \t]+$/.test(trailing))
  );
}

function makeString(
  base: { value: string; kind: StringKind; file: string },
  node: Node,
  opts: { review?: ReviewReason; variables?: TemplateVariable[]; pluralHint?: boolean } = {},
): ExtractedString {
  const scope: Scope =
    base.kind === 'jsx-text' || base.kind === 'jsx-attribute' ? 'component' : scopeOf(node);

  let safety: ExtractedString['safety'] = 'safe';
  let reviewReason = opts.review;

  if (scope === 'module') {
    safety = 'review';
    reviewReason = reviewReason ?? 'module_scope';
  } else if (opts.review) {
    safety = 'review';
  }

  return {
    ...base,
    ...locationOf(node),
    scope,
    safety,
    ...(reviewReason ? { reviewReason } : {}),
    ...(opts.variables ? { variables: opts.variables } : {}),
    ...(opts.pluralHint ? { pluralHint: true } : {}),
  };
}

/** Détecte le runtime du fichier via la directive `'use client'`. */
export function detectRuntime(sourceFile: SourceFile): Runtime {
  const first = sourceFile.getStatements()[0];
  if (first && Node.isExpressionStatement(first)) {
    const expr = first.getExpression();
    if (Node.isStringLiteral(expr) && expr.getLiteralValue() === 'use client') {
      return 'client';
    }
  }
  return 'server';
}

/** Une string extraite, avec le nœud AST dont elle provient (pour le codemod `--write`). */
export interface ExtractedStringNode {
  info: ExtractedString;
  node: Node;
}

/** Texte JSX brut : `<p>Bonjour</p>`. */
function collectJsxText(node: Node, file: string, out: ExtractedStringNode[]): void {
  const rawText = node.getText();
  const trimmed = rawText.trim();
  if (!trimmed) return;

  const { leading, trailing } = getJsxPadding(rawText, trimmed);
  const review = isUnsafeJsxText(node, leading, trailing) ? 'jsx_inline_spacing' : undefined;
  out.push({
    info: makeString({ value: trimmed, kind: 'jsx-text', file }, node, { review }),
    node,
  });
}

/** Attribut JSX présenté à l'utilisateur : `placeholder`, `alt`, `title`… */
function collectJsxAttribute(attr: JsxAttribute, file: string, out: ExtractedStringNode[]): void {
  if (!TRANSLATABLE_ATTRIBUTES.has(attr.getNameNode().getText())) return;
  const initializer = attr.getInitializer();
  if (!initializer) return;

  let value: string | null = null;
  let target: Node = initializer;

  if (Node.isStringLiteral(initializer)) {
    value = initializer.getLiteralValue();
  } else if (Node.isJsxExpression(initializer)) {
    const inner = initializer.getExpression();
    if (inner && Node.isStringLiteral(inner)) {
      value = inner.getLiteralValue();
      target = inner;
    }
  }

  if (!value?.trim()) return;
  out.push({
    info: makeString({ value: value.trim(), kind: 'jsx-attribute', file }, target),
    node: target,
  });
}

/** Template literal avec interpolation : `` `Bonjour ${user.name}` ``. */
function collectTemplateExpression(
  node: TemplateExpression,
  file: string,
  out: ExtractedStringNode[],
): void {
  if (isFirstArgOfTCall(node) || isInsideNonTranslatableAttribute(node)) return;

  const variables = new TemplateVariables();
  let reconstructed = getTemplateText(node.getHead());
  for (const span of node.getTemplateSpans()) {
    const name = variables.nameFor(span.getExpression().getText());
    reconstructed += `{${name}}${getTemplateText(span.getLiteral())}`;
  }

  const trimmed = reconstructed.trim();
  if (!trimmed) return;
  out.push({
    info: makeString({ value: trimmed, kind: 'template', file }, node, {
      variables: variables.list,
      pluralHint: isPluralCandidate(variables.list),
    }),
    node,
  });
}

/**
 * Extrait toutes les strings traduisibles brutes d'un fichier (avant filtres),
 * avec leur nœud AST d'origine. `extractStrings` (API publique, sans I/O ni
 * dépendance à ts-morph côté appelant) en est une projection.
 *
 * Une seule traversée pour les cinq formes : cinq `getDescendantsOfKind`
 * parcouraient l'arbre entier cinq fois et enveloppaient chaque nœud à chaque
 * passe (285 ms contre 81 ms sur 300 fichiers). Les résultats sortent donc en
 * ordre du document plutôt que groupés par forme.
 */
export function extractStringNodes(sourceFile: SourceFile, file: string): ExtractedStringNode[] {
  const results: ExtractedStringNode[] = [];

  sourceFile.forEachDescendant(node => {
    if (Node.isJsxText(node)) {
      collectJsxText(node, file, results);
    } else if (Node.isJsxAttribute(node)) {
      collectJsxAttribute(node, file, results);
    } else if (Node.isNoSubstitutionTemplateLiteral(node)) {
      if (isFirstArgOfTCall(node) || isInsideNonTranslatableAttribute(node)) return;
      const value = node.getLiteralValue().trim();
      if (value) results.push({ info: makeString({ value, kind: 'template', file }, node), node });
    } else if (Node.isTemplateExpression(node)) {
      collectTemplateExpression(node, file, results);
    } else if (Node.isStringLiteral(node)) {
      if (isFirstArgOfTCall(node) || isInNonExtractableContext(node)) return;
      const value = node.getLiteralValue().trim();
      if (value) {
        results.push({ info: makeString({ value, kind: 'string-literal', file }, node), node });
      }
    }
  });

  return results;
}

/** Extrait toutes les strings traduisibles brutes d'un fichier (avant filtres). */
export function extractStrings(sourceFile: SourceFile, file: string): ExtractedString[] {
  return extractStringNodes(sourceFile, file).map(x => x.info);
}
