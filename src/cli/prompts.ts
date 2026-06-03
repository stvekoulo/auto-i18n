import inquirer from 'inquirer';

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

export async function askApiKey(): Promise<string> {
  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Clé API DeepL (https://www.deepl.com/pro-api) :',
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
