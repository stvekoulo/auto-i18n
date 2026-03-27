import {
  type SourceFile,
  SyntaxKind,
  Node,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type VariableStatement,
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
]);

/**
 * Vérifie si un StringLiteral est dans un contexte non réécrivable.
 */
function isNonRewritableContext(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return true;

  // Clé de propriété (pas la valeur)
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return true;

  // Valeur d'une propriété technique
  if (Node.isPropertyAssignment(parent)) {
    const propName = parent.getName();
    if (TECHNICAL_PROPERTY_NAMES.has(propName)) return true;
  }

  // new Error(), etc.
  if (Node.isNewExpression(parent)) return true;

  // console.*, require(), etc.
  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    if (/^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|addEventListener|removeEventListener)$/.test(callee)) return true;
    if (/^t$|^translate$/.test(callee)) return true;
  }

  // Remonter l'arbre
  let current: Node | undefined = parent;
  while (current) {
    if (Node.isImportDeclaration(current) || Node.isExportDeclaration(current)) return true;
    if (Node.isTypeAliasDeclaration(current) || Node.isInterfaceDeclaration(current)) return true;
    if (Node.isEnumDeclaration(current)) return true;
    if (Node.isJsxAttribute(current)) return true;
    current = current.getParent();
  }

  return false;
}

/**
 * Remplace les StringLiteral traduisibles par t("clé").
 * Cible les valeurs dans les objets/tableaux/variables (hors JSX, déjà géré).
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

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/** Vérifie si un nœud a une fonction parente. */
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
 * Trouve la fonction composant React (default export ou première fonction avec du JSX).
 */
function findComponentFunction(sourceFile: SourceFile): FunctionLike | null {
  // 1. Chercher un default export function
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isDefaultExport()) return fn;
  }

  // 2. Chercher une variable déclarée avec default export et arrow/function expression
  const defaultExport = sourceFile
    .getDescendantsOfKind(SyntaxKind.ExportAssignment)
    .find(e => !e.isExportEquals());

  if (defaultExport) {
    const expr = defaultExport.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      const varDecl = sourceFile.getVariableDeclaration(name);
      if (varDecl) {
        const init = varDecl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          return init;
        }
      }
      // Named function declaration
      const fn = sourceFile.getFunction(name);
      if (fn) return fn;
    }
  }

  // 3. Première fonction qui contient du JSX
  for (const fn of sourceFile.getFunctions()) {
    if (
      fn.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
      fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
    ) {
      return fn;
    }
  }

  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const init = varDecl.getInitializer();
    if (!init) continue;
    if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;
    if (
      init.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
      init.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
    ) {
      return init;
    }
  }

  return null;
}

/**
 * Déplace les VariableStatement du scope module qui contiennent des appels t()
 * à l'intérieur du corps de la fonction composant React.
 *
 * Cela garantit que t() est accessible (injecté ensuite par injectTDeclarations).
 */
export function hoistModuleScopeVars(sourceFile: SourceFile): number {
  // Trouver tous les t() calls au scope module (pas de fonction parente)
  const tCalls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText() === 't' && !hasEnclosingFunction(c));

  if (tCalls.length === 0) return 0;

  // Identifier les VariableStatement parents de ces appels
  const statementsToMove = new Map<number, VariableStatement>();
  for (const call of tCalls) {
    let current: Node | undefined = call.getParent();
    while (current) {
      if (Node.isVariableStatement(current)) {
        statementsToMove.set(current.getStart(), current);
        break;
      }
      if (Node.isSourceFile(current)) break;
      current = current.getParent();
    }
  }

  if (statementsToMove.size === 0) return 0;

  // Trouver la fonction composant
  const componentFn = findComponentFunction(sourceFile);
  if (!componentFn) return 0;

  const bodyNode = componentFn.getBody();
  if (!bodyNode || !Node.isBlock(bodyNode)) return 0;

  // Récupérer le texte des statements à déplacer (en ordre de position)
  const sorted = [...statementsToMove.entries()].sort(([a], [b]) => a - b);
  const texts = sorted.map(([, stmt]) => stmt.getText());

  // Supprimer les statements originaux (en ordre inverse pour préserver les positions)
  for (const [, stmt] of [...sorted].reverse()) {
    stmt.remove();
  }

  // Insérer dans le corps du composant (position 0 — avant le reste)
  bodyNode.insertStatements(0, texts);

  return texts.length;
}
