import { copyFile, access } from 'fs/promises';
import { join } from 'path';
import { Project, SyntaxKind, Node, type SourceFile } from 'ts-morph';

export interface LayoutInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
}

const COMPILER_OPTIONS = { allowJs: true, jsx: 4, skipLibCheck: true } as const;

/** Cherche le fichier layout dans app/ ou src/app/. */
export async function findLayoutFile(projectRoot: string): Promise<string | null> {
  for (const candidate of [
    join(projectRoot, 'app', 'layout.tsx'),
    join(projectRoot, 'src', 'app', 'layout.tsx'),
    join(projectRoot, 'app', 'layout.jsx'),
    join(projectRoot, 'src', 'app', 'layout.jsx'),
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

/** Trouve la fonction qui contient {children} en JSX (la fonction layout). */
function findLayoutFunction(sf: SourceFile) {
  // FunctionDeclaration (export default function RootLayout)
  for (const fn of sf.getFunctions()) {
    const hasChildren = fn
      .getDescendantsOfKind(SyntaxKind.JsxExpression)
      .some(e => e.getExpression()?.getText().trim() === 'children');
    if (hasChildren) return fn;
  }
  // Arrow function dans une VariableDeclaration
  for (const varDecl of sf.getVariableDeclarations()) {
    const init = varDecl.getInitializer();
    if (!init) continue;
    if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;
    const hasChildren = init
      .getDescendantsOfKind(SyntaxKind.JsxExpression)
      .some(e => e.getExpression()?.getText().trim() === 'children');
    if (hasChildren) return init;
  }
  return null;
}

export async function injectLayout(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<LayoutInjectorResult> {
  const filePath = await findLayoutFile(projectRoot);
  if (!filePath) throw new Error('Fichier layout.tsx introuvable dans app/ ou src/app/');

  const project = new Project({
    compilerOptions: COMPILER_OPTIONS,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sf = project.addSourceFileAtPath(filePath);

  if (sf.getFullText().includes('NextIntlClientProvider')) {
    if (!options.silent) console.log(`  — ${filePath} — déjà configuré`);
    return { modified: false, skipped: true, filePath };
  }

  const layoutFn = findLayoutFunction(sf);

  const childrenExpr = sf
    .getDescendantsOfKind(SyntaxKind.JsxExpression)
    .find(e => e.getExpression()?.getText().trim() === 'children');

  if (!childrenExpr) throw new Error('Expression {children} introuvable dans le layout');

  childrenExpr.replaceWithText(
    '<NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>',
  );

  if (layoutFn) {
    const body = layoutFn.getBody?.();
    if (body && Node.isBlock(body)) {
      body.insertStatements(0, 'const messages = await getMessages()');
    }
    layoutFn.setIsAsync(true);
  }

  const existingNextIntl = sf.getImportDeclaration('next-intl');
  if (existingNextIntl) {
    const hasProvider = existingNextIntl
      .getNamedImports()
      .some(n => n.getName() === 'NextIntlClientProvider');
    if (!hasProvider) existingNextIntl.addNamedImport('NextIntlClientProvider');
  } else {
    sf.addImportDeclaration({
      moduleSpecifier: 'next-intl',
      namedImports: ['NextIntlClientProvider'],
    });
  }

  const existingServer = sf.getImportDeclaration('next-intl/server');
  if (existingServer) {
    const hasGetMessages = existingServer
      .getNamedImports()
      .some(n => n.getName() === 'getMessages');
    if (!hasGetMessages) existingServer.addNamedImport('getMessages');
  } else {
    sf.addImportDeclaration({
      moduleSpecifier: 'next-intl/server',
      namedImports: ['getMessages'],
    });
  }

  await copyFile(filePath, `${filePath}.backup`);
  await sf.save();

  if (!options.silent) console.log(`  ✓ ${filePath} — NextIntlClientProvider injecté`);
  return { modified: true, skipped: false, filePath };
}
