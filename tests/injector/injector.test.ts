import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { injectLayout, findLayoutFile } from '../../src/injector/layout-injector';
import { injectNextConfig, findNextConfig } from '../../src/injector/config-injector';
import { injectMiddleware } from '../../src/injector/middleware-injector';
import { injectRouting } from '../../src/injector/routing-injector';
import { injectAll } from '../../src/injector/index';

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-injector-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

const BASIC_LAYOUT = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
`;

const BASIC_CONFIG_TS = `const nextConfig = {}
export default nextConfig
`;

const BASIC_CONFIG_JS = `const nextConfig = {}
module.exports = nextConfig
`;

const BASIC_CONFIG_ESM = `const nextConfig = {}
export default nextConfig
`;

describe('findLayoutFile', () => {
  it('trouve app/layout.tsx', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'layout.tsx'), BASIC_LAYOUT);
    expect(await findLayoutFile(dir)).toBe(join(dir, 'app', 'layout.tsx'));
  });

  it('trouve src/app/layout.tsx', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'src', 'app'), { recursive: true });
    await writeFile(join(dir, 'src', 'app', 'layout.tsx'), BASIC_LAYOUT);
    expect(await findLayoutFile(dir)).toBe(join(dir, 'src', 'app', 'layout.tsx'));
  });

  it('retourne null si aucun layout trouvé', async () => {
    const dir = await makeTmpDir();
    expect(await findLayoutFile(dir)).toBeNull();
  });
});

describe('injectLayout', () => {
  it('injecte NextIntlClientProvider et getMessages', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'layout.tsx'), BASIC_LAYOUT);

    const result = await injectLayout(dir, { silent: true });

    expect(result.modified).toBe(true);
    expect(result.skipped).toBe(false);

    const content = await readFile(join(dir, 'app', 'layout.tsx'), 'utf-8');
    expect(content).toContain('NextIntlClientProvider');
    expect(content).toContain('messages={messages}');
    expect(content).toContain('getMessages');
    expect(content).toContain('const messages = await getMessages()');
    expect(content).toContain('async function RootLayout');
  });

  it('wrapper {children} avec NextIntlClientProvider', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'layout.tsx'), BASIC_LAYOUT);

    await injectLayout(dir, { silent: true });

    const content = await readFile(join(dir, 'app', 'layout.tsx'), 'utf-8');
    expect(content).toContain('<NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>');
    expect(content).not.toMatch(/>\s*\{children\}\s*<\/body>/);
  });

  it('crée un backup avant modification', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    const layoutPath = join(dir, 'app', 'layout.tsx');
    await writeFile(layoutPath, BASIC_LAYOUT);

    await injectLayout(dir, { silent: true });

    const backup = await readFile(`${layoutPath}.backup`, 'utf-8');
    expect(backup).toBe(BASIC_LAYOUT);
  });

  it("est idempotent si NextIntlClientProvider est déjà présent", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    const layoutPath = join(dir, 'app', 'layout.tsx');
    await writeFile(layoutPath, BASIC_LAYOUT);

    // Premier run
    await injectLayout(dir, { silent: true });
    const afterFirst = await readFile(layoutPath, 'utf-8');

    // Deuxième run
    const result = await injectLayout(dir, { silent: true });

    expect(result.skipped).toBe(true);
    expect(result.modified).toBe(false);
    const afterSecond = await readFile(layoutPath, 'utf-8');
    expect(afterSecond).toBe(afterFirst); // aucun changement
  });

  it('détecte src/app/layout.tsx', async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'src', 'app'), { recursive: true });
    await writeFile(join(dir, 'src', 'app', 'layout.tsx'), BASIC_LAYOUT);

    const result = await injectLayout(dir, { silent: true });

    expect(result.modified).toBe(true);
    expect(result.filePath).toContain(join('src', 'app', 'layout.tsx'));
  });

  it('lance une erreur si layout.tsx est introuvable', async () => {
    const dir = await makeTmpDir();
    await expect(injectLayout(dir, { silent: true })).rejects.toThrow('introuvable');
  });
});

describe('findNextConfig', () => {
  it('trouve next.config.ts', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'next.config.ts'), BASIC_CONFIG_TS);
    expect(await findNextConfig(dir)).toBe(join(dir, 'next.config.ts'));
  });

  it('trouve next.config.js', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'next.config.js'), BASIC_CONFIG_ESM);
    expect(await findNextConfig(dir)).toBe(join(dir, 'next.config.js'));
  });

  it('préfère .ts sur .js si les deux existent', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'next.config.ts'), BASIC_CONFIG_TS);
    await writeFile(join(dir, 'next.config.js'), BASIC_CONFIG_ESM);
    expect(await findNextConfig(dir)).toBe(join(dir, 'next.config.ts'));
  });

  it('retourne null si aucun config trouvé', async () => {
    const dir = await makeTmpDir();
    expect(await findNextConfig(dir)).toBeNull();
  });
});

describe('injectNextConfig', () => {
  it('wrappe next.config.ts avec createNextIntlPlugin', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'next.config.ts'), BASIC_CONFIG_TS);

    const result = await injectNextConfig(dir, { silent: true });

    expect(result.modified).toBe(true);
    const content = await readFile(join(dir, 'next.config.ts'), 'utf-8');
    expect(content).toContain('createNextIntlPlugin');
    expect(content).toContain('withNextIntl');
    expect(content).toContain('withNextIntl(nextConfig)');
  });

  it('wrappe next.config.js avec createNextIntlPlugin', async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'next.config.js'), BASIC_CONFIG_ESM);

    const result = await injectNextConfig(dir, { silent: true });

    expect(result.modified).toBe(true);
    const content = await readFile(join(dir, 'next.config.js'), 'utf-8');
    expect(content).toContain('withNextIntl(nextConfig)');
  });

  it("ajoute l'import createNextIntlPlugin", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, 'next.config.ts'), BASIC_CONFIG_TS);

    await injectNextConfig(dir, { silent: true });

    const content = await readFile(join(dir, 'next.config.ts'), 'utf-8');
    expect(content).toMatch(/import createNextIntlPlugin from ['"]next-intl\/plugin['"]/);
  });

  it('crée un backup avant modification', async () => {
    const dir = await makeTmpDir();
    const configPath = join(dir, 'next.config.ts');
    await writeFile(configPath, BASIC_CONFIG_TS);

    await injectNextConfig(dir, { silent: true });

    const backup = await readFile(`${configPath}.backup`, 'utf-8');
    expect(backup).toBe(BASIC_CONFIG_TS);
  });

  it("est idempotent si withNextIntl est déjà présent", async () => {
    const dir = await makeTmpDir();
    const configPath = join(dir, 'next.config.ts');
    await writeFile(configPath, BASIC_CONFIG_TS);

    await injectNextConfig(dir, { silent: true });
    const afterFirst = await readFile(configPath, 'utf-8');

    const result = await injectNextConfig(dir, { silent: true });

    expect(result.skipped).toBe(true);
    expect(result.modified).toBe(false);
    const afterSecond = await readFile(configPath, 'utf-8');
    expect(afterSecond).toBe(afterFirst);
  });
});

describe('injectMiddleware', () => {
  it("crée middleware.ts s'il n'existe pas", async () => {
    const dir = await makeTmpDir();

    const result = await injectMiddleware(dir, { silent: true });

    expect(result.modified).toBe(true);
    expect(result.skipped).toBe(false);
    const content = await readFile(join(dir, 'middleware.ts'), 'utf-8');
    expect(content).toContain('createMiddleware');
    expect(content).toContain('routing');
    expect(content).toContain('matcher');
  });

  it("ne modifie pas middleware.ts s'il existe déjà", async () => {
    const dir = await makeTmpDir();
    const existing = `// mon middleware personnalisé\nexport default function middleware() {}\n`;
    await writeFile(join(dir, 'middleware.ts'), existing);

    const result = await injectMiddleware(dir, { silent: true });

    expect(result.skipped).toBe(true);
    expect(result.modified).toBe(false);
    expect(result.warning).toBeDefined();
    // Le contenu ne doit pas avoir changé
    const content = await readFile(join(dir, 'middleware.ts'), 'utf-8');
    expect(content).toBe(existing);
  });
});

