/**
 * Templates d'infrastructure Next.js App Router (`next-intl`).
 */

import {
  LOCALE_DISPLAY_MAP_SOURCE,
  SWITCHER_CONFIG_SOURCE,
  buildWebSwitcherJsx,
} from './shared-web-switcher.js';

export interface RoutingConfig {
  locales: string[];
  defaultLocale: string;
}

export function routingTemplate(config: RoutingConfig): string {
  const localesList = config.locales.map(l => `'${l}'`).join(', ');
  return `import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: [${localesList}],
  defaultLocale: '${config.defaultLocale}',
});
`;
}

export function requestTemplate(useSrcOrMessagesRel: boolean | string): string {
  const messagesPath =
    typeof useSrcOrMessagesRel === 'string'
      ? useSrcOrMessagesRel
      : useSrcOrMessagesRel
        ? '../../messages'
        : '../messages';
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

export function middlewareTemplate(): string {
  return `import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)'],
};
`;
}

export function switcherTemplate(routingImportPath: string): string {
  return `'use client';

import { usePathname, useRouter } from 'next/navigation';
import { routing } from '${routingImportPath}';
import { useState, useRef, useEffect } from 'react';

${SWITCHER_CONFIG_SOURCE}

${LOCALE_DISPLAY_MAP_SOURCE}

export function LanguageSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const locales = [...routing.locales] as string[];
  const segments = pathname.split('/');
  const hasLocalePrefix = locales.includes(segments[1]);
  const currentLocale = hasLocalePrefix ? segments[1] : routing.defaultLocale;

  function switchTo(locale: string) {
    if (locale === currentLocale) { setIsOpen(false); return; }
    const rest = segments.slice(hasLocalePrefix ? 2 : 1).filter(Boolean).join('/');
    router.push(\`/\${locale}\${rest ? \`/\${rest}\` : ''}\`);
    setIsOpen(false);
  }

${buildWebSwitcherJsx('locales')}
}
`;
}
