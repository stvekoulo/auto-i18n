import { readdir, rename, mkdir, writeFile, access, readFile, copyFile } from 'fs/promises';
import { join, extname } from 'path';
import { findLayoutFile } from './layout-injector.js';

export interface LocaleStructureResult {
  modified: boolean;
  skipped: boolean;
  movedFiles: string[];
}

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

  let localeExists = false;
  try {
    await access(localeDir);
    localeExists = true;
  } catch {
    /* n'existe pas → on le crée */
  }

  if (localeExists) {
    const localeLayoutPath = join(localeDir, 'layout.tsx');
    const switcherImportPath = '../../components/LanguageSwitcher';
    const routingImportPath = '../../i18n/routing';
    const patched = await ensureLocaleLayoutHasSwitcher(localeLayoutPath, routingImportPath, switcherImportPath);
    if (patched) {
      if (!options.silent) console.log(`  ✓ ${localeLayoutPath} — LanguageSwitcher injecté`);
      return { modified: true, skipped: false, movedFiles: [] };
    }
    if (!options.silent) console.log(`  — ${localeDir} — déjà présent`);
    return { modified: false, skipped: true, movedFiles: [] };
  }

  await mkdir(localeDir, { recursive: true });

  const entries = await readdir(appDir, { withFileTypes: true });
  const movedFiles: string[] = [];

  for (const entry of entries) {
    if (entry.name === '[locale]') continue;
    if (ROOT_ONLY.has(entry.name)) continue;

    const src = join(appDir, entry.name);
    const dest = join(localeDir, entry.name);

    await rename(src, dest);
    movedFiles.push(entry.name);
  }

  const localeLayoutPath = join(localeDir, 'layout.tsx');
  const routingImportPath = useSrc ? '../../i18n/routing' : '../../i18n/routing';
  const switcherImportPath = useSrc ? '../../components/LanguageSwitcher' : '../../components/LanguageSwitcher';

  await writeFile(localeLayoutPath, buildLocaleLayout(routingImportPath, switcherImportPath), 'utf-8');

  await rewriteRootLayout(layoutPath);

  if (!options.silent) {
    console.log(`  ✓ app/[locale]/ créé — ${movedFiles.length} entrée(s) déplacée(s)`);
  }

  return { modified: true, skipped: false, movedFiles };
}

async function ensureLocaleLayoutHasSwitcher(
  layoutPath: string,
  routingImportPath: string,
  switcherImportPath: string,
): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(layoutPath, 'utf-8');
  } catch {
    await writeFile(layoutPath, buildLocaleLayout(routingImportPath, switcherImportPath), 'utf-8');
    return true;
  }

  if (content.includes('LanguageSwitcher')) return false; // Déjà présent

  // Ajouter l'import
  const importLine = `import { LanguageSwitcher } from '${switcherImportPath}';\n`;
  const lastImportIdx = content.lastIndexOf('import ');
  if (lastImportIdx >= 0) {
    const lineEnd = content.indexOf('\n', lastImportIdx);
    content = content.slice(0, lineEnd + 1) + importLine + content.slice(lineEnd + 1);
  } else {
    content = importLine + content;
  }

  // Ajouter <LanguageSwitcher /> avant la fermeture du provider ou avant </div>
  const closingTag = content.includes('</NextIntlClientProvider>')
    ? '</NextIntlClientProvider>'
    : '</div>';
  content = content.replace(closingTag, `  <LanguageSwitcher />\n    ${closingTag}`);

  await copyFile(layoutPath, `${layoutPath}.backup`);
  await writeFile(layoutPath, content, 'utf-8');
  return true;
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

  if (!routing.locales.includes(locale as typeof routing.locales[number])) {
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

async function rewriteRootLayout(layoutPath: string): Promise<void> {
  await copyFile(layoutPath, `${layoutPath}.backup`);

  const content = await readFile(layoutPath, 'utf-8');

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

  const fontDeclRegex = /^const\s+\w+\s*=\s*\w+\(\{[^}]*\}\);?\s*$/gm;
  const fontDecls: string[] = [];
  let match;
  while ((match = fontDeclRegex.exec(content)) !== null) {
    fontDecls.push(match[0]);
  }

  let bodyTag = '<body>';
  const bodyTagMatch = content.match(/<body[^>]*>/);
  if (bodyTagMatch) {
    bodyTag = bodyTagMatch[0];
  }

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
    <html suppressHydrationWarning>
      ${bodyTag}
        {children}
      </body>
    </html>
  );
}
`;

  await writeFile(layoutPath, newContent, 'utf-8');
}
