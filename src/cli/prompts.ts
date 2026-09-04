import { input, password, select } from '@inquirer/prompts';

const PROVIDER_LABELS: Record<string, { name: string; keyUrl: string }> = {
  deepl: { name: 'DeepL', keyUrl: 'https://www.deepl.com/pro-api' },
  google: {
    name: 'Google Translate',
    keyUrl: 'https://cloud.google.com/translate/docs/setup',
  },
};

export async function askProvider(): Promise<string> {
  return select({
    message: 'Provider de traduction :',
    choices: [
      { name: 'DeepL', value: 'deepl' },
      { name: 'Google Translate', value: 'google' },
    ],
    default: 'deepl',
  });
}

export async function askSourceLocale(): Promise<string> {
  const sourceLocale = await input({
    message: 'Langue source du projet (code ISO) :',
    default: 'fr',
    validate: v => v.trim().length >= 2 || 'Code langue requis (ex: fr, en, es)',
  });
  return sourceLocale.trim().toLowerCase();
}

export async function askTargetLocales(sourceLocale: string): Promise<string[]> {
  const answer = await input({
    message: 'Langues cibles (séparées par des virgules) :',
    default: sourceLocale === 'fr' ? 'en, es' : 'fr, en',
    validate: v => v.trim().length > 0 || 'Au moins une langue cible requise',
  });
  return parseLocales(answer, sourceLocale);
}

export async function askApiKey(provider: string = 'deepl'): Promise<string> {
  const label = PROVIDER_LABELS[provider] ?? { name: provider, keyUrl: '' };
  const suffix = label.keyUrl ? ` (${label.keyUrl})` : '';
  const apiKey = await password({
    message: `Clé API ${label.name}${suffix} :`,
    mask: '*',
    validate: v => v.trim().length > 0 || 'Clé API requise',
  });
  return apiKey.trim();
}

/** Découpe une liste de locales `"en, es"` en tableau normalisé, sans la source. */
export function parseLocales(raw: string, sourceLocale: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0 && s !== sourceLocale),
    ),
  ];
}
