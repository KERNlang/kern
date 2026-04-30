/** Slice 4 layer 2 — stdlib preamble for Result / Option compact form.
 *
 *  Spec: docs/language/result-option-spec.md.
 *
 *  When a kern module references the reserved type names `Result<T,E>` or
 *  `Option<T>` in any type-annotation position, the generated TS module needs
 *  the corresponding type alias in scope. This module provides:
 *
 *    1. `detectKernStdlibUsage(root)` — walks the IR and flags whether each
 *       reserved name appears in any string prop value (typeAnnotation, params,
 *       generics, etc.). Skips the synthesised type alias itself if already
 *       present at the root, so a re-emission stays idempotent.
 *
 *    2. `kernStdlibPreamble(usage)` — returns the TS preamble lines to prepend
 *       to the generated module. Empty when no usage detected.
 *
 *  Scope: TS-family targets only in this slice. The lib transpiler in
 *  packages/cli/src/shared.ts is the first integrator; web / native /
 *  nextjs / express / mcp / terminal pick this up in follow-up commits with
 *  the same call pattern.
 *
 *  NOT in scope here:
 *    - Helper functions (`ok`, `err`, `some`, `none`, `map`, …) — usage
 *      detection inside handler bodies is name-collision risky and is its
 *      own design (deferred to a follow-up slice).
 *    - Python / Vue codegen — Python's `generateType` does not yet handle
 *      generic type aliases, so injecting `Result<T,E>` would regress.
 *      The explicit `union name=X kind=result …` form already works on
 *      every target. */

import type { IRNode } from '../types.js';

export interface KernStdlibUsage {
  /** Module references `Result<…>` somewhere in a type annotation. */
  result: boolean;
  /** Module references `Option<…>` somewhere in a type annotation. */
  option: boolean;
  /** Module uses `KernUnwrapError` — auto-emitted by the slice 7 `!`
   *  rewriter when a user wrote `expr!`. Optional for back-compat with
   *  callers who only construct the result/option flags. */
  unwrap?: boolean;
}

/** Regex anchored on word boundary + opening angle so a user identifier
 *  like `Resulting` or `Options` does NOT trip the detector. The compact
 *  form is always parameterised, so requiring `<` after the name is the
 *  load-bearing safety check. */
const RESULT_REGEX = /\bResult\s*</;
const OPTION_REGEX = /\bOption\s*</;
/** Slice 7 — the rewriter emits literal `KernUnwrapError(` calls in
 *  handler bodies. We detect those to know whether to include the class
 *  in the preamble. The user can't realistically type this name by
 *  accident (pascal-cased + Kern prefix), so a bare-name regex is safe. */
const UNWRAP_REGEX = /\bKernUnwrapError\b/;

function scanString(s: string, usage: KernStdlibUsage): void {
  if (!usage.result && RESULT_REGEX.test(s)) usage.result = true;
  if (!usage.option && OPTION_REGEX.test(s)) usage.option = true;
  if (UNWRAP_REGEX.test(s)) usage.unwrap = true;
}

function scanProps(props: Record<string, unknown> | undefined, usage: KernStdlibUsage): void {
  if (!props) return;
  for (const value of Object.values(props)) {
    if (typeof value === 'string') scanString(value, usage);
    // ExprObject `{ __expr: true, code: '…' }` and other shapes are ignored
    // — types never carry expression values, and scanning code would risk
    // matching `Result<` / `Option<` inside string literals or comments
    // (the same false-positive class slice 6's effects walker handles by
    // stripping comments and strings — re-applied here would be overkill
    // for type-name detection).
  }
}

