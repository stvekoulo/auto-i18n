import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, realpath, rmdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const held = new AsyncLocalStorage<Set<string>>();

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function formatLockError(lockDir: string): Promise<string> {
  try {
    const raw = await readFile(join(lockDir, 'owner.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { pid?: number; startedAt?: string };
    if (typeof parsed.pid === 'number') {
      if (!isProcessAlive(parsed.pid)) {
        return `Verrou orphelin détecté (.auto-i18n.lock, PID ${parsed.pid} arrêté). Supprimez ce dossier de verrou avant de relancer.`;
      }
      return `Une opération i18n est déjà en cours (PID ${parsed.pid}, .auto-i18n.lock).`;
    }
  } catch {
    // owner.json absent ou en cours d'écriture
  }
  return 'Une opération i18n est déjà en cours (.auto-i18n.lock). Si le processus a été arrêté, supprimez ce dossier de verrou avant de relancer.';
}

/** Verrou inter-processus, réentrant uniquement dans la même chaîne d'orchestration. */
export async function withProjectLock<T>(
  root: string,
  work: () => Promise<T>,
  dryRun = false,
): Promise<T> {
  if (dryRun) return work();
  const canonical = await realpath(root);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  if (held.getStore()?.has(key)) return work();
  const lock = join(canonical, '.auto-i18n.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(await formatLockError(lock), { cause: error });
  }
  const owner = join(lock, 'owner.json');
  try {
    await writeFile(
      owner,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await held.run(new Set([...(held.getStore() ?? []), key]), work);
  } finally {
    await unlink(owner).catch(() => undefined);
    await rmdir(lock).catch(() => undefined);
  }
}
