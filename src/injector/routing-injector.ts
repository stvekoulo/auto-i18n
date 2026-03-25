import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';

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
  const i18nDir = join(projectRoot, 'i18n');
  const filePath = join(i18nDir, 'routing.ts');

  try {
    await access(filePath);
    if (!options.silent) console.log(`  — ${filePath} — déjà présent`);
    return { modified: false, skipped: true, filePath };
  } catch {
    /* fichier absent → on le crée */
  }

  await mkdir(i18nDir, { recursive: true });
  await writeFile(filePath, buildRoutingContent(config), 'utf-8');

  if (!options.silent) {
    const locales = config.locales.join(', ');
    console.log(`  ✓ ${filePath} — créé (locales: ${locales})`);
  }
  return { modified: true, skipped: false, filePath };
}
