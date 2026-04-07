import { writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { findLayoutFile } from './layout-injector.js';

export interface MiddlewareInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
  warning?: string;
}

function buildMiddlewareContent(useSrc: boolean): string {
  const routingImport = useSrc ? './i18n/routing' : './i18n/routing';
  return `import createMiddleware from 'next-intl/middleware';
import { routing } from '${routingImport}';

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)'],
};
`;
}

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

  const layoutPath = await findLayoutFile(projectRoot);
  const useSrc = layoutPath ? layoutPath.includes(join('src', 'app')) : false;
  const baseDir = useSrc ? join(projectRoot, 'src') : projectRoot;

  const fileName = useProxy ? 'proxy.ts' : 'middleware.ts';
  const content = buildMiddlewareContent(useSrc);
  const filePath = join(baseDir, fileName);

  const altFileName = useProxy ? 'middleware.ts' : 'proxy.ts';

  // Vérifier les deux emplacements possibles (src/ et root)
  for (const dir of [baseDir, projectRoot]) {
    for (const name of [fileName, altFileName]) {
      const candidate = join(dir, name);
      try {
        await access(candidate);
        const warning = `${name} existe déjà (${candidate}) — configuration manuelle requise`;
        if (!options.silent) console.log(`  ⚠ ${warning}`);
        return { modified: false, skipped: true, filePath: candidate, warning };
      } catch {
        /* non trouvé */
      }
    }
  }

  await writeFile(filePath, content, 'utf-8');

  if (!options.silent) console.log(`  ✓ ${filePath} — créé`);
  return { modified: true, skipped: false, filePath };
}
