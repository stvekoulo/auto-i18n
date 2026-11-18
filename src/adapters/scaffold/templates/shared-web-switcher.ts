/**
 * Corps partagé du composant web `LanguageSwitcher` (Next.js et React/Vite),
 * incluant la fermeture au clic extérieur, la touche `Escape` et les attributs ARIA.
 */

export const LOCALE_DISPLAY_MAP_SOURCE = `const LOCALE_DISPLAY: Record<string, { name: string; flag: string }> = {
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
};`;

export const SWITCHER_CONFIG_SOURCE = `const SWITCHER_CONFIG = {
  position: 'bottom-right' as 'bottom-right' | 'bottom-left',
  theme: 'light' as 'light' | 'dark',
  accentColor: '#2563eb',
  offset: 24,
  borderRadius: 12,
};`;

export function buildWebSwitcherJsx(localesExpr: string): string {
  return `  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

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
          role="listbox"
          aria-label="Langues disponibles"
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
            {${localesExpr}.map((locale) => {
              const meta = LOCALE_DISPLAY[locale] ?? { name: locale.toUpperCase(), flag: '🌐' };
              const isActive = locale === currentLocale;
              return (
                <button
                  key={locale}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => switchTo(locale)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    minHeight: 44,
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
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Changer de langue"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
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
  );`;
}
