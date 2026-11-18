/**
 * Heuristiques pour écarter les strings non traduisibles (techniques, CSS, URLs…).
 *
 * Module pur : entrée = valeur de string (+ kind optionnel), sortie = raison d'ignorer (ou `null`).
 */

import type { StringKind } from '../types.js';

export interface FilterOptions {
  /** Valeurs supplémentaires à toujours ignorer (configurable par l'utilisateur). */
  blacklist?: string[];
  /** Nature syntaxique du nœud source, permettant d'éviter les faux positifs CSS sur le texte JSX. */
  kind?: StringKind;
}

export type IgnoreReason =
  | 'empty'
  | 'numeric'
  | 'css_value'
  | 'hex_color'
  | 'css_function_color'
  | 'absolute_url'
  | 'protocol_url'
  | 'protocol_relative_url'
  | 'route'
  | 'mime_type'
  | 'env_var'
  | 'numeric_with_affix'
  | 'symbol_or_emoji'
  | 'technical_keyword'
  | 'camel_case_identifier'
  | 'single_css_token'
  | 'css_class_string'
  | 'blacklist';

/** Mots-clés techniques qui ne doivent jamais être traduits isolément. */
// prettier-ignore
const TECHNICAL_KEYWORDS = new Set([
  // CSS display / layout
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid',
  'none', 'hidden', 'visible', 'auto', 'contents', 'table', 'flow-root', 'list-item',
  // CSS position & overflow
  'relative', 'absolute', 'fixed', 'sticky', 'static',
  'overflow', 'scroll', 'clip', 'ellipsis', 'truncate', 'antialiased', 'prose', 'container',
  // CSS text & alignement
  'bold', 'italic', 'normal', 'underline', 'uppercase', 'lowercase', 'capitalize',
  'nowrap', 'break-word', 'break-all',
  'center', 'start', 'end', 'stretch', 'baseline', 'between', 'around', 'evenly',
  'left', 'right', 'justify',
  // CSS misc
  'inherit', 'initial', 'revert', 'unset', 'currentColor', 'transparent',
  'full', 'screen', 'fit', 'max', 'min',
  // HTTP methods & headers
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'CONNECT', 'TRACE',
  'Content-Type', 'Content-Length', 'Authorization', 'Accept', 'Accept-Language',
  'Cache-Control', 'Cookie', 'Origin', 'Referer', 'User-Agent', 'X-Requested-With',
  'X-CSRF-Token', 'X-Forwarded-For', 'Bearer', 'Basic', 'Digest',
  // HTML input types & targets
  'text', 'password', 'email', 'number', 'tel', 'url', 'date', 'time', 'datetime-local',
  'search', 'submit', 'button', 'reset', 'checkbox', 'radio',
  'file', 'range', 'color', 'month', 'week', 'image',
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'undefined',
  '_blank', '_self', '_parent', '_top', 'ltr', 'rtl',
  // Tokens Tailwind & couleurs
  'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl',
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
  'gray', 'grey', 'black', 'white', 'indigo', 'teal', 'cyan', 'violet',
  'rose', 'amber', 'lime', 'emerald', 'sky', 'fuchsia', 'slate',
  // Curseurs, états, formats, événements, ARIA, env
  'pointer', 'default', 'cursor', 'move', 'wait', 'not-allowed', 'crosshair', 'grab',
  'hover', 'focus', 'active', 'disabled', 'visited', 'checked', 'required', 'optional',
  'utf-8', 'utf-16', 'ascii', 'base64', 'gzip', 'deflate', 'br', 'identity',
  'click', 'change', 'input', 'blur', 'keydown', 'keyup',
  'mousedown', 'mouseup', 'mouseover', 'mouseout', 'touchstart', 'touchend',
  'dialog', 'menu', 'menuitem', 'tab', 'tabpanel', 'alert', 'status', 'tooltip',
  'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'region', 'presentation',
  'development', 'production', 'test', 'lazy', 'eager', 'async', 'sync', 'strict',
]);

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const NUMERIC_WITH_AFFIX_RE =
  /^[€$£¥₩₹฿]?\s*\d[\d\s.,]*\s*[€$£¥₩₹฿%+×xkKmMbB]*[+]?$|^[€$£¥₩₹฿]\s*\d[\d\s.,]*$/;