export function detectKernStdlibUsage(root: IRNode): KernStdlibUsage {
  // `unwrap` stays absent (rather than `false`) when not detected, so
  // strict `toEqual({ result, option })` callers from the slice 4 layer 2
  // test suite continue to match without requiring updates.
  const usage: KernStdlibUsage = { result: false, option: false };

  function walk(node: IRNode): void {
    scanProps(node.props, usage);
    if (usage.result && usage.option && usage.unwrap) return; // all flagged — short-circuit
    if (node.children) {
      for (const child of node.children) {
        walk(child);
        if (usage.result && usage.option && usage.unwrap) return;
      }
    }
  }

  walk(root);
  return usage;
}

/** Preamble lines for the TS-family targets. Inlined into each generated
 *  module — duplication across modules is fine (TS allows identical type
 *  aliases in separate scopes). When a vendored runtime file is added in a
 *  later slice this becomes an `import …` instead.
 *
 *  Layer 3 emits the helper companion objects alongside each type. The
 *  spec asks for "pure helper functions exported from a vendored module";
 *  we ship them as a frozen `const Result = { ok, err, … }` companion to
 *  the type alias instead. The companion-object pattern lets TS hold a
 *  type AND a value of the same name in scope (chosen unanimously by the
 *  Codex/Gemini synthesis brainstorm — see commit message). User calls
 *  look like `Result.ok(value)` / `Option.map(f, o)`, eliminating the name
 *  collisions a bare `function map(...)` would cause with array methods
 *  and user code.
 *
 *  Slice 7's `?` / `!` propagation operators do NOT depend on these
 *  helpers — they desugar directly against the discriminant
 *  (`if (r.kind === 'err') return r;`), so the helper API can evolve
 *  independently. */
const RESULT_HELPERS = [
  'const Result = Object.freeze({',
  '  ok<T>(value: T): Result<T, never> { return { kind: "ok", value }; },',
  '  err<E>(error: E): Result<never, E> { return { kind: "err", error }; },',
  '  isOk<T, E>(r: Result<T, E>): r is { kind: "ok"; value: T } { return r.kind === "ok"; },',
  '  isErr<T, E>(r: Result<T, E>): r is { kind: "err"; error: E } { return r.kind === "err"; },',
  '  map<T, E, U>(f: (v: T) => U, r: Result<T, E>): Result<U, E> { return r.kind === "ok" ? { kind: "ok", value: f(r.value) } : r; },',
  '  mapErr<T, E, F>(f: (e: E) => F, r: Result<T, E>): Result<T, F> { return r.kind === "err" ? { kind: "err", error: f(r.error) } : r; },',
  '  andThen<T, E, U>(f: (v: T) => Result<U, E>, r: Result<T, E>): Result<U, E> { return r.kind === "ok" ? f(r.value) : r; },',
  '  unwrapOr<T, E>(fallback: T, r: Result<T, E>): T { return r.kind === "ok" ? r.value : fallback; },',
  '});',
];

const OPTION_HELPERS = [
  'const Option = Object.freeze({',
  '  some<T>(value: T): Option<T> { return { kind: "some", value }; },',
  '  none<T = never>(): Option<T> { return { kind: "none" }; },',
  '  isSome<T>(o: Option<T>): o is { kind: "some"; value: T } { return o.kind === "some"; },',
  '  isNone<T>(o: Option<T>): o is { kind: "none" } { return o.kind === "none"; },',
  '  map<T, U>(f: (v: T) => U, o: Option<T>): Option<U> { return o.kind === "some" ? { kind: "some", value: f(o.value) } : o; },',
  '  andThen<T, U>(f: (v: T) => Option<U>, o: Option<T>): Option<U> { return o.kind === "some" ? f(o.value) : o; },',
  '  unwrapOr<T>(fallback: T, o: Option<T>): T { return o.kind === "some" ? o.value : fallback; },',
  '});',
];

/** Slice 7 — `KernUnwrapError` carries the original err/none value when a
 *  user writes `expr!`. The class is auto-emitted alongside the slice 4
 *  helpers when at least one `!` rewrite happened in this module. */
