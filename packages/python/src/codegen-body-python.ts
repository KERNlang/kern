/** Native KERN handler-body codegen — Python target (slices 1–3).
 *
 *  Mirror of `packages/core/src/codegen/body-ts.ts` for the FastAPI/Python
 *  target. Walks the children of a handler with `lang=kern` and emits Python
 *  body lines. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `X = EXPR` (slice 1)
 *    - `clamp name=X value=V min=LO max=HI` — `X = max(LO, min(HI, V))`
 *    - `objectMerge name=X sources="A, B"` — `X = {**A, **B}`
 *    - `return value="EXPR"` / bare `return` (slice 1)
 *    - `if cond="EXPR"` / sibling `else` — `if EXPR:\n    body\nelse:\n    body` (slice 2c).
 *    - `while cond="EXPR"` — `while EXPR:\n    body`
 *    - `for name=i from=0 to="List.length(xs)"` — `for i in range(...)`
 *      `else > if(…)` and `else > [if(…), else_inner]` collapse to `elif EXPR:` so
 *      raw `elif` chains round-trip byte-equivalent through slice 5b migration.
 *
 *  Statement-level propagation `?` lowers to:
 *
 *      __k_t1 = await call()
 *      if __k_t1.kind == 'err':
 *          return __k_t1
 *      u = __k_t1.value
 *
 *  Slice 3 additions:
 *    - Body emit returns `{ code, imports }`. The generator uses the imports
 *      set to inject `import math` (etc.) at the top of the function body,
 *      so `Number.floor`/`ceil`/`round` lowerings work without surfacing
 *      a `NameError: math`.
 *    - `BodyEmitOptions.symbolMap` renames KERN identifiers to their
 *      Python-form equivalents at codegen time. The FastAPI generator builds
 *      a `userId → user_id` map from the param list so KERN bodies that
 *      reference `userId` resolve correctly against the snake_cased Python
 *      signature. Identifiers absent from the map pass through unchanged.
 *    - Optional-chain lowering for `member` (slice 3d): `a?.b` Python-lowers
 *      to `(a.b if a is not None else None)`. The receiver must be
 *      side-effect-free (ident or pure member chain); calls/awaits in the
 *      receiver throw with a let-bind hint to avoid double-evaluation.
 *
 *  Indentation: Python is whitespace-significant, so the recursive walk
 *  threads a `indent` string. The propagation hoist embeds its own 4-space
 *  relative indent on the `return __k_tN` line; the wrapper prepends the
 *  surrounding indent so the post-emit result nests correctly. */

import type { ExprObject, IRNode, ValueIR } from '@kernlang/core';
import {
  applyTemplate,
  assertNoDecimalOperator,
  classifyRegexLiteralIndexReadFailClose,
  classifyRegexLiteralMemberReadFailClose,
  decimalBareConstructionFailMessage,
  emitStringKeyArray,
  expandRegexIFold,
  instanceofRhsPythonType,
  instanceofRhsRejectReasonForName,
  isHostNamespaceRoot,
  isPostfixMutationOperator,
  isSupportedAssignOperator,
  isZeroWidthCapableRegex,
  KERN_STDLIB_MODULES,
  lookupStdlibCall,
  lookupStdlibProperty,
  lowerRegexAnchorsPython,
  lowerRegexNamedGroupsPython,
  needsArgParens,
  needsBinaryParens,
  normalizeRegexClasses,
  parseExpression,
  parseKeys,
  REGEX_EXEC_FAILCLOSE,
  REGEX_HOST_REGEXP_FAILCLOSE,
  REGEX_MATCHALL_NO_G_FAILCLOSE,
  REGEX_NONLITERAL_FAILCLOSE,
  REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE,
  REGEX_REPLACEALL_NO_G_FAILCLOSE,
  REGEX_SPLIT_LIMIT_FAILCLOSE,
  REGEX_SPLIT_ZEROWIDTH_FAILCLOSE,
  REGEX_TEST_G_FAILCLOSE,
  regexAstralFailMessage,
  regexCaptureMeta,
  regexIFoldFailMessage,
  regexLiteralReceiverIR,
  regexMethodRegexArgIdent,
  scanRegexAstral,
  suggestStdlibMethod,
  translateReplStringToPython,
  unmappedHostNamespaceMessage,
  unwrapTransparentReceiverIR,
  validateDecimalConstructionArg,
  validateRegexNamedGroupsPortable,
} from '@kernlang/core';
// Slice 0.9 — the TypeScript-AST closure helpers + classifier live on the Node
// subpath (the barrel is browser-safe). Python codegen is Node-side and parses
// block-bodied arrows, so it injects `typescriptClosureClassifier`.
import {
  collectFreeIdentifierNames,
  lowerJsClosureBodyToPython,
  typescriptClosureClassifier,
} from '@kernlang/core/node';
import { buildPythonParamList } from './codegen-helpers.js';
import {
  KERN_FMT_HELPER_PY,
  KERN_JS_ARRAY_FROM_HELPER_PY,
  KERN_JS_ARRAY_HELPERS_PY,
  KERN_JS_HELPER_PY,
  KERN_JS_MATH_HELPERS_PY,
  KERN_JS_NUMBER_HELPERS_PY,
  KERN_JS_OBJECT_HELPERS_PY,
  KERN_JSON_STRINGIFY_SHIM_PY,
  KERN_NULLISH_HELPER_PY,
  KERN_PAIR_HELPERS_PY,
  KERN_REGEX_MATCH_HELPER_PY,
  KERN_REGEX_MATCHALL_HELPER_PY,
  KERN_TMOD_HELPER_PY,
  KERN_TO_NUMBER_HELPER_PY,
} from './core/expr/index.js';
import {
  isSharedPortableArrayMethod,
  isSharedPortableArrayProperty,
  lowerPortableArrayMethodPy,
  lowerPortableArrayPropertyPy,
  sharedPortableMethodRequiresPureReceiver,
} from './core/expr/list-ops.js';
import { mapTsTypeToPython } from './type-map.js';

/** Parse options for Python codegen — always inject the TypeScript-backed
 *  closure classifier so block-bodied arrows parse (slice 0.9). */
const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };

/** Local `parseExpression` binding for Python codegen that always injects the
 *  TypeScript closure classifier (slice 0.9). All `parseExpr(...)` calls in this
 *  module route through here. */
function parseExpr(input: string): ReturnType<typeof parseExpression> {
  return parseExpression(input, TS_PARSE_OPTS);
}

/** Slice 3e — caller-provided options for the Python body emitter.
 *  Currently only `symbolMap`; future slices may add diagnostics, source-map
 *  hooks, or per-handler config. Keep this open-ended so 3a/3b/3d/future
 *  surface extensions can extend without breaking the call-site contract. */
export interface BodyEmitOptions {
  /** Slice 3a — KERN-identifier → Python-identifier rename map. The FastAPI
   *  generator passes `userId → user_id` (etc.) so a body that references
   *  the KERN-form `userId` resolves to the snake_cased Python parameter.
   *  Identifiers not in the map pass through unchanged. */
  symbolMap?: Record<string, string>;
  /** When true, the handler is a class member body: identifier `super`
   *  lowers to Python `super()` (so `super.m()` -> `super().m()`) and a
   *  direct `super(...)` call lowers to `super().__init__(...)`. Paired with
   *  a `symbolMap` entry `this -> self` by the class generator. */
  inClassBody?: boolean;
  /** When true, the handler is specifically a constructor body, so a direct
   *  `super(...)` call lowers to `super().__init__(...)`. Outside a constructor
   *  `super(...)` is not a parent-constructor call and is left untouched. */
  inConstructor?: boolean;
  /** Slice 4a review fix (Gemini #5) — how to lower the `?` propagation
   *  hoist's err-branch return:
   *    - 'value' (default for `fn`): `return __k_tN` so the caller sees
   *      the err Result and can chain. Matches slice 1 semantics.
   *    - 'http-exception' (FastAPI routes): `raise HTTPException(500,
   *      detail=__k_tN.error)` so route handlers don't accidentally
   *      return a 200 OK with an err body. The route emitter is
   *      responsible for adding `from fastapi import HTTPException`
   *      to the file's imports when this style is used.
   *  The route emitter walks `usedPropagation` in the result to know
   *  whether the import is actually required. */
  propagateStyle?: 'value' | 'http-exception';
  /**
   * IR-semantics differential harness opt-in (PR-3b). When `eachIterNext`
   * is true, the `each` loop emits a `_kern_trace({"op":"iter-next", ...})`
   * call as the FIRST statement inside each iteration — symmetric with
   * TS body-ts.ts. Production codegen never sets this. See
   * packages/core/src/ir/semantics/python-leg.ts for the runtime contract.
   */
  traceHooks?: { eachIterNext?: boolean; forIterNext?: boolean; letAssign?: boolean };
  /** Coercion-slice opt-out for the helper-less Ground/React declarative
   *  layer. Defaults to `true` (native KERN bodies + expression unit tests
   *  get full JS value→string coercion, injecting helpers function-locally).
   *  The Ground generators (`coalesce`/`firstDefined`/`firstTruthy`/`objectMerge`
   *  /…) emit module-level statements via `emitPyExpression` and have no
   *  channel to define `_kern_fmt`/`__kern_add`/`_KERN_UNDEFINED`, so they pass
   *  `false` to keep the pre-slice output (zero regression). Extending coercion
   *  to the Ground layer needs module-level (single-definition) helper
   *  injection — a separate follow-up. */
  coerceJsValues?: boolean;
  /** Outer-scope names the body INHERITS — typically function parameters and
   * module-level globals the wrapper has bound. Pre-populated as the
   * outermost `localScopes` map so an inner-block `let` that shadows ANY of
   * these triggers the block-scope rename (closes nero red-team Challenge 2
   * for param shadows). Each name is recorded as 'const' since the body's
   * own re-declarations of these names go through `let` (a fresh
   * declaration) rather than `assign`, so this annotation only governs
   * shadow-detection — it never blocks legitimate inner reassignment of an
   * unrelated inner binding. */
  outerBindings?: string[];
}

/** Slice 3e — public return shape. `code` is the joined body text;
 *  `imports` is the per-handler set of import identifiers
 *  (e.g., `'math'` ⇒ `import math`) that the generator must emit at the
 *  top of the function body before the code.
 *
 *  Slice 4a review fix — `usedPropagation` is true iff the body emitted at
 *  least one `?` propagation hoist. Callers using `propagateStyle:
 *  'http-exception'` use this signal to decide whether to add `from
 *  fastapi import HTTPException` to the route file's imports.
 *
 *  PR-4 — `helpers` carries runtime helper function definitions the body
 *  references (e.g. `_kern_pairs` / `_kern_async_pairs` for `each` pair-mode
 *  normalization). Consumers must emit each entry at module scope BEFORE the
 *  body's function definition so the helpers are in scope when the body
 *  runs. Set semantics give de-dup for free across multiple handlers in the
 *  same module. */
export interface BodyEmitResult {
  code: string;
  imports: Set<string>;
  usedPropagation: boolean;
  helpers: Set<string>;
}

export interface PyExpressionEmitResult {
  code: string;
  imports: Set<string>;
  helpers: Set<string>;
}

interface BodyEmitContext {
  gensymCounter: number;
  imports: Set<string>;
  /** PR-4 — runtime helper function definitions the body references.
   *  Populated lazily when codegen needs a helper (e.g. `_kern_pairs` for
   *  `each` pair-mode). Consumer emits each entry at module scope. */
  helpers: Set<string>;
  symbolMap: Record<string, string>;
  inClassBody: boolean;
  inConstructor: boolean;
  shadowedSymbols: Set<string>;
  localScopes: Array<Map<string, 'const' | 'let' | 'cell'>>;
  regexScopes: Array<Map<string, Extract<ValueIR, { kind: 'regexLit' }> | null>>;
  /** Per-scope `userName -> emittedName` map. Populated when an inner-block
   * `let` shadows an outer binding so TS block-scope (`let x=1; if(c){let x=2}
   * return x` → 1) survives Python's flat function-scope (would otherwise
   * leak 2). Parallel to `localScopes`; pushed/popped together. The outermost
   * scope never renames (function-body lets stay user-facing). Resolved via
   * `resolveLocalRename`; consulted in ident emission. */
  renameStack: Array<Map<string, string>>;
  propagateStyle: 'value' | 'http-exception';
  usedPropagation: boolean;
  /** PR-3b differential-harness opt-in (see BodyEmitOptions.traceHooks). */
  traceHooks?: { eachIterNext?: boolean; forIterNext?: boolean; letAssign?: boolean };
  /** Slice 4c review fix (OpenCode + Gemini critical) — depth of nested
   *  `try` blocks. Propagation `?` lowers to `return tmp` (or `raise
   *  HTTPException` in route mode), and BOTH bypass the enclosing
   *  `except` clause unexpectedly. Reject `?` inside try with a clear
   *  let-bind hint. Increment on try entry, decrement on try exit. */
  tryDepth: number;
  /** Depth of nested `finally` blocks. Propagation from finally would
   *  override pending control flow, so it gets a finally-specific error. */
  finallyDepth: number;
  standaloneExpression: boolean;
  /** When true, helper-dependent JS value→string coercion is emitted
   *  (`__kern_add`, `_kern_fmt`-wrapped templates, the `_KERN_UNDEFINED`
   *  sentinel + sentinel-aware `??`/`typeof`). Native KERN bodies inject the
   *  required helpers function-locally, so the default is true. The Ground/
   *  React declarative layer (`coalesce`/`firstDefined`/etc.) emits module-
   *  level statements through `emitPyExpression` with NO per-statement helper
   *  channel, so it opts out and keeps the pre-coercion-slice forms (raw `+`,
   *  raw f-string interpolation, `None` for undefined, None-only `??`).
   *  See BodyEmitOptions.coerceJsValues. */
  coerceJsValues: boolean;
  /** Slices 0+1 — block-bodied arrow closure lowering. When `emitLambdaPy`
   *  lowers a block arrow it pushes a hoisted local `def __kern_closure_N(...)`
   *  (a block of source lines) here and returns the def's NAME as the
   *  expression string. `emitChildrenPy`'s per-child loop flushes the buffer
   *  IMMEDIATELY BEFORE the statement that referenced it (at the current
   *  indent), so the def precedes its use even inside if/else/loop bodies. A
   *  buffer left non-empty when a handler body finishes is a BUG (defensive
   *  throw at the body-emit entry point). */
  pendingHoists: string[][];
  /** Monotonic gensym counter for hoisted closure def names. Separate from
   *  `gensymCounter` so closure names stay stable/independent of other
   *  gensym usage. */
  closureSeq: number;
  /** S5 review fix — CPython REJECTS the walrus operator anywhere inside a
   *  comprehension/generator ITERABLE expression ("assignment expression
   *  cannot be used in a comprehension iterable expression", a symtable check
   *  that NO amount of nesting — parens, calls, lambdas, list displays —
   *  escapes). Every site that interpolates an emitted expression into a
   *  `for … in <here>` head sets this flag (via `withWalrusBan`) while
   *  emitting that operand; every walrus-producing lowering (`&&`/`||`,
   *  impure-left `??`, `typeof`) checks it and emits the walrus-free
   *  lambda-parameter form instead: `(lambda __k_N: (<body using __k_N>))(L)`
   *  — same single-eval of L, same lazy unselected branch (the conditional
   *  lives in the lambda body), one extra closure allocation only in these
   *  rare positions. */
  banWalrus?: boolean;
  /** Slice-2 loop-variable pinning. Each entry is the INDEX into `localScopes`
   *  of a scope that is a loop BODY (an `each`/`for`/`while` body). A captured
   *  name is pinned (JS per-iteration capture → Python default arg) IFF its
   *  binding resolves at an index `>= loopScopeIndexes[0]` — i.e. at or inside
   *  the OUTERMOST enclosing loop body. Bindings declared OUTSIDE every loop
   *  (function params, accumulators, a `while` condition var) resolve below
   *  `loopScopeIndexes[0]` and stay late-bound (already JS-parity-correct).
   *  Pushed on loop-body entry, popped on exit (LIFO, mirrors `localScopes`). */
  loopScopeIndexes: number[];
  /** Slice-2 fix (agon review, claude 0.7) — one frame per active loop body,
   *  parallel to `loopScopeIndexes`. `assignLast` maps a bare assign-target
   *  name to the LAST top-level child index (within that loop body) whose
   *  subtree assigns it; `current` is the child index the loop body is
   *  emitting right now. The default-arg pin freezes a capture at def time,
   *  but JS captures BY REFERENCE — so a pinned per-iteration binding that is
   *  REASSIGNED in a LATER sibling statement diverges (JS sees the mutation,
   *  the frozen default does not). Such captures fail closed at emission
   *  instead of emitting silently wrong values. Because within-child statement
   *  order is NOT tracked (the whole top-level child shares one index), the
   *  reject is `>=` (not `>`): a reassignment in the SAME top-level child as the
   *  closure also fails closed (it cannot be proven to run before the closure).
   *  `assignLast` covers both `assign` (incl. compound/postfix `op=` forms, same
   *  node type) and `set` (a bare-name cell write).
   *
   *  Mutation-v1 note: this sibling-reassignment check applies ONLY to PINNED
   *  candidates (per-iteration loop-locals that pin via a default arg). A
   *  free-variable WRITE inside a closure body (`emitBlockClosurePy`'s
   *  `nonlocal` path) targets an OUTER binding declared below the outermost
   *  loop scope, so it is never a pin candidate and never enters this frame —
   *  the `>=` reject cannot misfire on a nonlocal-written capture. (A write to a
   *  binding that IS a per-iteration capture is rejected earlier as
   *  `closure-pinned-write`, so the two paths stay disjoint.) */
  loopLaterAssignFrames: Array<{ assignLast: Map<string, number>; current: number }>;
}

const INDENT_STEP = '    ';

function freshCtx(options?: BodyEmitOptions): BodyEmitContext {
  return {
    gensymCounter: 0,
    imports: new Set<string>(),
    helpers: new Set<string>(),
    symbolMap: options?.symbolMap ?? {},
    inClassBody: options?.inClassBody ?? false,
    inConstructor: options?.inConstructor ?? false,
    shadowedSymbols: new Set<string>(),
    localScopes: [],
    regexScopes: [],
    renameStack: [],
    propagateStyle: options?.propagateStyle ?? 'value',
    usedPropagation: false,
    tryDepth: 0,
    finallyDepth: 0,
    standaloneExpression: false,
    coerceJsValues: options?.coerceJsValues ?? true,
    traceHooks: options?.traceHooks,
    pendingHoists: [],
    closureSeq: 0,
    loopScopeIndexes: [],
    loopLaterAssignFrames: [],
  };
}

/** PR-4 — Python helpers that normalize `each` pair-mode iteration sources.
 *  Co-located with the codegen so the production emitter and the differential
 *  harness use byte-identical definitions; consumers emit the string at module
 *  scope when `BodyEmitResult.helpers` is non-empty.
 *
 *  Semantics:
 *    - `_kern_pairs(v)`: yields `(k, v)` tuples. Uses `v.items()` when present
 *      (Mapping shapes — dict, OrderedDict, custom Mapping subclasses); falls
 *      back to `iter(v)` so an iterable of `[k, v]` pairs (list/tuple) also
 *      destructures cleanly. Matches JS `for (const [k, v] of arrayOfPairs)`
 *      expressiveness — this is the divergence-1 fix from PR-3b audit.
 *    - `_kern_async_pairs(v)`: async generator. If `v` has `__aiter__` it
 *      forwards each item. Otherwise it falls back to `_kern_pairs(v)` so
 *      `async for` over a sync Mapping or array-of-pairs is well-defined —
 *      this is the divergence-2/3 fix (`async for` no longer requires an
 *      async iterable; sync data is wrapped at iteration entry).
 *
 *  Both helpers are pure functions on the input; no captures, no globals. */

/** KERN-canonical interpolation formatter for `fmt` / template literals.
 *  Python `f"{v}"` uses `str()`, which gives `True`/`False`/`None` — diverging
 *  from KERN's canonical lowercase `true`/`false`/`null` that TS template
 *  literals already produce (`${true}` → `"true"`, `${null}` → `"null"`). This
 *  helper closes that gap so the SAME KERN source yields byte-identical strings
 *  on both targets for the portable scalar domain (string / finite int / bool /
 *  null). The `isinstance(__k_v, bool)` check MUST precede any int handling:
 *  Python's `bool` subclasses `int`, so a plain int branch would misroute
 *  `True` → `"True"`. Co-located with the codegen so the production emitter and
 *  the differential harness use byte-identical defs; emitted at module scope
 *  via `BodyEmitResult.helpers` whenever an interpolation is wrapped. */

/** Emit the body of a native KERN handler as Python source. Returns the
 *  joined body text. Each top-level line is unindented; nested `if`-bodies
 *  carry one level of 4-space indent per level of nesting.
 *
 *  Legacy slice 1/2 signature — returns just the code string. Callers
 *  that also need the import set (slice 3b: `math` etc.) and/or want to
 *  pass a symbol map (slice 3a: `userId → user_id`) should use
 *  `emitNativeKernBodyPythonWithImports`.
 *
 *  Slice 3 review fix (OpenCode + Gemini): if the handler requires imports
 *  (e.g. `Number.floor` ⇒ `math`) and the legacy entry point is used,
 *  the imports would be silently discarded — the generated Python would
 *  reference `__k_math.floor(...)` without the matching `import math as
 *  __k_math`, producing a `NameError` at runtime. Throw instead so the
 *  caller upgrades to the WithImports variant rather than shipping
 *  broken code. */
export function emitNativeKernBodyPython(handlerNode: IRNode, options?: BodyEmitOptions): string {
  const result = emitNativeKernBodyPythonWithImports(handlerNode, options);
  if (result.imports.size > 0) {
    const list = [...result.imports].sort().join(', ');
    throw new Error(
      `emitNativeKernBodyPython: handler requires imports [${list}] which the legacy string-only API silently discards. ` +
        'Use emitNativeKernBodyPythonWithImports and emit the imports yourself (FastAPI generator does this automatically).',
    );
  }
  // PR-4 — when the body needs runtime helpers (e.g. `_kern_pairs`), prepend
  // them to the returned string. The legacy entry point has no separate
  // helpers channel; folding them inline keeps single-string consumers (PR-3b
  // differential harness) working without an API break.
  if (result.helpers.size > 0) {
    const helpers = [...result.helpers].join('\n\n');
    return result.code ? `${helpers}\n\n${result.code}` : helpers;
  }
  return result.code;
}

/** Slice 3e — context-aware variant returning `{ code, imports }`. The
 *  FastAPI generator uses this to inject `import math` (etc.) at the top
 *  of the function body and to pass the param-rename map (3a) so the body
 *  resolves correctly against the snake_cased Python signature.
 *
 *  Slice 4a review fix — also returns `usedPropagation` so the route
 *  emitter can conditionally add `from fastapi import HTTPException`
 *  when `propagateStyle: 'http-exception'` is in effect. */
export function emitNativeKernBodyPythonWithImports(handlerNode: IRNode, options?: BodyEmitOptions): BodyEmitResult {
  const ctx = freshCtx(options);
  // Push the param/outer-binding scope ABOVE the function-body scope so an
  // inner-block `let x` that shadows a param is detected by
  // `maybeRenameOnShadow` (nero red-team Challenge 2). `emitChildrenPy`
  // pushes its own scope on top; we pop ours after it returns.
  const outerBindings = options?.outerBindings ?? [];
  if (outerBindings.length > 0) {
    ctx.localScopes.push(new Map(outerBindings.map((n) => [n, 'const' as const])));
    // `null` is the existing "no active regex binding" sentinel — consumed
    // by `lookupRegexBinding` (returns null when the scope has the name but
    // no regex literal was assigned to it). Mirroring it here keeps regex
    // and local-binding scope stacks index-aligned.
    ctx.regexScopes.push(new Map(outerBindings.map((n) => [n, null])));
    ctx.renameStack.push(new Map());
  }
  try {
    const code = emitChildrenPy(handlerNode.children ?? [], ctx, '').join('\n');
    // Slices 0+1 — a hoisted closure def left un-flushed means some statement
    // emitter produced a block arrow without routing through emitChildrenPy's
    // flush point. That would silently drop the def → NameError at runtime.
    // Fail loud instead.
    if (ctx.pendingHoists.length > 0) {
      throw new Error(
        'Internal codegen error: block-arrow closure def(s) were not flushed (a statement emitter bypassed the emitChildrenPy hoist point).',
      );
    }
    return { code, imports: ctx.imports, usedPropagation: ctx.usedPropagation, helpers: ctx.helpers };
  } finally {
    if (outerBindings.length > 0) {
      ctx.localScopes.pop();
      ctx.regexScopes.pop();
      ctx.renameStack.pop();
    }
  }
}

/** Body-statement node types that map to a SINGLE emitted line and may carry
 *  an inline same-line trailing comment captured by the migrator into a
 *  `trailingComment=` prop. Mirrors the TS emitter's set. */
const TRAILING_COMMENT_TYPES = new Set([
  'let',
  'expression-v1',
  'assign',
  'fmt',
  'clamp',
  'firstTruthy',
  'coalesce',
  'firstDefined',
  'objectMerge',
  'objectOmit',
  'objectPick',
  'return',
  'throw',
  'do',
  'continue',
  'break',
]);

/** Convert a captured TS-form trailing comment (a line `// note` or a block
 *  comment) to an idiomatic Python inline comment (`# note`). Mirrors
 *  emitCommentPy. */
function trailingCommentToPy(raw: string): string {
  if (raw.startsWith('//')) return `# ${raw.slice(2).trim()}`.trimEnd();
  if (raw.startsWith('/*') && raw.endsWith('*/')) return `# ${raw.slice(2, -2).trim()}`.trimEnd();
  return `# ${raw}`.trimEnd();
}

/** Slice-2 fix — map each bare-identifier write target inside a loop body to the
 *  LAST top-level child index whose subtree writes it. Recurses into nested
 *  statements (if/else branches, nested loops, try bodies) but attributes every
 *  write to the TOP-LEVEL child containing it (the granularity
 *  `loopLaterAssignFrames.current` tracks). Member/index targets (`this.x`,
 *  `a[i]`) are excluded — mutating a captured OBJECT is by-reference in both
 *  languages and never pinned.
 *
 *  Covered write node types (the body-statement emitters that can rebind a bare
 *  name): `assign` (its `target=` prop, INCLUDING the compound `op="+="`/`-=`/…
 *  and postfix `op="++"`/`--` forms — all the same node type, distinguished only
 *  by `op=`, all rebinding `target=`) and `set` (its `name=` prop, a bare-name
 *  cell write). `let`/`cell` are DECLARATIONS, not reassignments, so they are
 *  not scanned (the binding they create is the thing being pinned). */
function collectLoopAssignLastIndexes(children: IRNode[]): Map<string, number> {
  const last = new Map<string, number>();
  const scan = (node: IRNode, topIdx: number): void => {
    if (node.type === 'assign') {
      // `target=` is the bare name (or member/index) being rebound, regardless of
      // `op=` (plain `=`, compound `+=`, or postfix `++`/`--`).
      const target = String((node.props as Record<string, unknown> | undefined)?.target ?? '');
      if (target && !target.includes('.') && !target.includes('[')) last.set(target, topIdx);
    } else if (node.type === 'set') {
      // `set name=… to=…` rebinds a bare-name cell; the target is `name=`.
      const target = String((node.props as Record<string, unknown> | undefined)?.name ?? '');
      if (target && !target.includes('.') && !target.includes('[')) last.set(target, topIdx);
    }
    for (const child of node.children ?? []) scan(child, topIdx);
  };
  for (let i = 0; i < children.length; i++) scan(children[i], i);
  return last;
}

