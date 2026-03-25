import { type SourceFile, SyntaxKind, Node } from 'ts-morph';

/** Type de string trouvée dans le code source. */
export type StringType =
  | 'jsx-text'
  | 'jsx-attribute'
  | 'template-literal'
  | 'template-literal-dynamic';

/** Une string traduisible extraite du code source. */
export interface ExtractedString {
  /** Valeur de la string (avec `{varName}` pour les template literals dynamiques). */
  value: string;
  type: StringType;
  filePath: string;
  /** Numéro de ligne (1-based). */
  line: number;
  /** Numéro de colonne (1-based). */
  column: number;
  /** Variables interpolées — uniquement pour 'template-literal-dynamic'. */
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

/**
 * Extrait toutes les strings traduisibles d'un SourceFile ts-morph.
 *
 * Détecte 3 types :
 * 1. Texte JSX en dur : `<p>Bonjour</p>`
 * 2. Attributs HTML traduisibles : `placeholder`, `alt`, `title`, `aria-label`
 * 3. Template literals simples et dynamiques : `` `Salut ${name}` ``
 */
export function extractStrings(sourceFile: SourceFile, filePath: string): ExtractedString[] {
  const results: ExtractedString[] = [];

  // ─── 1. Texte JSX ────────────────────────────────────────────────────────────
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const trimmed = node.getText().trim();
    if (!trimmed) continue;

    const loc = getLocation(node);
    results.push({ value: trimmed, type: 'jsx-text', filePath, ...loc });
  }

  // ─── 2. Attributs JSX traduisibles ───────────────────────────────────────────
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

  // ─── 3. Template literals sans substitution ───────────────────────────────────
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    if (isFirstArgOfTCall(node)) continue;
    const value = node.getLiteralValue();
    if (!value.trim()) continue;

    const loc = getLocation(node);
    results.push({ value: value.trim(), type: 'template-literal', filePath, ...loc });
  }

  // ─── 4. Template literals dynamiques (avec substitutions) ────────────────────
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    if (isFirstArgOfTCall(node)) continue;

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
