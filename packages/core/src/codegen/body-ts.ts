/** Native KERN handler-body codegen — TypeScript target (slices 1–3).
 *
 *  Walks the children of a handler with `lang=kern` and emits a TypeScript
 *  body string. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `const X = EXPR;` (slice 1)
 *    - `clamp name=X value=V min=LO max=HI` — `const X = Math.max(LO, Math.min(HI, V));`
 *    - `destructure source="EXPR"` — `const { X } = EXPR;` / `const [X] = EXPR;`
 *    - `return value="EXPR"` / bare `return` — `return EXPR;` (slice 1)
 *    - `if cond="EXPR"` / sibling `else` — `if (EXPR) { … } else { … }` (slice 2c)
 *    - `while cond="EXPR"` — `while (EXPR) { … }`
 *    - `for name=i from=0 to="List.length(xs)"` — numeric range loop
 *
 *  Statement-level propagation `?` lowers to the same hoisted shape that
 *  slice 7 established for raw-body propagation:
 *
 *      const __k_t1 = await call();
 *      if (__k_t1.kind === 'err') return __k_t1;
 *      const u = __k_t1.value;
 *
 *  Slice 3 — symmetric `{ code, imports }` shape with the Python target so
 *  body-emitter callers have a uniform signature regardless of language.
 *  TS's KERN-stdlib lowerings don't currently demand any imports (`Math` is
 *  global, `Set`/`Map` are global), so `imports` is typically empty. The
 *  `BodyEmitOptions.symbolMap` parameter is currently unused on the TS
 *  target — TS preserves the camelCase identifier shape end-to-end — but
 *  is plumbed through for parity with the Python emitter (and for any
 *  future TS-only renames such as reserved-word collision handling).
 *
 *  Slice scope:
 *    - Result-flavored propagation only (`'err'` discriminant). Option
 *      propagation in native bodies is deferred to slice 8 (typecheck-driven).
 *    - `if` requires `cond="EXPR"`. `else` is a sibling node (no condition).
 *      `else if` chains: an `else` whose first child is an `if` (with optional
 *      sibling inner `else`) is collapsed to `else if (...)` in the emitted
 *      TS. Same shape works for hand-written nested KERN and for slice 5b's
 *      `kern migrate native-handlers` output, which emits `else > if(…)` so
 *      raw `else if` chains round-trip byte-equivalent through `--verify`.
 *
 *  `gensymCounter` is local to each emit call — every handler gets its own
 *  fresh `__k_t1`, `__k_t2`, … sequence (same convention as slice 7).
 *
 *  Indentation: the recursive walk threads an `indent` string so nested
 *  `if`/`else` branches indent correctly. The caller adds the leading indent
 *  for the surrounding function body. */

import { isPostfixMutationOperator, isSupportedAssignOperator } from '../assignment-operators.js';
import { collectClosureBlockCallTexts } from '../closure-eligibility.js';
import type { ExprEmitContext } from '../codegen-expression.js';
import { emitExpression } from '../codegen-expression.js';
import { parseExpression } from '../parser-expression.js';
import type { ExprObject, IRNode } from '../types.js';
import { typescriptClosureClassifier, validateClosureBlockHostNamespacesTS } from '../typescript-closure-classifier.js';
import { isParenthesized, type ValueIR } from '../value-ir.js';

/** A regex-literal IR node — the value recorded in the TS regex-binding table. */
type RegexLitIR = Extract<ValueIR, { kind: 'regexLit' }>;
type ArrayBindingStatus = 'fresh' | 'fresh-push' | 'stale' | 'captured';

// Slice 0.9 — TS codegen is Node-only; it re-parses raw block-bodied arrow prop
// values, so it injects the TypeScript-backed closure classifier. `parseExpr` is
// the local binding all `parseExpression` calls in this module route through.
const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };
function parseExpr(input: string): ReturnType<typeof parseExpression> {
  return parseExpression(input, TS_PARSE_OPTS);
}

import { emitFmtTemplate, emitIdentifier, emitTypeAnnotation } from './emitters.js';
import { emitStringKeyArray, parseKeys } from './ground-layer.js';
import { REGEX_NONLITERAL_FAILCLOSE, regexMethodRegexArgIdent } from './regex-normalize.js';
import { emitParamList } from './type-system.js';

/** Slice 3e — caller-provided options, parity with the Python body emitter.
 *  `symbolMap` is currently unused on the TS target; reserved for future
 *  use (e.g., reserved-word renames).
 *
 *  `stateBindings` — names of surrounding-scope React `useState` bindings
 *  (the screen's `state name=…` declarations). The body emitter treats
 *  these as `cell`-kind bindings in an outer scope so that
 *  `assign target=count value=...` inside a callback/memo/effect lowers to
 *  the matching `setCount(...)` setter rather than emitting an illegal
 *  reassignment of the `const` returned by `useState`. */
export interface BodyEmitOptions {
  symbolMap?: Record<string, string>;
  stateBindings?: ReadonlyArray<string>;
  /**
   * Opt-in trace-hook injection for the IR-semantics differential harness.
   * Not used by production codegen. When `eachIterNext` is true, the `each`
   * loop emits a `__kernTrace({op:'iter-next', binding, value})` call as the
   * first statement inside each loop iteration — after the target runtime has
   * accepted the next iteration value and KERN bindings have been
   * established, before the loop body's first child executes.
   *
   * `letAssign` is shared by the `let` (declaration) and `assign`
   * (reassignment) contracts — both emit a `__kernTrace({op:'assign', target,
   * value})` call after the binding is written, on identifier targets only.
   *
   * Scoped per-flag. Adding hooks for other nodes is an explicit spec
   * revision and a new flag.
   */
  traceHooks?: { eachIterNext?: boolean; forIterNext?: boolean; letAssign?: boolean };
}

/** Slice 3e — public return shape, parity with the Python body emitter.
 *  TS's KERN-stdlib lowerings don't currently demand any imports; the
 *  `imports` set will typically be empty until a future slice introduces
 *  TS-stdlib entries with `requires.ts` (e.g., a `node:crypto` import). */
export interface BodyEmitResult {
  code: string;
  imports: Set<string>;
}

interface BodyEmitContext {
  gensymCounter: number;
  localScopes: Array<Map<string, 'const' | 'let' | 'cell'>>;
  /** Slice-3b parity fix — per-scope regex-literal binding table, index-aligned
   *  with `localScopes`. Mirrors the Python target's `regexScopes`: when a `let`
   *  binds a direct regex literal (`let re = /…/`), we record the `regexLit` IR
   *  so a downstream `s.match(re)` can resolve the ident to its literal and lower
   *  through the SAME canonical adapter/fail-close a direct `s.match(/…/)` uses.
   *  Without this, TS emitted raw `s.match(re)` while Python canonical-lowered
   *  the let-bound regex — a cross-target divergence. A non-regex `let` (or a
   *  reassignment to a non-regex) records `null`, masking any outer binding. */
  regexScopes: Array<Map<string, RegexLitIR | null>>;
  /** Nested-values slice-1 — per-scope RECORD-LITERAL binding table, index-
   *  aligned with `localScopes` (same lifecycle as `regexScopes`). `true` when
   *  a `let`/`expression-v1` bound a DIRECT object literal (`let r = {...}`).
   *  The nested-record-field rewrite in `emitExpression` applies ONLY to
   *  idents this table proves are records — any other two-level chain
   *  (`this.data.filter(...)`, object params) keeps its base verbatim
   *  emission. Reassignment re-derives the flag (`rebindRecordOnReassign`). */
  recordScopes: Array<Map<string, boolean>>;
  /** Fields proven to be array-valued on every reachable branch; used for read lowering. */
  recordArrayFieldScopes: Array<Map<string, Set<string> | null>>;
  /** Array fields whose elements are proven scalar on every reachable branch; used for `each r.field`. */
  recordScalarArrayFieldScopes: Array<Map<string, Set<string> | null>>;
  /** Fields that may be array-valued/captured on any reachable branch; used only to reject mutations/recapture. */
  maybeRecordArrayFieldScopes: Array<Map<string, Set<string> | null>>;
  arrayBindingScopes: Array<Map<string, ArrayBindingStatus>>;
  scalarArrayBindingScopes: Array<Map<string, boolean>>;
  loopScopeIndexes: number[];
  /** Slice 4c review fix (OpenCode + Gemini critical) — depth of nested
   *  `try` blocks the emitter is currently inside. Propagation `?` lowers
   *  to a `return` that exits the function — that bypasses the enclosing
   *  `catch`, which is almost never what users mean. Increment on try
   *  entry, decrement on try exit; the let/return propagation paths
   *  check `tryDepth > 0` and throw with a let-bind hint. */
  tryDepth: number;
  /** Depth of nested `finally` blocks. Propagation from finally would
   *  override pending control flow, so it gets a finally-specific error. */
  finallyDepth: number;
  /** Differential harness opt-in (see BodyEmitOptions.traceHooks). */
  traceHooks?: { eachIterNext?: boolean; forIterNext?: boolean; letAssign?: boolean };
  /** DECIMAL Slice 2 (Finding A) — PER-EMISSION import-requirement sink. Threaded
   *  into the expression emitter via `exprCtxFor` so a stdlib lowering that
   *  declares `requires.ts` (currently only the Decimal namespace, which needs the
   *  EXTERNAL `decimal.js` npm package) surfaces that requirement out of the body
   *  emitter. ONE set per `emitNativeKernBodyTSWithImports` call (constructed fresh
   *  alongside the rest of the context), NEVER module-global — so a body that does
   *  NOT use Decimal returns an EMPTY set and never leaks a `decimal.js` import into
   *  a generated file that doesn't need it. */
  imports: Set<string>;
}

const INDENT_STEP = '  ';

/** Emit the body of a native KERN handler as TypeScript source. Returns
 *  the joined body text. Each top-level line is unindented; nested
 *  branches indent by 2 spaces per level.
 *
 *  Legacy slice 1/2 signature — returns just the code string. Callers
 *  that also need the import set (slice 3b parity with Python) should
 *  use `emitNativeKernBodyTSWithImports`. */
export function emitNativeKernBodyTS(handlerNode: IRNode, options?: BodyEmitOptions): string {
  return emitNativeKernBodyTSWithImports(handlerNode, options).code;
}

/** Slice 3e — context-aware variant returning `{ code, imports }`.
 *  TS's KERN-stdlib lowerings don't currently demand any imports; the
 *  `imports` set will typically be empty until a future slice introduces
 *  TS-stdlib entries with `requires.ts` (e.g., a `node:crypto` import).
 *  Provided for symmetry with the Python target so generators that drive
 *  both languages have a uniform call shape. */
export function emitNativeKernBodyTSWithImports(handlerNode: IRNode, options?: BodyEmitOptions): BodyEmitResult {
  // DECIMAL Slice 2 (Finding A) — fresh PER-EMISSION import sink. The expression
  // emitter records `requires.ts` requirements (e.g. `decimal.js`) into this set
  // via `exprCtxFor`; it is returned below so a `lang="kern"` handler body that
  // uses `Decimal.of`/`Decimal.add`/… surfaces the import a generator must render.
  const imports = new Set<string>();
  const ctx: BodyEmitContext = {
    gensymCounter: 0,
    localScopes: [],
    regexScopes: [],
    recordScopes: [],
    recordArrayFieldScopes: [],
    recordScalarArrayFieldScopes: [],
    maybeRecordArrayFieldScopes: [],
    arrayBindingScopes: [],
    scalarArrayBindingScopes: [],
    loopScopeIndexes: [],
    tryDepth: 0,
    finallyDepth: 0,
    traceHooks: options?.traceHooks,
    imports,
  };
  // Outer scope carrying caller-supplied state bindings as `cell` so the
  // setter-rewrite path in emitAssignTS fires for surrounding-scope
  // useState bindings (parent screen's `state name=…`).
  if (options?.stateBindings && options.stateBindings.length > 0) {
    const outer = new Map<string, 'const' | 'let' | 'cell'>();
    for (const name of options.stateBindings) outer.set(name, 'cell');
    ctx.localScopes.push(outer);
    // Index-align `regexScopes` with `localScopes`: state bindings are never
    // regex literals (they come from `state name=…`), so seed them as null.
    const outerRegex = new Map<string, RegexLitIR | null>();
    for (const name of options.stateBindings) outerRegex.set(name, null);
    ctx.regexScopes.push(outerRegex);
    // Index-align `recordScopes` too: state bindings are never record literals.
    ctx.recordScopes.push(new Map(options.stateBindings.map((name) => [name, false])));
    ctx.recordArrayFieldScopes.push(new Map(options.stateBindings.map((name) => [name, null])));
    ctx.recordScalarArrayFieldScopes.push(new Map(options.stateBindings.map((name) => [name, null])));
    ctx.maybeRecordArrayFieldScopes.push(new Map(options.stateBindings.map((name) => [name, null])));
    ctx.arrayBindingScopes.push(new Map());
    ctx.scalarArrayBindingScopes.push(new Map());
  }
  const code = emitChildrenTS(handlerNode.children ?? [], ctx, '').join('\n');
  return { code, imports };
}

