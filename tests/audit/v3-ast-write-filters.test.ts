import { describe, expect, it } from 'vitest';
import { parseSource, getSyntaxErrors, extractStrings } from '../../src/core/extraction/index.js';
import { scanContent } from '../../src/core/scan/index.js';
import { getIgnoreReason } from '../../src/core/filters/index.js';
import { extractPlaceholders, placeholdersMatch } from '../../src/core/catalog/index.js';
import { computeWriteEdits, applyEdits } from '../../src/core/write/index.js';

function rewrite(
  content: string,
  runtime: 'client' | 'server',
  entries: Record<string, string>,
  file = 'Comp.tsx',
) {
  const sf = parseSource(content, file);
  const res = computeWriteEdits(sf, file, runtime, new Map(Object.entries(entries)));
  const output = applyEdits(content, res.edits);
  return { res, output, syntaxErrors: getSyntaxErrors(parseSource(output, file)) };
}

describe('v3 — AST, extraction, filtres et codemod --write', () => {
  it('B1 : ne corrompt jamais la syntaxe sur une template expression contenant des littéraux', () => {
    const code =
      "'use client';\nexport function Card({ isAdmin }: { isAdmin: boolean }) {\n  return <span>{`Rôle : ${isAdmin ? 'Administrateur' : 'Membre'}`}</span>;\n}\n";
    const scanned = scanContent(code, 'Card.tsx');
    const entries = Object.fromEntries(scanned.strings.map((s, i) => [s.value, `k_${i}`]));
    const { output, syntaxErrors } = rewrite(code, 'client', entries, 'Card.tsx');
    expect(syntaxErrors).toEqual([]);
    expect(output).not.toContain(')re")');
  });

  it('B2 : conserve les textes humains multi-mots en minuscules (JSX, attributs et constantes)', () => {
    expect(getIgnoreReason('se connecter', { kind: 'jsx-text' })).toBeNull();
    expect(getIgnoreReason('mot de passe', { kind: 'jsx-text' })).toBeNull();
    expect(getIgnoreReason('fermer le menu', { kind: 'jsx-attribute' })).toBeNull();
    expect(getIgnoreReason('en savoir plus')).toBeNull();
    expect(getIgnoreReason('log in')).toBeNull();
    expect(getIgnoreReason('sign up')).toBeNull();
    // Mais conserve l'exclusion des vraies classes CSS / Tailwind :
    expect(getIgnoreReason('flex items-center gap-4')).toBe('css_class_string');
    expect(getIgnoreReason('px-4 py-2 rounded-lg')).toBe('css_class_string');
  });

  it("B3 : n'injecte pas un hook runtime à l'intérieur d'un import type existant", () => {
    const code =
      "'use client';\nimport type { AbstractIntlMessages } from 'next-intl';\nexport function Hero() {\n  return <h1>Bienvenue</h1>;\n}\n";
    const { output, syntaxErrors } = rewrite(code, 'client', { Bienvenue: 'bienvenue' });
    expect(syntaxErrors).toEqual([]);
    expect(output).toContain("import type { AbstractIntlMessages } from 'next-intl';");
    expect(output).toContain("import { useTranslations } from 'next-intl';");
  });

  it('B4 : génère des propriétés JS valides quand une interpolation est un mot-clé réservé (true, this)', () => {
    const code =
      "'use client';\nexport function Flag() {\n  return <p>{`Actif : ${true}`}</p>;\n}\n";
    const scanned = scanContent(code, 'Flag.tsx');
    const entries = Object.fromEntries(scanned.strings.map(s => [s.value, 'actif_val']));
    const { output, syntaxErrors } = rewrite(code, 'client', entries, 'Flag.tsx');
    expect(syntaxErrors).toEqual([]);
    expect(output).not.toContain('{ true }');
  });

  it('B5 : ne masque pas un traducteur parent namespacé utilisé dans une fonction interne', () => {
    const code =
      "'use client';\nimport { useTranslations } from 'next-intl';\nexport function Outer() {\n  const t = useTranslations('Header');\n  function Inner() {\n    return <div>{t('subtitle')}<span>Bonjour</span></div>;\n  }\n  return <Inner />;\n}\n";
    const { res, output } = rewrite(code, 'client', { Bonjour: 'bonjour' }, 'Outer.tsx');
    expect(res.written).toBe(0);
    expect(res.skipped[0]?.reason).toBe('t_conflict');
    expect(output).toBe(code);
  });

  it("B6 : échappe les apostrophes simples autour d'un placeholder ICU pour préserver {code}", () => {
    const code =
      "'use client';\nexport function Err({ code }: { code: string }) {\n  return <p>{`Code '${code}' invalide`}</p>;\n}\n";
    const scanned = scanContent(code, 'Err.tsx');
    expect(scanned.strings).toHaveLength(1);
    const msg = scanned.strings[0].value;
    expect(extractPlaceholders(msg)).toEqual(['{code}']);
    expect(placeholdersMatch(msg, 'Invalid code')).toBe(false);
  });

  it('B7 : décode les entités JSX et normalise les retours à la ligne du JsxText', () => {
    const code =
      "'use client';\nexport function Terms() {\n  return (\n    <div>\n      <p>Conditions d&apos;utilisation &amp; confidentialité</p>\n      <span>\n        Bienvenue sur\n        notre plateforme\n      </span>\n    </div>\n  );\n}\n";
    const strings = extractStrings(parseSource(code, 'Terms.tsx'), 'Terms.tsx');
    expect(strings.map(s => s.value)).toEqual([
      "Conditions d'utilisation & confidentialité",
      'Bienvenue sur notre plateforme',
    ]);
  });

  it('B12 & Expo : ignore === / switch case / indexation mais extrait les ternaires JSX et attributs Expo', () => {
    const code = `
      'use server';
      export async function Screen({ status, ok, record }: { status: string; ok: boolean; record: Record<string, string> }) {
        document.getElementById('root');
        localStorage.getItem('theme');
        if (status === 'Actif') return null;
        const v = record['Nom'];
        switch (status) {
          case 'Suspendu':
            return null;
        }
        return (
          <View accessibilityLabel="Profil utilisateur" accessibilityHint="Ouvre les paramètres">
            <Input placeholder={ok ? 'Rechercher un élève' : 'Filtrer la liste'} />
          </View>
        );
      }
    `;
    const strings = scanContent(code, 'Screen.tsx').strings.map(s => s.value);
    expect(strings).toEqual([
      'Profil utilisateur',
      'Ouvre les paramètres',
      'Rechercher un élève',
      'Filtrer la liste',
    ]);
  });

  it('v3 : câble les fonctions fléchées à corps concis et generateMetadata async', () => {
    const arrow = "'use client';\nexport const Badge = () => <span>Nouveau</span>;\n";
    const arrowRes = rewrite(arrow, 'client', { Nouveau: 'nouveau' }, 'Badge.tsx');
    expect(arrowRes.res.written).toBe(1);
    expect(arrowRes.syntaxErrors).toEqual([]);
    expect(arrowRes.output).toContain('const t = useTranslations();');
    expect(arrowRes.output).toContain('{t("nouveau")}');

    const meta =
      "export async function generateMetadata() {\n  return { title: 'Tableau de bord' };\n}\n";
    const metaRes = rewrite(meta, 'server', { 'Tableau de bord': 'tableau_de_bord' }, 'page.tsx');
    expect(metaRes.res.written).toBe(1);
    expect(metaRes.syntaxErrors).toEqual([]);
    expect(metaRes.output).toContain('const t = await getTranslations();');
    expect(metaRes.output).toContain('t("tableau_de_bord")');
  });
});
