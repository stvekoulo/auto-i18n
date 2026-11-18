/**
 * Calcul des modifications du codemod `sync --write` — pur (AST → édits texte).
 *
 * Ne câble que les strings `safety: 'safe'`, dans une fonction hôte identifiable
 * (composant PascalCase, hook `useXxx`, `generateMetadata`, ou export par défaut).
 * Supporte aussi l'expansion sûre des fonctions fléchées à corps concis.
 */

import ts from 'typescript';
import {
  formatTranslationArgs,
  type ExtractedString,
  type Runtime,
  type TranslationFramework,
} from '../types.js';
import { extractStringNodes, type SourceFile } from '../extraction/index.js';
import { getJsxRawTrimBounds } from '../extraction/jsx-text.js';
import {
  hasBindingConflict,
  findTopLevelTDeclaration,
  inspectTSource,
  type HostFn,
} from './bindings.js';
import { buildImportEdit, type WriteKind } from './imports.js';

export interface WriteEdit {
  start: number;
  end: number;
  replacement: string;
}

export type WriteSkipReason = 'no_host' | 'server_not_async' | 't_conflict' | 'concise_body';

export interface WriteSkip {
  value: string;
  line: number;
  reason: WriteSkipReason;
}

export interface WriteFileResult {
  edits: WriteEdit[];
  written: number;
  skipped: WriteSkip[];
}

function isFunctionLikeHost(node: ts.Node): node is HostFn {
  return (
    ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
  );
}

function isAsyncFn(fn: HostFn): boolean {
  return Boolean(fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword));
}

function hostName(fn: HostFn): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) {
    return fn.name.text;
  }
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function isDefaultExported(fn: HostFn): boolean {
  const parent = fn.parent;
  if (parent && ts.isExportAssignment(parent) && !parent.isExportEquals) return true;
  if (ts.isFunctionDeclaration(fn)) {
    return Boolean(fn.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
  }
  return false;
}

function isEligibleHostName(fn: HostFn): boolean {
  if (isDefaultExported(fn)) return true;
  const name = hostName(fn);
  if (!name) return false;
  return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name) || name === 'generateMetadata';
}

function findHostFunction(node: ts.Node): HostFn | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isFunctionLikeHost(current) && isEligibleHostName(current)) return current;
    current = current.parent;
  }
  return null;
}

interface HostEligibility {
  eligible: boolean;
  reason?: WriteSkipReason;
  inject?: { kind: WriteKind; concise: boolean };
  namespace?: string;
}

function evaluateHost(
  fn: HostFn | null,
  sf: ts.SourceFile,
  runtime: Runtime,
  framework: TranslationFramework,
): HostEligibility {
  if (!fn || !fn.body) return { eligible: false, reason: 'no_host' };
  const concise = !ts.isBlock(fn.body);
  const reactMode = framework === 'react-i18next' || framework === 'expo';

  const hook = reactMode
    ? 'useTranslation'
    : runtime === 'client'
      ? 'useTranslations'
      : 'getTranslations';
  if (hasBindingConflict(fn, sf, hook)) return { eligible: false, reason: 't_conflict' };

  const existing = findTopLevelTDeclaration(fn);
  if (existing) {
    const inspected = inspectTSource(existing, sf, framework);
    if (inspected === 'root') return { eligible: true };
    if (inspected && typeof inspected === 'object') {
      return { eligible: true, namespace: inspected.namespace };
    }
    return { eligible: false, reason: 't_conflict' };
  }

  if (reactMode) {
    return isAsyncFn(fn)
      ? { eligible: false, reason: 'no_host' }
      : { eligible: true, inject: { kind: 'react', concise } };
  }
  if (runtime === 'client') return { eligible: true, inject: { kind: 'client', concise } };

  if (!isAsyncFn(fn)) return { eligible: false, reason: 'server_not_async' };
  return { eligible: true, inject: { kind: 'server_async', concise } };
}

