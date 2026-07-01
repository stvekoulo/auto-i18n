/**
 * Construction du guide d'intégration (Markdown) — pur.
 *
 * Dans le modèle zéro-mutation, l'outil ne modifie pas le code : le guide dit
 * précisément, par fichier et par string, comment câbler `t()`. C'est le
 * livrable qui remplace la réécriture automatique.
 */

import { relative } from 'path';
import type { ExtractedString, Runtime, StringKind } from '../types.js';

export interface GuideInput {
  projectRoot: string;
  sourceLocale: string;
  targetLocales: string[];
  date: string;
  strings: ExtractedString[];
  /** valeur source → clé i18n. */
  keyMap: Map<string, string>;
  /** chemin absolu → runtime. */
  fileRuntimes: Map<string, Runtime>;
}

interface GuideString {
  value: string;
  key: string;
  line: number;
  kind: StringKind;
  safety: ExtractedString['safety'];
  reviewReason?: ExtractedString['reviewReason'];
  variables?: string[];
  pluralHint?: boolean;
}

interface GuideFile {
  relPath: string;
  runtime: Runtime;
  strings: GuideString[];
  hasModuleScope: boolean;
}

/** Candidat à une forme plurielle ICU, avec sa localisation pour le rapport. */
export interface PluralCandidate {
  relPath: string;
  line: number;
  value: string;
  key: string;
  variables: string[];
}

export interface GuideModel {
  sourceLocale: string;
  targetLocales: string[];
  date: string;
  files: GuideFile[];
  totalStrings: number;
  safeCount: number;
  reviewCount: number;
  pluralCandidates: PluralCandidate[];
}

function suggestReplacement(s: GuideString): string {
  if (s.safety === 'review' && s.reviewReason === 'module_scope') {
    return '⚠ hors composant — voir note';
  }
  if (s.pluralHint) return '⚠ pluriel probable — voir section ICU';
  if (s.kind === 'template' && s.variables && s.variables.length > 0) {
    return `t("${s.key}", { ${s.variables.join(', ')} })`;
  }
  if (s.kind === 'jsx-text') return `{t("${s.key}")}`;
  return `t("${s.key}")`;
}

