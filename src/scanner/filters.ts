export interface FilterOptions {
  /** Valeurs supplémentaires à ignorer (en plus de la liste noire par défaut). */
  additionalBlacklist?: string[];
}

/**
 * Mots-clés techniques qui ne doivent pas être traduits.
 */
const TECHNICAL_KEYWORDS = new Set([
  // CSS display / layout
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid',
  'none', 'hidden', 'visible', 'auto', 'contents', 'table', 'flow-root', 'list-item',
  // CSS position
  'relative', 'absolute', 'fixed', 'sticky', 'static',
  // CSS overflow
  'overflow', 'scroll', 'clip', 'ellipsis',
  // CSS text
  'bold', 'italic', 'normal', 'underline', 'uppercase', 'lowercase', 'capitalize',
  'nowrap', 'break-word', 'break-all',
  // CSS alignement (standalone keywords)
  'center', 'start', 'end', 'stretch', 'baseline', 'between', 'around', 'evenly',
  'left', 'right', 'justify',
  // CSS misc
  'inherit', 'initial', 'revert', 'unset', 'currentColor', 'transparent',
  'full', 'screen', 'fit', 'max', 'min',
  // HTTP methods
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'CONNECT', 'TRACE',
  // HTTP headers
  'Content-Type', 'Content-Length', 'Authorization', 'Accept', 'Accept-Language',
  'Cache-Control', 'Cookie', 'Origin', 'Referer', 'User-Agent', 'X-Requested-With',
  'X-CSRF-Token', 'X-Forwarded-For',
  // Auth token prefixes
  'Bearer', 'Basic', 'Digest',
  // HTML input types
  'text', 'password', 'email', 'number', 'tel', 'url', 'date', 'time', 'datetime-local',
  'search', 'submit', 'button', 'reset', 'hidden', 'checkbox', 'radio',
  'file', 'range', 'color', 'month', 'week', 'image',
  // Boolean-like et valeurs JS primitives
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'undefined',
  // HTML link targets
  '_blank', '_self', '_parent', '_top',
  // Directions de texte
  'ltr', 'rtl',
  // Tokens de taille Tailwind
  'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl',
  // Couleurs CSS courantes
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
  'gray', 'grey', 'black', 'white', 'indigo', 'teal', 'cyan', 'violet',
  'rose', 'amber', 'lime', 'emerald', 'sky', 'fuchsia', 'slate',
  // Types de curseur
  'pointer', 'default', 'cursor', 'move', 'wait', 'not-allowed', 'crosshair', 'grab',
  // Tailwind variant helpers (standalone)
  'hover', 'focus', 'active', 'disabled', 'visited', 'checked', 'required', 'optional',
  // Encodages / formats
  'utf-8', 'utf-16', 'ascii', 'base64', 'gzip', 'deflate', 'br', 'identity',
  // Types d'événements
  'click', 'submit', 'change', 'input', 'blur', 'keydown', 'keyup',
  'mousedown', 'mouseup', 'mouseover', 'mouseout', 'touchstart', 'touchend',
  // Rôles ARIA
  'dialog', 'menu', 'menuitem', 'tab', 'tabpanel', 'alert', 'status', 'tooltip',
  'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'region', 'presentation',
  // Environnements Node / Next.js
  'development', 'production', 'test',
  // Valeurs React/Next courantes
  'lazy', 'eager', 'async', 'sync', 'strict',
]);

// ─── Regexes ────────────────────────────────────────────────────────────────
// Toutes les regexes sont ancrées (^ et $) pour éviter les faux positifs partiels.

/** "42", "-7", "3.14" */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** "16px", "2rem", "100vh", "0.5s" */
const CSS_VALUE_RE = /^-?\d+(\.\d+)?(px|em|rem|vh|vw|vmin|vmax|pt|cm|mm|in|pc|ex|ch|%|s|ms)$/;

