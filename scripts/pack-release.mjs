import console from 'node:console';
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npm } from './compat-helpers.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await access(join(root, 'dist/adapters/worker/scan-worker.js'));
const tmpRoot = join(root, '.tmp');
await mkdir(tmpRoot, { recursive: true });

// Nettoie les anciens artefacts release-* pour éviter toute accumulation disque.
for (const entry of await readdir(tmpRoot)) {
  if (entry.startsWith('release-')) {
    await rm(join(tmpRoot, entry), { recursive: true, force: true });
  }
}

const stage = await mkdtemp(join(tmpRoot, 'release-'));
const [packed] = npm(
  ['pack', '--json', '--pack-destination', stage, '--ignore-scripts'],
  root,
  true,
);
console.log(JSON.stringify({ ...packed, path: join(stage, packed.filename) }));
