#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('auto-i18n')
  .description('Automatise l\'internationalisation d\'un projet React / Next.js')
  .version('0.1.0');

program
  .command('init')
  .description('Initialise l\'i18n : scan, traduction et réécriture du projet')
  .option('--dry-run', 'Prévisualise les changements sans modifier les fichiers')
  .action((_options) => {
    // TODO: implémenter la logique init
    console.log('init — non encore implémenté');
  });

program
  .command('sync')
  .description('Rescanne le projet et met à jour les traductions existantes')
  .action(() => {
    // TODO: implémenter la logique sync
    console.log('sync — non encore implémenté');
  });

program
  .command('add-locale <locale>')
  .description('Ajoute une nouvelle langue cible (ex: auto-i18n add-locale ar)')
  .action((_locale) => {
    // TODO: implémenter la logique add-locale
    console.log('add-locale — non encore implémenté');
  });

program
  .command('missing')
  .description('Affiche les strings non traduites dans les fichiers de messages')
  .action(() => {
    // TODO: implémenter la logique missing
    console.log('missing — non encore implémenté');
  });

program.parse();
