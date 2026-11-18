/**
 * Parsing AST en mémoire via le compilateur officiel `typescript` — pur (string → AST),
 * aucune lecture disque et zéro dépendance transitive.
 */

import ts from 'typescript';

export type SourceFile = ts.SourceFile;

type ParsedSourceFile = ts.SourceFile & { parseDiagnostics?: ts.DiagnosticWithLocation[] };

function scriptKindFor(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.TSX;
}

/**
 * Erreurs de syntaxe d'un fichier déjà parsé.
 *
 * Le parser TypeScript est tolérant : sur un fichier cassé il ne lève rien et
 * attache les diagnostics syntaxiques directement sur le `SourceFile`.
 */
export function getSyntaxErrors(sourceFile: ts.SourceFile): string[] {
  const diagnostics = (sourceFile as ParsedSourceFile).parseDiagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

/** Parse un contenu source en `ts.SourceFile` avec parents chaînés, sans toucher au disque. */
export function parseSource(content: string, fileName = 'virtual.tsx'): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
}

/** Position 1-based (ligne, colonne) du début significatif d'un nœud AST. */
export function locationOf(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
}
