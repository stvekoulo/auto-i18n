import { type SourceFile, SyntaxKind, Node } from 'ts-morph';

function getTemplateText(node: Node): string {
  const compiler = node.compilerNode as unknown as Record<string, unknown>;
  return typeof compiler['text'] === 'string' ? compiler['text'] : '';
}

/**
 * Remplace les noeuds JsxText traduisibles par {t("clé")}.
 * Traite les noeuds en ordre inverse pour préserver les positions.
 * Retourne le nombre de remplacements effectués.
 */
export function rewriteJsxText(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);
  let count = 0;

  for (const node of [...nodes].reverse()) {
    const trimmed = node.getText().trim();
    if (!trimmed) continue;
    const key = keyMap.get(trimmed);
    if (!key) continue;

    try {
      node.replaceWithText(`{t("${key}")}`);
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

/**
 * Remplace les template literals dynamiques (`Salut ${name}`) par t("clé", { name }).
 * Ignore ceux déjà à l'intérieur d'un appel t(...).
 */
export function rewriteTemplateExpressions(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const nodes = sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression);
  let count = 0;

  for (const node of [...nodes].reverse()) {
    // Ignore si déjà dans un appel t(...)
    const parent = node.getParent();
    if (parent && Node.isCallExpression(parent)) {
      if (/^t$|^translate$/.test(parent.getExpression().getText())) continue;
    }

    // Reconstruit la valeur avec placeholders {varName} (même logique que le scanner)
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

/**
 * Construit l'objet de paramètres pour t().
 * Variables simples : shorthand { name } ; expressions complexes : { "user.name": user.name }.
 */
function buildParamsObject(variables: string[]): string {
  const pairs = variables.map(v => {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(v)) return v;
    return `"${v}": ${v}`;
  });
  return `{ ${pairs.join(', ')} }`;
}

/** Applique toutes les réécritures JSX. Retourne le nombre total de remplacements. */
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
