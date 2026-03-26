import { type SourceFile, SyntaxKind, Node } from 'ts-morph';

/** Type de string trouvée dans le code source. */
export type StringType =
  | 'jsx-text'
  | 'jsx-attribute'
  | 'template-literal'
  | 'template-literal-dynamic';

/** Une string traduisible extraite du code source. */
export interface ExtractedString {
  value: string;
  type: StringType;
  filePath: string;
  line: number;
  column: number;
  variables?: string[];
}

/**
 * Attributs JSX dont la valeur string est considérée traduisible.
 * Exporté pour être réutilisé par le module rewriter.
 */
export const TRANSLATABLE_ATTRIBUTES = new Set([
  'placeholder',
  'alt',
  'title',
  'aria-label',
  'aria-placeholder',
  'aria-description',
  'aria-details',
  'label',
  'content',
]);

/** Attributs JSX dont la valeur NE doit PAS être traduite (CSS, technique). */
const NON_TRANSLATABLE_ATTRIBUTES = new Set([
  'className', 'class', 'style', 'id', 'key', 'href', 'src', 'srcSet',
  'type', 'name', 'value', 'htmlFor', 'data-testid', 'data-cy',
  'action', 'method', 'encType', 'target', 'rel', 'role',
]);

/**
 * Vérifie si un nœud est à l'intérieur d'un attribut JSX non traduisible
 * (className, style, id, etc.).
 */
function isInsideNonTranslatableAttribute(node: Node): boolean {
  let current = node.getParent();
  while (current) {
    if (Node.isJsxAttribute(current)) {
      const name = current.getNameNode().getText();
      return NON_TRANSLATABLE_ATTRIBUTES.has(name) || !TRANSLATABLE_ATTRIBUTES.has(name);
    }
    if (Node.isJsxElement(current) || Node.isJsxSelfClosingElement(current)) break;
    current = current.getParent();
  }
  return false;
}

/**
 * Vérifie si un nœud est le premier argument d'un appel à `t(...)`.
 * Permet d'ignorer les strings déjà traduites.
 */
function isFirstArgOfTCall(node: Node): boolean {
  const parent = node.getParent();
  if (!parent || !Node.isCallExpression(parent)) return false;
  const callee = parent.getExpression().getText();
  if (!/^t$|^translate$/.test(callee)) return false;
  const args = parent.getArguments();
  return args.length > 0 && args[0] === node;
}

function getLocation(node: Node) {
  return {
    line: node.getStartLineNumber(),
    column: node.getStart() - node.getStartLinePos() + 1,
  };
}

export function extractStrings(sourceFile: SourceFile, filePath: string): ExtractedString[] {
  const results: ExtractedString[] = [];

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const trimmed = node.getText().trim();
    if (!trimmed) continue;

    const loc = getLocation(node);
    results.push({ value: trimmed, type: 'jsx-text', filePath, ...loc });
  }

  for (const attr of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const attrName = attr.getNameNode().getText();
    if (!TRANSLATABLE_ATTRIBUTES.has(attrName)) continue;

    const initializer = attr.getInitializer();
    if (!initializer) continue;

    let value: string | null = null;
    let targetNode: Node = initializer;

    if (Node.isStringLiteral(initializer)) {
      // placeholder="Chercher"
      value = initializer.getLiteralValue();
      targetNode = initializer;
    } else if (Node.isJsxExpression(initializer)) {
      // placeholder={"Chercher"}
      const inner = initializer.getExpression();
      if (inner && Node.isStringLiteral(inner)) {
        value = inner.getLiteralValue();
        targetNode = inner;
      }
    }

    if (!value?.trim()) continue;

    const loc = getLocation(targetNode);
    results.push({ value: value.trim(), type: 'jsx-attribute', filePath, ...loc });
  }

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    if (isFirstArgOfTCall(node)) continue;
    if (isInsideNonTranslatableAttribute(node)) continue;
    const value = node.getLiteralValue();
    if (!value.trim()) continue;

    const loc = getLocation(node);
    results.push({ value: value.trim(), type: 'template-literal', filePath, ...loc });
  }

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    if (isFirstArgOfTCall(node)) continue;
    if (isInsideNonTranslatableAttribute(node)) continue;

    const variables: string[] = [];
    // getLiteralValue() retourne le texte brut du segment (compilerNode.text)
    let reconstructed = (node.getHead().compilerNode as unknown as { text: string }).text;

    for (const span of node.getTemplateSpans()) {
      const varExpr = span.getExpression().getText();
      variables.push(varExpr);
      reconstructed += `{${varExpr}}`;
      reconstructed += (span.getLiteral().compilerNode as unknown as { text: string }).text;
    }

    const trimmed = reconstructed.trim();
    if (!trimmed) continue;

    const loc = getLocation(node);
    results.push({
      value: trimmed,
      type: 'template-literal-dynamic',
      filePath,
      ...loc,
      variables,
    });
  }

  return results;
}
