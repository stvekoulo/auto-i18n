import { readFile, writeFile, access } from 'fs/promises';
import { join, resolve } from 'path';
import ora from 'ora';
import { translate, type TranslateOptions } from './deepl.js';

export { DeepLError } from './deepl.js';

export interface TranslateMessagesOptions {
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  apiKey?: string;
  silent?: boolean;
}

export interface TranslateMessagesResult {
  totalTranslated: number;
  skipped: string[];
}

export async function translateMessages(
  options: TranslateMessagesOptions,
): Promise<TranslateMessagesResult> {
  const { sourceLocale, targetLocales, messagesDir, apiKey, silent = false } = options;

  const absDir = resolve(messagesDir);
  const sourcePath = join(absDir, `${sourceLocale}.json`);
  const sourceRaw = await readFile(sourcePath, 'utf-8');
  const sourceMessages = JSON.parse(sourceRaw) as Record<string, string>;
  const allKeys = Object.keys(sourceMessages);

  const translateOptions: TranslateOptions = { apiKey, sourceLang: sourceLocale };

  let totalTranslated = 0;
  const skipped: string[] = [];

  for (const targetLocale of targetLocales) {
    const targetPath = join(absDir, `${targetLocale}.json`);

    let existing: Record<string, string> = {};
    try {
      await access(targetPath);
      const existingRaw = await readFile(targetPath, 'utf-8');
      existing = JSON.parse(existingRaw) as Record<string, string>;
    } catch {
      // Fichier absent → on traduit tout
    }

    const missingKeys = allKeys.filter(k => !(k in existing));

    if (missingKeys.length === 0) {
      if (!silent) console.log(`  ✓ ${targetLocale} — déjà à jour`);
      skipped.push(targetLocale);
      continue;
    }

    const label = `Traduction ${targetLocale.toUpperCase()}... (${missingKeys.length} strings)`;
    const spinner = silent ? null : ora(label).start();

    try {
      const textsToTranslate = missingKeys.map(k => sourceMessages[k]);
      const translations = await translate(textsToTranslate, targetLocale, translateOptions);

      const merged: Record<string, string> = { ...existing };
      for (let i = 0; i < missingKeys.length; i++) {
        merged[missingKeys[i]] = translations[i];
      }

      const sorted = Object.fromEntries(
        Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
      );

      await writeFile(targetPath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');

      spinner?.succeed(`✓ Traduction ${targetLocale.toUpperCase()} (${missingKeys.length} strings)`);
      totalTranslated += missingKeys.length;
    } catch (err) {
      spinner?.fail(`Erreur traduction ${targetLocale.toUpperCase()}`);
      throw err;
    }
  }

  return { totalTranslated, skipped };
}