function emitChildrenPy(
  children: IRNode[],
  ctx: BodyEmitContext,
  indent: string,
  initialBindings: Array<[string, 'const' | 'let']> = [],
  isLoopBody = false,
): string[] {
  const lines: string[] = [];
  ctx.localScopes.push(new Map(initialBindings));
  ctx.regexScopes.push(new Map(initialBindings.map(([name]) => [name, null])));
  ctx.renameStack.push(new Map());
  // Slice-2 loop-variable pinning. When this recursion is a loop BODY, record
  // the just-pushed scope's index so `emitBlockClosurePy` can decide whether a
  // captured name resolves at-or-inside the enclosing loop body (→ pin). Only
  // loop bodies mark a scope here — if/else/try/branch/with bodies do not, so a
  // closure inside an `if` that is itself inside a loop still pins via the
  // outer loop's recorded index (the `if` body's own scope index is >= it).
  if (isLoopBody) ctx.loopScopeIndexes.push(ctx.localScopes.length - 1);
  // Slice-2 fix — pre-scan this loop body for bare-name assign targets so the
  // closure emitter can reject a pin whose binding is reassigned AFTER the
  // closure-creating statement (see loopLaterAssignFrames doc).
  const loopFrame = isLoopBody ? { assignLast: collectLoopAssignLastIndexes(children), current: -1 } : null;
  if (loopFrame) ctx.loopLaterAssignFrames.push(loopFrame);
  // Slices 0+1 fix (agon review, claude 0.7) — isolate the hoist buffer per
  // recursion level. A statement emitter that lowers a HEADER expression (an
  // `if`/`while` condition, an `each`/`for` iterable, a `branch` scrutinee)
  // pushes that expression's closure defs into the buffer BEFORE recursing
  // into its body via this function. Without isolation, the body-level
  // per-child flush below would steal those defs and splice them INSIDE the
  // body — after the header line already referenced the def name (runtime
  // NameError: `if __kern_closure_0(2):` with the def indented under it).
  // Saving/clearing here means a header def survives untouched until the
  // PARENT level's per-child flush, which splices it before the entire
  // statement — defs bind once, so before-the-header placement is correct for
  // every header position including `elif` chains (the def simply precedes
  // the whole if/elif chain).
  const outerHoists = ctx.pendingHoists;
  ctx.pendingHoists = [];
  try {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (loopFrame) loopFrame.current = i;
      let trailStart = lines.length;
      if (child.type === 'comment') {
        for (const line of emitCommentPy(child)) lines.push(`${indent}${line}`);
      } else if (child.type === 'cell') {
        for (const line of emitCellPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'set') {
        for (const line of emitSetPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'let') {
        for (const line of emitLetPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'expression-v1') {
        for (const line of emitExpressionV1Py(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'fn') {
        for (const line of emitFnPy(child, ctx, indent)) lines.push(line);
      } else if (child.type === 'assign') {
        for (const line of emitAssignPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'destructure') {
        for (const line of emitDestructurePy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'fmt') {
        for (const line of emitFmtPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'clamp') {
        for (const line of emitClampPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'firstTruthy') {
        for (const line of emitFirstTruthyPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'coalesce' || child.type === 'firstDefined') {
        for (const line of emitCoalescePy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'objectMerge') {
        for (const line of emitObjectMergePy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'objectOmit') {
        for (const line of emitObjectOmitPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'objectPick') {
        for (const line of emitObjectPickPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'return') {
        for (const line of emitReturnPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'if') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpr(condRaw);
        // Slice-2 review fix: reject propagation `?` in `if cond=` (parallel to TS side).
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        // Slice S4 — `if cond=` consumes KERN ToBoolean, not Python bare
        // truthiness, so `if []:`/`if {}:` are truthy and `if NaN:` is falsy.
        // Wrap UNCONDITIONALLY (no "looks boolean" skip-analysis in v1).
        ctx.helpers.add(KERN_JS_HELPER_PY);
        lines.push(`${indent}if _kern_truthy(${emitPyExprCtx(condIR, ctx)}):`);
        const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP);
        if (inner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
        for (const sl of inner) lines.push(sl);
        // Walk the `else` chain. Recognised shapes for `else`:
        //   1. else > [if, else_inner]  → emit `elif`, recurse on else_inner
        //   2. else > [if]              → terminal `elif` with no else
        //   3. else > anything else     → plain `else:`, chain ends
        // Mirrors the TS emitter's `else if` collapsing so byte-equivalent
        // raw-body `else if` chains round-trip cleanly through slice 5b.
        let elseCandidate: IRNode | undefined = children[i + 1];
        if (elseCandidate?.type === 'else') i++;
        while (elseCandidate && elseCandidate.type === 'else') {
          const ec: IRNode[] = elseCandidate.children ?? [];
          const isChainable =
            ec.length >= 1 && ec[0].type === 'if' && (ec.length === 1 || (ec.length === 2 && ec[1].type === 'else'));
          if (isChainable) {
            const ifNode = ec[0];
            const nestedCondRaw = String(ifNode.props?.cond ?? '');
            const nestedCondIR = parseExpr(nestedCondRaw);
            if (nestedCondIR.kind === 'propagate') {
              throw new Error(
                "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
              );
            }
            // Slice S4 — `else if` chains consume KERN ToBoolean too.
            ctx.helpers.add(KERN_JS_HELPER_PY);
            lines.push(`${indent}elif _kern_truthy(${emitPyExprCtx(nestedCondIR, ctx)}):`);
            const ifInner = emitChildrenPy(ifNode.children ?? [], ctx, indent + INDENT_STEP);
            if (ifInner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
            for (const sl of ifInner) lines.push(sl);
            elseCandidate = ec.length === 2 ? ec[1] : undefined;
          } else {
            lines.push(`${indent}else:`);
            const elseInner = emitChildrenPy(ec, ctx, indent + INDENT_STEP);
            if (elseInner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
            for (const el of elseInner) lines.push(el);
            break;
          }
        }
      } else if (child.type === 'else') {
        // Slice-2 review fix: orphan `else` is a structural error (matches TS side).
        throw new Error('`else` must immediately follow an `if` sibling. Found orphan `else` in handler body.');
      } else if (child.type === 'while') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpr(condRaw);
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `while cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}while ${emitPyExprCtx(condIR, ctx)}:`);
        // Slice-2: a `while` body is a loop body — per-iteration locals declared
        // INSIDE it (JS re-binds block-scoped lets each iteration) must pin.
        // The condition var, declared OUTSIDE, resolves below the loop scope and
        // stays late-bound (by-reference, JS-parity-correct).
        const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, [], true);
        if (inner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
        for (const sl of inner) lines.push(sl);
      } else if (child.type === 'for') {
        for (const line of emitRangeForPy(child, ctx, indent)) lines.push(line);
      } else if (child.type === 'with') {
        for (const line of emitWithPy(child, ctx, indent)) lines.push(line);
      } else if (child.type === 'try') {
        // Slice 4c — try/except control flow.
        //
        // Slice 5a deferred-fix (Codex P2-2): mirror the TS-side change to
        // read `catch` as a CHILD of `try`, matching the schema's
        // `try.allowedChildren = ['step', 'handler', 'catch']`. The previous
        // sibling-shape body-emit was unreachable for schema-validated source
        // (the validator rejected it first) and miscompiled when invoked
        // directly with hand-built IR.
        const tryChildren = child.children ?? [];
        const catchChildren = tryChildren.filter((c) => c.type === 'catch');
        const finallyChildren = tryChildren.filter((c) => c.type === 'finally');
        if (catchChildren.length > 1) {
          throw new Error('`try` supports at most one `catch` child — found multiple in handler body.');
        }
        if (finallyChildren.length > 1) {
          throw new Error('`try` supports at most one `finally` child — found multiple in handler body.');
        }
        if (finallyChildren.length > 0 && typeof child.props?.name === 'string' && child.props.name.length > 0) {
          throw new Error(
            '`finally` is only supported on body-statement `try` (inside `handler lang="kern"`). Found `finally` under async-orchestration `try name=…` — move cleanup into the surrounding handler.',
          );
        }
        const catchNode = catchChildren[0] ?? null;
        const finallyNode = finallyChildren[0] ?? null;
        if (catchNode === null && finallyNode === null) {
          throw new Error('`try` must contain a `catch` or `finally` child. Found orphan `try` in handler body.');
        }
        const tryBlockChildren = tryChildren.filter((c) => c.type !== 'catch' && c.type !== 'finally');
        // Slice 5a deferred-fix (Codex): see body-ts.ts for the rationale —
        // `step` / `handler` are valid only inside an async-orchestration
        // `try name=…` block, not inside body-statement try/catch.
        const orchestrationChild = tryBlockChildren.find((c) => c.type === 'step' || c.type === 'handler');
        if (orchestrationChild) {
          throw new Error(
            `\`${orchestrationChild.type}\` is only valid inside an async-orchestration \`try name=…\` block, not inside a body-statement \`try\`. Move the steps into the surrounding fn or use a structured orchestration block.`,
          );
        }
        lines.push(`${indent}try:`);
        ctx.tryDepth++;
        const inner = emitChildrenPy(tryBlockChildren, ctx, indent + INDENT_STEP);
        ctx.tryDepth--;
        if (inner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
        for (const sl of inner) lines.push(sl);
        if (catchNode !== null) {
          const errName = String(catchNode.props?.name ?? 'e');
          lines.push(`${indent}except Exception as ${errName}:`);
          const catchInner = emitChildrenPy(catchNode.children ?? [], ctx, indent + INDENT_STEP);
          if (catchInner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
          for (const cl of catchInner) lines.push(cl);
        }
        if (finallyNode !== null) {
          lines.push(`${indent}finally:`);
          ctx.finallyDepth++;
          const finallyInner = emitChildrenPy(finallyNode.children ?? [], ctx, indent + INDENT_STEP);
          ctx.finallyDepth--;
          if (finallyInner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
          for (const fl of finallyInner) lines.push(fl);
        }
      } else if (child.type === 'catch') {
        throw new Error('`catch` must be a child of `try`. Found top-level `catch` in handler body.');
      } else if (child.type === 'finally') {
        throw new Error('`finally` must be a child of `try`. Found top-level `finally` in handler body.');
      } else if (child.type === 'throw') {
        for (const line of emitThrowPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'do') {
        for (const line of emitDoPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'continue') {
        lines.push(`${indent}continue`);
      } else if (child.type === 'break') {
        lines.push(`${indent}break`);
      } else if (child.type === 'each') {
        // Slice 4d — each loop.
        // Slice 4c+4d review fix (Codex P1) — read schema-compliant
        // `name`/`in` props (legacy `list`/`as` accepted as fallback).
        const listRaw = String(child.props?.in ?? child.props?.list ?? '[]');
        const listIR = parseExpr(listRaw);
        const pairKey = child.props?.pairKey;
        const pairValue = child.props?.pairValue;
        const entryKey = child.props?.entryKey;
        const entryValue = child.props?.entryValue;
        const isAwait = child.props?.await === true || child.props?.await === 'true';
        const entriesMode = child.props?.entries === true || child.props?.entries === 'true';
        if (isAwait && child.props?.index) {
          throw new Error('body-statement `each await=true` cannot be combined with `index=`.');
        }
        // PR-4 — pair-mode (`pairKey=k pairValue=v`) iterates via the runtime
        // helpers `_kern_pairs` (sync) and `_kern_async_pairs` (async). The
        // helpers normalize Mapping inputs (via `.items()`), array-of-pairs
        // (via `iter()`), and async iterables (forwarded as-is). Goals from
        // PR-3b audit:
        //   - sync pair-mode over list-of-[k,v] no longer raises AttributeError
        //   - async pair-mode over sync data no longer raises TypeError
        // The helpers are co-located in `KERN_PAIR_HELPERS_PY` so the
        // production emitter and the differential harness share one definition.
        if (pairKey && pairValue) {
          if (entriesMode && isAwait) {
            throw new Error('body-statement `each entries=true` cannot be combined with `await=true`.');
          }
          const k = String(pairKey);
          const v = String(pairValue);
          const sourceExpr = emitPyExprCtx(listIR, ctx);
          ctx.helpers.add(KERN_PAIR_HELPERS_PY);
          const iterableExpr = isAwait ? `_kern_async_pairs(${sourceExpr})` : `_kern_pairs(${sourceExpr})`;
          lines.push(`${indent}${isAwait ? 'async ' : ''}for ${k}, ${v} in ${iterableExpr}:`);
          if (ctx.traceHooks?.eachIterNext) {
            lines.push(
              `${indent}${INDENT_STEP}_kern_trace({"op": "iter-next", "binding": ${JSON.stringify(v)}, "value": ${v}})`,
            );
          }
          const inner = emitChildrenPy(
            child.children ?? [],
            ctx,
            indent + INDENT_STEP,
            [
              [k, 'const'],
              [v, 'const'],
            ],
            true,
          );
          if (inner.length === 0 && !ctx.traceHooks?.eachIterNext) lines.push(`${indent}${INDENT_STEP}pass`);
          for (const sl of inner) lines.push(sl);
          continue;
        }
        if (entryKey || entryValue) {
          if (entriesMode && isAwait) {
            throw new Error('body-statement `each entries=true` cannot be combined with `await=true`.');
          }
          if (!entriesMode) {
            throw new Error('body-statement `each entryKey=`/`entryValue=` requires `entries=true`.');
          }
          if (isAwait) {
            throw new Error('body-statement `each await=true` cannot be combined with `entryKey=`/`entryValue=`.');
          }
          if (entryKey && entryValue) {
            throw new Error('body-statement `each` cannot combine `entryKey=` and `entryValue=`.');
          }
          const sourceExpr = emitPyExprCtx(listIR, ctx);
          if (entryKey) {
            const k = String(entryKey);
            const iterableExpr = `${sourceExpr}.keys()`;
            lines.push(`${indent}for ${k} in ${iterableExpr}:`);
            if (ctx.traceHooks?.eachIterNext) {
              lines.push(
                `${indent}${INDENT_STEP}_kern_trace({"op": "iter-next", "binding": ${JSON.stringify(k)}, "value": ${k}})`,
              );
            }
            const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, [[k, 'const']], true);
            if (inner.length === 0 && !ctx.traceHooks?.eachIterNext) lines.push(`${indent}${INDENT_STEP}pass`);
            for (const sl of inner) lines.push(sl);
          } else {
            const v = String(entryValue);
            const iterableExpr = `${sourceExpr}.values()`;
            lines.push(`${indent}for ${v} in ${iterableExpr}:`);
            if (ctx.traceHooks?.eachIterNext) {
              lines.push(
                `${indent}${INDENT_STEP}_kern_trace({"op": "iter-next", "binding": ${JSON.stringify(v)}, "value": ${v}})`,
              );
            }
            const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, [[v, 'const']], true);
            if (inner.length === 0 && !ctx.traceHooks?.eachIterNext) lines.push(`${indent}${INDENT_STEP}pass`);
            for (const sl of inner) lines.push(sl);
          }
          continue;
        }
        // Slice 5a deferred-fix: TS `for (const item of xs)` is block-scoped
        // — `item` is undefined after the loop. Python `for item in xs:`
        // leaks: `item` keeps the last iteration value, and a prior outer
        // `item` would have been clobbered. We use a gensym for the
        // iteration variable and unpack into the user-friendly name on each
        // iteration. After the loop the gensym leaks (Python language
        // limitation), but the user-facing `asName` is no worse than before
        // and the inter-loop collision (two `each` with the same `as=`)
        // works because each loop has a fresh gensym + fresh body-local
        // alias. Document the residual leak in the spec.
        //
        // PR-3b — index-mode (`each name=x index=i in=xs`) now lowers to
        // `for i, x in enumerate(xs):`, aligning with the route-handler /
        // ground generators that already supported this shape. Caught by
        // the IR-semantics differential audit (PR-3b).
        const asName = String(child.props?.name ?? child.props?.as ?? 'item');
        const idxName = child.props?.index !== undefined ? String(child.props.index) : null;
        const iterableExpr = emitPyExprCtx(listIR, ctx);
        let primaryBindingPy: string;
        let initialBindings: Array<[string, 'const' | 'let']>;
        if (idxName !== null) {
          // `for i, x in enumerate(xs):` — direct destructuring, no gensym
          // unpacking needed because both names are already user-facing.
          lines.push(`${indent}for ${idxName}, ${asName} in enumerate(${iterableExpr}):`);
          primaryBindingPy = asName;
          initialBindings = [
            [idxName, 'const'],
            [asName, 'const'],
          ];
        } else {
          const iterVar = `__k_each_${++ctx.gensymCounter}`;
          lines.push(`${indent}${isAwait ? 'async ' : ''}for ${iterVar} in ${iterableExpr}:`);
          lines.push(`${indent}${INDENT_STEP}${asName} = ${iterVar}`);
          primaryBindingPy = asName;
          initialBindings = [[asName, 'const']];
        }
        if (ctx.traceHooks?.eachIterNext) {
          lines.push(
            `${indent}${INDENT_STEP}_kern_trace({"op": "iter-next", "binding": ${JSON.stringify(primaryBindingPy)}, "value": ${primaryBindingPy}})`,
          );
        }
        const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, initialBindings, true);
        // `pass` is needed only when the for-loop body would otherwise be empty:
        //   - index-mode path emits NO assignment (direct destructuring), so an
        //     empty children list leaves the loop bodyless → IndentationError.
        //     Caught by PR-3b agon review (4/6 reviewers).
        //   - non-index path emits `${asName} = ${iterVar}` which IS a valid
        //     body statement, so `pass` is unnecessary even with empty children.
        //   - trace-hook path emits `_kern_trace(...)` as the body, so no pass.
        if (inner.length === 0 && idxName !== null && !ctx.traceHooks?.eachIterNext) {
          lines.push(`${indent}${INDENT_STEP}pass`);
        }
        for (const sl of inner) lines.push(sl);
      } else if (child.type === 'branch') {
        // 2026-05-06 — body-statement `branch` lowers to a Python
        // `if/elif/else` chain (PEP-634 `match` is deferred). Distinct from
        // any top-level branch codegen — none currently exists on the
        // fastapi target. We gensym the `on=` expression once so it's not
        // double-evaluated across cases.
        for (const line of emitBranchPy(child, ctx, indent)) lines.push(line);
      }

      // Slices 0+1 — flush hoisted block-arrow closure defs. `emitLambdaPy`
      // pushed each `def __kern_closure_N(...):` block into `ctx.pendingHoists`
      // when it lowered a block arrow used by THIS child. Splice them in at the
      // current indent IMMEDIATELY BEFORE the child's own lines so the def
      // precedes its use — works at any nesting level because every nested
      // emission funnels through emitChildrenPy. Bump `trailStart` past the
      // spliced defs so the trailing-comment check below still measures only
      // the child's own line count.
      if (ctx.pendingHoists.length > 0) {
        const hoistLines: string[] = [];
        for (const def of ctx.pendingHoists) {
          for (const dl of def) hoistLines.push(`${indent}${dl}`);
        }
        lines.splice(trailStart, 0, ...hoistLines);
        trailStart += hoistLines.length;
        ctx.pendingHoists = [];
      }

      // W1 — re-attach an inline same-line trailing comment (captured by the
      // migrator as `trailingComment=`) to the simple statement's last line,
      // converted to a Python `#` comment.
      const trailingComment = child.props?.trailingComment;
      if (
        typeof trailingComment === 'string' &&
        trailingComment !== '' &&
        lines.length === trailStart + 1 && // exactly one line emitted (a true single-line stmt)
        TRAILING_COMMENT_TYPES.has(child.type)
      ) {
        lines[lines.length - 1] += `  ${trailingCommentToPy(trailingComment)}`;
      }
    }
  } finally {
    if (isLoopBody) ctx.loopScopeIndexes.pop();
    if (loopFrame) ctx.loopLaterAssignFrames.pop();
    ctx.localScopes.pop();
    ctx.regexScopes.pop();
    ctx.renameStack.pop();
    // Restore the parent level's hoist buffer (see the isolation comment at
    // entry). Any defs THIS level's last child left behind are appended so the
    // parent's flush (or the defensive end-of-body throw) still sees them —
    // hoists are never silently dropped.
    ctx.pendingHoists = outerHoists.concat(ctx.pendingHoists);
  }
  return lines;
}

/** Returns the rename for `name` from the innermost scope that has one, else
 * `name` itself. Consulted in ident emission and at `let`/`assign` LHS
 * rendering so a shadowed inner `let x` (emitted as `__k_shadow_x_N`) and
 * its references inside the block resolve consistently, while outer
 * references after the block still see the user-facing name. */
function resolveLocalRename(ctx: BodyEmitContext, name: string): string {
  for (let i = ctx.renameStack.length - 1; i >= 0; i--) {
    const scope = ctx.renameStack[i];
    const renamed = scope.get(name);
    if (renamed !== undefined) return renamed;
  }
  return name;
}

/** Returns the renamed name if `let name=` here would shadow a binding in
 * any OUTER scope; otherwise returns `name` unchanged. Used by `emitLetPy`
 * to give an inner-block shadow a unique Python name + record the rename
 * in the current scope so within-block references resolve to it. Returns
 * `name` for function-body lets (no outer scope to shadow) and for
 * non-shadowing inner lets (so unrelated locals stay user-friendly). */
function maybeRenameOnShadow(ctx: BodyEmitContext, name: string): string {
  // Only the inner-most CURRENT scope is the "newcomer"; check OUTER scopes.
  if (ctx.localScopes.length < 2) return name;
  for (let i = ctx.localScopes.length - 2; i >= 0; i--) {
    if (ctx.localScopes[i].has(name)) {
      const renamed = `__k_shadow_${name}_${++ctx.gensymCounter}`;
      ctx.renameStack.at(-1)?.set(name, renamed);
      return renamed;
    }
  }
  return name;
}

function emitRangeForPy(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `for` requires `name=`.');
  validateRangeLoopIdentifier(name);
  const rawFrom = props.from;
  const rawTo = props.to;
  const rawStep = props.step === undefined || props.step === '' ? '1' : String(props.step);
  if (rawFrom === undefined || rawFrom === '') throw new Error('body-statement `for` requires `from=`.');
  if (rawTo === undefined || rawTo === '') throw new Error('body-statement `for` requires `to=`.');
  validateIntegerRangeBound(String(rawFrom), 'from');
  validateIntegerRangeBound(String(rawTo), 'to');
  validatePositiveRangeStep(rawStep);
  const fromIR = parseExpr(String(rawFrom));
  const toIR = parseExpr(String(rawTo));
  const stepIR = parseExpr(rawStep);
  if (fromIR.kind === 'propagate' || toIR.kind === 'propagate' || stepIR.kind === 'propagate') {
    throw new Error(
      "Propagation '?' is not allowed in `for from=`/`to=`/`step=` — bind the value to a `let` before the loop.",
    );
  }
  const fromExpr = emitPyExprCtx(fromIR, ctx);
  const toExpr = emitPyExprCtx(toIR, ctx);
  const stepExpr = emitPyExprCtx(stepIR, ctx);
  const rangeArgs = isRangeStepOne(rawStep) ? `${fromExpr}, ${toExpr}` : `${fromExpr}, ${toExpr}, ${stepExpr}`;
  const scopeId = ++ctx.gensymCounter;
  const missingVar = `__k_for_missing_${scopeId}`;
  const prevVar = `__k_for_prev_${scopeId}`;
  const tryIndent = indent + INDENT_STEP;
  const bodyIndent = tryIndent + INDENT_STEP;
  const out = [
    `${indent}${missingVar} = object()`,
    `${indent}${prevVar} = locals().get(${JSON.stringify(name)}, ${missingVar})`,
    `${indent}try:`,
    `${tryIndent}for ${name} in range(${rangeArgs}):`,
  ];
  if (ctx.traceHooks?.forIterNext) {
    out.push(`${bodyIndent}_kern_trace({"op": "iter-next", "binding": ${JSON.stringify(name)}, "value": ${name}})`);
  }
  const inner = emitChildrenPy(node.children ?? [], ctx, bodyIndent, [[name, 'const']], true);
  if (inner.length === 0 && !ctx.traceHooks?.forIterNext) out.push(`${bodyIndent}pass`);
  for (const sl of inner) out.push(sl);
  out.push(`${indent}finally:`);
  out.push(`${tryIndent}if ${prevVar} is ${missingVar}:`);
  out.push(`${bodyIndent}try:`);
  out.push(`${bodyIndent}${INDENT_STEP}del ${name}`);
  out.push(`${bodyIndent}except NameError:`);
  out.push(`${bodyIndent}${INDENT_STEP}pass`);
  out.push(`${tryIndent}else:`);
  out.push(`${bodyIndent}${name} = ${prevVar}`);
  return out;
}

function emitWithPy(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawName = props.name;
  const rawValue = props.value;
  const rawCleanup = props.cleanup;
  if (rawName === undefined || rawName === '') throw new Error('body-statement `with` requires `name=`.');
  if (rawValue === undefined || rawValue === '') throw new Error('body-statement `with` requires `value=`.');

  const protocol = props.protocol === undefined || props.protocol === '' ? '' : String(props.protocol);
  if (protocol !== '' && protocol !== 'with') {
    throw new Error('body-statement `with protocol=` supports only `with`.');
  }
  const isAsync = props.async === true || props.async === 'true';
  if (protocol === 'with' && isAsync) {
    throw new Error(
      'body-statement `with async=true protocol=with` is not supported yet — use default protocol (try/finally) for async cleanup.',
    );
  }
  const hasCleanup = rawCleanup !== undefined && rawCleanup !== null && String(rawCleanup) !== '';
  if (protocol === 'with' && hasCleanup) {
    throw new Error(
      "body-statement `with protocol=with` delegates cleanup to the context manager's __exit__ — drop cleanup= or drop protocol=with.",
    );
  }
  if (protocol !== 'with' && !hasCleanup) {
    throw new Error('body-statement `with` requires `cleanup=` (or set `protocol=with` to use __exit__).');
  }

  const name = String(rawName);
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in `with value=` — bind to `let` first.");
  }

  declareLocalBinding(ctx, name, 'const');

  if (protocol === 'with') {
    const lines = [`${indent}with ${emitPyExprCtx(valueIR, ctx)} as ${name}:`];
    const inner = emitChildrenPy(node.children ?? [], ctx, indent + INDENT_STEP, [[name, 'const']]);
    if (inner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
    for (const line of inner) lines.push(line);
    return lines;
  }

  const cleanupIR = parseExpr(String(rawCleanup));
  if (cleanupIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in `with cleanup=` — bind to `let` first.");
  }
  const awaitPrefix = isAsync ? 'await ' : '';
  const out = [`${indent}${name} = ${awaitPrefix}${emitPyExprCtx(valueIR, ctx)}`, `${indent}try:`];
  const inner = emitChildrenPy(node.children ?? [], ctx, indent + INDENT_STEP, [[name, 'const']]);
  if (inner.length === 0) out.push(`${indent}${INDENT_STEP}pass`);
  for (const line of inner) out.push(line);
  out.push(`${indent}finally:`);
  out.push(`${indent}${INDENT_STEP}${awaitPrefix}${emitPyExprCtx(cleanupIR, ctx)}`);
  return out;
}

function validatePositiveRangeStep(rawStep: string): void {
  parseRangeStepLiteral(rawStep);
}

function parseRangeStepLiteral(rawStep: string): number {
  const trimmed = rawStep.trim();
  const numeric = Number(trimmed);
  if (!/^[+-]?[0-9]+$/.test(trimmed) || !Number.isSafeInteger(numeric) || numeric === 0) {
    throw new Error(
      'body-statement `for step=` must be a non-zero integer literal in this cross-target range-loop slice.',
    );
  }
  return numeric;
}

function validateIntegerRangeBound(rawBound: string, propName: 'from' | 'to'): void {
  const trimmed = rawBound.trim();
  const numeric = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(numeric) && !Number.isInteger(numeric)) {
    throw new Error(`body-statement \`for ${propName}=\` must be an integer expression.`);
  }
}

function isRangeStepOne(rawStep: string): boolean {
  const numeric = Number(rawStep.trim());
  return /^[+-]?[0-9]+$/.test(rawStep.trim()) && Number.isSafeInteger(numeric) && numeric === 1;
}

function validateRangeLoopIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('body-statement `for name=` must be a cross-target identifier.');
  }
}

function emitBranchPy(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
  const onRaw = String(node.props?.on ?? '');
  if (onRaw === '') {
    throw new Error('`branch` requires an `on=` expression in body-statement context.');
  }
  const onIR = parseExpr(onRaw);
  const subjectVar = `__k_branch_${++ctx.gensymCounter}`;
  const out: string[] = [];
  out.push(`${indent}${subjectVar} = ${emitPyExprCtx(onIR, ctx)}`);
  const paths = (node.children ?? []).filter((c) => c.type === 'path');
  // Order matters: every non-default `path` becomes `if`/`elif`; the (at
  // most one) `default` becomes the trailing `else:`. We track whether we
  // already emitted the leading `if` so subsequent paths use `elif`.
  let firstEmitted = false;
  let defaultPath: IRNode | undefined;
  for (const p of paths) {
    if (p.props?.default === true || p.props?.default === 'true') {
      defaultPath = p;
      continue;
    }
    const rawValue = p.props?.value;
    const valueText = rawValue === undefined ? '' : String(rawValue);
    const isIdentifier = !p.__quotedProps?.includes('value');
    // Identifier values pass through verbatim (e.g. `Status.Active`).
    // Quoted strings emit JSON-encoded Python string literals — JSON's
    // ASCII-quoted output is a valid Python str literal subset, so this
    // is correct for both the printable-ASCII and unicode-escaped cases.
    const lit = isIdentifier ? valueText : JSON.stringify(valueText);
    const keyword = firstEmitted ? 'elif' : 'if';
    out.push(`${indent}${keyword} ${subjectVar} == ${lit}:`);
    const inner = emitChildrenPy(p.children ?? [], ctx, indent + INDENT_STEP);
    if (inner.length === 0) out.push(`${indent}${INDENT_STEP}pass`);
    for (const sl of inner) out.push(sl);
    firstEmitted = true;
  }
  if (defaultPath) {
    if (!firstEmitted) {
      // No regular paths — emit the default body unconditionally. Avoid an
      // `else:` with no preceding `if`, which is a Python syntax error.
      const inner = emitChildrenPy(defaultPath.children ?? [], ctx, indent);
      if (inner.length === 0) out.push(`${indent}pass`);
      for (const sl of inner) out.push(sl);
    } else {
      out.push(`${indent}else:`);
      const inner = emitChildrenPy(defaultPath.children ?? [], ctx, indent + INDENT_STEP);
      if (inner.length === 0) out.push(`${indent}${INDENT_STEP}pass`);
      for (const sl of inner) out.push(sl);
    }
  }
  return out;
}

/** Slice 4c review fix (OpenCode + Gemini critical) — propagation `?`
 *  inside `try` has no clean lowering on either propagateStyle: the
 *  'value' style emits `return tmp` (exits the function bypassing
 *  except), and the 'http-exception' style emits `raise HTTPException`
 *  (caught by the bare `except Exception` we generate, swallowing the
 *  err). Reject at codegen with a let-bind hint. Propagation inside
 *  `finally` gets a sharper diagnostic because it would override pending
 *  control flow from the protected block. */
function rejectPropagationInsideTry(ctx: BodyEmitContext): void {
  if (ctx.tryDepth > 0) {
    throw new Error(
      "Propagation '?' is not allowed inside a `try` block — `return`/`raise` from the err branch interacts incorrectly with the enclosing `except` clause. " +
        'Bind the call to a `let` outside the try, then use `if x.kind == "err" then throw ...` inside the try, OR use raw `lang=ts`/`lang=python` for the affected handler.',
    );
  }
  if (ctx.finallyDepth > 0) {
    throw new Error(
      "Propagation '?' is not allowed inside a `finally` block — `return`/`raise` from the err branch overrides the pending exception/return from the protected block. " +
        'Bind the call to a `let` outside the `try` if you need conditional fallthrough, OR use raw `lang=ts`/`lang=python` for the affected handler.',
    );
  }
}

function errPropagationLine(tmp: string, ctx: BodyEmitContext): string {
  // Slice 4a review fix (Gemini #5) — when the route emitter requests
  // 'http-exception' propagation style, the err branch raises rather than
  // returns. Without this, FastAPI serializes the err Result as a 200 OK
  // response with `{kind: 'err', error: ...}` body, which silently masks
  // application errors as successful responses.
  if (ctx.propagateStyle === 'http-exception') {
    return `    raise HTTPException(status_code=500, detail=${tmp}.error)`;
  }
  return `    return ${tmp}`;
}

function emitCellPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawName = props.name;
  if (rawName === undefined || rawName === '') {
    throw new Error('body-statement `cell` requires `name=`.');
  }
  const name = String(rawName);
  declareLocalBinding(ctx, name, 'cell');
  const pythonName = ctx.symbolMap[name] ?? name;
  const rawInitial = props.initial;
  // FastAPI request handlers don't need reactivity — each request resets
  // state. Cell lowers to plain mutable assignment, indistinguishable from
  // `let kind=let` at runtime; the distinction is for cross-target semantic
  // intent (TS+React emits `useState`). Future Python targets (Plotly Dash,
  // Streamlit) can specialize the lowering without changing author code.
  if (rawInitial === undefined || rawInitial === '') {
    return [`${pythonName} = None`];
  }
  const initialIR = parseExpr(String(rawInitial));
  return [`${pythonName} = ${emitPyExprCtx(initialIR, ctx)}`];
}

function emitSetPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawName = props.name;
  if (rawName === undefined || rawName === '') {
    throw new Error('body-statement `set` requires `name=`.');
  }
  const rawTo = props.to;
  if (rawTo === undefined || rawTo === '') {
    throw new Error('body-statement `set` requires `to=`.');
  }
  const name = String(rawName);
  const pythonName = ctx.symbolMap[name] ?? name;
  const valueIR = parseExpr(String(rawTo));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`set to=\` — bind to \`let\` first, then call set.`,
    );
  }
  return [`${pythonName} = ${emitPyExprCtx(valueIR, ctx)}`];
}

function emitLetPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '_');
  validateBodyLetKind(props.kind);
  declareLocalBinding(ctx, userName, props.kind === 'let' ? 'let' : 'const');
  // Block-scope fix: an inner `let` that shadows an outer binding gets a
  // gensym'd Python name so TS `let x=1; if(c){let x=2}; return x` (returns 1)
  // doesn't degrade to Python's flat scoping (would return 2). The rename is
  // stored in the current scope's renameStack and resolved by every ident
  // emission inside this block; outer references after the block see the
  // user-facing name (no entry in any in-scope rename map).
  const name = maybeRenameOnShadow(ctx, userName);
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`${name} = None`];
  }
  const valueIR = parseExpr(String(rawValue));
  setRegexBinding(ctx, userName, valueIR.kind === 'regexLit' ? valueIR : null);
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    ctx.usedPropagation = true;
    const lines = [
      `${tmp} = ${inner}`,
      `if ${tmp}.kind == 'err':`,
      errPropagationLine(tmp, ctx),
      `${name} = ${tmp}.value`,
    ];
    if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
    return lines;
  }
  const lines = [`${name} = ${emitPyExprCtx(valueIR, ctx)}`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function unwrapBodyExpr(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && (value as ExprObject).__expr) return (value as ExprObject).code;
  return String(value);
}

function splitBodyExpressionList(raw: string, propName: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && i + 1 < raw.length) current += raw[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (depth < 0) throw new Error(`${propName} has unbalanced delimiters.`);
    if (ch === ',' && depth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error(`${propName} contains an empty expression.`);
      out.push(part);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0) throw new Error(`${propName} has unbalanced delimiters.`);
  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

function emitClampPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `clamp` requires `name=`.');
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const rawValue = unwrapBodyExpr(props.value);
  if (rawValue === undefined || rawValue === '') throw new Error('body-statement `clamp` requires `value=`.');
  const rawMin = unwrapBodyExpr(props.min);
  if (rawMin === undefined || rawMin === '') throw new Error('body-statement `clamp` requires `min=`.');
  const rawMax = unwrapBodyExpr(props.max);
  if (rawMax === undefined || rawMax === '') throw new Error('body-statement `clamp` requires `max=`.');

  const valueIR = parseExpr(rawValue);
  const minIR = parseExpr(rawMin);
  const maxIR = parseExpr(rawMax);
  if (valueIR.kind === 'propagate' || minIR.kind === 'propagate' || maxIR.kind === 'propagate') {
    throw new Error(
      "Propagation '?' is not allowed in `clamp value=`/`min=`/`max=` — bind the value to a `let` first.",
    );
  }

  const lines = [
    `${name} = max(${emitPyExprCtx(minIR, ctx)}, min(${emitPyExprCtx(maxIR, ctx)}, ${emitPyExprCtx(valueIR, ctx)}))`,
  ];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function emitFirstTruthyPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `firstTruthy` requires `name=`.');
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const rawValues = unwrapBodyExpr(props.values);
  if (rawValues === undefined || rawValues === '') {
    throw new Error('body-statement `firstTruthy` requires `values=`.');
  }
  const values = splitBodyExpressionList(rawValues, 'firstTruthy values=');
  if (values.length < 2) throw new Error('body-statement `firstTruthy` requires at least two value expressions.');

  const emitted = values.map((value) => {
    const valueIR = parseExpr(value);
    if (valueIR.kind === 'propagate') {
      throw new Error("Propagation '?' is not allowed in `firstTruthy values=` — bind the value to a `let` first.");
    }
    return emitFirstTruthyOperandPy(valueIR, ctx);
  });

  // Slice S4 — `firstTruthy` selects the first KERN-truthy candidate, NOT the
  // first Python-truthy one. Bare `a or b` skips `[]`/`{}` (Python-falsy but
  // JS-truthy) and keeps NaN (Python-truthy but JS-falsy), so it diverges. Lower
  // to a `_kern_truthy`-gated walrus chain that evaluates each candidate AT MOST
  // ONCE and only if every earlier candidate was falsy (left-to-right laziness):
  //   (t1 if _kern_truthy(t1 := a) else (t2 if _kern_truthy(t2 := b) else c))
  // The final candidate needs no temp/guard — it is the fallthrough value.
  ctx.helpers.add(KERN_JS_HELPER_PY);
  const lines = [`${name} = ${buildFirstTruthyChainPy(emitted, ctx)}`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

/** Build the `_kern_truthy`-gated, single-evaluation, lazy walrus chain for a
 *  `firstTruthy` candidate list. The last candidate is the fallthrough (no
 *  guard); every earlier candidate is bound once via `:=` and tested with
 *  `_kern_truthy`. `gensymCounter`-seeded temp names avoid colliding with user
 *  bindings or each other. */
function buildFirstTruthyChainPy(candidates: string[], ctx: BodyEmitContext): string {
  const last = candidates[candidates.length - 1];
  let chain = last;
  for (let i = candidates.length - 2; i >= 0; i--) {
    const tmp = `__k_ft${++ctx.gensymCounter}`;
    chain = `(${tmp} if _kern_truthy(${tmp} := ${candidates[i]}) else ${chain})`;
  }
  return chain;
}

function emitCoalescePy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  const type = node.type;
  if (!userName) throw new Error(`body-statement \`${type}\` requires \`name=\`.`);
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const rawValues = unwrapBodyExpr(props.values);
  if (rawValues === undefined || rawValues === '') {
    throw new Error(`body-statement \`${type}\` requires \`values=\`.`);
  }
  const values = splitBodyExpressionList(rawValues, `${type} values=`);
  if (values.length < 2) throw new Error(`body-statement \`${type}\` requires at least two value expressions.`);

  const valueIRs = values.map((value) => {
    const valueIR = parseExpr(value);
    if (valueIR.kind === 'propagate') {
      throw new Error(`Propagation '?' is not allowed in \`${type} values=\` — bind the value to a \`let\` first.`);
    }
    return valueIR;
  });

  const chain = emitPyExprCtx(buildNullishCoalesceIR(valueIRs), ctx);
  const lines = [`${name} = ${chain}`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function buildNullishCoalesceIR(values: ValueIR[]): ValueIR {
  if (values.length === 1) return values[0];
  const [left, ...rest] = values;
  return { kind: 'binary', op: '??', left, right: buildNullishCoalesceIR(rest) };
}

function emitFirstTruthyOperandPy(valueIR: ValueIR, ctx: BodyEmitContext): string {
  const emitted = emitPyExprCtx(valueIR, ctx);
  return valueIR.kind === 'conditional' ? `(${emitted})` : emitted;
}

function emitObjectMergePy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `objectMerge` requires `name=`.');
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const rawSources = unwrapBodyExpr(props.sources);
  if (rawSources === undefined || rawSources === '') {
    throw new Error('body-statement `objectMerge` requires `sources=`.');
  }
  const sources = splitBodyExpressionList(rawSources, 'objectMerge sources=');
  if (sources.length < 2) throw new Error('body-statement `objectMerge` requires at least two source expressions.');
  const emitted: string[] = [];
  for (const source of sources) {
    if (source.startsWith('...')) {
      throw new Error('body-statement `objectMerge` sources imply spreading; omit leading `...`.');
    }
    const sourceIR = parseExpr(source);
    if (sourceIR.kind === 'propagate') {
      throw new Error("Propagation '?' is not allowed in `objectMerge sources=` — bind the value to a `let` first.");
    }
    emitted.push(`**(${emitPyExprCtx(sourceIR, ctx)})`);
  }

  const lines = [`${name} = {${emitted.join(', ')}}`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function emitObjectPickPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `objectPick` requires `name=`.');
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const rawIn = unwrapBodyExpr(props.in);
  if (rawIn === undefined || rawIn === '') {
    throw new Error('body-statement `objectPick` requires `in=`.');
  }
  const rawKeys = unwrapBodyExpr(props.keys);
  if (rawKeys === undefined || rawKeys === '') {
    throw new Error('body-statement `objectPick` requires `keys=`.');
  }

  const inIR = parseExpr(rawIn);
  if (inIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in `objectPick in=` — bind the value to a `let` first.");
  }
  const inExpr = emitPyExprCtx(inIR, ctx);

  const keysList = parseKeys(rawKeys, node, 'objectPick keys=');
  const formattedKeys = emitStringKeyArray(keysList);

  const lines = [
    `${name} = (lambda __kern_source: {key: (__kern_source[key] if key in __kern_source else None) for key in ${formattedKeys}})(${inExpr})`,
  ];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function emitObjectOmitPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `objectOmit` requires `name=`.');
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const rawIn = unwrapBodyExpr(props.in);
  if (rawIn === undefined || rawIn === '') {
    throw new Error('body-statement `objectOmit` requires `in=`.');
  }
  const rawKeys = unwrapBodyExpr(props.keys);
  if (rawKeys === undefined || rawKeys === '') {
    throw new Error('body-statement `objectOmit` requires `keys=`.');
  }

  const inIR = parseExpr(rawIn);
  if (inIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in `objectOmit in=` — bind the value to a `let` first.");
  }
  const inExpr = emitPyExprCtx(inIR, ctx);

  const keysList = parseKeys(rawKeys, node, 'objectOmit keys=');
  const formattedKeys = emitStringKeyArray(keysList);

  const lines = [`${name} = {key: value for key, value in ${inExpr}.items() if key not in ${formattedKeys}}`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function letAssignTracePy(name: string): string {
  return `_kern_trace({"op": "assign", "target": ${JSON.stringify(name)}, "value": ${name}})`;
}

function validateBodyLetKind(rawKind: unknown): void {
  if (rawKind === undefined || rawKind === '' || rawKind === 'const' || rawKind === 'let') return;
  throw new Error('body-statement `let kind=` supports only `const` or `let`.');
}

function emitAssignPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawTarget = props.target;
  const rawValue = props.value;
  const rawOp = props.op === undefined || props.op === '' ? '=' : String(props.op);
  if (rawTarget === undefined || rawTarget === '') {
    throw new Error('body-statement `assign` requires `target=`.');
  }
  if (!isSupportedAssignOperator(rawOp)) {
    throw new Error(`body-statement \`assign op=\` does not support \`${rawOp}\` on Python.`);
  }
  const isPostfix = isPostfixMutationOperator(rawOp);
  if (!isPostfix && (rawValue === undefined || rawValue === '')) {
    throw new Error('body-statement `assign` requires `value=`.');
  }
  if (isPostfix && rawValue !== undefined) {
    // Reject ANY present `value` — including empty-string. Schema validator
    // mirrors this; the emitter check is defense-in-depth for direct IR.
    throw new Error(`body-statement \`assign op="${rawOp}"\` is value-less; remove \`value=\`.`);
  }
  const targetIR = parseExpr(String(rawTarget));
  if (!isAssignableTarget(targetIR)) {
    throw new Error('body-statement `assign target=` must be an identifier, member access, or index access.');
  }
  assertAssignableLocalTarget(targetIR, ctx);
  // Python lacks `++` / `--`; lower postfix mutation to the canonical compound
  // assignment (`X += 1` / `X -= 1`). The TS round-trip stays byte-equivalent
  // because TS emits `X++;` from the same IR — only the Python target diverges
  // textually, but no round-trip from Python source exists.
  if (isPostfix) {
    const baseOp = rawOp === '++' ? '+=' : '-=';
    return [`${emitPyExprCtx(targetIR, ctx)} ${baseOp} 1`];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`assign value=\` — bind to \`let\` first, then assign.`,
    );
  }
  // Emit FIRST (its `emitPyExprCtx` lowering fail-closes a regex method on a
  // bound regex ident) so the RHS is checked against the PRE-reassignment table
  // (`re = s.match(re)` must still see `re` as a regex). Mirrors the TS leg.
  const stmt = `${emitPyExprCtx(targetIR, ctx)} ${rawOp} ${emitPyExprCtx(valueIR, ctx)}`;
  // Reassign-invalidation (Slice-3c): keep the regex-binding table honest. A
  // plain `=` to a direct regex literal stays a regex binding (still
  // fail-closed); any compound op (`+=`, …) or non-regex RHS UNMARKS it.
  if (targetIR.kind === 'ident') {
    rebindRegexOnReassign(ctx, targetIR.name, rawOp === '=' ? valueIR : { kind: 'undefLit' });
  }
  // Differential-harness opt-in (see BodyEmitOptions.traceHooks.letAssign): the
  // `assign` contract observes a reassignment via the same `{op:"assign"}` event
  // a `let` declaration emits. Scoped to identifier targets — the contract
  // domain excludes member/index targets. Mirrors the TS leg in body-ts.ts.
  if (targetIR.kind === 'ident' && ctx.traceHooks?.letAssign) {
    return [stmt, letAssignTracePy(targetIR.name)];
  }
  return [stmt];
}

function declareLocalBinding(ctx: BodyEmitContext, name: string, kind: 'const' | 'let' | 'cell'): void {
  const scope = ctx.localScopes.at(-1);
  if (!scope) return;
  if (scope.has(name)) {
    throw new Error(`body-statement local binding \`${name}\` is already declared in this scope.`);
  }
  scope.set(name, kind);
  setRegexBinding(ctx, name, null);
}

function setRegexBinding(
  ctx: BodyEmitContext,
  name: string,
  regex: Extract<ValueIR, { kind: 'regexLit' }> | null,
): void {
  ctx.regexScopes.at(-1)?.set(name, regex);
}

function lookupRegexBinding(ctx: BodyEmitContext, name: string): Extract<ValueIR, { kind: 'regexLit' }> | null {
  for (let i = ctx.regexScopes.length - 1; i >= 0; i--) {
    const scope = ctx.regexScopes[i];
    if (scope.has(name)) return scope.get(name) ?? null;
  }
  return null;
}

/** Reassign-invalidation: when a tracked ident is REASSIGNED (`assign
 *  target=re value=…`), update its regex marking IN THE SCOPE THAT OWNS IT (not
 *  the innermost scope — that would shadow and leak past the inner block).
 *  Reassigned to a direct `regexLit` → stays a regex binding (still fail-closed);
 *  reassigned to anything else → UNMARK. Mirrors the TS `rebindRegexOnReassign`,
 *  so the stale-binding class dies symmetrically on both targets. */
function rebindRegexOnReassign(ctx: BodyEmitContext, name: string, valueIR: ValueIR): void {
  const next = valueIR.kind === 'regexLit' ? valueIR : null;
  for (let i = ctx.regexScopes.length - 1; i >= 0; i--) {
    const scope = ctx.regexScopes[i];
    if (scope.has(name)) {
      scope.set(name, next);
      return;
    }
  }
}

function assertAssignableLocalTarget(target: ValueIR, ctx: BodyEmitContext): void {
  if (target.kind !== 'ident') return;
  const bindingKind = lookupLocalBinding(ctx, target.name);
  if (bindingKind === 'const') {
    throw new Error(
      `body-statement \`assign target=${target.name}\` cannot reassign immutable \`let name=${target.name}\`; declare it with \`kind=let\`.`,
    );
  }
}

function lookupLocalBinding(ctx: BodyEmitContext, name: string): 'const' | 'let' | 'cell' | undefined {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    const found = ctx.localScopes[i].get(name);
    if (found) return found;
  }
  return undefined;
}

/** Slice-2 — the index into `ctx.localScopes` of the innermost scope that
 *  binds `name`, or `null` if no scope binds it (an unresolved/host name).
 *  Used by `emitBlockClosurePy` to decide loop-variable pinning: a captured
 *  name pins IFF its binding index is at-or-inside the outermost enclosing
 *  loop body (`>= ctx.loopScopeIndexes[0]`). Walks innermost→outermost so a
 *  shadowing inner re-declaration wins over an outer binding of the same name,
 *  matching the rename resolution the body emission uses. */
function findBindingScopeIndex(ctx: BodyEmitContext, name: string): number | null {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    if (ctx.localScopes[i].has(name)) return i;
  }
  return null;
}

function isAssignableTarget(node: ValueIR): boolean {
  if (node.kind === 'ident') return true;
  if (node.kind === 'member') return !node.optional && !containsOptionalAccess(node.object);
  if (node.kind === 'index') return !node.optional && !containsOptionalAccess(node.object);
  return false;
}

function containsOptionalAccess(node: ValueIR): boolean {
  if (node.kind === 'member') return node.optional || containsOptionalAccess(node.object);
  if (node.kind === 'index') return node.optional || containsOptionalAccess(node.object);
  if (node.kind === 'call') return node.optional || containsOptionalAccess(node.callee);
  if (node.kind === 'nonNull' || node.kind === 'typeAssert') return containsOptionalAccess(node.expression);
  return false;
}

function emitDestructurePy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawSource = props.source;
  if (rawSource === undefined || rawSource === '') {
    throw new Error('body-statement `destructure` requires `source=`.');
  }
  const source = emitPyExprCtx(parseExpr(String(rawSource)), ctx);
  const children = node.children ?? [];
  const bindings = children.filter((c) => c.type === 'binding');
  const elements = children.filter((c) => c.type === 'element');
  if (bindings.length === 0 && elements.length === 0) {
    throw new Error('body-statement `destructure` requires `binding` or `element` children.');
  }
  if (bindings.length > 0 && elements.length > 0) {
    throw new Error('body-statement `destructure` cannot mix `binding` and `element` children.');
  }
  if (bindings.length > 0) {
    const tmp = `__k_d${++ctx.gensymCounter}`;
    const lines = [`${tmp} = ${source}`];
    // Slice S7 — an ABSENT destructured key is JS `undefined` (the sentinel), so
    // `typeof missing` is "undefined" not "object". `.get(key, _KERN_UNDEFINED)`
    // returns the sentinel for an absent key AND preserves a PRESENT key whose
    // stored value is already the sentinel (`{ a: undefined }`) — the two stay
    // distinct from a present `None`. Ground/React (non-coerce) keeps `.get(key)`
    // (None default), since it never materializes the sentinel.
    const miss = ctx.coerceJsValues ? ', _KERN_UNDEFINED' : '';
    if (ctx.coerceJsValues) ctx.helpers.add(KERN_NULLISH_HELPER_PY);
    for (const child of bindings) {
      const cp = (child.props ?? {}) as Record<string, unknown>;
      const name = String(cp.name ?? '');
      if (!name) throw new Error('body-statement `binding` requires `name=`.');
      const key = cp.key === undefined || cp.key === '' ? name : String(cp.key);
      lines.push(`${ctx.symbolMap[name] ?? name} = ${tmp}.get(${JSON.stringify(key)}${miss})`);
    }
    return lines;
  }

  const tmp = `__k_d${++ctx.gensymCounter}`;
  // Slice S7 — an out-of-range array-destructure element is JS `undefined` (the
  // sentinel) in value mode; Ground/React keeps `None`.
  const arrMiss = ctx.coerceJsValues ? '_KERN_UNDEFINED' : 'None';
  if (ctx.coerceJsValues && elements.length > 0) ctx.helpers.add(KERN_NULLISH_HELPER_PY);
  return [
    `${tmp} = ${source}`,
    ...elements
      .map((child) => {
        const cp = (child.props ?? {}) as Record<string, unknown>;
        const name = String(cp.name ?? '');
        if (!name) throw new Error('body-statement `element` requires `name=`.');
        const index = Number.parseInt(String(cp.index ?? ''), 10);
        if (Number.isNaN(index)) throw new Error('body-statement `element` requires numeric `index=`.');
        return {
          index,
          line: `${ctx.symbolMap[name] ?? name} = (${tmp}[${index}] if len(${tmp}) > ${index} else ${arrMiss})`,
        };
      })
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.line),
  ];
}

function emitFmtPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const template = props.template;
  if (template === undefined || template === null) {
    throw new Error('body-statement `fmt` requires `template=`.');
  }
  const fstring = templateToPyFString(String(template), ctx);
  const returnMode = props.return === true || props.return === 'true';
  if (returnMode) {
    if (props.name !== undefined && props.name !== '') {
      throw new Error('body-statement `fmt` with `return=true` must not carry a `name=` prop.');
    }
    return [`return ${fstring}`];
  }
  if (props.name === undefined || props.name === '') {
    throw new Error(
      'body-statement `fmt` requires `name=` (or `return=true` for return-position form). Inline-JSX form is only valid as a direct child of `render`/`group`.',
    );
  }
  const rawName = String(props.name);
  const name = ctx.symbolMap[rawName] ?? rawName;
  const lines = [`${name} = ${fstring}`];
  // Differential-harness opt-in: observe the formatted binding via the same
  // {op:assign} event let/assign emit. Production callers set no traceHooks.
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function templateToPyFString(template: string, ctx: BodyEmitContext): string {
  // The `template=` body is raw TS template-literal source — i.e. the chars
  // between the backticks in the original TS. Backslash escapes (`\n`, `\t`,
  // `\xNN`, `\uNNNN`, `\\`) share semantics between TS and Python f-strings,
  // so they pass through verbatim. Two TS-only escapes need translation:
  //
  //   • `` \` `` → `` ` `` (Python doesn't escape backticks; emit literal)
  //   • `\${`    → `${{`  (TS-source escape for literal `${`; in a Python
  //                       f-string we keep the `$` literal and double-brace
  //                       the `{` so it renders as `${` at runtime)
  //
  // `${expr}` interpolation is lowered by translating the inner expression
  // and emitting `{pyExpr}`. The brace-depth scanner is string-literal-aware
  // (skips `}` inside `"…"` / `'…'`) to handle interpolations like
  // `${fn("}")}` correctly. (Codex/Gemini/opencode plan-review fixes.)
  let out = 'f"';
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    if (c === '\\' && template[i + 1] !== undefined) {
      const next = template[i + 1];
      if (next === '`') {
        // TS `` \` `` is a TS-source escape for a literal backtick. Python
        // strings don't require this escape — emit the literal backtick.
        out += '`';
        i += 2;
        continue;
      }
      if (next === '$' && template[i + 2] === '{') {
        // TS `\${` escapes the interpolation marker; the runtime value is
        // literal `${`. In a Python f-string, `${` renders by keeping the
        // dollar and doubling the brace.
        out += '${{';
        i += 3;
        continue;
      }
      if (next === '"') {
        // TS `\"` is a literal `"`. Inside a Python `f"…"`, the `"` must be
        // escaped — emit `\"`.
        out += '\\"';
        i += 2;
        continue;
      }
      // All other escapes — `\n`, `\t`, `\r`, `\\`, `\xNN`, `\uNNNN`,
      // `\0`, `\b`, `\f`, `\v` — share semantics. Pass through verbatim.
      out += c + next;
      i += 2;
      continue;
    }
    if (c === '$' && template[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      let inString: '"' | "'" | '`' | null = null;
      while (j < template.length && depth > 0) {
        const ch = template[j];
        if (inString !== null) {
          if (ch === '\\' && j + 1 < template.length) {
            j += 2;
            continue;
          }
          if (ch === inString) inString = null;
          j++;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          // Track ` so nested template literals like `${a.b(`x${c}`)}` don't
          // miscount braces inside the inner template. (Gemini impl-review fix.)
          inString = ch;
          j++;
          continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth !== 0) {
        throw new Error('body-statement `fmt`: unterminated `${...}` in template.');
      }
      const inner = template.slice(i + 2, j);
      const exprIR = parseExpr(inner);
      if (exprIR.kind === 'propagate') {
        throw new Error("Propagation '?' is not allowed inside an `fmt` template — bind via `let` first.");
      }
      // Route every interpolation through `_kern_fmt` so bool/None render as
      // KERN-canonical `true`/`false`/`null` (matching TS template-literal
      // coercion) instead of Python's `True`/`False`/`None`. Unconditional by
      // design (6-engine council): the emitter has no reliable static type at
      // each slot, and str()/int paths are unchanged so string/int interpolation
      // stays byte-identical to before.
      out += `{_kern_fmt(${emitPyExprCtx(exprIR, ctx)})}`;
      ctx.helpers.add(KERN_FMT_HELPER_PY);
      i = j + 1;
    } else if (c === '{' || c === '}') {
      out += c + c;
      i++;
    } else if (c === '"') {
      out += '\\"';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  out += '"';
  return out;
}

function emitCommentPy(node: IRNode): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const raw = props.raw === undefined || props.raw === null ? '' : String(props.raw).trim();
  if (raw.startsWith('//')) return [`# ${raw.slice(2).trim()}`.trimEnd()];
  if (raw.startsWith('/*') && raw.endsWith('*/')) {
    return raw
      .slice(2, -2)
      .trim()
      .split(/\r?\n/)
      .map((line) => `# ${line.replace(/^\s*\*\s?/, '').trimEnd()}`.trimEnd());
  }
  const text = props.text === undefined || props.text === null ? '' : String(props.text);
  return text.split(/\r?\n/).map((line) => `# ${line}`.trimEnd());
}

function emitReturnPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`return`];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    ctx.usedPropagation = true;
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, errPropagationLine(tmp, ctx), `return ${tmp}.value`];
  }
  return [`return ${emitPyExprCtx(valueIR, ctx)}`];
}

function emitThrowPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`raise Exception()`];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    ctx.usedPropagation = true;
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, errPropagationLine(tmp, ctx), `raise ${tmp}.value`];
  }
  // TS allows `throw "msg"` / `throw 42` — Python `raise X` requires X to be
  // a BaseException subclass, otherwise raises TypeError. Wrap literal
  // values in `Exception(...)` so the cross-target lowering matches user
  // expectations. Calls (`new Error(...)`, `MyError(...)`) and identifiers
  // (could be a caught exception var) pass through unwrapped.
  if (NON_EXCEPTION_LITERAL_KINDS.has(valueIR.kind)) {
    return [`raise Exception(${emitPyExprCtx(valueIR, ctx)})`];
  }
  return [`raise ${emitPyExprCtx(valueIR, ctx)}`];
}

function emitDoPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    ctx.usedPropagation = true;
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, errPropagationLine(tmp, ctx)];
  }
  return [`${emitPyExprCtx(valueIR, ctx)}`];
}

/** ValueIR `kind`s that lower to Python literals/values and would trigger
 *  `TypeError: exceptions must derive from BaseException` if `raise`d
 *  directly. Calls / new / member access / identifiers are NOT in this
 *  set — they could legitimately be Exception subclasses. */
const NON_EXCEPTION_LITERAL_KINDS: ReadonlySet<string> = new Set([
  'numLit',
  'strLit',
  'boolLit',
  'nullLit',
  'undefLit',
  'objectLit',
  'arrayLit',
  'tmplLit',
  'regexLit',
]);

/** Slice-1 ValueIR → Python expression. Covers the surface that body-ts.ts
 *  emits today; later slices extend per the spec.
 *
 *  Slice 3 — accepts an `options` bag so callers can supply a `symbolMap`
 *  (3a) without having to construct a `BodyEmitContext` directly. Imports
 *  are still collected during the walk but are not surfaced to the caller
 *  via this entry point — use `emitNativeKernBodyPythonWithImports` when
 *  you need the imports set. The internal recursive callers go through
 *  `emitPyExprCtx` which threads the live ctx (and therefore the live
 *  imports set) end-to-end. */
