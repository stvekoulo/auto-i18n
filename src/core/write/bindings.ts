import ts from 'typescript';
import type { TranslationFramework } from '../types.js';

export type HostFn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** Une liaison destructurée compte autant qu'un identifiant simple. */
export function binds(node: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(node)) return node.text === name;
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    return node.elements.some(el => ts.isBindingElement(el) && binds(el.name, name));
  }
  return false;
}

export function findTopLevelTDeclaration(fn: HostFn): ts.VariableDeclaration | undefined {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return undefined;
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (binds(declaration.name, 't')) return declaration;
    }
  }
  return undefined;
}

function usesReactHook(framework: TranslationFramework): boolean {
  return framework === 'react-i18next' || framework === 'expo';
}

/**
 * Inspecte une déclaration `t` existante :
 * - `'root'` : traducteur sans namespace (`useTranslations()`, `useTranslation()`)
 * - `{ namespace }` : traducteur namespacé (`useTranslations('Header')`)
 * - `null` : origine non reconnue (conflit)
 */
export function inspectTSource(
  decl: ts.VariableDeclaration,
  sf: ts.SourceFile,
  framework: TranslationFramework = 'next-intl',
): 'root' | { namespace: string } | null {
  if (!decl.initializer) return null;
  const call = ts.isAwaitExpression(decl.initializer)
    ? decl.initializer.expression
    : decl.initializer;
  if (!ts.isCallExpression(call)) return null;
  const callee = call.expression.getText(sf);

  const validCallee = usesReactHook(framework)
    ? ts.isObjectBindingPattern(decl.name) && callee === 'useTranslation'
    : callee === 'useTranslations' || callee === 'getTranslations';
  if (!validCallee) return null;

  if (call.arguments.length === 0) return 'root';
  if (
    call.arguments.length === 1 &&
    (ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0]))
  ) {
    return { namespace: call.arguments[0].text };
  }
  return null;
}

export function isValidTSource(
  decl: ts.VariableDeclaration,
  sf: ts.SourceFile,
  framework: TranslationFramework = 'next-intl',
): boolean {
  return inspectTSource(decl, sf, framework) === 'root';
}

function hasOuterTBinding(fn: HostFn): boolean {
  let current: ts.Node | undefined = fn.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      if (current.parameters.some(p => binds(p.name, 't'))) return true;
      if (current.body && ts.isBlock(current.body)) {
        for (const stmt of current.body.statements) {
          if (!ts.isVariableStatement(stmt)) continue;
          if (stmt.declarationList.declarations.some(d => binds(d.name, 't'))) return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}

function referencesIdentifierT(fn: HostFn): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === 't') {
      const parent = node.parent;
      const isPropName =
        parent &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node));
      if (!isPropName) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  if (fn.body) visit(fn.body);
  return found;
}

/** Refuser les collisions plutôt que d'écraser ou masquer un `t` ou un import ambigu. */
export function hasBindingConflict(fn: HostFn, sourceFile: ts.SourceFile, hook: string): boolean {
  if (fn.parameters.some(p => binds(p.name, 't'))) return true;
  const existing = findTopLevelTDeclaration(fn);
  if (!existing && hasOuterTBinding(fn) && referencesIdentifierT(fn)) return true;

  let conflict = false;
  function checkDescendant(node: ts.Node): void {
    if (conflict) return;
    if (node !== existing) {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && binds(node.name, 't')) {
        conflict = true;
        return;
      }
      if (
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name?.text === 't'
      ) {
        conflict = true;
        return;
      }
    }
    ts.forEachChild(node, checkDescendant);
  }
  if (fn.body) ts.forEachChild(fn.body, checkDescendant);
  if (conflict) return true;

  const expectedModule =
    hook === 'useTranslation'
      ? 'react-i18next'
      : hook === 'useTranslations'
        ? 'next-intl'
        : 'next-intl/server';

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const clause = stmt.importClause;
    const mod = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : '';
    if (clause.name?.text === hook) return true;
    if (
      clause.namedBindings &&
      ts.isNamespaceImport(clause.namedBindings) &&
      clause.namedBindings.name.text === hook
    ) {
      return true;
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) {
        const imported = (spec.propertyName ?? spec.name).text;
        const local = spec.name.text;
        if (imported === hook || local === hook) {
          if (local !== hook || mod !== expectedModule || clause.isTypeOnly || spec.isTypeOnly) {
            return true;
          }
        }
      }
    }
  }

  function checkHookShadow(node: ts.Node): void {
    if (conflict) return;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && binds(node.name, hook)) {
      conflict = true;
      return;
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name?.text === hook
    ) {
      conflict = true;
      return;
    }
    ts.forEachChild(node, checkHookShadow);
  }
  ts.forEachChild(sourceFile, checkHookShadow);
  return conflict;
}
