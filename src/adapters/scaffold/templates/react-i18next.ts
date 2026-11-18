/**
 * Templates d'infrastructure React / Vite (`i18next` + `react-i18next`).
 */

import {
  LOCALE_DISPLAY_MAP_SOURCE,
  SWITCHER_CONFIG_SOURCE,
  buildWebSwitcherJsx,
} from './shared-web-switcher.js';

export interface ReactI18nConfig {
  locales: string[];
  defaultLocale: string;
  messagesRelativePath: string;
}

export function localeIdentifier(locale: string): string {
  return `messages_${locale.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function reactI18nConfigTemplate(config: ReactI18nConfig): string {
  const imports = config.locales
    .map(l => `import ${localeIdentifier(l)} from '${config.messagesRelativePath}/${l}.json';`)
    .join('\n');
  const resources = config.locales
    .map(l => `    '${l}': { translation: ${localeIdentifier(l)} },`)
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
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
});

export default i18next;
`;
}

export function reactI18nSwitcherTemplate(locales: string[]): string {
  const localesList = locales.map(l => `'${l}'`).join(', ');
  return `import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

${SWITCHER_CONFIG_SOURCE}

const LOCALES = [${localesList}];

${LOCALE_DISPLAY_MAP_SOURCE}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLocale = LOCALES.includes(i18n.language) ? i18n.language : LOCALES[0];

  function switchTo(locale: string) {
    setIsOpen(false);
    if (locale === currentLocale) return;
    void i18n.changeLanguage(locale);
  }

${buildWebSwitcherJsx('LOCALES')}
}
`;
}

export function reactEntryImportLine(importPath = './i18n'): string {
  return `import '${importPath}';\n`;
}
