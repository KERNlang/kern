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

import { KERN_POWER_HELPER_TS_NAME, portablePowerHelperTS } from '../portable-power.js';
import type { IRNode } from '../types.js';
import { emitNativeKernBodyTSWithImports } from './body-ts.js';
import { decimalImportLineTS, decimalOpsHelpersTS } from './decimal-contract.js';
import { findTypeScriptSfcScriptBlock } from './sfc-script.js';
import { textOpsHelpersTS } from './text-contract.js';

export { findTypeScriptSfcScriptBlock } from './sfc-script.js';

export interface KernStdlibUsage {
  /** Module references `Result<…>` somewhere in a type annotation. */
  result: boolean;
  /** Module references `Option<…>` somewhere in a type annotation. */
  option: boolean;
  /** Module uses `KernUnwrapError` — auto-emitted by the slice 7 `!`
   *  rewriter when a user wrote `expr!`. Optional for back-compat with
   *  callers who only construct the result/option flags. */
  unwrap?: boolean;
  /** DECIMAL Slice 2 (Finding 1) — a `lang="kern"` handler body in this module
   *  constructs/operates on a Decimal via the KERN_STDLIB.Decimal surface
   *  (`Decimal.of`/`Decimal.add`/…). The TS leg lowers those to `decimal.js`
   *  (`new Decimal(...)` / `.plus()` / …) — an EXTERNAL npm package, NOT a global
   *  — so the generated TS file needs the `import Decimal from 'decimal.js'` line
   *  PLUS the one-time `Decimal.set({...})` canonical-context preamble at file
   *  top-level. This flag drives that injection in {@link kernStdlibPreamble}.
   *  Optional for back-compat with callers that only build the result/option
   *  flags. */
  decimal?: boolean;
  /** D1b — the EMITTED output of this module contains a `__kern_loose_eq(` call (the
   *  emitter lowers a NATIVE-body loose `==`/`!=` through that helper, so `1 == "1"`
   *  is FALSE — KERN loose `==` adds ONLY the null/undefined crossing on top of strict,
   *  no JS coercion), so its one-time top-level definition must be injected. UNLIKE the
   *  other flags this is NOT set by the IR-walk `detectKernStdlibUsage`: it is set by
   *  each injection site from the emitted code via {@link emittedCodeUsesLooseEq}, so
   *  detection equals emission exactly (an IR text-scan diverged for `==` inside `${…}`
   *  interpolations and structured-IR differential fixtures → missing def → runtime
   *  ReferenceError). Optional for back-compat with callers that only build the
   *  result/option flags. */
  looseEq?: boolean;
  /** KERN 4.5.0 item 3 — the EMITTED output of this module contains an
   *  `__kern_text_*(` call (the TS emitter lowers `Text.length`/`charAt`/
   *  `slice`/`indexOf`/`startsWith` through these code-point-walking
   *  helpers), so the one-time top-level helper block
   *  ({@link textOpsHelpersTS}) must be injected. Like `looseEq`, this is
   *  NOT set by the IR-walk `detectKernStdlibUsage` — it is set by each
   *  injection site from the EMITTED code via {@link emittedCodeUsesTextOps},
   *  so detection equals emission exactly (no risk of an IR-text-scan
   *  missing a `${…}` interpolation or a differential-harness fixture, the
   *  same reasoning `emittedCodeUsesLooseEq` documents). Optional for
   *  back-compat with callers that only build the result/option flags. */
  textOps?: boolean;
  /** Emitted native KERN output calls the checked integer-power helper. */
  power?: boolean;
}

/** Regex anchored on word boundary + opening angle so a user identifier
 *  like `Resulting` or `Options` does NOT trip the detector. The compact
 *  form is always parameterised, so requiring `<` after the name is the
 *  load-bearing safety check. */
const RESULT_REGEX = /\bResult\s*</;
const OPTION_REGEX = /\bOption\s*</;
/** Slice 7 — the rewriter emits literal `throw new KernUnwrapError(__k_tN);`
 *  in handler bodies. Anchor on `new KernUnwrapError(` so a user-defined
 *  `class KernUnwrapError extends Error {…}` does NOT trip the detector and
 *  cause double-emission with a redeclaration error. The narrow pattern
 *  still matches user code that constructs the class via `new`, which is
 *  the only case where the auto-emitted definition is needed. */
