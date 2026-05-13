/**
 * Shared helpers for review rules — eliminates duplication of span() and finding()
 * across base.ts, react.ts, nextjs.ts, express.ts, security.ts, vue.ts, dead-logic.ts.
 */

import { Node, SyntaxKind } from 'ts-morph';
import { deriveProvenanceRootCause } from '../derive-provenance-root-cause.js';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';
import { resolveConfidence } from './confidence-baseline.js';

/**
 * True when the file's runtime boundary is clearly non-client (server
 * component, API route, Next.js middleware). React hook rules should
 * short-circuit on these files — hooks cannot run there, so any match is
 * either unused code or a false positive.
 *
 * `shared` and `unknown` intentionally return false: shared utilities are
 * often imported from both client and server; unknown happens when reviewing
 * a single file without graph context.
 */
export function isNonClientBoundary(ctx: RuleContext): boolean {
  const b = ctx.fileContext?.boundary;
  return b === 'server' || b === 'api' || b === 'middleware';
}

/**
 * True when the source file looks like a React file — has JSX, a `react`
 * import, or calls a recognizable React hook. Used to override an aggressive
 * boundary classifier: `src/routes/Home.tsx` gets `boundary=api` from the
 * path-based classifier (because of `/routes/`), but its JSX content tells us
 * it really is a client React file where hook rules should still run.
 */
export function hasReactContent(ctx: RuleContext): boolean {
  const sf = ctx.sourceFile;
  if (sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0) return true;
  if (sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0) return true;
  if (sf.getImportDeclarations().some((i) => i.getModuleSpecifierValue() === 'react')) return true;
  const fullText = sf.getFullText();
  return /\buse(?:State|Effect|Ref|Callback|Memo|Reducer|Context|LayoutEffect)\s*[<(]/.test(fullText);
}

/**
 * Convenience: true when hook-specific rules should skip this file. Combines
 * the boundary gate with a React-content override so misclassified React
 * routes (`src/routes/Home.tsx`) still get checked.
 */
export function shouldSkipHookRules(ctx: RuleContext): boolean {
  if (!isNonClientBoundary(ctx)) return false;
  // Non-client boundary — but if it has React content, the classifier is wrong.
  return !hasReactContent(ctx);
}

export function span(file: string, line: number, col = 1, endLine?: number, endCol?: number): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: endLine ?? line, endCol: endCol ?? col };
}

/**
 * Compute a precise SourceSpan for a ts-morph Node, using 1-based line/column.
 * Used by autofix rules that need character-accurate replacement coordinates.
 */
export function nodeSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    file,
    startLine: start.line,
    startCol: start.column,
    endLine: end.line,
    endCol: end.column,
  };
}

/**
 * Compute a SourceSpan for the insertion point immediately before a node.
 * For use with FixAction.type === 'insert-before'.
 */
export function insertBeforeSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  return {
    file,
    startLine: start.line,
    startCol: start.column,
    endLine: start.line,
    endCol: start.column,
  };
}

/**
 * Compute a SourceSpan for the insertion point immediately after a node.
 * For use with FixAction.type === 'insert-after'.
 */
export function insertAfterSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    file,
    startLine: end.line,
    startCol: end.column,
    endLine: end.line,
    endCol: end.column,
  };
}

export function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  file: string,
  line: number,
  col = 1,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  const result: ReviewFinding = {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: span(file, line, col),
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
    // Always last so a per-match `extra.confidence` is clamped, and unset
    // values fall back to the per-rule baseline.
    confidence: resolveConfidence(ruleId, extra?.confidence),
  };
  // Auto-derive rootCause from provenance when the rule didn't set one
  // explicitly. Lets the ~22 React rules participate in cross-rule dedup
  // via groupFindingsByRootCause without each rule authoring its own key.
  if (!result.rootCause && result.provenance) {
    const derived = deriveProvenanceRootCause(result.provenance);
    if (derived) result.rootCause = derived;
  }
  return result;
}

