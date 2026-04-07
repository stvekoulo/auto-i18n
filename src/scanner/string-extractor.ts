import { type SourceFile, SyntaxKind, Node } from 'ts-morph';

function getTemplateText(node: Node): string {
  const compiler = node.compilerNode as unknown as Record<string, unknown>;
  return typeof compiler['text'] === 'string' ? compiler['text'] : '';
}

export type StringType =
  | 'jsx-text'
  | 'jsx-attribute'
  | 'template-literal'
  | 'template-literal-dynamic'
  | 'string-literal';

/** Une string traduisible extraite du code source. */
export interface ExtractedString {
  value: string;
  type: StringType;
  filePath: string;
  line: number;
  column: number;
  variables?: string[];
}

export interface StringOccurrence {
  filePath: string;
  line: number;
  column: number;
  value: string;
}

export function buildOccurrenceId(occurrence: StringOccurrence): string {
  return `${occurrence.filePath}:${occurrence.line}:${occurrence.column}:${occurrence.value}`;
}

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

const NON_TRANSLATABLE_ATTRIBUTES = new Set([
  'className', 'class', 'style', 'id', 'key', 'href', 'src', 'srcSet',
  'type', 'name', 'value', 'htmlFor', 'data-testid', 'data-cy',
  'action', 'method', 'encType', 'target', 'rel', 'role',
]);

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

function isFirstArgOfTCall(node: Node): boolean {
  const parent = node.getParent();
  if (!parent || !Node.isCallExpression(parent)) return false;
  const callee = parent.getExpression().getText();
  if (!/^t$|^translate$/.test(callee)) return false;
  const args = parent.getArguments();
  return args.length > 0 && args[0] === node;
}

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


function isInNonExtractableContext(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return true;

  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return true;

  if (Node.isPropertyAssignment(parent)) {
    const propName = parent.getName();
    if (TECHNICAL_PROPERTY_NAMES.has(propName)) return true;
  }

  if (parent.getKind() === SyntaxKind.Parameter) return true;

  if (parent.getKind() === SyntaxKind.BindingElement) return true;

  if (Node.isNewExpression(parent)) return true;

  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    if (/^(console\.\w+|require|Error|JSON\.\w+|parseInt|parseFloat|fetch|addEventListener|removeEventListener)$/.test(callee)) return true;
    // CSS utility functions (shadcn/tailwind)
    if (/^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/.test(callee)) return true;
  }

  let current: Node | undefined = parent;
  while (current) {
    if (Node.isImportDeclaration(current) || Node.isExportDeclaration(current)) return true;
    if (Node.isTypeAliasDeclaration(current) || Node.isInterfaceDeclaration(current)) return true;
    if (Node.isEnumDeclaration(current)) return true;
    // JSX attribute — handled separately by attribute extractor
    if (Node.isJsxAttribute(current)) return true;
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression().getText();
      if (/^(cva|cn|clsx|twMerge|classNames|classnames|css|styled|tv)$/.test(callee)) return true;
    }
    current = current.getParent();
  }

  return false;
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
    let reconstructed = getTemplateText(node.getHead());

    for (const span of node.getTemplateSpans()) {
      const varExpr = span.getExpression().getText();
      variables.push(varExpr);
      reconstructed += `{${varExpr}}`;
      reconstructed += getTemplateText(span.getLiteral());
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

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (isFirstArgOfTCall(node)) continue;
    if (isInNonExtractableContext(node)) continue;

    const value = node.getLiteralValue().trim();
    if (!value) continue;

    const loc = getLocation(node);
    results.push({ value, type: 'string-literal', filePath, ...loc });
  }

  return results;
}
