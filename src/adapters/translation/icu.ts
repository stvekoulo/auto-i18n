import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

const COMPLEX_ICU_OR_TAG_RE =
  /\{[^{}]+,\s*(?:plural|select|selectordinal|number|date|time)\b|<[A-Za-z][\w-]*>/;

/**
 * Protège les tokens ICU complexes (`plural`, `select`…) ET les balises riches (`<link>…</link>`),
 * tout en laissant traduire le texte littéral de chaque branche ou balise.
 */
export function protectComplexIcu(
  text: string,
  escape: (value: string) => string,
  wrap: (value: string) => string,
): string | null {
  if (!COMPLEX_ICU_OR_TAG_RE.test(text)) return null;
  let ast: MessageFormatElement[];
  try {
    ast = parse(text, { captureLocation: true });
  } catch {
    return null;
  }

  const literals: Array<[number, number]> = [];
  let hasStructuredNode = false;
  function visit(elements: MessageFormatElement[]): void {
    for (const element of elements) {
      if (element.type === TYPE.literal && element.location) {
        literals.push([element.location.start.offset, element.location.end.offset]);
      } else if (element.type === TYPE.tag) {
        hasStructuredNode = true;
        visit(element.children);
      } else if (element.type === TYPE.plural || element.type === TYPE.select) {
        hasStructuredNode = true;
        for (const option of Object.values(element.options)) visit(option.value);
      } else if (element.type !== TYPE.argument && element.type !== TYPE.pound) {
        hasStructuredNode = true;
      }
    }
  }
  visit(ast);
  if (!hasStructuredNode) return null;

  literals.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  let output = '';
  for (const [start, end] of literals) {
    if (start > cursor) output += wrap(escape(text.slice(cursor, start)));
    output += escape(text.slice(start, end));
    cursor = end;
  }
  if (cursor < text.length) output += wrap(escape(text.slice(cursor)));
  return output;
}