/** Body-statement node types that map to a SINGLE emitted line and may carry
 *  an inline same-line trailing comment (`stmt; // note`) captured by the
 *  migrator into a `trailingComment=` prop. Compound statements (if/while/for/
 *  try/each) emit multiple lines and never receive the slot. */
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
  'print',
  'do',
  'continue',
  'break',
]);

function childrenCanFallThrough(children: readonly IRNode[]): boolean {
  for (const child of children) {
    if (child.type === 'return' || child.type === 'throw' || child.type === 'break' || child.type === 'continue') {
      return false;
    }
  }
  return true;
}

function emitChildrenTS(
  children: IRNode[],
  ctx: BodyEmitContext,
  indent: string,
  initialBindings: Array<[string, 'const' | 'let' | 'cell']> = [],
  isLoopBody = false,
): string[] {
  const lines: string[] = [];
  ctx.localScopes.push(new Map(initialBindings));
  // Index-aligned regex/record binding scopes (initial bindings are neither).
  ctx.regexScopes.push(new Map(initialBindings.map(([name]) => [name, null])));
  ctx.recordScopes.push(new Map(initialBindings.map(([name]) => [name, false])));
  ctx.recordArrayFieldScopes.push(new Map(initialBindings.map(([name]) => [name, null])));
  ctx.recordScalarArrayFieldScopes.push(new Map(initialBindings.map(([name]) => [name, null])));
  ctx.maybeRecordArrayFieldScopes.push(new Map(initialBindings.map(([name]) => [name, null])));
  ctx.arrayBindingScopes.push(new Map());
  ctx.scalarArrayBindingScopes.push(new Map());
  if (isLoopBody) ctx.loopScopeIndexes.push(ctx.localScopes.length - 1);
  try {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const trailStart = lines.length;
      if (child.type === 'comment') {
        for (const line of emitCommentTS(child)) lines.push(`${indent}${line}`);
      } else if (child.type === 'cell') {
        for (const line of emitCellTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'set') {
        for (const line of emitSetTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'let') {
        for (const line of emitLetTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'expression-v1') {
        for (const line of emitExpressionV1TS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'fn') {
        for (const line of emitFnTS(child, ctx, indent)) lines.push(line);
      } else if (child.type === 'capability') {
        throw new Error(
          'capability nodes are not supported in emitted TypeScript/Python until an emitted capability ABI exists',
        );
      } else if (child.type === 'assign') {
        for (const line of emitAssignTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'destructure') {
        for (const line of emitDestructureTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'fmt') {
        for (const line of emitFmtTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'clamp') {
        for (const line of emitClampTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'firstTruthy') {
        for (const line of emitFirstTruthyTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'coalesce' || child.type === 'firstDefined') {
        for (const line of emitCoalesceTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'objectMerge') {
        for (const line of emitObjectMergeTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'objectOmit') {
        for (const line of emitObjectOmitTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'objectPick') {
        for (const line of emitObjectPickTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'return') {
        for (const line of emitReturnTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'print') {
        for (const line of emitPrintTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'if') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpr(condRaw);
        // Slice-2 review fix: propagation `?` in an `if` condition has no
        // sensible single-line lowering; reject early with a clear message
        // pointing users at the let-bind workaround.
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}if (${emitValueTS(condIR, ctx)}) {`);
        const branchBase = cloneBranchBindingScopes(ctx);
        const branchOutcomes: BranchBindingSnapshot[] = [];
        let remainingBranchReachable = !isStaticBooleanLiteral(condIR, true);
        restoreBranchBindingScopes(ctx, branchBase);
        for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP)) lines.push(sl);
        if (!isStaticBooleanLiteral(condIR, false) && childrenCanFallThrough(child.children ?? [])) {
          branchOutcomes.push(cloneBranchBindingScopes(ctx));
        }
        // Walk the `else` chain so byte-equivalent `else if` chains compile back
        // out as `else if (...)` instead of `else { if (...) {...} else {...} }`.
        // Recognised shapes for `else`:
        //   1. else > [if, else_inner]  → chain: `} else if (cond) {...`, recurse on else_inner
        //   2. else > [if]              → terminal chain: `} else if (cond) {...}` (no else)
        //   3. else > anything else     → plain `} else { ... }`, chain ends
        // Slice 5b's migration emits shape 1/2; hand-written KERN can use any.
        let elseCandidate: IRNode | undefined = children[i + 1];
        if (elseCandidate?.type === 'else') i++;
        let hasTerminalElse = false;
        while (elseCandidate && elseCandidate.type === 'else') {
          const ec: IRNode[] = elseCandidate.children ?? [];
          const isChainable =
            ec.length >= 1 && ec[0].type === 'if' && (ec.length === 1 || (ec.length === 2 && ec[1].type === 'else'));
          if (isChainable) {
            restoreBranchBindingScopes(ctx, branchBase);
            const ifNode = ec[0];
            const nestedCondRaw = String(ifNode.props?.cond ?? '');
            const nestedCondIR = parseExpr(nestedCondRaw);
            if (nestedCondIR.kind === 'propagate') {
              throw new Error(
                "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
              );
            }
            lines.push(`${indent}} else if (${emitValueTS(nestedCondIR, ctx)}) {`);
            for (const sl of emitChildrenTS(ifNode.children ?? [], ctx, indent + INDENT_STEP)) lines.push(sl);
            if (
              remainingBranchReachable &&
              !isStaticBooleanLiteral(nestedCondIR, false) &&
              childrenCanFallThrough(ifNode.children ?? [])
            ) {
              branchOutcomes.push(cloneBranchBindingScopes(ctx));
            }
            if (isStaticBooleanLiteral(nestedCondIR, true)) remainingBranchReachable = false;
            elseCandidate = ec.length === 2 ? ec[1] : undefined;
          } else {
            restoreBranchBindingScopes(ctx, branchBase);
            lines.push(`${indent}} else {`);
            for (const el of emitChildrenTS(ec, ctx, indent + INDENT_STEP)) lines.push(el);
            if (remainingBranchReachable && childrenCanFallThrough(ec))
              branchOutcomes.push(cloneBranchBindingScopes(ctx));
            hasTerminalElse = true;
            remainingBranchReachable = false;
            break;
          }
        }
        lines.push(`${indent}}`);
        if (!hasTerminalElse && remainingBranchReachable) branchOutcomes.push(branchBase);
        mergeBranchBindingSnapshots(ctx, branchBase, branchOutcomes);
      } else if (child.type === 'else') {
        // Slice-2 review fix: orphan `else` (without a preceding `if` sibling)
        // is a structural error — silently dropping it produced confusing
        // miscompiles. The `if` arm above consumes its paired `else` via i++,
        // so reaching one here means it was orphaned.
        throw new Error('`else` must immediately follow an `if` sibling. Found orphan `else` in handler body.');
      } else if (child.type === 'while') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpr(condRaw);
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `while cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}while (${emitValueTS(condIR, ctx)}) {`);
        for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP, [], true)) lines.push(sl);
        lines.push(`${indent}}`);
      } else if (child.type === 'for') {
        for (const line of emitRangeForTS(child, ctx, indent)) lines.push(line);
      } else if (child.type === 'with') {
        for (const line of emitWithTS(child, ctx, indent)) lines.push(line);
      } else if (child.type === 'try') {
        // Slice 4c — try/catch control flow.
        //
        // Slice 5a deferred-fix (Codex P2-2): the schema declares
        // `try.allowedChildren = ['step', 'handler', 'catch']` — `catch` is a
        // CHILD of `try`, NOT a sibling. The previous body-emit read `catch`
        // as a sibling, which (a) put it out of step with the validator
        // (schema-compliant `try { catch { … } }` shape couldn't body-emit at
        // all because validator rejected the legacy sibling shape first) and
        // (b) silently mis-handled schema-compliant source if the validator
        // was bypassed. Read child `catch` here to match the schema; treat
        // legacy sibling shape as orphan since callers writing schema-valid
        // IR will never emit it.
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
        // Slice 5a deferred-fix (Codex): the schema allows `step` and `handler`
        // as `try` children for the *async orchestration* form (`try name=…`),
        // not for body-statement try/catch. Body-emit only knows how to emit
        // body-statements (let/return/if/each/throw/nested try). Reject the
        // orchestration-only nodes loudly instead of silently dropping them
        // through the unmatched-child path in emitChildrenTS.
        const orchestrationChild = tryBlockChildren.find((c) => c.type === 'step' || c.type === 'handler');
        if (orchestrationChild) {
          throw new Error(
            `\`${orchestrationChild.type}\` is only valid inside an async-orchestration \`try name=…\` block, not inside a body-statement \`try\`. Move the steps into the surrounding fn or use a structured orchestration block.`,
          );
        }
        lines.push(`${indent}try {`);
        ctx.tryDepth++;
        for (const sl of emitChildrenTS(tryBlockChildren, ctx, indent + INDENT_STEP)) lines.push(sl);
        ctx.tryDepth--;
        if (catchNode !== null) {
          const errName = String(catchNode.props?.name ?? 'e');
          // Optional `catch name=err type=any|unknown` — emit the type
          // annotation so strict-mode TS doesn't reject `err.foo` accesses.
          // TypeScript only allows `any` or `unknown` for catch parameter
          // annotations; anything else would emit invalid TS, so reject it
          // at codegen rather than letting tsc fail downstream.
          const rawCatchType = catchNode.props?.type;
          const errType = (() => {
            if (rawCatchType === undefined || rawCatchType === '') return '';
            const t = String(rawCatchType).trim();
            if (t !== 'any' && t !== 'unknown') {
              throw new Error(
                `\`catch\` type annotation must be \`any\` or \`unknown\` — got \`${t}\`. TypeScript does not allow other catch parameter types.`,
              );
            }
            return `: ${t}`;
          })();
          lines.push(`${indent}} catch (${errName}${errType}) {`);
          for (const cl of emitChildrenTS(catchNode.children ?? [], ctx, indent + INDENT_STEP, [[errName, 'let']])) {
            lines.push(cl);
          }
        }
        if (finallyNode !== null) {
          lines.push(`${indent}} finally {`);
          ctx.finallyDepth++;
          for (const fl of emitChildrenTS(finallyNode.children ?? [], ctx, indent + INDENT_STEP)) lines.push(fl);
          ctx.finallyDepth--;
        }
        lines.push(`${indent}}`);
      } else if (child.type === 'catch') {
        throw new Error('`catch` must be a child of `try`. Found top-level `catch` in handler body.');
      } else if (child.type === 'finally') {
        throw new Error('`finally` must be a child of `try`. Found top-level `finally` in handler body.');
      } else if (child.type === 'throw') {
        // Slice 4c — throw statement.
        for (const line of emitThrowTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'do') {
        for (const line of emitDoTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'continue') {
        lines.push(`${indent}continue;`);
      } else if (child.type === 'break') {
        lines.push(`${indent}break;`);
      } else if (child.type === 'each') {
        // Slice 4d — each loop.
        // Slice 4c+4d review fix (Codex P1): the schema's `each` already
        // declares `name` (binding) and `in` (iterable expression). The
        // earlier slice-4d body-emit read `list`/`as` instead, which meant
        // (a) schema-validated source `each name=x in=items` fell back to
        // `for (const item of [])` (empty list, wrong binding) and
        // (b) tests that used `list`/`as` failed schema validation.
        // Read schema-compliant `name`/`in` first; accept legacy
        // `list`/`as` as a fallback for tests that pre-date this fix.
        const listRaw = String(child.props?.in ?? child.props?.list ?? '[]');
        const listIR = parseExpr(listRaw);
        // 2026-05-06 — pair-mode (`pairKey=k pairValue=v`) emits Map/iterable-of-pairs
        // destructuring `for (const [k, v] of m)`. Index-mode (`index=i`) emits
        // `for (const [i, x] of xs.entries())`. Default form is `for (const x of xs)`.
        // Schema/cross-prop rules already enforce mutual exclusion; here we
        // dispatch on shape only.
        const pairKey = child.props?.pairKey;
        const pairValue = child.props?.pairValue;
        const entryKey = child.props?.entryKey;
        const entryValue = child.props?.entryValue;
        const isAwait = child.props?.await === true || child.props?.await === 'true';
        const entriesMode = child.props?.entries === true || child.props?.entries === 'true';
        const awaitPrefix = isAwait ? ' await' : '';
        const rawItemType = child.props?.type;
        const loopBindings: Array<[string, 'const' | 'let']> = [];
        // Differential-harness `iter-next` hook. Computed per branch so the
        // primary binding (the value, not the key/index) is reported.
        let primaryBinding: string | null = null;
        if (pairKey && pairValue) {
          if (entriesMode && isAwait) {
            throw new Error('body-statement `each entries=true` cannot be combined with `await=true`.');
          }
          if (rawItemType !== undefined && rawItemType !== '') {
            throw new Error('body-statement `each type=` cannot be combined with pair-mode `pairKey=`/`pairValue=`.');
          }
          loopBindings.push([String(pairKey), 'const'], [String(pairValue), 'const']);
          assertNoKeyedNestedRecordReceiverTS(listIR, ctx);
          const sourceExpr = emitEachIterableTS(listIR, ctx);
          const iterableExpr = entriesMode ? `Object.entries(${sourceExpr})` : sourceExpr;
          lines.push(
            `${indent}for${awaitPrefix} (const [${String(pairKey)}, ${String(pairValue)}] of ${iterableExpr}) {`,
          );
          primaryBinding = String(pairValue);
        } else if (entryKey || entryValue) {
          if (entriesMode && isAwait) {
            throw new Error('body-statement `each entries=true` cannot be combined with `await=true`.');
          }
          if (!entriesMode) {
            throw new Error('body-statement `each entryKey=`/`entryValue=` requires `entries=true`.');
          }
          if (isAwait) {
            throw new Error('body-statement `each await=true` cannot be combined with `entryKey=`/`entryValue=`.');
          }
          if (rawItemType !== undefined && rawItemType !== '') {
            throw new Error('body-statement `each type=` cannot be combined with keyed-entry modes.');
          }
          assertNoKeyedNestedRecordReceiverTS(listIR, ctx);
          const sourceExpr = emitEachIterableTS(listIR, ctx);
          const iterableExpr = `Object.entries(${sourceExpr})`;
          if (entryKey && entryValue) {
            throw new Error('body-statement `each` cannot combine `entryKey=` and `entryValue=`.');
          }
          if (entryKey) {
            const keyName = String(entryKey);
            loopBindings.push([keyName, 'const']);
            lines.push(`${indent}for (const [${keyName}] of ${iterableExpr}) {`);
            primaryBinding = keyName;
          } else {
            const valueName = String(entryValue);
            loopBindings.push([valueName, 'const']);
            lines.push(`${indent}for (const [, ${valueName}] of ${iterableExpr}) {`);
            primaryBinding = valueName;
          }
        } else if (child.props?.index) {
          const itemType = rawItemType ? emitTypeAnnotation(String(rawItemType), 'unknown', child) : '';
          const idxName = String(child.props.index);
          const asName = String(child.props?.name ?? child.props?.as ?? 'item');
          if (isAwait) {
            throw new Error('body-statement `each await=true` cannot be combined with `index=`.');
          }
          const typeAnn = itemType ? `: [number, ${itemType}]` : '';
          loopBindings.push([idxName, 'const'], [asName, 'const']);
          lines.push(
            `${indent}for (const [${idxName}, ${asName}]${typeAnn} of (${emitEachIterableTS(listIR, ctx)}).entries()) {`,
          );
          primaryBinding = asName;
        } else {
          const itemType = rawItemType ? emitTypeAnnotation(String(rawItemType), 'unknown', child) : '';
          const asName = String(child.props?.name ?? child.props?.as ?? 'item');
          const typeAnn = itemType ? `: ${itemType}` : '';
          loopBindings.push([asName, 'const']);
          lines.push(`${indent}for${awaitPrefix} (const ${asName}${typeAnn} of ${emitEachIterableTS(listIR, ctx)}) {`);
          primaryBinding = asName;
        }
        if (ctx.traceHooks?.eachIterNext) {
          // Fires AFTER the target accepted the next iteration value and the
          // KERN binding was established (destructuring complete), BEFORE the
          // first child statement runs. This is the canonical event-location
          // rule per the IR-semantics spec — see packages/core/src/ir/semantics/each.ts.
          //
          // Throwing on null forces every `each` shape branch to set
          // primaryBinding. If a new shape is added without extending the
          // hook, the differential harness fails loud rather than silently
          // skipping iter-next events.
          if (primaryBinding === null) {
            throw new Error('emitEach: traceHooks.eachIterNext set but no primaryBinding for this each shape');
          }
          lines.push(
            `${indent}${INDENT_STEP}__kernTrace({op:'iter-next',binding:${JSON.stringify(primaryBinding)},value:${primaryBinding}});`,
          );
        }
        for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP, loopBindings, true)) {
          lines.push(sl);
        }
        lines.push(`${indent}}`);
      } else if (child.type === 'branch') {
        // 2026-05-06 — body-statement `branch` lowers to a TS `switch`. Distinct
        // emit path from top-level `generateBranch` (codegen-core.ts:420) which
        // is reached only outside body-stmt scope.
        //
        // path quote handling: `value` is `kind: 'string'` so the parser stores
        // the textual prop. Quoted source (`path value="paid"`) carries
        // `__quotedProps` containing `value`; unquoted (`path value=Status.Paid`)
        // does not. Codex review-fix: use `JSON.stringify` for quoted form so
        // backslashes/apostrophes/escapes survive (the original top-level
        // emitter's `case '${value}':` is sloppy and we don't reuse it here).
        for (const line of emitBranchTS(child, ctx, indent)) lines.push(line);
      }
      // Other child types fall through silently — slice 3 adds more.

      // W1 — re-attach an inline same-line trailing comment (captured by the
      // migrator as `trailingComment=`) to the simple statement's last line so
      // `stmt; // note` round-trips byte-clean instead of dropping the comment.
      const trailingComment = child.props?.trailingComment;
      if (
        typeof trailingComment === 'string' &&
        trailingComment !== '' &&
        lines.length === trailStart + 1 && // exactly one line emitted (a true single-line stmt)
        TRAILING_COMMENT_TYPES.has(child.type)
      ) {
        lines[lines.length - 1] += ` ${trailingComment}`;
      }
    }
  } finally {
    if (isLoopBody) ctx.loopScopeIndexes.pop();
    ctx.localScopes.pop();
    ctx.regexScopes.pop();
    ctx.recordScopes.pop();
    ctx.recordArrayFieldScopes.pop();
    ctx.recordScalarArrayFieldScopes.pop();
    ctx.maybeRecordArrayFieldScopes.pop();
    ctx.arrayBindingScopes.pop();
    ctx.scalarArrayBindingScopes.pop();
  }
  return lines;
}

function emitRangeForTS(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
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
  const fromExpr = emitValueTS(fromIR, ctx);
  const toExpr = emitValueTS(toIR, ctx);
  const stepExpr = emitValueTS(stepIR, ctx);
  const stepValue = parseRangeStepLiteral(rawStep);
  const update = stepValue === 1 ? `${name}++` : stepValue === -1 ? `${name}--` : `${name} += ${stepExpr}`;
  const compare = stepValue > 0 ? '<' : '>';
  const startVar = `__k_for_start_${++ctx.gensymCounter}`;
  const endVar = `__k_for_end_${++ctx.gensymCounter}`;
  const lines = [`${indent}const ${startVar} = ${fromExpr};`, `${indent}const ${endVar} = ${toExpr};`];
  lines.push(`${indent}for (let ${name} = ${startVar}; ${name} ${compare} ${endVar}; ${update}) {`);
  if (ctx.traceHooks?.forIterNext) {
    lines.push(`${indent}${INDENT_STEP}__kernTrace({op:'iter-next',binding:${JSON.stringify(name)},value:${name}});`);
  }
  for (const sl of emitChildrenTS(node.children ?? [], ctx, indent + INDENT_STEP, [[name, 'const']], true)) {
    lines.push(sl);
  }
  lines.push(`${indent}}`);
  return lines;
}

function emitWithTS(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
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
  if (protocol === 'with') {
    throw new Error(
      'body-statement `with protocol=with` is Python-only — TypeScript has no native context-manager statement. Drop protocol= for try/finally lowering, or restrict the .kern file to Python target.',
    );
  }
  if (rawCleanup === undefined || rawCleanup === '') throw new Error('body-statement `with` requires `cleanup=`.');
  const isAsync = props.async === true || props.async === 'true';

  const name = emitIdentifier(String(rawName), 'with', node);

  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in `with value=` or `with cleanup=` — bind to `let` first.");
  }
  const acquirePrefix = isAsync ? 'await ' : '';
  const acquireExpr = emitValueTS(valueIR, ctx);

  declareLocalBinding(ctx, name, 'const');

  const cleanupIR = parseExpr(String(rawCleanup));
  if (cleanupIR.kind === 'propagate') {
    throw new Error("Propagation '?' is not allowed in `with value=` or `with cleanup=` — bind to `let` first.");
  }

  const cleanupPrefix = isAsync ? 'await ' : '';
  const lines = [`${indent}const ${name} = ${acquirePrefix}${acquireExpr};`, `${indent}try {`];
  for (const sl of emitChildrenTS(node.children ?? [], ctx, indent + INDENT_STEP, [[name, 'const']])) lines.push(sl);
  lines.push(`${indent}} finally {`);
  lines.push(`${indent}${INDENT_STEP}${cleanupPrefix}${emitValueTS(cleanupIR, ctx)};`);
  lines.push(`${indent}}`);
  return lines;
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

function validateRangeLoopIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('body-statement `for name=` must be a cross-target identifier.');
  }
}

function emitBranchTS(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
  const onRaw = String(node.props?.on ?? '');
  if (onRaw === '') {
    throw new Error('`branch` requires an `on=` expression in body-statement context.');
  }
  const onIR = parseExpr(onRaw);
  const out: string[] = [];
  out.push(`${indent}switch (${emitValueTS(onIR, ctx)}) {`);
  const inner = indent + INDENT_STEP;
  const innerBody = inner + INDENT_STEP;
  for (const child of node.children ?? []) {
    if (child.type !== 'path') continue;
    const isDefault = child.props?.default === true || child.props?.default === 'true';
    if (isDefault) {
      out.push(`${inner}default: {`);
    } else {
      const rawValue = child.props?.value;
      const valueText = rawValue === undefined ? '' : String(rawValue);
      const isIdentifier = !child.__quotedProps?.includes('value');
      const lit = isIdentifier ? valueText : JSON.stringify(valueText);
      out.push(`${inner}case ${lit}: {`);
    }
    for (const sl of emitChildrenTS(child.children ?? [], ctx, innerBody)) out.push(sl);
    out.push(`${innerBody}break;`);
    out.push(`${inner}}`);
  }
  out.push(`${indent}}`);
  return out;
}

/** Slice 4c review fix (OpenCode + Gemini critical) — propagation `?`
 *  inside a `try` block has no clean lowering. The hoisted err-branch
 *  emits `return tmp` which exits the function entirely, BYPASSING the
 *  enclosing `catch`. That's almost never what users mean — they wrote
 *  `?` to flag a Result.err and (presumably) to let the catch handle
 *  it. Reject at codegen with a let-bind hint. Same shape as
 *  slice-2's reject-`?`-in-`if-cond` rule. Propagation inside `finally`
 *  gets a sharper diagnostic because it would override pending control
 *  flow from the protected block. */
function rejectPropagationInsideTry(ctx: BodyEmitContext): void {
  if (ctx.tryDepth > 0) {
    throw new Error(
      "Propagation '?' is not allowed inside a `try` block — `return` from the err branch exits the function and bypasses the enclosing `catch`. " +
        'Bind the call to a `let` outside the try, then use `if x.kind === "err" throw new Error(...)` inside the try, OR use raw `lang=ts`/`lang=python` for the affected handler.',
    );
  }
  if (ctx.finallyDepth > 0) {
    throw new Error(
      "Propagation '?' is not allowed inside a `finally` block — `return` from the err branch overrides the pending exception/return/break/continue from the protected block. " +
        'Bind the call to a `let` outside the `try` if you need conditional fallthrough, OR use raw `lang=ts`/`lang=python` for the affected handler.',
    );
  }
}

function emitLetTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '_');
  const bindingKind = bodyLetBindingKind(props.kind);
  declareLocalBinding(ctx, name, bindingKind);
  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    // No initializer — emit a bare `let x;` (TS's own form for uninitialised
    // bindings). The previous form `let x: T = undefined;` fails strict TS
    // when `T` doesn't include `undefined` (Codex review fix), so always
    // emit the declaration-only shape. `const` without an initializer is
    // illegal in TS; reject it loudly rather than emit invalid code.
    if (bindingKind === 'const') {
      throw new Error(
        `body-statement \`let name=${name}\` without \`value=\` requires \`kind=let\` (\`const\` needs an initializer).`,
      );
    }
    return [`${bindingKind} ${name}${typeAnn};`];
  }
  const valueIR = parseExpr(String(rawValue));
  // Slice-3b parity: record a direct regex-literal binding so a later
  // `s.match(re)` resolves the ident to its literal and lowers canonically
  // (matches Python's `setRegexBinding(ctx, userName, regexLit|null)`).
  setRegexBinding(ctx, name, valueIR.kind === 'regexLit' ? valueIR : null);
  setRecordBinding(
    ctx,
    name,
    valueIR.kind === 'objectLit',
    recordArrayFieldsForValue(valueIR, ctx),
    recordScalarArrayFieldsForValue(valueIR, ctx),
  );
  bindArrayStatusFromLet(ctx, name, valueIR);
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitValueTS(valueIR.argument, ctx);
    const lines = [
      `const ${tmp} = ${inner};`,
      `if (${tmp}.kind === 'err') return ${tmp};`,
      `${bindingKind} ${name}${typeAnn} = ${tmp}.value;`,
    ];
    if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
    return lines;
  }
  const lines = [`${bindingKind} ${name}${typeAnn} = ${emitValueTS(valueIR, ctx)};`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
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

function emitClampTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `clamp` requires `name=`.');
  declareLocalBinding(ctx, name, 'const');

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

  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const lines = [
    `const ${name}${typeAnn} = Math.max(${emitValueTS(minIR, ctx)}, Math.min(${emitValueTS(maxIR, ctx)}, ${emitValueTS(valueIR, ctx)}));`,
  ];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitFirstTruthyTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `firstTruthy` requires `name=`.');
  declareLocalBinding(ctx, name, 'const');

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
    return emitFirstTruthyOperandTS(valueIR, ctx);
  });

  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const lines = [`const ${name}${typeAnn} = ${emitted.join(' || ')};`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitCoalesceTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  const type = node.type;
  if (!name) throw new Error(`body-statement \`${type}\` requires \`name=\`.`);
  declareLocalBinding(ctx, name, 'const');

  const rawValues = unwrapBodyExpr(props.values);
  if (rawValues === undefined || rawValues === '') {
    throw new Error(`body-statement \`${type}\` requires \`values=\`.`);
  }
  const values = splitBodyExpressionList(rawValues, `${type} values=`);
  if (values.length < 2) throw new Error(`body-statement \`${type}\` requires at least two value expressions.`);

  const emitted = values.map((value) => {
    const valueIR = parseExpr(value);
    if (valueIR.kind === 'propagate') {
      throw new Error(`Propagation '?' is not allowed in \`${type} values=\` — bind the value to a \`let\` first.`);
    }
    return emitCoalesceOperandTS(valueIR, ctx);
  });

  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const lines = [`const ${name}${typeAnn} = ${emitted.join(' ?? ')};`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitCoalesceOperandTS(valueIR: ValueIR, ctx: BodyEmitContext): string {
  const emitted = emitValueTS(valueIR, ctx);
  return valueIR.kind === 'conditional' || valueIR.kind === 'binary' ? `(${emitted})` : emitted;
}

function emitFirstTruthyOperandTS(valueIR: ValueIR, ctx: BodyEmitContext): string {
  const emitted = emitValueTS(valueIR, ctx);
  return valueIR.kind === 'conditional' ? `(${emitted})` : emitted;
}

function emitObjectMergeTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `objectMerge` requires `name=`.');
  declareLocalBinding(ctx, name, 'const');

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
    emitted.push(`...(${emitValueTS(sourceIR, ctx)})`);
  }

  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'Record<string, unknown>', node)}` : '';
  const lines = [`const ${name}${typeAnn} = { ${emitted.join(', ')} };`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitObjectPickTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `objectPick` requires `name=`.');
  declareLocalBinding(ctx, name, 'const');

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
  const inExpr = emitValueTS(inIR, ctx);

  const keysList = parseKeys(rawKeys, node, 'objectPick keys=');
  const formattedKeys = emitStringKeyArray(keysList);

  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'Record<string, unknown>', node)}` : '';
  const lines = [
    `const ${name}${typeAnn} = ((__kernSource: any) => Object.fromEntries(${formattedKeys}.map((key) => [key, Object.prototype.hasOwnProperty.call(__kernSource, key) ? __kernSource[key] : null])))(${inExpr});`,
  ];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitObjectOmitTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `objectOmit` requires `name=`.');
  declareLocalBinding(ctx, name, 'const');

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
  const inExpr = emitValueTS(inIR, ctx);

  const keysList = parseKeys(rawKeys, node, 'objectOmit keys=');
  const formattedKeys = emitStringKeyArray(keysList);

  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'Record<string, unknown>', node)}` : '';
  const lines = [
    `const ${name}${typeAnn} = Object.fromEntries(Object.entries(${inExpr}).filter(([key]) => !${formattedKeys}.includes(key)));`,
  ];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function letAssignTraceTS(name: string): string {
  return `__kernTrace({ op: "assign", target: ${JSON.stringify(name)}, value: ${name} });`;
}

function bodyLetBindingKind(rawKind: unknown): 'const' | 'let' {
  if (rawKind === undefined || rawKind === '' || rawKind === 'const') return 'const';
  if (rawKind === 'let') return 'let';
  throw new Error('body-statement `let kind=` supports only `const` or `let`.');
}

function emitAssignTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawTarget = props.target;
  const rawValue = props.value;
  const rawOp = props.op === undefined || props.op === '' ? '=' : String(props.op);
  if (rawTarget === undefined || rawTarget === '') {
    throw new Error('body-statement `assign` requires `target=`.');
  }
  if (!isSupportedAssignOperator(rawOp)) {
    throw new Error(`body-statement \`assign op=\` does not support \`${rawOp}\`.`);
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
  applyArrayMutationAssignTS(targetIR, ctx);
  // Cell assignment auto-lowers to its React setter so authors can use the
  // same `assign target=X value=Y` shape regardless of whether X is a `let`
  // or a `cell`. For compound assigns (`+=`, `-=`, …) and postfix (`++`,
  // `--`), use the functional updater form `setX((prev) => prev + delta)` so
  // multiple updates in the same render turn compose correctly under React's
  // batching (the naive `setX(X + 1)` form captures stale state).
  if (targetIR.kind === 'ident' && lookupLocalBinding(ctx, targetIR.name) === 'cell') {
    const setter = cellSetterName(targetIR.name);
    if (isPostfix) {
      const baseOp = rawOp === '++' ? '+' : '-';
      return [`${setter}((prev) => prev ${baseOp} 1);`];
    }
    const valueIR = parseExpr(String(rawValue));
    if (valueIR.kind === 'propagate') {
      throw new Error(
        `Propagation \`${valueIR.op}\` is not supported in \`assign value=\` — bind to \`let\` first, then assign.`,
      );
    }
    if (rawOp === '=') {
      // Self-referential plain `=` (`count = count + step`) lowers to the
      // functional updater so concurrent setStates in the same render don't
      // capture a stale closure-bound `count`. The arrow param shadows the
      // outer binding, so the original RHS expression compiles unchanged.
      if (valueReferencesIdent(valueIR, targetIR.name)) {
        return [`${setter}((${targetIR.name}) => ${emitValueTS(valueIR, ctx)});`];
      }
      return [`${setter}(${emitValueTS(valueIR, ctx)});`];
    }
    const baseOp = rawOp.slice(0, -1);
    return [`${setter}((prev) => prev ${baseOp} ${emitValueTS(valueIR, ctx)});`];
  }
  if (isPostfix) {
    return [`${emitValueTS(targetIR, ctx)}${rawOp};`];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`assign value=\` — bind to \`let\` first, then assign.`,
    );
  }
  // Emit the statement FIRST (its `emitValueTS` walk fail-closes any regex
  // method on a bound regex ident) so the RHS is checked against the
  // PRE-reassignment table (`re = s.match(re)` must still see `re` as a regex).
  const stmt = `${emitValueTS(targetIR, ctx)} ${rawOp} ${emitValueTS(valueIR, ctx)};`;
  // Reassign-invalidation (Slice-3c): keep the regex-binding table honest. A
  // plain `=` to a direct regex literal stays a regex binding (still
  // fail-closed); any compound op (`+=`, …) or non-regex RHS UNMARKS it.
  if (targetIR.kind === 'ident') {
    rebindRegexOnReassign(ctx, targetIR.name, rawOp === '=' ? valueIR : { kind: 'undefLit' });
    rebindRecordOnReassign(ctx, targetIR.name, rawOp === '=' ? valueIR : { kind: 'undefLit' });
    rebindArrayOnReassign(ctx, targetIR.name, rawOp === '=' ? valueIR : { kind: 'undefLit' });
  }
  // Differential-harness opt-in (see BodyEmitOptions.traceHooks.letAssign): the
  // `assign` contract observes a reassignment via the same `{op:"assign"}` event
  // a `let` declaration emits. Scoped to identifier targets — the contract
  // domain excludes member/index targets.
  if (targetIR.kind === 'ident' && ctx.traceHooks?.letAssign) {
    return [stmt, letAssignTraceTS(targetIR.name)];
  }
  return [stmt];
}

function emitCellTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawName = props.name;
  if (rawName === undefined || rawName === '') {
    throw new Error('body-statement `cell` requires `name=`.');
  }
  const name = emitIdentifier(String(rawName), 'cell', node);
  declareLocalBinding(ctx, name, 'cell');
  const setter = cellSetterName(name);
  const type = props.type ? String(props.type) : '';
  const typeArg = type ? `<${emitTypeAnnotation(type, 'unknown', node)}>` : '';
  const rawInitial = props.initial;
  const initialEmitted =
    rawInitial === undefined || rawInitial === '' ? 'undefined' : emitValueTS(parseExpr(String(rawInitial)), ctx);
  return [`const [${name}, ${setter}] = useState${typeArg}(${initialEmitted});`];
}

function emitSetTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawName = props.name;
  if (rawName === undefined || rawName === '') {
    throw new Error('body-statement `set` requires `name=`.');
  }
  const rawTo = props.to;
  if (rawTo === undefined || rawTo === '') {
    throw new Error('body-statement `set` requires `to=`.');
  }
  const name = emitIdentifier(String(rawName), 'cell', node);
  // Inside body-stmt context, `set` lowers to a React setter call regardless
  // of whether the named binding is a `cell` (the canonical case) or an
  // out-of-scope name (a useState declared in an enclosing render scope).
  // We don't gate on lookupLocalBinding because the cell may be declared in
  // a parent scope outside this emitter's visibility.
  const setter = cellSetterName(name);
  const valueIR = parseExpr(String(rawTo));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`set to=\` — bind to \`let\` first, then call set.`,
    );
  }
  // touch ctx to suppress unused-var lint if needed
  void ctx;
  return [`${setter}(${emitValueTS(valueIR, ctx)});`];
}

