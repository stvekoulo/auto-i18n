/**
 * Modèle de données du guide d'intégration Markdown — pur, sans I/O.
 */

import { relative } from 'node:path';
import {
  compareCodePoints,
  type ExtractedString,
  type Runtime,
  type StringKind,
  type TemplateVariable,
  type TranslationFramework,
} from '../types.js';

export interface GuideInput {
  framework?: TranslationFramework;
  projectRoot: string;
  sourceLocale: string;
  targetLocales: string[];
  date: string;
  strings: ExtractedString[];
  keyMap: Map<string, string>;
  fileRuntimes: Map<string, Runtime>;
}

export interface GuideString {
  value: string;
  key: string;
  line: number;
  kind: StringKind;
  safety: ExtractedString['safety'];
  reviewReason?: ExtractedString['reviewReason'];
  variables?: TemplateVariable[];
  pluralHint?: boolean;
}

export interface GuideFile {
  relPath: string;
  runtime: Runtime;
  strings: GuideString[];
  hasModuleScope: boolean;
  hasNextMetadata: boolean;
}

export interface PluralCandidate {
  relPath: string;
  line: number;
  value: string;
  key: string;
  variables: TemplateVariable[];
}

export interface MetadataCandidate {
  relPath: string;
  line: number;
  value: string;
  key: string;
}

export interface GuideModel {
  framework?: TranslationFramework;
  sourceLocale: string;
  targetLocales: string[];
  date: string;
  files: GuideFile[];
  totalStrings: number;
  safeCount: number;
  reviewCount: number;
  pluralCandidates: PluralCandidate[];
  metadataCandidates: MetadataCandidate[];
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
  const metadataCandidates: MetadataCandidate[] = [];
  let safeCount = 0;
  let reviewCount = 0;
  const isClientOnly = input.framework === 'react-i18next' || input.framework === 'expo';

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
        if (s.reviewReason === 'nextjs_metadata') {
          metadataCandidates.push({ relPath, line: s.line, value: s.value, key });
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
      runtime: isClientOnly ? 'client' : (input.fileRuntimes.get(file) ?? 'server'),
      strings,
      hasModuleScope: strings.some(s => s.reviewReason === 'module_scope'),
      hasNextMetadata: strings.some(s => s.reviewReason === 'nextjs_metadata'),
    });
  }

  files.sort((a, b) => compareCodePoints(a.relPath, b.relPath));
  pluralCandidates.sort((a, b) => compareCodePoints(a.relPath, b.relPath) || a.line - b.line);
  metadataCandidates.sort((a, b) => compareCodePoints(a.relPath, b.relPath) || a.line - b.line);

  return {
    framework: input.framework ?? 'next-intl',
    sourceLocale: input.sourceLocale,
    targetLocales: input.targetLocales,
    date: input.date,
    files,
    totalStrings: input.strings.length,
    safeCount,
    reviewCount,
    pluralCandidates,
    metadataCandidates,
  };
}
