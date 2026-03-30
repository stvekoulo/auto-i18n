export interface FilterOptions {
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

/** "42", "-7", "3.14" */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * Nombre avec préfixe/suffixe simple (currency, %, +).
 * Ex: "29€", "1500+", "$99", "50%", "3×", "100k", "€29"
 */
const NUMERIC_WITH_AFFIX_RE =
  /^[€$£¥₩₹฿]?\s*\d[\d\s.,]*\s*[€$£¥₩₹฿%+×xkKmMbB]*[+]?$|^[€$£¥₩₹฿]\s*\d[\d\s.,]*$/;

/**
 * String composée uniquement d'emojis, symboles ou ponctuation
 * Ex: "🏋️", "🥊", "✓", "★", "→"
 */
function isSymbolOrEmojiOnly(value: string): boolean {
  if (!value.trim()) return false;
  const stripped = value.replace(
    /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Symbol}\s]/gu,
    '',
  );
  return stripped.length === 0;
}

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

const ROUTE_RE =
  /^\/[a-zA-Z0-9\-_.[\]@()]*(?:\/[a-zA-Z0-9\-_.[\]@()]*)*(?:\?[^#\s]*)?(?:#\S*)?$/;

const MIME_TYPE_RE =
  /^(?:text|image|application|audio|video|font|model|multipart|message)\/[a-z0-9+.\-]+(?:\s*;[^,]*)?$/;

const ENV_VAR_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function isCamelCaseIdentifier(value: string): boolean {
  if (/\s/.test(value)) return false;
  return /[a-z][A-Z]/.test(value);
}

const CSS_TOKEN_RE = /^-?[a-z0-9]+(?:[-:/][a-z0-9.[\]%!@*+()\s]+)*!?$/;

function isCssClassString(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  return tokens.every(t => CSS_TOKEN_RE.test(t));
}

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

/**
 * Retourne `true` si la string doit être ignorée.
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
  if (NUMERIC_WITH_AFFIX_RE.test(trimmed)) return true;
  if (isSymbolOrEmojiOnly(trimmed)) return true;
  if (TECHNICAL_KEYWORDS.has(trimmed)) return true;
  if (isCamelCaseIdentifier(trimmed)) return true;
  if (isSingleCssToken(trimmed)) return true;
  if (isCssClassString(trimmed)) return true;
  if (options?.additionalBlacklist?.includes(trimmed)) return true;

  return false;
}
