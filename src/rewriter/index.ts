import { copyFile } from 'fs/promises';
import {
  Project,
  SyntaxKind,
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph';
import { rewriteJsx } from './jsx-rewriter.js';
import { rewriteAttributes } from './attr-rewriter.js';

export interface RewriteOptions {
  /** Mapping { valeur originale → clé i18n } produit par le generator. */
  keyMap: Map<string, string>;
  /** Supprime les logs terminal. */
  silent?: boolean;
}

export interface RewriteResult {
  filesModified: number;
  filesSkipped: number;
  totalReplaced: number;
}

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * Retourne `true` si le fichier contient une directive `'use client'` en tête.
 * Les Server Components n'ont pas cette directive.
 */
export function isClientComponent(sourceFile: SourceFile): boolean {
  const first = sourceFile.getStatements()[0];
  if (!first) return false;
  if (Node.isExpressionStatement(first)) {
    const expr = first.getExpression();
    if (Node.isStringLiteral(expr) && expr.getLiteralValue() === 'use client') {
      return true;
    }
  }
  return false;
}

/** Remonte l'AST pour trouver la fonction englobante la plus proche. */
function findEnclosingFunction(node: Node): FunctionLike | null {
  let current = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current)
    ) {
      return current as FunctionLike;
    }
    current = current.getParent();
  }
  return null;
}

export function injectTDeclarations(sourceFile: SourceFile, isClient: boolean): void {
  const tCalls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText() === 't');

  const toProcess = new Map<number, FunctionLike>();

  for (const call of tCalls) {
    const func = findEnclosingFunction(call);
    if (!func) continue;

    const bodyNode = func.getBody();
    if (!bodyNode || !Node.isBlock(bodyNode)) continue;

    const alreadyDeclared = bodyNode
      .getStatements()
      .some(s => /\bconst t\b/.test(s.getText()));
    if (alreadyDeclared) continue;

    toProcess.set(func.getStart(), func);
  }

  const sorted = [...toProcess.entries()].sort(([a], [b]) => b - a);

  for (const [, func] of sorted) {
    const bodyNode = func.getBody();
    if (!bodyNode || !Node.isBlock(bodyNode)) continue;

    const decl = isClient
      ? 'const t = useTranslations();'
      : 'const t = await getTranslations();';

    bodyNode.insertStatements(0, decl);

    // Server Component : la fonction doit être async pour `await getTranslations()`
    if (!isClient) {
      func.setIsAsync(true);
    }
  }
}

export function addNextIntlImport(sourceFile: SourceFile, isClient: boolean): void {
  const moduleSpecifier = isClient ? 'next-intl' : 'next-intl/server';
  const namedImport = isClient ? 'useTranslations' : 'getTranslations';

  const existing = sourceFile.getImportDeclaration(
    i => i.getModuleSpecifierValue() === moduleSpecifier,
  );

  if (existing) {
    const hasNamed = existing.getNamedImports().some(n => n.getName() === namedImport);
    if (!hasNamed) existing.addNamedImport(namedImport);
  } else {
    sourceFile.addImportDeclaration({ moduleSpecifier, namedImports: [namedImport] });
  }
}

/**
 * Applique toutes les réécritures sur un SourceFile (sans I/O disque).
 * Retourne le nombre total de strings remplacées.
 */
export function rewriteSourceFile(
  sourceFile: SourceFile,
  keyMap: Map<string, string>,
): number {
  const jsxCount = rewriteJsx(sourceFile, keyMap);
  const attrCount = rewriteAttributes(sourceFile, keyMap);
  const total = jsxCount + attrCount;

  if (total > 0) {
    const isClient = isClientComponent(sourceFile);
    injectTDeclarations(sourceFile, isClient);
    addNextIntlImport(sourceFile, isClient);
  }

  return total;
}

export async function rewriteFiles(
  filePaths: string[],
  options: RewriteOptions,
): Promise<RewriteResult> {
  const { keyMap, silent = false } = options;

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 4, skipLibCheck: true },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  let filesModified = 0;
  let filesSkipped = 0;
  let totalReplaced = 0;

  for (const filePath of filePaths) {
    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      const replaced = rewriteSourceFile(sourceFile, keyMap);

      if (replaced === 0) {
        filesSkipped++;
        if (!silent) console.log(`  — ${filePath} — aucune modification nécessaire`);
        project.removeSourceFile(sourceFile);
        continue;
      }

      await copyFile(filePath, `${filePath}.backup`);
      await sourceFile.save();

      filesModified++;
      totalReplaced += replaced;

      if (!silent) {
        const s = replaced > 1 ? 's' : '';
        console.log(`  ✓ ${filePath} — ${replaced} string${s} remplacée${s}`);
      }

      project.removeSourceFile(sourceFile);
    } catch (err) {
      filesSkipped++;
      if (!silent) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ⚠ ${filePath} — erreur, fichier ignoré (${msg})`);
      }
    }
  }

  if (!silent) {
    console.log(
      `\n${totalReplaced} strings remplacées dans ${filesModified} fichier${filesModified > 1 ? 's' : ''}`,
    );
    if (filesModified > 0) console.log('Backups disponibles dans *.backup');
  }

  return { filesModified, filesSkipped, totalReplaced };
}