function cellSetterName(cellName: string): string {
  return `set${cellName.charAt(0).toUpperCase()}${cellName.slice(1)}`;
}

function declareLocalBinding(ctx: BodyEmitContext, name: string, kind: 'const' | 'let' | 'cell'): void {
  const scope = ctx.localScopes.at(-1);
  if (!scope) return;
  if (scope.has(name)) {
    throw new Error(`body-statement local binding \`${name}\` is already declared in this scope.`);
  }
  scope.set(name, kind);
  // Declare the regex binding as null by default (mirrors Python's
  // `declareLocalBinding` → `setRegexBinding(ctx, name, null)`); `emitLetTS`
  // overwrites it with the regex literal when the initializer is a `regexLit`.
  setRegexBinding(ctx, name, null);
  setRecordBinding(ctx, name, false);
  setArrayBindingStatus(ctx, name, null);
}

/** Record (or clear) the regex-literal bound to `name` in the current scope. */
function setRegexBinding(ctx: BodyEmitContext, name: string, regex: RegexLitIR | null): void {
  ctx.regexScopes.at(-1)?.set(name, regex);
}

/** Record whether `name` is bound to a DIRECT record literal in the current scope. */
function setRecordBinding(
  ctx: BodyEmitContext,
  name: string,
  isRecord: boolean,
  arrayFields: Set<string> | null = null,
  scalarArrayFields: Set<string> | null = null,
): void {
  ctx.recordScopes.at(-1)?.set(name, isRecord);
  ctx.recordArrayFieldScopes.at(-1)?.set(name, isRecord ? arrayFields : null);
  ctx.recordScalarArrayFieldScopes.at(-1)?.set(name, isRecord ? scalarArrayFields : null);
  ctx.maybeRecordArrayFieldScopes.at(-1)?.set(name, isRecord ? arrayFields : null);
}

