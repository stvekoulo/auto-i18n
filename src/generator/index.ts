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
 *
 * Étapes :
 * 1. Déduplique les strings (même valeur → même clé)
 * 2. Construit une clé unique pour chaque valeur via `rawKey` + `KeyRegistry`
 * 3. Trie les clés alphabétiquement (diff git stable)
 * 4. Crée `messagesDir` si absent
 * 5. Écrit `{messagesDir}/{sourceLocale}.json`
 * 6. Retourne `keyMap` pour le rewriter et `messages` pour la traduction
 */
export async function generateMessages(
  strings: ExtractedString[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { sourceLocale, messagesDir } = options;

  // ─── 1. Déduplication ────────────────────────────────────────────────────────
  // On indexe par valeur exacte. La première occurrence détermine l'ordre.
  const uniqueValues: string[] = [];
  const seen = new Set<string>();

  for (const s of strings) {
    if (!seen.has(s.value)) {
      seen.add(s.value);
      uniqueValues.push(s.value);
    }
  }

  // ─── 2. Construction des clés ────────────────────────────────────────────────
  const registry = new KeyRegistry();
  const keyMap = new Map<string, string>();

  for (const value of uniqueValues) {
    const base = rawKey(value);
    const key = registry.resolve(base);
    keyMap.set(value, key);
  }

  // ─── 3. Objet messages trié alphabétiquement ─────────────────────────────────
  const messages: Record<string, string> = {};
  for (const [value, key] of keyMap) {
    messages[key] = value;
  }

  const sortedMessages = Object.fromEntries(
    Object.entries(messages).sort(([a], [b]) => a.localeCompare(b)),
  );

  // ─── 4 & 5. Écriture du fichier JSON ─────────────────────────────────────────
  const absMessagesDir = resolve(messagesDir);
  await mkdir(absMessagesDir, { recursive: true });

  const outputPath = join(absMessagesDir, `${sourceLocale}.json`);
  await writeFile(outputPath, JSON.stringify(sortedMessages, null, 2) + '\n', 'utf-8');

  return { keyMap, messages: sortedMessages, outputPath };
}
