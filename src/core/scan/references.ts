import ts from 'typescript';

/** Indices conservateurs : une clé mentionnée littéralement ne doit pas être purgée. */
export interface CatalogReferences {
  literals: string[];
  dynamic: boolean;
}

export interface TranslationBindingsInfo {
  translators: Set<string>;
  factories: Set<string>;
  /** Nom local du traducteur → namespace statique éventuel (ex. `t` → `'Header'`). */
  namespaces: Map<string, string>;
}

export function translationBindings(sourceFile: ts.SourceFile): TranslationBindingsInfo {
  const translators = new Set(['t', 'translate']);
  const factories = new Set(['useTranslations', 'getTranslations', 'useTranslation', 'getFixedT']);
  const namespaces = new Map<string, string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue;
    if (!ts.isNamedImports(stmt.importClause.namedBindings)) continue;
    for (const specifier of stmt.importClause.namedBindings.elements) {
      const imported = (specifier.propertyName ?? specifier.name).text;
      if (factories.has(imported)) {
        factories.add(specifier.name.text);
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isCallExpression(init) && factories.has(init.expression.getText(sourceFile))) {
        const nsArg = init.arguments[0];
        const ns =
          nsArg && (ts.isStringLiteral(nsArg) || ts.isNoSubstitutionTemplateLiteral(nsArg))
            ? nsArg.text
            : undefined;
        if (ts.isIdentifier(node.name)) {
          translators.add(node.name.text);
          if (ns) namespaces.set(node.name.text, ns);
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const prop = element.propertyName
              ? element.propertyName.getText(sourceFile)
              : element.name.getText(sourceFile);
            if (prop === 't' && ts.isIdentifier(element.name)) {
              translators.add(element.name.text);
              if (ns) namespaces.set(element.name.text, ns);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { translators, factories, namespaces };
}

export function isTranslationCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  bindings: TranslationBindingsInfo,
): boolean {
  const callee = call.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.expression.getText(sourceFile)
    : callee.getText(sourceFile);
  return (
    bindings.translators.has(name) ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

export function collectCatalogReferences(sourceFile: ts.SourceFile): CatalogReferences {
  const literals = new Set<string>();
  const bindings = translationBindings(sourceFile);
  let dynamic = false;

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.add(node.text);
    }
    if (ts.isCallExpression(node) && isTranslationCall(node, sourceFile, bindings)) {
      const key = node.arguments[0];
      if (!key || (!ts.isStringLiteral(key) && !ts.isNoSubstitutionTemplateLiteral(key))) {
        dynamic = true;
      } else {
        const callee = node.expression;
        const tName = ts.isPropertyAccessExpression(callee)
          ? callee.expression.getText(sourceFile)
          : callee.getText(sourceFile);
        const ns = bindings.namespaces.get(tName);
        if (ns) literals.add(`${ns}.${key.text}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { literals: [...literals], dynamic };
}