function buildReplacement(info: ExtractedString, key: string, node: ts.Node): string {
  const literalKey = JSON.stringify(key);
  if (info.kind === 'template' && info.variables && info.variables.length > 0) {
    return `t(${literalKey}, { ${formatTranslationArgs(info.variables)} })`;
  }
  if (info.kind === 'jsx-attribute') {
    const call = `t(${literalKey})`;
    return node.parent && ts.isJsxExpression(node.parent) ? call : `{${call}}`;
  }
  if (info.kind === 'jsx-text') return `{t(${literalKey})}`;
  return `t(${literalKey})`;
}

function buildStringEdit(
  sf: ts.SourceFile,
  info: ExtractedString,
  node: ts.Node,
  key: string,
): WriteEdit {
  if (info.kind === 'jsx-text' && ts.isJsxText(node)) {
    const { start, end } = getJsxRawTrimBounds(sf, node);
    return { start, end, replacement: `{t(${JSON.stringify(key)})}` };
  }
  return {
    start: node.getStart(sf),
    end: node.getEnd(),
    replacement: buildReplacement(info, key, node),
  };
}

function buildInjectionEdits(
  sf: ts.SourceFile,
  host: HostFn,
  kind: WriteKind,
  concise: boolean,
): WriteEdit[] {
  const stmt =
    kind === 'react'
      ? 'const { t } = useTranslation();'
      : kind === 'client'
        ? 'const t = useTranslations();'
        : 'const t = await getTranslations();';
  const body = host.body!;
  if (!concise && ts.isBlock(body)) {
    const insertAt = body.getStart(sf) + 1;
    return [{ start: insertAt, end: insertAt, replacement: `\n  ${stmt}` }];
  }
  const start = body.getStart(sf);
  const end = body.getEnd();
  return [
    { start, end: start, replacement: `{\n  ${stmt}\n  return (` },
    { start: end, end, replacement: ');\n}' },
  ];
}

export function computeWriteEdits(
  sourceFile: SourceFile,
  file: string,
  runtime: Runtime,
  keyMap: Map<string, string>,
  framework: TranslationFramework = 'next-intl',
): WriteFileResult {
  const safeNodes = extractStringNodes(sourceFile, file).filter(x => x.info.safety === 'safe');

  const edits: WriteEdit[] = [];
  const skipped: WriteSkip[] = [];
  const injectedHosts = new Set<HostFn>();
  const hostEligibility = new Map<HostFn | null, HostEligibility>();
  let importKind: WriteKind | null = null;
  let written = 0;

  for (const { info, node } of safeNodes) {
    const fullKey = keyMap.get(info.value);
    if (!fullKey) continue;

    const host = findHostFunction(node);
    let eligibility = hostEligibility.get(host);
    if (!eligibility) {
      eligibility = evaluateHost(host, sourceFile, runtime, framework);
      hostEligibility.set(host, eligibility);
    }
    if (!eligibility.eligible || !host) {
      skipped.push({ value: info.value, line: info.line, reason: eligibility.reason ?? 'no_host' });
      continue;
    }

    let localKey = fullKey;
    if (eligibility.namespace) {
      const prefix = `${eligibility.namespace}.`;
      if (!fullKey.startsWith(prefix)) {
        skipped.push({ value: info.value, line: info.line, reason: 't_conflict' });
        continue;
      }
      localKey = fullKey.slice(prefix.length);
    }

    edits.push(buildStringEdit(sourceFile, info, node, localKey));
    written++;

    if (eligibility.inject && !injectedHosts.has(host)) {
      injectedHosts.add(host);
      edits.push(
        ...buildInjectionEdits(
          sourceFile,
          host,
          eligibility.inject.kind,
          eligibility.inject.concise,
        ),
      );
      importKind = eligibility.inject.kind;
    }
  }

  if (importKind) {
    const importEdit = buildImportEdit(sourceFile, importKind);
    if (importEdit) edits.push(importEdit);
  }

  return { edits, written, skipped };
}

/** Applique des édits `[start, end)` non chevauchants à un texte source. */
export function applyEdits(content: string, edits: WriteEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) {
      throw new Error(
        `Chevauchement d'édits détecté ([${sorted[i].start}, ${sorted[i].end}) vs [${sorted[i - 1].start}, ${sorted[i - 1].end})).`,
      );
    }
  }
  let result = content;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
