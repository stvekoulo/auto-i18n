/**
 * Templates des fichiers d'infrastructure next-intl et react-i18next. Fonctions pures (→ string).
 */

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

export function requestTemplate(useSrc: boolean): string {
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

const SWITCHER_CONFIG = {
  position: 'bottom-right' as 'bottom-right' | 'bottom-left',
  theme: 'light' as 'light' | 'dark',
  accentColor: '#2563eb',
  offset: 24,
  borderRadius: 12,
};

const LOCALE_DISPLAY: Record<string, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇬🇧' },
  fr: { name: 'Français', flag: '🇫🇷' },
  es: { name: 'Español', flag: '🇪🇸' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  pt: { name: 'Português', flag: '🇵🇹' },
  nl: { name: 'Nederlands', flag: '🇳🇱' },
  pl: { name: 'Polski', flag: '🇵🇱' },
  ru: { name: 'Русский', flag: '🇷🇺' },
  ja: { name: '日本語', flag: '🇯🇵' },
  ko: { name: '한국어', flag: '🇰🇷' },
  zh: { name: '中文', flag: '🇨🇳' },
  ar: { name: 'العربية', flag: '🇸🇦' },
  tr: { name: 'Türkçe', flag: '🇹🇷' },
};

export function LanguageSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const locales = [...routing.locales] as string[];
  const segments = pathname.split('/');
  const currentLocale = locales.includes(segments[1]) ? segments[1] : routing.defaultLocale;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function switchTo(locale: string) {
    if (locale === currentLocale) { setIsOpen(false); return; }
    const rest = segments.slice(2).join('/');
    router.push(\`/\${locale}\${rest ? \`/\${rest}\` : ''}\`);
    setIsOpen(false);
  }

  const { theme, accentColor, offset, borderRadius, position } = SWITCHER_CONFIG;
  const isDark = theme === 'dark';
  const isRight = position === 'bottom-right';
  const current = LOCALE_DISPLAY[currentLocale] ?? { name: currentLocale.toUpperCase(), flag: '🌐' };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: offset,
        ...(isRight ? { right: offset } : { left: offset }),
        zIndex: 9999,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: 58,
            ...(isRight ? { right: 0 } : { left: 0 }),
            minWidth: 210,
            background: isDark ? '#1f2937' : '#ffffff',
            borderRadius,
            boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
            border: \`1px solid \${isDark ? '#374151' : '#e5e7eb'}\`,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '6px 0', maxHeight: 260, overflowY: 'auto' }}>
            {locales.map((locale) => {
              const meta = LOCALE_DISPLAY[locale] ?? { name: locale.toUpperCase(), flag: '🌐' };
              const isActive = locale === currentLocale;
              return (
                <button
                  key={locale}
                  onClick={() => switchTo(locale)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    background: isActive ? accentColor : 'transparent',
                    color: isActive ? '#ffffff' : isDark ? '#f3f4f6' : '#1f2937',
                    cursor: 'pointer',
                    fontSize: 14,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{meta.flag}</span>
                  <span style={{ flex: 1 }}>{meta.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Change language"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 48,
          padding: '0 18px 0 14px',
          borderRadius: 24,
          border: \`1px solid \${isDark ? '#374151' : '#e5e7eb'}\`,
          background: isDark ? '#1f2937' : '#ffffff',
          color: isDark ? '#f3f4f6' : '#1f2937',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>{current.flag}</span>
        <span>{current.name}</span>
      </button>
    </div>
  );
}
`;
}

// ── react-i18next (projets React/Vite hors Next.js) ─────────────────────────

export interface ReactI18nConfig {
  locales: string[];
  defaultLocale: string;
  /** Chemin relatif (depuis le fichier généré) vers le dossier des catalogues. */
  messagesRelativePath: string;
}

function localeIdentifier(locale: string): string {
  return locale.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Config d'init react-i18next : charge les catalogues déjà traduits par `sync`. */
export function reactI18nConfigTemplate(config: ReactI18nConfig): string {
  const imports = config.locales
    .map(l => `import ${localeIdentifier(l)} from '${config.messagesRelativePath}/${l}.json';`)
    .join('\n');
  const resources = config.locales
    .map(l => `    ${l}: { translation: ${localeIdentifier(l)} },`)
    .join('\n');

  return `import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
${imports}

i18next.use(initReactI18next).init({
  resources: {
${resources}
  },
  lng: '${config.defaultLocale}',
  fallbackLng: '${config.defaultLocale}',
  interpolation: { escapeValue: false },
});

export default i18next;
`;
}

/** Composant de changement de langue pour react-i18next (pas de routing, `i18n.changeLanguage`). */
export function reactI18nSwitcherTemplate(locales: string[]): string {
  const localesList = locales.map(l => `'${l}'`).join(', ');
  return `import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const SWITCHER_CONFIG = {
  position: 'bottom-right' as 'bottom-right' | 'bottom-left',
  theme: 'light' as 'light' | 'dark',
  accentColor: '#2563eb',
  offset: 24,
  borderRadius: 12,
};

const LOCALES = [${localesList}];

const LOCALE_DISPLAY: Record<string, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇬🇧' },
  fr: { name: 'Français', flag: '🇫🇷' },
  es: { name: 'Español', flag: '🇪🇸' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  pt: { name: 'Português', flag: '🇵🇹' },
  nl: { name: 'Nederlands', flag: '🇳🇱' },
  pl: { name: 'Polski', flag: '🇵🇱' },
  ru: { name: 'Русский', flag: '🇷🇺' },
  ja: { name: '日本語', flag: '🇯🇵' },
  ko: { name: '한국어', flag: '🇰🇷' },
  zh: { name: '中文', flag: '🇨🇳' },
  ar: { name: 'العربية', flag: '🇸🇦' },
  tr: { name: 'Türkçe', flag: '🇹🇷' },
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLocale = LOCALES.includes(i18n.language) ? i18n.language : LOCALES[0];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function switchTo(locale: string) {
    setIsOpen(false);
    if (locale === currentLocale) return;
    void i18n.changeLanguage(locale);
  }

  const { theme, accentColor, offset, borderRadius, position } = SWITCHER_CONFIG;
  const isDark = theme === 'dark';
  const isRight = position === 'bottom-right';
  const current = LOCALE_DISPLAY[currentLocale] ?? { name: currentLocale.toUpperCase(), flag: '🌐' };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: offset,
        ...(isRight ? { right: offset } : { left: offset }),
        zIndex: 9999,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: 58,
            ...(isRight ? { right: 0 } : { left: 0 }),
            minWidth: 210,
            background: isDark ? '#1f2937' : '#ffffff',
            borderRadius,
            boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
            border: \`1px solid \${isDark ? '#374151' : '#e5e7eb'}\`,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '6px 0', maxHeight: 260, overflowY: 'auto' }}>
            {LOCALES.map((locale) => {
              const meta = LOCALE_DISPLAY[locale] ?? { name: locale.toUpperCase(), flag: '🌐' };
              const isActive = locale === currentLocale;
              return (
                <button
                  key={locale}
                  onClick={() => switchTo(locale)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    background: isActive ? accentColor : 'transparent',
                    color: isActive ? '#ffffff' : isDark ? '#f3f4f6' : '#1f2937',
                    cursor: 'pointer',
                    fontSize: 14,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{meta.flag}</span>
                  <span style={{ flex: 1 }}>{meta.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Change language"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 48,
          padding: '0 18px 0 14px',
          borderRadius: 24,
          border: \`1px solid \${isDark ? '#374151' : '#e5e7eb'}\`,
          background: isDark ? '#1f2937' : '#ffffff',
          color: isDark ? '#f3f4f6' : '#1f2937',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>{current.flag}</span>
        <span>{current.name}</span>
      </button>
    </div>
  );
}
`;
}

/** Import à ajouter en tête du point d'entrée React pour charger la config i18n. */
export function reactEntryImportLine(): string {
  return `import './i18n';\n`;
}
