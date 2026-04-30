/**
 * KERN Parser — public API surface.
 *
 * Implementation is split across sibling modules:
 * - parser-diagnostics.ts — diagnostic infrastructure
 * - parser-tokenizer.ts   — character-level tokenizer
 * - parser-token-stream.ts — token cursor
 * - parser-style.ts       — style block parsing
 * - parser-keywords.ts    — keyword-specific handlers
 * - parser-core.ts        — line parsing, tree building, orchestration
 */

import { KernParseError } from './errors.js';
import { type ParseOptions, parseInternal } from './parser-core.js';
import type { ParserHintsConfig } from './runtime.js';
import { defaultRuntime, type KernRuntime } from './runtime.js';
import { validateSchema } from './schema.js';
import type { IRNode, ParseDiagnostic, ParseResult } from './types.js';

// ── Re-exports (preserve public API contract) ───────────────────────────

export type { Token, TokenKind } from './parser-tokenizer.js';
export { tokenizeLine } from './parser-tokenizer.js';

// ── Evolved Node Parser Hints ───────────────────────────────────────────

/** Register parser hints for an evolved node type. */
export function registerParserHints(keyword: string, hints: ParserHintsConfig): void {
  defaultRuntime.registerParserHints(keyword, hints);
}

/** Unregister parser hints (for rollback/testing). */
export function unregisterParserHints(keyword: string): void {
  defaultRuntime.unregisterParserHints(keyword);
}

/** Clear all parser hints (for test isolation). */
export function clearParserHints(): void {
  defaultRuntime.clearParserHints();
}

// ── Diagnostics API ─────────────────────────────────────────────────────

/**
 * Get diagnostic messages from the last parse() call as plain strings.
 *
 * @remarks Returns messages for all severities (error, warning, info).
 * For structured diagnostics with severity filtering, use {@link getParseDiagnostics}.
 */
export function getParseWarnings(): string[] {
  return defaultRuntime.lastParseDiagnostics.map((d) => d.message);
}

/** Get structured diagnostics from the last parse() call. */
export function getParseDiagnostics(runtime?: KernRuntime): ParseDiagnostic[] {
  const rt = runtime ?? defaultRuntime;
  return [...rt.lastParseDiagnostics];
}

// ── Public parse API ────────────────────────────────────────────────────

/**
 * Parse KERN source into an IR node tree.
 *
 * Recovers from errors gracefully — malformed lines produce `DROPPED_LINE`
 * diagnostics but never throw. Use {@link parseStrict} if you want errors to throw.
 *
 * @param source - KERN indentation-based source text
 * @param runtime - Optional KernRuntime instance for isolation (defaults to shared singleton)
 * @returns Root IRNode of the parsed tree
 *
 * @example
 * ```ts
 * const root = parse('page "Home"\n  text "Hello"');
 * // root.type === 'page', root.children[0].type === 'text'
 * ```
 *
 * @see {@link parseWithDiagnostics} to also receive parse diagnostics
 * @see {@link parseStrict} to throw on errors
 */
export function parse(source: string, runtime?: KernRuntime): IRNode {
  return parseInternal(source, false, runtime).root;
}

/**
 * Parse KERN source into a document-wrapped IR tree.
 * Unlike parse(), this always returns a `document` root so multiple
 * top-level nodes (e.g., multiple `rule` definitions) are siblings.
 */
export function parseDocument(source: string, runtime?: KernRuntime): IRNode {
  return parseInternal(source, true, runtime).root;
}

/**
 * Parse KERN source and return both the IR tree and structured diagnostics.
 *
 * Unlike {@link parse}, this returns a {@link ParseResult} containing the full
 * diagnostics array, useful for editor integrations and lint-style reporting.
 *
 * @param source - KERN indentation-based source text
 * @param runtime - Optional KernRuntime instance for isolation
 * @returns `{ root: IRNode, diagnostics: ParseDiagnostic[] }`
 */
export function parseWithDiagnostics(source: string, runtime?: KernRuntime, options?: ParseOptions): ParseResult {
  return parseInternal(source, false, runtime, options);
}

/** Parse with diagnostics (document mode).
 *
 *  Slice 7 v2 — `options.resolveImport` enables cross-module Result/Option
 *  recognition for `?`/`!` propagation. The CLI builds the resolver from a
 *  project-wide pre-pass over `.kern` files and passes it per-file; pure
 *  callers (browser playground, tests) omit it and cross-module
 *  recognition stays disabled. */
export function parseDocumentWithDiagnostics(
  source: string,
  runtime?: KernRuntime,
  options?: ParseOptions,
): ParseResult {
  return parseInternal(source, true, runtime, options);
}

/**
 * Strict parse — throws if any diagnostic has severity `'error'` or a schema violation is found.
 *
 * @param source - KERN indentation-based source text
 * @param runtime - Optional KernRuntime instance for isolation
 * @returns Root IRNode of the parsed tree
 * @throws {KernParseError} When the source contains errors or schema violations.
 *   The error includes a code frame and the full diagnostics array.
 */
export function parseStrict(source: string, runtime?: KernRuntime): IRNode {
  const { root, diagnostics } = parseWithDiagnostics(source, runtime);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    const first = errors[0];
    const err = new KernParseError(first.message, first.line, first.col, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  // Schema validation — catch malformed ASTs before they reach codegen
  const violations = validateSchema(root);
  if (violations.length > 0) {
    const first = violations[0];
    const err = new KernParseError(first.message, first.line ?? 1, first.col ?? 1, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  return root;
}

/** Strict document parse — throws KernParseError if any diagnostic has severity=error or schema violation. */
export function parseDocumentStrict(source: string, runtime?: KernRuntime): IRNode {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source, runtime);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    const first = errors[0];
    const err = new KernParseError(first.message, first.line, first.col, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  // Schema validation — catch malformed ASTs before they reach codegen
  const violations = validateSchema(root);
  if (violations.length > 0) {
    const first = violations[0];
    const err = new KernParseError(first.message, first.line ?? 1, first.col ?? 1, source);
    err.diagnostics = diagnostics;
    throw err;
  }
  return root;
}