const UNWRAP_ERROR_CLASS = [
  'class KernUnwrapError<T = unknown> extends Error {',
  '  constructor(public readonly cause: T) {',
  '    super(`KernUnwrapError: unwrap on ${(cause as { kind?: string }).kind ?? "unknown"}`);',
  '    this.name = "KernUnwrapError";',
  '  }',
  '}',
];

export function kernStdlibPreamble(usage: KernStdlibUsage): string[] {
  if (!usage.result && !usage.option && !usage.unwrap) return [];

  const lines: string[] = ['// ── KERN stdlib (auto-emitted) ──────────────────────────────────────'];
  if (usage.result) {
    lines.push("type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };");
    lines.push(...RESULT_HELPERS);
  }
  if (usage.option) {
    lines.push("type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };");
    lines.push(...OPTION_HELPERS);
  }
  if (usage.unwrap) {
    lines.push(...UNWRAP_ERROR_CLASS);
  }
  lines.push('');
  return lines;
}

/** Smart-insert the preamble into a finished TS module string. Skips the
 *  leading prologue (hashbang, directives, single-line and multi-line
 *  comments, blank lines) so the preamble lands AFTER required-first lines
 *  but BEFORE imports / declarations.
 *
 *  Why not just prepend? React/Next.js parse `'use client';` only when it's
 *  the literal first non-comment statement in the file. Putting `type
 *  Result<…>` ahead of it silently drops the directive and the bundler
 *  treats the module as a server component — invisible breakage. Same for
 *  hashbangs in `target=cli` and Ink entry artifacts: `#!/usr/bin/env node`
 *  must stay on line 1 or the binary stops being executable.
 *
 *  Multi-line block comments need careful skipping — the prior naive
 *  `startsWith('/*')` check broke after the opening line and injected the
 *  preamble inside the comment, corrupting JSDoc-style headers. We track
 *  the open block and only stop at the next real statement.
 *
 *  Caveats this layer does NOT handle: SFC formats (.vue) where the script
 *  lives inside a `<script>` block — those need format-aware injection.
 *  The dispatcher excludes them by file-extension filter; full vue/nuxt
 *  support is a follow-up slice. */
//   Tolerates an optional trailing `// …` or `/* … */` after the directive
//   so that hand-edited modules don't silently lose the preamble's directive
//   skip. (Gemini review fix.)
const DIRECTIVE_RE = /^\s*['"]use [a-z]+['"];?\s*(?:\/\/.*|\/\*[\s\S]*?\*\/)?\s*$/;

export function injectKernStdlibPreamble(code: string, preamble: string[]): string {
  if (preamble.length === 0) return code;
  if (code.length === 0) return preamble.join('\n');

  const lines = code.split('\n');
  // Find the index of the first real statement, skipping past:
  //   - hashbang on line 1
  //   - directives (`'use client';` etc.) — possibly multiple
  //   - blank lines
  //   - line comments (`// …`)
  //   - block comments (`/* … */`) including multi-line JSDoc
  // Anything else (`import …`, `export …`, `type …`, `function …`, …)
  // ends the prologue.
  let i = 0;
  let inBlockComment = false;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Inside an open /* … */: keep skipping until the closing `*/` line.
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      i++;
      continue;
    }

    if (trimmed === '') {
      i++;
      continue;
    }

    // Hashbang only legal on line 1 (Codex review fix). Always skip when found.
    if (i === 0 && trimmed.startsWith('#!')) {
      i++;
      continue;
    }

    // Single-line comment.
    if (trimmed.startsWith('//')) {
      i++;
      continue;
    }

    // Block comment — may close on same line or span multiple lines.
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      i++;
      continue;
    }

    if (DIRECTIVE_RE.test(line)) {
      i++;
      continue;
    }

    break;
  }

  if (i === 0) {
    return [...preamble, ...lines].join('\n');
  }
  return [...lines.slice(0, i), ...preamble, ...lines.slice(i)].join('\n');
}
