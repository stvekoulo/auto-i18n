/** Erreur spécifique au client DeepL avec code HTTP optionnel. */
export class DeepLError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'DeepLError';
  }
}

const DEEPL_FREE_API = 'https://api-free.deepl.com/v2/translate';
const DEEPL_PRO_API = 'https://api.deepl.com/v2/translate';

/** Nombre maximum de textes par requête (limite pratique recommandée). */
export const BATCH_SIZE = 50;

/** Les clés du plan gratuit se terminent par ":fx". */
function getApiUrl(apiKey: string): string {
  return apiKey.trimEnd().endsWith(':fx') ? DEEPL_FREE_API : DEEPL_PRO_API;
}

/**
 * Protège les placeholders next-intl `{varname}` avant envoi à DeepL.
 *
 * Stratégie :
 * 1. Échappe les caractères XML spéciaux du texte libre (`&`, `<`, `>`)
 * 2. Enveloppe chaque `{varname}` dans `<x>varname</x>`
 *    → DeepL préserve le contenu des balises `<x>` (ignore_tags)
 *
 * @example
 * protectPlaceholders("Salut {name} !")
 * // → "Salut <x>name</x> !"
 *
 * protectPlaceholders("Prix : 5 € & {count} articles")
 * // → "Prix : 5 € &amp; <x>count</x> articles"
 */
function protectPlaceholders(text: string): string {
  // Échappe seulement & < > hors de nos balises — ordre important : & en premier
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Wraps {varname} → <x>varname</x>
  return escaped.replace(/\{([^}]+)\}/g, (_, name: string) => `<x>${name}</x>`);
}

/**
 * Restaure les placeholders `{varname}` depuis les balises `<x>` retournées par DeepL.
 * Déséchappe également les entités XML du texte libre.
 */
function restorePlaceholders(text: string): string {
  const restored = text.replace(/<x>\s*([^<]*?)\s*<\/x>/gi, '{$1}');
  return restored
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

interface DeepLResponse {
  translations: Array<{ text: string; detected_source_language: string }>;
}

async function translateBatch(
  texts: string[],
  targetLang: string,
  apiKey: string,
  sourceLang?: string,
): Promise<string[]> {
  const url = getApiUrl(apiKey);
  const protectedTexts = texts.map(protectPlaceholders);

  const body: Record<string, unknown> = {
    text: protectedTexts,
    target_lang: targetLang.toUpperCase(),
    tag_handling: 'xml',
    tag_handling_version: 'v2',
    ignore_tags: ['x'],
  };
  if (sourceLang) body['source_lang'] = sourceLang.toUpperCase();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new DeepLError(
      `Erreur réseau : impossible de contacter l'API DeepL.\n` +
        `Vérifiez votre connexion. (${String(err)})`,
    );
  }

  if (!response.ok) {
    const status = response.status;
    switch (status) {
      case 403:
        throw new DeepLError(
          `Clé API DeepL invalide ou non autorisée (403).\n` +
            `Vérifiez AUTO_I18N_DEEPL_KEY dans votre .env.local.\n` +
            `Obtenez une clé gratuite sur https://www.deepl.com/fr/pro#developer`,
          status,
        );
      case 456:
        throw new DeepLError(
          `Quota DeepL dépassé pour ce mois (456).\n` +
            `Le plan gratuit offre 500 000 caractères/mois.\n` +
            `Réinitialisé au 1er du mois ou passez au plan Pro.`,
          status,
        );
      case 429:
        throw new DeepLError(
          `Trop de requêtes DeepL (429). Réessayez dans quelques secondes.`,
          status,
        );
      case 400:
        throw new DeepLError(`Requête DeepL invalide (400). Vérifiez le code de langue cible.`, status);
      default: {
        const detail = await response.text().catch(() => '');
        throw new DeepLError(`Erreur DeepL inattendue (${status}): ${detail}`, status);
      }
    }
  }

  const data = (await response.json()) as DeepLResponse;
  return data.translations.map(t => restorePlaceholders(t.text));
}

export interface TranslateOptions {
  /** Clé API DeepL. Si absent, lit AUTO_I18N_DEEPL_KEY dans process.env. */
  apiKey?: string;
  /** Code langue source (ex: "fr"). Améliore la qualité si fourni. */
  sourceLang?: string;
}

/**
 * Traduit un tableau de textes vers `targetLang` via l'API DeepL.
 *
 * - Lit la clé depuis `options.apiKey` ou `process.env.AUTO_I18N_DEEPL_KEY`
 * - Protège les placeholders `{varname}` (format next-intl) — non traduits
 * - Découpe automatiquement en batches de `BATCH_SIZE` strings
 *
 * @param texts      Textes à traduire (peut contenir des placeholders `{name}`)
 * @param targetLang Code langue DeepL cible (ex: "EN", "ES", "DE")
 * @param options    Clé API et langue source optionnels
 */
export async function translate(
  texts: string[],
  targetLang: string,
  options: TranslateOptions = {},
): Promise<string[]> {
  if (texts.length === 0) return [];

  const apiKey = options.apiKey ?? process.env['AUTO_I18N_DEEPL_KEY'];
  if (!apiKey?.trim()) {
    throw new DeepLError(
      `Clé API DeepL manquante.\n` +
        `Ajoutez AUTO_I18N_DEEPL_KEY=votre-clé dans .env.local\n` +
        `Obtenez une clé gratuite sur https://www.deepl.com/fr/pro#developer`,
    );
  }

  const results: string[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const translated = await translateBatch(batch, targetLang, apiKey, options.sourceLang);
    results.push(...translated);
  }
  return results;
}