export function emitPyExpression(node: ValueIR, options?: BodyEmitOptions): string {
  return emitPyExpressionWithImports(node, options).code;
}

export function emitPyExpressionWithImports(node: ValueIR, options?: BodyEmitOptions): PyExpressionEmitResult {
  const ctx = freshCtx(options);
  ctx.standaloneExpression = true;
  // Seed the outer-binding scope into `localScopes` so this standalone-
  // expression entry point honors `outerBindings` the same way the native-body
  // entry point does (see `emitNativeKernBodyPythonWithImports`). Before slice
  // H the expression path silently ignored `outerBindings`; the shadowing rule
  // (`isProvenUserBinding` consulting the single-source-of-truth scope model)
  // needs them present so a proven-local root named `Math`/`JSON`/… is treated
  // as a user value rather than the host namespace. Index-aligned with
  // `regexScopes`/`renameStack` exactly as the native path does.
  const outerBindings = options?.outerBindings ?? [];
  if (outerBindings.length > 0) {
    ctx.localScopes.push(new Map(outerBindings.map((n) => [n, 'const' as const])));
    ctx.regexScopes.push(new Map(outerBindings.map((n) => [n, null])));
    ctx.renameStack.push(new Map());
  }
  const code = emitPyExprCtx(node, ctx);
  return { code, imports: ctx.imports, helpers: ctx.helpers };
}

function emitPyExprCtx(node: ValueIR, ctx: BodyEmitContext): string {
  switch (node.kind) {
    case 'numLit':
      return node.raw;
    case 'strLit': {
      const escaped = node.value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return `"${escaped}"`;
    }
    case 'boolLit':
      return node.value ? 'True' : 'False';
    case 'nullLit':
      return 'None';
    case 'undefLit':
      // Ground/React layer (no helper channel) keeps the pre-slice collapse to
      // None; native bodies materialize the sentinel so `${undefined}` renders
      // "undefined" (vs null's "null") and `?? `/`typeof` can distinguish it.
      if (!ctx.coerceJsValues) return 'None';
      ctx.helpers.add(KERN_FMT_HELPER_PY);
      return '_KERN_UNDEFINED';
    case 'regexLit':
      ctx.imports.add('re');
      return `__k_re.compile(${pyRegexPattern(node)}, ${pyRegexFlags(node.flags, { allowGlobal: true })})`;
    case 'ident': {
      if (node.name === 'NaN') return 'float("nan")';
      if (node.name === 'Infinity') return 'float("inf")';
      // Slice 2 — a BARE-VALUE host `RegExp` reference (not a member/call
      // receiver, which their own cases own) fails-close. This is the
      // alias-soundness site: `let R = RegExp` is refused at the initializer, so
      // `R(...)` / `new R(...)` can never silently diverge. Honors user shadowing.
      rejectHostRegExpValuePython(node.name, ctx);
      // Block-scope rename takes precedence — an inner `let x` that shadows
      // an outer binding was emitted with a gensym (`__k_shadow_x_N`) and
      // every in-block reference must use the same gensym. Walk renameStack
      // top-to-bottom (most-inner scope wins); after the inner block ends
      // its scope is popped, so post-block references naturally see the
      // outer user-facing name again.
      const blockRename = resolveLocalRename(ctx, node.name);
      if (blockRename !== node.name) return blockRename;
      // Slice 3a — apply symbol-map rename so KERN-form `userId` becomes
      // Python-form `user_id`. Identifiers not in the map (locals, globals,
      // module names) pass through unchanged.
      if (ctx.shadowedSymbols.has(node.name)) return node.name;
      if (ctx.inClassBody && node.name === 'super') return 'super()';
      return ctx.symbolMap[node.name] ?? node.name;
    }
    case 'member':
    case 'call':
    case 'index': {
      // Slice 3d (review fix — Codex critical): optional chains short-circuit
      // the ENTIRE trailing expression after `?.`, not just the immediate
      // access. So `user?.profile.name` must lower to
      // `(user.profile.name if user is not None else None)` — not
      // `(user.profile if user is not None else None).name`, which would
      // raise `AttributeError` on a None receiver.
      //
      // To carry the trailing chain into the guarded branch, member/call
      // emit goes through `lowerMemberOrCall` which returns
      // `{ guard, expr }`. The guard accumulates `is not None` tests
      // collected from each `?.` link in the receiver chain; the expr
      // appends each `.prop` / `(...args)` link to the unguarded form.
      // The top-level wrapper produces `(expr if guard else None)` once
      // (or just `expr` when no `?.` was seen).
      const lowered = lowerChain(node, ctx);
      return wrapGuardIfAny(lowered, ctx);
    }
    case 'await':
      return `await ${emitPyExprCtx(node.argument, ctx)}`;
    case 'new': {
      // Host Error mapping (spec §1): `new Error(args)` → `Exception(args)` on
      // Python, since `raise Error(...)` / `isinstance(x, Error)` would
      // NameError (Python has no global `Error`). The mapping also covers
      // `let e = new Error(x)` and `throw new Error(x)` (both flow through the
      // `new` expression). `new TypeError(...)` is intentionally NOT mapped —
      // Python has a native `TypeError`, so it emits as-is.
      // TODO(kern): RangeError/SyntaxError/ReferenceError/EvalError/URIError
      // have NO same-named Python builtins and emit as-is → runtime NameError;
      // map or reject in the v2 builtin-errors slice. A user KERN class
      // literally named `Error` would be shadowed by this mapping —
      // registry-precedence hardening is also v2.
      const arg = node.argument;
      if (arg.kind === 'call' && arg.callee.kind === 'ident' && arg.callee.name === 'Error') {
        const remapped: ValueIR = { ...arg, callee: { ...arg.callee, name: 'Exception' } };
        return emitPyExprCtx(remapped, ctx);
      }
      // `new Error` WITHOUT parens is valid JS (≡ `new Error()`) and parses as
      // a bare ident argument — remap it too, else it emits a bare `Error`
      // NameError (agon review, claude/zai convergence).
      if (arg.kind === 'ident' && arg.name === 'Error') {
        return 'Exception()';
      }
      // Slice 2 — `new RegExp(p)` (with or without parens) fails-close BEFORE the
      // fall-through, with the shared regex message (the TS emitter + IR-validate
      // throw the same string). Without this the Python `new` case falls through
      // to a verbatim `RegExp(...)` NameError instead of a compile-time refusal.
      // Honors user shadowing via `isProvenUserBinding`.
      if (arg.kind === 'call' && arg.callee.kind === 'ident') {
        rejectHostRegExpValuePython(arg.callee.name, ctx);
      } else if (arg.kind === 'ident') {
        rejectHostRegExpValuePython(arg.name, ctx);
      }
      return emitPyExprCtx(arg, ctx);
    }
    case 'typeAssert':
      return emitPyExprCtx(node.expression, ctx);
    case 'nonNull':
      return emitPyExprCtx(node.expression, ctx);
    case 'tmplLit': {
      // Lower TS template literals to Python f-strings. In native bodies, wrap
      // each interpolation in _kern_fmt so JS value→string coercion semantics
      // (true→"true", null→"null", undefined→"undefined", 1.0→"1", arrays→
      // comma-joined, objects→"[object Object]") are preserved. The helper-less
      // Ground/React layer keeps the pre-slice raw f-string interpolation.
      const coerce = ctx.coerceJsValues;
      if (coerce) ctx.helpers.add(KERN_FMT_HELPER_PY);
      let out = 'f"';
      for (let i = 0; i < node.quasis.length; i++) {
        out += node.quasis[i]
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\{/g, '{{')
          .replace(/\}/g, '}}');
        if (i < node.expressions.length) {
          const inner = emitPyExprCtx(node.expressions[i], ctx);
          out += coerce ? `{_kern_fmt(${inner})}` : `{${inner}}`;
        }
      }
      out += '"';
      return out;
    }
    case 'binary': {
      // DECIMAL Slice 2 (item 3) — fail closed on `+`/`-`/`*` over a syntactically-
      // proven Decimal operand (`Decimal.of(...)`/`Decimal.<m>(...)`), the SAME
      // decision the TS leg makes (shared `assertNoDecimalOperator` + message), so
      // the refusal is byte-identical across targets. Conservative: a no-op for plain
      // numeric arithmetic and for every non-`+`/`-`/`*` operator below.
      assertNoDecimalOperator(node);
      // Slice 6 — bitwise / shift on the slice-0.75 ToInt32 substrate. Emitted
      // DIRECTLY as helper-wrapped strings (operands recurse through
      // `emitPyExprCtx`), so nested bitwise ops compose without the double-
      // dispatch recursion an AST-rewrite-then-re-emit would cause.
      if (node.op === '|' || node.op === '&' || node.op === '^' || node.op === '<<' || node.op === '>>') {
        return emitBitwiseShiftPy(node.op, node.left, node.right, ctx);
      }
      if (node.op === '>>>') {
        return emitUnsignedShiftPy(node.left, node.right, ctx);
      }
      if (node.op === '%') {
        // Modulo keeps the existing `_tmod` lowering (orthogonal to S6).
        const transformed = lowerBitwiseAndModuloAST(node);
        registerHelpers(transformed, ctx);
        return emitLoweredBitwisePy(transformed, ctx);
      }
      // Slice 2c — arithmetic / comparison / logical lowering for Python.
      // Use precedence-aware paren-wrapping so `a + b * c` doesn't redundantly
      // wrap the right side (`a + (b * c)`) — same rule as the TS side.
      //
      // Slice-2 review fix: Python chains comparisons (`a == b < c` means
      // `(a == b) and (b < c)`), but TS evaluates left-to-right with strict
      // precedence. To preserve KERN's TS-flavored AST semantics on the
      // Python target, force parens around comparison children whose op is
      // ALSO a comparison — that disables Python's chaining and yields the
      // expected `(a == b) < c` evaluation order.
      const left = emitPyExprCtx(node.left, ctx);
      const right = emitPyExprCtx(node.right, ctx);

      if (node.op === 'instanceof') {
        // JS `a instanceof B` → Python `isinstance(a, B)`. Emitting `instanceof`
        // verbatim would be a Python *syntax* error, so this lowering is
        // mandatory (unlike raw host methods, which emit verbatim).
        //
        // RHS handling (spec §2, shared table in core/instanceof-rhs.ts):
        //   - accepted host global → mapped Python type: `Array`→`list`,
        //     `Error`→`Exception` (so `e instanceof Error` ≡
        //     `isinstance(e, Exception)`, mirroring `new Error(...)` →
        //     `Exception(...)`; Python `except Exception as e` + this check ≡
        //     JS catch + `e instanceof Error` for KERN-thrown errors).
        //   - rejected RHS (wrapper-parity trap / unsupported builtin /
        //     non-type-name) → THROW fail-closed. This is defense in depth:
        //     the eligibility gate already rejects these bodies, so this throw
        //     can only fire on directly-built IR, never on gate-passed source —
        //     gate and lowerer share core/instanceof-rhs.ts and cannot drift.
        //   - any other ident/member RHS → emit as-is (user classes work; an
        //     unknown name fails loud at Python runtime with NameError —
        //     registry-precedence hardening is v2).
        const rhs = node.right;
        if (rhs.kind === 'ident') {
          const rejectReason = instanceofRhsRejectReasonForName(rhs.name);
          if (rejectReason !== null) {
            throw new Error(
              `instanceof RHS '${rhs.name}' has no Python lowering (${rejectReason}). ` +
                'JS primitive-wrapper / unmapped-builtin instanceof has no isinstance parity; ' +
                'this body is ineligible for native KERN.',
            );
          }
          const mapped = instanceofRhsPythonType(rhs.name);
          if (mapped !== null) return `isinstance(${left}, ${mapped})`;
          return `isinstance(${left}, ${right})`;
        }
        if (rhs.kind === 'member') {
          return `isinstance(${left}, ${right})`;
        }
        throw new Error(
          'instanceof RHS is not a type name (instanceof-rhs-not-a-type-name); ' +
            'only a class identifier or qualified member name can lower to isinstance().',
        );
      }

      if (node.op === '+' && ctx.coerceJsValues) {
        // JS `+` is overloaded: string concat if either operand is string-ish,
        // numeric addition otherwise. Python has no implicit coercion, so we
        // lower based on syntactic hints:
        //  - If either operand is syntactically string-producing (strLit/tmplLit),
        //    emit _kern_fmt(left) + _kern_fmt(right) for JS string concat.
        //  - Otherwise (idents/calls/members/numbers — type unknown at emit time),
        //    emit __kern_add(left, right) so numeric + stays additive and dynamic
        //    string concat is coerced at runtime.
        // The helper-less Ground/React layer skips this and falls through to the
        // generic raw `+` path below (pre-slice behavior, zero regression).
        ctx.helpers.add(KERN_FMT_HELPER_PY);
        const isStr = (n: ValueIR) => n.kind === 'strLit' || n.kind === 'tmplLit';
        if (isStr(node.left) || isStr(node.right)) {
          return `_kern_fmt(${left}) + _kern_fmt(${right})`;
        }
        return `__kern_add(${left}, ${right})`;
      }

      if (node.op === '&&' || node.op === '||') {
        // Slice S5 — logical `&&` / `||` RESULT-VALUE semantics on Python.
        //
        // KERN `&&`/`||` are operand-selectors, not boolean operators:
        //   `a && b` returns `a` when ToBoolean(a) is false, else `b`.
        //   `a || b` returns `a` when ToBoolean(a) is true,  else `b`.
        // Python's `and`/`or` use Python truthiness (`bool(x)` / `len(x)`), which
        // diverges from KERN ToBoolean on `[]`, `{}`, `NaN`, `"0"`, `"false"`,
        // `" "` — e.g. `[] or x` returns `x` in Python but must return `[]` in
        // KERN. So `and`/`or` are wrong; we lower through the SAME `_kern_truthy`
        // (KERN ToBoolean) substrate S4 routes `!`/ternary/`if cond=` through.
        //
        // Canonical lowering (single-eval, lazy, original-value-returning):
        //   L && R  ->  (__k_logN if not _kern_truthy(__k_logN := L) else R)
        //   L || R  ->  (__k_logN if     _kern_truthy(__k_logN := L) else R)
        //
        // The walrus binds L EXACTLY ONCE (works for calls/indexes/members/
        // nested logicals — no double-read), `_kern_truthy` decides the branch
        // on KERN truthiness, and the unselected operand is NEVER evaluated
        // (Python conditional-expr branches are lazy). NO ident/pure-left fast
        // path in this slice — conservative walrus for EVERY left operand is the
        // single-eval law (S4 carry-forward; optimization needs its own oracle).
        //
        // Emitted UNCONDITIONALLY for both native (`coerceJsValues`) and Ground/
        // React layers — mirroring S4's `!`/ternary, which also emit
        // `_kern_truthy` regardless of the coercion flag. The `[]`/`{}`/`NaN`
        // divergence is independent of the undefined sentinel, so a Ground-layer
        // `a and b` would be just as wrong; parity demands one spelling.
        // `KERN_JS_HELPER_PY` is in Ground's prelude registry, so the helper is
        // inlined there too.
        ctx.helpers.add(KERN_JS_HELPER_PY);
        const tmp = `__k_log${++ctx.gensymCounter}`;
        // `:=` (PEP 572) binds looser than almost everything, so a low-precedence
        // left operand (conditional/lambda/walrus-bearing) must be parenthesized
        // so `__k_logN := L` captures the WHOLE operand. A nested `&&`/`||` is
        // already self-parenthesized, so this only fires on raw conditional/
        // lambda left operands.
        const leftOperand = needsWalrusOperandParens(node.left) ? `(${left})` : left;
        // The `else` branch is a conditional-expression alternate; a bare
        // conditional/lambda there reparses ambiguously, so wrap it. A nested
        // logical R is self-parenthesized; only raw conditional/lambda needs it.
        const rightOperand = needsConditionalAlternateParens(node.right) ? `(${right})` : right;
        if (ctx.banWalrus) {
          // Comprehension-iterable position (see BodyEmitContext.banWalrus):
          // the walrus form is a SyntaxError here, so bind L as a lambda
          // parameter instead. Same contract: L evaluated exactly once (as the
          // call argument), the unselected branch never evaluated (lazy
          // conditional inside the lambda body), original value returned.
          const test = `_kern_truthy(${tmp})`;
          const guarded = node.op === '&&' ? `not ${test}` : test;
          return `(lambda ${tmp}: (${tmp} if ${guarded} else ${rightOperand}))(${left})`;
        }
        const test = `_kern_truthy(${tmp} := ${leftOperand})`;
        const guarded = node.op === '&&' ? `not ${test}` : test;
        return `(${tmp} if ${guarded} else ${rightOperand})`;
      }

      if (node.op === '??') {
        // Slice 4c — nullish coalesce lowering. Two shapes:
        //
        //   (a) Pure left side (ident or non-optional member chain rooted
        //       at ident) — re-evaluating the expression in both the test
        //       and the result branch is side-effect-free, so emit the
        //       readable double-name form:
        //         `(L if L is not None else R)`
        //
        //   (b) Non-pure left side (call / await / binary / etc.) — single-
        //       eval is required so we use Python's walrus operator
        //       (PEP 572, Python 3.8+) to bind the result inline:
        //         `(__k_nc1 if (__k_nc1 := L) is not None else R)`
        //       Python evaluates the walrus assignment expression FIRST
        //       (single eval of L → bound to __k_nc1), tests for None, and
        //       returns __k_nc1 or R. The gensym counter shares with the
        //       propagation hoist (`__k_t…`) — distinct prefix prevents
        //       any name collision.
        //
        // Slice 4c (post-buddy-review) was the easy-win expansion after the
        // 22.7% empirical-gate scan; this lifts the slice-2 `??` throw and
        // adds an estimated +7% to native eligibility on Agon-AI bodies.
        // Ground/React layer keeps the pre-slice None-only nullish test (no
        // sentinel, no helper). Native bodies also exclude the undefined
        // sentinel so `undefined ?? x` coalesces.
        if (!ctx.coerceJsValues) {
          if (isReceiverChainPure(node.left)) {
            return `(${left} if ${left} is not None else ${right})`;
          }
          const tmp = `__k_nc${++ctx.gensymCounter}`;
          if (ctx.banWalrus) {
            // Comprehension-iterable position — walrus is a SyntaxError here;
            // lambda-parameter form keeps single-eval + lazy right branch.
            return `(lambda ${tmp}: (${tmp} if ${tmp} is not None else ${right}))(${left})`;
          }
          return `(${tmp} if (${tmp} := ${left}) is not None else ${right})`;
        }
        ctx.helpers.add(KERN_FMT_HELPER_PY);
        if (isReceiverChainPure(node.left)) {
          return `(${left} if (${left} is not None and ${left} is not _KERN_UNDEFINED) else ${right})`;
        }
        const tmp = `__k_nc${++ctx.gensymCounter}`;
        if (ctx.banWalrus) {
          // Comprehension-iterable position — see BodyEmitContext.banWalrus.
          return `(lambda ${tmp}: (${tmp} if (${tmp} is not None and ${tmp} is not _KERN_UNDEFINED) else ${right}))(${left})`;
        }
        return `(${tmp} if ((${tmp} := ${left}) is not None and ${tmp} is not _KERN_UNDEFINED) else ${right})`;
      }

      // Slice S7 — split loose (`==`/`!=`) and strict (`===`/`!==`) equality so
      // the null/undefined boundary matches JS: `undefined == null` is True (both
      // nullish), `undefined === null` is False (distinct identities). Pre-S7
      // both lowered to Python `==`, which on the sentinel/None pair is False —
      // wrong for the loose op. Routed through the helper pair only in native
      // (coerce) bodies; the helper-less Ground/React layer keeps the raw
      // `==`/`!=` mapping (it never materializes the sentinel, so the nullish
      // crossing cannot arise there). Function-call form sidesteps Python's
      // comparison-chaining entirely, so no chain-paren handling is needed for
      // the equality ops themselves; chained comparison CHILDREN still recurse
      // through `emitPyExprCtx` and self-parenthesize as before.
      if (ctx.coerceJsValues && (node.op === '===' || node.op === '!==' || node.op === '==' || node.op === '!=')) {
        ctx.helpers.add(KERN_NULLISH_HELPER_PY);
        const fn = node.op === '===' || node.op === '!==' ? '_kern_strict_equal' : '_kern_loose_equal';
        const call = `${fn}(${left}, ${right})`;
        return node.op === '!==' || node.op === '!=' ? `(not ${call})` : call;
      }

      const forceLeft = needsComparisonChainParens(node.left, node.op);
      const forceRight = needsComparisonChainParens(node.right, node.op);
      const lp = forceLeft || needsBinaryParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = forceRight || needsBinaryParens(node.right, node.op, 'right') ? `(${right})` : right;
      const op = mapBinaryOpToPython(node.op);
      return `${lp} ${op} ${rp}`;
    }
    case 'unary': {
      if (node.op === '~') {
        // ~a  ->  _kern_to_int32(~_kern_to_int32(a))
        ctx.helpers.add(KERN_TO_NUMBER_HELPER_PY);
        return `_kern_to_int32(~_kern_to_int32(${emitPyExprCtx(node.argument, ctx)}))`;
      }
      // Slice 2c — `!x` → `not x`, `-x` → `-x`.
      // Slice typeof — expose the now-eligible native KERN `typeof` shape on
      // Python too. Dynamic Python values are an approximation of JS typeof:
      // Python has no runtime `undefined`, `symbol`, or bigint distinction.
      if (node.op === 'typeof') return emitPyTypeof(node.argument, ctx);
      const arg = emitPyExprCtx(node.argument, ctx);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      // Slice S4 — `!x` consumes KERN ToBoolean and returns a real Python bool.
      // `not _kern_truthy(x)` gives `!""`/`!NaN` → True and `!"0"`/`![]` → False
      // (bare `not x` would get `![]`/`!{}`/`!NaN` wrong). Wrap unconditionally.
      if (node.op === '!') {
        ctx.helpers.add(KERN_JS_HELPER_PY);
        return `(not _kern_truthy(${arg}))`;
      }
      if (node.op === '-' && node.argument.kind === 'numLit' && Number(node.argument.raw) === 0) return '-0.0';
      if (node.op === '-') return `-${wrapped}`;
      if (node.op === '+') return `+${wrapped}`;
      throw new Error(`emitPyExpression: unary op '${node.op}' has no Python equivalent in slice-2c.`);
    }
    case 'objectLit': {
      // Slice 2d — Python dict literal. Keys are ALWAYS double-quoted (no
      // shorthand-key syntax in Python).
      const entries = node.entries.map((e) => {
        if ('kind' in e && (e as any).kind === 'spread') {
          return `**${emitPyExprCtx((e as any).argument, ctx)}`;
        }
        const prop = e as { key: string; value: ValueIR };
        return `${JSON.stringify(prop.key)}: ${emitPyExprCtx(prop.value, ctx)}`;
      });
      return `{${entries.join(', ')}}`;
    }
    case 'arrayLit':
      return `[${node.items.map((i) => emitPyExprCtx(i, ctx)).join(', ')}]`;
    case 'lambda':
      return emitLambdaPy(node, ctx);
    case 'conditional': {
      // Slice α-2: TS `test ? consequent : alternate` lowers to Python's
      // expression-form conditional `consequent if test else alternate`
      // (operand reorder). Lowest-precedence in Python expressions, so
      // paren-wrap binary/unary children for safety.
      const testStr = emitPyExprCtx(node.test, ctx);
      const consStr = emitPyExprCtx(node.consequent, ctx);
      const altStr = emitPyExprCtx(node.alternate, ctx);
      const wrap = (child: ValueIR, emitted: string): string => {
        switch (child.kind) {
          case 'binary':
          case 'unary':
          case 'spread':
          case 'await':
          case 'new':
          case 'conditional':
            return `(${emitted})`;
          default:
            return emitted;
        }
      };
      // Slice S4 — the ternary condition consumes KERN ToBoolean exactly once, so
      // `{} ? a : b`/`[] ? a : b` take the consequent and `NaN ? a : b` takes the
      // alternate. `_kern_truthy(...)` already parenthesizes the test, so no extra
      // `wrap` is needed on it. Wrap unconditionally (no "looks boolean" skip).
      ctx.helpers.add(KERN_JS_HELPER_PY);
      return `${wrap(node.consequent, consStr)} if _kern_truthy(${testStr}) else ${wrap(node.alternate, altStr)}`;
    }
    case 'spread':
      return `*${emitPyExprCtx(node.argument, ctx)}`;
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is only allowed at statement level (top of \`let value=\` or \`return value=\`). ` +
          `Mid-expression \`${node.op}\` is rejected — bind the call to a \`let\` first, then use the bound name.`,
      );
  }
  throw new Error(`emitPyExpression: unsupported expression kind '${(node as { kind?: string }).kind ?? 'unknown'}'.`);
}