const UNWRAP_REGEX = /\bnew\s+KernUnwrapError\s*\(/;

/** DECIMAL Slice 2 (Finding 1) / Slice 3 — match a call to the KERN_STDLIB.Decimal
 *  surface that needs the `decimal.js` import + canonical-context preamble on the TS
 *  leg. This is EVERY Decimal method that lowers to decimal.js: the producers
 *  (`of`/`add`/`sub`/`mul`/`neg`/`abs` + Slice-3 `div`/`mod`/`pow`) AND the Slice-3
 *  comparators (`eq`/`ne`/`lt`/`lte`/`gt`/`gte`/`cmp`), which lower to native
 *  decimal.js methods (`.eq()`/`.cmp()`/…) and so equally require the import.
 *  Anchored on a word boundary + the bare `Decimal` namespace ident + a known method
 *  + `(` so a user identifier like `MyDecimal` or a member read `x.Decimal` does NOT
 *  trip it. Detection runs ONLY inside a `lang="kern"` handler subtree (see
 *  `scanDecimalInKernHandlers`) — a raw `lang="ts"` handler that itself imports
 *  `decimal.js` is the author's own concern and must not be force-injected with the
 *  KERN canonical-context preamble. Kept in lockstep with the KERN_STDLIB.Decimal
 *  table — div/mod/pow additionally need the guarded-ops HELPERS, which ride the
 *  same `usage.decimal` preamble block (see `kernStdlibPreamble`). */
const DECIMAL_PRODUCER_REGEX = /\bDecimal\.(?:of|add|sub|mul|neg|abs|div|mod|pow|eq|ne|lt|lte|gt|gte|cmp)\s*\(/;

/** D1b — `__kern_loose_eq` is detected from the EMITTED OUTPUT, not an IR text-scan.
 *  The token below appears in generated TS exactly when the emitter lowered a loose
 *  `==`/`!=` (it gates the call on `ctx.coerceJsValues`), so scanning the emitted code
 *  is EXACT — detection equals emission by construction. An earlier IR-walk approach
 *  diverged from emission (a `==` inside a `${…}` template interpolation, or a
 *  structured-IR differential fixture, lowered to `__kern_loose_eq(...)` while a
 *  string-prop token-scan missed it → missing def → runtime ReferenceError). See
 *  {@link emittedCodeUsesLooseEq}; the per-target injection sites set `usage.looseEq`
 *  from it (`packages/cli/src/shared.ts`, the differential TS leg, the conformance
 *  harness). The only residual false-positive — a user STRING literal containing the
 *  literal text `__kern_loose_eq(` — is harmless (one unused helper def) and the
 *  `__kern_`-reserved prefix makes it astronomically unlikely. */
export function emittedCodeUsesLooseEq(code: string): boolean {
  return code.includes('__kern_loose_eq(');
}

/** KERN 4.5.0 item 3 — matches {@link emittedCodeUsesLooseEq}'s "detection ==
 *  emission" pattern for the Text code-point-ops helper block: any of the
 *  five reserved-prefix `__kern_text_*(` CALL tokens in the emitted TS output
 *  means `kernStdlibPreamble` must render {@link textOpsHelpersTS}'s
 *  definitions. Scanning for the call sites (not just the shared
 *  `__kern_text_well_formed(` sub-helper) keeps this independent of the
 *  helper block's own internal shape. The `__kern_`-reserved prefix makes a
 *  false-positive (a user STRING literal containing this exact token) harmless
 *  and astronomically unlikely, mirroring the loose-eq precedent. */
const TEXT_OPS_CALL_TOKENS = [
  '__kern_text_length(',
  '__kern_text_char_at(',
  '__kern_text_slice(',
  '__kern_text_index_of(',
  '__kern_text_starts_with(',
];

export function emittedCodeUsesTextOps(code: string): boolean {
  return TEXT_OPS_CALL_TOKENS.some((token) => code.includes(token));
}

/** Detection equals emission for the private checked-power call site. */
export function emittedCodeUsesPower(code: string): boolean {
  return code.includes(`${KERN_POWER_HELPER_TS_NAME}(`);
}

/** DECIMAL Slice 2 (Finding 1 — remediation) — blank out comment and
 *  string/template-literal CONTENT before applying {@link DECIMAL_PRODUCER_REGEX}
 *  to a raw `lang="kern"` body, so a `Decimal.of(` mention that lives ONLY inside a
 *  line/block comment or a `"…"` / `'…'` / `` `…` `` literal does NOT trip the
 *  detector into injecting a spurious `decimal.js` import + `Decimal.set(...)`
 *  preamble into a module that never actually lowers a Decimal.
 *
 *  This is the offset-preserving mask used by `parser-validate-effects.ts` /
 *  `parser-validate-propagation.ts` (replace content with spaces, keep length), kept
 *  byte-identical so the comment/string surface this detector ignores is exactly the
 *  one the rest of the compiler already treats as non-code.
 *
 *  SOUNDNESS (the load-bearing property): it ONLY blanks content that cannot host a
 *  real producer call — a genuine `Decimal.of("1.5")` keeps `Decimal.of(` intact
 *  (only the `"1.5"` argument is masked to `"   "`), so the regex still matches and
 *  a real producer is NEVER missed (no false NEGATIVE → no reintroduced missing
 *  import).
 *
 *  SINGLE-PASS TOKENIZER (the load-bearing CORRECTNESS fix): comments and string /
 *  template literals are matched by ONE left-to-right alternation, so a `//` or `/*`
 *  marker that lives INSIDE a string (e.g. a URL `"http://x"`) is consumed as part of
 *  the string token and is NEVER misread as a comment that blanks the rest of the
 *  line. The prior sequential-`.replace()` chain stripped line comments BEFORE masking
 *  strings, so a string-internal `//` blanked out the real `Decimal.of(` producer that
 *  followed it on the same line — a false NEGATIVE that reintroduced the very
 *  missing-import bug this mask exists to prevent. The first alternative that matches
 *  at each position wins: a comment opener only fires when the cursor is OUTSIDE any
 *  string (the string alternatives have already consumed string bodies).
 *
 *  OFFSET- AND QUOTE-PRESERVING: each token is replaced with an equal-length run so
 *  offset-dependent callers stay correct; for string/template literals the surrounding
 *  quote chars are kept (`"…"`→`"   "`, `` `…` ``→`` `   ` ``) to match the byte-shape
 *  the shared `parser-validate-*` masks produce. Comments are blanked whole. */
function maskCommentsAndStrings(code: string): string {
  // Order matters: block comment, line comment, then the three string/template
  // forms. Because alternation is leftmost-longest-by-alternative-order and the
  // scan is left-to-right, a `//` or `/*` inside an already-open string literal is
  // never reached as a comment — the string alternative consumes it first.
  const tokenRegex = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  return code.replace(tokenRegex, (m) => {
    const first = m[0];
    // String / template literal — preserve the surrounding quote chars, blank the body.
    if (first === '"' || first === "'" || first === '`') {
      return `${first}${' '.repeat(Math.max(0, m.length - 2))}${first}`;
    }
    // Line / block comment — blank the whole token.
    return ' '.repeat(m.length);
  });
}

/** True iff `code` references a Decimal producer. With `mask` (default) comment /
 *  string-literal mentions are blanked first so a `Decimal.of(` that lives ONLY in a
 *  comment or string does not force a spurious import. With `mask=false` it is a cheap
 *  RAW mention test (used as a gate before the authoritative emit-to-detect — see
 *  {@link kernHandlerUsesDecimal}): the offset-preserving mask also blanks `${…}`
 *  template interpolations, so a `Decimal.of(` the emitter DOES lower inside an
 *  interpolation is invisible to the masked scan but visible to the raw one. */
function codeUsesDecimalProducer(code: string, mask = true): boolean {
  return DECIMAL_PRODUCER_REGEX.test(mask ? maskCommentsAndStrings(code) : code);
}

function scanString(s: string, usage: KernStdlibUsage): void {
  if (!usage.result && RESULT_REGEX.test(s)) usage.result = true;
  if (!usage.option && OPTION_REGEX.test(s)) usage.option = true;
  if (UNWRAP_REGEX.test(s)) usage.unwrap = true;
}

/** DECIMAL Slice 2 (Finding 1) — true iff any string prop in `node`'s subtree
 *  references a Decimal producer. Scans the WHOLE subtree (a Decimal call can live
 *  in any body-statement prop — `let value=…`, `return value=…`, `if cond=…`, an
 *  `expression-v1`, etc.), and recurses through nested control-flow children. */
function subtreeUsesDecimalProducer(node: IRNode, mask = true): boolean {
  if (node.props) {
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && codeUsesDecimalProducer(value, mask)) return true;
      // The `{{ … }}` ExprObject escape hatch carries its source in `.code`.
      if (
        value !== null &&
        typeof value === 'object' &&
        (value as { __expr?: unknown }).__expr === true &&
        typeof (value as { code?: unknown }).code === 'string' &&
        codeUsesDecimalProducer((value as { code: string }).code, mask)
      ) {
        return true;
      }
    }
  }
  if (node.children) {
    for (const child of node.children) {
      if (subtreeUsesDecimalProducer(child, mask)) return true;
    }
  }
  return false;
}