const CSS_VALUE_RE = /^-?\d+(\.\d+)?(px|em|rem|vh|vw|vmin|vmax|pt|cm|mm|in|pc|ex|ch|%|s|ms)$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CSS_FUNC_COLOR_RE = /^(?:rgb|rgba|hsl|hsla|oklch|lch|lab|color)\(/;
const ABSOLUTE_URL_RE = /^https?:\/\//;
const PROTOCOL_URL_RE = /^(?:mailto|tel|ftp|data|blob|ws|wss):/;
const PROTOCOL_RELATIVE_RE = /^\/\//;
const ROUTE_RE = /^\/[a-zA-Z0-9\-_.[\]@()]*(?:\/[a-zA-Z0-9\-_.[\]@()]*)*(?:\?[^#\s]*)?(?:#\S*)?$/;
const MIME_TYPE_RE =
  /^(?:text|image|application|audio|video|font|model|multipart|message)\/[a-z0-9+.-]+(?:\s*;[^,]*)?$/;
const ENV_VAR_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const CSS_TOKEN_RE = /^-?[a-z0-9]+(?:[-:/][a-z0-9.[\]%!@*+()]+)*!?$/;
const CSS_UTILITY_MARKER_RE = /[-:/[\]!%\d]/;

function isSymbolOrEmojiOnly(value: string): boolean {
  if (!value.trim()) return false;
  const stripped = value.replace(
    /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Symbol}\s]/gu,
    '',
  );
  return stripped.length === 0;
}

function isCamelCaseIdentifier(value: string): boolean {
  if (/\s/.test(value)) return false;
  return /[a-z][A-Z]/.test(value);
}

function isCssClassString(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 2) return false;
  if (!tokens.every(t => CSS_TOKEN_RE.test(t))) return false;
  // Évite de confondre du vrai texte humain en minuscules ("se connecter", "log in")
  // avec une liste de classes Tailwind : au moins un token doit porter un marqueur CSS
  // structurel (`-`, `:`, `/`, `[...]`, chiffre) ou être un mot-clé CSS connu.
  return tokens.some(t => CSS_UTILITY_MARKER_RE.test(t) || TECHNICAL_KEYWORDS.has(t));
}

function isSingleCssToken(value: string): boolean {
  if (/[\sÀ-ɏḀ-ỿ]/.test(value)) return false;
  if (/[A-Z]/.test(value)) return false;
  if (/['"''`]/.test(value)) return false;
  if (!/-|:/.test(value)) return false;
  return CSS_TOKEN_RE.test(value);
}

/** Renvoie la raison d'ignorer une string, ou `null` si elle est traduisible. */
export function getIgnoreReason(value: string, options?: FilterOptions): IgnoreReason | null {
  const trimmed = value.trim();
  const isUserFacingMarkup = options?.kind === 'jsx-text' || options?.kind === 'jsx-attribute';

  if (!trimmed) return 'empty';
  if (NUMERIC_RE.test(trimmed)) return 'numeric';
  if (CSS_VALUE_RE.test(trimmed)) return 'css_value';
  if (HEX_COLOR_RE.test(trimmed)) return 'hex_color';
  if (CSS_FUNC_COLOR_RE.test(trimmed)) return 'css_function_color';
  if (ABSOLUTE_URL_RE.test(trimmed)) return 'absolute_url';
  if (PROTOCOL_URL_RE.test(trimmed)) return 'protocol_url';
  if (PROTOCOL_RELATIVE_RE.test(trimmed)) return 'protocol_relative_url';
  if (trimmed.length > 1 && ROUTE_RE.test(trimmed)) return 'route';
  if (MIME_TYPE_RE.test(trimmed)) return 'mime_type';
  if (ENV_VAR_RE.test(trimmed)) return 'env_var';
  if (NUMERIC_WITH_AFFIX_RE.test(trimmed)) return 'numeric_with_affix';
  if (isSymbolOrEmojiOnly(trimmed)) return 'symbol_or_emoji';
  if (!isUserFacingMarkup && TECHNICAL_KEYWORDS.has(trimmed)) return 'technical_keyword';
  if (isCamelCaseIdentifier(trimmed)) return 'camel_case_identifier';
  if (!isUserFacingMarkup && isSingleCssToken(trimmed)) return 'single_css_token';
  if (!isUserFacingMarkup && isCssClassString(trimmed)) return 'css_class_string';
  if (options?.blacklist?.includes(trimmed)) return 'blacklist';

  return null;
}

export function isIgnorable(value: string, options?: FilterOptions): boolean {
  return getIgnoreReason(value, options) !== null;
}
