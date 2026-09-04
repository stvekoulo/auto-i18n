/**
 * Calcul des modifications du codemod `sync --write` — pur (AST → édits texte).
 *
 * Ne câble que les strings `safety: 'safe'`, et seulement dans une fonction
 * "hôte" identifiable sans ambiguïté (composant PascalCase, hook `useXxx`, ou
 * export par défaut) :
 * - Composant client (`'use client'`) → toujours éligible, `useTranslations()`.
 * - Composant serveur → seulement si la fonction hôte est déjà `async` (on ne
 *   transforme jamais une fonction sync en async : trop risqué pour les types).
 * - Un identifiant `t` déjà présent qui ne vient pas de `useTranslations`/
 *   `getTranslations` bloque le fichier (collision) plutôt que de risquer un écrasement.
 *
 * Les édits sont des remplacements de plage `[start, end)` sur le texte source
 * d'origine (jamais de mutation ts-morph en direct) : l'application est une
 * simple découpe de chaîne, appliquée de la fin vers le début.
 */

import {
  Node,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';
import { formatTranslationArgs, type ExtractedString, type Runtime } from '../types.js';
import { extractStringNodes } from '../extraction/index.js';

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

type HostFn = FunctionDeclaration | ArrowFunction | FunctionExpression;

function isFunctionLike(node: Node): node is HostFn {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  );
}

function hostName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isFunctionExpression(fn)) {
    const name = fn.getName();
    if (name) return name;
  }
  const parent = fn.getParent();
  if (parent && Node.isVariableDeclaration(parent)) {
    const nameNode = parent.getNameNode();
    if (Node.isIdentifier(nameNode)) return nameNode.getText();
  }
  return undefined;
}

function isDefaultExported(fn: Node): boolean {
  const parent = fn.getParent();
  if (parent && Node.isExportAssignment(parent) && !parent.isExportEquals()) return true;
  if (Node.isFunctionDeclaration(fn) && fn.isDefaultExport()) return true;
  return false;
}

function isEligibleHostName(fn: Node): boolean {
  if (isDefaultExported(fn)) return true;
  const name = hostName(fn);
  if (!name) return false;
  return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
}

/** Remonte jusqu'à la fonction "hôte" la plus englobante éligible (ou `null`). */
function findHostFunction(node: Node): HostFn | null {
  let current = node.getParent();
  let best: HostFn | null = null;
  while (current) {
    if (isFunctionLike(current) && isEligibleHostName(current)) {
      best = current;
    }
    current = current.getParent();
  }
  return best;
}

function hasParamNamedT(fn: HostFn): boolean {
  return fn.getParameters().some(p => p.getName() === 't');
}

const T_SOURCE_RE = /^(await\s+)?(useTranslations|getTranslations)\s*\(/;

function findTopLevelTDeclaration(fn: HostFn): Node | undefined {
  const body = fn.getBody();
  if (!body || !Node.isBlock(body)) return undefined;
  for (const stmt of body.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      if (decl.getName() === 't') return decl;
    }
  }
  return undefined;
}

function isValidTSource(decl: Node): boolean {
  if (!Node.isVariableDeclaration(decl)) return false;
  const init = decl.getInitializer();
  return init ? T_SOURCE_RE.test(init.getText()) : false;
}

interface HostEligibility {
  eligible: boolean;
  reason?: WriteSkipReason;
  inject?: { kind: 'client' | 'server_async' };
}

function evaluateHost(fn: HostFn | null, runtime: Runtime): HostEligibility {
  if (!fn) return { eligible: false, reason: 'no_host' };

  const body = fn.getBody();
  if (!body || !Node.isBlock(body)) return { eligible: false, reason: 'concise_body' };

  if (hasParamNamedT(fn)) return { eligible: true };

  const existing = findTopLevelTDeclaration(fn);
  if (existing) {
    return isValidTSource(existing)
      ? { eligible: true }
      : { eligible: false, reason: 't_conflict' };
  }

  if (runtime === 'client') return { eligible: true, inject: { kind: 'client' } };

  if (!fn.isAsync()) return { eligible: false, reason: 'server_not_async' };
  return { eligible: true, inject: { kind: 'server_async' } };
}

function buildReplacement(info: ExtractedString, key: string, node: Node): string {
  if (info.kind === 'template' && info.variables && info.variables.length > 0) {
    return `t("${key}", { ${formatTranslationArgs(info.variables)} })`;
  }
  if (info.kind === 'jsx-attribute') {
    const call = `t("${key}")`;
    const parent = node.getParent();
    return parent && Node.isJsxExpression(parent) ? call : `{${call}}`;
  }
  if (info.kind === 'jsx-text') return `{t("${key}")}`;
  return `t("${key}")`;
}

