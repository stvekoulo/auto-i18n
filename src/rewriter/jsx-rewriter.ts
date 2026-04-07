import { type SourceFile, SyntaxKind, Node } from 'ts-morph';

function getTemplateText(node: Node): string {
  const compiler = node.compilerNode as unknown as Record<string, unknown>;
  return typeof compiler['text'] === 'string' ? compiler['text'] : '';
}

function getJsxPadding(rawText: string, trimmed: string): { leading: string; trailing: string } {
  const start = rawText.indexOf(trimmed);
  if (start < 0) return { leading: '', trailing: '' };
  const end = start + trimmed.length;
  return {
    leading: rawText.slice(0, start),
    trailing: rawText.slice(end),
  };
}

function containsUnsafeWhitespacePadding(value: string): boolean {
  return /[\r\n]/.test(value);
}

function stringifyJsxPadding(value: string): string {
  return `{${JSON.stringify(value)}}`;
}

function shouldSkipJsxTextRewrite(node: Node, leading: string, trailing: string): boolean {
  const prev = node.getPreviousSibling();
  const next = node.getNextSibling();
  const hasInlineNeighbor = Boolean(
    (prev && !Node.isJsxText(prev)) ||
    (next && !Node.isJsxText(next)),
  );

  if (!hasInlineNeighbor) return false;

  if (containsUnsafeWhitespacePadding(leading) || containsUnsafeWhitespacePadding(trailing)) {
    return true;
  }

  return (leading.length > 0 && !/^[ \t]+$/.test(leading)) || (trailing.length > 0 && !/^[ \t]+$/.test(trailing));
}

export interface UnsafeJsxTextOccurrence {
  value: string;
  line: number;
  column: number;
  reason: 'multiline_inline_spacing';
}

export function findUnsafeJsxTextOccurrences(sourceFile: SourceFile): UnsafeJsxTextOccurrence[] {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);
  const results: UnsafeJsxTextOccurrence[] = [];

  for (const node of nodes) {
    const rawText = node.getText();
    const trimmed = rawText.trim();
    if (!trimmed) continue;
    const { leading, trailing } = getJsxPadding(rawText, trimmed);
    if (!shouldSkipJsxTextRewrite(node, leading, trailing)) continue;

    results.push({
      value: trimmed,
      line: node.getStartLineNumber(),
      column: node.getStart() - node.getStartLinePos() + 1,
      reason: 'multiline_inline_spacing',
    });
  }

  return results;
}

export function rewriteJsxText(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);
  let count = 0;

  for (const node of [...nodes].reverse()) {
    const rawText = node.getText();
    const trimmed = rawText.trim();
    if (!trimmed) continue;
    const key = keyMap.get(trimmed);
    if (!key) continue;

    const { leading, trailing } = getJsxPadding(rawText, trimmed);
    if (shouldSkipJsxTextRewrite(node, leading, trailing)) continue;
    const hasInlinePadding = leading.length > 0 || trailing.length > 0;
    const prev = node.getPreviousSibling();
    const next = node.getNextSibling();
    const hasInlineNeighbor = Boolean(
      (prev && !Node.isJsxText(prev)) ||
      (next && !Node.isJsxText(next)),
    );

    const replacement = !hasInlinePadding || !hasInlineNeighbor
      ? `{t("${key}")}`
      : [
          leading ? stringifyJsxPadding(leading) : '',
          `{t("${key}")}`,
          trailing ? stringifyJsxPadding(trailing) : '',
        ].join('');

    try {
      node.replaceWithText(replacement);
      count++;
    } catch {
    }
  }

  return count;
}

export function rewriteNoSubstitutionTemplateLiterals(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  let count = 0;

  for (const node of [...nodes].reverse()) {
    const value = node.getLiteralValue().trim();
    if (!value) continue;
    const key = keyMap.get(value);
    if (!key) continue;

    // Ignore si déjà dans un appel t(...)
    const parent = node.getParent();
    if (parent && Node.isCallExpression(parent)) {
      if (/^t$|^translate$/.test(parent.getExpression().getText())) continue;
    }

    try {
      node.replaceWithText(`t("${key}")`);
      count++;
    } catch {
    }
  }

  return count;
}

export function rewriteTemplateExpressions(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression);
  let count = 0;

  for (const node of [...nodes].reverse()) {
    const parent = node.getParent();
    if (parent && Node.isCallExpression(parent)) {
      if (/^t$|^translate$/.test(parent.getExpression().getText())) continue;
    }

    let reconstructed = getTemplateText(node.getHead());
    const variables: string[] = [];

    for (const span of node.getTemplateSpans()) {
      const varExpr = span.getExpression().getText();
      variables.push(varExpr);
      reconstructed += `{${varExpr}}`;
      reconstructed += getTemplateText(span.getLiteral());
    }

    const trimmed = reconstructed.trim();
    const key = keyMap.get(trimmed);
    if (!key) continue;

    const params = buildParamsObject(variables);
    try {
      node.replaceWithText(`t("${key}", ${params})`);
      count++;
    } catch {
    }
  }

  return count;
}

function buildParamsObject(variables: string[]): string {
  const pairs = variables.map(v => {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v)) return v;
    return `"${v}": ${v}`;
  });
  return `{ ${pairs.join(', ')} }`;
}

export function rewriteJsx(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  return (
    rewriteJsxText(sourceFile, keyMap) +
    rewriteNoSubstitutionTemplateLiterals(sourceFile, keyMap) +
    rewriteTemplateExpressions(sourceFile, keyMap)
  );
}
