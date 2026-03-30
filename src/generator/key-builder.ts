const MAX_KEY_LENGTH = 60;

export function rawKey(value: string): string {
  let key = value;

  key = key.replace(/[${}]/g, ' ');

  key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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

export class KeyRegistry {
  private readonly usedKeys = new Set<string>();

  resolve(baseKey: string): string {
    if (!this.usedKeys.has(baseKey)) {
      this.usedKeys.add(baseKey);
      return baseKey;
    }

    let suffix = 2;
    while (this.usedKeys.has(`${baseKey}_${suffix}`)) suffix++;

    const resolved = `${baseKey}_${suffix}`;
    this.usedKeys.add(resolved);
    return resolved;
  }

  has(key: string): boolean {
    return this.usedKeys.has(key);
  }

  get size(): number {
    return this.usedKeys.size;
  }
}
