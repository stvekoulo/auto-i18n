import console from 'node:console';
import process from 'node:process';

console.error(
  'Publication directe du checkout désactivée : compilez, exécutez npm run release:pack, validez le tarball puis publiez ce fichier avec npm publish <tarball> --access public.',
);
process.exitCode = 1;
