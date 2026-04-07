import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { type ExtractedString } from '../scanner/string-extractor.js';
import { rawKey } from './key-builder.js';

export type { ExtractedString } from '../scanner/string-extractor.js';

export interface GenerateOptions {
  /** Locale de la langue source (ex: "fr"). */
  sourceLocale: string;
  messagesDir: string;
  existingMessages?: Record<string, string>;
}

export interface GenerateResult {
  keyMap: Map<string, string>;
  messages: Record<string, string>;
  outputPath: string;
  newCount: number;
}

export interface ResolvedMessages {
  keyMap: Map<string, string>;
  messages: Record<string, string>;
  newCount: number;
}

export function resolveMessages(
  strings: ExtractedString[],
  existingMessages: Record<string, string> = {},
): ResolvedMessages {
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

  const messages: Record<string, string> = { ...existingMessages };
  for (const [value, key] of keyMap) {
    messages[key] = value;
  }

  const sortedMessages = Object.fromEntries(
    Object.entries(messages).sort(([a], [b]) => a.localeCompare(b)),
  );

  return { keyMap, messages: sortedMessages, newCount };
}

export async function writeMessages(
  sourceLocale: string,
  messagesDir: string,
  resolved: ResolvedMessages,
): Promise<string> {
  const { messages } = resolved;

  const absMessagesDir = resolve(messagesDir);
  await mkdir(absMessagesDir, { recursive: true });

  const outputPath = join(absMessagesDir, `${sourceLocale}.json`);
  await writeFile(outputPath, JSON.stringify(messages, null, 2) + '\n', 'utf-8');

  return outputPath;
}

export async function generateMessages(
  strings: ExtractedString[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { sourceLocale, messagesDir, existingMessages = {} } = options;
  const resolved = resolveMessages(strings, existingMessages);
  const outputPath = await writeMessages(sourceLocale, messagesDir, resolved);

  return { ...resolved, outputPath };
}