export interface CleanupMatcherSpec {
  cleanupPatterns: RegExp[];
  cleanupReturnIdentifiers?: string[];
  cleanupReturnCallPattern?: RegExp;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findAssignedIdentifier(node: Node): string | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur && !Node.isVariableDeclaration(cur)) {
    cur = cur.getParent();
  }
  if (!cur || !Node.isVariableDeclaration(cur)) return undefined;
  const nameNode = cur.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
}

export function getTopLevelCleanupExpressions(body: Node): Node[] {
  if (!Node.isBlock(body)) return [body];

  const cleanupExprs: Node[] = [];
  for (const retStmt of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    let inNested = false;
    let cur: Node | undefined = retStmt.getParent();
    while (cur && cur !== body) {
      if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) {
        inNested = true;
        break;
      }
      cur = cur.getParent();
    }
    if (inNested) continue;

    const expr = retStmt.getExpression();
    if (expr) cleanupExprs.push(expr);
  }

  return cleanupExprs;
}

export function resolveCleanupExpressionTexts(expr: Node): string[] {
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return [expr.getText(), expr.getBody().getText()];
  if (Node.isCallExpression(expr)) return [expr.getText()];
  if (!Node.isIdentifier(expr)) return [expr.getText()];

  const texts = [expr.getText()];
  const declarations = expr.getSymbol()?.getDeclarations() ?? [];
  for (const decl of declarations) {
    if (Node.isFunctionDeclaration(decl) && decl.getBody()) {
      texts.push(decl.getText(), decl.getBody()!.getText());
      continue;
    }
    if (!Node.isVariableDeclaration(decl)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    texts.push(init.getText());
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      texts.push(init.getBody().getText());
    }
  }
  return texts;
}

export function cleanupExpressionMatches(expr: Node, spec: CleanupMatcherSpec): boolean {
  if (Node.isIdentifier(expr) && spec.cleanupReturnIdentifiers?.includes(expr.getText())) return true;
  if (Node.isCallExpression(expr) && spec.cleanupReturnCallPattern?.test(expr.getText())) return true;

  const texts = resolveCleanupExpressionTexts(expr);
  return texts.some((text) => spec.cleanupPatterns.some((pattern) => pattern.test(text)));
}

// ── Next.js App Router file/function classification ─────────────────────────
//
// Used by the unhandled-async carve-outs (RULE-FEEDBACK.md #1, #4). RSCs
// route their rejections to error.tsx; wrapping every await in try/catch is
// an antipattern. Route handlers don't get error.tsx but Next.js converts
// rejections to 500 — we still warn there, just with a handler-specific
// message about observability.