function recordArrayFieldsForValue(valueIR: ValueIR, ctx: BodyEmitContext): Set<string> | null {
  if (valueIR.kind !== 'objectLit') return null;
  const fields = new Set<string>();
  for (const entry of valueIR.entries) {
    if ('kind' in entry) continue;
    if (entry.value.kind === 'arrayLit') fields.add(entry.key);
    else if (entry.value.kind === 'ident') {
      const status = lookupArrayBindingStatus(ctx, entry.value.name);
      if (status === 'fresh' || status === 'fresh-push' || status === 'captured') fields.add(entry.key);
    }
  }
  return fields;
}

function recordScalarArrayFieldsForValue(valueIR: ValueIR, ctx: BodyEmitContext): Set<string> | null {
  if (valueIR.kind !== 'objectLit') return null;
  const fields = new Set<string>();
  for (const entry of valueIR.entries) {
    if ('kind' in entry) continue;
    if (entry.value.kind === 'arrayLit' && arrayLiteralHasOnlyScalarElements(entry.value)) fields.add(entry.key);
    else if (entry.value.kind === 'ident') {
      const status = lookupArrayBindingStatus(ctx, entry.value.name);
      if (
        (status === 'fresh' || status === 'fresh-push' || status === 'captured') &&
        lookupScalarArrayBinding(ctx, entry.value.name)
      ) {
        fields.add(entry.key);
      }
    }
  }
  return fields;
}

function arrayLiteralHasOnlyScalarElements(valueIR: Extract<ValueIR, { kind: 'arrayLit' }>): boolean {
  return valueIR.items.every(
    (item) => item.kind === 'numLit' || item.kind === 'strLit' || item.kind === 'boolLit' || item.kind === 'nullLit',
  );
}

function setArrayBindingStatus(ctx: BodyEmitContext, name: string, status: ArrayBindingStatus | null): void {
  const scope = ctx.arrayBindingScopes.at(-1);
  if (!scope) return;
  if (status === null) scope.delete(name);
  else scope.set(name, status);
}

function setScalarArrayBinding(ctx: BodyEmitContext, name: string, scalar: boolean): void {
  const scope = ctx.scalarArrayBindingScopes.at(-1);
  if (!scope) return;
  if (scalar) scope.set(name, true);
  else scope.delete(name);
}

function lookupArrayBindingStatus(ctx: BodyEmitContext, name: string): ArrayBindingStatus | null {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    if (!ctx.localScopes[i].has(name)) continue;
    return ctx.arrayBindingScopes[i]?.get(name) ?? null;
  }
  return null;
}

function lookupScalarArrayBinding(ctx: BodyEmitContext, name: string): boolean {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    if (!ctx.localScopes[i].has(name)) continue;
    return ctx.scalarArrayBindingScopes[i]?.get(name) === true;
  }
  return false;
}

function setDeclaringArrayBindingStatus(ctx: BodyEmitContext, name: string, status: ArrayBindingStatus | null): void {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    if (!ctx.localScopes[i].has(name)) continue;
    const scope = ctx.arrayBindingScopes[i];
    if (status === null) scope?.delete(name);
    else scope?.set(name, status);
    return;
  }
}

function setDeclaringScalarArrayBinding(ctx: BodyEmitContext, name: string, scalar: boolean): void {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    if (!ctx.localScopes[i].has(name)) continue;
    const scope = ctx.scalarArrayBindingScopes[i];
    if (scalar) scope?.set(name, true);
    else scope?.delete(name);
    return;
  }
}

function findBindingScopeIndex(ctx: BodyEmitContext, name: string): number | null {
  for (let i = ctx.localScopes.length - 1; i >= 0; i--) {
    if (ctx.localScopes[i].has(name)) return i;
  }
  return null;
}

function assertFreshArrayCaptureNotInRepeatableLoopTS(ctx: BodyEmitContext, name: string): void {
  const loopScopeIndex = ctx.loopScopeIndexes.at(-1);
  if (loopScopeIndex === undefined) return;
  const scopeIndex = findBindingScopeIndex(ctx, name);
  if (scopeIndex !== null && scopeIndex < loopScopeIndex) {
    throw new Error(`fresh array binding "${name}" cannot be captured inside a repeatable loop body`);
  }
}

function isStaticBooleanLiteral(node: ValueIR, value: boolean): boolean {
  return node.kind === 'boolLit' && node.value === value;
}

type BranchBindingSnapshot = {
  readonly array: Array<Map<string, ArrayBindingStatus>>;
  readonly scalarArray: Array<Map<string, boolean>>;
  readonly record: Array<Map<string, boolean>>;
  readonly recordArrayField: Array<Map<string, Set<string> | null>>;
  readonly recordScalarArrayField: Array<Map<string, Set<string> | null>>;
  readonly maybeRecordArrayField: Array<Map<string, Set<string> | null>>;
};

function cloneFieldScopes(scopes: Array<Map<string, Set<string> | null>>): Array<Map<string, Set<string> | null>> {
  return scopes.map(
    (scope) => new Map([...scope.entries()].map(([name, fields]) => [name, fields === null ? null : new Set(fields)])),
  );
}

function cloneBranchBindingScopes(ctx: BodyEmitContext): BranchBindingSnapshot {
  return {
    array: ctx.arrayBindingScopes.map((scope) => new Map(scope)),
    scalarArray: ctx.scalarArrayBindingScopes.map((scope) => new Map(scope)),
    record: ctx.recordScopes.map((scope) => new Map(scope)),
    recordArrayField: cloneFieldScopes(ctx.recordArrayFieldScopes),
    recordScalarArrayField: cloneFieldScopes(ctx.recordScalarArrayFieldScopes),
    maybeRecordArrayField: cloneFieldScopes(ctx.maybeRecordArrayFieldScopes),
  };
}

function restoreBranchBindingScopes(ctx: BodyEmitContext, snapshot: BranchBindingSnapshot): void {
  ctx.arrayBindingScopes = snapshot.array.map((scope) => new Map(scope));
  ctx.scalarArrayBindingScopes = snapshot.scalarArray.map((scope) => new Map(scope));
  ctx.recordScopes = snapshot.record.map((scope) => new Map(scope));
  ctx.recordArrayFieldScopes = cloneFieldScopes(snapshot.recordArrayField);
  ctx.recordScalarArrayFieldScopes = cloneFieldScopes(snapshot.recordScalarArrayField);
  ctx.maybeRecordArrayFieldScopes = cloneFieldScopes(snapshot.maybeRecordArrayField);
}

function strongestArrayBindingStatus(statuses: Array<ArrayBindingStatus | null>): ArrayBindingStatus | null {
  if (statuses.includes('captured')) return 'captured';
  if (statuses.includes('stale')) return 'stale';
  if (statuses.includes('fresh')) return 'fresh';
  if (statuses.includes('fresh-push')) return 'fresh-push';
  return null;
}

function mergeArrayScopes(
  base: Array<Map<string, ArrayBindingStatus>>,
  outcomes: Array<Array<Map<string, ArrayBindingStatus>>>,
) {
  const merged = base.map((scope) => new Map(scope));
  for (let scopeIndex = 0; scopeIndex < merged.length; scopeIndex++) {
    const names = new Set<string>(merged[scopeIndex].keys());
    for (const outcome of outcomes) for (const name of outcome[scopeIndex]?.keys() ?? []) names.add(name);
    for (const name of names) {
      const status = strongestArrayBindingStatus(outcomes.map((outcome) => outcome[scopeIndex]?.get(name) ?? null));
      if (status === null) merged[scopeIndex].delete(name);
      else merged[scopeIndex].set(name, status);
    }
  }
  return merged;
}

function mergeScalarArrayScopes(base: Array<Map<string, boolean>>, outcomes: Array<Array<Map<string, boolean>>>) {
  const merged = base.map((scope) => new Map(scope));
  for (let scopeIndex = 0; scopeIndex < merged.length; scopeIndex++) {
    const names = new Set<string>(merged[scopeIndex].keys());
    for (const outcome of outcomes) for (const name of outcome[scopeIndex]?.keys() ?? []) names.add(name);
    for (const name of names) {
      const scalar = outcomes.length > 0 && outcomes.every((outcome) => outcome[scopeIndex]?.get(name) === true);
      if (scalar) merged[scopeIndex].set(name, true);
      else merged[scopeIndex].delete(name);
    }
  }
  return merged;
}

function mergeRecordScopes(base: Array<Map<string, boolean>>, outcomes: Array<Array<Map<string, boolean>>>) {
  const merged = base.map((scope) => new Map(scope));
  for (let scopeIndex = 0; scopeIndex < merged.length; scopeIndex++) {
    const names = new Set<string>(merged[scopeIndex].keys());
    for (const outcome of outcomes) for (const name of outcome[scopeIndex]?.keys() ?? []) names.add(name);
    for (const name of names) {
      merged[scopeIndex].set(
        name,
        outcomes.length > 0 && outcomes.every((outcome) => outcome[scopeIndex]?.get(name) === true),
      );
    }
  }
  return merged;
}

