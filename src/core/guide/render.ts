/**
 * Rendu Markdown du guide d'intégration (`next-intl`, `react-i18next`, `expo`).
 */

import { formatTranslationArgs } from '../types.js';
import type { GuideModel, GuideString, PluralCandidate } from './model.js';

function suggestReplacement(s: GuideString, reactLike = false): string {
  if (s.safety === 'review' && s.reviewReason === 'nextjs_metadata') {
    return '⚠ metadata statique — voir section generateMetadata';
  }
  if (s.safety === 'review' && s.reviewReason === 'module_scope') {
    return '⚠ hors composant — voir note';
  }
  if (s.pluralHint && !reactLike) return '⚠ pluriel probable — voir section ICU';
  if (s.kind === 'template' && s.variables && s.variables.length > 0) {
    return `t("${s.key}", { ${formatTranslationArgs(s.variables)} })`;
  }
  if (s.kind === 'jsx-text') return `{t("${s.key}")}`;
  return `t("${s.key}")`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function icuSuggestion(candidate: PluralCandidate): string {
  const arg = candidate.variables[0]?.name ?? 'count';
  const other = candidate.value.replace(`{${arg}}`, '#');
  return `"${candidate.key}": "{${arg}, plural, one {# ...} other {${other}}}"`;
}

export function buildGuide(model: GuideModel): string {
  const lines: string[] = [];
  const isExpo = model.framework === 'expo';
  const reactLike = model.framework === 'react-i18next' || isExpo;

  lines.push(`# Guide d'intégration i18n`);
  lines.push('');
  lines.push(`> Généré le ${model.date}. **Aucun fichier source n'a été modifié.**`);
  lines.push('');
  lines.push(
    `Cet outil a détecté les textes traduisibles, généré les clés et rempli les ` +
      `catalogues \`messages/*.json\` (\`${model.sourceLocale}\` → ${model.targetLocales.map(l => `\`${l}\``).join(', ')}). ` +
      `Il reste à remplacer chaque texte par un appel \`t()\` en suivant ce guide.`,
  );
  lines.push('');

  lines.push('## Résumé');
  lines.push('');
  lines.push(`- ${model.totalStrings} string(s) détectée(s) dans ${model.files.length} fichier(s)`);
  lines.push(`- ${model.safeCount} sûre(s) à câbler, ${model.reviewCount} à revoir manuellement`);
  if (model.pluralCandidates.length > 0 && !reactLike) {
    lines.push(
      `- ${model.pluralCandidates.length} candidat(s) au pluriel ICU (voir section dédiée)`,
    );
  }
  if ((model.metadataCandidates?.length ?? 0) > 0 && !reactLike) {
    lines.push(
      `- ${model.metadataCandidates.length} texte(s) dans \`export const metadata\` (voir section \`generateMetadata\`)`,
    );
  }
  lines.push('');

  lines.push('## Comment câbler une string');
  lines.push('');
  if (isExpo) {
    lines.push(
      '**Écran / Composant Expo (React Native)** :',
      '```tsx',
      "import { Text } from 'react-native';",
      "import { useTranslation } from 'react-i18next';",
      '',
      'export function HomeScreen() {',
      '  const { t } = useTranslation();',
      '  return <Text>{t("ma_cle")}</Text>;',
      '}',
      '```',
      '',
    );
  } else if (reactLike) {
    lines.push(
      '**Composant React / Vite** :',
      '```tsx',
      "import { useTranslation } from 'react-i18next';",
      '',
      'export function App() {',
      '  const { t } = useTranslation();',
      '  return <h1>{t("ma_cle")}</h1>;',
      '}',
      '```',
      '',
    );
  } else {
    lines.push(
      '**Composant serveur** (par défaut) :',
      '```tsx',
      "import { getTranslations } from 'next-intl/server';",
      '',
      'export default async function Page() {',
      '  const t = await getTranslations();',
      '  return <h1>{t("ma_cle")}</h1>;',
      '}',
      '```',
      '',
      "**Composant client** (`'use client'`) :",
      '```tsx',
      "import { useTranslations } from 'next-intl';",
      '',
      'export function Widget() {',
      '  const t = useTranslations();',
      '  return <span>{t("ma_cle")}</span>;',
      '}',
      '```',
      '',
    );
  }

  lines.push('## Strings par fichier');
  lines.push('');
  for (const file of model.files) {
    const hook = reactLike
      ? 'useTranslation()'
      : file.runtime === 'client'
        ? 'useTranslations()'
        : 'await getTranslations()';
    lines.push(`### \`${file.relPath}\` _(${file.runtime} → \`${hook}\`)_`);
    lines.push('');
    lines.push('| Ligne | Texte | Clé | Remplacement |');
    lines.push('|------:|-------|-----|--------------|');
    for (const s of file.strings) {
      lines.push(
        `| ${s.line} | ${escapeCell(s.value)} | \`${s.key}\` | \`${escapeCell(suggestReplacement(s, reactLike))}\` |`,
      );
    }
    lines.push('');
    if (file.hasModuleScope) {
      lines.push(
        '> ⚠ Ce fichier contient des strings **hors composant** (niveau module). ' +
          "`t()` n'y est pas accessible : déplacez-les dans un composant/hook, ou exposez-les " +
          'via une fonction recevant `t`.',
        '',
      );
    }
  }

  if ((model.metadataCandidates?.length ?? 0) > 0 && !reactLike) {
    lines.push(
      '## Métadonnées Next.js (`generateMetadata`)',
      '',
      'Remplacez `export const metadata = { ... }` par une fonction asynchrone `generateMetadata` (que `sync --write` sait aussi câbler si elle existe déjà) :',
      '',
      '```tsx',
      "import { getTranslations } from 'next-intl/server';",
      '',
      'export async function generateMetadata() {',
      '  const t = await getTranslations();',
      '  return {',
      ...model.metadataCandidates.slice(0, 4).map(m => `    // "${m.value}" → t("${m.key}")`),
      '  };',
      '}',
      '```',
      '',
    );
  }

  if (model.pluralCandidates.length > 0 && !reactLike) {
    lines.push(
      '## Pluriels probables',
      '',
      `${model.pluralCandidates.length} texte(s) combinent une variable de type compteur avec un nom — adaptez en formule ICU dans \`messages/*.json\` :`,
      '',
    );
    for (const c of model.pluralCandidates) {
      lines.push(
        `- \`${c.relPath}:${c.line}\` — "${c.value}"`,
        '  ```json',
        `  ${icuSuggestion(c)}`,
        '  ```',
      );
    }
    lines.push('');
  }

  if (isExpo) {
    lines.push(
      '## Initialisation Expo / React Native',
      '',
      'Assurez-vous que `_layout.tsx` (ou `App.tsx`) importe la configuration `i18n` avant le rendu des écrans, et installez `expo-localization i18next react-i18next` si nécessaire.',
      '',
    );
  } else if (reactLike) {
    lines.push(
      '## Initialisation et pluriels',
      '',
      'Le point d’entrée importe `./i18n` avant le rendu. Le scaffold charge les catalogues et configure l’interpolation `{name}`. Pour les pluriels natifs, adaptez les clés `_one` / `_other` de react-i18next.',
      '',
    );
  } else {
    lines.push(
      '## Mise en place de `app/[locale]/` (manuel)',
      '',
      'Cet outil ne restructure pas vos routes automatiquement. Pour activer le routage par locale, déplacez le contenu de `app/` dans `app/[locale]/` et ajoutez un layout de locale enveloppant vos pages dans `NextIntlClientProvider`. Voir la [doc next-intl](https://next-intl.dev/docs/getting-started/app-router).',
      '',
    );
  }

  return lines.join('\n');
}
