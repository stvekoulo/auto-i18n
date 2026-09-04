/**
 * Parsing en mémoire — pur (string → AST), aucune lecture disque.
 * La lecture de fichiers réels vit dans `src/adapters/fs`.
 */

import { Project, type SourceFile } from 'ts-morph';

const COMPILER_OPTIONS = {
  allowJs: true,
  jsx: 4, // ts.JsxEmit.ReactJSX
  skipLibCheck: true,
} as const;

/**
 * Erreurs de syntaxe d'un fichier déjà parsé.
 *
 * Le parser TypeScript est tolérant : sur un fichier cassé il ne lève rien et
 * renvoie un arbre partiel dont l'extraction ressort vide. Sans ce contrôle,
 * un fichier invalide serait silencieusement compté comme « scanné, 0 string ».
 * Diagnostics syntaxiques uniquement — aucun type-check.
 */
export function getSyntaxErrors(sourceFile: SourceFile): string[] {
  return sourceFile
    .getProject()
    .getProgram()
    .getSyntacticDiagnostics(sourceFile)
    .map(d => {
      const message = d.getMessageText();
      return typeof message === 'string' ? message : message.getMessageText();
    });
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
