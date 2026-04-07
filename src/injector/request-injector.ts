import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { findLayoutFile } from './layout-injector.js';

export interface RequestInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
}

function buildRequestContent(useSrc: boolean): string {
  const messagesPath = useSrc ? '../../messages' : '../messages';
  return `import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as typeof routing.locales[number])) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(\`${messagesPath}/\${locale}.json\`)).default,
  };
});
`;
}

export async function injectRequest(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<RequestInjectorResult> {
  const layoutPath = await findLayoutFile(projectRoot);
  const useSrc = layoutPath ? layoutPath.includes(join('src', 'app')) : false;
  const baseDir = useSrc ? join(projectRoot, 'src') : projectRoot;

  const i18nDir = join(baseDir, 'i18n');
  const filePath = join(i18nDir, 'request.ts');

  for (const dir of [join(baseDir, 'i18n'), join(projectRoot, 'i18n')]) {
    try {
      await access(join(dir, 'request.ts'));
      if (!options.silent) console.log(`  — ${join(dir, 'request.ts')} — déjà présent`);
      return { modified: false, skipped: true, filePath: join(dir, 'request.ts') };
    } catch {
      /* non trouvé */
    }
  }

  await mkdir(i18nDir, { recursive: true });
  await writeFile(filePath, buildRequestContent(useSrc), 'utf-8');

  if (!options.silent) console.log(`  ✓ ${filePath} — créé`);
  return { modified: true, skipped: false, filePath };
}