function mergeFieldScopes(
  base: Array<Map<string, Set<string> | null>>,
  outcomes: Array<Array<Map<string, Set<string> | null>>>,
  mode: 'intersection' | 'union',
) {
  const merged = base.map((scope) => new Map(scope));
  for (let scopeIndex = 0; scopeIndex < merged.length; scopeIndex++) {
    const names = new Set<string>(merged[scopeIndex].keys());
    for (const outcome of outcomes) for (const name of outcome[scopeIndex]?.keys() ?? []) names.add(name);
    for (const name of names) {
      const outcomeFields = outcomes.map((outcome) => outcome[scopeIndex]?.get(name) ?? null);
      const fields = new Set<string>();
      if (mode === 'union') {
        for (const set of outcomeFields) if (set) for (const field of set) fields.add(field);
      } else if (outcomeFields.length > 0 && outcomeFields.every((set) => set !== null)) {
        for (const field of outcomeFields[0] ?? []) {
          if (outcomeFields.every((set) => set?.has(field) === true)) fields.add(field);
        }
      }
      merged[scopeIndex].set(name, fields.size > 0 ? fields : null);
    }
  }
  return merged;
}

function mergeBranchBindingSnapshots(
  ctx: BodyEmitContext,
  base: BranchBindingSnapshot,
  outcomes: Array<BranchBindingSnapshot>,
): void {
  ctx.arrayBindingScopes = mergeArrayScopes(
    base.array,
    outcomes.map((outcome) => outcome.array),
  );
  ctx.scalarArrayBindingScopes = mergeScalarArrayScopes(
    base.scalarArray,
    outcomes.map((outcome) => outcome.scalarArray),
  );
  ctx.recordScopes = mergeRecordScopes(
    base.record,
    outcomes.map((outcome) => outcome.record),
  );
  ctx.recordArrayFieldScopes = mergeFieldScopes(
    base.recordArrayField,
    outcomes.map((outcome) => outcome.recordArrayField),
    'intersection',
  );
  ctx.recordScalarArrayFieldScopes = mergeFieldScopes(
    base.recordScalarArrayField,
    outcomes.map((outcome) => outcome.recordScalarArrayField),
    'intersection',
  );
  ctx.maybeRecordArrayFieldScopes = mergeFieldScopes(
    base.maybeRecordArrayField,
    outcomes.map((outcome) => outcome.maybeRecordArrayField),
    'union',
  );
}

function lookupRecordBinding(ctx: BodyEmitContext, name: string): boolean {
  for (let i = ctx.recordScopes.length - 1; i >= 0; i--) {
    const scope = ctx.recordScopes[i];
    if (scope.has(name)) return scope.get(name) === true;
  }
  return false;
}

function lookupRecordArrayField(ctx: BodyEmitContext, name: string, field: string): boolean {
  for (let i = ctx.recordArrayFieldScopes.length - 1; i >= 0; i--) {
    const scope = ctx.recordArrayFieldScopes[i];
    if (!scope.has(name)) continue;
    return scope.get(name)?.has(field) === true;
  }
  return false;
}

function lookupRecordScalarArrayField(ctx: BodyEmitContext, name: string, field: string): boolean {
  for (let i = ctx.recordScalarArrayFieldScopes.length - 1; i >= 0; i--) {
    const scope = ctx.recordScalarArrayFieldScopes[i];
    if (!scope.has(name)) continue;
    return scope.get(name)?.has(field) === true;
  }
  return false;
}

function lookupMaybeRecordArrayField(ctx: BodyEmitContext, name: string, field: string): boolean {
  for (let i = ctx.maybeRecordArrayFieldScopes.length - 1; i >= 0; i--) {
    const scope = ctx.maybeRecordArrayFieldScopes[i];
    if (!scope.has(name)) continue;
    return scope.get(name)?.has(field) === true;
  }
  return false;
}

function bindArrayStatusFromLet(ctx: BodyEmitContext, name: string, valueIR: ValueIR): void {
  if (valueIR.kind === 'arrayLit') {
    setArrayBindingStatus(ctx, name, valueIR.items.length === 0 ? 'fresh-push' : 'fresh');
    setScalarArrayBinding(ctx, name, arrayLiteralHasOnlyScalarElements(valueIR));
    return;
  }
  if (valueIR.kind === 'ident') {
    const sourceStatus = lookupArrayBindingStatus(ctx, valueIR.name);
    const sourceScalar = lookupScalarArrayBinding(ctx, valueIR.name);
    if (sourceStatus === 'fresh' || sourceStatus === 'fresh-push') {
      setDeclaringArrayBindingStatus(ctx, valueIR.name, 'stale');
      setDeclaringScalarArrayBinding(ctx, valueIR.name, false);
      setArrayBindingStatus(ctx, name, 'stale');
      setScalarArrayBinding(ctx, name, false);
      return;
    }
    if (sourceStatus === 'captured') {
      setArrayBindingStatus(ctx, name, 'captured');
      setScalarArrayBinding(ctx, name, sourceScalar);
      return;
    }
    if (sourceStatus === 'stale') {
      setArrayBindingStatus(ctx, name, 'stale');
      setScalarArrayBinding(ctx, name, false);
      return;
    }
  }
  if (
    valueIR.kind === 'member' &&
    valueIR.object.kind === 'ident' &&
    lookupRecordArrayField(ctx, valueIR.object.name, valueIR.property)
  ) {
    setArrayBindingStatus(ctx, name, 'captured');
    setScalarArrayBinding(ctx, name, lookupRecordScalarArrayField(ctx, valueIR.object.name, valueIR.property));
    return;
  }
  setArrayBindingStatus(ctx, name, null);
  setScalarArrayBinding(ctx, name, false);
}

function rebindArrayOnReassign(ctx: BodyEmitContext, name: string, valueIR: ValueIR): void {
  if (valueIR.kind === 'arrayLit') {
    setDeclaringArrayBindingStatus(ctx, name, 'stale');
    setDeclaringScalarArrayBinding(ctx, name, false);
  } else {
    setDeclaringArrayBindingStatus(ctx, name, null);
    setDeclaringScalarArrayBinding(ctx, name, false);
  }
}

/** Reassign-invalidation for the record table — same owning-scope walk as
 *  `rebindRegexOnReassign`: reassigned to a record literal → stays marked;
 *  reassigned to anything else → unmarked (no stale record classification). */
function rebindRecordOnReassign(ctx: BodyEmitContext, name: string, valueIR: ValueIR): void {
  const next = valueIR.kind === 'objectLit';
  const arrayFields = recordArrayFieldsForValue(valueIR, ctx);
  const scalarArrayFields = recordScalarArrayFieldsForValue(valueIR, ctx);
  for (let i = ctx.recordScopes.length - 1; i >= 0; i--) {
    const scope = ctx.recordScopes[i];
    if (scope.has(name)) {
      scope.set(name, next);
      ctx.recordArrayFieldScopes[i]?.set(name, next ? arrayFields : null);
      ctx.recordScalarArrayFieldScopes[i]?.set(name, next ? scalarArrayFields : null);
      ctx.maybeRecordArrayFieldScopes[i]?.set(name, next ? arrayFields : null);
      return;
    }
  }
}

/** Resolve an ident to its bound regex literal, walking enclosing scopes. */
function lookupRegexBinding(ctx: BodyEmitContext, name: string): RegexLitIR | null {
  for (let i = ctx.regexScopes.length - 1; i >= 0; i--) {
    const scope = ctx.regexScopes[i];
    if (scope.has(name)) return scope.get(name) ?? null;
  }
  return null;
}

/** Reassign-invalidation: when a tracked ident is REASSIGNED (`assign
 *  target=re value=…`), update its regex marking IN THE SCOPE THAT OWNS IT
 *  (not the innermost scope — that would shadow, leaking past the inner block).
 *  Reassigned to a direct `regexLit` → stays a regex binding (still fail-closed);
 *  reassigned to anything else → UNMARK (no longer fail-closed). This kills the
 *  stale-binding class: a `re = /b/` after `let re = /a/` never lets a prior
 *  literal leak, and a `re = someString` correctly drops the regex marking. */
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

const MUTATING_ARRAY_METHODS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

function captureFreshArrayRecordSourcesTS(node: Extract<ValueIR, { kind: 'objectLit' }>, ctx: BodyEmitContext): void {
  const freshSources = new Set<string>();
  for (const entry of node.entries) {
    if ('kind' in entry) continue;
    if (
      entry.value.kind === 'member' &&
      entry.value.object.kind === 'ident' &&
      lookupMaybeRecordArrayField(ctx, entry.value.object.name, entry.value.property)
    ) {
      throw new Error(
        `record field "${entry.value.object.name}.${entry.value.property}" cannot be captured by another record field`,
      );
    }
    if (entry.value.kind !== 'ident') continue;
    const status = lookupArrayBindingStatus(ctx, entry.value.name);
    if (status === 'fresh' || status === 'fresh-push') {
      if (freshSources.has(entry.value.name)) {
        throw new Error(`fresh array binding "${entry.value.name}" can be captured only once`);
      }
      assertFreshArrayCaptureNotInRepeatableLoopTS(ctx, entry.value.name);
      freshSources.add(entry.value.name);
    } else if (status === 'captured') {
      throw new Error(`fresh array binding "${entry.value.name}" was already captured by a record field`);
    } else if (status === 'stale') {
      throw new Error(`stale array binding "${entry.value.name}" cannot be captured by a record field`);
    }
  }
  for (const name of freshSources) setDeclaringArrayBindingStatus(ctx, name, 'captured');
}

function arrayMutationCallReceiver(node: ValueIR): ValueIR | null {
  if (node.kind !== 'call') return null;
  const callee = node.callee;
  if (callee.kind !== 'member' || !MUTATING_ARRAY_METHODS.has(callee.property)) return null;
  return callee.object;
}

function rootIdentName(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'member' || node.kind === 'index') return rootIdentName(node.object);
  return null;
}

function recordArrayFieldMutationTarget(
  node: ValueIR,
  ctx: BodyEmitContext,
): { recordName: string; fieldName: string } | null {
  if (
    node.kind === 'member' &&
    node.object.kind === 'ident' &&
    lookupMaybeRecordArrayField(ctx, node.object.name, node.property)
  ) {
    return { recordName: node.object.name, fieldName: node.property };
  }
  if (node.kind === 'member' || node.kind === 'index') return recordArrayFieldMutationTarget(node.object, ctx);
  return null;
}

function isIntegerValuedFloatLiteralTS(node: Extract<ValueIR, { kind: 'numLit' }>): boolean {
  return (node.raw.includes('.') || /[eE]/.test(node.raw)) && Number.isInteger(node.value);
}

function isFreshnessPreservingPushElementTS(node: ValueIR): boolean {
  if (node.kind === 'strLit' || node.kind === 'boolLit' || node.kind === 'nullLit') return true;
  if (node.kind !== 'numLit') return false;
  if (node.bigint || !Number.isFinite(node.value)) return false;
  if (isIntegerValuedFloatLiteralTS(node))
    throw new Error('portable: float literal has an integer value (float/int divergence)');
  return true;
}

function pushMutationTargetTS(node: ValueIR): { target: ValueIR; element: ValueIR } | null {
  if (node.kind !== 'call' || node.optional || node.args.length !== 1) return null;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional || callee.property !== 'push') return null;
  return { target: callee.object, element: node.args[0] };
}

function applyArrayMutationTargetTS(target: ValueIR, ctx: BodyEmitContext, preserveFreshPush = false): void {
  const recordField = recordArrayFieldMutationTarget(target, ctx);
  if (recordField !== null) {
    throw new Error(
      `record array field "${recordField.recordName}.${recordField.fieldName}" cannot be mutated after capture`,
    );
  }
  const targetName = rootIdentName(target);
  if (targetName === null) return;
  const status = lookupArrayBindingStatus(ctx, targetName);
  if (status === 'captured') {
    throw new Error(`fresh array binding "${targetName}" was already captured by a record field`);
  }
  if (status === 'fresh-push' && preserveFreshPush) return;
  if (status === 'fresh' || status === 'fresh-push') setDeclaringArrayBindingStatus(ctx, targetName, 'stale');
}