export function buildGuideModel(input: GuideInput): GuideModel {
  const byFile = new Map<string, ExtractedString[]>();
  for (const s of input.strings) {
    const list = byFile.get(s.file) ?? [];
    list.push(s);
    byFile.set(s.file, list);
  }

  const files: GuideFile[] = [];
  const pluralCandidates: PluralCandidate[] = [];
  let safeCount = 0;
  let reviewCount = 0;

  for (const [file, fileStrings] of byFile) {
    const relPath = relative(input.projectRoot, file).replace(/\\/g, '/');
    const strings: GuideString[] = fileStrings
      .map(s => {
        if (s.safety === 'safe') safeCount++;
        else reviewCount++;
        const key = input.keyMap.get(s.value) ?? '';
        if (s.pluralHint) {
          pluralCandidates.push({
            relPath,
            line: s.line,
            value: s.value,
            key,
            variables: s.variables ?? [],
          });
        }
        return {
          value: s.value,
          key,
          line: s.line,
          kind: s.kind,
          safety: s.safety,
          ...(s.reviewReason ? { reviewReason: s.reviewReason } : {}),
          ...(s.variables ? { variables: s.variables } : {}),
          ...(s.pluralHint ? { pluralHint: true } : {}),
        };
      })
      .sort((a, b) => a.line - b.line);

    files.push({
      relPath,
      runtime: input.fileRuntimes.get(file) ?? 'server',
      strings,
      hasModuleScope: strings.some(s => s.reviewReason === 'module_scope'),
    });
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  pluralCandidates.sort((a, b) => a.relPath.localeCompare(b.relPath) || a.line - b.line);

  return {
    sourceLocale: input.sourceLocale,
    targetLocales: input.targetLocales,
    date: input.date,
    files,
    totalStrings: input.strings.length,
    safeCount,
    reviewCount,
    pluralCandidates,
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Suggestion ICU pour un candidat pluriel : garde le texte détecté comme forme `other`. */
function icuSuggestion(candidate: PluralCandidate): string {
  const arg = candidate.variables[0] ?? 'count';
  const other = candidate.value.replace(`{${arg}}`, '#');
  return `"${candidate.key}": "{${arg}, plural, one {# ...} other {${other}}}"`;
}

export function buildGuide(model: GuideModel): string {
  const lines: string[] = [];

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

  // Résumé
  lines.push('## Résumé');
  lines.push('');
  lines.push(`- ${model.totalStrings} string(s) détectée(s) dans ${model.files.length} fichier(s)`);
  lines.push(`- ${model.safeCount} sûre(s) à câbler, ${model.reviewCount} à revoir manuellement`);
  if (model.pluralCandidates.length > 0) {
    lines.push(
      `- ${model.pluralCandidates.length} candidat(s) au pluriel ICU (voir section dédiée)`,
    );
  }
  lines.push('');

  // Mode d'emploi
  lines.push('## Comment câbler une string');
  lines.push('');
  lines.push('**Composant serveur** (par défaut) :');
  lines.push('```tsx');
  lines.push("import { getTranslations } from 'next-intl/server';");
  lines.push('');
  lines.push('export default async function Page() {');
  lines.push('  const t = await getTranslations();');
  lines.push('  return <h1>{t("ma_cle")}</h1>;');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push("**Composant client** (`'use client'`) :");
  lines.push('```tsx');
  lines.push("import { useTranslations } from 'next-intl';");
  lines.push('');
  lines.push('export function Widget() {');
  lines.push('  const t = useTranslations();');
  lines.push('  return <span>{t("ma_cle")}</span>;');
  lines.push('}');
  lines.push('```');
  lines.push('');

  // Par fichier
  lines.push('## Strings par fichier');
  lines.push('');
  for (const file of model.files) {
    const hook = file.runtime === 'client' ? 'useTranslations()' : 'await getTranslations()';
    lines.push(`### \`${file.relPath}\` _(${file.runtime} → \`${hook}\`)_`);
    lines.push('');
    lines.push('| Ligne | Texte | Clé | Remplacement |');
    lines.push('|------:|-------|-----|--------------|');
    for (const s of file.strings) {
      lines.push(
        `| ${s.line} | ${escapeCell(s.value)} | \`${s.key}\` | \`${escapeCell(suggestReplacement(s))}\` |`,
      );
    }
    lines.push('');
    if (file.hasModuleScope) {
      lines.push(
        '> ⚠ Ce fichier contient des strings **hors composant** (niveau module). ' +
          "`t()` n'y est pas accessible : déplacez-les dans un composant/hook, ou exposez-les " +
          'via une fonction recevant `t`.',
      );
      lines.push('');
    }
  }

  // Pluriels détectés
  if (model.pluralCandidates.length > 0) {
    lines.push('## Pluriels probables');
    lines.push('');
    lines.push(
      `${model.pluralCandidates.length} texte(s) combinent une variable de type compteur ` +
        '(`count`, `total`, `length`…) avec un mot — probablement une forme plurielle plutôt ' +
        'qu\'un texte figé. `t("clé", { count })` fonctionne, mais `next-intl` sait gérer ' +
        "l'accord singulier/pluriel via ICU MessageFormat : à adapter dans `messages/*.json`.",
    );
    lines.push('');
    for (const c of model.pluralCandidates) {
      lines.push(`- \`${c.relPath}:${c.line}\` — "${c.value}"`);
      lines.push(`  \`\`\`json`);
      lines.push(`  ${icuSuggestion(c)}`);
      lines.push(`  \`\`\``);
    }
    lines.push('');
  }

  // Setup app/[locale]
  lines.push('## Mise en place de `app/[locale]/` (manuel)');
  lines.push('');
  lines.push(
    'Cet outil ne restructure pas vos routes automatiquement. Pour activer le routage ' +
      'par locale, déplacez le contenu de `app/` dans `app/[locale]/` et ajoutez un layout ' +
      'de locale enveloppant vos pages dans `NextIntlClientProvider`. ' +
      'Voir la [doc next-intl](https://next-intl.dev/docs/getting-started/app-router).',
  );
  lines.push('');

  return lines.join('\n');
}
