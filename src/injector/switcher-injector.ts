import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { findLayoutFile } from './layout-injector.js';

export interface SwitcherInjectorResult {
  modified: boolean;
  skipped: boolean;
  filePath: string;
}

/* ------------------------------------------------------------------ */
/*  Component template                                                 */
/* ------------------------------------------------------------------ */

function buildSwitcherComponent(routingImportPath: string): string {
  return `'use client';

import { usePathname, useRouter } from 'next/navigation';
import { routing } from '${routingImportPath}';
import { useState, useRef, useEffect } from 'react';

/* ══════════════════════════════════════════════════════════════════════
 *  CUSTOMIZATION — Modify these values to match your brand.
 *  ⚠ Do NOT remove the attribution section — it is required by the license.
 * ══════════════════════════════════════════════════════════════════════ */
const SWITCHER_CONFIG = {
  /** Position of the floating widget: 'bottom-right' | 'bottom-left' */
  position: 'bottom-right' as 'bottom-right' | 'bottom-left',
  /** Color theme: 'light' | 'dark' */
  theme: 'light' as 'light' | 'dark',
  /** Accent color used for the active locale highlight */
  accentColor: '#2563eb',
  /** Offset from screen edges in pixels */
  offset: 24,
  /** Border radius of the dropdown in pixels */
  borderRadius: 12,
};
/* ══════════════════════════════════════════════════════════════════════ */

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
  sv: { name: 'Svenska', flag: '🇸🇪' },
  da: { name: 'Dansk', flag: '🇩🇰' },
  fi: { name: 'Suomi', flag: '🇫🇮' },
  nb: { name: 'Norsk', flag: '🇳🇴' },
  uk: { name: 'Українська', flag: '🇺🇦' },
  cs: { name: 'Čeština', flag: '🇨🇿' },
  ro: { name: 'Română', flag: '🇷🇴' },
  hu: { name: 'Magyar', flag: '🇭🇺' },
  el: { name: 'Ελληνικά', flag: '🇬🇷' },
  bg: { name: 'Български', flag: '🇧🇬' },
  sk: { name: 'Slovenčina', flag: '🇸🇰' },
  sl: { name: 'Slovenščina', flag: '🇸🇮' },
  et: { name: 'Eesti', flag: '🇪🇪' },
  lv: { name: 'Latviešu', flag: '🇱🇻' },
  lt: { name: 'Lietuvių', flag: '🇱🇹' },
  id: { name: 'Bahasa Indonesia', flag: '🇮🇩' },
};

export function LanguageSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const locales = [...routing.locales] as string[];
  const segments = pathname.split('/');
  const currentLocale = locales.includes(segments[1])
    ? segments[1]
    : routing.defaultLocale;

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
    if (locale === currentLocale) {
      setIsOpen(false);
      return;
    }
    const rest = segments.slice(2).join('/');
    router.push(\`/\${locale}\${rest ? \`/\${rest}\` : ''}\`);
    setIsOpen(false);
  }

  const { theme, accentColor, offset, borderRadius, position } = SWITCHER_CONFIG;
  const isDark = theme === 'dark';
  const isRight = position === 'bottom-right';

  const current = LOCALE_DISPLAY[currentLocale] ?? {
    name: currentLocale.toUpperCase(),
    flag: '🌐',
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: offset,
        ...(isRight ? { right: offset } : { left: offset }),
        zIndex: 9999,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      }}
    >
      {/* ── Dropdown ── */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: 58,
            ...(isRight ? { right: 0 } : { left: 0 }),
            minWidth: 210,
            background: isDark ? '#1f2937' : '#ffffff',
            borderRadius,
            boxShadow:
              '0 12px 40px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)',
            border: \`1px solid \${isDark ? '#374151' : '#e5e7eb'}\`,
            overflow: 'hidden',
            animation: 'nai18n-fade-in 150ms ease-out',
          }}
        >
          <div style={{ padding: '6px 0', maxHeight: 260, overflowY: 'auto' }}>
            {locales.map((locale) => {
              const meta = LOCALE_DISPLAY[locale] ?? {
                name: locale.toUpperCase(),
                flag: '🌐',
              };
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
                    color: isActive
                      ? '#ffffff'
                      : isDark
                        ? '#f3f4f6'
                        : '#1f2937',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    transition: 'background 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = isDark
                        ? '#374151'
                        : '#f3f4f6';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{meta.flag}</span>
                  <span style={{ flex: 1 }}>{meta.name}</span>
                  {isActive && (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 4.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Attribution — required by license, do not remove ── */}
          <div
            style={{
              borderTop: \`1px solid \${isDark ? '#374151' : '#f0f0f0'}\`,
              padding: '6px 16px',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: isDark ? '#6b7280' : '#a1a1aa',
                letterSpacing: '0.03em',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            >
              Made by Steven Koulo
            </span>
          </div>
        </div>
      )}

      {/* ── Floating trigger button ── */}
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
          boxShadow:
            '0 4px 20px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
          fontFamily: 'inherit',
          transition: 'box-shadow 200ms ease, transform 200ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow =
            '0 8px 28px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.1)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow =
            '0 4px 20px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>{current.flag}</span>
        <span>{current.name}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transition: 'transform 200ms ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <path d="M3 5l3 3 3-3" />
        </svg>
      </button>

      {/* Animation keyframes */}
      <style>{\`
        @keyframes nai18n-fade-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      \`}</style>
    </div>
  );
}
`;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Génère le composant LanguageSwitcher.tsx dans le projet cible.
 * L'import dans le layout est géré par locale-structure-injector.
 */
export async function injectLanguageSwitcher(
  projectRoot: string,
  options: { silent?: boolean } = {},
): Promise<SwitcherInjectorResult> {
  // Detect project structure via layout location
  const layoutPath = await findLayoutFile(projectRoot);
  if (!layoutPath) {
    throw new Error('layout.tsx introuvable — impossible d\'injecter le LanguageSwitcher');
  }

  const useSrc = layoutPath.includes(`${join('src', 'app')}`);
  const baseDir = useSrc ? join(projectRoot, 'src') : projectRoot;

  const componentsDir = join(baseDir, 'components');
  const switcherPath = join(componentsDir, 'LanguageSwitcher.tsx');

  // Skip if already exists
  try {
    await access(switcherPath);
    if (!options.silent) console.log(`  — ${switcherPath} — déjà présent`);
    return { modified: false, skipped: true, filePath: switcherPath };
  } catch {
    /* file absent → create it */
  }

  // Create components/ directory if needed
  await mkdir(componentsDir, { recursive: true });

  // Compute the relative import path for routing
  const routingImportPath = useSrc ? '../../i18n/routing' : '../i18n/routing';

  // Write the component file
  await writeFile(switcherPath, buildSwitcherComponent(routingImportPath), 'utf-8');

  if (!options.silent) console.log(`  ✓ ${switcherPath} — créé`);
  return { modified: true, skipped: false, filePath: switcherPath };
}
