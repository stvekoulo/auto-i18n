/**
 * Calcul de l'insertion d'import pour `sync --write` (en ignorant les `import type`).
 */

import ts from 'typescript';

export type WriteKind = 'client' | 'server_async' | 'react';

export interface ImportEdit {
  start: number;
  end: number;
  replacement: string;
}

function leadingInsertOffset(sourceFile: ts.SourceFile): number {
  const first = sourceFile.statements[0];
  if (
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    (first.expression.text === 'use client' || first.expression.text === 'use server')
  ) {
    return first.getEnd();
  }
  return 0;
}

export function buildImportEdit(sourceFile: ts.SourceFile, kind: WriteKind): ImportEdit | null {
  const moduleSpecifier =
    kind === 'react' ? 'react-i18next' : kind === 'client' ? 'next-intl' : 'next-intl/server';
  const importName =
    kind === 'react' ? 'useTranslation' : kind === 'client' ? 'useTranslations' : 'getTranslations';

  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const existing = imports.find(
    d =>
      ts.isStringLiteral(d.moduleSpecifier) &&
      d.moduleSpecifier.text === moduleSpecifier &&
      !d.importClause?.isTypeOnly,
  );

  if (
    existing?.importClause?.namedBindings &&
    ts.isNamedImports(existing.importClause.namedBindings)
  ) {
    const elements = existing.importClause.namedBindings.elements;
    if (elements.some(el => !el.isTypeOnly && el.name.text === importName)) return null;
    if (elements.length > 0) {
      const last = elements[elements.length - 1];
      return { start: last.getEnd(), end: last.getEnd(), replacement: `, ${importName}` };
    }
  }

  const firstImport = imports[0];
  const insertAt = firstImport ? firstImport.getStart(sourceFile) : leadingInsertOffset(sourceFile);
  const prefix = insertAt > 0 && firstImport === undefined ? '\n' : '';
  return {
    start: insertAt,
    end: insertAt,
    replacement: `${prefix}import { ${importName} } from '${moduleSpecifier}';\n`,
  };
}
