import { writeFile, readFile, access } from 'fs/promises';
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

const PROXY_CONTENT = `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export function GET(request: Request) {
  return createMiddleware(routing)(request);
}
`;

/**
 * Détecte la version majeure de Next.js installée dans le projet.
 * Retourne null si non trouvée.
 */
async function detectNextMajorVersion(projectRoot: string): Promise<number | null> {
  try {
    const pkgPath = join(projectRoot, 'node_modules', 'next', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    const major = parseInt(pkg.version?.split('.')[0], 10);
    return isNaN(major) ? null : major;
  } catch {
    return null;
  }
}

export async function injectMiddleware(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<MiddlewareInjectorResult> {
  const nextVersion = await detectNextMajorVersion(projectRoot);
  const useProxy = nextVersion !== null && nextVersion >= 16;

  const fileName = useProxy ? 'proxy.ts' : 'middleware.ts';
  const content = useProxy ? PROXY_CONTENT : MIDDLEWARE_CONTENT;
  const filePath = join(projectRoot, fileName);

  // Vérifier aussi l'ancien nom si on passe à proxy
  const altPath = join(projectRoot, useProxy ? 'middleware.ts' : 'proxy.ts');

  try {
    await access(filePath);
    const warning = `${fileName} existe déjà — configuration manuelle requise`;
    if (!options.silent) console.log(`  ⚠ ${filePath} — ${warning}`);
    return { modified: false, skipped: true, filePath, warning };
  } catch {
    /* fichier absent → on le crée */
  }

  // Vérifier si l'alternative existe déjà
  try {
    await access(altPath);
    const altName = useProxy ? 'middleware.ts' : 'proxy.ts';
    const warning = `${altName} existe déjà — ${fileName} non créé`;
    if (!options.silent) console.log(`  ⚠ ${warning}`);
    return { modified: false, skipped: true, filePath: altPath, warning };
  } catch {
    /* pas d'alternative non plus */
  }

  await writeFile(filePath, content, 'utf-8');

  if (!options.silent) console.log(`  ✓ ${filePath} — créé`);
  return { modified: true, skipped: false, filePath };
}