/** D-interp — DETECTION == EMISSION for Decimal: ask the emitter directly. It records
 *  `decimal.js` in its `imports` set exactly when KERN lowers a Decimal producer —
 *  INCLUDING inside a `${…}` template interpolation that the offset-preserving
 *  comment/string mask blanks (so `subtreeUsesDecimalProducer` misses it → the import
 *  is dropped → emitted `new Decimal(...)` throws `ReferenceError` at runtime). This is
 *  the same emitter-is-the-source-of-truth principle the D1b loose-eq fix used.
 *
 *  We call the emitter EXACTLY as the real codegen path does — `functions.ts` emits the
 *  same handler via `emitNativeKernBodyTSWithImports(handler)` with no options too, and
 *  whether `decimal.js` is required is target/ctx-invariant (a `Decimal.<op>(` always
 *  lowers to `new Decimal(...)` + the import regardless of options) — so detection here
 *  cannot diverge from emission there. `body-ts` does not import this module, so the
 *  call is circular-safe. The catch is a never-throw safety net, not a real branch: the
 *  preamble pass runs AFTER the main transpile already emitted this handler through the
 *  same emitter, so a throw here is unreachable in practice; if it ever did fire we fall
 *  back to the masked text-scan rather than letting the preamble pass crash. */
function handlerEmitsDecimalImport(handler: IRNode): boolean {
  try {
    return emitNativeKernBodyTSWithImports(handler).imports.has('decimal.js');
  } catch {
    return subtreeUsesDecimalProducer(handler);
  }
}

