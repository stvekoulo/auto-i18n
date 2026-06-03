/**
 * Génération déterministe des clés i18n à partir du texte source.
 *
 * Même entrée → même clé. Aucune dépendance I/O.
 */

const MAX_KEY_LENGTH = 60;

/**
 * Transforme une valeur de string en clé de base (`snake_case`, sans accents).
 * Ne gère pas l'unicité : utiliser {@link KeyAllocator} pour ça.
 */
export function buildKey(value: string): string {
  let key = value;

  // Placeholders `{var}` → espace (séparateur de mots).
  key = key.replace(/[${}]/g, ' ');
  // Décomposition + suppression des diacritiques (U+0300–U+036F).
  key = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  key = key.toLowerCase();
  // Tout caractère non alphanumérique → underscore.
  key = key.replace(/[^a-z0-9]+/g, '_');
  key = key.replace(/^_+|_+$/g, '');

  if (key.length > MAX_KEY_LENGTH) {
    const truncated = key.slice(0, MAX_KEY_LENGTH);
    const lastUnderscore = truncated.lastIndexOf('_');
    key = lastUnderscore > 0 ? truncated.slice(0, lastUnderscore) : truncated;
  }

  return key || 'key';
}

/**
 * Alloue des clés uniques en désambiguïsant les collisions (`base`, `base_2`, …).
 * Peut être amorcé avec des clés déjà prises (merge incrémental).
 */
export class KeyAllocator {
  private readonly used: Set<string>;

  constructor(reservedKeys: Iterable<string> = []) {
    this.used = new Set(reservedKeys);
  }

  /** Renvoie une clé unique dérivée de `value`. */
  allocate(value: string): string {
    const base = buildKey(value);
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
