import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { type ExtractedString } from '../scanner/string-extractor.js';
import { rawKey, KeyRegistry } from './key-builder.js';

export type { ExtractedString } from '../scanner/string-extractor.js';

export interface GenerateOptions {
  /** Locale de la langue source (ex: "fr"). */
  sourceLocale: string;
  /** Chemin du dossier messages (ex: "./messages"). */
  messagesDir: string;
}

export interface GenerateResult {
  /**
   * Mapping valeur originale → clé i18n.
   * Utilisé par le rewriter pour savoir quelle clé injecter.
   */
  keyMap: Map<string, string>;
  /** Contenu JSON écrit dans le fichier source (clé → valeur). */
  messages: Record<string, string>;
  /** Chemin absolu du fichier JSON généré. */
  outputPath: string;
}

/**
 * Génère le fichier de traduction source à partir de la liste de strings extraites.
 */
export async function generateMessages(
  strings: ExtractedString[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { sourceLocale, messagesDir } = options;

  const uniqueValues: string[] = [];
  const seen = new Set<string>();

  for (const s of strings) {
    if (!seen.has(s.value)) {
      seen.add(s.value);
      uniqueValues.push(s.value);
    }
  }

  const registry = new KeyRegistry();
  const keyMap = new Map<string, string>();

  for (const value of uniqueValues) {
    const base = rawKey(value);
    const key = registry.resolve(base);
    keyMap.set(value, key);
  }

  const messages: Record<string, string> = {};
  for (const [value, key] of keyMap) {
    messages[key] = value;
  }

  const sortedMessages = Object.fromEntries(
    Object.entries(messages).sort(([a], [b]) => a.localeCompare(b)),
  );

  const absMessagesDir = resolve(messagesDir);
  await mkdir(absMessagesDir, { recursive: true });

  const outputPath = join(absMessagesDir, `${sourceLocale}.json`);
  await writeFile(outputPath, JSON.stringify(sortedMessages, null, 2) + '\n', 'utf-8');

  return { keyMap, messages: sortedMessages, outputPath };
}
