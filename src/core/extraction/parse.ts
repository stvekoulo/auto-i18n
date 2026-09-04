/**
 * Parsing en mémoire — pur (string → AST), aucune lecture disque.
 * La lecture de fichiers réels vit dans `src/adapters/fs`.
 */

import { ts, Project, type SourceFile } from 'ts-morph';

const COMPILER_OPTIONS = {
  allowJs: true,
  jsx: 4, // ts.JsxEmit.ReactJSX
  skipLibCheck: true,
} as const;

/** Diagnostics attachés au nœud par le parser lui-même (propriété interne à TS). */
type ParsedSourceFile = ts.SourceFile & { parseDiagnostics?: ts.DiagnosticWithLocation[] };

/**
 * Erreurs de syntaxe d'un fichier déjà parsé.
 *
 * Le parser TypeScript est tolérant : sur un fichier cassé il ne lève rien et
 * renvoie un arbre partiel dont l'extraction ressort vide. Sans ce contrôle, un
 * fichier invalide serait silencieusement compté comme « scanné, 0 string ».
 *
 * On lit les diagnostics posés par le parser sur le nœud plutôt que de passer
 * par `Program#getSyntacticDiagnostics` : construire un Program par fichier
 * multiplie le temps de scan par ~70. La propriété est interne à TypeScript,
 * d'où la lecture défensive — `tests/core/extraction` échoue si elle disparaît.
 */
export function getSyntaxErrors(sourceFile: SourceFile): string[] {
  const diagnostics = (sourceFile.compilerNode as ParsedSourceFile).parseDiagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

/** Parse un contenu source en `SourceFile` ts-morph, sans toucher au disque. */
export function parseSource(content: string, fileName = 'virtual.tsx'): SourceFile {
  const project = new Project({
    compilerOptions: COMPILER_OPTIONS,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile(fileName, content);
}
