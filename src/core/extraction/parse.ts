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