/** "#fff", "#ffffff", "#ffffffff" */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** "rgba(255,0,0,0.5)", "hsl(220,100%,50%)", "oklch(...)" */
const CSS_FUNC_COLOR_RE = /^(?:rgb|rgba|hsl|hsla|oklch|lch|lab|color)\(/;

/** "https://...", "http://..." */
const ABSOLUTE_URL_RE = /^https?:\/\//;

/** "mailto:x", "tel:+33...", "data:image/...", "blob:...", "ftp:..." */
const PROTOCOL_URL_RE = /^(?:mailto|tel|ftp|data|blob|ws|wss):/;

/** "//cdn.example.com/..." */
const PROTOCOL_RELATIVE_RE = /^\/\//;

/**
 * Chemin de route : "/dashboard", "/api/users/[id]", "/logo.png", "/about#section".
 * Charset strict : alphanum, tiret, underscore, point, crochets, @, parenthèses.
 * Aucune lettre accentuée → les vraies phrases commençant par "/" ne matcheront pas.
 */
const ROUTE_RE =
  /^\/[a-zA-Z0-9\-_.[\]@()]*(?:\/[a-zA-Z0-9\-_.[\]@()]*)*(?:\?[^#\s]*)?(?:#\S*)?$/;

/**
 * MIME types avec préfixe restreint aux types standard (évite les faux positifs).
 * "application/json", "text/html; charset=utf-8", "image/png"
 */
const MIME_TYPE_RE =
  /^(?:text|image|application|audio|video|font|model|multipart|message)\/[a-z0-9+.\-]+(?:\s*;[^,]*)?$/;

/**
 * Variables d'environnement : SCREAMING_SNAKE avec au moins un underscore.
 * "NODE_ENV", "NEXT_PUBLIC_API_URL" — mais PAS "FAQ" ou "API" (pas d'underscore).
 */
const ENV_VAR_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

// ─── Détection de patterns ───────────────────────────────────────────────────

/**
 * Identifiant camelCase ou PascalCase sans espace.
 * Détecté par la présence d'une transition minuscule → majuscule.
 *
 * Exemples ignorés : "onClick", "onChange", "MyComponent", "firstName"
 * Exemples conservés : "Bonjour" (pas de transition), "FAQ" (pas de minuscule avant)
 */
function isCamelCaseIdentifier(value: string): boolean {
  if (/\s/.test(value)) return false;
  return /[a-z][A-Z]/.test(value);
}

/**
 * Regex pour un token CSS/Tailwind : kebab-case + variants + valeurs arbitraires.
 * Ex: "flex-col", "hover:bg-gray-100", "2xl:hidden", "-translate-x-full", "p-4"
 *
 * Structure : [-]?[a-z0-9]+ suivi de zéro ou plusieurs groupes [-:/][a-z0-9...]+
 * Les séparateurs (-, :, /) sont distincts du contenu → pas de ReDoS.
 */
const CSS_TOKEN_RE = /^-?[a-z0-9]+(?:[-:/][a-z0-9.[\]%!@*+()\s]+)*!?$/;

/**
 * Chaînes de classes CSS multi-tokens (≥ 2 tokens séparés par des espaces).
 * Ex: "flex items-center", "hover:bg-gray-100 focus:outline-none"
 *
 * Règles : tout en minuscules/chiffres, aucun caractère accentué dans les tokens.
 */
function isCssClassString(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  return tokens.every(t => CSS_TOKEN_RE.test(t));
}

/**
 * Token CSS kebab-case unique (un seul token, sans espace).
 * Couvre les utilitaires Tailwind non détectés par TECHNICAL_KEYWORDS.
 * Ex: "p-4", "w-full", "flex-col", "hover:bg-gray-100", "-mt-2"
 *
 * Limites connues : les mots composés français sans accents (ex: "savoir-faire",
 * "arc-en-ciel") sont également filtrés. Ces mots n'apparaissent pratiquement
 * jamais comme valeurs JSX standalone en dehors d'un contexte de classes CSS.
 */
function isSingleCssToken(value: string): boolean {
  // Présence d'espaces ou de caractères accentués → texte humain, conserver
  if (/[\s\u00C0-\u024F\u1E00-\u1EFF]/.test(value)) return false;
  // Présence de majuscule → pas un token CSS standard
  if (/[A-Z]/.test(value)) return false;
  // Apostrophes ou ponctuation typique du texte → conserver
  if (/['"''`]/.test(value)) return false;
  // Doit contenir au moins un séparateur (tiret ou deux-points)
  if (!/-|:/.test(value)) return false;
  // Valide le format token CSS/Tailwind
  return CSS_TOKEN_RE.test(value);
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

/**
 * Retourne `true` si la string doit être ignorée (non traduite).
 *
 * Ordre des vérifications (du plus rapide au plus coûteux) :
 * 1.  Vide
 * 2.  Numérique
 * 3.  Valeur CSS avec unité
 * 4.  Couleur hexadécimale
 * 5.  Couleur CSS fonctionnelle (rgb, hsl…)
 * 6.  URL absolue (https://, http://)
 * 7.  URL avec protocole spécial (mailto:, tel:, data:…)
 * 8.  URL relative au protocole (//)
 * 9.  Chemin de route (/dashboard, /logo.png)
 * 10. Type MIME (application/json)
 * 11. Variable d'environnement (NODE_ENV)
 * 12. Mot-clé technique (flex, POST, hidden…)
 * 13. Identifiant camelCase (onClick, MyComponent)
 * 14. Token CSS kebab-case unique (p-4, w-full)
 * 15. Chaîne de classes CSS multi-tokens (flex items-center)
 * 16. Liste noire personnalisée
 */
export function shouldIgnore(value: string, options?: FilterOptions): boolean {
  const trimmed = value.trim();

  if (!trimmed) return true;
  if (NUMERIC_RE.test(trimmed)) return true;
  if (CSS_VALUE_RE.test(trimmed)) return true;
  if (HEX_COLOR_RE.test(trimmed)) return true;
  if (CSS_FUNC_COLOR_RE.test(trimmed)) return true;
  if (ABSOLUTE_URL_RE.test(trimmed)) return true;
  if (PROTOCOL_URL_RE.test(trimmed)) return true;
  if (PROTOCOL_RELATIVE_RE.test(trimmed)) return true;
  if (trimmed.length > 1 && ROUTE_RE.test(trimmed)) return true;
  if (MIME_TYPE_RE.test(trimmed)) return true;
  if (ENV_VAR_RE.test(trimmed)) return true;
  if (TECHNICAL_KEYWORDS.has(trimmed)) return true;
  if (isCamelCaseIdentifier(trimmed)) return true;
  if (isSingleCssToken(trimmed)) return true;
  if (isCssClassString(trimmed)) return true;
  if (options?.additionalBlacklist?.includes(trimmed)) return true;

  return false;
}