function applyArrayMutationAssignTS(target: ValueIR, ctx: BodyEmitContext): void {
  if (target.kind === 'ident') {
    const status = lookupArrayBindingStatus(ctx, target.name);
    if (status === 'captured') {
      throw new Error(`fresh array binding "${target.name}" was already captured by a record field`);
    }
    if (status === 'fresh' || status === 'fresh-push' || status === 'stale') {
      throw new Error(`array binding "${target.name}" cannot be reassigned by portable assign`);
    }
    return;
  }
  applyArrayMutationTargetTS(target, ctx);
}

function applyArrayMutationDoTS(node: ValueIR, ctx: BodyEmitContext, preserveFreshPush = false): void {
  const pushTarget = pushMutationTargetTS(node);
  if (pushTarget !== null) {
    const keepFresh = preserveFreshPush && isFreshnessPreservingPushElementTS(pushTarget.element);
    applyArrayMutationTargetTS(pushTarget.target, ctx, keepFresh);
    return;
  }
  const receiver = arrayMutationCallReceiver(node);
  if (receiver !== null) applyArrayMutationTargetTS(receiver, ctx);
}

function applyArrayMutationsInExpressionTS(node: ValueIR, ctx: BodyEmitContext, preserveFreshPush = false): void {
  applyArrayMutationDoTS(node, ctx, preserveFreshPush);
  // Only a direct `do xs.push(<scalar>)` statement certifies the push-built freshness chain.
  // Nested pushes inside a larger expression are still mutation expressions and must stale.
  forEachValueIRChild(node, (child) => applyArrayMutationsInExpressionTS(child, ctx));
}

function assertRecordArrayFieldReadsProvenTS(node: ValueIR, ctx: BodyEmitContext): void {
  if (
    node.kind === 'member' &&
    node.object.kind === 'ident' &&
    lookupMaybeRecordArrayField(ctx, node.object.name, node.property) &&
    (node.optional || isParenthesized(node.object))
  ) {
    throw new Error(`record array field "${node.object.name}.${node.property}" must use a bare non-optional receiver`);
  }
  if (
    node.kind === 'member' &&
    node.object.kind === 'ident' &&
    lookupMaybeRecordArrayField(ctx, node.object.name, node.property) &&
    !lookupRecordArrayField(ctx, node.object.name, node.property)
  ) {
    throw new Error(`record array field "${node.object.name}.${node.property}" is not proven on every branch`);
  }
  forEachValueIRChild(node, (child) => assertRecordArrayFieldReadsProvenTS(child, ctx));
}

function emitValueTS(node: ValueIR, ctx: BodyEmitContext, options: { preserveFreshPush?: boolean } = {}): string {
  // Slice-3c: DETECT-and-fail-close a regex method called on a let-bound regex
  // IDENT (`let re = /…/; s.match(re)`). The pure-expression TS emitter
  // (`emitExpression`) only lowers a DIRECT regex literal in the regex
  // position; an ident there falls through to a plain host method. The Python
  // emitter makes the SAME decision (see `lowerRegexCallPython`), so we walk the
  // IR HERE (where the binding table lives) and throw the SAME shared
  // `REGEX_NONLITERAL_FAILCLOSE` whenever a regex method's regex position is an
  // ident the table knows is regex-bound. A string-/unknown-bound ident is NOT
  // flagged — it stays a plain host method (e.g. `s.match(stringVar)`), the
  // common case the old resolve-to-literal substitution must never have broken.
  assertNoBoundRegexMethodTS(node, ctx);
  applyArrayMutationsInExpressionTS(node, ctx, options.preserveFreshPush === true);
  assertRecordArrayFieldReadsProvenTS(node, ctx);
  if (node.kind === 'objectLit') captureFreshArrayRecordSourcesTS(node, ctx);
  return emitExpression(node, exprCtxFor(ctx));
}

function emitEachIterableTS(node: ValueIR, ctx: BodyEmitContext): string {
  if (node.kind === 'member' && node.object.kind === 'ident') {
    if (!lookupRecordBinding(ctx, node.object.name)) return emitValueTS(node, ctx);
    if (node.optional || isParenthesized(node.object)) {
      throw new Error(`each nested record-array receiver "${node.object.name}.${node.property}" is not proven`);
    }
    if (
      lookupMaybeRecordArrayField(ctx, node.object.name, node.property) &&
      !lookupRecordArrayField(ctx, node.object.name, node.property)
    ) {
      throw new Error(`record array field "${node.object.name}.${node.property}" is not proven on every branch`);
    }
    if (
      lookupRecordArrayField(ctx, node.object.name, node.property) &&
      !lookupRecordScalarArrayField(ctx, node.object.name, node.property)
    ) {
      throw new Error(
        `record array field "${node.object.name}.${node.property}" elements are not proven portable scalars`,
      );
    }
    return nestedArrayIterableTS(node.object.name, node.property);
  }
  return emitValueTS(node, ctx);
}

function assertNoKeyedNestedRecordReceiverTS(node: ValueIR, ctx: BodyEmitContext): void {
  if (node.kind !== 'member' || node.object.kind !== 'ident') return;
  if (!lookupRecordBinding(ctx, node.object.name)) return;
  if (node.optional || isParenthesized(node.object)) return;
  if (
    lookupMaybeRecordArrayField(ctx, node.object.name, node.property) &&
    !lookupRecordArrayField(ctx, node.object.name, node.property)
  ) {
    return;
  }
  throw new Error(
    `keyed iteration over nested record field "${node.object.name}.${node.property}" is outside the portable domain`,
  );
}

function nestedRecordGuardTS(field: string): string {
  return `const __kern_proto = __kern_record === null || typeof __kern_record !== "object" ? undefined : Object.getPrototypeOf(__kern_record); if (__kern_record === null || typeof __kern_record !== "object" || Array.isArray(__kern_record) || (__kern_proto !== Object.prototype && __kern_proto !== null) || !Object.prototype.hasOwnProperty.call(__kern_record, ${JSON.stringify(field)})) throw new Error("portable: nested array receiver must be a record field"); const __kern_array = __kern_record[${JSON.stringify(field)}]; if (!Array.isArray(__kern_array)) throw new Error("portable: nested record field must be an array");`;
}

function nestedArrayIterableTS(record: string, field: string): string {
  return `(() => { const __kern_record = ${record}; ${nestedRecordGuardTS(field)} for (const __kern_value of __kern_array) { if (!(__kern_value === null || typeof __kern_value === "string" || typeof __kern_value === "boolean" || (typeof __kern_value === "number" && Number.isFinite(__kern_value)))) throw new Error("portable: nested array element must be a portable scalar"); } return __kern_array; })()`;
}

function exprCtxFor(ctx: BodyEmitContext): ExprEmitContext {
  return {
    isUserBinding: (name: string) => lookupLocalBinding(ctx, name) !== undefined,
    validateRawBlock: validateClosureBlockHostNamespacesTS,
    // DECIMAL Slice 2 (Finding A) — forward the per-emission import sink so the
    // expression emitter's `registerStdlibRequirementTS` records `requires.ts`
    // (e.g. `decimal.js`) into the body emitter's result instead of dropping it.
    imports: ctx.imports,
    // D1b — this is THE native-body→ExprEmitContext bridge (it backs both body-statement
    // expression emission and body-statement `fn` param defaults; both are portable
    // native semantics). Flag the context so loose `==`/`!=` lower through
    // `__kern_loose_eq`. This is the ONLY site that opts in; every other ExprEmitContext
    // (Ground/data/machines/top-level) leaves it absent → raw `==`, the safe default.
    coerceJsValues: true,
    // Nested-values slice-1 — the nested-record-field rewrite fires ONLY for
    // idents this body's binding table proves are record literals; every
    // other two-level chain keeps its base verbatim emission.
    isRecordBinding: (name: string) => lookupRecordBinding(ctx, name),
    isRecordArrayField: (name: string, field: string) => lookupRecordArrayField(ctx, name, field),
  };
}

/** Recursively reject any regex-method call whose regex-position operand is an
 *  ident KNOWN to be regex-bound in scope. Mirrors the per-call-node fail-close
 *  the Python emitter makes inside `lowerRegexCallPython`, so the rejection is
 *  symmetric at any nesting depth. Direct regex literals are never idents, so
 *  the canonical Slice-3 lowering is untouched.
 *
 *  Slice-3d (TS/Python parity fix): a block-bodied arrow (`x => { … }`) carries
 *  its body as OPAQUE raw text (`lambda.bodyBlock`) re-emitted verbatim on TS —
 *  so a bound-regex method INSIDE the block (`x => { return s.match(re); }`)
 *  slipped through the `ValueIR` walk and emitted RAW, while the Python emitter
 *  RE-PARSES every block-closure expression (`emitPyExprCtx(parseExpr(raw),ctx)`
 *  → `lowerRegexCallPython`) and FAIL-CLOSED the same construct — a SILENT
 *  cross-target divergence. We close it by descending into `bodyBlock` through
 *  the SAME closure-AST path the rest of the pipeline uses
 *  (`parseClosureBlockAst`) and applying the SAME `ValueIR` detector to every
 *  call inside it (re-parsed via the SAME `parseExpr` the Python lowerer uses),
 *  so the fail-close decision is byte-for-byte symmetric. */
function assertNoBoundRegexMethodTS(node: ValueIR, ctx: BodyEmitContext): void {
  if (node.kind === 'call') {
    const argName = regexMethodRegexArgIdent(node);
    if (argName !== null && lookupRegexBinding(ctx, argName) !== null) {
      throw new Error(REGEX_NONLITERAL_FAILCLOSE);
    }
  }
  if (node.kind === 'lambda' && node.bodyBlock) {
    assertNoBoundRegexMethodInBlockTS(node.bodyBlock.raw, ctx);
  }
  forEachValueIRChild(node, (child) => assertNoBoundRegexMethodTS(child, ctx));
}

/** Fail-close a bound-regex method called anywhere inside a block-bodied
 *  arrow's raw body — the TS half of the Slice-3d parity fix.
 *
 *  Collects every CALL expression's source text from the raw block via the
 *  shared `collectClosureBlockCallTexts` (the closure-AST path every other
 *  consumer reads — never a fresh regex-text scanner; the `ts` AST walk stays
 *  quarantined in `closure-eligibility.ts` so this module imports no
 *  `typescript`). Each call's source text is re-parsed into
 *  `ValueIR` through the SAME `parseExpr` the Python block-closure lowerer uses
 *  (`emitPyExprCtx(parseExpr(expr.getText(sf)), ctx)`), and run through the SAME
 *  `regexMethodRegexArgIdent` + `lookupRegexBinding(ctx, …)` detector. A
 *  known-regex-bound ident in the regex position throws the SAME shared
 *  `REGEX_NONLITERAL_FAILCLOSE` — making the rejection byte-for-byte symmetric
 *  with Python. A string-/unknown-bound ident (`s.match(strVar)`) is NOT flagged
 *  and stays a plain host method on both targets.
 *
 *  Binding resolution uses the SAME `ctx` (the body's regex-binding table) the
 *  Python lowerer consults: a closure PARAM that shadows an outer regex name is
 *  conservatively still flagged on BOTH targets (Python's `lookupRegexBinding`
 *  also ignores `shadowedSymbols`) — over-rejection is SAFE and symmetric; the
 *  silent divergence is not. If the block does not parse cleanly the gate
 *  already rejected it upstream, so this is a defensive no-op. */
function assertNoBoundRegexMethodInBlockTS(raw: string, ctx: BodyEmitContext): void {
  for (const callText of collectClosureBlockCallTexts(raw)) {
    const callIR = parseExpr(callText);
    if (callIR.kind === 'call') {
      const argName = regexMethodRegexArgIdent(callIR);
      if (argName !== null && lookupRegexBinding(ctx, argName) !== null) {
        throw new Error(REGEX_NONLITERAL_FAILCLOSE);
      }
    }
  }
}

