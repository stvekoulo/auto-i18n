import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { npm, files } from './compat-helpers.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const explicitTarball = Boolean(process.argv[2]);
const packed = explicitTarball
  ? { path: process.argv[2] }
  : npm(['run', 'release:pack', '--silent'], root, true);

await mkdir(join(root, '.tmp'), { recursive: true });
const consumer = await mkdtemp(join(root, '.tmp/consumer-'));

try {
  await files(consumer, {
    'package.json': JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { 'next-auto-i18n': `file:${packed.path.replaceAll('\\', '/')}` },
    }),
  });
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  npm(['ls', '--all', '--json'], consumer, true);
  const audit = npm(['audit', '--json'], consumer, true);
  assert.equal(audit.metadata.vulnerabilities.total, 0);

  const require = createRequire(join(consumer, 'package.json'));
  const entry = join(dirname(require.resolve('next-auto-i18n/package.json')), 'dist/index.js');
  const api = await import(pathToFileURL(entry).href);
  await files(consumer, { 'src/App.tsx': 'export function App(){return <h1>Bonjour</h1>}' });
  const scan = await api.scanProject(consumer, { workers: 2 });
  assert.equal(scan.workersUsed, 2);
  assert(scan.strings.some(string => string.value === 'Bonjour'));

  console.log(
    JSON.stringify({
      tarball: packed.path,
      dependencyTree: 'valid',
      vulnerabilities: 0,
      workers: scan.workersUsed,
    }),
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
  if (!explicitTarball) {
    await rm(dirname(packed.path), { recursive: true, force: true });
  }
}
