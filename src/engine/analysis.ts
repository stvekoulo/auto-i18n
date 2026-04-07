import { Project } from 'ts-morph';
import { scanProjectDetailed } from '../scanner/index.js';
import {
  buildOccurrenceId,
  type ExtractedString,
} from '../scanner/string-extractor.js';
import { findModuleScopeStrings } from '../rewriter/const-rewriter.js';
import { findUnsafeJsxTextOccurrences } from '../rewriter/jsx-rewriter.js';
import type {
  AnalysisCandidate,
  AnalysisDiagnostic,
  AnalysisResult,
  ModuleScopeOccurrence,
} from './types.js';

export interface AnalyzeProjectInput {
  projectRoot: string;
  ignorePatterns?: string[];
  existingMessages?: Record<string, string>;
  includeModuleScope?: boolean;
  verbose?: boolean;
}

function groupByFile(strings: ExtractedString[]): Map<string, ExtractedString[]> {
  const stringsByFile = new Map<string, ExtractedString[]>();
  for (const item of strings) {
    const list = stringsByFile.get(item.filePath) ?? [];
    list.push(item);
    stringsByFile.set(item.filePath, list);
  }
  return stringsByFile;
}

function detectModuleScopeOccurrences(stringsByFile: Map<string, ExtractedString[]>): ModuleScopeOccurrence[] {
  const tsProject = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  const occurrences: ModuleScopeOccurrence[] = [];

  for (const [filePath, fileStrings] of stringsByFile) {
    const detectionMap = new Map(fileStrings.map(item => [item.value, item.value]));
    const sourceFile = tsProject.addSourceFileAtPath(filePath);
    for (const match of findModuleScopeStrings(sourceFile, detectionMap)) {
      occurrences.push({
        filePath,
        value: match.value,
        line: match.line,
        column: match.column,
      });
    }
  }

  return occurrences;
}

export async function analyzeProject(input: AnalyzeProjectInput): Promise<AnalysisResult> {
  const {
    projectRoot,
    ignorePatterns,
    existingMessages = {},
    includeModuleScope = true,
    verbose = false,
  } = input;

  const scanResult = await scanProjectDetailed(projectRoot, {
    ignorePatterns,
    verbose,
  });
  const extracted = scanResult.extracted;
  const stringsByFile = groupByFile(extracted);
  const moduleScopeOccurrences = detectModuleScopeOccurrences(stringsByFile);
  const moduleScopeIds = new Set(
    moduleScopeOccurrences.map(item => buildOccurrenceId(item)),
  );
  const translatedValues = new Set(Object.values(existingMessages));
  const unsafeIds = new Set<string>();
  const unsafeDiagnostics: AnalysisDiagnostic[] = [];

  const tsProject = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
  for (const [filePath] of stringsByFile) {
    const sourceFile = tsProject.addSourceFileAtPath(filePath);
    for (const occurrence of findUnsafeJsxTextOccurrences(sourceFile)) {
      unsafeIds.add(buildOccurrenceId({ filePath, ...occurrence }));
      unsafeDiagnostics.push({
        code: occurrence.reason,
        category: 'rewrite',
        severity: 'warning',
        file: filePath,
        line: occurrence.line,
        column: occurrence.column,
        message: `Réécriture JSX potentiellement risquée pour "${occurrence.value}"`,
        suggestedAction: 'Laissez cette string en intégration manuelle ou simplifiez le JSX inline.',
      });
    }
  }

  const diagnostics: AnalysisDiagnostic[] = [
    ...scanResult.ignored.map(({ string, reason }) => ({
      code: reason,
      category: 'scan' as const,
      severity: 'info' as const,
      file: string.filePath,
      line: string.line,
      column: string.column,
      message: `String ignorée par heuristique (${reason}): "${string.value}"`,
    })),
    ...scanResult.parseErrors.map(error => ({
      code: error.reason,
      category: 'scan' as const,
      severity: 'warning' as const,
      file: error.filePath,
      message: 'Fichier ignoré car non parsable.',
      suggestedAction: 'Vérifiez la syntaxe du fichier ou ajoutez-le à la configuration ignore.',
    })),
    ...unsafeDiagnostics,
  ];
  const candidates: AnalysisCandidate[] = extracted.map(item => {
    const occurrenceId = buildOccurrenceId(item);

    if (moduleScopeIds.has(occurrenceId)) {
      diagnostics.push({
        code: 'module_scope',
        category: 'rewrite',
        severity: 'warning',
        file: item.filePath,
        line: item.line,
        column: item.column,
        message: `String module-scope détectée: "${item.value}"`,
        suggestedAction: 'Déplacez cette string dans un composant/fonction avant réécriture automatique.',
      });
      return { ...item, status: 'module_scope' };
    }

    if (unsafeIds.has(occurrenceId)) {
      return { ...item, status: 'unsafe_to_rewrite' };
    }

    if (translatedValues.has(item.value)) {
      diagnostics.push({
        code: 'already_translated',
        category: 'scan',
        severity: 'info',
        file: item.filePath,
        line: item.line,
        column: item.column,
        message: `String déjà présente dans les messages source: "${item.value}"`,
      });
      return { ...item, status: 'already_translated' };
    }

    return { ...item, status: 'accepted' };
  });

  const selectedStatuses = new Set<AnalysisCandidate['status']>([
    'accepted',
    'already_translated',
    ...(includeModuleScope ? ['module_scope' as const] : []),
  ]);

  const selectedStrings = candidates
    .filter(item => selectedStatuses.has(item.status))
    .map(({ status: _status, ...rest }) => rest);

  const summary = {
    totalCandidates: candidates.length + scanResult.ignored.length,
    selectedCount: selectedStrings.length,
    moduleScopeCount: candidates.filter(item => item.status === 'module_scope').length,
    alreadyTranslatedCount: candidates.filter(item => item.status === 'already_translated').length,
    ignoredCount: scanResult.ignored.length,
    acceptedCount: candidates.filter(item => item.status === 'accepted').length,
  };

  return {
    candidates,
    selectedStrings,
    stringsByFile,
    moduleScopeOccurrences,
    diagnostics,
    summary,
  };
}