/** Visit each immediate child `ValueIR` of `node`. Covers every variant of the
 *  value AST so the regex-method walk reaches calls nested inside any operand
 *  (args, members, binaries, conditionals, template exprs, object/array
 *  literals, …). `lambda.bodyBlock` is opaque raw TS text with no parsed IR, so
 *  it has no child `ValueIR` nodes here — its bound-regex methods are reached
 *  separately by `assertNoBoundRegexMethodInBlockTS` (called from
 *  `assertNoBoundRegexMethodTS` on the lambda), which parses the raw block. */
function forEachValueIRChild(node: ValueIR, visit: (child: ValueIR) => void): void {
  switch (node.kind) {
    case 'member':
      visit(node.object);
      return;
    case 'index':
      visit(node.object);
      visit(node.index);
      return;
    case 'call':
      visit(node.callee);
      for (const a of node.args) visit(a);
      return;
    case 'lambda':
      if (node.body) visit(node.body);
      return;
    case 'binary':
      visit(node.left);
      visit(node.right);
      return;
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
      visit(node.argument);
      return;
    case 'typeAssert':
    case 'nonNull':
      visit(node.expression);
      return;
    case 'propagate':
      visit(node.argument);
      return;
    case 'tmplLit':
      for (const e of node.expressions) visit(e);
      return;
    case 'objectLit':
      for (const entry of node.entries) {
        if ('kind' in entry && entry.kind === 'spread') visit(entry.argument);
        else visit((entry as { value: ValueIR }).value);
      }
      return;
    case 'arrayLit':
      for (const item of node.items) visit(item);
      return;
    case 'conditional':
      visit(node.test);
      visit(node.consequent);
      visit(node.alternate);
      return;
    default:
      // Leaf nodes (numLit/strLit/boolLit/nullLit/undefLit/regexLit/ident): no children.
      return;
  }
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

/** True when any identifier with the given name appears anywhere in the
 *  ValueIR tree. Used to detect self-referential setter assignments like
 *  `count = count + 1` so the body emitter can emit a functional updater
 *  `setCount((count) => count + 1)` instead of `setCount(count + 1)`.
 *
 *  A lambda whose parameter list shadows the name is treated as opaque —
 *  inside `count => count + step`, the inner `count` is the lambda param,
 *  not the surrounding cell, so the cell name is not referenced. */
/** Conservative word-boundary check for an identifier inside a raw closure
 *  block. Used when a block-bodied arrow has no expression `body` to recurse.
 *  May over-match (e.g. the name appears in a string literal), which is safe
 *  here — the only consequence is a redundant functional-updater rewrite. */
function rawBlockReferencesIdent(raw: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(raw);
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
      return node.items.some((i) => valueReferencesIdent(i, name));
    case 'lambda':
      // A lambda param with the same name shadows the cell binding inside
      // the body — treat the lambda as opaque in that case.
      if (node.params.some((p) => p.name === name)) return false;
      // Block-bodied arrow (slices 0+1): no expression `body`. Conservatively
      // detect a reference via the raw text (word-boundary). Over-detection
      // only triggers a harmless functional-updater rewrite; under-detection
      // would be the bug, so we err toward `true`.
      if (node.bodyBlock) return rawBlockReferencesIdent(node.bodyBlock.raw, name);
      return valueReferencesIdent(node.body as ValueIR, name);
    default:
      return false;
  }
}

function emitDestructureTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawSource = props.source;
  if (rawSource === undefined || rawSource === '') {
    throw new Error('body-statement `destructure` requires `source=`.');
  }
  const pattern = formatBodyDestructurePattern(node);
  const kind = props.kind === 'let' ? 'let' : 'const';
  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const sourceIR = parseExpr(String(rawSource));
  if (sourceIR.kind === 'propagate' && sourceIR.op === '?') rejectPropagationInsideTry(ctx);
  return [`${kind} ${pattern}${typeAnn} = ${emitValueTS(sourceIR, ctx)};`];
}

function formatBodyDestructurePattern(node: IRNode): string {
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
    const parts = bindings.map((child) => {
      const props = (child.props ?? {}) as Record<string, unknown>;
      const name = String(props.name ?? '');
      if (!name) throw new Error('body-statement `binding` requires `name=`.');
      const key = props.key === undefined || props.key === '' ? undefined : String(props.key);
      return key ? `${key}: ${name}` : name;
    });
    return `{ ${parts.join(', ')} }`;
  }

  const indexed = elements.map((child) => {
    const props = (child.props ?? {}) as Record<string, unknown>;
    const name = String(props.name ?? '');
    if (!name) throw new Error('body-statement `element` requires `name=`.');
    const index = Number.parseInt(String(props.index ?? ''), 10);
    if (Number.isNaN(index)) throw new Error('body-statement `element` requires numeric `index=`.');
    return { index, name };
  });
  indexed.sort((a, b) => a.index - b.index);
  const max = indexed[indexed.length - 1].index;
  const slots: string[] = [];
  for (let i = 0; i <= max; i++) {
    slots.push(indexed.find((entry) => entry.index === i)?.name ?? '');
  }
  return `[${slots.join(', ')}]`;
}

function emitCommentTS(node: IRNode): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const raw = props.raw === undefined || props.raw === null ? '' : String(props.raw).trim();
  if (raw.startsWith('//') || raw.startsWith('/*')) return raw.split(/\r?\n/).map((line) => line.trimEnd());
  const text = props.text === undefined || props.text === null ? '' : String(props.text);
  return text.split(/\r?\n/).map((line) => `// ${line}`.trimEnd());
}

function emitReturnTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`return;`];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitValueTS(valueIR.argument, ctx);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`, `return ${tmp}.value;`];
  }
  return [`return ${emitValueTS(valueIR, ctx)};`];
}

function emitPrintTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    throw new Error('body-statement `print` requires `value=`.');
  }
  const valueIR = parseExpr(String(rawValue));
  // Wrap in a template literal so the value is coerced to a string with the
  // SAME semantics the reference runner (`printText`) and the Python
  // `_kern_fmt` helper use (true/false/null lowercase, base-10 ints, exact
  // strings) — `console.log` then appends exactly one newline.
  return [`console.log(\`\${${emitValueTS(valueIR, ctx)}}\`);`];
}

function emitThrowTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`throw new Error();`];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitValueTS(valueIR.argument, ctx);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`, `throw ${tmp}.value;`];
  }
  return [`throw ${emitValueTS(valueIR, ctx)};`];
}

function emitDoTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [];
  }
  const valueIR = parseExpr(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitValueTS(valueIR.argument, ctx);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`];
  }
  return [`${emitValueTS(valueIR, ctx, { preserveFreshPush: true })};`];
}

function emitFmtTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const template = props.template;
  if (template === undefined || template === null) {
    throw new Error('body-statement `fmt` requires `template=`.');
  }
  const escapedTemplate = emitFmtTemplate(String(template));
  const returnMode = props.return === true || props.return === 'true';
  if (returnMode) {
    if (props.name !== undefined && props.name !== '') {
      throw new Error('body-statement `fmt` with `return=true` must not carry a `name=` prop.');
    }
    return [`return \`${escapedTemplate}\`;`];
  }
  if (props.name === undefined || props.name === '') {
    throw new Error(
      'body-statement `fmt` requires `name=` (or `return=true` for return-position form). Inline-JSX form is only valid as a direct child of `render`/`group`.',
    );
  }
  const name = emitIdentifier(String(props.name), 'formatted', node);
  const kind = props.kind === 'let' ? 'let' : 'const';
  declareLocalBinding(ctx, name, kind);
  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const lines = [`${kind} ${name}${typeAnn} = \`${escapedTemplate}\`;`];
  // Differential-harness opt-in: observe the formatted binding via the same
  // {op:assign} event let/assign emit. Production callers set no traceHooks.
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitExpressionV1TS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `expression-v1` requires `name=`.');
  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const rawExpr = props.expr;
  const exprSource = unwrapBodyExpr(rawExpr);
  if (exprSource === undefined || exprSource === '') {
    throw new Error('body-statement `expression-v1` requires `expr=`.');
  }
  const exprIR = parseExpr(exprSource);
  declareLocalBinding(ctx, name, 'const');
  // Slice-3b parity: record a direct regex-literal binding (mirrors Python's
  // `expression-v1` `setRegexBinding(ctx, userName, regexLit|null)`).
  setRegexBinding(ctx, name, exprIR.kind === 'regexLit' ? exprIR : null);
  setRecordBinding(
    ctx,
    name,
    exprIR.kind === 'objectLit',
    recordArrayFieldsForValue(exprIR, ctx),
    recordScalarArrayFieldsForValue(exprIR, ctx),
  );
  bindArrayStatusFromLet(ctx, name, exprIR);
  const lines = [`const ${name}${typeAnn} = ${emitValueTS(exprIR, ctx)};`];
  if (ctx.traceHooks?.letAssign) lines.push(letAssignTraceTS(name));
  return lines;
}

function emitFnTS(node: IRNode, ctx: BodyEmitContext, indent: string): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '');
  if (!name) throw new Error('body-statement `fn` requires `name=`.');
  declareLocalBinding(ctx, name, 'const');

  const isAsync = props.async === 'true' || props.async === true;
  const asyncKw = isAsync ? 'async ' : '';
  const returns = props.returns ? emitTypeAnnotation(String(props.returns), 'unknown', node) : '';
  const returnType = returns && isAsync && !/^Promise\s*</.test(returns) ? `Promise<${returns}>` : returns;
  const retClause = returnType ? `: ${returnType}` : '';
  if (props.params && node.children?.some((c) => c.type === 'param')) {
    throw new Error('body-statement `fn` cannot mix legacy `params=` with structured `param` children.');
  }
  const bodyBindings = bodyContextBindingNames(ctx);
  const paramList = emitParamList(node, { exprCtx: exprCtxFor(ctx), userBindings: bodyBindings });

  const lines: string[] = [];
  lines.push(`${indent}${asyncKw}function ${name}(${paramList})${retClause} {`);

  const handlerNode = node.children?.find((c) => c.type === 'handler');
  const bodyNodes = handlerNode ? (handlerNode.children ?? []) : (node.children ?? []);
  const stmtNodes = bodyNodes.filter((c) => c.type !== 'param' && c.type !== 'decorator');

  for (const sl of emitChildrenTS(stmtNodes, ctx, indent + INDENT_STEP, paramBindingsForBodyFn(node, paramList))) {
    lines.push(sl);
  }
  lines.push(`${indent}}`);
  return lines;
}

function bodyContextBindingNames(ctx: BodyEmitContext): ReadonlySet<string> {
  const names = new Set<string>();
  for (const scope of ctx.localScopes) {
    for (const name of scope.keys()) names.add(name);
  }
  return names;
}

function paramBindingsForBodyFn(node: IRNode, paramList: string): Array<[string, 'const']> {
  const names = new Set(paramBindingsFromSignature(paramList).map(([name]) => name));
  for (const child of node.children ?? []) {
    if (child.type !== 'param') continue;
    for (const name of bodyBindingNamesFromPatternChildren(child)) names.add(name);
  }
  return [...names].map((name) => [name, 'const']);
}

function bodyBindingNamesFromPatternChildren(node: IRNode): string[] {
  const names: string[] = [];
  const hasPatternChildren = (node.children ?? []).some(
    (child) => child.type === 'binding' || child.type === 'element',
  );
  const ownName = node.props?.name;
  if (typeof ownName === 'string' && ownName.length > 0 && !hasPatternChildren) names.push(ownName);
  for (const child of node.children ?? []) {
    if (child.type !== 'binding' && child.type !== 'element') continue;
    const name = child.props?.name;
    if (typeof name === 'string' && name.length > 0) names.push(name);
  }
  return names;
}

function paramBindingsFromSignature(paramList: string): Array<[string, 'const']> {
  if (!paramList.trim()) return [];
  return splitBodyExpressionList(paramList, 'fn params=')
    .map(
      (part) =>
        part
          .split('=')[0]
          ?.split(':')[0]
          ?.trim()
          .replace(/^\.\.\./, '')
          .replace(/\?$/, '') ?? '',
    )
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
    .map((name) => [name, 'const']);
}
