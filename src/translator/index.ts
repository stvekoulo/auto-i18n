import { readFile, writeFile, access } from 'fs/promises';
import { join, resolve } from 'path';
import ora from 'ora';
import { translate, type TranslateOptions } from './deepl.js';

export { DeepLError } from './deepl.js';

export interface TranslateMessagesOptions {
  /** Locale de la langue source (ex: "fr"). */
  sourceLocale: string;
  /** Locales des langues cibles (ex: ["en", "es", "de"]). */
  targetLocales: string[];
  /** Chemin vers le dossier messages/ contenant les fichiers JSON. */
  messagesDir: string;
  /** Clé API DeepL (si absent, lit AUTO_I18N_DEEPL_KEY). */
  apiKey?: string;
  /** Supprime le spinner terminal — utile pour les tests ou les CI. */
  silent?: boolean;
}

export interface TranslateMessagesResult {
  /** Nombre total de strings nouvellement traduites. */
  totalTranslated: number;
  /** Locales qui avaient déjà toutes leurs clés (non retraitées). */
  skipped: string[];
}

/**
 * Traduit le fichier source `{messagesDir}/{sourceLocale}.json` vers chaque
 * langue cible et écrit les fichiers `{messagesDir}/{targetLocale}.json`.
 *
 * Mode incrémental : si un fichier cible existe déjà, seules les clés
 * absentes sont envoyées à DeepL — les traductions existantes sont conservées.
 */
export async function translateMessages(
  options: TranslateMessagesOptions,
): Promise<TranslateMessagesResult> {
  const { sourceLocale, targetLocales, messagesDir, apiKey, silent = false } = options;

  // ─── Lecture du fichier source ───────────────────────────────────────────────
  const absDir = resolve(messagesDir);
  const sourcePath = join(absDir, `${sourceLocale}.json`);
  const sourceRaw = await readFile(sourcePath, 'utf-8');
  const sourceMessages = JSON.parse(sourceRaw) as Record<string, string>;
  const allKeys = Object.keys(sourceMessages);

  const translateOptions: TranslateOptions = { apiKey, sourceLang: sourceLocale };

  let totalTranslated = 0;
  const skipped: string[] = [];

  // ─── Traduction par locale cible ────────────────────────────────────────────
  for (const targetLocale of targetLocales) {
    const targetPath = join(absDir, `${targetLocale}.json`);

    // Mode incrémental : charge les traductions existantes si le fichier existe
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

      // Fusionne les traductions existantes + nouvelles
      const merged: Record<string, string> = { ...existing };
      for (let i = 0; i < missingKeys.length; i++) {
        merged[missingKeys[i]] = translations[i];
      }

      // Trie les clés pour un diff git stable
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
