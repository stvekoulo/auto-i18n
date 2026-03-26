import { readdir, rename, mkdir, writeFile, access, readFile, copyFile } from 'fs/promises';
import { join, extname } from 'path';
import { findLayoutFile } from './layout-injector.js';

export interface LocaleStructureResult {
  modified: boolean;
  skipped: boolean;
  movedFiles: string[];
}

/** Fichiers/dossiers qui restent à la racine de app/ et ne sont PAS déplacés. */
const ROOT_ONLY = new Set([
  'layout.tsx', 'layout.jsx', 'layout.js',
  'globals.css', 'global.css',
  'favicon.ico', 'icon.tsx', 'icon.jsx',
  'apple-icon.tsx', 'apple-icon.jsx',
  'opengraph-image.tsx', 'opengraph-image.jsx',
  'robots.ts', 'robots.txt',
  'sitemap.ts', 'sitemap.xml',
  'manifest.ts', 'manifest.json',
  'not-found.tsx', 'not-found.jsx',
]);

/**
 * Crée la structure `app/[locale]/`, déplace les pages
 * et génère un `[locale]/layout.tsx` avec le provider.
 */
export async function injectLocaleStructure(
  projectRoot: string,
  locales: string[],
  defaultLocale: string,
  options: { silent?: boolean } = {},
): Promise<LocaleStructureResult> {
  const layoutPath = await findLayoutFile(projectRoot);
  if (!layoutPath) {
    throw new Error("layout.tsx introuvable — impossible de restructurer app/");
  }

  const useSrc = layoutPath.includes(join('src', 'app'));
  const appDir = useSrc
    ? join(projectRoot, 'src', 'app')
    : join(projectRoot, 'app');

  const localeDir = join(appDir, '[locale]');

  // Si le dossier [locale] existe déjà, on skip
  try {
    await access(localeDir);
    if (!options.silent) console.log(`  — ${localeDir} — déjà présent`);
    return { modified: false, skipped: true, movedFiles: [] };
  } catch {
    /* n'existe pas → on le crée */
  }

  await mkdir(localeDir, { recursive: true });

  // Lister les entrées dans app/
  const entries = await readdir(appDir, { withFileTypes: true });
  const movedFiles: string[] = [];

  for (const entry of entries) {
    // Ne pas déplacer le dossier [locale] lui-même
    if (entry.name === '[locale]') continue;
    // Ne pas déplacer les fichiers qui doivent rester à la racine
    if (ROOT_ONLY.has(entry.name)) continue;

    const src = join(appDir, entry.name);
    const dest = join(localeDir, entry.name);

    await rename(src, dest);
    movedFiles.push(entry.name);
  }

  // Générer app/[locale]/layout.tsx avec le provider
  const localeLayoutPath = join(localeDir, 'layout.tsx');
  const routingImportPath = useSrc ? '../../i18n/routing' : '../../i18n/routing';
  const switcherImportPath = useSrc ? '../../components/LanguageSwitcher' : '../../components/LanguageSwitcher';

  await writeFile(localeLayoutPath, buildLocaleLayout(routingImportPath, switcherImportPath), 'utf-8');

  // Simplifier le root layout : HTML shell pur
  await rewriteRootLayout(layoutPath);

  if (!options.silent) {
    console.log(`  ✓ app/[locale]/ créé — ${movedFiles.length} entrée(s) déplacée(s)`);
  }

  return { modified: true, skipped: false, movedFiles };
}

function buildLocaleLayout(routingImportPath: string, switcherImportPath: string): string {
  return `import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '${routingImportPath}';
import { LanguageSwitcher } from '${switcherImportPath}';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
      <LanguageSwitcher />
    </NextIntlClientProvider>
  );
}
`;
}

/**
 * Réécrit le root layout pour en faire un HTML shell minimal.
 * Préserve les imports CSS/fonts existants.
 */
async function rewriteRootLayout(layoutPath: string): Promise<void> {
  await copyFile(layoutPath, `${layoutPath}.backup`);

  const content = await readFile(layoutPath, 'utf-8');

  // Extraire les imports CSS/fonts existants (ex: import './globals.css')
  const cssImports: string[] = [];
  const fontImports: string[] = [];
  const otherImports: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^import\s+['"]\..*\.css['"]/.test(trimmed) || /^import\s+['"]\.\/globals/.test(trimmed)) {
      cssImports.push(trimmed);
    } else if (/from\s+['"]next\/font/.test(trimmed) || /from\s+['"]@next\/font/.test(trimmed)) {
      fontImports.push(trimmed);
    }
  }

  // Extraire les déclarations de font (ex: const inter = Inter({ ... }))
  const fontDeclRegex = /^const\s+\w+\s*=\s*\w+\(\{[^}]*\}\);?\s*$/gm;
  const fontDecls: string[] = [];
  let match;
  while ((match = fontDeclRegex.exec(content)) !== null) {
    fontDecls.push(match[0]);
  }

  // Extraire l'ouverture complète du tag <body> (attributs préservés verbatim)
  // On capture tout entre <body et le premier > non imbriqué dans {}
  let bodyTag = '<body>';
  const bodyTagMatch = content.match(/<body[^>]*>/);
  if (bodyTagMatch) {
    bodyTag = bodyTagMatch[0];
  }

  // Construire le nouveau root layout
  const imports = [
    ...cssImports,
    ...fontImports,
  ].filter(Boolean);

  const importsStr = imports.length > 0 ? imports.join('\n') + '\n\n' : '';
  const fontDeclsStr = fontDecls.length > 0 ? fontDecls.join('\n') + '\n\n' : '';

  const newContent = `${importsStr}${fontDeclsStr}export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html>
      ${bodyTag}
        {children}
      </body>
    </html>
  );
}
`;

  await writeFile(layoutPath, newContent, 'utf-8');
}