const APP_ROUTER_FILE_RE = /(?:^|[\\/])(?:src[\\/])?app[\\/].+\.(?:tsx|jsx|ts|js)$/;
const APP_ROUTER_ROUTE_FILE_RE = /(?:^|[\\/])(?:src[\\/])?app[\\/](?:.*[\\/])?route\.(?:ts|tsx|js|jsx)$/;
const ROUTE_HANDLER_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function hasUseClientDirective(sf: import('ts-morph').SourceFile): boolean {
  return /^['"]use client['"];?\s*$/m.test(sf.getFullText().substring(0, 200));
}

function functionReturnsJsx(fn: Node): boolean {
  // ts-morph: descendants of any function-like body include nested arrow
  // bodies; we accept that. A render function with any JSX in its body is
  // strong enough signal for the RSC carve-out.
  if (!Node.isFunctionDeclaration(fn) && !Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false;
  const body = fn.getBody();
  if (!body) return false;
  return (
    body.getDescendantsOfKind(SyntaxKind.JsxOpeningElement).length > 0 ||
    body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
    body.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0
  );
}

/**
 * True when `fn` is an async React Server Component. Used to suppress
 * unhandled-async on RSCs whose rejections are routed to the nearest
 * `error.tsx` boundary — wrapping the await in try/catch swallows errors
 * the framework is meant to handle.
 *
 * Heuristic: file lives under `(src/)app/**\/<not route>.{tsx,jsx}` (App
 * Router page/layout/component file), file has no `'use client'` directive,
 * function returns JSX, and is either the default export or a
 * PascalCase named export. See RULE-FEEDBACK.md #1.
 */
export function isReactServerComponent(fn: import('ts-morph').FunctionDeclaration, filePath: string): boolean {
  if (!APP_ROUTER_FILE_RE.test(filePath)) return false;
  if (APP_ROUTER_ROUTE_FILE_RE.test(filePath)) return false;
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return false;
  if (hasUseClientDirective(fn.getSourceFile())) return false;
  if (!fn.isAsync()) return false;
  if (!functionReturnsJsx(fn)) return false;

  const isDefault = fn.hasModifier(SyntaxKind.DefaultKeyword);
  const name = fn.getName();
  const isPascalNamedExport = name != null && /^[A-Z]/.test(name) && fn.hasModifier(SyntaxKind.ExportKeyword);
  return isDefault || isPascalNamedExport;
}

/**
 * True when `fn` is an exported Next.js App Router route-handler verb
 * (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) in an `app/**\/route.{ts,tsx}`
 * file. Pages Router API routes use `(req, res) => void` and aren't
 * recognized here. See RULE-FEEDBACK.md #4.
 */
export function isRouteHandler(fn: import('ts-morph').FunctionDeclaration, filePath: string): boolean {
  if (!APP_ROUTER_ROUTE_FILE_RE.test(filePath)) return false;
  const name = fn.getName();
  if (name == null || !ROUTE_HANDLER_VERBS.has(name)) return false;
  if (!fn.isAsync()) return false;
  return fn.hasModifier(SyntaxKind.ExportKeyword);
}

// ── Context predicates (Tier C) ────────────────────────────────────────
//
// Single source of truth for the carve-out patterns in RULE-FEEDBACK.md.
// Rules consume these instead of re-implementing path/name heuristics inline
// so the carve-out can be tuned in one place. Display paths only — these
// don't need canonicalisation.

// Matches request.ts / fetch.ts / http.ts / api-client.ts at the end of a
// path across all JS/TS variants. Kept in sync with the inline regex in
// concept-rules/unrecovered-effect.ts so a future commit can DRY them.
const TRANSPORT_FILE_RE =
  /(?:^|[\\/])(?:request|fetch|http|api-client|http-client|transport)\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

const AUTH_FILENAME_RE = /(?:^|[\\/])(?:auth|login|oauth|session|jwt)(?:\.[^/\\]+)?\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;
const AUTH_DIR_RE = /(?:^|[\\/])(?:auth|authentication|oauth)(?:[\\/]|$)/i;

/**
 * True when the file looks like a transport primitive — request wrapper, HTTP
 * client, or low-level fetch helper. Used by `unrecovered-effect` and
 * `unguarded-effect` carve-outs (RULE-FEEDBACK.md #6, #7) to allow intentional
 * throw-as-handler / token-arg patterns at this layer.
 */
export function isTransportLayer(filePath: string): boolean {
  return TRANSPORT_FILE_RE.test(filePath);
}

/**
 * True when the file is authentication-related by path or filename. Used by
 * the `unguarded-effect` auth-endpoint carve-out (RULE-FEEDBACK.md #8) along
 * with the narrower endpoint-suffix list.
 */
export function isAuthFile(filePath: string): boolean {
  return AUTH_FILENAME_RE.test(filePath) || AUTH_DIR_RE.test(filePath);
}

const LLM_CALL_RE =
  /\b(?:generateContent|createChatCompletion|createCompletion|chat\.completions\.create|sendMessage|complete|invokeModel|messages\.create)\b/;

/**
 * True when a CallExpression text matches a known LLM provider API surface.
 * Used by `llm-output-execution` / `unsanitized-history` / future LLM-flow
 * rules so the recognized-provider list lives in one place.
 *
 * Accepts a raw expression string for callers that already have it; rules
 * with a ts-morph Node should pass `node.getText()`.
 */
export function isLLMCallExpression(text: string): boolean {
  return LLM_CALL_RE.test(text);
}
