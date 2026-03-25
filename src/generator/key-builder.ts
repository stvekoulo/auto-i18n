/** Longueur maximale d'une clé i18n générée. */
const MAX_KEY_LENGTH = 40;

/**
 * Génère une clé i18n brute à partir d'une string traduite.
 *
 * Transformations appliquées dans l'ordre :
 * 1. Retire les marqueurs de template literals (`$`, `{`, `}`) — conserve le contenu
 * 2. Normalise les caractères accentués (é→e, à→a, ç→c…)
 * 3. Met en minuscules
 * 4. Remplace toute séquence de caractères non-alphanumériques par `_`
 * 5. Supprime les underscores en début et fin
 * 6. Tronque à `MAX_KEY_LENGTH` caractères à la dernière frontière de mot
 * 7. Fallback `"key"` si le résultat est vide
 *
 * @example
 * rawKey("Bonjour")                          // "bonjour"
 * rawKey("Bienvenue sur notre site !")       // "bienvenue_sur_notre_site"
 * rawKey("Salut {name}")                     // "salut_name"
 * rawKey("Bonjour {user.name}, bienvenue !") // "bonjour_user_name_bienvenue"
 */
export function rawKey(value: string): string {
  let key = value;

  // 1. Retire les marqueurs de template mais conserve le texte des variables
  //    "{name}" → " name ", "${count}" → "  count  "
  key = key.replace(/[${}]/g, ' ');

  // 2. Décompose les caractères accentués puis supprime les diacritiques
  key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 3. Minuscules
  key = key.toLowerCase();

  // 4. Toute séquence non-alphanumérique → underscore
  key = key.replace(/[^a-z0-9]+/g, '_');

  // 5. Supprime les underscores en tête et queue
  key = key.replace(/^_+|_+$/g, '');

  // 6. Tronque à la dernière frontière de mot avant MAX_KEY_LENGTH
  if (key.length > MAX_KEY_LENGTH) {
    const truncated = key.slice(0, MAX_KEY_LENGTH);
    const lastUnderscore = truncated.lastIndexOf('_');
    key = lastUnderscore > 0 ? truncated.slice(0, lastUnderscore) : truncated;
  }

  // 7. Fallback
  return key || 'key';
}

/**
 * Registre de clés i18n déjà utilisées dans une session de génération.
 *
 * Garantit l'unicité des clés : si deux valeurs différentes produisent la même
 * clé brute, la seconde reçoit un suffixe `_2`, `_3`…
 *
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
