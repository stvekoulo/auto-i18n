import inquirer from 'inquirer';
import chalk from 'chalk';

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

export interface DryRunFileDetail {
  filePath: string;
  stringCount: number;
}

export interface DryRunChanges {
  stringsFound: number;
  keysGenerated: number;
  filesToRewrite: number;
  targetLocales: string[];
  fileDetails: DryRunFileDetail[];
  sampleKeys: Array<{ value: string; key: string }>;
  messagesPath: string;
}

export async function askConfirmDryRun(changes: DryRunChanges): Promise<boolean> {
  const MAX_FILES = 10;
  const MAX_KEYS = 5;

  console.log();
  console.log(chalk.bold('  ─── Aperçu des changements ───────────────────────────'));
  console.log();
  console.log(
    `  ${chalk.cyan('Strings détectées')}  : ${chalk.bold(String(changes.stringsFound))} dans ${changes.filesToRewrite} fichier${changes.filesToRewrite > 1 ? 's' : ''}`,
  );
  console.log(
    `  ${chalk.cyan('Clés générées')}     : ${chalk.bold(String(changes.keysGenerated))} → ${chalk.dim(changes.messagesPath)}`,
  );
  console.log(
    `  ${chalk.cyan('Langues cibles')}    : ${chalk.bold(changes.targetLocales.join(', '))}`,
  );

  if (changes.fileDetails.length > 0) {
    console.log();
    console.log(chalk.bold('  Fichiers à réécrire :'));
    for (const f of changes.fileDetails.slice(0, MAX_FILES)) {
      const count = String(f.stringCount);
      const label = `    ${f.filePath}`;
      console.log(chalk.dim(`${label.padEnd(68)} ${count} string${f.stringCount > 1 ? 's' : ''}`));
    }
    if (changes.fileDetails.length > MAX_FILES) {
      const more = changes.fileDetails.length - MAX_FILES;
      console.log(chalk.dim(`    ... et ${more} autre${more > 1 ? 's' : ''} fichier${more > 1 ? 's' : ''}`));
    }
  }

  if (changes.sampleKeys.length > 0) {
    console.log();
    console.log(chalk.bold('  Extrait des clés :'));
    for (const { value, key } of changes.sampleKeys.slice(0, MAX_KEYS)) {
      const preview = value.length > 45 ? value.slice(0, 45) + '…' : value;
      console.log(chalk.dim(`    "${preview}"  →  ${key}`));
    }
    if (changes.keysGenerated > MAX_KEYS) {
      const more = changes.keysGenerated - MAX_KEYS;
      console.log(chalk.dim(`    ... et ${more} autre${more > 1 ? 's' : ''} clé${more > 1 ? 's' : ''}`));
    }
  }

  console.log();
  console.log(chalk.dim('  ────────────────────────────────────────────────────────'));
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
