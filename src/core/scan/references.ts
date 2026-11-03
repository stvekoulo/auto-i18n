import { Node, type SourceFile, type CallExpression } from 'ts-morph';

/** Indices conservateurs : une clé mentionnée littéralement ne doit pas être purgée. */
export interface CatalogReferences {
  literals: string[];
  dynamic: boolean;
}

export function translationBindings(sourceFile: SourceFile) {
  const translators = new Set(['t', 'translate']);
  const factories = new Set(['useTranslations', 'getTranslations', 'useTranslation', 'getFixedT']);
  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const specifier of declaration.getNamedImports()) {
      if (factories.has(specifier.getName())) {
        factories.add(specifier.getAliasNode()?.getText() ?? specifier.getName());
      }
    }
  }
  sourceFile.forEachDescendant(node => {
    if (!Node.isVariableDeclaration(node)) return;
    const init = node.getInitializer();
    const call = init && Node.isAwaitExpression(init) ? init.getExpression() : init;
    if (call && Node.isCallExpression(call) && factories.has(call.getExpression().getText())) {
      const name = node.getNameNode();
      if (Node.isIdentifier(name)) translators.add(name.getText());
      else if (Node.isObjectBindingPattern(name)) {
        for (const element of name.getElements()) {
          if ((element.getPropertyNameNode()?.getText() ?? element.getName()) === 't') {
            translators.add(element.getName());
          }
        }
      }
    }
  });
  return { translators, factories };
}

export function isTranslationCall(
  call: CallExpression,
  bindings: ReturnType<typeof translationBindings>,
): boolean {
  const callee = call.getExpression();
  const name = Node.isPropertyAccessExpression(callee)
    ? callee.getExpression().getText()
    : callee.getText();
  return (
    bindings.translators.has(name) ||
    (Node.isPropertyAccessExpression(callee) && callee.getName() === 't')
  );
}

export function collectCatalogReferences(sourceFile: SourceFile): CatalogReferences {
  const literals = new Set<string>();
  const bindings = translationBindings(sourceFile);
  let dynamic = false;
  sourceFile.forEachDescendant(node => {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      literals.add(node.getLiteralValue());
    }
    if (!Node.isCallExpression(node)) return;
    if (!isTranslationCall(node, bindings)) return;
    const key = node.getArguments()[0];
    if (!key || (!Node.isStringLiteral(key) && !Node.isNoSubstitutionTemplateLiteral(key))) {
      dynamic = true;
    }
  });
  return { literals: [...literals], dynamic };
}