/** D-interp — does a `lang="kern"` handler use a Decimal producer the TS leg must import
 *  for? The masked text-scan handles the common real-code case with NO emit. ONLY when a
 *  RAW (unmasked) mention exists that the mask hid — i.e. a `Decimal.<op>(` inside a `${…}`
 *  interpolation, a string, or a comment — do we pay the authoritative emit-to-detect,
 *  which resolves it as real (interpolation → import) or inert (string/comment → none).
 *  So a handler with NO raw `Decimal.<op>(` text at all is never re-emitted; the re-emit
 *  cost is bounded to the rare handler that literally spells `Decimal.<op>(` somewhere the
 *  mask blanked. Purely additive: the masked fast path is unchanged and no
 *  currently-passing case can regress (an inert string/comment mention still yields no
 *  import, an interpolation now correctly yields one). */
function kernHandlerUsesDecimal(handler: IRNode): boolean {
  return (
    subtreeUsesDecimalProducer(handler) ||
    (subtreeUsesDecimalProducer(handler, false) && handlerEmitsDecimalImport(handler))
  );
}

/** DECIMAL Slice 2 (Finding 1) — walk the IR for `handler lang="kern"` nodes and
 *  flag `usage.decimal` when any such handler body uses a Decimal producer. Gated
 *  on `lang="kern"` so the auto-injected `decimal.js` import + canonical-context
 *  preamble is rendered ONLY when KERN itself lowered the Decimal call (raw
 *  `lang="ts"`/`lang="python"` handlers own their imports). */
