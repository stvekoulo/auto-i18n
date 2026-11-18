/**
 * Lecture et écriture atomique du registre d'empreintes `.auto-i18n-hashes.json`.
 */

import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const SOURCE_HASHES_FILENAME = '.auto-i18n-hashes.json';

export async function readSourceHashes(messagesDir: string): Promise<Record<string, string>> {
  const filePath = join(messagesDir, SOURCE_HASHES_FILENAME);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k !== '__proto__' && typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeSourceHashes(
  messagesDir: string,
  hashes: Record<string, string>,
): Promise<void> {
  const filePath = join(messagesDir, SOURCE_HASHES_FILENAME);
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmpPath, JSON.stringify(hashes, null, 2) + '\n', {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await rename(tmpPath, filePath);
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}
