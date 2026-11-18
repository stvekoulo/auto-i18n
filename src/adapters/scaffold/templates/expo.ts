/**
 * Templates d'infrastructure Expo / React Native (`expo-localization` + `i18next`).
 *
 * Respecte les primitives natives (`View`, `Text`, `Pressable`, `Modal`, `StyleSheet`)
 * et les cibles tactiles minimales de 44pt (Apple HIG / Material).
 */

import { LOCALE_DISPLAY_MAP_SOURCE } from './shared-web-switcher.js';
import { localeIdentifier, type ReactI18nConfig } from './react-i18next.js';

export interface ExpoI18nConfig extends ReactI18nConfig {
  useExpoLocalization?: boolean;
}

export function expoI18nConfigTemplate(config: ExpoI18nConfig): string {
  const imports = config.locales
    .map(l => `import ${localeIdentifier(l)} from '${config.messagesRelativePath}/${l}.json';`)
    .join('\n');
  const resources = config.locales
    .map(l => `    '${l}': { translation: ${localeIdentifier(l)} },`)
    .join('\n');
  const locImport = config.useExpoLocalization
    ? `import { getLocales } from 'expo-localization';\n`
    : '';
  const initialLng = config.useExpoLocalization
    ? `getLocales()[0]?.languageCode ?? '${config.defaultLocale}'`
    : `'${config.defaultLocale}'`;

  return `import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
${locImport}${imports}

const supportedLocales = [${config.locales.map(l => `'${l}'`).join(', ')}];
const detected = ${initialLng};
const initialLocale = supportedLocales.includes(detected) ? detected : '${config.defaultLocale}';

void i18next.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources: {
${resources}
  },
  lng: initialLocale,
  fallbackLng: '${config.defaultLocale}',
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
});

export default i18next;
`;
}

export function expoSwitcherTemplate(locales: string[]): string {
  const localesList = locales.map(l => `'${l}'`).join(', ');
  return `import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const LOCALES = [${localesList}];

${LOCALE_DISPLAY_MAP_SOURCE}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const currentLocale = LOCALES.includes(i18n.language) ? i18n.language : LOCALES[0];
  const current = LOCALE_DISPLAY[currentLocale] ?? { name: currentLocale.toUpperCase(), flag: '🌐' };

  function switchTo(locale: string) {
    setIsOpen(false);
    if (locale !== currentLocale) void i18n.changeLanguage(locale);
  }

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Changer de langue"
        onPress={() => setIsOpen(true)}
        style={styles.trigger}
      >
        <Text style={styles.flag}>{current.flag}</Text>
        <Text style={styles.triggerLabel}>{current.name}</Text>
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={styles.sheet}>
            {LOCALES.map((locale) => {
              const meta = LOCALE_DISPLAY[locale] ?? { name: locale.toUpperCase(), flag: '🌐' };
              const active = locale === currentLocale;
              return (
                <Pressable
                  key={locale}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => switchTo(locale)}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <Text style={styles.flag}>{meta.flag}</Text>
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{meta.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'flex-end' },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  flag: { fontSize: 18 },
  triggerLabel: { fontSize: 14, fontWeight: '600', color: '#1f2937' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  optionActive: { backgroundColor: '#2563eb' },
  optionLabel: { fontSize: 15, color: '#1f2937' },
  optionLabelActive: { color: '#ffffff', fontWeight: '600' },
});
`;
}
