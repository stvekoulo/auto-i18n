/**
 * Extraction des strings traduisibles depuis un AST (lecture seule).
 *
 * Produit des {@link ExtractedString} enrichies de leur `scope` (component vs
 * module) et de leur `safety` (sûr à wrapper en `t()` ou à revoir). Aucun effet
 * de bord : on ne modifie jamais l'AST.
 */

import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import type {
  ExtractedString,
  ReviewReason,
  Runtime,
  Scope,
  StringKind,
} from '../types.js';

export { parseSource } from './parse.js';

/** Attributs JSX dont la valeur est du texte présenté à l'utilisateur. */
export const TRANSLATABLE_ATTRIBUTES = new Set([
  'placeholder', 'alt', 'title', 'aria-label', 'aria-placeholder',
  'aria-description', 'aria-details', 'label', 'content',
]);

/** Noms de propriétés dont la valeur est technique (jamais traduisible). */
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
  if (Node.isPropertyAssignment(parent) && TECHNICAL_PROPERTY_NAMES.has(parent.getName())) return true;
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
    if (Node.isCallExpression(current) && CSS_UTILITY_CALLEES.test(current.getExpression().getText())) return true;
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
  opts: { review?: ReviewReason; variables?: string[] } = {},
): ExtractedString {
  const scope: Scope = base.kind === 'jsx-text' || base.kind === 'jsx-attribute'
    ? 'component'
    : scopeOf(node);

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

/** Extrait toutes les strings traduisibles brutes d'un fichier (avant filtres). */
export function extractStrings(sourceFile: SourceFile, file: string): ExtractedString[] {
  const results: ExtractedString[] = [];

  // 1. Texte JSX
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const rawText = node.getText();
    const trimmed = rawText.trim();
    if (!trimmed) continue;
    const { leading, trailing } = getJsxPadding(rawText, trimmed);
    const review = isUnsafeJsxText(node, leading, trailing) ? 'jsx_inline_spacing' : undefined;
    results.push(makeString({ value: trimmed, kind: 'jsx-text', file }, node, { review }));
  }

  // 2. Attributs JSX traduisibles
  for (const attr of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (!TRANSLATABLE_ATTRIBUTES.has(attr.getNameNode().getText())) continue;
    const initializer = attr.getInitializer();
    if (!initializer) continue;

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

    if (!value?.trim()) continue;
    results.push(makeString({ value: value.trim(), kind: 'jsx-attribute', file }, target));
  }

  // 3. Template literals sans interpolation
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    if (isFirstArgOfTCall(node) || isInsideNonTranslatableAttribute(node)) continue;
    const value = node.getLiteralValue().trim();
    if (!value) continue;
    results.push(makeString({ value, kind: 'template', file }, node));
  }

  // 4. Template literals avec interpolation `{var}`
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    if (isFirstArgOfTCall(node) || isInsideNonTranslatableAttribute(node)) continue;

    const variables: string[] = [];
    let reconstructed = getTemplateText(node.getHead());
    for (const span of node.getTemplateSpans()) {
      const varExpr = span.getExpression().getText();
      variables.push(varExpr);
      reconstructed += `{${varExpr}}${getTemplateText(span.getLiteral())}`;
    }

    const trimmed = reconstructed.trim();
    if (!trimmed) continue;
    results.push(makeString({ value: trimmed, kind: 'template', file }, node, { variables }));
  }

  // 5. String literals
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (isFirstArgOfTCall(node) || isInNonExtractableContext(node)) continue;
    const value = node.getLiteralValue().trim();
    if (!value) continue;
    results.push(makeString({ value, kind: 'string-literal', file }, node));
  }

  return results;
}
