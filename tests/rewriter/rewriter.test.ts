import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSource } from '../../src/scanner/ast-parser';
import { rewriteJsxText, rewriteNoSubstitutionTemplateLiterals, rewriteTemplateExpressions } from '../../src/rewriter/jsx-rewriter';
import { rewriteAttributes } from '../../src/rewriter/attr-rewriter';
import {
  isClientComponent,
  injectTDeclarations,
  addNextIntlImport,
  rewriteSourceFile,
  rewriteFiles,
} from '../../src/rewriter/index';

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-rewriter-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function src(code: string) {
  return parseSource(code.trim(), 'Component.tsx');
}

describe('rewriteJsxText', () => {
  it('remplace un texte JSX simple', () => {
    const sf = src(`export default function Page() { return <p>Bonjour</p>; }`);
    const keyMap = new Map([['Bonjour', 'bonjour']]);
    const count = rewriteJsxText(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('{t("bonjour")}');
    expect(sf.getFullText()).not.toContain('>Bonjour<');
  });

  it('remplace plusieurs textes JSX dans le même fichier', () => {
    const sf = src(`
      export default function Page() {
        return <div><h1>Bienvenue</h1><p>Au revoir</p></div>;
      }
    `);
    const keyMap = new Map([['Bienvenue', 'bienvenue'], ['Au revoir', 'au_revoir']]);
    const count = rewriteJsxText(sf, keyMap);
    expect(count).toBe(2);
    expect(sf.getFullText()).toContain('{t("bienvenue")}');
    expect(sf.getFullText()).toContain('{t("au_revoir")}');
  });

  it('ignore les textes absents du keyMap', () => {
    const sf = src(`export default function Page() { return <p>Bonjour</p>; }`);
    const count = rewriteJsxText(sf, new Map());
    expect(count).toBe(0);
    expect(sf.getFullText()).toContain('Bonjour');
  });

  it('ignore les noeuds JsxText vides ou whitespace-only', () => {
    const sf = src(`export default function Page() { return <div><p>Hello</p></div>; }`);
    const keyMap = new Map([['Hello', 'hello']]);
    const count = rewriteJsxText(sf, keyMap);
    expect(count).toBe(1); // seul "Hello" est remplacé, pas les espaces inter-éléments
  });
});

describe('rewriteNoSubstitutionTemplateLiterals', () => {
  it('remplace un template literal statique dans JSX', () => {
    const sf = src(`export default function Page() { return <p>{\`Bonjour\`}</p>; }`);
    const keyMap = new Map([['Bonjour', 'bonjour']]);
    const count = rewriteNoSubstitutionTemplateLiterals(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('t("bonjour")');
  });

  it("n'ignore pas un template literal déjà dans t()", () => {
    // t(`bonjour`) — le template literal EST dans t()
    const sf = src(`export default function Page() { return <p>{t(\`bonjour\`)}</p>; }`);
    const keyMap = new Map([['bonjour', 'bonjour']]);
    const count = rewriteNoSubstitutionTemplateLiterals(sf, keyMap);
    expect(count).toBe(0);
  });
});

describe('rewriteTemplateExpressions', () => {
  it('remplace un template literal dynamique avec variable simple', () => {
    const sf = src(`
      export default function Page({ name }: { name: string }) {
        return <p>{\`Salut \${name}\`}</p>;
      }
    `);
    const keyMap = new Map([['Salut {name}', 'salut_name']]);
    const count = rewriteTemplateExpressions(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('t("salut_name", { name })');
  });

  it('remplace avec plusieurs variables', () => {
    const sf = src(`
      function Msg({ count, name }: any) {
        return <p>{\`\${count} messages pour \${name}\`}</p>;
      }
    `);
    const keyMap = new Map([['{count} messages pour {name}', 'count_messages_pour_name']]);
    const count = rewriteTemplateExpressions(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('t("count_messages_pour_name", { count, name })');
  });

  it('ignore les template expressions absents du keyMap', () => {
    const sf = src(`
      function Page({ name }: any) { return <p>{\`Hello \${name}\`}</p>; }
    `);
    const count = rewriteTemplateExpressions(sf, new Map());
    expect(count).toBe(0);
  });
});

describe('rewriteAttributes', () => {
  it('remplace placeholder="..." par placeholder={t("...")}', () => {
    const sf = src(`
      export default function Search() {
        return <input placeholder="Rechercher..." />;
      }
    `);
    const keyMap = new Map([['Rechercher...', 'rechercher']]);
    const count = rewriteAttributes(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('placeholder={t("rechercher")}');
    expect(sf.getFullText()).not.toContain('placeholder="Rechercher..."');
  });

  it('remplace alt="..." par alt={t("...")}', () => {
    const sf = src(`
      export default function Avatar() { return <img alt="Photo de profil" />; }
    `);
    const keyMap = new Map([['Photo de profil', 'photo_de_profil']]);
    const count = rewriteAttributes(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('alt={t("photo_de_profil")}');
  });

  it('remplace title="..." par title={t("...")}', () => {
    const sf = src(`function Btn() { return <button title="Fermer la fenêtre">X</button>; }`);
    const keyMap = new Map([['Fermer la fenêtre', 'fermer_la_fenetre']]);
    const count = rewriteAttributes(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('title={t("fermer_la_fenetre")}');
  });

  it('remplace aria-label="..." par aria-label={t("...")}', () => {
    const sf = src(`function Nav() { return <nav aria-label="Navigation principale" />; }`);
    const keyMap = new Map([['Navigation principale', 'navigation_principale']]);
    const count = rewriteAttributes(sf, keyMap);
    expect(count).toBe(1);
    expect(sf.getFullText()).toContain('aria-label={t("navigation_principale")}');
  });

  it('ignore les attributs non traduisibles (className, id…)', () => {
    const sf = src(`function C() { return <div className="flex" id="main" />; }`);
    const keyMap = new Map([['flex', 'flex'], ['main', 'main']]);
    const count = rewriteAttributes(sf, keyMap);
    expect(count).toBe(0);
  });

  it('ignore les attributs déjà traduits (valeur = expression non-string)', () => {
    const sf = src(`function C() { return <input placeholder={t("search")} />; }`);
    const keyMap = new Map([['search', 'search']]);
    const count = rewriteAttributes(sf, keyMap);
    expect(count).toBe(0);
  });
});

describe('isClientComponent', () => {
  it("retourne true pour un fichier avec 'use client'", () => {
    const sf = src(`'use client';\nexport default function Page() { return <p>Hello</p>; }`);
    expect(isClientComponent(sf)).toBe(true);
  });

  it("retourne false pour un Server Component (sans 'use client')", () => {
    const sf = src(`export default function Page() { return <p>Hello</p>; }`);
    expect(isClientComponent(sf)).toBe(false);
  });

  it("retourne false pour un fichier vide", () => {
    const sf = src('');
    expect(isClientComponent(sf)).toBe(false);
  });
});

describe('injectTDeclarations — Client Component', () => {
  it("injecte 'const t = useTranslations()' dans la fonction qui contient t()", () => {
    const sf = src(`
      'use client';
      export default function Page() {
        return <h1>{t("bonjour")}</h1>;
      }
    `);
    injectTDeclarations(sf, true);
    expect(sf.getFullText()).toContain('const t = useTranslations()');
  });

  it("n'injecte pas si 'const t' est déjà présent", () => {
    const sf = src(`
      'use client';
      export default function Page() {
        const t = useTranslations();
        return <h1>{t("bonjour")}</h1>;
      }
    `);
    const before = sf.getFullText();
    injectTDeclarations(sf, true);
    // Doit toujours avoir exactement une déclaration const t
    const matches = sf.getFullText().match(/const t\s*=/g) ?? [];
    expect(matches.length).toBe(1);
    // Le texte ne doit pas avoir changé
    expect(sf.getFullText()).toBe(before);
  });

  it("injecte dans chaque composant qui contient des appels t()", () => {
    const sf = src(`
      'use client';
      function Header() { return <h1>{t("titre")}</h1>; }
      function Footer() { return <p>{t("footer")}</p>; }
    `);
    injectTDeclarations(sf, true);
    const text = sf.getFullText();
    const matches = text.match(/const t = useTranslations\(\)/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

describe('injectTDeclarations — Server Component', () => {
  it("injecte 'const t = await getTranslations()' et rend la fonction async", () => {
    const sf = src(`
      export default function Page() {
        return <h1>{t("bonjour")}</h1>;
      }
    `);
    injectTDeclarations(sf, false);
    const text = sf.getFullText();
    expect(text).toContain('const t = await getTranslations()');
    expect(text).toContain('async function Page');
  });
});

describe('addNextIntlImport', () => {
  it("ajoute import { useTranslations } from 'next-intl' pour Client Component", () => {
    const sf = src(`'use client';\nexport default function Page() { return <p/>; }`);
    addNextIntlImport(sf, true);
    // ts-morph peut générer des guillemets simples ou doubles selon le contexte
    expect(sf.getFullText()).toMatch(/from ['"]next-intl['"]/);
    expect(sf.getFullText()).toContain('useTranslations');
  });

  it("ajoute import { getTranslations } from 'next-intl/server' pour Server Component", () => {
    const sf = src(`export default function Page() { return <p/>; }`);
    addNextIntlImport(sf, false);
    expect(sf.getFullText()).toMatch(/from ['"]next-intl\/server['"]/);
    expect(sf.getFullText()).toContain('getTranslations');
  });

  it("ne duplique pas l'import si déjà présent", () => {
    const sf = src(`
      import { useTranslations } from 'next-intl';
      'use client';
      export default function Page() { return <p/>; }
    `);
    addNextIntlImport(sf, true);
    const count = (sf.getFullText().match(/from ['"]next-intl['"]/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("ajoute le named import si le module existe mais pas useTranslations", () => {
    const sf = src(`
      import { useLocale } from 'next-intl';
      'use client';
      export default function Page() { return <p/>; }
    `);
    addNextIntlImport(sf, true);
    expect(sf.getFullText()).toContain('useTranslations');
    // Le module next-intl ne doit apparaître qu'une fois
    const count = (sf.getFullText().match(/from ['"]next-intl['"]/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('rewriteSourceFile', () => {
  it('retourne 0 et ne modifie pas un fichier sans strings à remplacer', () => {
    const sf = src(`export default function Page() { return <div className="flex" />; }`);
    const keyMap = new Map([['Bonjour', 'bonjour']]);
    const before = sf.getFullText();
    const count = rewriteSourceFile(sf, keyMap);
    expect(count).toBe(0);
    expect(sf.getFullText()).toBe(before);
  });

  it('pipeline complet — Client Component avec JSX text + attribut', () => {
    const sf = src(`
      'use client';
      export default function Page() {
        return (
          <div>
            <h1>Bienvenue</h1>
            <input placeholder="Chercher" />
          </div>
        );
      }
    `);
    const keyMap = new Map([['Bienvenue', 'bienvenue'], ['Chercher', 'chercher']]);
    const count = rewriteSourceFile(sf, keyMap);
    expect(count).toBe(2);
    const text = sf.getFullText();
    expect(text).toContain('{t("bienvenue")}');
    expect(text).toContain('placeholder={t("chercher")}');
    expect(text).toContain('const t = useTranslations()');
    expect(text).toMatch(/from ['"]next-intl['"]/);
  });

  it('pipeline complet — Server Component', () => {
    const sf = src(`
      export default function Page() {
        return <h1>Bonjour</h1>;
      }
    `);
    const keyMap = new Map([['Bonjour', 'bonjour']]);
    const count = rewriteSourceFile(sf, keyMap);
    expect(count).toBe(1);
    const text = sf.getFullText();
    expect(text).toContain('{t("bonjour")}');
    expect(text).toContain('const t = await getTranslations()');
    expect(text).toContain('async function Page');
    expect(text).toMatch(/from ['"]next-intl\/server['"]/);
  });
});

describe('rewriteFiles', () => {
  it('crée un backup avant de modifier le fichier', async () => {
    const dir = await makeTmpDir();
    const filePath = join(dir, 'Page.tsx');
    const original = `'use client';\nexport default function Page() { return <h1>Bonjour</h1>; }`;
    await writeFile(filePath, original, 'utf-8');

    const keyMap = new Map([['Bonjour', 'bonjour']]);
    await rewriteFiles([filePath], { keyMap, silent: true });

    // Le backup doit exister et contenir le contenu original
    const backup = await readFile(`${filePath}.backup`, 'utf-8');
    expect(backup).toBe(original);
  });

  it('modifie le fichier source avec les strings remplacées', async () => {
    const dir = await makeTmpDir();
    const filePath = join(dir, 'Page.tsx');
    await writeFile(
      filePath,
      `'use client';\nexport default function Page() { return <h1>Bonjour</h1>; }`,
      'utf-8',
    );

    const keyMap = new Map([['Bonjour', 'bonjour']]);
    const result = await rewriteFiles([filePath], { keyMap, silent: true });

    const modified = await readFile(filePath, 'utf-8');
    expect(modified).toContain('{t("bonjour")}');
    expect(modified).toContain('const t = useTranslations()');
    expect(result.filesModified).toBe(1);
    expect(result.totalReplaced).toBe(1);
  });

  it("ne crée pas de backup si le fichier n'a aucune string à remplacer", async () => {
    const dir = await makeTmpDir();
    const filePath = join(dir, 'Layout.tsx');
    await writeFile(filePath, `export default function Layout() { return <div />; }`, 'utf-8');

    const keyMap = new Map([['Bonjour', 'bonjour']]);
    const result = await rewriteFiles([filePath], { keyMap, silent: true });

    expect(result.filesSkipped).toBe(1);
    expect(result.filesModified).toBe(0);
    // Le backup ne doit pas exister
    await expect(access(`${filePath}.backup`)).rejects.toThrow();
  });

  it('traite plusieurs fichiers et retourne les bons compteurs', async () => {
    const dir = await makeTmpDir();
    const file1 = join(dir, 'Header.tsx');
    const file2 = join(dir, 'Footer.tsx');
    const file3 = join(dir, 'Layout.tsx');

    await writeFile(file1, `'use client';\nexport default function Header() { return <h1>Titre</h1>; }`, 'utf-8');
    await writeFile(file2, `'use client';\nexport default function Footer() { return <p>Pied</p>; }`, 'utf-8');
    await writeFile(file3, `export default function Layout() { return <div />; }`, 'utf-8');

    const keyMap = new Map([['Titre', 'titre'], ['Pied', 'pied']]);
    const result = await rewriteFiles([file1, file2, file3], { keyMap, silent: true });

    expect(result.filesModified).toBe(2);
    expect(result.filesSkipped).toBe(1);
    expect(result.totalReplaced).toBe(2);
  });
});
