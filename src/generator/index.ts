import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { type ExtractedString } from '../scanner/string-extractor.js';
import { rawKey } from './key-builder.js';

export type { ExtractedString } from '../scanner/string-extractor.js';

export interface GenerateOptions {
  /** Locale de la langue source (ex: "fr"). */
  sourceLocale: string;
  messagesDir: string;
  /**
   * Messages existants à préserver (pour sync incrémental).
   * Les clés existantes sont conservées ; seules les nouvelles strings reçoivent de nouvelles clés.
   * Le JSON résultant contient TOUS les messages (existants + nouveaux).
   */
  existingMessages?: Record<string, string>;
}

export interface GenerateResult {
  /**
   * Mapping valeur originale → clé i18n.
   * Utilisé par le rewriter pour savoir quelle clé injecter.
   */
  keyMap: Map<string, string>;
  messages: Record<string, string>;
  outputPath: string;
  newCount: number;
}

/**
 * Génère le fichier de traduction source à partir de la liste de strings extraites.
 *
 * En mode incrémental (existingMessages fourni) :
 *   - Les strings déjà présentes gardent leur clé existante (stable pour le code).
 *   - Les nouvelles strings reçoivent une clé unique qui n'entre pas en collision.
 *   - Le JSON résultant contient toutes les entrées (existantes + nouvelles).
 */
export async function generateMessages(
  strings: ExtractedString[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { sourceLocale, messagesDir, existingMessages = {} } = options;

  // Map inverse : valeur existante → clé
  const existingValueToKey = new Map<string, string>();
  for (const [key, value] of Object.entries(existingMessages)) {
    existingValueToKey.set(value, key);
  }

  const takenKeys = new Set(Object.keys(existingMessages));

  const uniqueValues: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    if (!seen.has(s.value)) {
      seen.add(s.value);
      uniqueValues.push(s.value);
    }
  }

  const keyMap = new Map<string, string>();
  let newCount = 0;

  for (const value of uniqueValues) {
    const existingKey = existingValueToKey.get(value);
    if (existingKey) {
      keyMap.set(value, existingKey);
      continue;
    }

    const base = rawKey(value);
    let key = base;
    let n = 2;
    while (takenKeys.has(key)) {
      key = `${base}_${n++}`;
    }
    takenKeys.add(key);
    keyMap.set(value, key);
    newCount++;
  }

  // Messages finaux = messages existants (préservés) + nouvelles entrées
  const messages: Record<string, string> = { ...existingMessages };
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

  return { keyMap, messages: sortedMessages, outputPath, newCount };
}
