# Dépendances tierces

Depuis la version **3.0.0**, `next-auto-i18n` n'embarque plus aucune copie modifiée ou figée de dépendances dans son tarball (`bundledDependencies` supprimé).

L'analyse syntaxique repose directement sur le compilateur officiel **[typescript](https://github.com/microsoft/TypeScript)** (licence Apache-2.0, zéro dépendance transitive), et la lecture des variables `.env` ainsi que le filtrage glob s'appuient sur les primitives natives de **Node.js 22.13+** (`node:util` et `node:path`).

Les licences des dépendances déclarées dans `package.json` (`@formatjs/icu-messageformat-parser`, `@inquirer/prompts`, `chalk`, `commander`, `diff`, `typescript`) sont distribuées par leurs paquets npm respectifs lors d'une installation standard.
