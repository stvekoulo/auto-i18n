import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { npm, files, served } from './compat-helpers.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp/compat-'));
const packed = npm(['run', 'release:pack', '--silent'], root, true);
assert(packed.bundled.includes('ts-morph'), 'La dépendance corrigée manque au paquet');
const report = {
  testedAt: new Date().toISOString(),
  node: process.version,
  package: packed.version,
  apps: {},
};

for (const kind of ['next', 'vite']) {
  const app = join(work, kind);
  await mkdir(app);
  const manifest = JSON.parse(
    await readFile(join(root, 'tests/fixtures', kind, 'package.json'), 'utf8'),
  );
  if (process.env.COMPAT_LATEST === '1') {
    for (const section of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(manifest[section] ?? {}))
        manifest[section][name] = npm(['view', name, 'version', '--json'], root, true);
    }
  }
  manifest.devDependencies['next-auto-i18n'] = `file:${packed.path.replaceAll('\\', '/')}`;
  await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2));
  npm(['install', '--no-audit', '--no-fund'], app);
  npm(['ls', '--all', '--json'], app, true);
  const require = createRequire(join(app, 'package.json'));
  const cliPackage = require.resolve('next-auto-i18n/package.json');
  const api = await import(pathToFileURL(join(dirname(cliPackage), 'dist/index.js')).href);
  const morph = createRequire(
    createRequire(join(dirname(cliPackage), 'dist/index.js')).resolve('ts-morph'),
  );
  const common = createRequire(morph.resolve('@ts-morph/common'));
  const minimatchPackage = JSON.parse(
    await readFile(common.resolve('minimatch/package.json'), 'utf8'),
  );
  assert.equal(
    Number(minimatchPackage.version.split('.')[0]),
    11,
    'Le consommateur a reçu minimatch vulnérable',
  );

  if (kind === 'next') {
    await files(app, {
      'app/layout.tsx':
        "import {NextIntlClientProvider} from 'next-intl'; import {getLocale} from 'next-intl/server'; export default async function RootLayout({children}: {children: React.ReactNode}) { return <html lang={await getLocale()}><body><NextIntlClientProvider>{children}</NextIntlClientProvider></body></html>; }",
      'app/[locale]/page.tsx': 'export default async function Page(){ return <h1>Bonjour</h1>; }',
      'next.config.mjs': 'export default {};',
    });
  } else {
    await files(app, {
      'src/App.tsx':
        "import * as React from 'react'; export default function App(){return <h1>Bonjour</h1>}",
      'src/main.tsx':
        "import * as React from 'react'; import {createRoot} from 'react-dom/client'; import App from './App'; createRoot(document.getElementById('root')!).render(<App/>);",
      'index.html':
        '<!doctype html><html><head><title>Compatibility</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'vite.config.ts': "export default {esbuild: {jsx: 'automatic'}};",
    });
  }
  const initialized = await api.runInit({
    projectRoot: app,
    sourceLocale: 'fr',
    targetLocales: ['en', 'pt-BR'],
    apiKey: 'fixture-only',
    provider: {
      name: 'offline',
      translate: async (texts, { targetLocale }) => texts.map(text => `${targetLocale}:${text}`),
    },
  });
  assert.equal(initialized.exitCode, 0);
  const written = await api.runSyncCommand({ projectRoot: app, write: true });
  assert(written.writeReport.stringsWritten > 0);
  const pruned = await api.runSyncCommand({ projectRoot: app, prune: true });
  assert(!pruned.report.prunedKeys.includes('bonjour'));
  assert.equal((await api.runCheck({ projectRoot: app })).exitCode, 0);
  npm(['run', 'build'], app);
  if (kind === 'next') {
    await access(join(app, 'proxy.ts'));
    await served(
      require.resolve('next/dist/bin/next'),
      ['start', '--port', '43871'],
      app,
      async () => {
        const response = await globalThis.fetch('http://127.0.0.1:43871/en');
        assert.equal(response.status, 200);
        assert((await response.text()).includes('en:Bonjour'));
      },
    );
  } else {
    await access(join(app, 'dist/index.html'));
    // Le serveur SSR Vite exécute réellement le scaffold et le composant compilable.
    const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
    const server = await createServer({
      root: app,
      server: { middlewareMode: true },
      appType: 'custom',
    });
    try {
      await server.ssrLoadModule('/src/i18n.ts');
      const i18n = (await server.ssrLoadModule('/src/i18n.ts')).default;
      await i18n.changeLanguage('en');
      assert.equal(i18n.t('bonjour'), 'en:Bonjour');
      const { renderToString } = require('react-dom/server');
      const React = require('react');
      const { default: App } = await server.ssrLoadModule('/src/App.tsx');
      assert.equal(renderToString(React.createElement(App)), '<h1>en:Bonjour</h1>');
    } finally {
      await server.close();
    }
  }
  report.apps[kind] = {
    dependencies: manifest.dependencies,
    minimatch: minimatchPackage.version,
    build: 'passed',
    rendering: 'passed',
    initWritePruneCheck: 'passed',
  };
}
await writeFile(join(root, '.tmp/compatibility-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
