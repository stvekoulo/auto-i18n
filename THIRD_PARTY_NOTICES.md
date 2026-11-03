# Dépendances embarquées

L'artefact npm de release embarque **ts-morph 28.0.0** et sa fermeture de dépendances résolue à partir du verrou de développement. Les fichiers de licence et les mentions d'auteur fournis par chaque paquet sont conservés dans son répertoire sous `node_modules`.

Dans la copie embarquée de **@ts-morph/common 0.29.0**, une adaptation est appliquée uniquement au manifeste `package.json` : la dépendance `minimatch` est passée de `^10.0.1` à `^11.0.4`. Le code de ts-morph et de @ts-morph/common est inchangé. La version corrigée est embarquée avec ses propres dépendances et fichiers de licence ; l'installation et les usages du parseur et du scaffold sont exercés dans les tests consommateurs.

Cette adaptation reste dans le répertoire temporaire d'assemblage. Le paquet d'origine installé pour développer le dépôt n'est pas modifié. Les autres dépendances non embarquées restent décrites dans le manifeste npm publié.

Sources amont : [ts-morph](https://github.com/dsherret/ts-morph), [minimatch](https://github.com/isaacs/minimatch).
