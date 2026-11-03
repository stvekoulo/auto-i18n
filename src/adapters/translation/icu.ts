import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/** Protège les tokens ICU complexes, mais laisse traduire le texte de chaque branche. */
export function protectComplexIcu(
  text: string,
  escape: (value: string) => string,
  wrap: (value: string) => string,
): string | null {
  if (!/\{[^{}]+,\s*(?:plural|select|selectordinal|number|date|time)\b/.test(text)) return null;
  const literals: Array<[number, number]> = [];
  function visit(elements: MessageFormatElement[]) {
    for (const element of elements) {
      if (element.type === TYPE.literal && element.location)
        literals.push([element.location.start.offset, element.location.end.offset]);
      else if (element.type === TYPE.tag) visit(element.children);
      else if (element.type === TYPE.plural || element.type === TYPE.select) {
        for (const option of Object.values(element.options)) visit(option.value);
      }
    }
  }
  visit(parse(text, { captureLocation: true }));
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
