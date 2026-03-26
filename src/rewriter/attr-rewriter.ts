import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import { TRANSLATABLE_ATTRIBUTES } from '../scanner/string-extractor.js';

export function rewriteAttributes(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const attrs = sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute);
  let count = 0;

  for (const attr of [...attrs].reverse()) {
    const attrName = attr.getNameNode().getText();
    if (!TRANSLATABLE_ATTRIBUTES.has(attrName)) continue;

    const initializer = attr.getInitializer();
    if (!initializer) continue;

    let value: string | null = null;

    if (Node.isStringLiteral(initializer)) {
      // placeholder="Chercher"
      value = initializer.getLiteralValue().trim();
    } else if (Node.isJsxExpression(initializer)) {
      // placeholder={"Chercher"}  — déjà expression mais string literal
      const inner = initializer.getExpression();
      if (inner && Node.isStringLiteral(inner)) {
        value = inner.getLiteralValue().trim();
      }
      // Si inner est déjà un CallExpression t(...), on ignore
    }

    if (!value) continue;
    const key = keyMap.get(value);
    if (!key) continue;

    try {
      initializer.replaceWithText(`{t("${key}")}`);
      count++;
    } catch {
      // Skip attributes that can't be safely replaced
    }
  }

  return count;
}
