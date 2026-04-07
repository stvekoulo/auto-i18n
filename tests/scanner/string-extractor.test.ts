import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSource } from '../../src/scanner/ast-parser';
import { extractStrings, type ExtractedString, type StringType } from '../../src/scanner/string-extractor';
import { shouldIgnore } from '../../src/scanner/filters';
import { scanProject } from '../../src/scanner';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'TestComponent.tsx');
let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-scanner-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function getFixtureStrings(): ExtractedString[] {
  const content = readFileSync(FIXTURE_PATH, 'utf-8');
  const sourceFile = parseSource(content, 'TestComponent.tsx');
  return extractStrings(sourceFile, 'TestComponent.tsx');
}

function byType(strings: ExtractedString[], type: StringType): ExtractedString[] {
  return strings.filter(s => s.type === type);
}

function hasValue(strings: ExtractedString[], value: string): boolean {
  return strings.some(s => s.value === value);
}

describe('extractStrings — fixture TestComponent', () => {
  describe('type jsx-text', () => {
    it('extrait le texte JSX en dur', () => {
      const strings = getFixtureStrings();
      const jsxTexts = byType(strings, 'jsx-text');

      expect(hasValue(jsxTexts, 'Bienvenue sur la plateforme')).toBe(true);
      expect(hasValue(jsxTexts, 'Gérez vos projets facilement')).toBe(true);
      expect(hasValue(jsxTexts, 'Accès administrateur activé')).toBe(true);
    });

    it('inclut la position (line/column) non nulle', () => {
      const strings = getFixtureStrings();
      const jsxTexts = byType(strings, 'jsx-text');
      for (const s of jsxTexts) {
        expect(s.line).toBeGreaterThan(0);
        expect(s.column).toBeGreaterThan(0);
      }
    });

    it('ignore le texte JSX vide ou avec espaces uniquement', () => {
      const source = '<div>   \n  </div>';
      const sf = parseSource(source, 'empty.tsx');
      const result = extractStrings(sf, 'empty.tsx');
      expect(byType(result, 'jsx-text')).toHaveLength(0);
    });

    it("n'extrait pas le texte 'X' du bouton (string d'un caractère)", () => {
      const source = '<button>X</button>';
      const sf = parseSource(source, 'btn.tsx');
      const result = extractStrings(sf, 'btn.tsx');
      const jsxTexts = byType(result, 'jsx-text');
      expect(hasValue(jsxTexts, 'X')).toBe(true);
    });
  });

  describe('type jsx-attribute', () => {
    it('extrait placeholder', () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(hasValue(attrs, 'Rechercher un projet')).toBe(true);
    });

    it('extrait alt', () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(hasValue(attrs, "Logo de l'application")).toBe(true);
    });

    it('extrait title', () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(hasValue(attrs, 'Fermer la fenêtre')).toBe(true);
    });

    it('extrait aria-label', () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(hasValue(attrs, 'Zone de navigation principale')).toBe(true);
    });

    it("n'extrait PAS href", () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(hasValue(attrs, '/profil')).toBe(false);
    });

    it("n'extrait PAS className", () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(attrs.some(s => s.value.includes('text-blue-500'))).toBe(false);
    });

    it("n'extrait PAS method (attribut HTML non traduisible)", () => {
      const strings = getFixtureStrings();
      const attrs = byType(strings, 'jsx-attribute');
      expect(hasValue(attrs, 'POST')).toBe(false);
    });

    it('extrait placeholder dans la syntaxe {" "} (JsxExpression)', () => {
      const source = '<input placeholder={"Chercher"} />';
      const sf = parseSource(source, 'test.tsx');
      const result = extractStrings(sf, 'test.tsx');
      const attrs = byType(result, 'jsx-attribute');
      expect(hasValue(attrs, 'Chercher')).toBe(true);
    });
  });

  describe('type template-literal', () => {
    it('extrait un template literal simple', () => {
      const strings = getFixtureStrings();
      const tpls = byType(strings, 'template-literal');
      expect(hasValue(tpls, 'Tableau de bord')).toBe(true);
    });

    it('extrait correctement depuis un source inline', () => {
      const source = 'const msg = `Bienvenue sur notre site`;';
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const tpls = byType(result, 'template-literal');
      expect(hasValue(tpls, 'Bienvenue sur notre site')).toBe(true);
    });

    it('ignore un template literal déjà dans t()', () => {
      const source = 'const x = t(`already_translated`);';
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const tpls = byType(result, 'template-literal');
      expect(hasValue(tpls, 'already_translated')).toBe(false);
    });
  });

  describe('type template-literal-dynamic', () => {
    it('extrait un template literal avec variables', () => {
      const strings = getFixtureStrings();
      const dynamic = byType(strings, 'template-literal-dynamic');
      const found = dynamic.find(s => s.value.includes('Bonjour'));
      expect(found).toBeDefined();
      expect(found!.value).toBe('Bonjour {name}, vous avez {count} messages');
    });

    it('enregistre les variables interpolées', () => {
      const strings = getFixtureStrings();
      const dynamic = byType(strings, 'template-literal-dynamic');
      const found = dynamic.find(s => s.value.includes('Bonjour'));
      expect(found!.variables).toContain('name');
      expect(found!.variables).toContain('count');
    });

    it('reconstruit correctement le template avec {varName}', () => {
      const source = 'const s = `Salut ${user.name} !`;';
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const dynamic = byType(result, 'template-literal-dynamic');
      expect(dynamic[0].value).toBe('Salut {user.name} !');
      expect(dynamic[0].variables).toEqual(['user.name']);
    });
  });

  describe('type string-literal', () => {
    it('extrait les string literals dans les propriétés d\'objet', () => {
      const source = `
        const data = [{ title: "Bienvenue chez nous", desc: "Une description" }];
        export default function Page() { return <div />; }
      `;
      const sf = parseSource(source, 'test.tsx');
      const result = extractStrings(sf, 'test.tsx');
      const literals = byType(result, 'string-literal');
      expect(hasValue(literals, 'Bienvenue chez nous')).toBe(true);
      expect(hasValue(literals, 'Une description')).toBe(true);
    });

    it('extrait les string literals dans les éléments de tableau', () => {
      const source = `
        const items = ["Premier élément", "Deuxième élément"];
        export default function Page() { return <div />; }
      `;
      const sf = parseSource(source, 'test.tsx');
      const result = extractStrings(sf, 'test.tsx');
      const literals = byType(result, 'string-literal');
      expect(hasValue(literals, 'Premier élément')).toBe(true);
      expect(hasValue(literals, 'Deuxième élément')).toBe(true);
    });

    it('extrait les string literals assignées à des variables', () => {
      const source = `const greeting = "Bonjour le monde";`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const literals = byType(result, 'string-literal');
      expect(hasValue(literals, 'Bonjour le monde')).toBe(true);
    });

    it('n\'extrait PAS les import specifiers', () => {
      const source = `import { foo } from "some-module";`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      expect(hasValue(result, 'some-module')).toBe(false);
    });

    it('n\'extrait PAS les clés de propriété (quoted)', () => {
      const source = `const obj = { "my-key": "Ma valeur" };`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const literals = byType(result, 'string-literal');
      expect(hasValue(literals, 'my-key')).toBe(false);
      expect(hasValue(literals, 'Ma valeur')).toBe(true);
    });

    it('n\'extrait PAS les propriétés techniques (icon, type, className...)', () => {
      const source = `const x = { icon: "🏋️", type: "submit", className: "flex" };`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const literals = byType(result, 'string-literal');
      expect(hasValue(literals, '🏋️')).toBe(false);
      expect(hasValue(literals, 'submit')).toBe(false);
      expect(hasValue(literals, 'flex')).toBe(false);
    });

    it('n\'extrait PAS les strings dans new Error()', () => {
      const source = `throw new Error("Something went wrong");`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      expect(hasValue(result, 'Something went wrong')).toBe(false);
    });

    it('n\'extrait PAS les strings dans console.log()', () => {
      const source = `console.log("debug message");`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      expect(hasValue(result, 'debug message')).toBe(false);
    });

    it('n\'extrait PAS les strings déjà dans t()', () => {
      const source = `const x = t("already_translated");`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      const literals = byType(result, 'string-literal');
      expect(hasValue(literals, 'already_translated')).toBe(false);
    });

    it('n\'extrait PAS les strings dans les JSX attributes (déjà gérées)', () => {
      const source = `function C() { return <input placeholder="Chercher" />; }`;
      const sf = parseSource(source, 'test.tsx');
      const result = extractStrings(sf, 'test.tsx');
      const literals = byType(result, 'string-literal');
      // "Chercher" doit être dans jsx-attribute, pas dans string-literal
      expect(hasValue(literals, 'Chercher')).toBe(false);
      const attrs = byType(result, 'jsx-attribute');
      expect(hasValue(attrs, 'Chercher')).toBe(true);
    });

    it('n\'extrait PAS les strings dans les enum', () => {
      const source = `enum Status { Active = "active", Inactive = "inactive" }`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      expect(hasValue(result, 'active')).toBe(false);
      expect(hasValue(result, 'inactive')).toBe(false);
    });

    it('n\'extrait PAS les strings dans les interfaces/types', () => {
      const source = `interface Config { mode: "dark" | "light" }`;
      const sf = parseSource(source, 'test.ts');
      const result = extractStrings(sf, 'test.ts');
      expect(hasValue(result, 'dark')).toBe(false);
      expect(hasValue(result, 'light')).toBe(false);
    });
  });

  describe('intégration : filtrage des strings techniques', () => {
    it('les strings techniques extraites sont ignorées par shouldIgnore', () => {
      const content = readFileSync(FIXTURE_PATH, 'utf-8');
      const sf = parseSource(content, 'TestComponent.tsx');
      const raw = extractStrings(sf, 'TestComponent.tsx');
      const kept = raw.filter(s => !shouldIgnore(s.value));

      expect(kept.some(s => s.value === 'flex items-center justify-between')).toBe(false);
      expect(kept.some(s => s.value === '/dashboard')).toBe(false);
      expect(kept.some(s => s.value === 'POST')).toBe(false);
      expect(kept.some(s => s.value === '16px')).toBe(false);
      expect(kept.some(s => s.value === '#3b82f6')).toBe(false);
      expect(kept.some(s => s.value === '42')).toBe(false);
    });

    it('les strings traduisibles survivent au filtre', () => {
      const content = readFileSync(FIXTURE_PATH, 'utf-8');
      const sf = parseSource(content, 'TestComponent.tsx');
      const raw = extractStrings(sf, 'TestComponent.tsx');
      const kept = raw.filter(s => !shouldIgnore(s.value));

      expect(kept.some(s => s.value === 'Bienvenue sur la plateforme')).toBe(true);
      expect(kept.some(s => s.value === 'Rechercher un projet')).toBe(true);
      expect(kept.some(s => s.value === 'Tableau de bord')).toBe(true);
    });
  });
});

