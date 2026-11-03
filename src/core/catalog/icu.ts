import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/** Signature structurelle ICU : le texte et les catégories de pluriel peuvent changer. */
export function extractPlaceholders(text: string): string[] {
  const signature = new Set<string>();
  function visit(elements: MessageFormatElement[]) {
    for (const element of elements) {
      if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
      if (element.type === TYPE.tag) {
        signature.add(`<${element.value}>`);
        visit(element.children);
      } else if (element.type === TYPE.select || element.type === TYPE.plural) {
        const choices = Object.keys(element.options)
          .filter(key => element.type === TYPE.select || key.startsWith('='))
          .sort();
        const kind =
          element.type === TYPE.select ? 'select' : `${element.pluralType}:${element.offset}`;
        signature.add(`{${element.value},${kind},${choices.join('|')}}`);
        for (const option of Object.values(element.options)) visit(option.value);
      } else {
        signature.add(
          element.type === TYPE.argument
            ? `{${element.value}}`
            : `{${element.value},${TYPE[element.type]}}`,
        );
      }
    }
  }
  visit(parse(text, { requiresOtherClause: true }));
  return [...signature].sort();
}

export function placeholdersMatch(source: string, translated: string): boolean {
  try {
    const a = extractPlaceholders(source);
    const b = extractPlaceholders(translated);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  } catch {
    return false;
  }
}
