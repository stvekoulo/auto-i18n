import { writeFile, access } from 'fs/promises';
import { join } from 'path';

export interface MiddlewareInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
  warning?: string;
}

const MIDDLEWARE_CONTENT = `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)'],
};
`;

export async function injectMiddleware(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<MiddlewareInjectorResult> {
  const filePath = join(projectRoot, 'middleware.ts');

  try {
    await access(filePath);
    // Fichier existant → avertissement sans modification
    const warning = `middleware.ts existe déjà — configuration manuelle requise`;
    if (!options.silent) console.log(`  ⚠ ${filePath} — ${warning}`);
    return { modified: false, skipped: true, filePath, warning };
  } catch {
    /* fichier absent → on le crée */
  }

  await writeFile(filePath, MIDDLEWARE_CONTENT, 'utf-8');

  if (!options.silent) console.log(`  ✓ ${filePath} — créé`);
  return { modified: true, skipped: false, filePath };
}
