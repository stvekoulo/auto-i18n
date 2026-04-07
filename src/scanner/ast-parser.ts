import { Project, type SourceFile } from 'ts-morph';
import { parse as babelParse } from '@babel/parser';
import type { File as BabelFile } from '@babel/types';
import { readFileSync } from 'fs';

const COMPILER_OPTIONS = {
  allowJs: true,
  jsx: 4,
  skipLibCheck: true,
} as const;

let _sharedProject: Project | null = null;

function getSharedProject(): Project {
  if (!_sharedProject) {
    _sharedProject = new Project({
      compilerOptions: COMPILER_OPTIONS,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }
  return _sharedProject;
}

export function parseFile(filePath: string): SourceFile {
  const project = getSharedProject();
  const existing = project.getSourceFile(filePath);
  if (existing) return existing;
  return project.addSourceFileAtPath(filePath);
}

export function parseSource(content: string, filePath: string = 'virtual.tsx'): SourceFile {
  const project = new Project({
    compilerOptions: COMPILER_OPTIONS,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile(filePath, content);
}

/**
 * Fallback sur @babel/parser pour les projets JS purs (sans TypeScript).
 */
export function parseBabelFallback(filePath: string): BabelFile {
  const content = readFileSync(filePath, 'utf-8');
  return babelParse(content, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  });
}

export function resetSharedProject(): void {
  _sharedProject = null;
}
