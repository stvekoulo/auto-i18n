import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { findLayoutFile } from './layout-injector.js';

export interface RoutingInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
}

export interface RoutingConfig {
  locales: string[];
  defaultLocale: string;
}

function buildRoutingContent(config: RoutingConfig): string {
  const localesList = config.locales.map(l => `'${l}'`).join(', ');
  return `import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: [${localesList}],
  defaultLocale: '${config.defaultLocale}',
});
`;
}

export async function injectRouting(
  projectRoot: string,
  config: RoutingConfig,
  options: { silent?: boolean } = {},
): Promise<RoutingInjectorResult> {
  // Détecter si le projet utilise src/
  const layoutPath = await findLayoutFile(projectRoot);
  const useSrc = layoutPath ? layoutPath.includes(join('src', 'app')) : false;
  const baseDir = useSrc ? join(projectRoot, 'src') : projectRoot;

  const i18nDir = join(baseDir, 'i18n');
  const filePath = join(i18nDir, 'routing.ts');

  // Vérifier les deux emplacements possibles
  for (const dir of [join(baseDir, 'i18n'), join(projectRoot, 'i18n')]) {
    try {
      await access(join(dir, 'routing.ts'));
      if (!options.silent) console.log(`  — ${join(dir, 'routing.ts')} — déjà présent`);
      return { modified: false, skipped: true, filePath: join(dir, 'routing.ts') };
    } catch {
      /* non trouvé */
    }
  }

  await mkdir(i18nDir, { recursive: true });
  await writeFile(filePath, buildRoutingContent(config), 'utf-8');

  if (!options.silent) {
    const locales = config.locales.join(', ');
    console.log(`  ✓ ${filePath} — créé (locales: ${locales})`);
  }
  return { modified: true, skipped: false, filePath };
}
