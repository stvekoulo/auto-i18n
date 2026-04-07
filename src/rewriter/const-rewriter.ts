import {
  type SourceFile,
  SyntaxKind,
  Node,
} from 'ts-morph';

/**
 * Noms de propriétés dont les valeurs sont techniques
 */
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

function isNonRewritableContext(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return true;

  if (!hasEnclosingFunction(node)) return true;

  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return true;

  if (Node.isPropertyAssignment(parent)) {
    const propName = parent.getName();
    if (TECHNICAL_PROPERTY_NAMES.has(propName)) return true;
  }

  if (parent.getKind() === SyntaxKind.Parameter) return true;

  if (parent.getKind() === SyntaxKind.BindingElement) return true;

  // new Error(), etc.
  if (Node.isNewExpression(parent)) return true;

  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    if (/^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|addEventListener|removeEventListener)$/.test(callee)) return true;
    if (/^t$|^translate$/.test(callee)) return true;
    // CSS utility functions (shadcn/tailwind)
    if (/^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/.test(callee)) return true;
  }

  let current: Node | undefined = parent;
  while (current) {
    if (Node.isImportDeclaration(current) || Node.isExportDeclaration(current)) return true;
    if (Node.isTypeAliasDeclaration(current) || Node.isInterfaceDeclaration(current)) return true;
    if (Node.isEnumDeclaration(current)) return true;
    if (Node.isJsxAttribute(current)) return true;
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression().getText();
      if (/^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/.test(callee)) return true;
    }
    current = current.getParent();
  }

  return false;
}

export interface ModuleScopeString {
  value: string;
  key: string;
  line: number;
  column: number;
}

export function findModuleScopeStrings(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): ModuleScopeString[] {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral);
  const results: ModuleScopeString[] = [];

  for (const node of nodes) {
    if (hasEnclosingFunction(node)) continue;

    const parent = node.getParent();
    if (!parent) continue;

    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) continue;
    if (Node.isPropertyAssignment(parent) && TECHNICAL_PROPERTY_NAMES.has(parent.getName())) continue;
    if (Node.isNewExpression(parent)) continue;
    if (Node.isCallExpression(parent)) {
      const callee = parent.getExpression().getText();
      if (/^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv|t|translate)$/.test(callee)) continue;
    }

    let skip = false;
    let current: Node | undefined = parent;
    while (current) {
      if (Node.isImportDeclaration(current) || Node.isExportDeclaration(current)) { skip = true; break; }
      if (Node.isTypeAliasDeclaration(current) || Node.isInterfaceDeclaration(current)) { skip = true; break; }
      if (Node.isEnumDeclaration(current)) { skip = true; break; }
      current = current.getParent();
    }
    if (skip) continue;

    const value = node.getLiteralValue().trim();
    if (!value) continue;

    const key = keyMap.get(value);
    if (!key) continue;

    results.push({
      value,
      key,
      line: node.getStartLineNumber(),
      column: node.getStart() - node.getStartLinePos() + 1,
    });
  }

  return results;
}

export function rewriteStringLiterals(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral);
  let count = 0;

  for (const node of [...nodes].reverse()) {
    if (isNonRewritableContext(node)) continue;

    const value = node.getLiteralValue().trim();
    if (!value) continue;
    const key = keyMap.get(value);
    if (!key) continue;

    try {
      node.replaceWithText(`t("${key}")`);
      count++;
    } catch {
    }
  }

  return count;
}
