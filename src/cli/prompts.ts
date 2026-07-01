import inquirer from 'inquirer';

const PROVIDER_LABELS: Record<string, { name: string; keyUrl: string }> = {
  deepl: { name: 'DeepL', keyUrl: 'https://www.deepl.com/pro-api' },
  google: {
    name: 'Google Translate',
    keyUrl: 'https://cloud.google.com/translate/docs/setup',
  },
};

export async function askProvider(): Promise<string> {
  const { provider } = await inquirer.prompt<{ provider: string }>([
    {
      type: 'list',
      name: 'provider',
      message: 'Provider de traduction :',
      choices: [
        { name: 'DeepL', value: 'deepl' },
        { name: 'Google Translate', value: 'google' },
      ],
      default: 'deepl',
    },
  ]);
  return provider;
}

export async function askSourceLocale(): Promise<string> {
  const { sourceLocale } = await inquirer.prompt<{ sourceLocale: string }>([
    {
      type: 'input',
      name: 'sourceLocale',
      message: 'Langue source du projet (code ISO) :',
      default: 'fr',
      validate: (v: string) => v.trim().length >= 2 || 'Code langue requis (ex: fr, en, es)',
    },
  ]);
  return sourceLocale.trim().toLowerCase();
}

export async function askTargetLocales(sourceLocale: string): Promise<string[]> {
  const { input } = await inquirer.prompt<{ input: string }>([
    {
      type: 'input',
      name: 'input',
      message: 'Langues cibles (séparées par des virgules) :',
      default: sourceLocale === 'fr' ? 'en, es' : 'fr, en',
      validate: (v: string) => v.trim().length > 0 || 'Au moins une langue cible requise',
    },
  ]);
  return parseLocales(input, sourceLocale);
}

export async function askApiKey(provider: string = 'deepl'): Promise<string> {
  const label = PROVIDER_LABELS[provider] ?? { name: provider, keyUrl: '' };
  const suffix = label.keyUrl ? ` (${label.keyUrl})` : '';
  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: `Clé API ${label.name}${suffix} :`,
      mask: '*',
      validate: (v: string) => v.trim().length > 0 || 'Clé API requise',
    },
  ]);
  return apiKey.trim();
}

/** Découpe une liste de locales `"en, es"` en tableau normalisé, sans la source. */
export function parseLocales(input: string, sourceLocale: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0 && s !== sourceLocale),
    ),
  ];
}