function emitPyTypeof(argument: ValueIR, ctx: BodyEmitContext): string {
  // Round-6 fix — `typeof <bare host-namespace root>` fails-close on BOTH targets.
  // The round-5 carve-out lowered `typeof RegExp` to the constant `"function"`
  // on the theory that it was byte-identical to TS's native `typeof RegExp`. But
  // the carve-out's siblings on the TS/IR legs blanket-accepted EVERY bare
  // `typeof` operand, re-opening reserved host roots: `typeof Date`/`typeof
  // process` lowered HERE to a runtime `isinstance` ladder over the Python names
  // `Date`/`process`, which do NOT exist → NameError, while TS emits the native
  // `typeof Date`. That is a genuine TS↔Python divergence, so `typeof <host root>`
  // must fail-close. `RegExp` keeps the shared regex message (matching the
  // bare-value reject + the TS/IR legs); every other reserved host root takes the
  // generic host message with a synthetic `typeof` member. A non-host operand
  // (`typeof userLocal`, `typeof undeclaredFeatureFlag`) and a proven user binding
  // fall through to the runtime ladder below, unchanged. `typeof RegExp.prototype`
  // is a `member` operand and still fails-close via the generic guards.
  //
  // Round-7 fix — a WRAPPED operand (`typeof (Date as any)`, `typeof (Date!)`)
  // arrived as `typeAssert`/`nonNull`, NOT an `ident`, so the round-6 reject was
  // bypassed and Python lowered a runtime Date/process lookup (NameError) while
  // the (now-corrected) TS leg emits `typeof Date`. Peel the transparent wrappers
  // via the round-5 `unwrapTransparentReceiverIR` (fixpoint over
  // `typeAssert`/`nonNull`) and apply the host-root reject to the UNWRAPPED
  // operand, identically to the TS-emit + IR-validate legs. The runtime-ladder
  // fall-through below still operates on the ORIGINAL `argument`, so an accepted
  // wrapped operand (`typeof (userLocal as any)`) emits the wrapper's value
  // unchanged.
  const typeofOperand = unwrapTransparentReceiverIR(argument);
  if (typeofOperand.kind === 'ident' && !isProvenUserBinding(ctx, typeofOperand.name)) {
    if (typeofOperand.name === 'RegExp') throw new Error(REGEX_HOST_REGEXP_FAILCLOSE);
    if (isHostNamespaceRoot(typeofOperand.name)) {
      throw new Error(unmappedHostNamespaceMessage('Python', typeofOperand.name, 'typeof'));
    }
  }
  switch (argument.kind) {
    case 'strLit':
      return '"string"';
    case 'boolLit':
      return '"boolean"';
    case 'numLit':
      return argument.bigint ? '"bigint"' : '"number"';
    case 'undefLit':
      return '"undefined"';
    case 'nullLit':
      return '"object"';
    case 'lambda':
      return '"function"';
    case 'arrayLit':
    case 'objectLit':
    case 'regexLit':
      return '"object"';
    case 'tmplLit':
      return '"string"';
    default:
      break;
  }

  const value = emitPyExprCtx(argument, ctx);
  const wrapped = needsArgParens(argument) ? `(${value})` : value;
  const tmp = `__k_typeof${++ctx.gensymCounter}`;
  // Native bodies: a runtime value holding the undefined sentinel reports
  // "undefined" (JS `typeof undefined`), not "object". The walrus binds in the
  // first test so the sentinel branch is checked before the None branch. The
  // helper-less Ground layer never materializes the sentinel, so it keeps the
  // pre-slice None-first form.
  if (ctx.coerceJsValues) {
    ctx.helpers.add(KERN_FMT_HELPER_PY);
    if (ctx.banWalrus) {
      // Comprehension-iterable position — walrus is a SyntaxError here; bind
      // the operand as a lambda parameter instead (single-eval preserved).
      return (
        `(lambda ${tmp}: ("undefined" if ${tmp} is _KERN_UNDEFINED ` +
        `else "object" if ${tmp} is None ` +
        `else "boolean" if isinstance(${tmp}, bool) ` +
        `else "number" if isinstance(${tmp}, (int, float)) ` +
        `else "string" if isinstance(${tmp}, str) ` +
        `else "function" if callable(${tmp}) ` +
        `else "object"))(${value})`
      );
    }
    return (
      `("undefined" if (${tmp} := ${wrapped}) is _KERN_UNDEFINED ` +
      `else "object" if ${tmp} is None ` +
      `else "boolean" if isinstance(${tmp}, bool) ` +
      `else "number" if isinstance(${tmp}, (int, float)) ` +
      `else "string" if isinstance(${tmp}, str) ` +
      `else "function" if callable(${tmp}) ` +
      `else "object")`
    );
  }
  if (ctx.banWalrus) {
    // Comprehension-iterable position — see BodyEmitContext.banWalrus.
    return (
      `(lambda ${tmp}: ("object" if ${tmp} is None ` +
      `else "boolean" if isinstance(${tmp}, bool) ` +
      `else "number" if isinstance(${tmp}, (int, float)) ` +
      `else "string" if isinstance(${tmp}, str) ` +
      `else "function" if callable(${tmp}) ` +
      `else "object"))(${value})`
    );
  }
  return (
    `("object" if (${tmp} := ${wrapped}) is None ` +
    `else "boolean" if isinstance(${tmp}, bool) ` +
    `else "number" if isinstance(${tmp}, (int, float)) ` +
    `else "string" if isinstance(${tmp}, str) ` +
    `else "function" if callable(${tmp}) ` +
    `else "object")`
  );
}

function emitLambdaPy(node: Extract<ValueIR, { kind: 'lambda' }>, ctx: BodyEmitContext): string {
  const names = node.params.map((p) => p.name);
  if (node.bodyBlock) {
    return emitBlockClosurePy(node, names, ctx);
  }
  const previous = new Set(ctx.shadowedSymbols);
  for (const name of names) ctx.shadowedSymbols.add(name);
  try {
    const params = names.length === 0 ? '' : ` ${names.join(', ')}`;
    return `lambda${params}: ${emitPyExprCtx(node.body as ValueIR, ctx)}`;
  } finally {
    ctx.shadowedSymbols = previous;
  }
}

/** Slices 0+1 — lower a block-bodied arrow (`x => { ... }`) to a hoisted local
 *  Python `def`. Pushes `def __kern_closure_N(params): <body>` into
 *  `ctx.pendingHoists` (flushed by emitChildrenPy immediately before the
 *  enclosing statement) and RETURNS the def name as the expression string, so
 *  `let scale = (x) => {...}` lowers to `scale = __kern_closure_0` with the def
 *  hoisted above it.
 *
 *  The closure body is lowered through `lowerJsClosureBodyToPython`, reusing
 *  the class-path expression/condition callbacks:
 *   - `lowerExpression(raw)` = `emitPyExprCtx(parseExpr(raw), ctx)` —
 *     identical to every other native-body expression emit, so a captured
 *     RENAMED outer variable resolves through `ctx` (the rename stack /
 *     symbolMap) exactly as it does outside the closure.
 *   - `lowerCondition(raw)` mirrors the class/native if-emitter, which lowers a
 *     condition as the bare `emitPyExprCtx(parseExpr(cond), ctx)` (NO
 *     js_truthy wrapper). Matching it EXACTLY means a condition inside a
 *     closure lowers identically to the same condition outside one.
 *
 *  Closure PARAMS shadow outer renames while the body is lowered (same
 *  `shadowedSymbols` save/restore as the expression-lambda branch) — params
 *  must NOT be renamed, while captures of renamed outer vars still resolve
 *  through ctx. The v1 gate (commit A) guarantees the lowering succeeds;
 *  gate/lowerer drift (`ok:false`) is a loud bug. */
function emitBlockClosurePy(node: Extract<ValueIR, { kind: 'lambda' }>, names: string[], ctx: BodyEmitContext): string {
  const closureName = `__kern_closure_${ctx.closureSeq++}`;
  const previous = new Set(ctx.shadowedSymbols);
  for (const name of names) ctx.shadowedSymbols.add(name);
  // Slice 2 review-fix parity (round 3) — a block-LOCAL `const`/`let`/function/
  // class shadows any outer binding of that name WITHIN ITS OWN BLOCK (and
  // nested blocks) only, so a host-`RegExp` value guard
  // (`rejectHostRegExpValuePython`) must fire on an OUTER reference but NOT on an
  // in-scope one. The old code registered EVERY declared name (incl. names
  // declared only in a NESTED block) into `shadowedSymbols` for the WHOLE
  // closure — fail-OPEN on `() => { if (ok) { const RegExp = 1; } return RegExp; }`
  // (the outer `return RegExp` was wrongly treated as the local), DIVERGING from
  // the TS leg. The lowerer FLATTENS nested blocks, so it now reports block
  // boundaries via `enterBlockScope`/`exitBlockScope`; we push/pop block-local
  // shadows exactly like the TS-AST closure walk's `scopes` stack. Only names
  // NOT already shadowed are pushed/popped, so an outer binding of the same name
  // survives the inner block's pop.
  const blockScopeAdded: Array<Set<string>> = [];
  try {
    const lowered = lowerJsClosureBodyToPython(node.bodyBlock!.raw, {
      lowerExpression: (raw) => emitPyExprCtx(parseExpr(raw), ctx),
      // Mirror the native/class if-emitter EXACTLY (bare expression, no
      // js_truthy) so a condition inside the closure matches the same
      // condition outside it.
      lowerCondition: (raw) => emitPyExprCtx(parseExpr(raw), ctx),
      // The closure's own params are def-locals, never `nonlocal`: a write to a
      // param (`(x) => { x = x + 1 }`) must not be reported as a written FREE
      // name. The lowerer excludes both params and block-locals.
      paramNames: names,
      // Bare write TARGETS resolve through the SAME rename machinery reads use
      // — a write to a shadow-renamed capture must target the renamed binding
      // (`__k_shadow_x_N = …`), not the outer one (probe-verified silent
      // wrong-values without this). Params/block-locals are never renamed, so
      // the resolver is identity for them.
      lowerAssignTarget: (name) => resolveLocalRename(ctx, name),
      // Block-scope shadowing — push a block's top-level locals on entry, pop on
      // exit, so a `RegExp` value reference fails-close ONLY when no in-scope
      // block-local/param shadows it (byte-aligned with the TS-AST walk).
      enterBlockScope: (scopeNames) => {
        const added = new Set<string>();
        for (const name of scopeNames) {
          if (!ctx.shadowedSymbols.has(name)) {
            ctx.shadowedSymbols.add(name);
            added.add(name);
          }
        }
        blockScopeAdded.push(added);
      },
      exitBlockScope: () => {
        const added = blockScopeAdded.pop();
        if (added) for (const name of added) ctx.shadowedSymbols.delete(name);
      },
    });
    if (!lowered.ok) {
      // The commit-A gate already accepted this block, so a lowering failure
      // here is gate/lowerer drift — surface it loudly.
      throw new Error(
        `Internal codegen error: block-arrow closure passed the v1 gate but failed to lower (${lowered.reason ?? 'unknown'}).`,
      );
    }
    // Slice-2 loop-variable pinning. JS closures capture variables BY
    // REFERENCE; a binding created PER-ITERATION (an each/for loop var, or any
    // let/const declared inside a loop body) is re-bound each iteration, so
    // each closure sees its own iteration's value. A naive Python hoisted def
    // late-binds → every closure sees the LAST value (the classic 0,1,2 vs
    // 2,2,2 bug). FIX: pin such captures via a default arg
    // (`def __kern_closure_N(p, x=x):`) — Python evaluates defaults at def
    // time = the hoist point before the enclosing statement = exactly the
    // per-iteration snapshot JS produces.
    //
    // RULE: pin a captured name IFF its binding resolves at-or-inside the
    // OUTERMOST loop body enclosing the closure (scope index >=
    // loopScopeIndexes[0]). A binding declared OUTSIDE every loop (a function
    // param, an accumulator, a `while` condition var) resolves below that
    // index and stays late-bound — JS sees its CURRENT value at call time, and
    // Python late binding is already parity-correct for it. Over-pinning those
    // would WRONGLY freeze a value JS does not freeze.
    const pinParams: string[] = [];
    // The user-facing names that got PINNED (per-iteration loop captures). A
    // WRITTEN free name that is also pinned is unlowerable in v1 (the def-time
    // pin freezes the value; a `nonlocal` write would target the wrong binding)
    // — it throws `closure-pinned-write` below. Tracked here so the throw and
    // the disjointness assertion can consult it.
    const pinnedNames = new Set<string>();
    if (ctx.loopScopeIndexes.length > 0) {
      const free = collectFreeIdentifierNames(node.bodyBlock!.raw, names);
      const outermostLoopScope = ctx.loopScopeIndexes[0];
      // Alphabetical by user-facing name for deterministic emission order.
      for (const name of [...free].sort()) {
        const scopeIndex = findBindingScopeIndex(ctx, name);
        if (scopeIndex === null || scopeIndex < outermostLoopScope) continue;
        // Slice-2 fix (agon review, claude 0.7) — a pin FREEZES the value at
        // def time, but JS captures by reference: if the pinned binding is
        // REASSIGNED in a later sibling statement of any enclosing loop body,
        // the JS closure sees the mutation and the frozen default does not
        // (`let t = 0; fns.push(() => t); t = t + x` → JS [1,2], pinned
        // Python [0,0]). Fail closed instead of emitting silent divergence.
        // Assignments in a STRICTLY-LOWER top-level child (`< current`) run
        // before the closure and are captured by the pin — those are fine. The
        // `>=` (not `>`) rejects an assignment in the SAME top-level child as the
        // closure too: within-child statement order is not tracked (the whole
        // child shares one index), so a same-child closure+reassignment cannot be
        // proven safe — fail closed beats the silent divergence (kimi 0.85).
        for (const frame of ctx.loopLaterAssignFrames) {
          const lastAssign = frame.assignLast.get(name);
          if (lastAssign !== undefined && lastAssign >= frame.current) {
            throw new Error(
              `Closure captures loop-local '${name}' which is reassigned after the closure is created — ` +
                `the per-iteration pin would freeze a value JS does not freeze. ` +
                `Bind the final value to a fresh const before creating the closure (v1 limitation).`,
            );
          }
        }
        // Resolve to the SAME Python name the body emission uses. A captured
        // loop-body binding goes through the block-scope rename stack
        // (`resolveLocalRename`) — identical to the `ident` emit path — so a
        // shadow-renamed inner `x` pins as `__k_shadow_x_N=__k_shadow_x_N`.
        // (symbolMap is param-only and never names a loop-body-scoped binding,
        // so it is intentionally not consulted here.)
        const renamed = resolveLocalRename(ctx, name);
        // Defensive (agon review, claude 0.3 nit): a renamed pin equal to a
        // closure param would emit `def f(p, p=p)` — a Python SyntaxError.
        // Renames are __k_shadow_*/gensym forms, so this is theoretical; fail
        // loud rather than emit invalid Python if it ever happens.
        if (names.includes(renamed)) {
          throw new Error(
            `Closure parameter '${renamed}' collides with the rename of captured '${name}' — rename the parameter.`,
          );
        }
        pinParams.push(`${renamed}=${renamed}`);
        pinnedNames.add(name);
      }
    }

    // Mutation v1 — free-variable WRITES (`nonlocal`). A bare write to a free
    // capture (one that is neither a closure param nor a block-local — the
    // lowerer already excluded those) needs a `nonlocal` declaration so Python
    // rebinds the OUTER binding instead of creating a def-local shadow (without
    // it: `UnboundLocalError` for read+write, or a silent dead local for
    // write-only). Member/index writes never appear in `writtenFreeNames` —
    // they mutate a captured object by reference and need no `nonlocal`.
    //
    // The eligibility≢lowerability gap (documented on the gate): a write to a
    // PINNED per-iteration capture cannot be lowered. The def-time default-arg
    // pin freezes the value, and a `nonlocal` on that name would rebind the
    // enclosing loop-body binding — neither matches JS's per-iteration
    // by-reference capture. The gate cannot see the enclosing loop from a
    // single statement, so we fail closed LOUDLY here.
    const nonlocalNames: string[] = [];
    for (const name of [...lowered.writtenFreeNames].sort()) {
      if (pinnedNames.has(name)) {
        throw new Error(
          `Closure writes to per-iteration loop capture '${name}', which v1 cannot lower: ` +
            `mutation of a per-iteration loop capture needs cell-boxing (v2). ` +
            `Bind to an outer variable or restructure.`,
        );
      }
      nonlocalNames.push(name);
    }
    // Council's riskiest-thing defensive assertion: a name cannot be both
    // pinned (a per-iteration loop capture → default-arg) AND nonlocal (an
    // outer free write). By construction they are disjoint — pinning requires
    // the binding to resolve AT-OR-INSIDE the outermost loop, while a
    // nonlocal-written name is precisely one that did NOT (the pinned case
    // throws above). If this ever fires, the pin condition and the written-free
    // classification have drifted — a DESIGN error, not a user error.
    for (const name of nonlocalNames) {
      if (pinnedNames.has(name)) {
        throw new Error(
          `Internal codegen invariant violated: '${name}' is both pinned and nonlocal in closure ${closureName}.`,
        );
      }
    }

    const params = [...names, ...pinParams].join(', ');
    // `lowered.lines` are body lines at 4-space indent (the lowerer's own
    // convention); they nest directly under the `def` header. A `nonlocal` line
    // (if any) is the def's FIRST body statement (Python requires it before any
    // use of the name). The declared names are RENAME-RESOLVED — the body's
    // write targets went through `lowerAssignTarget` (same resolver), so the
    // nonlocal declaration, the writes, and the enclosing binding all agree on
    // the renamed Python name for shadow-renamed captures.
    const nonlocalLine =
      nonlocalNames.length > 0
        ? [`    nonlocal ${nonlocalNames.map((n) => resolveLocalRename(ctx, n)).join(', ')}`]
        : [];
    ctx.pendingHoists.push([`def ${closureName}(${params}):`, ...nonlocalLine, ...lowered.lines]);
    return closureName;
  } finally {
    ctx.shadowedSymbols = previous;
  }
}

function valueReferencesIdent(node: ValueIR, name: string): boolean {
  switch (node.kind) {
    case 'ident':
      return node.name === name;
    case 'member':
      return valueReferencesIdent(node.object, name);
    case 'index':
      return valueReferencesIdent(node.object, name) || valueReferencesIdent(node.index, name);
    case 'call':
      return valueReferencesIdent(node.callee, name) || node.args.some((a) => valueReferencesIdent(a, name));
    case 'binary':
      return valueReferencesIdent(node.left, name) || valueReferencesIdent(node.right, name);
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
      return valueReferencesIdent(node.argument, name);
    case 'typeAssert':
    case 'nonNull':
      return valueReferencesIdent(node.expression, name);
    case 'propagate':
      return valueReferencesIdent(node.argument, name);
    case 'conditional':
      return (
        valueReferencesIdent(node.test, name) ||
        valueReferencesIdent(node.consequent, name) ||
        valueReferencesIdent(node.alternate, name)
      );
    case 'tmplLit':
      return node.expressions.some((e) => valueReferencesIdent(e, name));
    case 'objectLit':
      return node.entries.some((entry) => {
        if ('kind' in entry && entry.kind === 'spread') return valueReferencesIdent(entry.argument, name);
        return valueReferencesIdent((entry as { value: ValueIR }).value, name);
      });
    case 'arrayLit':
      return node.items.some((item) => valueReferencesIdent(item, name));
    case 'lambda':
      if (node.params.some((p) => p.name === name)) return false;
      if (node.bodyBlock) return rawBlockReferencesIdent(node.bodyBlock.raw, name);
      return valueReferencesIdent(node.body as ValueIR, name);
    default:
      return false;
  }
}

/** Conservative word-boundary check for an identifier inside a raw closure
 *  block. Used when a block-bodied arrow (slices 0+1) has no expression `body`
 *  to recurse. Over-matching is safe for the capture analyses that consume it. */
function rawBlockReferencesIdent(raw: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(raw);
}

function containsLambdaCapturingIdent(node: ValueIR, name: string): boolean {
  switch (node.kind) {
    case 'lambda':
      if (node.params.some((p) => p.name === name)) return false;
      if (node.bodyBlock) return rawBlockReferencesIdent(node.bodyBlock.raw, name);
      return valueReferencesIdent(node.body as ValueIR, name);
    case 'member':
      return containsLambdaCapturingIdent(node.object, name);
    case 'index':
      return containsLambdaCapturingIdent(node.object, name) || containsLambdaCapturingIdent(node.index, name);
    case 'call':
      return (
        containsLambdaCapturingIdent(node.callee, name) || node.args.some((a) => containsLambdaCapturingIdent(a, name))
      );
    case 'binary':
      return containsLambdaCapturingIdent(node.left, name) || containsLambdaCapturingIdent(node.right, name);
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
      return containsLambdaCapturingIdent(node.argument, name);
    case 'typeAssert':
    case 'nonNull':
      return containsLambdaCapturingIdent(node.expression, name);
    case 'propagate':
      return containsLambdaCapturingIdent(node.argument, name);
    case 'conditional':
      return (
        containsLambdaCapturingIdent(node.test, name) ||
        containsLambdaCapturingIdent(node.consequent, name) ||
        containsLambdaCapturingIdent(node.alternate, name)
      );
    case 'tmplLit':
      return node.expressions.some((e) => containsLambdaCapturingIdent(e, name));
    case 'objectLit':
      return node.entries.some((entry) => {
        if ('kind' in entry && entry.kind === 'spread') return containsLambdaCapturingIdent(entry.argument, name);
        return containsLambdaCapturingIdent((entry as { value: ValueIR }).value, name);
      });
    case 'arrayLit':
      return node.items.some((item) => containsLambdaCapturingIdent(item, name));
    default:
      return false;
  }
}

/** Slice 3d (review fix) — chain-aware lowering for member/call expressions.
 *  Returns `{ guard, expr }` where `guard` is an accumulated `is not None`
 *  test (or `null` if no `?.` appears in the chain) and `expr` is the
 *  unguarded receiver-and-trailing-chain expression.
 *
 *  Codex critical: a single `?.` link must short-circuit the entire trailing
 *  chain, not just the immediate access. `user?.profile.name` lowers to
 *  `(user.profile.name if user is not None else None)`. With the previous
 *  bottom-up emit, only `user?.profile` was guarded and `.name` was
 *  appended outside the conditional, raising `AttributeError` on `None`.
 *
 *  For multi-level optional chains (`a?.b?.c`), each `?.` adds a
 *  short-circuit test against the receiver expression at that point,
 *  combined with `and` so any `None` step short-circuits the whole chain. */
interface GuardedExpr {
  guard: string | null;
  expr: string;
  /** S7 review fix — set ONLY in a comprehension-iterable position (`ctx.banWalrus`)
   *  when a NON-pure optional-chain receiver would otherwise bind via `:=`. CPython
   *  REJECTS the walrus anywhere inside a comprehension iterable expression, so the
   *  receiver is bound as a lambda PARAMETER instead: `wrapGuardIfAny` wraps the whole
   *  guarded conditional in `(lambda <param>: <conditional>)(<arg>)`. The guard and the
   *  branch already reference `<param>` (the bare temp), so single-eval is preserved —
   *  `<arg>` (the receiver) is evaluated exactly once as the call argument. At most one
   *  per chain: a second non-pure link under an existing guard throws (see
   *  `lowerOptionalLink`), so this field is set at most once and propagated unchanged
   *  through the trailing `.prop`/`[idx]`/`(args)` links. */
  lambdaBind?: { param: string; arg: string };
}

/** Slice S7 — the presence test an optional `?.`/`?.[]` link contributes to the
 *  accumulated chain guard. Native (coerce) bodies test against the full nullish
 *  set (`None` AND the undefined sentinel) so `undefined?.x` short-circuits; the
 *  helper-less Ground/React layer keeps the pre-slice `is not None` test (it
 *  never materializes the sentinel). `ref` may itself be a walrus assignment
 *  expression (`(__k_oc1 := f())`), which Python evaluates exactly once. */
function optionalPresenceTest(ref: string, ctx: BodyEmitContext): string {
  if (ctx.coerceJsValues) {
    ctx.helpers.add(KERN_NULLISH_HELPER_PY);
    return `(not _kern_is_nullish(${ref}))`;
  }
  // `x := f() is not None` would bind the BOOLEAN to x; parenthesize a walrus
  // ref so the receiver (not the comparison) is what gets bound.
  const wrapped = ref.includes(':=') ? `(${ref})` : ref;
  return `${wrapped} is not None`;
}

interface OptionalLink {
  guard: string;
  branchRef: string;
  /** See `GuardedExpr.lambdaBind` — set when the walrus is banned (comprehension
   *  iterable position) and a non-pure receiver is bound as a lambda parameter. */
  lambdaBind?: { param: string; arg: string };
}

/** Slice S7 — build the guard + branch-receiver reference for one optional link.
 *  Pure receivers keep the readable double-name form (named in both the guard
 *  and the branch — re-evaluation is side-effect-free). A NON-pure receiver is
 *  bound ONCE via the S4 walrus idiom: the guard carries `(__k_ocN := RECV)` so
 *  the side effect runs exactly once, and the branch references the bound name.
 *  A non-pure receiver that is ITSELF an optional chain (`inner.guard !== null`)
 *  cannot host the walrus and still throws — bind it to a `let` first. */
function lowerOptionalLink(inner: GuardedExpr, objectNode: ValueIR, ctx: BodyEmitContext): OptionalLink {
  const pure = isReceiverChainPure(objectNode);
  if (pure) {
    const presence = optionalPresenceTest(inner.expr, ctx);
    return {
      guard: inner.guard === null ? presence : `${inner.guard} and ${presence}`,
      branchRef: inner.expr,
    };
  }
  if (inner.guard !== null) {
    throw new Error(
      "Optional chain '?.' on Python target requires a side-effect-free receiver (identifier or pure member chain). " +
        'Bind the call/await result to a `let` first, then use `let.field?.next` on the bound name.',
    );
  }
  const tmp = `__k_oc${++ctx.gensymCounter}`;
  if (ctx.banWalrus) {
    // Comprehension-iterable position (see BodyEmitContext.banWalrus): CPython
    // rejects the `:=` walrus anywhere inside a comprehension iterable, so the
    // non-pure receiver cannot be bound via `(__k_ocN := RECV)`. Bind it as a
    // lambda PARAMETER instead — the presence test + branch reference the bare
    // `__k_ocN` (the parameter), and `wrapGuardIfAny` wraps the whole guarded
    // conditional in `(lambda __k_ocN: <conditional>)(RECV)`. Same contract as
    // the walrus form: RECV evaluated exactly once (as the call argument), the
    // short-circuit branch yields the sentinel, single-eval preserved.
    const presence = optionalPresenceTest(tmp, ctx);
    return { guard: presence, branchRef: tmp, lambdaBind: { param: tmp, arg: inner.expr } };
  }
  const presence = optionalPresenceTest(`${tmp} := ${inner.expr}`, ctx);
  return { guard: presence, branchRef: tmp };
}

type ChainNode = Extract<ValueIR, { kind: 'member' | 'call' | 'index' }>;

