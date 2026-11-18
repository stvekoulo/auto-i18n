/**
 * Annotations GitHub Actions (`::error` / `::warning`) pour `next-auto-i18n check --format github`.
 */

import { relative } from 'node:path';
import type { CheckReport } from '../core/check/index.js';
import type { ExtractedString } from '../core/types.js';

function escapeAnnotation(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function renderCheckGithub(
  projectRoot: string,
  report: CheckReport,
  strings: readonly ExtractedString[],
): void {
  const uncataloguedSet = new Set(report.uncatalogued);

  for (const file of report.parseErrors) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    console.log(`::error file=${rel}::Fichier non parsable (erreur de syntaxe).`);
  }

  for (const s of strings) {
    if (!uncataloguedSet.has(s.value)) continue;
    const rel = relative(projectRoot, s.file).replace(/\\/g, '/');
    console.log(
      `::warning file=${rel},line=${s.line},col=${s.column}::Texte non catalogué : "${escapeAnnotation(s.value)}"`,
    );
  }

  for (const [locale, missing] of Object.entries(report.missingByLocale)) {
    if (missing.length > 0) {
      console.log(
        `::error title=Traductions manquantes (${locale})::${missing.length} clé(s) manquante(s) : ${escapeAnnotation(missing.slice(0, 10).join(', '))}`,
      );
    }
  }

  if (report.outdatedKeys.length > 0) {
    console.log(
      `::warning title=Traductions obsolètes::${report.outdatedKeys.length} clé(s) dont le texte source a changé : ${escapeAnnotation(report.outdatedKeys.slice(0, 10).join(', '))}`,
    );
  }

  for (const [locale, invalid] of Object.entries(report.invalidByLocale ?? {})) {
    console.log(
      `::error title=ICU invalide (${locale})::Messages ou placeholders invalides : ${escapeAnnotation(invalid.join(', '))}`,
    );
  }
}
