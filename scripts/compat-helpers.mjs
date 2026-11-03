import process from 'node:process';
import console from 'node:console';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const npmCli =
  process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
export function npm(args, cwd, json = false) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: json ? 'pipe' : 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0)
    throw new Error(
      `npm ${args[0]} a échoué (${result.status}): ${result.stderr ?? result.error ?? ''}`,
    );
  return json ? JSON.parse(result.stdout) : undefined;
}
export async function files(root, contents) {
  for (const [name, text] of Object.entries(contents)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), text);
  }
}
export async function served(command, args, cwd, verify) {
  const child = spawn(process.execPath, [command, ...args], {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Serveur arrêté : ${output}`);
      try {
        await verify();
        return;
      } catch {
        await delay(250);
      }
    }
    throw new Error(`Serveur indisponible ou rendu inattendu : ${output}`);
  } finally {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    else child.kill('SIGTERM');
    console.log('Serveur de validation arrêté.');
  }
}
