# Politique de sécurité

## Versions suivies

| Version | Corrections de sécurité |
| ------- | ----------------------- |
| 2.x     | oui                     |
| < 2.0   | non — migrez vers 2.x   |

## Signaler une vulnérabilité

Ouvrez un avis privé via l'onglet **Security → Report a vulnerability** du
dépôt, ou écrivez à stvehart@gmail.com. Merci de ne pas ouvrir d'issue
publique tant que le correctif n'est pas publié.

Indiquez si possible : la version du paquet, la commande lancée, ce qui est
exposé, et un cas de reproduction minimal. Réponse sous 7 jours.

## Périmètre

`next-auto-i18n` est un outil de développement local. Il lit le code source du
projet, écrit des catalogues JSON, et envoie du texte à un service de
traduction externe. Entrent dans le périmètre :

- fuite de la clé API (journaux, messages d'erreur, URL, fichiers écrits) ;
- écriture de fichiers en dehors de la racine du projet ;
- exécution de code provenant du projet scanné ou d'une réponse provider ;
- corruption ou perte silencieuse de catalogues existants.

## Ce que l'outil fait de votre clé API

- Elle est lue depuis une variable d'environnement, jamais depuis la
  configuration versionnée.
- `init` l'écrit dans `.env.local` (mode `0600` à la création) et ajoute
  `.env.local` à `.gitignore`.
- Elle voyage dans un en-tête HTTP, jamais dans une URL.
- Elle est masquée dans tout message d'erreur reprenant une réponse du
  provider.

Le texte extrait de votre code source est transmis au provider de traduction
choisi (DeepL ou Google). Vérifiez que cela est compatible avec la
confidentialité de votre projet avant de lancer `sync`.

## Distribution et dépendances

Le verrou `package-lock.json` et les overrides servent au développement du dépôt. La release est assemblée séparément avec `npm run release:pack` : ts-morph et sa fermeture de dépendances installée sont embarqués dans le tarball, avec minimatch corrigé. Les essais consommateurs contrôlent la version effectivement chargée, puis compilent et exécutent de vraies applications.

Publiez le tarball validé, plutôt que le checkout directement. Le script `prepublishOnly` bloque la seconde méthode afin d'éviter de distribuer une résolution transitive différente de celle vérifiée.

`init` et `sync` prennent un verrou de projet. Les catalogues sont remplacés atomiquement individuellement ; cela ne constitue pas une transaction couvrant tous les fichiers en cas d'arrêt forcé. Le dossier `.auto-i18n.lock/` n'est à retirer manuellement qu'après avoir confirmé l'arrêt de l'opération qui le détenait.
