import {
  Node,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';
import type { TranslationFramework } from '../types.js';

export type HostFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

/** Une liaison destructurée compte autant qu'un identifiant simple. */
function binds(node: Node, name: string): boolean {
  if (Node.isIdentifier(node)) return node.getText() === name;
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node
      .getElements()
      .some(element => Node.isBindingElement(element) && binds(element.getNameNode(), name));
  }
  return false;
}

export function findTopLevelTDeclaration(fn: HostFn): Node | undefined {
  const body = fn.getBody();
  if (!body || !Node.isBlock(body)) return undefined;
  for (const statement of body.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue;
    for (const declaration of statement.getDeclarations()) {
      if (binds(declaration.getNameNode(), 't')) return declaration;
    }
  }
  return undefined;
}

/** Seul un traducteur sans namespace peut recevoir les clés du catalogue à plat. */
export function isValidTSource(decl: Node, framework: TranslationFramework = 'next-intl'): boolean {
  if (!Node.isVariableDeclaration(decl)) return false;
  const init = decl.getInitializer();
  const call = init && Node.isAwaitExpression(init) ? init.getExpression() : init;
  return (
    !!call &&
    Node.isCallExpression(call) &&
    (framework === 'react-i18next'
      ? Node.isObjectBindingPattern(decl.getNameNode()) &&
        call.getExpression().getText() === 'useTranslation'
      : ['useTranslations', 'getTranslations'].includes(call.getExpression().getText())) &&
    call.getArguments().length === 0
  );
}

/** Refuser les collisions plutôt que d'inférer le type d'un paramètre ou d'un alias. */
export function hasBindingConflict(fn: HostFn, sourceFile: SourceFile, hook: string): boolean {
  if (fn.getParameters().some(p => binds(p.getNameNode(), 't'))) return true;
  const existing = findTopLevelTDeclaration(fn);
  let conflict = false;
  fn.forEachDescendant(node => {
    if (node === existing) return;
    if (
      (Node.isVariableDeclaration(node) ||
        Node.isParameterDeclaration(node) ||
        Node.isFunctionDeclaration(node) ||
        Node.isClassDeclaration(node)) &&
      node.getNameNode() &&
      binds(node.getNameNode()!, 't')
    )
      conflict = true;
  });
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (
      declaration.getDefaultImport()?.getText() === hook ||
      declaration.getNamespaceImport()?.getText() === hook
    )
      conflict = true;
    for (const specifier of declaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (specifier.getName() === hook || local === hook) {
        const expectedModule =
          hook === 'useTranslation'
            ? 'react-i18next'
            : hook === 'useTranslations'
              ? 'next-intl'
              : 'next-intl/server';
        if (
          local !== hook ||
          declaration.getModuleSpecifierValue() !== expectedModule ||
          declaration.isTypeOnly() ||
          specifier.isTypeOnly()
        )
          conflict = true;
      }
    }
  }
  sourceFile.forEachDescendant(node => {
    if (
      (Node.isVariableDeclaration(node) ||
        Node.isParameterDeclaration(node) ||
        Node.isFunctionDeclaration(node) ||
        Node.isClassDeclaration(node)) &&
      node.getNameNode() &&
      binds(node.getNameNode()!, hook)
    )
      conflict = true;
  });
  return conflict;
}
