import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';

export interface RequestInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
}

function buildRequestContent(): string {
  return `import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(\`../messages/\${locale}.json\`)).default,
  };
});
`;
}

export async function injectRequest(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<RequestInjectorResult> {
  const i18nDir = join(projectRoot, 'i18n');
  const filePath = join(i18nDir, 'request.ts');

  try {
    await access(filePath);
    if (!options.silent) console.log(`  — ${filePath} — déjà présent`);
    return { modified: false, skipped: true, filePath };
  } catch {
    /* fichier absent → on le crée */
  }

  await mkdir(i18nDir, { recursive: true });
  await writeFile(filePath, buildRequestContent(), 'utf-8');

  if (!options.silent) console.log(`  ✓ ${filePath} — créé`);
  return { modified: true, skipped: false, filePath };
}
