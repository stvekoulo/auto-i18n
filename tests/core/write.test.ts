import { describe, it, expect } from 'vitest';
import { parseSource, getSyntaxErrors } from '../../src/core/extraction';
import { computeWriteEdits, applyEdits } from '../../src/core/write';
import type { Runtime } from '../../src/core/types';

function write(content: string, runtime: Runtime, keyMap: Record<string, string>, file = 'C.tsx') {
  const sourceFile = parseSource(content, file);
  const result = computeWriteEdits(sourceFile, file, runtime, new Map(Object.entries(keyMap)));
  return { result, output: applyEdits(content, result.edits) };
}

describe('core/write — composants client', () => {
  it('injecte useTranslations et câble le texte JSX', () => {
    const content = `'use client';\nexport function Widget() {\n  return <p>Bonjour</p>;\n}\n`;
    const { result, output } = write(content, 'client', { Bonjour: 'bonjour' });

    expect(result.written).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(output).toContain("import { useTranslations } from 'next-intl';");
    expect(output).toContain('const t = useTranslations();');
    expect(output).toContain('{t("bonjour")}');
    expect(output).not.toContain('Bonjour<');
    // L'import ne doit pas coller à la directive 'use client' sur la même ligne.
    expect(output).not.toContain("';import");
    expect(output.split('\n')[0]).toBe("'use client';");
  });

  it('réutilise un t existant sans le réinjecter', () => {
    const content =
      "'use client';\nimport { useTranslations } from 'next-intl';\nexport function Widget() {\n  const t = useTranslations();\n  return <p>Bonjour</p>;\n}\n";
    const { result, output } = write(content, 'client', { Bonjour: 'bonjour' });

    expect(result.written).toBe(1);
    expect(output.match(/const t = useTranslations\(\)/g)).toHaveLength(1);
    expect(output.match(/useTranslations/g)).toHaveLength(2); // import + un seul appel
  });

  it('signale une collision si `t` existe déjà avec une autre origine', () => {
    const content =
      "'use client';\nexport function Widget() {\n  const t = 5;\n  return <p>Bonjour</p>;\n}\n";
    const { result } = write(content, 'client', { Bonjour: 'bonjour' });

    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([{ value: 'Bonjour', line: 4, reason: 't_conflict' }]);
  });

  it('ignore les fonctions à corps concis (arrow sans bloc)', () => {
    const content = "'use client';\nexport const Widget = () => <p>Bonjour</p>;\n";
    const { result, output } = write(content, 'client', { Bonjour: 'bonjour' });

    expect(result.written).toBe(0);
    expect(result.skipped[0].reason).toBe('concise_body');
    expect(output).toBe(content);
  });

  it('ne câble pas une fonction hôte non identifiable (nom non-composant)', () => {
    const content = "'use client';\nfunction render() {\n  return <p>Bonjour</p>;\n}\n";
    const { result } = write(content, 'client', { Bonjour: 'bonjour' });

    expect(result.written).toBe(0);
    expect(result.skipped[0].reason).toBe('no_host');
  });

  it('câble un attribut JSX déjà entre accolades sans accolades superflues', () => {
    const content =
      "'use client';\nexport function Field() {\n  return <input placeholder={'Chercher'} />;\n}\n";
    const { output } = write(content, 'client', { Chercher: 'chercher' });

    expect(output).toContain('placeholder={t("chercher")}');
    expect(output).not.toContain('{{t(');
  });

  it('câble un attribut JSX en littéral simple avec accolades ajoutées', () => {
    const content =
      '\'use client\';\nexport function Field() {\n  return <input placeholder="Chercher" />;\n}\n';
    const { output } = write(content, 'client', { Chercher: 'chercher' });

    expect(output).toContain('placeholder={t("chercher")}');
  });

  it("regroupe toutes les strings d'un même composant sous une seule injection", () => {
    const content =
      "'use client';\nexport function Widget() {\n  return (<div><p>Bonjour</p><p>Salut</p></div>);\n}\n";
    const { result, output } = write(content, 'client', { Bonjour: 'bonjour', Salut: 'salut' });

    expect(result.written).toBe(2);
    expect(output.match(/const t = useTranslations\(\)/g)).toHaveLength(1);
    expect(output.match(/import \{ useTranslations \} from 'next-intl'/g)).toHaveLength(1);
  });
});

describe('core/write — composants serveur', () => {
  it('injecte await getTranslations() dans un export par défaut déjà async', () => {
    const content = 'export default async function Page() {\n  return <h1>Bonjour</h1>;\n}\n';
    const { result, output } = write(content, 'server', { Bonjour: 'bonjour' });

    expect(result.written).toBe(1);
    expect(output).toContain("import { getTranslations } from 'next-intl/server';");
    expect(output).toContain('const t = await getTranslations();');
    expect(output).toContain('{t("bonjour")}');
  });

  it("n'injecte rien si la fonction serveur n'est pas async (trop risqué)", () => {
    const content = 'export default function Page() {\n  return <h1>Bonjour</h1>;\n}\n';
    const { result, output } = write(content, 'server', { Bonjour: 'bonjour' });

    expect(result.written).toBe(0);
    expect(result.skipped[0].reason).toBe('server_not_async');
    expect(output).toBe(content);
  });

  it('câble un template literal avec variables', () => {
    const content =
      'export default async function Page() {\n  const name = "x";\n  return <p>{`Salut ${name}`}</p>;\n}\n';
    const { output } = write(content, 'server', { 'Salut {name}': 'salut_name' });

    expect(output).toContain('t("salut_name", { name })');
  });
});

describe('core/write — applyEdits', () => {
  it('applique plusieurs édits non chevauchants dans le bon ordre', () => {
    const content = 'AAA BBB CCC';
    const edits = [
      { start: 0, end: 3, replacement: 'X' },
      { start: 8, end: 11, replacement: 'Z' },
    ];
    expect(applyEdits(content, edits)).toBe('X BBB Z');
  });

  it('gère les insertions pures (start === end)', () => {
    expect(applyEdits('ABC', [{ start: 1, end: 1, replacement: '-' }])).toBe('A-BC');
  });
});

describe('core/write — idempotence', () => {
  it('un second passage ne trouve plus rien à câbler', () => {
    const content = "'use client';\nexport function Widget() {\n  return <p>Bonjour</p>;\n}\n";
    const first = write(content, 'client', { Bonjour: 'bonjour' });
    const second = write(first.output, 'client', { Bonjour: 'bonjour' });

    expect(second.result.written).toBe(0);
    expect(second.result.edits).toEqual([]);
    expect(second.output).toBe(first.output);
  });
});

describe('core/write — arguments de template', () => {
  it('génère un objet JS valide pour une expression composée', () => {
    const content =
      "'use client';\nexport function W({ user, count }) {\n  return <p>{`Salut ${user.name}, ${count} messages`}</p>;\n}\n";
    const { result, output } = write(content, 'client', {
      'Salut {userName}, {count} messages': 'salut',
    });

    expect(result.written).toBe(1);
    expect(output).toContain('t("salut", { userName: user.name, count })');
    // Le code produit doit être re-parsable : `{ user.name }` serait une SyntaxError.
    expect(getSyntaxErrors(parseSource(output, 'W.tsx'))).toEqual([]);
  });

  it('ne compte pas comme câblée une string absente du keyMap', () => {
    const content = "'use client';\nexport function W() {\n  return <p>Bonjour</p>;\n}\n";
    const { result } = write(content, 'client', {});
    expect(result.written).toBe(0);
    expect(result.edits).toEqual([]);
  });
});