describe('scanProject', () => {
  it('scanne aussi les dossiers ui, features et shared à la racine', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'ui'), { recursive: true });
    await mkdir(join(dir, 'features', 'dashboard'), { recursive: true });
    await mkdir(join(dir, 'shared'), { recursive: true });

    await writeFile(join(dir, 'ui', 'Button.tsx'), 'export function Button() { return <button>CTA</button>; }');
    await writeFile(join(dir, 'features', 'dashboard', 'Page.tsx'), 'export default function Page() { return <h1>Dashboard</h1>; }');
    await writeFile(join(dir, 'shared', 'Banner.tsx'), 'export function Banner() { return <p>Shared banner</p>; }');

    const result = await scanProject(dir);
    const values = result.map(item => item.value);

    expect(values).toContain('CTA');
    expect(values).toContain('Dashboard');
    expect(values).toContain('Shared banner');
  });

  it('permet de restreindre explicitement les dossiers racine scannés', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'shared'), { recursive: true });
    await mkdir(join(dir, 'app'), { recursive: true });

    await writeFile(join(dir, 'shared', 'Banner.tsx'), 'export function Banner() { return <p>Ignored</p>; }');
    await writeFile(join(dir, 'app', 'page.tsx'), 'export default function Page() { return <p>Kept</p>; }');

    const result = await scanProject(dir, { rootDirs: ['app'] });
    const values = result.map(item => item.value);

    expect(values).toContain('Kept');
    expect(values).not.toContain('Ignored');
  });
});
