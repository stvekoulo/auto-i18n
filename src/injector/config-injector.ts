import { copyFile, access } from 'fs/promises';
import { join } from 'path';
import { Project, SyntaxKind } from 'ts-morph';

export interface ConfigInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
}

const COMPILER_OPTIONS = { allowJs: true, skipLibCheck: true } as const;

/** Cherche next.config.ts, next.config.mjs ou next.config.js. */
export async function findNextConfig(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    join(projectRoot, 'next.config.ts'),
    join(projectRoot, 'next.config.mjs'),
    join(projectRoot, 'next.config.js'),
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* non trouvé */
    }
  }
  return null;
}

export async function injectNextConfig(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<ConfigInjectorResult> {
  const filePath = await findNextConfig(projectRoot);
  if (!filePath) throw new Error('Fichier next.config introuvable dans le projet');

  const project = new Project({
    compilerOptions: COMPILER_OPTIONS,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sf = project.addSourceFileAtPath(filePath);

  if (sf.getFullText().includes('withNextIntl')) {
    if (!options.silent) console.log(`  — ${filePath} — déjà configuré`);
    return { modified: false, skipped: true, filePath };
  }

  const defaultExport = sf
    .getDescendantsOfKind(SyntaxKind.ExportAssignment)
    .find(e => !e.isExportEquals());

  if (!defaultExport) throw new Error('export default introuvable dans next.config');

  const expr = defaultExport.getExpression();
  expr.replaceWithText(`withNextIntl(${expr.getText()})`);

  sf.addImportDeclaration({
    moduleSpecifier: 'next-intl/plugin',
    defaultImport: 'createNextIntlPlugin',
  });

  const importCount = sf.getImportDeclarations().length;
  sf.insertStatements(importCount, 'const withNextIntl = createNextIntlPlugin()');

  await copyFile(filePath, `${filePath}.backup`);
  await sf.save();

  if (!options.silent) console.log(`  ✓ ${filePath} — createNextIntlPlugin configuré`);
  return { modified: true, skipped: false, filePath };
}