function buildStringEdit(info: ExtractedString, node: Node, key: string): WriteEdit {
  if (info.kind === 'jsx-text') {
    const rawText = node.getText();
    const offset = rawText.indexOf(info.value);
    const start = node.getStart() + Math.max(offset, 0);
    return { start, end: start + info.value.length, replacement: `{t("${key}")}` };
  }
  return {
    start: node.getStart(),
    end: node.getEnd(),
    replacement: buildReplacement(info, key, node),
  };
}

function buildInjectionEdit(host: HostFn, kind: 'client' | 'server_async'): WriteEdit {
  const stmt =
    kind === 'client' ? 'const t = useTranslations();' : 'const t = await getTranslations();';
  const body = host.getBody();
  if (!body || !Node.isBlock(body)) {
    throw new Error('invariant: host body must be a Block (checked by evaluateHost)');
  }
  const insertAt = body.getStart() + 1;
  return { start: insertAt, end: insertAt, replacement: `\n  ${stmt}` };
}

function leadingInsertOffset(sourceFile: SourceFile): number {
  const first = sourceFile.getStatements()[0];
  if (first && Node.isExpressionStatement(first)) {
    const expr = first.getExpression();
    if (Node.isStringLiteral(expr) && expr.getLiteralValue() === 'use client') {
      return first.getEnd();
    }
  }
  return 0;
}

function buildImportEdit(
  sourceFile: SourceFile,
  kind: 'client' | 'server_async',
): WriteEdit | null {
  const moduleSpecifier = kind === 'client' ? 'next-intl' : 'next-intl/server';
  const importName = kind === 'client' ? 'useTranslations' : 'getTranslations';

  const existing = sourceFile
    .getImportDeclarations()
    .find(d => d.getModuleSpecifierValue() === moduleSpecifier);

  if (existing) {
    const namedImports = existing.getNamedImports();
    if (namedImports.some(ni => ni.getName() === importName)) return null;
    if (namedImports.length > 0) {
      const last = namedImports[namedImports.length - 1];
      return { start: last.getEnd(), end: last.getEnd(), replacement: `, ${importName}` };
    }
  }

  const firstImport = sourceFile.getImportDeclarations()[0];
  const insertAt = firstImport ? firstImport.getStart() : leadingInsertOffset(sourceFile);
  // Après une directive ('use client';) ou tout autre contenu non vide, saute une ligne
  // avant l'import pour ne pas le coller au texte précédent.
  const prefix = insertAt > 0 ? '\n' : '';
  return {
    start: insertAt,
    end: insertAt,
    replacement: `${prefix}import { ${importName} } from '${moduleSpecifier}';\n`,
  };
}

/**
 * Calcule les édits du codemod pour un fichier déjà parsé. `keyMap` doit
 * provenir du même `buildSourceCatalog` que la synchronisation en cours
 * (valeur source → clé i18n).
 */
export function computeWriteEdits(
  sourceFile: SourceFile,
  file: string,
  runtime: Runtime,
  keyMap: Map<string, string>,
): WriteFileResult {
  const safeNodes = extractStringNodes(sourceFile, file).filter(x => x.info.safety === 'safe');

  const edits: WriteEdit[] = [];
  const skipped: WriteSkip[] = [];
  const injectedHosts = new Set<HostFn>();
  let importKind: 'client' | 'server_async' | null = null;
  let written = 0;

  for (const { info, node } of safeNodes) {
    const key = keyMap.get(info.value);
    if (!key) continue;

    const host = findHostFunction(node);
    const eligibility = evaluateHost(host, runtime);
    if (!eligibility.eligible || !host) {
      skipped.push({ value: info.value, line: info.line, reason: eligibility.reason ?? 'no_host' });
      continue;
    }

    edits.push(buildStringEdit(info, node, key));
    written++;

    if (eligibility.inject && !injectedHosts.has(host)) {
      injectedHosts.add(host);
      edits.push(buildInjectionEdit(host, eligibility.inject.kind));
      importKind = eligibility.inject.kind;
    }
  }

  if (importKind) {
    const importEdit = buildImportEdit(sourceFile, importKind);
    if (importEdit) edits.push(importEdit);
  }

  return { edits, written, skipped };
}

/** Applique des édits `[start, end)` (non chevauchants) à un texte source. */
export function applyEdits(content: string, edits: WriteEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = content;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