describe('injectRouting', () => {
  it("crée i18n/routing.ts avec les bonnes locales", async () => {
    const dir = await makeTmpDir();

    const result = await injectRouting(
      dir,
      { locales: ['fr', 'en', 'es'], defaultLocale: 'fr' },
      { silent: true },
    );

    expect(result.modified).toBe(true);
    const content = await readFile(join(dir, 'i18n', 'routing.ts'), 'utf-8');
    expect(content).toContain("defineRouting");
    expect(content).toContain("'fr'");
    expect(content).toContain("'en'");
    expect(content).toContain("'es'");
    expect(content).toContain("defaultLocale: 'fr'");
  });

  it("crée le dossier i18n/ si absent", async () => {
    const dir = await makeTmpDir();

    await injectRouting(dir, { locales: ['fr'], defaultLocale: 'fr' }, { silent: true });

    await expect(access(join(dir, 'i18n'))).resolves.toBeUndefined();
  });

  it("est idempotent si routing.ts existe déjà", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'i18n'), { recursive: true });
    const existing = '// routing existant\n';
    await writeFile(join(dir, 'i18n', 'routing.ts'), existing);

    const result = await injectRouting(
      dir,
      { locales: ['fr', 'en'], defaultLocale: 'fr' },
      { silent: true },
    );

    expect(result.skipped).toBe(true);
    expect(result.modified).toBe(false);
    const content = await readFile(join(dir, 'i18n', 'routing.ts'), 'utf-8');
    expect(content).toBe(existing); // inchangé
  });
});

describe('injectAll', () => {
  it("continue les étapes suivantes si une échoue", async () => {
    const dir = await makeTmpDir();
    // Pas de layout.tsx → l'étape localeStructure et switcher échouent
    // Mais on met un next.config.ts pour que l'étape config réussisse
    await writeFile(join(dir, 'next.config.ts'), BASIC_CONFIG_TS);

    const result = await injectAll({
      projectRoot: dir,
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
      silent: true,
    });

    // localeStructure échoue (pas de layout.tsx)
    expect(result.localeStructure.ok).toBe(false);
    expect(result.localeStructure.error).toBeDefined();
    // Config réussit
    expect(result.config.ok).toBe(true);
    // Middleware, routing et request sont créés
    expect(result.middleware.ok).toBe(true);
    expect(result.routing.ok).toBe(true);
    expect(result.request.ok).toBe(true);
  });

  it("retourne skipped=true pour les étapes déjà configurées", async () => {
    const dir = await makeTmpDir();
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'layout.tsx'), BASIC_LAYOUT);
    await writeFile(join(dir, 'next.config.ts'), BASIC_CONFIG_TS);

    // Premier run
    await injectAll({ projectRoot: dir, locales: ['fr', 'en'], defaultLocale: 'fr', silent: true });

    // Deuxième run — tout doit être skipped
    const result = await injectAll({
      projectRoot: dir,
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
      silent: true,
    });

    expect(result.config.skipped).toBe(true);
    expect(result.middleware.skipped).toBe(true);
    expect(result.routing.skipped).toBe(true);
    expect(result.request.skipped).toBe(true);
    expect(result.localeStructure.skipped).toBe(true);
  });
});