function lowerChain(node: ChainNode, ctx: BodyEmitContext): GuardedExpr {
  if (node.kind === 'member') {
    const obj = node.object;
    // Slice 2 — a bare property READ on a DIRECT regex LITERAL (`/x/.source`,
    // `/x/.flags`) launders the pattern/flags back into a string. Routed through
    // the SHARED classifier (via the ValueIR adapter) so this site agrees with
    // the TS emit + IR-validate legs and the closure walk BY CONSTRUCTION. The
    // portable METHODS (.test/.exec/…) are CALLS routed by the call path before
    // reaching here, and a LET-BOUND regex read (`r.source`) has an `ident`
    // object (owned by Slice 3), so only a direct literal read is closed here.
    // The receiver is UNWRAPPED first so a wrapped read `(/x/ as any).source` /
    // `(/x/!).source` fails-close identically to the bare `/x/.source` and to the
    // TS-emit + IR-validate legs (round-5 wrapped-receiver fix).
    if (regexLiteralReceiverIR(obj) !== null) {
      const message = classifyRegexLiteralMemberReadFailClose(node);
      if (message !== null) throw new Error(message);
    }
    const stdlibProperty = applyStdlibPropertyLoweringPython(node, ctx);
    if (stdlibProperty !== null) return { guard: null, expr: stdlibProperty };
    // Slice H — fail-closed on an UNMAPPED host-namespace member READ. Covers
    // host CONSTANT reads such as `Math.PI` / `process.env` that are not a call
    // (the call path guards `Root.member(args)` separately, before descending
    // here). Only a DIRECT `Root.member` read is inspected: `obj.kind ===
    // 'ident'`. A host-namespace-shaped, not-user-bound root throws; user
    // receivers (`user.profile`) and proven-local roots pass through. A host
    // CALL's callee never reaches this read guard with a host root — the call
    // path already threw — so this only ever fires on genuine reads.
    if (obj.kind === 'ident') {
      rejectUnmappedHostNamespacePython(obj.name, node.property, ctx);
    }
    // S5 review fix — a NON-CHAIN root that lowers to a compound expression
    // must be parenthesized before `.${property}` is appended: a bare ternary
    // root (`b if t else c`) would otherwise bind the member to its LAST
    // operand only (`b if t else c.prop` — silently wrong Python). Same
    // precedence set as index receivers; lowerings that already emit a
    // self-delimited atom (`(walrus ternary)`, `__kern_add(a, b)`) stay bare.
    const inner: GuardedExpr =
      obj.kind === 'member' || obj.kind === 'call' || obj.kind === 'index'
        ? lowerChain(obj, ctx)
        : { guard: null, expr: wrapCompoundRootExpr(obj, emitPyExprCtx(obj, ctx)) };
    // Portable Array *property* read (non-call `.length`) lowers through the
    // SAME shared list-ops hook the route emitter uses, so `this.items.length`
    // emits `len(self.items)` (not invalid `self.items.length`) — identical to
    // a route handler's `arr.length` by construction. Only the trailing `.prop`
    // link is rewritten; the accumulated optional-chain guard is left UNTOUCHED
    // and still flows through `wrapGuardIfAny`, so `items?.length` stays
    // `(len(items) if items is not None else None)`-shaped.
    if (node.optional) {
      // Slice S7 — single-eval optional `?.`. A pure receiver may be named twice
      // (guard + branch) with no observable effect, so it keeps the readable
      // double-name form. A NON-pure receiver (e.g. `markReceiver(null)?.x`) is
      // bound ONCE via the S4 walrus idiom so its side effect runs exactly once;
      // the BOUND name is then used in both the guard's presence test and the
      // trailing link. Only a single optional link can host the walrus (the
      // receiver is not itself an optional chain ⇒ `inner.guard === null`); a
      // non-pure receiver UNDER an existing optional chain still throws below.
      const opt = lowerOptionalLink(inner, node.object, ctx);
      const linkExpr = isSharedPortableArrayProperty(node.property)
        ? (lowerPortableArrayPropertyPy(opt.branchRef, node.property) ?? `${opt.branchRef}.${node.property}`)
        : `${opt.branchRef}.${node.property}`;
      return { guard: opt.guard, expr: linkExpr, lambdaBind: opt.lambdaBind };
    }
    const linkExpr = isSharedPortableArrayProperty(node.property)
      ? (lowerPortableArrayPropertyPy(inner.expr, node.property) ?? `${inner.expr}.${node.property}`)
      : `${inner.expr}.${node.property}`;
    return { guard: inner.guard, expr: linkExpr, lambdaBind: inner.lambdaBind };
  }
  if (node.kind === 'index') {
    const obj = node.object;
    // Slice 2 review fix — the bracket (`index`) form of a regex-literal
    // property access (`/x/["source"]`, `/x/["flags"]`, `/x/["test"](s)`)
    // launders the pattern/flags back to a string exactly like the dotted
    // `/x/.source` member form, so it fails-close identically and BEFORE the
    // host-ident guard below. A STRING-literal index goes through the same
    // (empty) portable-property allowlist; a COMPUTED / non-literal index is
    // unknowable and also fails-close. Mirrors the TS emit + IR-validate index
    // screens — byte-identical regex message across all three legs. The receiver
    // is UNWRAPPED first so a wrapped bracket read `(/x/!)["source"]` /
    // `(/x/ as any)["test"](s)` fails-close identically (round-5 wrapped fix).
    if (regexLiteralReceiverIR(obj) !== null) {
      // Routed through the SHARED classifier (a STRING index classifies like the
      // dotted read; a COMPUTED index is unknowable → fail-close), byte-identical
      // to the TS emit + IR-validate index screens and the closure walk.
      const message = classifyRegexLiteralIndexReadFailClose(node);
      if (message !== null) throw new Error(message);
    }
    // Slice H review fix — bracket access must not bypass the fail-closed
    // guard: `Math["sqrt"]` / `Math["sqrt"](x)` is the same unmapped
    // host-namespace access as `Math.sqrt`, only spelled as an index node.
    // Call chains descend through this branch too, so this one site covers
    // both the read and the call form. Non-literal keys (`Math[k]`) are just
    // as unmapped — the label degrades to `[computed]`.
    if (obj.kind === 'ident') {
      const label = node.index.kind === 'strLit' ? node.index.value : '[computed]';
      rejectKnownStdlibIndexPython(obj.name, label);
      rejectUnmappedHostNamespacePython(obj.name, label, ctx);
    }
    const inner: GuardedExpr =
      obj.kind === 'member' || obj.kind === 'call' || obj.kind === 'index'
        ? lowerChain(obj, ctx)
        : { guard: null, expr: emitPyExprCtx(obj, ctx) };
    const index = emitPyExprCtx(node.index, ctx);
    if (node.optional) {
      // Slice S7 — single-eval optional `?.[]` (same walrus discipline as `?.`).
      // A non-pure receiver is bound once; the index expression appears only in
      // the selected branch, matching JS `?.[]`.
      const opt = lowerOptionalLink(inner, node.object, ctx);
      return { guard: opt.guard, expr: `${opt.branchRef}[${index}]`, lambdaBind: opt.lambdaBind };
    }
    const wrapped = needsIndexReceiverParens(node.object) ? `(${inner.expr})` : inner.expr;
    return { guard: inner.guard, expr: `${wrapped}[${index}]`, lambdaBind: inner.lambdaBind };
  }
  // node.kind === 'call'
  if (node.optional) {
    throw new Error(
      "Optional call '?.()' is not yet supported on Python target. " +
        'Bind the function reference to a `let` first, then test for `none` before calling.',
    );
  }
  // Slice 2a — KERN-stdlib dispatch must run on a top-level Module.method
  // call BEFORE we descend into the callee chain, so `Number.floor(x)`
  // doesn't degrade into a non-stdlib `Number.floor(x)` Python emit.
  const regex = lowerRegexCallPython(node, ctx);
  if (regex !== null) return { guard: null, expr: regex };
  const stdlib = applyStdlibLoweringPython(node, ctx);
  if (stdlib !== null) return { guard: null, expr: stdlib };
  // Lambda-bearing array methods (`map`/`filter`/`some`/`every`) lower to a
  // call-by-name comprehension. Peeked BEFORE the portable-array shim because
  // none of these four are in that shim's set; gating here keeps the two paths
  // independent and lets a non-matching shape fall through unchanged.
  const lambdaArray = lowerLambdaArrayCallPython(node, ctx);
  if (lambdaArray !== null) return { guard: null, expr: lambdaArray };
  // Portable array methods (e.g. `arr.push(x)`) lower through the SAME shared
  // helper the route emitter uses, so a class method's `this.items.push(x)`
  // matches a route handler's `arr.push(x)` by construction (no per-path drift).
  const portableArray = lowerPortableArrayCallPython(node, ctx);
  if (portableArray !== null) return { guard: null, expr: portableArray };
  if (ctx.inConstructor && node.callee.kind === 'ident' && node.callee.name === 'super') {
    const superArgs = node.args.map((arg) => emitPyExprCtx(arg, ctx)).join(', ');
    return { guard: null, expr: `super().__init__(${superArgs})` };
  }
  if (node.callee.kind === 'ident' && node.callee.name === 'String') {
    if (node.args.length !== 1) {
      throw new Error('String() portable coercion expects exactly one argument on Python target.');
    }
    const arg = emitPyExprCtx(node.args[0], ctx);
    if (ctx.standaloneExpression) return { guard: null, expr: inlineKernFmtPy(arg) };
    ctx.helpers.add(KERN_FMT_HELPER_PY);
    return { guard: null, expr: `_kern_fmt(${arg})` };
  }
  // Host Error mapping, call-without-new form: JS `Error("x")` (no `new`)
  // constructs an error too — remap like `new Error(...)`, else it emits a
  // bare `Error(...)` NameError on Python (agon review, kimi 0.7). The same
  // documented user-class-named-Error shadowing edge applies (v2 hardening).
  if (node.callee.kind === 'ident' && node.callee.name === 'Error') {
    const errArgs = node.args.map((arg) => emitPyExprCtx(arg, ctx)).join(', ');
    return { guard: null, expr: `Exception(${errArgs})` };
  }
  // Slice 2 — a bare `RegExp(p, f)` call (callee is an ident, missed by the
  // member-callee guard below) fails-close with the shared regex message,
  // BEFORE generic call emission would leak a verbatim `RegExp(...)` NameError.
  // Honors user shadowing via `isProvenUserBinding`.
  if (node.callee.kind === 'ident') {
    rejectHostRegExpValuePython(node.callee.name, ctx);
  }
  // DECIMAL Slice 1 — bare `Decimal(...)` (ident callee) fail-closes
  // SYMMETRICALLY with the TS leg. Only `Decimal.of`/`Decimal.add` (member
  // callees, handled by `applyStdlibLoweringPython` above) are portable. A
  // proven user binding named `Decimal` is left alone.
  if (node.callee.kind === 'ident' && node.callee.name === 'Decimal' && !isProvenUserBinding(ctx, 'Decimal')) {
    throw new Error(decimalBareConstructionFailMessage());
  // Slice H — fail-closed on an UNMAPPED host-namespace member CALL. This runs
  // AFTER every explicit lowering hook above (stdlib, regex, lambda/array,
  // portable-array, super/String/Error) and BEFORE generic call emission, so a
  // `Root.member(args)` call whose root is host-namespace-shaped and not proven
  // user-bound throws the portable-lowering diagnostic instead of leaking
  // invalid verbatim Python (`Math.sqrt(x)` → runtime NameError). Canonical
  // KERN stdlib roots (`Number`/`Json`/…) already returned via the stdlib hook,
  // so they never reach here; user receivers (`client.send(...)`) and a
  // proven-local `Math` are not host-namespace-shaped / are user-bound and pass
  // through. Capitalization-agnostic: equally catches `console.log(...)`,
  // `Promise.all(...)`, and lowercase host roots such as `process.env`.
  if (node.callee.kind === 'member' && node.callee.object.kind === 'ident') {
    rejectUnmappedHostNamespacePython(node.callee.object.name, node.callee.property, ctx);
  }
  const callee = node.callee;
  const inner: GuardedExpr =
    callee.kind === 'member' || callee.kind === 'call' || callee.kind === 'index'
      ? lowerChain(callee, ctx)
      : { guard: null, expr: emitPyExprCtx(callee, ctx) };
  const args = node.args.map((a) => emitPyExprCtx(a, ctx)).join(', ');
  return { guard: inner.guard, expr: `${inner.expr}(${args})`, lambdaBind: inner.lambdaBind };
}

/**
 * Lower a portable Array *method call* (e.g. `arr.push(x)`) through the shared
 * `list-ops` module, so a class-method body and a route handler lower the same
 * portable subset to identical Python. Returns `null` — and the caller falls
 * through to the generic call emission — for anything that is not a bare,
 * non-optional member call of a shared portable method on a guard-free
 * receiver. Mirrors the peek-then-emit shape of `lowerRegexCallPython`.
 */
function lowerPortableArrayCallPython(call: Extract<ValueIR, { kind: 'call' }>, ctx: BodyEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member' || callee.optional) return null;
  // Gate on method name BEFORE emitting receiver/args, so a non-shared call
  // falls through without any duplicated emission. Arity is NOT gated here —
  // the shared `lowerPortableArrayMethodPy` validates the arg count per method
  // (push/concat are single-arg, slice takes 0/1/2) and returns null for shapes
  // it can't lower, so a malformed call falls through unchanged. A blanket
  // `args.length !== 1` guard here would have wrongly blocked `slice()` /
  // `slice(1, 3)` (a push-shaped assumption — see spec 3a).
  if (!isSharedPortableArrayMethod(callee.property)) return null;
  const recvNode = callee.object;
  // Per-method purity contract (scalar-method sweep). Multi-eval / mutating
  // methods (push/reverse/at/lastIndexOf) name the receiver more than once
  // (`(recv.append(x) or len(recv))`, `(recv.reverse() or recv)`), so a
  // side-effectful receiver — `makeBag().items.push(x)`, `bags[idx()].reverse()`
  // — would run those effects twice on Python and break JS parity; lower only a
  // provably-pure receiver for those. Single-eval methods
  // (slice/includes/indexOf/join/flat/concat/fill) name the receiver once, so they
  // accept an impure receiver — the old blanket `isReceiverChainPure` guard
  // wrongly skipped `makeBox().items.slice(1)` (the prior agon-review 0.97
  // finding). The optional-chain guard below still applies to ALL methods.
  if (sharedPortableMethodRequiresPureReceiver(callee.property) && !isReceiverChainPure(recvNode)) return null;
  // S5 review fix — these list-ops lowerings embed the receiver in a
  // comprehension/generator ITERABLE (`join`: `str(__v) for __v in <recv>`;
  // `flat`: `for __x in <recv>`; `indexOf`: `enumerate(<recv>)` inside a
  // genexp), where CPython rejects `:=` outright. Emit the receiver under the
  // walrus ban AND parenthesize compound receivers (a bare ternary in a
  // generator head reads its `if` as the comprehension filter — SyntaxError).
  const embedsReceiverInGenexp =
    callee.property === 'join' || callee.property === 'flat' || callee.property === 'indexOf';
  const emitRecv = (): GuardedExpr =>
    recvNode.kind === 'member' || recvNode.kind === 'call' || recvNode.kind === 'index'
      ? lowerChain(recvNode, ctx)
      : { guard: null, expr: emitPyExprCtx(recvNode, ctx) };
  const recv: GuardedExpr = embedsReceiverInGenexp ? withWalrusBan(ctx, emitRecv) : emitRecv();
  // A pure receiver can still be an optional chain (`a?.b`), which carries a
  // None-guard the flat shim can't honor — fall through for those too.
  if (recv.guard !== null) return null;
  const recvExpr = embedsReceiverInGenexp ? parenthesizeIterable(recv.expr) : recv.expr;
  const args = call.args.map((a) => (callee.property === 'fill' ? emitPyArrayFillArg(a, ctx) : emitPyExprCtx(a, ctx)));
  const lowered = lowerPortableArrayMethodPy(recvExpr, callee.property, args, { sentinelMiss: ctx.coerceJsValues });
  if (lowered !== null && callee.property === 'fill') {
    ctx.helpers.add(KERN_JS_ARRAY_HELPERS_PY);
  }
  // Slice S7 — `Array.at` out-of-range yields the undefined sentinel in value
  // mode; register the helper that defines `_KERN_UNDEFINED`.
  if (lowered !== null && callee.property === 'at' && ctx.coerceJsValues) {
    ctx.helpers.add(KERN_NULLISH_HELPER_PY);
  }
  return lowered;
}

function emitPyArrayFillArg(node: ValueIR, ctx: BodyEmitContext): string {
  if (node.kind === 'undefLit') return '_KERN_UNDEFINED';
  return emitPyExprCtx(node, ctx);
}

/** Methods this peek lowers to a call-by-name comprehension. `reduce`/
 *  `reduceRight` share the call-by-name callback resolution but lower to
 *  `functools.reduce` (a different arg-count/arity contract), so they live in
 *  `REDUCE_ARRAY_METHODS` and route through `lowerReduceArrayCallPython`.
 *  `sort`-with-comparator remains DEFERRED (see slice report). */
const LAMBDA_ARRAY_METHODS: ReadonlySet<string> = new Set([
  'map',
  'filter',
  'some',
  'every',
  // find-family + flatMap: same call-by-name comprehension architecture as
  // map/filter (callback 1 or 2 params; the 2-param form binds the index via
  // enumerate). The find-family wraps the predicate in `js_truthy`.
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
]);

/** reduce/reduceRight take a callback of EXACTLY 2 params (acc, cur) and the
 *  CALL itself carries 1 arg (cb) or 2 (cb, seed) — a different arg-count and
 *  callback-arity contract than the enumerate-comprehension methods above, so
 *  they are dispatched on their own path inside `lowerLambdaArrayCallPython`. */
const REDUCE_ARRAY_METHODS: ReadonlySet<string> = new Set(['reduce', 'reduceRight']);

/**
 * Lower a lambda-bearing Array method call (`recv.map(cb)` / `.filter` / `.some`
 * / `.every`) on the class/native-body Python path to a call-by-name
 * comprehension. Returns `null` — and the caller falls through to the generic
 * call emission — for any shape this peek does not own. Peeked at the same
 * dispatch point as `lowerPortableArrayCallPython` (these four methods are NOT
 * in that shim's set).
 *
 * GATE (all required): a non-optional `member` callee, method ∈
 * {map,filter,some,every}, exactly one call arg, and that arg is a `lambda`
 * (expression- or block-bodied) OR a bare `ident`.
 *
 * Callback shapes resolved to a Python NAME `cb`:
 *   - block lambda  → `emitPyExprCtx` returns the hoisted `def __kern_closure_N`
 *                     name (closures v1), and the def is pushed into
 *                     `ctx.pendingHoists` (flushed by emitChildrenPy before the
 *                     enclosing statement).
 *   - expr  lambda  → emit `lambda x: <expr>`, hoist ONE assignment
 *                     `__kern_cb_N = <lambda>` into the SAME `ctx.pendingHoists`
 *                     buffer; `cb` = `__kern_cb_N`.
 *   - bare ident    → the rename-resolved identifier as-is. Arity is unknown for
 *                     a named callback, so it is always called single-arg. JS
 *                     would pass `(el, idx, arr)`; a named callback that reads a
 *                     2nd/3rd param diverges — an ACCEPTED edge for this slice.
 *
 * MEMBER-EXPRESSION callbacks (`this.items.map(this.fmt)`) FALL THROUGH verbatim
 * (the arg is a `member`, not `lambda`/`ident`, so the gate rejects it). This is
 * deliberate: JS `.map(this.fmt)` passes the method UNBOUND (`this` is undefined
 * inside it), so the TS target is already broken for such code. Lowering it on
 * Python would create works-on-Python / breaks-on-TS anti-parity; until KERN
 * defines a bound-method story there is nothing to be parity-correct WITH.
 *
 * TRUTHINESS: filter/some/every wrap the predicate result in `js_truthy(...)`.
 * This is JS-CORRECT — JS keeps `[]`/`{}` truthy while bare Python drops them.
 * Two VERIFIED pre-existing divergences are intentionally NOT fixed here:
 *   (1) the ROUTE path's filter/find-family predicates are BARE (`if ${body}`,
 *       core/expr/index.ts ~:294) — a pre-existing route truthiness bug, a
 *       follow-up for the deferral-sweep slice;
 *   (2) the class path's `if cond=` lowering is bare (no js_truthy wrapper) — a
 *       separate follow-up.
 * `js_truthy` here matches JS semantics for the lambda-array predicates only.
 */
function lowerLambdaArrayCallPython(call: Extract<ValueIR, { kind: 'call' }>, ctx: BodyEmitContext): string | null {
  // SCOPE GATE (do not remove). This lowering is for the class/native-body
  // statement path (`emitNativeKernBodyPythonWithImports`, standaloneExpression
  // = false). The standalone-expression entry point (`emitPyExpression`) is the
  // Ground/React declarative + expression-unit surface; it emits array methods
  // VERBATIM (e.g. `values.filter(lambda value: ...)`) by design, so do NOT
  // intercept there. The FastAPI ROUTE path lowers `.map`/`.filter` through a
  // SEPARATE string-rewrite (`core/expr` `rewriteExpr`/`lowerJsArrayMethods`),
  // never this IR `lowerChain` peek, so routes are untouched.
  if (ctx.standaloneExpression) return null;
  const callee = call.callee;
  if (callee.kind !== 'member' || callee.optional) return null;
  const method = callee.property;
  const isReduce = REDUCE_ARRAY_METHODS.has(method);
  if (!LAMBDA_ARRAY_METHODS.has(method) && !isReduce) return null;

  // reduce/reduceRight have a DISTINCT contract (callback EXACTLY 2 params; the
  // call carries 1 arg [cb] or 2 [cb, seed]) and lower to `functools.reduce`,
  // not a comprehension. Handle them on their own path before the shared
  // enumerate-comprehension machinery below. `callee.object` is the receiver.
  if (isReduce) return lowerReduceArrayCallPython(call, callee.object, method, ctx);

  if (call.args.length !== 1) return null;
  const arg = call.args[0];
  if (arg.kind !== 'lambda' && arg.kind !== 'ident') return null;

  // Resolve the callback to a NAME. For a lambda the arg arity decides the
  // comprehension form (enumerate when 2 params); a bare ident is arity-unknown
  // and always called single-arg (documented divergence above).
  let cb: string;
  let twoArity = false;
  if (arg.kind === 'lambda') {
    // The enumerate comprehension only supplies (el, i); a callback declaring a
    // 3rd param (`(el, i, arr) => …`) would be DEFINED with 3 params but CALLED
    // with 2 → runtime TypeError. Fall through verbatim (the pre-slice status quo
    // for that shape) rather than emit a broken lowering.
    if (arg.params.length > 2) return null;
    twoArity = arg.params.length >= 2;
    const emitted = emitLambdaPy(arg, ctx);
    if (arg.bodyBlock) {
      // Block lambda → `emitLambdaPy` already pushed the hoisted def and
      // returned its bare name; use it directly as the callback name.
      cb = emitted;
    } else {
      // Expression lambda → `emitted` is a `lambda x: <expr>`. Hoist ONE
      // assignment into the SAME buffer as closure defs (flushed before the
      // enclosing statement) and call it by name, so the comprehension names
      // the callback exactly once.
      cb = `__kern_cb_${ctx.closureSeq++}`;
      ctx.pendingHoists.push([`${cb} = ${emitted}`]);
    }
  } else {
    // Bare LOCAL ident callback (`let f = …; recv.map(f)`). Emit through the
    // ident path so a renamed binding resolves to its Python name.
    cb = emitPyExprCtx(arg, ctx);
  }

  // Receiver: lowered ONCE. Every template below names `recv` EXACTLY ONCE, so
  // there is NO purity gate here (deliberate contrast with the multi-eval
  // list-ops methods, which DO gate — see `lowerPortableArrayCallPython`).
  // FUTURE READER: do not add a redundant `isReceiverChainPure` gate; the
  // single-eval property is what makes M6 (`this.bump().map(...)` runs bump()
  // exactly once) correct.
  const recvNode = callee.object;
  // S5 review fix — the receiver lands in the comprehension's generator head
  // (`for el in <recv>`), where CPython rejects `:=` at any nesting depth, so
  // it is emitted under the walrus ban (logical/nullish/typeof producers at
  // any depth switch to their lambda-parameter forms).
  const recv: GuardedExpr = withWalrusBan(ctx, () =>
    recvNode.kind === 'member' || recvNode.kind === 'call' || recvNode.kind === 'index'
      ? lowerChain(recvNode, ctx)
      : { guard: null, expr: emitPyExprCtx(recvNode, ctx) },
  );
  // An optional-chain receiver (`a?.b`) carries a None-guard the comprehension
  // can't honor — fall through unchanged for those.
  if (recv.guard !== null) return null;
  // A compound receiver (a ternary `xs if c else ys`, a binary expression)
  // dropped bare into a generator head parses WRONG: Python reads the `if`
  // as the comprehension filter (`for el in xs if c else ys` → SyntaxError) —
  // agon review, agy 1.0. Call-arg positions (`enumerate(recv)`) are immune;
  // the bare `for … in recv` heads and `recv[::-1]` are not. Space-heuristic
  // parens: atoms (`self.items`, `makeBox().items`, `[1, 2]`?) — note a
  // bracketed literal contains ', ' but leading `[`/`(` already self-delimits;
  // anything else with top-level spaces gets wrapped. Parens are never wrong,
  // the heuristic only preserves byte-identical output for the common shapes.
  const recvExpr = parenthesizeIterable(recv.expr);

  // Hygienic loop vars, fresh per call.
  const seq = ctx.gensymCounter++;
  const el = `__kern_el_${seq}`;
  const ix = `__kern_ix_${seq}`;
  const callCb = twoArity ? `${cb}(${el}, ${ix})` : `${cb}(${el})`;
  const head = twoArity ? `for ${ix}, ${el} in enumerate(${recvExpr})` : `for ${el} in ${recvExpr}`;

  if (method === 'map') {
    return `[${callCb} ${head}]`;
  }
  if (method === 'flatMap') {
    // map, then flatten ONE level — JS flatMap only flattens arrays, so a
    // scalar/string callback result is appended as a single element. The
    // callback is bound to a fresh `__kern_r_N` via a one-element `for`, so it
    // is called EXACTLY ONCE per element. This is deliberately BETTER than the
    // FastAPI route's body-substitution lowering (core/expr/index.ts ~:336),
    // which textually re-emits the callback body twice (`__x` substituted in
    // both the isinstance test and the fallback) and double-evaluates a
    // side-effecting callback — a tracked route follow-up. flatMap has no
    // predicate, so NO js_truthy here.
    const r = `__kern_r_${seq}`;
    const y = `__kern_y_${seq}`;
    return `[${y} ${head} for ${r} in [${callCb}] for ${y} in (${r} if isinstance(${r}, list) else [${r}])]`;
  }
  // filter + find-family predicates wrap in `js_truthy` (JS-correct; map/flatMap
  // do not need it). The helper lands once via the helper Set.
  ctx.helpers.add(KERN_JS_HELPER_PY);
  if (method === 'filter') {
    return `[${el} ${head} if js_truthy(${callCb})]`;
  }
  if (method === 'some') {
    return `any(js_truthy(${callCb}) ${head})`;
  }
  if (method === 'every') {
    return `all(js_truthy(${callCb}) ${head})`;
  }
  // find-family — `next((<gen>), <miss>)` never raises. find/findLast yield the
  // ELEMENT (miss → None); findIndex/findLastIndex yield the INDEX (miss → -1).
  // The *Last variants scan a reversed view; with a 2-param callback the index
  // must come from enumerate, so they reverse `list(enumerate(recv))` (mirrors
  // the route's findLast/findLastIndex shape).
  if (method === 'find') {
    return `next((${el} ${head} if js_truthy(${callCb})), None)`;
  }
  if (method === 'findIndex') {
    // The index is always bound here, so iterate enumerate(recv) even for a
    // 1-param callback (which is called single-arg on the element).
    const enumHead = `for ${ix}, ${el} in enumerate(${recvExpr})`;
    return `next((${ix} ${enumHead} if js_truthy(${callCb})), -1)`;
  }
  if (method === 'findLast') {
    const revHead = twoArity
      ? `for ${ix}, ${el} in reversed(list(enumerate(${recvExpr})))`
      : `for ${el} in reversed(${recvExpr})`;
    return `next((${el} ${revHead} if js_truthy(${callCb})), None)`;
  }
  // method === 'findLastIndex'
  const revIndexHead = `for ${ix}, ${el} in reversed(list(enumerate(${recvExpr})))`;
  return `next((${ix} ${revIndexHead} if js_truthy(${callCb})), -1)`;
}

/** Lower `recv.reduce(cb)` / `.reduce(cb, seed)` / `.reduceRight(...)` on the
 *  class/native-body Python path to `functools.reduce`. Returns `null` (caller
 *  falls through to verbatim emission) for any shape this peek does not own.
 *
 *  CONTRACT (all required): a non-optional `member` callee already checked by
 *  the caller; the call carries 1 arg (cb) or 2 (cb, seed); the callback is a
 *  `lambda` with EXACTLY 2 params (acc, cur) OR a bare `ident` (arity unknown —
 *  accepted, called with two args by functools.reduce). A 1- or 3+-param lambda
 *  callback (e.g. an idx-reading `(a, c, i) =>`) FALLS THROUGH verbatim (status
 *  quo) rather than emit a callback functools.reduce would call with the wrong
 *  arity.
 *
 *  JS `reduce((acc, cur) => …)` arg order == `functools.reduce(fn(acc, cur), …)`,
 *  so NO adaptation is needed (asserted by the order-sensitive FR7 fixture).
 *  reduceRight is the same callback over the reversed sequence (`recv[::-1]`).
 *
 *  PARITY NOTE: JS `[].reduce(cb)` (no seed, empty array) throws TypeError;
 *  Python `functools.reduce(cb, [])` raises TypeError too — same failure mode,
 *  documented parity (not a divergence).
 *
 *  IMPORT: `functools` is registered via `ctx.imports.add('functools')`, which
 *  the fn/method generators render as `import functools as __k_functools` (the
 *  same alias convention as `re` → `__k_re`); the template names
 *  `__k_functools.reduce`. The Set dedupes, so the import lands exactly once per
 *  body. (The FastAPI route path uses a SEPARATE imports channel that emits a
 *  bare `import functools`; this class path is untouched by that.) */
function lowerReduceArrayCallPython(
  call: Extract<ValueIR, { kind: 'call' }>,
  recvNode: ValueIR,
  method: string,
  ctx: BodyEmitContext,
): string | null {
  if (call.args.length !== 1 && call.args.length !== 2) return null;
  const cbArg = call.args[0];
  if (cbArg.kind !== 'lambda' && cbArg.kind !== 'ident') return null;
  // Member-expression callbacks fall through verbatim (same unbound-this policy
  // as the comprehension methods) — the gate above already rejects them.

  let cb: string;
  if (cbArg.kind === 'lambda') {
    // EXACTLY 2 params (acc, cur). A 1-param or 3+-param (idx-reading) callback
    // would be mis-called by functools.reduce — fall through verbatim.
    if (cbArg.params.length !== 2) return null;
    const emitted = emitLambdaPy(cbArg, ctx);
    if (cbArg.bodyBlock) {
      // Block lambda → hoisted def name from emitLambdaPy; use it directly.
      cb = emitted;
    } else {
      // Expression lambda → hoist `__kern_cb_N = lambda a, c: <expr>` and pass
      // the name, so functools.reduce names the callback exactly once.
      cb = `__kern_cb_${ctx.closureSeq++}`;
      ctx.pendingHoists.push([`${cb} = ${emitted}`]);
    }
  } else {
    // Bare LOCAL ident callback — resolve through the ident path.
    cb = emitPyExprCtx(cbArg, ctx);
  }

  // Receiver: lowered ONCE (same single-eval property as the comprehension
  // methods — no purity gate). `recvNode` is the caller's already-narrowed
  // `callee.object`.
  const recv: GuardedExpr =
    recvNode.kind === 'member' || recvNode.kind === 'call' || recvNode.kind === 'index'
      ? lowerChain(recvNode, ctx)
      : { guard: null, expr: emitPyExprCtx(recvNode, ctx) };
  if (recv.guard !== null) return null;
  // reduceRight reverses the sequence; reduce uses it as-is. The slice binds
  // TIGHTER than ternary/binary receivers (`xs if c else ys[::-1]` slices only
  // `ys` — agon review, agy 1.0), so the receiver is parenthesized when
  // compound. The plain-reduce position is a call argument (self-delimiting),
  // but wrap uniformly so both methods agree on the receiver text.
  const recvExpr = parenthesizeIterable(recv.expr);
  const seq = method === 'reduceRight' ? `${recvExpr}[::-1]` : recvExpr;

  ctx.imports.add('functools');
  if (call.args.length === 2) {
    const seed = emitPyExprCtx(call.args[1], ctx);
    return `__k_functools.reduce(${cb}, ${seq}, ${seed})`;
  }
  return `__k_functools.reduce(${cb}, ${seq})`;
}

/** Parenthesize a lowered receiver for generator-head (`for el in <recv>`) and
 *  slice (`<recv>[::-1]`) positions, where a compound expression parses wrong
 *  (a bare ternary's `if` reads as the comprehension filter — SyntaxError; a
 *  slice binds only the rightmost operand). Space heuristic: an expression
 *  with no top-level spaces is an atom/chain (`self.items`, `makeBox().items`,
 *  `xs[1:]`) and stays bare (byte-identical to pre-fix output); one that
 *  starts with a self-delimiting bracket also stays bare; anything else wraps.
 *  Parens are never semantically wrong — the heuristic only preserves
 *  idiomatic output for the common shapes. */
function parenthesizeIterable(expr: string): string {
  if (!expr.includes(' ')) return expr;
  // A leading bracket is only self-delimiting if it CLOSES at the very end
  // (`[1, 2, 3]` yes; `[1] if c else [2]` no — same opener, not enclosing).
  const open = expr[0];
  const close = open === '[' ? ']' : open === '(' ? ')' : open === '{' ? '}' : null;
  if (close !== null && expr[expr.length - 1] === close) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[' || ch === '(' || ch === '{') depth++;
      else if (ch === ']' || ch === ')' || ch === '}') {
        depth--;
        // Depth returns to 0 before the end → the leading bracket does NOT
        // enclose the whole expression.
        if (depth === 0 && i < expr.length - 1) return `(${expr})`;
      }
    }
    if (depth === 0) return expr;
  }
  return `(${expr})`;
}

function lowerRegexCallPython(call: Extract<ValueIR, { kind: 'call' }>, ctx: BodyEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;

  // Slice-3b FIX 4 (parity): a call whose receiver is a KERN-stdlib NAMESPACE
  // (`Math.match(/a/g)`, `JSON.split(/,/)`) is NOT a string regex method —
  // defer to `applyStdlibLoweringPython`, which rejects the unknown stdlib
  // member exactly like the TS emitter (where `applyStdlibLoweringTS` runs
  // BEFORE the regex lowering). Without this, the regex path mis-claimed the
  // namespace as the SUBJECT and emitted broken `…finditer("a", Math, …)`
  // while TS fail-closed — a cross-target divergence.
  if (callee.object.kind === 'ident' && KERN_STDLIB_MODULES.has(callee.object.name)) {
    return null;
  }

  // Slice-3c DETECT-and-fail-close: a regex method whose regex position holds an
  // ident KNOWN to be regex-bound (`let re = /…/; s.match(re)`) is NOT portable —
  // throw the SAME shared `REGEX_NONLITERAL_FAILCLOSE` the TS target throws (see
  // `assertNoBoundRegexMethodTS` in body-ts.ts). A string-/unknown-bound ident is
  // NOT flagged: it falls through to the plain host method below (`s.match(needle)`).
  const regexArgIdent = regexMethodRegexArgIdent(call);
  if (regexArgIdent !== null && lookupRegexBinding(ctx, regexArgIdent) !== null) {
    throw new Error(REGEX_NONLITERAL_FAILCLOSE);
  }

  // --- Receiver-is-regex shapes: `regex.test(s)`, `regex.exec(s)` ---
  const receiverRegex = resolveRegexExpr(callee.object, ctx);
  if (callee.property === 'test' && receiverRegex !== null) {
    if (call.args.length !== 1) return null;
    if (receiverRegex.flags.includes('g')) {
      // .test(/g) is STATEFUL (lastIndex advances+wraps); no portable re analog.
      throw new Error(REGEX_TEST_G_FAILCLOSE);
    }
    ctx.imports.add('re');
    return `(__k_re.search(${pyRegexPattern(receiverRegex)}, ${emitPyExprCtx(call.args[0], ctx)}, ${pyRegexFlags(receiverRegex.flags)}) is not None)`;
  }
  if (callee.property === 'exec' && receiverRegex !== null) {
    // .exec drives a JS-only stateful `while ((m = re.exec(s)))` loop; fail-close
    // and redirect to the portable `.matchAll` iteration (D4) rather than silently
    // rewrite a loop whose body may mutate lastIndex.
    throw new Error(REGEX_EXEC_FAILCLOSE);
  }

  // --- Receiver-is-string shapes: arg[0] is the regex ---
  const firstArgRegex = call.args.length >= 1 ? resolveRegexExpr(call.args[0], ctx) : null;

  // `.match(s)` — no /g: canonical {full,groups,index,named}|None shape (the
  // load-bearing portability fix, D2). With /g: full matches only via
  // finditer.group(0) (NEVER re.findall, which returns tuples when >1 group),
  // or None when empty.
  if (callee.property === 'match' && firstArgRegex !== null && call.args.length === 1) {
    ctx.imports.add('re');
    const pat = pyRegexPattern(firstArgRegex);
    const subject = emitPyExprCtx(callee.object, ctx);
    if (firstArgRegex.flags.includes('g')) {
      const flags = pyRegexFlags(firstArgRegex.flags, { allowGlobal: true });
      return `([__k_m.group(0) for __k_m in __k_re.finditer(${pat}, ${subject}, ${flags})] or None)`;
    }
    ctx.helpers.add(KERN_REGEX_MATCH_HELPER_PY);
    return `_kern_regex_match(${pat}, ${subject}, ${pyRegexFlags(firstArgRegex.flags)})`;
  }

  // `.matchAll(s)` — requires /g (a non-global matchAll throws TypeError in JS).
  // Shapes finditer into [{full,groups,index}, …], incl. zero-width advances.
  if (callee.property === 'matchAll' && firstArgRegex !== null && call.args.length === 1) {
    if (!firstArgRegex.flags.includes('g')) {
      throw new Error(REGEX_MATCHALL_NO_G_FAILCLOSE);
    }
    ctx.imports.add('re');
    ctx.helpers.add(KERN_REGEX_MATCHALL_HELPER_PY);
    return `_kern_regex_matchall(${pyRegexPattern(firstArgRegex)}, ${emitPyExprCtx(callee.object, ctx)}, ${pyRegexFlags(firstArgRegex.flags, { allowGlobal: true })})`;
  }

  // `.split(s)` — IN-CORE for a non-zero-width pattern with NO limit arg (capture
  // groups interleave portably). FAIL-CLOSE on a zero-width-capable pattern
  // (empty-edge divergence) or any limit/2nd arg (truncate vs remainder).
  if (callee.property === 'split' && firstArgRegex !== null) {
    if (call.args.length > 1) {
      throw new Error(REGEX_SPLIT_LIMIT_FAILCLOSE);
    }
    if (isZeroWidthCapableRegex(firstArgRegex.pattern)) {
      throw new Error(REGEX_SPLIT_ZEROWIDTH_FAILCLOSE);
    }
    ctx.imports.add('re');
    return `__k_re.split(${pyRegexPattern(firstArgRegex)}, ${emitPyExprCtx(callee.object, ctx)}, flags=${pyRegexFlags(firstArgRegex.flags, { allowGlobal: true })})`;
  }

  // `.replace(s, r)` — no /g: FIRST match only (count=1); /g: ALL (count=0).
  const replaceRegex = call.args.length === 2 ? resolveRegexExpr(call.args[0], ctx) : null;
  if (callee.property === 'replace' && replaceRegex !== null) {
    ctx.imports.add('re');
    const count = replaceRegex.flags.includes('g') ? '0' : '1';
    const repl = emitPyReplArg(call.args[1], replaceRegex, ctx);
    return `__k_re.sub(${pyRegexPattern(replaceRegex)}, ${repl}, ${emitPyExprCtx(callee.object, ctx)}, count=${count}, flags=${pyRegexFlags(replaceRegex.flags, { allowGlobal: true })})`;
  }

  // `.replaceAll(s, r)` — requires /g (a non-global replaceAll throws TypeError in
  // JS); otherwise identical to `.replace` /g (count=0, ALL matches replaced).
  if (callee.property === 'replaceAll' && replaceRegex !== null) {
    if (!replaceRegex.flags.includes('g')) {
      throw new Error(REGEX_REPLACEALL_NO_G_FAILCLOSE);
    }
    ctx.imports.add('re');
    const repl = emitPyReplArg(call.args[1], replaceRegex, ctx);
    return `__k_re.sub(${pyRegexPattern(replaceRegex)}, ${repl}, ${emitPyExprCtx(callee.object, ctx)}, count=0, flags=${pyRegexFlags(replaceRegex.flags, { allowGlobal: true })})`;
  }

  return null;
}

/**
 * Milestone C, Slice 4 — emit the Python `re.sub` REPLACEMENT argument for a
 * `.replace`/`.replaceAll` whose regex position is a literal.
 *
 * A STRING-LITERAL replacement is translated from the JS `$`-surface to the
 * Python repl VALUE via the shared `translateReplStringToPython`, then serialized
 * back to `.py` SOURCE through a synthetic `strLit` node so the ordinary
 * string-literal escaper double-escapes the backslashes correctly (gap 6: the
 * translator yields the runtime VALUE `\g<1>` / `\\` — the serializer turns those
 * into the source `"\\g<1>"` / `"\\\\"` that evaluates back to that value). A
 * NON-LITERAL replacement (a variable / computed string) cannot be translated
 * statically and FAILS-CLOSE symmetrically with the TS target.
 */
function emitPyReplArg(
  arg: ValueIR,
  replaceRegex: Extract<ValueIR, { kind: 'regexLit' }>,
  ctx: BodyEmitContext,
): string {
  if (arg.kind !== 'strLit') {
    throw new Error(REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE);
  }
  // Capture metadata is read from the KERN/JS `(?<name>)` surface (BEFORE R6's
  // `(?P<name>)` rewrite), matching the way `$<name>` refs are written.
  const meta = regexCaptureMeta(replaceRegex.pattern);
  const pyReplValue = translateReplStringToPython(arg.value, meta);
  // Serialize the translated VALUE to `.py` source via the normal strLit path
  // (gap 6 — keep translation and serialization layers separate).
  const synthetic: ValueIR = { kind: 'strLit', value: pyReplValue, quote: '"' };
  return emitPyExprCtx(synthetic, ctx);
}

function resolveRegexExpr(node: ValueIR, _ctx: BodyEmitContext): Extract<ValueIR, { kind: 'regexLit' }> | null {
  // Slice-3c: ONLY a DIRECT regex literal lowers canonically. A let-bound regex
  // ident no longer RESOLVES to its literal here (the old `lookupRegexBinding`
  // resolution emitted a STALE pattern when the binding was reassigned and was
  // fragile to track). The fail-close for a known-regex-bound ident is made by
  // `lowerRegexCallPython` via the shared `regexMethodRegexArgIdent` detector —
  // symmetric with the TS target. A string-/unknown-bound ident returns null
  // and stays a plain host method (the `s.match(stringVar)` case).
  //
  // Transparent wrappers (`as`/`!`) are peeled via `regexLiteralReceiverIR` —
  // mirroring the TS `resolveRegexLitTS` — so a wrapped portable receiver call
  // `(/x/).test(s)` / `(/x/ as any).test(s)` lowers, and a wrapped non-portable
  // one `(/x/ as any).exec(s)` fails-close through `lowerRegexCallPython` (round-5
  // wrapped-receiver fix), identically to the TS leg.
  return regexLiteralReceiverIR(node);
}

function pyRegexPattern(node: Extract<ValueIR, { kind: 'regexLit' }>): string {
  // Slice 5: fail-close any non-BMP (astral) construct in the PATTERN before any
  // normalization, on the RAW pattern — the IDENTICAL decision + message the TS
  // emitter makes (the `\/`→`/` un-escape below does not touch any astral
  // construct, so scanning the raw `node.pattern` here is byte-symmetric with TS).
  const astral = scanRegexAstral(node.pattern);
  if (astral !== null) throw new Error(regexAstralFailMessage(astral.char));
  // FIX 2: a non-portable named group (`(?<café>…)`, `(?<$x>…)`, `(?<>…)`) is
  // refused on BOTH targets (the same validator runs in the TS regex-literal emit
  // chokepoints), instead of emitting `(?P<café>…)` / a JS-form `(?<café>…)` that
  // diverges or crashes Python `re`. Run BEFORE any rewrite so the refusal is over
  // the original surface (the same surface `regexCaptureMeta` and the TS side see).
  validateRegexNamedGroupsPortable(node.pattern);
  // JS escapes `/` because it delimits the literal; Python string regexes do not
  // treat `/` specially, so preserve the semantic pattern without that escape.
  const unescaped = node.pattern.replace(/\\\//g, '/');
  // Milestone C, Slice 1 — emission-normalization (shared with the TS emitter
  // for the class transform, so it is byte-identical across targets):
  //   1. `\d \w \s` → explicit ASCII classes (same `normalizeRegexClasses` both
  //      targets), so Python's Unicode-aware shorthand matches JS's ASCII.
  //   2. Slice-/i: class-expand non-ASCII Set(A) letters under /i into explicit
  //      fold classes (Set(B) → throw an identical-to-TS compile error). Runs on
  //      the SAME shared `expandRegexIFold` the TS emitter calls, AFTER class
  //      normalization (Slice-1 classes are pure-ASCII → untouched by the fold
  //      scan) and BEFORE anchor lowering (anchors are ASCII → untouched). Order
  //      is class → fold → anchors; each touches a disjoint character set, so it
  //      is parity-safe and byte-identical to TS. `re.IGNORECASE | re.ASCII` is
  //      kept (handled in pyRegexFlags) — `re.ASCII` is the load-bearing invariant
  //      that makes KEEP-i safe (it suppresses any Python re-fold of the explicit
  //      non-ASCII class members).
  //   3. Python-only anchor lowering: on the non-`/m` path `$`→`\Z`, `^`→`\A`
  //      so Python anchors match JS's input-end/start semantics (`re.ASCII` and
  //      `re.M` are handled in pyRegexFlags). On the `/m` path anchors are kept.
  const classed = normalizeRegexClasses(unescaped);
  const folded = expandRegexIFold(classed, node.flags);
  if ('failClose' in folded) throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  const normalized = lowerRegexAnchorsPython(folded.pattern, node.flags);
  // Milestone C, Slice 4 — R6: named-group PATTERN syntax (`(?<name>)` /
  // `\k<name>`) → Python `re` syntax (`(?P<name>)` / `(?P=name)`). PYTHON-ONLY
  // (JS keeps the original form). Python rejects the JS named-group syntax
  // outright, so this rewrite is load-bearing for ANY named-group pattern on the
  // Python target — and required for a `$<name>` repl ref to resolve. Run LAST,
  // AFTER the `/i` fold expansion: `expandRegexIFold`'s HOLE-1 fail-close depends
  // on seeing the ORIGINAL `\k<name>` backref token (`/(?<g>é)\k<g>/i` must still
  // fail-close), so R6 must NOT consume `\k<` before the fold scan. The fold/class/
  // anchor passes leave the ASCII `(?<` / `\k<` group syntax untouched, so applying
  // R6 here is order-stable and parity-safe.
  const named = lowerRegexNamedGroupsPython(normalized);
  return JSON.stringify(named);
}

function pyRegexFlags(flags: string, options: { allowGlobal?: boolean } = {}): string {
  const unsupported = [...flags].filter((f) => {
    if (f === 'i' || f === 'm' || f === 's') return false;
    if (f === 'g' && options.allowGlobal) return false;
    return true;
  });
  if (unsupported.length > 0) {
    throw new Error(
      `Python target does not lower regex flag(s) '${unsupported.join('')}'. Supported flags are i, m, s` +
        (options.allowGlobal ? ', plus g where the call shape gives it JS-compatible meaning.' : '.'),
    );
  }
  const parts: string[] = [];
  if (flags.includes('i')) parts.push('__k_re.IGNORECASE');
  if (flags.includes('m')) parts.push('__k_re.MULTILINE');
  if (flags.includes('s')) parts.push('__k_re.DOTALL');
  // Milestone C, Slice 1 — always inject `re.ASCII` so Python `\b` and the
  // emitted ASCII classes match JS (without `/u`) semantics. This is the
  // load-bearing flag for word-boundary parity (see the `\bcafé\b` killer row).
  parts.push('__k_re.ASCII');
  return parts.join(' | ');
}

function wrapGuardIfAny(g: GuardedExpr, ctx: BodyEmitContext): string {
  if (g.guard === null) return g.expr;
  // Slice S7 — an optional-chain short-circuit yields the undefined SENTINEL in
  // native (coerce) bodies, so `typeof (undefined?.x)` is "undefined" and the
  // result participates in `??`/`===` nullish semantics. The helper-less
  // Ground/React layer (which never materializes the sentinel) keeps the
  // pre-slice `else None` short-circuit.
  let conditional: string;
  if (ctx.coerceJsValues) {
    ctx.helpers.add(KERN_NULLISH_HELPER_PY);
    conditional = `(${g.expr} if ${g.guard} else _KERN_UNDEFINED)`;
  } else {
    conditional = `(${g.expr} if ${g.guard} else None)`;
  }
  // S7 review fix — in a comprehension-iterable position the non-pure receiver was
  // bound as a lambda PARAMETER instead of a `:=` walrus (CPython rejects the walrus
  // anywhere inside a comprehension iterable expression — see BodyEmitContext.banWalrus
  // and lowerOptionalLink). The guard + branch already reference the bare parameter, so
  // wrapping the whole conditional in `(lambda <param>: <conditional>)(<arg>)` keeps the
  // exact contract: <arg> (the receiver) evaluated exactly once, lazy short-circuit branch.
  if (g.lambdaBind) {
    return `(lambda ${g.lambdaBind.param}: ${conditional})(${g.lambdaBind.arg})`;
  }
  return conditional;
}

/** Slice S5 — does the LEFT operand of a `&&`/`||` walrus binding
 *  (`__k_logN := L`) need parentheses?
 *
 *  The walrus sits inside a `_kern_truthy(...)` call, whose own parens already
 *  disambiguate `L`, so this is defensive/readability wrapping for the lowest-
 *  precedence operand shapes (a `conditional` or `lambda` left operand). A
 *  nested `&&`/`||` left operand is already self-parenthesized by its own
 *  lowering, and an arithmetic/comparison `binary` binds tighter than `:=`, so
 *  neither is wrapped here. */
function needsWalrusOperandParens(child: ValueIR): boolean {
  return child.kind === 'conditional' || child.kind === 'lambda';
}

/** S5 review fix — run `fn` with `ctx.banWalrus` set (save/restore), for
 *  emitting an operand that will be interpolated into a comprehension/
 *  generator ITERABLE position, where CPython rejects `:=` outright (see
 *  BodyEmitContext.banWalrus). Nested emissions inherit the flag through the
 *  shared ctx, so a walrus producer at ANY depth of the operand (e.g. the
 *  index expression in `items[i || 0]`) switches to its walrus-free form. */
function withWalrusBan<T>(ctx: BodyEmitContext, fn: () => T): T {
  const previous = ctx.banWalrus === true;
  ctx.banWalrus = true;
  try {
    return fn();
  } finally {
    ctx.banWalrus = previous;
  }
}

/** Slice S5 — does the RIGHT operand, emitted in the `else` arm of the lowered
 *  conditional expression, need parentheses? A bare `conditional`/`lambda` in
 *  an `else` arm parses but is ambiguous to read and brittle under further
 *  composition, so wrap those two. A nested `&&`/`||` right operand is already
 *  self-parenthesized. */
function needsConditionalAlternateParens(child: ValueIR): boolean {
  return child.kind === 'conditional' || child.kind === 'lambda';
}

/** S5 review fix — parenthesize a compound NON-CHAIN member-root expression so
 *  the appended `.prop` link binds to the WHOLE root (`(b if t else c).prop`),
 *  not its last operand (`b if t else c.prop` — silently wrong Python).
 *  Low-precedence node kinds (same set as index receivers) are wrapped UNLESS
 *  the lowering already produced a self-delimited atom: a fully-enclosing
 *  paren pair (the `&&`/`||`/`??` walrus ternaries) or a single helper call
 *  (`__kern_add(a, b)`), which keeps existing pinned bytes stable. */
function wrapCompoundRootExpr(obj: ValueIR, emitted: string): string {
  if (!needsIndexReceiverParens(obj)) return emitted;
  if (isSelfDelimitedPyAtom(emitted)) return emitted;
  return `(${emitted})`;
}

/** True when `expr` is one self-delimited Python atom: a fully-enclosing
 *  bracket pair (`(...)`, `[...]`) or one identifier-headed call/index chain
 *  whose trailing bracket closes at the very end (`__kern_add(a, b)`). A
 *  leading unary sign (`-a`, `not x`, `await f()`) is NOT an atom. */
function isSelfDelimitedPyAtom(expr: string): boolean {
  if (expr.length === 0) return false;
  // Atoms start with an identifier/literal/bracket — a leading operator or
  // keyword (`-`, `~`, `not `, `await `) always needs wrapping.
  if (!/^[A-Za-z_0-9"'([{]/.test(expr)) return false;
  if (!expr.includes(' ')) return true;
  // Walk brackets/strings; any top-level space outside brackets means the
  // expression is compound (`b if t else c`), not an atom.
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ' ' && depth === 0) return false;
  }
  return depth === 0;
}

function needsIndexReceiverParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'conditional' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'typeAssert' ||
    child.kind === 'nonNull' ||
    child.kind === 'await' ||
    child.kind === 'lambda'
  );
}

/** Slice 3d (review fix) — receiver-purity walk for the optional-chain
 *  short-circuit lowering. Pure means: no observable side effects when
 *  re-named twice (once in the `is not None` guard, once in the branch).
 *
 *  Pure: `ident`, member chains rooted at `ident` (whether optional or
 *  not — repeated attribute access on `None` raises but never silently
 *  side-effects), and index chains rooted at pure receivers with pure index
 *  expressions. NOT pure: `call`, `await`, `binary`, `unary`, `propagate`,
 *  non-index literals (which are technically pure but never sensible
 *  receivers). */
function isReceiverChainPure(node: ValueIR): boolean {
  if (node.kind === 'ident') return true;
  // Slice S7 — `undefined`/`null` literals are constant, so an optional chain
  // rooted at one (`undefined?.x`, `null?.x`) names a side-effect-free value and
  // takes the readable double-name guard form (short-circuiting to the sentinel).
  if (node.kind === 'undefLit' || node.kind === 'nullLit') return true;
  if (node.kind === 'member') return isReceiverChainPure(node.object);
  if (node.kind === 'index') return isReceiverChainPure(node.object) && isPureIndexExpression(node.index);
  return false;
}

function isPureIndexExpression(node: ValueIR): boolean {
  switch (node.kind) {
    case 'ident':
    case 'numLit':
    case 'strLit':
    case 'boolLit':
    case 'nullLit':
    case 'undefLit':
      return true;
    case 'member':
      return isReceiverChainPure(node);
    case 'index':
      return isReceiverChainPure(node);
    default:
      return false;
  }
}

const COMPARISON_OPS = new Set(['==', '!=', '===', '!==', '<', '<=', '>', '>=']);

/** Slice-2 review fix — Python chains comparisons by default. When the parent
 *  binary op is a comparison and the child is also a (different) comparison
 *  binary, force parens to preserve KERN's TS-flavored left-associative AST. */
function needsComparisonChainParens(child: { kind: string; op?: string }, parentOp: string): boolean {
  if (!COMPARISON_OPS.has(parentOp)) return false;
  if (child.kind !== 'binary') return false;
  if (typeof child.op !== 'string') return false;
  return COMPARISON_OPS.has(child.op);
}

/** Slice 2c — map KERN/TS-flavored binary ops to Python equivalents.
 *  KERN inherits TS's `===` / `!==` strict-equality syntax; Python uses
 *  `==` / `!=` for the equivalent value-equality semantics on primitives.
 *  `??` (nullish coalesce) has no Python equivalent and slice 3 introduces
 *  a single-eval `(L if L is not None else R)` lowering. Slice 2 throws
 *  rather than emit invalid syntax (review fix). */
function mapBinaryOpToPython(op: string): string {
  switch (op) {
    case '===':
      return '==';
    case '!==':
      return '!=';
    case '&&':
      return 'and';
    case '||':
      return 'or';
    default:
      return op;
  }
}

/** Slice H — the host-namespace root set and diagnostic now live in core's
 *  shared codegen module so TS and Python reject the same unmapped host roots
 *  in lockstep. RegExp is intentionally exempt in that shared set for
 *  Milestone B. */

/** Slice H — is `name` PROVEN to be a user binding in the current expression
 *  context?
 *
 *  Reuses the emitter's EXISTING scope/binding model — the single source of
 *  truth — rather than building a parallel tracker:
 *    - `lookupLocalBinding` walks `ctx.localScopes` (function params via
 *      `outerBindings`, body `let`/`const`/`cell` via `declareLocalBinding`,
 *      loop vars, block scopes);
 *    - `ctx.shadowedSymbols` records lambda/comprehension parameters that the
 *      ident emitter already treats as user-local (see the `ident` case);
 *    - `ctx.symbolMap` keys are KERN-form param names the FastAPI generator
 *      renamed (e.g. `userId -> user_id`) — a present key means a real param.
 *
 *  Per tribunal amendment 2, this FAILS TOWARD REFUSE: when the scope model
 *  cannot prove a binding, we return false (→ the host-root guard fires),
 *  never toward verbatim acceptance. Ground/module emitters that carry no
 *  binding information therefore fail closed for reserved host roots, which is
 *  exactly the intent — those are the contexts that previously leaked invalid
 *  Python. (Honoring a *declared* binding — even one whose runtime value would
 *  be `None` — is by design: this slice reuses the lexical scope model, it
 *  does not do runtime value tracking. A user value named `Math` is the
 *  shadowing case the spec explicitly keeps in scope.) */
function isProvenUserBinding(ctx: BodyEmitContext, name: string): boolean {
  if (lookupLocalBinding(ctx, name) !== undefined) return true;
  if (ctx.shadowedSymbols.has(name)) return true;
  if (Object.hasOwn(ctx.symbolMap, name)) return true;
  return false;
}

/** Slice H — the fail-closed guard for unmapped host-namespace member
 *  expressions (the strangler-pattern interim check).
 *
 *  ACCEPTED DEBT (do not "fix" by relocating): this check lives at the
 *  EMISSION point inside the code generator, not in a standalone validation
 *  pass. That is interim by design — milestone A completes the portable
 *  lowering registry (`KERN_STDLIB_MODULES`) and replaces these refusals with
 *  real lowerings. Because the explicit AST lowering hooks all run BEFORE this
 *  guard, the site is already scheduled to change as that registry grows: the
 *  guard only ever sees the *remaining* unmapped forms. This is the strangler
 *  pattern — the call site is provisioned to shrink, not to be reworked.
 *
 *  Trigger predicate (capitalization-agnostic; NO {Math,JSON,Object,Date}
 *  allowlist): a host-namespace-shaped root (`isHostNamespaceRoot`) that is
 *  NOT proven user-bound (`isProvenUserBinding`, which fails toward refuse).
 *  Returns `null` (caller proceeds to generic verbatim emission) for any root
 *  that is provably a user binding or is not host-shaped — so user receivers
 *  (`client.send(...)`, `myMath.sqrt(...)`) and proven-local `Math` pass
 *  through unchanged. Throws otherwise. */
function rejectUnmappedHostNamespacePython(root: string, member: string, ctx: BodyEmitContext): null {
  if (!isHostNamespaceRoot(root)) return null;
  if (isProvenUserBinding(ctx, root)) return null;
  throw new Error(unmappedHostNamespaceMessage('Python', root, member));
}

/** Slice 2 — host-`RegExp` fail-close (Python emit). Closes the residual RegExp
 *  positions the generic `Module.member` guard above does NOT cover, throwing the
 *  SAME shared `REGEX_HOST_REGEXP_FAILCLOSE` the TS emitter + IR-validate pass
 *  throw (byte-identical across targets):
 *   - a BARE-VALUE reference (`const R = RegExp`, `RegExp` passed as a value),
 *   - a BARE CALL `RegExp(p, f)` (callee is an ident, missed by the member-callee
 *     guard), and
 *   - `new RegExp(p)` (the Python `new` case otherwise falls through to a verbatim
 *     `RegExp(...)` NameError).
 *  Honors user shadowing via `isProvenUserBinding` (fails toward refuse when a
 *  binding cannot be proven, matching the host-namespace guard's intent), so
 *  `const RegExp = myThing; RegExp` is the user value. `RegExp.prototype`/
 *  `RegExp.$1` already fail-close through the generic member guard (one
 *  diagnostic per site). */
function rejectHostRegExpValuePython(name: string, ctx: BodyEmitContext): void {
  if (name !== 'RegExp') return;
  if (isProvenUserBinding(ctx, name)) return;
  throw new Error(REGEX_HOST_REGEXP_FAILCLOSE);
}

/** Slice 2a — KERN-stdlib dispatch for Python. Returns the lowered Python
 *  string when the call matches `<KnownModule>.<method>(args)`, or null when
 *  it doesn't. Throws on `<KnownModule>.<unknownMethod>(...)` with a
 *  did-you-mean suggestion. Mirror of `applyStdlibLoweringTS` in core.
 *
 *  Slice 3b — when the matched entry declares `requires.py`, the import
 *  identifier is added to the per-handler ctx.imports set so the FastAPI
 *  generator can emit `import math` (etc.) at the top of the function body. */
function applyStdlibPropertyLoweringPython(
  member: Extract<ValueIR, { kind: 'member' }>,
  ctx: BodyEmitContext,
): string | null {
  if (member.optional) return null;
  if (member.object.kind !== 'ident') return null;
  const moduleName = member.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const propertyName = member.property;
  const entry = lookupStdlibProperty(moduleName, propertyName);
  if (entry === null) {
    const callEntry = lookupStdlibCall(moduleName, propertyName);
    if (callEntry !== null) {
      throw new Error(
        `KERN-stdlib method '${moduleName}.${propertyName}' cannot be referenced as a value in portable Python lowering; call it directly.`,
      );
    }
    throwUnknownStdlibMemberPython(moduleName, propertyName);
  }
  registerStdlibRequirementPython(entry.requires?.py, ctx);
  return entry.py;
}

function rejectKnownStdlibIndexPython(root: string, member: string): void {
  if (!KERN_STDLIB_MODULES.has(root)) return;
  throwUnknownStdlibMemberPython(root, member);
}

function applyStdlibLoweringPython(call: Extract<ValueIR, { kind: 'call' }>, ctx: BodyEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  if (callee.object.kind !== 'ident') return null;
  const moduleName = callee.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const methodName = callee.property;
  const entry = lookupStdlibCall(moduleName, methodName);
  if (entry === null) {
    const propertyEntry = lookupStdlibProperty(moduleName, methodName);
    if (propertyEntry !== null) {
      throw new Error(`KERN-stdlib property '${moduleName}.${methodName}' is not callable.`);
    }
    throwUnknownStdlibMemberPython(moduleName, methodName);
  }
  // Slice-2 review fix: enforce declared arity (matches TS-side check).
  validateStdlibCallArityPython(moduleName, methodName, entry, call.args.length);
  if (moduleName === 'Array' && methodName === 'from' && call.args.some((arg) => arg.kind === 'spread')) {
    throw new Error('Array.from portable lowering does not accept spread arguments; pass source and mapper directly.');
  }
  // DECIMAL Slice 1 — `Decimal.of(arg)` string-literal + canonical-scale check,
  // running the SAME shared-core validator the TS leg runs, so the fail-close is
  // byte-identical across targets.
  validateDecimalConstructionArg(moduleName, methodName, call);
  const listLambda = lowerListLambdaPython(moduleName, methodName, call, ctx);
  if (listLambda !== null) return listLambda;
  // Slice 3b — register required imports (e.g., `Number.floor` ⇒ `import math`).
  registerStdlibRequirementPython(entry.requires?.py, ctx);
  const args = call.args.map((a) => {
    const emitted = emitPyExprCtx(a, ctx);
    return a.kind !== 'spread' && needsArgParens(a) ? `(${emitted})` : emitted;
  });
  // Slice S7 — `Json.stringify` on Python routes through the sentinel-aware shim
  // (single-source `KERN_JSON_STRINGIFY_SHIM_PY`) instead of raw `__k_json.dumps`,
  // so `JSON.stringify(undefined)` is host-undefined, an object key whose value
  // is the sentinel is omitted, and a sentinel array element becomes JSON null —
  // matching JS. The shim references `__k_json`, supplied by the table's
  // `requires.py: 'json'` import registered above (one import shared with parse).
  if ((moduleName === 'Json' || moduleName === 'JSON') && methodName === 'stringify') {
    ctx.helpers.add(KERN_JSON_STRINGIFY_SHIM_PY);
    return `_kern_json_stringify(${args[0]})`;
  }
  return typeof entry.py === 'function' ? entry.py(args) : applyTemplate(entry.py, args);
}

function throwUnknownStdlibMemberPython(moduleName: string, memberName: string): never {
  const suggestion = suggestStdlibMethod(moduleName, memberName);
  const hint = suggestion ? ` Did you mean '${moduleName}.${suggestion}'?` : '';
  throw new Error(`Unknown KERN-stdlib method/member '${moduleName}.${memberName}'.${hint}`);
}

function validateStdlibCallArityPython(
  moduleName: string,
  methodName: string,
  entry: NonNullable<ReturnType<typeof lookupStdlibCall>>,
  got: number,
): void {
  if (entry.arity !== undefined && got !== entry.arity) {
    throw new Error(
      `KERN-stdlib '${moduleName}.${methodName}' takes ${entry.arity} arg${entry.arity === 1 ? '' : 's'}, got ${got}.`,
    );
  }
  if (entry.minArity !== undefined && got < entry.minArity) {
    throw new Error(`KERN-stdlib '${moduleName}.${methodName}' takes at least ${entry.minArity} args, got ${got}.`);
  }
  if (entry.maxArity !== undefined && got > entry.maxArity) {
    throw new Error(`KERN-stdlib '${moduleName}.${methodName}' takes at most ${entry.maxArity} args, got ${got}.`);
  }
}

function registerStdlibRequirementPython(requirement: string | undefined, ctx: BodyEmitContext): void {
  if (!requirement) return;
  if (requirement === 'math-host') {
    ctx.helpers.add(KERN_TO_NUMBER_HELPER_PY);
    ctx.helpers.add(KERN_JS_MATH_HELPERS_PY);
    return;
  }
  if (requirement === 'array-host') {
    ctx.helpers.add(KERN_TO_NUMBER_HELPER_PY);
    ctx.helpers.add(KERN_JS_ARRAY_FROM_HELPER_PY);
    return;
  }
  if (requirement === 'object-host') {
    ctx.helpers.add(KERN_JS_OBJECT_HELPERS_PY);
    return;
  }
  if (requirement === 'number-host') {
    ctx.helpers.add(KERN_JS_NUMBER_HELPERS_PY);
    return;
  }
  ctx.imports.add(requirement);
}

function lowerListLambdaPython(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
  ctx: BodyEmitContext,
): string | null {
  if (moduleName !== 'List') return null;
  if (methodName !== 'map' && methodName !== 'filter') return null;
  // S5 review fix — the source lands in the comprehension's generator head
  // (`for x in <source>`): walrus producers must switch to lambda-parameter
  // forms (CPython rejects `:=` in a comprehension iterable at any depth) and
  // a compound source (bare ternary) must be parenthesized so its `if` does
  // not parse as the comprehension filter.
  const source = parenthesizeIterable(withWalrusBan(ctx, () => emitPyExprCtx(call.args[0], ctx)));
  const callback = call.args[1];
  if (callback.kind !== 'lambda') {
    const fn = emitPyExprCtx(callback, ctx);
    return methodName === 'map' ? `list(map(${fn}, ${source}))` : `list(filter(${fn}, ${source}))`;
  }
  if (callback.params.length !== 1) {
    throw new Error(`List.${methodName} expects a one-parameter lambda on the Python target.`);
  }
  // Block-bodied arrow callback: the comprehension lowering only handles an
  // expression `body`. Fall through (null) so the lambda routes through the
  // default call path → `emitLambdaPy` (which fails closed in commit A and
  // hoists a local def in commit B).
  if (!callback.body) return null;
  const name = callback.params[0].name;
  const previous = new Set(ctx.shadowedSymbols);
  ctx.shadowedSymbols.add(name);
  try {
    const body = emitPyExprCtx(callback.body, ctx);
    if (methodName === 'map' && containsLambdaCapturingIdent(callback.body, name)) {
      return `list(map(lambda ${name}: ${body}, ${source}))`;
    }
    return methodName === 'map'
      ? `[${body} for ${name} in ${source}]`
      : `[${name} for ${name} in ${source} if ${body}]`;
  } finally {
    ctx.shadowedSymbols = previous;
  }
}

/** Slice 6 — Python bitwise/shift operator precedence (higher binds tighter).
 *  Matches CPython's grammar: `|` < `^` < `&` < shift < unary `~`. Used to
 *  parenthesize the LOWERED tree so the emitted Python reproduces the JS-shaped
 *  grouping (e.g. `a << (b & 31)` must keep the mask parens, since Python's
 *  `<<` binds tighter than `&`). */
const PY_BITWISE_PREC: Record<string, number> = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4 };

