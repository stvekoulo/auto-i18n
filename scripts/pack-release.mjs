import console from 'node:console';
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npm } from './compat-helpers.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await access(join(root, 'dist/adapters/worker/scan-worker.js'));
await mkdir(join(root, '.tmp'), { recursive: true });
const stage = await mkdtemp(join(root, '.tmp/release-'));
for (const path of manifest.files) {
  try {
    await cp(join(root, path), join(stage, path), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
async function bundle(name, from, destination, ancestors = new Set()) {
  const require = createRequire(join(from, 'package.json'));
  const entry = require.resolve(name);
  let source = dirname(entry);
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
      if (pkg.name === name) break;
    } catch {
      /* remonter depuis le point d'entrée */
    }
    const parent = dirname(source);
    if (parent === source) throw new Error(`Manifest introuvable pour ${name}`);
    source = parent;
  }
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (name === 'minimatch')
    assert(Number(pkg.version.split('.')[0]) >= 11, 'minimatch corrigé requis');
  const target = join(destination, 'node_modules', name);
  await cp(source, target, {
    recursive: true,
    filter: path => !relative(source, path).split(/[\\/]/).includes('node_modules'),
  });
  if (name === '@ts-morph/common') {
    // Adaptation du manifeste de la copie embarquée uniquement. L'API de
    // minimatch 11 utilisée ici est vérifiée par les essais consommateurs.
    pkg.dependencies.minimatch = '^11.0.4';
    await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  }
  if (ancestors.has(source))
    throw new Error(`Dépendance cyclique non prise en charge pour l’assemblage : ${name}`);
  const next = new Set([...ancestors, source]);
  for (const dependency of Object.keys(pkg.dependencies ?? {}))
    await bundle(dependency, source, target, next);
}
await bundle('ts-morph', root, stage);
const published = { ...manifest, bundledDependencies: ['ts-morph'] };
delete published.devDependencies;
delete published.overrides;
delete published.scripts;
await writeFile(join(stage, 'package.json'), JSON.stringify(published, null, 2) + '\n');
const [packed] = npm(
  ['pack', '--json', '--pack-destination', stage, '--ignore-scripts'],
  stage,
  true,
);
assert(packed.bundled.includes('ts-morph'));
console.log(JSON.stringify({ ...packed, path: join(stage, packed.filename) }));
