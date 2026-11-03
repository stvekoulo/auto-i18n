# Compatibilité des frameworks

## Versions vérifiées le 3 novembre 2026

Le tarball de `next-auto-i18n` 2.2.0 a été installé dans deux applications indépendantes sous Windows / Node 26.13. Les traductions de test sont injectées localement ; aucun abonnement ou appel facturé n’est nécessaire pour reproduire ces essais.

| Application        | Versions                                                                                    | Vérification                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Next.js App Router | Next.js **16.4.5**, next-intl **4.14.9**, React / React DOM **19.3.1**                      | `init`, `sync --write`, `sync --prune`, `check`, build de production avec webpack, réponse HTTP `/en` contenant le texte traduit. |
| React / Vite       | Vite **8.3.5**, i18next **26.7.1**, react-i18next **17.1.12**, React / React DOM **19.3.1** | Même boucle de commandes, build Vite, exécution du scaffold et rendu serveur du composant React traduit.                          |

Les versions des fixtures sont explicites dans `tests/fixtures/next/package.json` et `tests/fixtures/vite/package.json`. Cela donne une référence reproductible ; les plages de peer dependencies plus larges ne signifient pas que chaque ancienne combinaison a été testée.

## Suivre les mises à jour

Le workflow `Framework compatibility` :

- vérifie les fixtures sur Ubuntu et Windows avec Node 24 lors des changements de code ou d’assemblage ;
- s’exécute chaque lundi à 06:17 UTC avec `COMPAT_LATEST=1` pour installer les versions `latest` courantes des frameworks et dépendances de test ;
- conserve le rapport JSON des versions effectivement installées dans un artefact de CI.

Dependabot propose aussi des mises à jour hebdomadaires du dépôt et des deux manifests de fixtures. Un échec de ces contrôles appelle une correction et une mise à jour des versions de référence ; aucune compatibilité future ne peut être déduite d’un ancien build.

```bash
npm ci
npm run build
npm run test:compat
```

Pour vérifier les dernières versions publiées plutôt que les versions de référence :

```bash
# macOS / Linux
COMPAT_LATEST=1 npm run test:compat
```

```powershell
# PowerShell
$env:COMPAT_LATEST = '1'
npm run test:compat
Remove-Item Env:COMPAT_LATEST
```

Le script écrit `.tmp/compatibility-report.json` et conserve les applications générées dans `.tmp/` pour inspection. Le serveur Next.js temporaire utilise le port local 43871 et est arrêté après le contrôle.

## Points d’intégration

- **Next.js 16+ :** le scaffold crée `proxy.ts` ; sur les versions antérieures détectées, il conserve la convention `middleware.ts`. Un middleware ou proxy existant est préservé. Le cas Next.js 16 a été compilé et exécuté ; la branche historique est couverte par les tests de scaffold.
- **App Router :** le layout de locale et `NextIntlClientProvider` restent à intégrer dans l’application. Le guide indique les opérations attendues.
- **React/Vite :** `--write` injecte `useTranslation()` et réutilise un `{t}` sans namespace lorsque son origine est prouvable. Les composants `async`, les scopes ambigus et les corps fléchés sans bloc restent au guide.
- **Catalogues :** format JSON à plat. ICU complet côté next-intl ; interpolation simple `{name}` côté scaffold React. Les pluriels natifs i18next demandent une adaptation des clés.
- **Distribution :** l’artefact de release embarque ts-morph et sa fermeture de dépendances résolue, dont minimatch corrigé. Les tests consommateurs vérifient la version effectivement chargée ; le dépôt conserve un verrou npm standard pour son installation de développement.

Sources : [convention Proxy de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [intégration App Router de next-intl](https://next-intl.dev/docs/getting-started/app-router), [documentation Vite](https://vite.dev/guide/).
