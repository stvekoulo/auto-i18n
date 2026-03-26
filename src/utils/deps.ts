import { access } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type PackageManager = 'npm' | 'yarn' | 'pnpm';

/**
 * Détecte le package manager utilisé dans le projet en cherchant les lockfiles.
 * Fallback : npm.
 */
export async function detectPackageManager(projectRoot: string): Promise<PackageManager> {
  const checks: [string, PackageManager][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];

  for (const [lockfile, pm] of checks) {
    try {
      await access(join(projectRoot, lockfile));
      return pm;
    } catch {
      // lockfile absent, on continue
    }
  }

  return 'npm';
}

/**
 * Vérifie si un package est listé dans les dependencies ou devDependencies du projet.
 */
export async function isPackageInstalled(projectRoot: string, packageName: string): Promise<boolean> {
  try {
    const pkgPath = join(projectRoot, 'package.json');
    const { readFile } = await import('fs/promises');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return packageName in deps;
  } catch {
    return false;
  }
}

/**
 * Installe un package npm dans le projet cible.
 */
export async function installPackage(
  projectRoot: string,
  packageName: string,
): Promise<void> {
  const pm = await detectPackageManager(projectRoot);

  const commands: Record<PackageManager, [string, string[]]> = {
    npm: ['npm', ['install', packageName]],
    yarn: ['yarn', ['add', packageName]],
    pnpm: ['pnpm', ['add', packageName]],
  };

  const [cmd, args] = commands[pm];
  await execFileAsync(cmd, args, { cwd: projectRoot });
}
