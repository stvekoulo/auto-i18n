/**
 * Confinement des chemins d'écriture à l'intérieur de la racine du projet.
 *
 * Vérifie à la fois la forme lexicale (pas de `..` sortant ni chemin absolu externe)
 * et la résolution réelle (`realpath`) du plus proche parent existant afin de bloquer
 * toute évasion par lien symbolique ou jonction NTFS.
 */

import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';

/** Vrai si `candidate` est un chemin relatif qui ne remonte pas hors de la racine. */
export function staysInsideProject(candidate: string): boolean {
  if (isAbsolute(candidate)) return false;
  const normalized = normalize(candidate).replace(/\\/g, '/');
  return normalized !== '..' && !normalized.startsWith('../');
}

function isSubPath(root: string, target: string): boolean {
  const normRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const rel = relative(normRoot, normTarget).replace(/\\/g, '/');
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
}

async function resolveExistingAncestor(
  path: string,
): Promise<{ realAncestor: string; suffix: string }> {
  let current = path;
  for (;;) {
    try {
      const realAncestor = await realpath(current);
      return { realAncestor, suffix: relative(current, path) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = dirname(current);
      if (parent === current) throw err;
      current = parent;
    }
  }
}

/**
 * Résout `candidate` par rapport à `projectRoot` et lève une erreur si la cible
 * sort de la racine (lexicalement ou via un lien symbolique / jonction).
 */
export async function assertInsideProject(projectRoot: string, candidate: string): Promise<string> {
  const absRoot = resolve(projectRoot);
  const absTarget = resolve(absRoot, candidate);
  if (!isSubPath(absRoot, absTarget)) {
    throw new Error(
      `Chemin refusé ("${candidate}") : la cible doit rester à l'intérieur du projet.`,
    );
  }

  const realRoot = await realpath(absRoot);
  const { realAncestor, suffix } = await resolveExistingAncestor(absTarget);
  const realTarget = suffix ? resolve(realAncestor, suffix) : realAncestor;

  if (!isSubPath(realRoot, realTarget)) {
    throw new Error(`Chemin refusé ("${candidate}") : un lien symbolique pointe hors du projet.`);
  }
  return absTarget;
}
