/**
 * Règles contextuelles d'extraction AST (attributs traduisibles, propriétés techniques,
 * directives JS, runtime Next.js et métadonnées App Router).
 */

import ts from 'typescript';
import type { Runtime, Scope } from '../types.js';

/** Attributs JSX HTML, ARIA et React Native / Expo dont la valeur est présentée à l'utilisateur. */
// prettier-ignore
export const TRANSLATABLE_ATTRIBUTES = new Set([
  'placeholder', 'alt', 'title', 'aria-label', 'aria-placeholder',
  'aria-description', 'aria-details', 'label', 'content',
  'accessibilityLabel', 'accessibilityHint', 'tabBarLabel',
  'headerTitle', 'drawerLabel', 'backButtonTitle',
]);

/** Noms de propriétés d'objet dont la valeur est technique (jamais traduisible). */
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
  /^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|addEventListener|removeEventListener|(?:window\.)?document\.(?:getElementById|querySelector|querySelectorAll|createElement|getElementsBy\w+)|(?:localStorage|sessionStorage)\.\w+)$/;
const DIRECTIVES = new Set(['use client', 'use server', 'use strict']);

const EQUALITY_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

export function hasEnclosingFunction(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function scopeOf(node: ts.Node): Scope {
  return hasEnclosingFunction(node) ? 'component' : 'module';
}

/** Détecte le runtime du fichier via la directive `'use client'`. */
export function detectRuntime(sourceFile: ts.SourceFile): Runtime {
  for (const stmt of sourceFile.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) break;
    if (stmt.expression.text === 'use client') return 'client';
  }
  return 'server';
}

function isJsDirective(node: ts.Node): boolean {
  if (!ts.isStringLiteral(node) || !DIRECTIVES.has(node.text)) return false;
  const parent = node.parent;
  if (!parent || !ts.isExpressionStatement(parent)) return false;
  const container = parent.parent;
  if (!container || (!ts.isSourceFile(container) && !ts.isBlock(container))) return false;
  for (const stmt of container.statements) {
    if (stmt === parent) return true;
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) return false;
  }
  return false;
}

/** Vrai si le nœud se trouve dans `export const metadata = { ... }` (Next.js App Router). */
export function isInsideNextStaticMetadata(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.name.text === 'metadata'
    ) {
      const varStmt = current.parent?.parent;
      if (
        varStmt &&
        ts.isVariableStatement(varStmt) &&
        varStmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        return true;
      }
    }
    if (ts.isFunctionLike(current)) return false;
    current = current.parent;
  }
  return false;
}

export function isInsideNonTranslatableAttribute(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current)) {
      return !TRANSLATABLE_ATTRIBUTES.has(current.name.getText());
    }
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) break;
    current = current.parent;
  }
  return false;
}

function propertyNameText(name: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(sf);
}

export function isInNonExtractableContext(node: ts.Node, sf: ts.SourceFile): boolean {
  if (isJsDirective(node)) return true;
  const parent = node.parent;
  if (!parent) return true;

  if (ts.isPropertyAssignment(parent)) {
    if (parent.name === node) return true;
    if (TECHNICAL_PROPERTY_NAMES.has(propertyNameText(parent.name, sf))) return true;
  }
  if (ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isNewExpression(parent)) {
    return true;
  }
  if (ts.isCaseClause(parent) && parent.expression === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isBinaryExpression(parent) && EQUALITY_OPERATORS.has(parent.operatorToken.kind)) {
    return true;
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText(sf);
    if (TECHNICAL_CALLEES.test(callee) || CSS_UTILITY_CALLEES.test(callee)) return true;
  }

  let current: ts.Node | undefined = parent;
  while (current) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true;
    if (
      ts.isTypeNode(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isEnumDeclaration(current)
    ) {
      return true;
    }
    if (ts.isJsxAttribute(current)) {
      return !TRANSLATABLE_ATTRIBUTES.has(current.name.getText(sf));
    }
    if (ts.isCallExpression(current) && CSS_UTILITY_CALLEES.test(current.expression.getText(sf))) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function contextHintOf(node: ts.Node, sf: ts.SourceFile): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxAttribute(current)) return `jsx-attribute:${current.name.getText(sf)}`;
    if (ts.isJsxElement(current)) {
      return `jsx-text:<${current.openingElement.tagName.getText(sf)}>`;
    }
    if (ts.isPropertyAssignment(current) && isInsideNextStaticMetadata(node)) {
      return `nextjs-metadata:${propertyNameText(current.name, sf)}`;
    }
    current = current.parent;
  }
  return undefined;
}
