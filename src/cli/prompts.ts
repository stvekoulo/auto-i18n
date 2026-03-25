import inquirer from 'inquirer';

export async function askSourceLocale(): Promise<string> {
  const answers = await inquirer.prompt<{ sourceLocale: string }>([
    {
      type: 'input',
      name: 'sourceLocale',
      message: 'Langue source du projet (code ISO) :',
      default: 'fr',
      validate: (v: string) => v.length >= 2 || 'Code langue requis (ex: fr, en, es)',
    },
  ]);
  return answers.sourceLocale;
}

export async function askTargetLocales(sourceLocale: string): Promise<string[]> {
  const answers = await inquirer.prompt<{ input: string }>([
    {
      type: 'input',
      name: 'input',
      message: 'Langues cibles (separees par des virgules) :',
      default: sourceLocale === 'fr' ? 'en, es' : 'fr, en',
      validate: (v: string) => v.trim().length > 0 || 'Au moins une langue cible requise',
    },
  ]);
  return answers.input
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter((s: string) => s.length > 0 && s !== sourceLocale);
}

export async function askApiKey(): Promise<string> {
  const answers = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Cle API DeepL (https://www.deepl.com/pro-api) :',
      mask: '*',
      validate: (v: string) => v.trim().length > 0 || 'Cle API requise',
    },
  ]);
  return answers.apiKey.trim();
}

export interface DryRunChanges {
  stringsFound: number;
  keysGenerated: number;
  filesToRewrite: number;
  targetLocales: string[];
}

export async function askConfirmDryRun(changes: DryRunChanges): Promise<boolean> {
  console.log();
  console.log(`  Strings trouvees :  ${changes.stringsFound}`);
  console.log(`  Cles generees :     ${changes.keysGenerated}`);
  console.log(`  Fichiers a reecrire : ${changes.filesToRewrite}`);
  console.log(`  Langues cibles :    ${changes.targetLocales.join(', ')}`);
  console.log();

  const answers = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Appliquer ces changements ?',
      default: true,
    },
  ]);
  return answers.confirm;
}
