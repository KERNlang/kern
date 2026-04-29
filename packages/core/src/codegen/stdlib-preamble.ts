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
}

/** Regex anchored on word boundary + opening angle so a user identifier
 *  like `Resulting` or `Options` does NOT trip the detector. The compact
 *  form is always parameterised, so requiring `<` after the name is the
 *  load-bearing safety check. */
const RESULT_REGEX = /\bResult\s*</;
const OPTION_REGEX = /\bOption\s*</;

function scanString(s: string, usage: KernStdlibUsage): void {
  if (!usage.result && RESULT_REGEX.test(s)) usage.result = true;
  if (!usage.option && OPTION_REGEX.test(s)) usage.option = true;
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
  const usage: KernStdlibUsage = { result: false, option: false };

  function walk(node: IRNode): void {
    scanProps(node.props, usage);
    if (usage.result && usage.option) return; // both flagged — short-circuit
    if (node.children) {
      for (const child of node.children) {
        walk(child);
        if (usage.result && usage.option) return;
      }
    }
  }

  walk(root);
  return usage;
}

/** Preamble lines for the TS-family targets. Inlined into each generated
 *  module — duplication across modules is fine (TS allows identical type
 *  aliases in separate scopes). When a vendored runtime file is added in a
 *  later slice this becomes an `import …` instead. */
export function kernStdlibPreamble(usage: KernStdlibUsage): string[] {
  if (!usage.result && !usage.option) return [];

  const lines: string[] = ['// ── KERN stdlib (auto-emitted) ──────────────────────────────────────'];
  if (usage.result) {
    lines.push("type Result<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };");
  }
  if (usage.option) {
    lines.push("type Option<T> = { kind: 'some'; value: T } | { kind: 'none' };");
  }
  lines.push('');
  return lines;
}
