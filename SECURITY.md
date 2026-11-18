# Politique de sécurité

## Versions suivies

| Version | Corrections de sécurité |
| ------- | ----------------------- |
| 3.x     | oui                     |
| 2.2.x   | critiques uniquement    |
| < 2.2   | non — migrez vers 3.x   |

## Signaler une vulnérabilité

Ouvrez un avis privé via l'onglet **Security → Report a vulnerability** du
dépôt, ou écrivez à stvehart@gmail.com. Merci de ne pas ouvrir d'issue
publique tant que le correctif n'est pas publié.

Indiquez si possible : la version du paquet, la commande lancée, ce qui est
exposé, et un cas de reproduction minimal. Réponse sous 7 jours.

## Périmètre

`next-auto-i18n` est un outil de développement local et de CI. Il lit le code
source du projet, écrit des catalogues JSON, et envoie les textes manquants au
provider de traduction configuré. Entrent dans le périmètre :

- fuite de la clé API (journaux, messages d'erreur, URL, fichiers écrits, `process.env` partagé entre projets) ;
- écriture de fichiers en dehors de la racine réelle du projet (`messagesDir`, `--guide`, `rootDirs`, liens symboliques ou jonctions) ;
- exécution de code provenant du projet scanné ou d'une réponse provider ;
- corruption ou perte silencieuse de catalogues ou de composants existants.

## Ce que l'outil fait de votre clé API

- Elle est lue en mémoire depuis l'environnement du processus ou `.env.local` (`node:util.parseEnv`), sans polluer `process.env` entre plusieurs appels programmatiques.
- `init` l'écrit dans `.env.local` (mode `0600` à la création sur POSIX, refus des sauts de ligne/octets nuls, mise entre guillemets automatique des caractères `#` ou espaces) et ajoute `.env.local` à `.gitignore`.
- Elle voyage exclusivement dans un en-tête HTTP (`DeepL-Auth-Key`, `x-goog-api-key`, `Authorization: Bearer`, `x-api-key`), jamais dans une URL.
- Elle est masquée dans tout message d'erreur reprenant une réponse du provider.

Le texte extrait de votre code source est transmis au provider de traduction
choisi (`deepl`, `google`, `openai`, `gemini` ou `anthropic`). Vérifiez que cela
est compatible avec la confidentialité de votre projet avant de lancer `sync`.

## Confinement disque, dépendances et verrou

Toutes les cibles d'écriture (`messagesDir`, `--guide`, composants modifiés par `--write` ou `restore`) sont contrôlées à la fois lexicalement et via `realpath` afin d'interdire toute sortie de la racine du projet, y compris par lien symbolique ou jonction NTFS.

Le parseur AST s'appuie directement sur `typescript` (zéro dépendance transitive). La CI contrôle `npm audit --omit=dev` ainsi que l'installation réelle du tarball dans un consommateur isolé (`npm run release:verify`).

`init`, `sync`, `add-locale`, `restore` et `clean-backups` prennent un verrou `.auto-i18n.lock/` contenant le PID détenteur (`owner.json`). Lorsqu'un verrou orphelin correspond à un processus terminé, le message d'erreur l'indique explicitement avant nettoyage manuel.
