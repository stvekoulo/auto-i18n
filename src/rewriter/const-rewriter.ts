import {
  type SourceFile,
  SyntaxKind,
  Node,
} from 'ts-morph';

/**
 * Noms de propriétés dont les valeurs sont techniques — on ne les réécrit pas.
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

/** Vérifie si un nœud est à l'intérieur d'un corps de fonction. */
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

/**
 * Vérifie si un StringLiteral est dans un contexte non réécrivable.
 */
function isNonRewritableContext(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return true;

  // ── Ne jamais réécrire au module-scope (t() inaccessible) ──
  if (!hasEnclosingFunction(node)) return true;

  // Clé de propriété (pas la valeur)
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return true;

  // Valeur d'une propriété technique
  if (Node.isPropertyAssignment(parent)) {
    const propName = parent.getName();
    if (TECHNICAL_PROPERTY_NAMES.has(propName)) return true;
  }

  // Valeur par défaut d'un paramètre : function foo(x = "default")
  if (parent.getKind() === SyntaxKind.Parameter) return true;

  // Valeur par défaut de destructuring : const { x = "default" } = props
  if (parent.getKind() === SyntaxKind.BindingElement) return true;

  // new Error(), etc.
  if (Node.isNewExpression(parent)) return true;

  // Appels à des fonctions techniques ou CSS utilities
  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    if (/^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|addEventListener|removeEventListener)$/.test(callee)) return true;
    if (/^t$|^translate$/.test(callee)) return true;
    // CSS utility functions (shadcn/tailwind)
    if (/^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/.test(callee)) return true;
  }

  // Arguments d'un appel à cva/cn/clsx (peut être imbriqué)
  let current: Node | undefined = parent;
  while (current) {
    if (Node.isImportDeclaration(current) || Node.isExportDeclaration(current)) return true;
    if (Node.isTypeAliasDeclaration(current) || Node.isInterfaceDeclaration(current)) return true;
    if (Node.isEnumDeclaration(current)) return true;
    if (Node.isJsxAttribute(current)) return true;
    // Remonter les appels cva/cn imbriqués
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression().getText();
      if (/^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/.test(callee)) return true;
    }
    current = current.getParent();
  }

  return false;
}

/**
 * Remplace les StringLiteral traduisibles par t("clé").
 * Ne touche QUE les strings à l'intérieur de fonctions (pas module-scope).
 * Retourne le nombre de remplacements effectués.
 */
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
      // Skip nodes that can't be safely replaced
    }
  }

  return count;
}
