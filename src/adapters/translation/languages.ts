import { REQUEST_TIMEOUT_MS, TranslationError, redactSecret } from './types.js';

export interface SupportedLanguage {
  language: string;
  name?: string;
}

export async function listProviderLanguages(
  provider: 'deepl' | 'google',
  key: string,
  type: 'source' | 'target',
): Promise<SupportedLanguage[]> {
  const base = key.trimEnd().endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';
  const url =
    provider === 'deepl'
      ? `${base}/v2/languages?type=${type}`
      : 'https://translation.googleapis.com/language/translate/v2/languages';
  const headers: Record<string, string> =
    provider === 'deepl' ? { Authorization: `DeepL-Auth-Key ${key}` } : { 'x-goog-api-key': key };
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TranslationError(
      `Découverte des langues : ${redactSecret(String(error), key)}`,
      'network',
      true,
    );
  }
  if (!response.ok)
    throw new TranslationError(
      `Découverte des langues ${provider} impossible (${response.status}).`,
      response.status === 403 ? 'auth' : 'provider',
      response.status >= 500,
      response.status,
    );
  const data = (await response.json()) as { data?: { languages?: unknown } };
  const rows: unknown = provider === 'deepl' ? data : data?.data?.languages;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.language !== 'string')) {
    throw new TranslationError('Liste de langues invalide.', 'provider', false);
  }
  return rows.map((row: SupportedLanguage) => ({
    language: row.language,
    ...(typeof row.name === 'string' ? { name: row.name } : {}),
  }));
}
