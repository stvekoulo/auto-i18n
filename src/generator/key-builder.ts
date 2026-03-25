/** Longueur maximale d'une clé i18n générée. */
const MAX_KEY_LENGTH = 40;

/**
 * Génère une clé i18n brute à partir d'une string traduite.
 * @example
 * rawKey("Bonjour")                          // "bonjour"
 * rawKey("Bienvenue sur notre site !")       // "bienvenue_sur_notre_site"
 * rawKey("Salut {name}")                     // "salut_name"
 * rawKey("Bonjour {user.name}, bienvenue !") // "bonjour_user_name_bienvenue"
 */
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

/**
 * Registre de clés i18n déjà utilisées dans une session de génération.
 * @example
 * const reg = new KeyRegistry();
 * reg.resolve("bonjour")  // "bonjour"  (première occurrence)
 * reg.resolve("bonjour")  // "bonjour_2" (collision)
 * reg.resolve("bonjour")  // "bonjour_3"
 */
export class KeyRegistry {
  private readonly usedKeys = new Set<string>();

  /**
   * Retourne `baseKey` si disponible, sinon `baseKey_2`, `baseKey_3`…
   * Enregistre et retourne la clé résolue.
   */
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