/**
 * Slice 6 — emit an ALREADY-LOWERED bitwise/shift tree to a Python string.
 *
 * The tree produced by `lowerBitwiseAndModuloAST` contains FINAL Python
 * operators (`| & ^ << >>` and unary `~`) whose operands are already wrapped in
 * `_kern_to_int32` / `_kern_to_uint32` calls. Re-routing those operators back
 * through `emitPyExprCtx`'s bitwise branch would re-lower them and recurse
 * forever, so this dedicated emitter renders the bitwise/shift `binary` and the
 * `~` `unary` verbatim (with precedence-correct parens) and delegates every
 * other node kind (the leaves: calls, idents, literals, …) to `emitPyExprCtx`.
 */
function emitLoweredBitwisePy(node: ValueIR, ctx: BodyEmitContext): string {
  // The lowering's own wrapper calls (`_kern_to_int32` / `_kern_to_uint32` /
  // `_tmod`) must stay in THIS emit path: their argument is an already-lowered
  // bitwise/shift subtree, and handing the whole call to `emitPyExprCtx` would
  // re-route that inner subtree back into the bitwise branch and recurse
  // forever. Emit the wrapper directly and recurse through its argument here.
  if (
    node.kind === 'call' &&
    node.callee.kind === 'ident' &&
    (node.callee.name === '_kern_to_int32' || node.callee.name === '_kern_to_uint32' || node.callee.name === '_tmod')
  ) {
    const args = node.args.map((a) => emitLoweredBitwisePy(a, ctx)).join(', ');
    return `${node.callee.name}(${args})`;
  }
  if (node.kind === 'binary' && node.op in PY_BITWISE_PREC) {
    const parentPrec = PY_BITWISE_PREC[node.op];
    const emitChild = (child: ValueIR, isRight: boolean): string => {
      const s = emitLoweredBitwisePy(child, ctx);
      if (child.kind === 'binary' && child.op in PY_BITWISE_PREC) {
        const childPrec = PY_BITWISE_PREC[child.op];
        // Lower-precedence child always needs parens; an equal-precedence child
        // on the RIGHT needs parens to preserve left-associative grouping.
        if (childPrec < parentPrec || (childPrec === parentPrec && isRight)) return `(${s})`;
      }
      return s;
    };
    return `${emitChild(node.left, false)} ${node.op} ${emitChild(node.right, true)}`;
  }
  if (node.kind === 'unary' && node.op === '~') {
    const inner = emitLoweredBitwisePy(node.argument, ctx);
    // `~` binds tighter than every binary bitwise/shift op, so a binary argument
    // must be parenthesized (e.g. `~(a | b)`).
    const wrapped = node.argument.kind === 'binary' && node.argument.op in PY_BITWISE_PREC ? `(${inner})` : inner;
    return `~${wrapped}`;
  }
  // Leaf / non-bitwise node — hand back to the main expression emitter.
  return emitPyExprCtx(node, ctx);
}