function scanDecimalInKernHandlers(node: IRNode, usage: KernStdlibUsage): void {
  if (usage.decimal) return;
  if (node.type === 'handler' && node.props?.lang === 'kern' && kernHandlerUsesDecimal(node)) {
    usage.decimal = true;
    return;
  }
  if (node.children) {
    for (const child of node.children) {
      scanDecimalInKernHandlers(child, usage);
      if (usage.decimal) return;
    }
  }
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
  // `unwrap` (and `decimal`) stay absent (rather than `false`) when not detected,
  // so strict `toEqual({ result, option })` callers from the slice 4 layer 2 test
  // suite continue to match without requiring updates.
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
  // DECIMAL Slice 2 (Finding 1) — separate pass so the result/option/unwrap
  // short-circuit above can't skip a `lang="kern"` Decimal handler. Scoped to
  // `lang="kern"` handler subtrees (raw `lang="ts"` handlers own their imports).
  scanDecimalInKernHandlers(root, usage);
  // D1b — `usage.looseEq` is NOT detected here: it is set by each injection site from
  // the EMITTED output via `emittedCodeUsesLooseEq` (detection == emission, no IR walk).
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

/** D1b — KERN loose-equality helper. The ONLY delta vs raw `===` is the
 *  null/undefined crossing: KERN's loose `==` adds that ONE coercion on top of
 *  strict equality and NOTHING else — it does NOT model JS `==` (no number↔string,
 *  no boolean↔number). So `1 == "1"` → `1 === "1"` → false; `true == 1` → false;
 *  `null == undefined` → true. Containers stay reference-`===` (the structural-vs-
 *  identity container slice is separately deferred — the body must stay `a === b`,
 *  NOT a deep equal). FUNCTION form, not inline expansion: it evaluates each operand
 *  EXACTLY ONCE — an inlined `(nullish(a)&&nullish(b))?true:a===b` would double-call
 *  a side-effecting operand (`foo() == bar()`). The `__kern_`-reserved name cannot
 *  collide with a user identifier, and the def is injected at most once per module.
 *  Byte-for-byte semantic mirror of the Python `_kern_loose_equal`.
 *
 *  The BODY is shared with the type-free {@link KERN_LOOSE_EQ_HELPER_JS} so the two
 *  renderings can never drift; only the signature line carries the TS annotations. */
const KERN_LOOSE_EQ_BODY = [
  '  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;',
  '  return a === b;',
  '}',
];
const KERN_LOOSE_EQ_HELPER = ['function __kern_loose_eq(a: unknown, b: unknown): boolean {', ...KERN_LOOSE_EQ_BODY];

/** D1b — type-FREE rendering of the loose-equality helper for plain-JS execution
 *  contexts that cannot run TypeScript (the differential TS leg's `vm` sandbox). The
 *  production preamble keeps the typed {@link KERN_LOOSE_EQ_HELPER}; both share the
 *  same `KERN_LOOSE_EQ_BODY`, so there is no drift. */
export const KERN_LOOSE_EQ_HELPER_JS = ['function __kern_loose_eq(a, b) {', ...KERN_LOOSE_EQ_BODY].join('\n');

export function kernStdlibPreamble(usage: KernStdlibUsage): string[] {
  if (
    !usage.result &&
    !usage.option &&
    !usage.unwrap &&
    !usage.decimal &&
    !usage.looseEq &&
    !usage.textOps &&
    !usage.power
  ) {
    return [];
  }

  const lines: string[] = [];
  // DECIMAL Slice 2 (Finding 1) — the `decimal.js` import + canonical-context
  // preamble lead the block: an `import` declaration must precede the type-alias /
  // companion-object statements below (and the injector places this whole block
  // after any hashbang / `'use client'` directive, where a top-level ESM import is
  // legal). This is the TS twin of the Python leg's inline `import decimal as
  // __k_decimal` (rendered per-function in `fnBodyCodePython`); ESM imports cannot
  // live inside a function, so the TS leg surfaces it once at file top-level here.
  if (usage.decimal) {
    lines.push('// ── KERN Decimal runtime (auto-emitted) ─────────────────────────────');
    lines.push(...decimalImportLineTS().split('\n'));
    // DECIMAL Slice 3 — the guarded div/mod/pow helpers (single-sourced in
    // `decimal-contract.ts`) ride the SAME `usage.decimal` block as the import, so
    // a `Decimal.div(a,b)` lowering's `__k_decimal_div(...)` call resolves at file
    // top-level. They are emitted UNCONDITIONALLY whenever any Decimal method is
    // used — the helpers are tiny, only reference the already-imported `Decimal`,
    // and a module that uses Decimal at all is overwhelmingly likely to want them;
    // gating per-op would add a second AST scan for no real payoff. (A comparator-
    // only module carries three unused helper functions — dead but harmless, the
    // same trade-off the Result/Option companion objects already make.)
    lines.push(...decimalOpsHelpersTS().split('\n'));
    // Separator blank ONLY when a further block follows — the shared trailing
    // `push('')` below already supplies the single blank line that separates a
    // decimal-ONLY preamble from user code. Pushing it here too produced a stray
    // DOUBLE blank line in the decimal-only path (Slice 2 nit fix).
    if (usage.power || usage.textOps || usage.result || usage.option || usage.unwrap || usage.looseEq) lines.push('');
  }

  if (usage.power) {
    lines.push('// ── KERN checked integer power (auto-emitted) ───────────────────────');
    lines.push(...portablePowerHelperTS().split('\n'));
    if (usage.textOps || usage.result || usage.option || usage.unwrap || usage.looseEq) lines.push('');
  }

  // KERN 4.5.0 item 3 — the Text code-point-ops helper block. No ESM import
  // constraint (unlike Decimal's `decimal.js` import), so order vs the other
  // blocks is free; placed right after Decimal since both are "runtime
  // helper" blocks, ahead of the Result/Option/unwrap type-alias block. Own
  // header so a textOps-ONLY module still gets a clean label.
  if (usage.textOps) {
    lines.push('// ── KERN Text code-point ops (auto-emitted) ─────────────────────────');
    lines.push(...textOpsHelpersTS().split('\n'));
    if (usage.result || usage.option || usage.unwrap || usage.looseEq) lines.push('');
  }

  if (usage.result || usage.option || usage.unwrap) {
    lines.push('// ── KERN stdlib (auto-emitted) ──────────────────────────────────────');
  }
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
  // D1b — the loose-equality helper. A plain top-level function (no ESM import
  // constraint, so order vs the Decimal/Result/Option blocks is free); injected once
  // per module. Its own label so a loose-eq-ONLY module still gets a clean header.
  if (usage.looseEq) {
    if (!usage.result && !usage.option && !usage.unwrap) {
      lines.push('// ── KERN stdlib (auto-emitted) ──────────────────────────────────────');
    }
    lines.push(...KERN_LOOSE_EQ_HELPER);
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

/** Slice 4 follow-up — inject the preamble INSIDE a Vue/Nuxt SFC's first
 *  `<script[ setup]? lang="ts">` block instead of before the SFC. The plain
 *  `injectKernStdlibPreamble` would prepend `type Result<…>` text ahead of
 *  the SFC, breaking the file's parse.
 *
 *  Only matches a TS-language script block. JavaScript script blocks
 *  (`lang="js"` or no `lang`) are left alone — the preamble emits TS
 *  syntax (generics, type aliases) which JS can't host.
 *
 *  When no matching script tag exists (template-only SFC, JS-only SFC),
 *  the preamble is dropped entirely — silently injecting it elsewhere
 *  would corrupt the file. The handler bodies in such SFCs cannot use
 *  `Result<…>` / `Option<…>` types anyway, so the dropped preamble is
 *  not load-bearing. */
export function injectKernStdlibPreambleIntoSFC(code: string, preamble: string[]): string {
  if (preamble.length === 0) return code;
  const script = findTypeScriptSfcScriptBlock(code);
  if (!script) return code;
  const before = code.slice(0, script.contentStart);
  const after = code.slice(script.contentStart);
  return `${before}${preamble.join('\n')}\n${after}`;
}

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
