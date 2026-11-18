/**
 * Génération déterministe des clés i18n à partir du texte source (et namespace optionnel).
 */

import { basename, dirname, extname } from 'node:path';

const MAX_KEY_LENGTH = 60;
const GENERIC_FILENAMES = new Set(['index', 'page', 'layout', '_layout', 'route', 'default']);

export function buildKey(value: string): string {
  let key = value;
  key = key.replace(/[${}]/g, ' ');
  key = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  key = key.toLowerCase();
  key = key.replace(/[^a-z0-9]+/g, '_');
  key = key.replace(/^_+|_+$/g, '');

  if (key.length > MAX_KEY_LENGTH) {
    const truncated = key.slice(0, MAX_KEY_LENGTH);
    const lastUnderscore = truncated.lastIndexOf('_');
    key = lastUnderscore > 0 ? truncated.slice(0, lastUnderscore) : truncated;
  }

  return key || 'key';
}

function toPascalIdentifier(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\[|\]$/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return 'Common';
  return cleaned
    .split(/\s+/)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/** Dérive un nom de namespace propre depuis le chemin d'un fichier composant/route. */
export function namespaceFromFilePath(filePath: string): string {
  const stem = basename(filePath, extname(filePath));
  if (!GENERIC_FILENAMES.has(stem.toLowerCase())) {
    return toPascalIdentifier(stem);
  }
  const parent = basename(dirname(filePath));
  if (parent && !parent.startsWith('[') && parent !== 'app' && parent !== 'src' && parent !== '.') {
    return toPascalIdentifier(parent);
  }
  return toPascalIdentifier(stem);
}

/** Alloue des clés uniques en désambiguïsant les collisions (`base`, `base_2`, …). */
export class KeyAllocator {
  private readonly used: Set<string>;

  constructor(reservedKeys: Iterable<string> = []) {
    this.used = new Set(reservedKeys);
  }

  allocate(value: string, namespace?: string): string {
    const leaf = buildKey(value);
    const base = namespace ? `${namespace}.${leaf}` : leaf;
    if (!this.used.has(base)) {
      this.used.add(base);
      return base;
    }

    let suffix = 2;
    while (this.used.has(`${base}_${suffix}`)) suffix++;

    const resolved = `${base}_${suffix}`;
    this.used.add(resolved);
    return resolved;
  }

  has(key: string): boolean {
    return this.used.has(key);
  }

  get size(): number {
    return this.used.size;
  }
}