/**
 * Slice 6 — emit a binary bitwise/shift op `a <op> b` (op ∈ `| & ^ << >>`) on
 * the slice-0.75 ToInt32 substrate, per the S6 emission contract:
 *
 *   a | b   ->  _kern_to_int32(_kern_to_int32(a) | _kern_to_int32(b))
 *   a << b  ->  _kern_to_int32(_kern_to_int32(a) << (_kern_to_uint32(b) & 31))
 *
 * Each operand subexpression appears EXACTLY ONCE, so Python evaluates each side
 * once, left-to-right — matching JS evaluation-once order with no temporaries.
 */
function emitBitwiseShiftPy(
  op: '|' | '&' | '^' | '<<' | '>>',
  left: ValueIR,
  right: ValueIR,
  ctx: BodyEmitContext,
): string {
  ctx.helpers.add(KERN_TO_NUMBER_HELPER_PY);
  const l = `_kern_to_int32(${emitPyExprCtx(left, ctx)})`;
  if (op === '<<' || op === '>>') {
    // Shift count: ToUint32 then `& 31`.
    const count = `(_kern_to_uint32(${emitPyExprCtx(right, ctx)}) & 31)`;
    return `_kern_to_int32(${l} ${op} ${count})`;
  }
  const r = `_kern_to_int32(${emitPyExprCtx(right, ctx)})`;
  return `_kern_to_int32(${l} ${op} ${r})`;
}

/**
 * Slice 6 — emit `a >>> b` (unsigned/zero-fill right shift):
 *
 *   a >>> b  ->  _kern_to_uint32(_kern_to_uint32(a) >> (_kern_to_uint32(b) & 31))
 *
 * Both operands are non-negative after `_kern_to_uint32`, so Python's raw `>>`
 * is zero-fill (it NEVER sign-extends here); the outer `_kern_to_uint32` keeps
 * the result in the 0..2**32-1 Uint32 codomain. Raw signed `>>` on the original
 * value would sign-extend and is therefore never used.
 */
function emitUnsignedShiftPy(left: ValueIR, right: ValueIR, ctx: BodyEmitContext): string {
  ctx.helpers.add(KERN_TO_NUMBER_HELPER_PY);
  const l = `_kern_to_uint32(${emitPyExprCtx(left, ctx)})`;
  const count = `(_kern_to_uint32(${emitPyExprCtx(right, ctx)}) & 31)`;
  return `_kern_to_uint32(${l} >> ${count})`;
}

export function lowerBitwiseAndModuloAST(node: ValueIR): ValueIR {
  switch (node.kind) {
    case 'binary': {
      const left = lowerBitwiseAndModuloAST(node.left);
      const right = lowerBitwiseAndModuloAST(node.right);
      // Slice 6 — bitwise / shift on the landed slice-0.75 ToInt32 substrate.
      // Each operand expression appears EXACTLY ONCE in the lowered form (the
      // helper call wraps it inline), so Python evaluates each side once,
      // left-to-right — matching JS evaluation-once order without temporaries.
      if (node.op === '|' || node.op === '&' || node.op === '^') {
        // a <op> b  ->  _kern_to_int32(_kern_to_int32(a) <op> _kern_to_int32(b))
        return wrapInToInt32({ kind: 'binary', op: node.op, left: wrapInToInt32(left), right: wrapInToInt32(right) });
      }
      if (node.op === '<<' || node.op === '>>') {
        // a <op> b  ->  _kern_to_int32(_kern_to_int32(a) <op> (_kern_to_uint32(b) & 31))
        return wrapInToInt32({
          kind: 'binary',
          op: node.op,
          left: wrapInToInt32(left),
          right: maskShiftCount(right),
        });
      }
      if (node.op === '>>>') {
        // a >>> b  ->  _kern_to_uint32(_kern_to_uint32(a) >> (_kern_to_uint32(b) & 31))
        // Both operands are non-negative after _kern_to_uint32, so Python's raw
        // `>>` is zero-fill (NEVER sign-extends); the outer _kern_to_uint32 keeps
        // the result in the 0..2**32-1 Uint32 codomain.
        return wrapInToUint32({
          kind: 'binary',
          op: '>>',
          left: wrapInToUint32(left),
          right: maskShiftCount(right),
        });
      }
      if (node.op === '%') {
        return {
          kind: 'call',
          callee: { kind: 'ident', name: '_tmod' },
          args: [left, right],
          optional: false,
        };
      }
      return { ...node, left, right };
    }
    case 'unary': {
      const argument = lowerBitwiseAndModuloAST(node.argument);
      if (node.op === '~') {
        // ~a  ->  _kern_to_int32(~_kern_to_int32(a))
        return wrapInToInt32({ kind: 'unary', op: '~', argument: wrapInToInt32(argument) });
      }
      return { ...node, argument };
    }
    case 'tmplLit':
      return { ...node, expressions: node.expressions.map(lowerBitwiseAndModuloAST) };
    case 'member':
      return { ...node, object: lowerBitwiseAndModuloAST(node.object) };
    case 'index':
      return { ...node, object: lowerBitwiseAndModuloAST(node.object), index: lowerBitwiseAndModuloAST(node.index) };
    case 'call':
      return {
        ...node,
        callee: lowerBitwiseAndModuloAST(node.callee),
        args: node.args.map(lowerBitwiseAndModuloAST),
      };
    case 'lambda':
      // Block-bodied arrows carry raw text, not an expression `body`. The raw
      // is re-parsed and lowered during closure emission (commit B), so leave
      // it untouched here.
      return node.bodyBlock ? node : { ...node, body: lowerBitwiseAndModuloAST(node.body as ValueIR) };
    case 'spread':
      return { ...node, argument: lowerBitwiseAndModuloAST(node.argument) };
    case 'await':
      return { ...node, argument: lowerBitwiseAndModuloAST(node.argument) };
    case 'new':
      return { ...node, argument: lowerBitwiseAndModuloAST(node.argument) };
    case 'typeAssert':
      return { ...node, expression: lowerBitwiseAndModuloAST(node.expression) };
    case 'nonNull':
      return { ...node, expression: lowerBitwiseAndModuloAST(node.expression) };
    case 'propagate':
      return { ...node, argument: lowerBitwiseAndModuloAST(node.argument) };
    case 'objectLit':
      return {
        ...node,
        entries: node.entries.map((e) =>
          'kind' in e && (e as any).kind === 'spread'
            ? { kind: 'spread', argument: lowerBitwiseAndModuloAST((e as any).argument) }
            : { ...(e as any), value: lowerBitwiseAndModuloAST((e as any).value) },
        ),
      };
    case 'arrayLit':
      return { ...node, items: node.items.map(lowerBitwiseAndModuloAST) };
    case 'conditional':
      return {
        ...node,
        test: lowerBitwiseAndModuloAST(node.test),
        consequent: lowerBitwiseAndModuloAST(node.consequent),
        alternate: lowerBitwiseAndModuloAST(node.alternate),
      };
    default:
      return node;
  }
}

/** Slice 6 — wrap `node` in a `_kern_to_int32(...)` call (the landed slice-0.75
 *  ToInt32 helper). Emits the operator-level coercion the S6 contract mandates. */
function wrapInToInt32(node: ValueIR): ValueIR {
  return { kind: 'call', callee: { kind: 'ident', name: '_kern_to_int32' }, args: [node], optional: false };
}

/** Slice 6 — wrap `node` in a `_kern_to_uint32(...)` call (slice-0.75 ToUint32). */
function wrapInToUint32(node: ValueIR): ValueIR {
  return { kind: 'call', callee: { kind: 'ident', name: '_kern_to_uint32' }, args: [node], optional: false };
}

/** Slice 6 — JS masks every shift count with `& 31` after ToUint32. Emits
 *  `(_kern_to_uint32(count) & 31)`. The `count` subexpression appears once. */
function maskShiftCount(count: ValueIR): ValueIR {
  return {
    kind: 'binary',
    op: '&',
    left: wrapInToUint32(count),
    right: { kind: 'numLit', value: 31, raw: '31' },
  };
}

export function registerHelpers(node: ValueIR, ctx: BodyEmitContext) {
  switch (node.kind) {
    case 'call':
      if (node.callee.kind === 'ident') {
        if (node.callee.name === '_kern_to_int32' || node.callee.name === '_kern_to_uint32') {
          // Slice 6 — both helpers live in the single slice-0.75 helper block.
          ctx.helpers.add(KERN_TO_NUMBER_HELPER_PY);
        } else if (node.callee.name === '_tmod') {
          ctx.helpers.add(KERN_TMOD_HELPER_PY);
        }
      }
      registerHelpers(node.callee, ctx);
      for (const arg of node.args) {
        registerHelpers(arg, ctx);
      }
      break;
    case 'binary':
      registerHelpers(node.left, ctx);
      registerHelpers(node.right, ctx);
      break;
    case 'unary':
      registerHelpers(node.argument, ctx);
      break;
    case 'tmplLit':
      for (const expr of node.expressions) {
        registerHelpers(expr, ctx);
      }
      break;
    case 'member':
      registerHelpers(node.object, ctx);
      break;
    case 'index':
      registerHelpers(node.object, ctx);
      registerHelpers(node.index, ctx);
      break;
    case 'lambda':
      // Block-bodied arrows have no expression `body`; helpers referenced by a
      // block body are registered during closure emission (commit B).
      if (node.body) registerHelpers(node.body, ctx);
      break;
    case 'spread':
      registerHelpers(node.argument, ctx);
      break;
    case 'await':
      registerHelpers(node.argument, ctx);
      break;
    case 'new':
      registerHelpers(node.argument, ctx);
      break;
    case 'typeAssert':
      registerHelpers(node.expression, ctx);
      break;
    case 'nonNull':
      registerHelpers(node.expression, ctx);
      break;
    case 'propagate':
      registerHelpers(node.argument, ctx);
      break;
    case 'objectLit':
      for (const e of node.entries) {
        if ('kind' in e && e.kind === 'spread') {
          registerHelpers(e.argument, ctx);
        } else {
          registerHelpers((e as any).value, ctx);
        }
      }
      break;
    case 'arrayLit':
      for (const item of node.items) {
        registerHelpers(item, ctx);
      }
      break;
    case 'conditional':
      registerHelpers(node.test, ctx);
      registerHelpers(node.consequent, ctx);
      registerHelpers(node.alternate, ctx);
      break;
  }
}

function emitExpressionV1Py(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `expression-v1` requires `name=`.');
  const rawExpr = props.expr;
  const exprSource = unwrapBodyExpr(rawExpr);
  if (exprSource === undefined || exprSource === '') {
    throw new Error('body-statement `expression-v1` requires `expr=`.');
  }
  const exprIR = parseExpr(exprSource);
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);
  setRegexBinding(ctx, userName, exprIR.kind === 'regexLit' ? exprIR : null);
  const lines = [`${name} = ${emitPyExprCtx(exprIR, ctx)}`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTracePy(name));
  return lines;
}

function emitFnPy(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const userName = String(props.name ?? '');
  if (!userName) throw new Error('body-statement `fn` requires `name=`.');
  declareLocalBinding(ctx, userName, 'const');
  const name = maybeRenameOnShadow(ctx, userName);

  const isAsync = props.async === 'true' || props.async === true;
  const asyncKw = isAsync ? 'async ' : '';
  if (props.params && node.children?.some((c) => c.type === 'param')) {
    throw new Error('body-statement `fn` cannot mix legacy `params=` with structured `param` children.');
  }
  const paramList = buildPythonParamList(node);

  const returns = props.returns ? String(props.returns) : '';
  const retClause = returns ? ` -> ${mapTsTypeToPython(returns)}` : '';

  const lines: string[] = [];
  lines.push(`${indent}${asyncKw}def ${name}(${paramList})${retClause}:`);

  const handlerNode = node.children?.find((c) => c.type === 'handler');
  const bodyNodes = handlerNode ? (handlerNode.children ?? []) : (node.children ?? []);
  const stmtNodes = bodyNodes.filter((c) => c.type !== 'param' && c.type !== 'decorator');

  const inner = emitChildrenPy(stmtNodes, ctx, indent + INDENT_STEP, paramBindingsFromPythonSignature(paramList));
  if (inner.length === 0) {
    lines.push(`${indent}${INDENT_STEP}pass`);
  } else {
    for (const sl of inner) {
      lines.push(sl);
    }
  }
  return lines;
}

function paramBindingsFromPythonSignature(paramList: string): Array<[string, 'const']> {
  if (!paramList.trim()) return [];
  return splitBodyExpressionList(paramList, 'fn params=')
    .map((part) => part.split('=')[0]?.split(':')[0]?.trim().replace(/^\*+/, '') ?? '')
    .filter((name) => /^[A-Za-z_]\w*$/.test(name))
    .map((name) => [name, 'const']);
}

function inlineKernFmtPy(expr: string): string {
  return [
    '(lambda __k_v: ',
    "('true' if __k_v else 'false') if isinstance(__k_v, bool) else ",
    "'null' if __k_v is None else ",
    'str(int(__k_v)) if isinstance(__k_v, float) and __k_v.is_integer() else ',
    'str(__k_v))',
    `(${expr})`,
  ].join('');
}
