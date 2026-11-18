/**
 * Décodage et analyse de sûreté des nœuds `JsxText`.
 */

import ts from 'typescript';

/**
 * Décode les entités HTML/JSX courantes dans l'ordre sûr (`&amp;` en dernier)
 * et normalise les sauts de ligne d'indentation multi-lignes comme React JSX.
 */
export function normalizeJsxText(rawText: string): string {
  const collapsed = rawText.trim().replace(/\s*\r?\n\s*/g, ' ');
  if (!collapsed) return '';
  return collapsed
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function getJsxRawTrimBounds(
  sourceFile: ts.SourceFile,
  node: ts.JsxText,
): { start: number; end: number; leading: string; trailing: string } {
  const fullStart = node.getFullStart();
  const fullEnd = node.getEnd();
  const raw = sourceFile.text.slice(fullStart, fullEnd);
  const leadingMatch = /^\s*/.exec(raw);
  const trailingMatch = /\s*$/.exec(raw);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const trailing = trailingMatch && trailingMatch[0].length < raw.length ? trailingMatch[0] : '';
  return {
    start: fullStart + leading.length,
    end: fullEnd - trailing.length,
    leading,
    trailing,
  };
}

/**
 * Texte JSX voisin d'une expression ou balise inline avec saut de ligne ou espace
 * spécial → un enrobage automatique en `{t()}` pourrait altérer l'espacement rendu.
 */
export function isUnsafeJsxText(node: ts.JsxText, leading: string, trailing: string): boolean {
  const parent = node.parent;
  if (!parent || (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent))) return false;
  const siblings = parent.children;
  const idx = siblings.indexOf(node);
  const prev = idx > 0 ? siblings[idx - 1] : undefined;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : undefined;
  const hasInlineNeighbor = Boolean((prev && !ts.isJsxText(prev)) || (next && !ts.isJsxText(next)));
  if (!hasInlineNeighbor) return false;
  if (/[\r\n]/.test(leading) || /[\r\n]/.test(trailing)) return true;
  return (
    (leading.length > 0 && !/^[ \t]+$/.test(leading)) ||
    (trailing.length > 0 && !/^[ \t]+$/.test(trailing))
  );
}
