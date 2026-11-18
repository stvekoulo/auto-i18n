/**
 * Extraction des strings traduisibles depuis un AST TypeScript (lecture seule).
 *
 * Produit des {@link ExtractedString} enrichies de leur `scope`, `safety` et `contextHint`.
 */

import ts from 'typescript';
import type { ExtractedString, ReviewReason, StringKind, TemplateVariable } from '../types.js';
import { isTranslationCall, translationBindings } from '../scan/references.js';
import { locationOf } from './parse.js';
import {
  TRANSLATABLE_ATTRIBUTES,
  contextHintOf,
  detectRuntime,
  isInNonExtractableContext,
  isInsideNextStaticMetadata,
  isInsideNonTranslatableAttribute,
  scopeOf,
} from './context.js';
import { getJsxRawTrimBounds, isUnsafeJsxText, normalizeJsxText } from './jsx-text.js';
import { TemplateVariables, escapeIcuTemplateSegment, isPluralCandidate } from './variables.js';

export { parseSource, getSyntaxErrors, type SourceFile } from './parse.js';
export { TRANSLATABLE_ATTRIBUTES, detectRuntime };
export { toIcuName } from './variables.js';

/** Une string extraite, avec le nœud AST dont elle provient (pour le codemod `--write`). */
export interface ExtractedStringNode {
  info: ExtractedString;
  node: ts.Node;
}

function isFirstArgOfTCall(
  node: ts.Node,
  sf: ts.SourceFile,
  bindings: ReturnType<typeof translationBindings>,
): boolean {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;
  if (
    !isTranslationCall(parent, sf, bindings) &&
    !bindings.factories.has(parent.expression.getText(sf))
  ) {
    return false;
  }
  return parent.arguments.length > 0 && parent.arguments[0] === node;
}

function makeString(
  sf: ts.SourceFile,
  base: { value: string; kind: StringKind; file: string },
  node: ts.Node,
  opts: { review?: ReviewReason; variables?: TemplateVariable[]; pluralHint?: boolean } = {},
): ExtractedString {
  const scope =
    base.kind === 'jsx-text' || base.kind === 'jsx-attribute' ? 'component' : scopeOf(node);

  let safety: ExtractedString['safety'] = 'safe';
  let reviewReason = opts.review;

  if (scope === 'module') {
    safety = 'review';
    reviewReason =
      reviewReason ?? (isInsideNextStaticMetadata(node) ? 'nextjs_metadata' : 'module_scope');
  } else if (opts.review) {
    safety = 'review';
  }

  const contextHint = contextHintOf(node, sf);
  return {
    ...base,
    ...locationOf(sf, node),
    scope,
    safety,
    ...(reviewReason ? { reviewReason } : {}),
    ...(contextHint ? { contextHint } : {}),
    ...(opts.variables ? { variables: opts.variables } : {}),
    ...(opts.pluralHint ? { pluralHint: true } : {}),
  };
}

function collectJsxText(
  sf: ts.SourceFile,
  node: ts.JsxText,
  file: string,
  out: ExtractedStringNode[],
): void {
  const value = normalizeJsxText(node.getFullText(sf));
  if (!value) return;
  const { leading, trailing } = getJsxRawTrimBounds(sf, node);
  const review = isUnsafeJsxText(node, leading, trailing) ? 'jsx_inline_spacing' : undefined;
  out.push({
    info: makeString(sf, { value, kind: 'jsx-text', file }, node, { review }),
    node,
  });
}

function collectDirectJsxAttribute(
  sf: ts.SourceFile,
  attr: ts.JsxAttribute,
  file: string,
  out: ExtractedStringNode[],
): boolean {
  if (!TRANSLATABLE_ATTRIBUTES.has(attr.name.getText(sf))) return true;
  const initializer = attr.initializer;
  if (!initializer) return true;

  if (ts.isStringLiteral(initializer)) {
    const trimmed = initializer.text.trim();
    if (trimmed) {
      out.push({
        info: makeString(sf, { value: trimmed, kind: 'jsx-attribute', file }, initializer),
        node: initializer,
      });
    }
    return true;
  }

  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteral(initializer.expression)
  ) {
    const inner = initializer.expression;
    const trimmed = inner.text.trim();
    if (trimmed) {
      out.push({
        info: makeString(sf, { value: trimmed, kind: 'jsx-attribute', file }, inner),
        node: inner,
      });
    }
    return true;
  }

  // Expression complexe (ternaire, template…) dans un attribut traduisible : laisser descendre.
  return false;
}

function collectTemplateExpression(
  sf: ts.SourceFile,
  node: ts.TemplateExpression,
  file: string,
  out: ExtractedStringNode[],
  bindings: ReturnType<typeof translationBindings>,
): void {
  if (isFirstArgOfTCall(node, sf, bindings) || isInsideNonTranslatableAttribute(node)) return;

  const variables = new TemplateVariables();
  const spans = node.templateSpans;
  let reconstructed = escapeIcuTemplateSegment(node.head.text, spans.length > 0);
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const name = variables.nameFor(span.expression.getText(sf));
    const tail = escapeIcuTemplateSegment(span.literal.text, i < spans.length - 1);
    reconstructed += `{${name}}${tail}`;
  }

  const trimmed = reconstructed.trim();
  if (!trimmed) return;
  out.push({
    info: makeString(sf, { value: trimmed, kind: 'template', file }, node, {
      variables: variables.list,
      pluralHint: isPluralCandidate(variables.list),
    }),
    node,
  });
}

/**
 * Extrait toutes les strings traduisibles brutes d'un fichier (avant filtres),
 * avec leur nœud AST d'origine, en une seule passe sans chevauchement d'intervalles.
 */
export function extractStringNodes(sourceFile: ts.SourceFile, file: string): ExtractedStringNode[] {
  const results: ExtractedStringNode[] = [];
  const bindings = translationBindings(sourceFile);

  function visit(node: ts.Node): void {
    if (ts.isTaggedTemplateExpression(node)) return;
    if (ts.isJsxText(node)) {
      collectJsxText(sourceFile, node, file, results);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      if (collectDirectJsxAttribute(sourceFile, node, file, results)) return;
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      if (
        !isFirstArgOfTCall(node, sourceFile, bindings) &&
        !isInsideNonTranslatableAttribute(node)
      ) {
        const value = node.text.trim();
        if (value) {
          results.push({
            info: makeString(sourceFile, { value, kind: 'template', file }, node),
            node,
          });
        }
      }
      return;
    } else if (ts.isTemplateExpression(node)) {
      collectTemplateExpression(sourceFile, node, file, results, bindings);
      // Ne jamais extraire de sous-littéraux dans `${...}` : leurs plages chevaucheraient
      // celle du template englobant lors de `sync --write`.
      return;
    } else if (ts.isStringLiteral(node)) {
      if (
        !isFirstArgOfTCall(node, sourceFile, bindings) &&
        !isInNonExtractableContext(node, sourceFile)
      ) {
        const value = node.text.trim();
        if (value) {
          results.push({
            info: makeString(sourceFile, { value, kind: 'string-literal', file }, node),
            node,
          });
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/** Extrait toutes les strings traduisibles brutes d'un fichier (avant filtres). */
export function extractStrings(sourceFile: ts.SourceFile, file: string): ExtractedString[] {
  return extractStringNodes(sourceFile, file).map(x => x.info);
}
