import type { ExtractedString } from '../scanner/string-extractor.js';
import type { GenerateResult } from '../generator/index.js';
import type { RewriteResult } from '../rewriter/index.js';
import type { InjectAllResult } from '../injector/index.js';
import type { TranslateMessagesResult } from '../translator/index.js';

export type AnalysisStatus =
  | 'accepted'
  | 'ignored'
  | 'already_translated'
  | 'unsafe_to_rewrite'
  | 'module_scope'
  | 'unparseable_context';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type DiagnosticCategory = 'scan' | 'rewrite' | 'translation' | 'injection';
export type StepStatus = 'success' | 'partial' | 'failed' | 'skipped';
export type RunStatus = 'success' | 'partial' | 'failed';

export interface AnalysisCandidate extends ExtractedString {
  status: AnalysisStatus;
}

export interface AnalysisDiagnostic {
  code: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  message: string;
  suggestedAction?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface AnalysisSummary {
  totalCandidates: number;
  selectedCount: number;
  moduleScopeCount: number;
  alreadyTranslatedCount: number;
  ignoredCount: number;
  acceptedCount: number;
}

export interface ModuleScopeOccurrence {
  filePath: string;
  value: string;
  line: number;
  column: number;
}

export interface AnalysisResult {
  candidates: AnalysisCandidate[];
  selectedStrings: ExtractedString[];
  stringsByFile: Map<string, ExtractedString[]>;
  moduleScopeOccurrences: ModuleScopeOccurrence[];
  diagnostics: AnalysisDiagnostic[];
  summary: AnalysisSummary;
}

export interface MessagesPlan extends GenerateResult {
  filePaths: string[];
  newKeys: string[];
  reusedKeys: string[];
}

export interface TranslationPlan {
  sourceLocale: string;
  targetLocales: string[];
  messagesDir: string;
  apiKey?: string;
  enabled: boolean;
  translationTargets: string[];
}

export interface RewritePlan {
  filePaths: string[];
  enabled: boolean;
  rewriteTargets: string[];
  rewriteBlocked: string[];
}

export interface InjectionDecision {
  target: 'config' | 'middleware' | 'routing' | 'request' | 'switcher' | 'localeStructure' | 'all';
  status: 'applicable' | 'already_present' | 'manual_required' | 'blocked';
  message: string;
  reasonCode: string;
}

export interface InjectionPlan {
  enabled: boolean;
  switcherOnly: boolean;
  locales: string[];
  defaultLocale: string;
  decisions: InjectionDecision[];
  injectionBlocked: string[];
}

export interface ProjectPlan {
  analysis: AnalysisResult;
  messagesPlan: MessagesPlan;
  translationPlan: TranslationPlan;
  rewritePlan: RewritePlan;
  injectionPlan: InjectionPlan;
  manualActions: string[];
}

export interface StepLog {
  step: 'messages' | 'translation' | 'rewrite' | 'injection';
  status: StepStatus;
  message: string;
}

export interface ProjectRunResult {
  status: RunStatus;
  plan: ProjectPlan;
  messagesWritten: boolean;
  translationResult?: TranslateMessagesResult;
  rewriteResult?: RewriteResult;
  injectionResult?: InjectAllResult;
  diagnostics: AnalysisDiagnostic[];
  modifiedFiles: string[];
  manualActions: string[];
  stepLogs: StepLog[];
}
