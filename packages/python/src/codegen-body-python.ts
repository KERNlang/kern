/** Native KERN handler-body codegen — Python target (slices 1–3).
 *
 *  Mirror of `packages/core/src/codegen/body-ts.ts` for the FastAPI/Python
 *  target. Walks the children of a handler with `lang=kern` and emits Python
 *  body lines. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `X = EXPR` (slice 1)
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

import type { IRNode, ValueIR } from '@kernlang/core';
import {
  applyTemplate,
  isPostfixMutationOperator,
  isSupportedAssignOperator,
  KERN_STDLIB_MODULES,
  lookupStdlib,
  needsArgParens,
  needsBinaryParens,
  parseExpression,
  suggestStdlibMethod,
} from '@kernlang/core';

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

interface BodyEmitContext {
  gensymCounter: number;
  imports: Set<string>;
  /** PR-4 — runtime helper function definitions the body references.
   *  Populated lazily when codegen needs a helper (e.g. `_kern_pairs` for
   *  `each` pair-mode). Consumer emits each entry at module scope. */
  helpers: Set<string>;
  symbolMap: Record<string, string>;
  shadowedSymbols: Set<string>;
  localScopes: Array<Map<string, 'const' | 'let' | 'cell'>>;
  regexScopes: Array<Map<string, Extract<ValueIR, { kind: 'regexLit' }> | null>>;
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
}

const INDENT_STEP = '    ';

function freshCtx(options?: BodyEmitOptions): BodyEmitContext {
  return {
    gensymCounter: 0,
    imports: new Set<string>(),
    helpers: new Set<string>(),
    symbolMap: options?.symbolMap ?? {},
    shadowedSymbols: new Set<string>(),
    localScopes: [],
    regexScopes: [],
    propagateStyle: options?.propagateStyle ?? 'value',
    usedPropagation: false,
    tryDepth: 0,
    finallyDepth: 0,
    traceHooks: options?.traceHooks,
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
export const KERN_PAIR_HELPERS_PY = [
  'def _kern_pairs(__k_v):',
  '    return __k_v.items() if hasattr(__k_v, "items") else iter(__k_v)',
  '',
  'async def _kern_async_pairs(__k_v):',
  '    if hasattr(__k_v, "__aiter__"):',
  '        async for __k_item in __k_v:',
  '            yield __k_item',
  '    else:',
  '        for __k_item in _kern_pairs(__k_v):',
  '            yield __k_item',
].join('\n');

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
export const KERN_FMT_HELPER_PY = [
  'def _kern_fmt(__k_v):',
  '    if isinstance(__k_v, bool):',
  "        return 'true' if __k_v else 'false'",
  '    if __k_v is None:',
  "        return 'null'",
  '    return str(__k_v)',
].join('\n');

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
  const code = emitChildrenPy(handlerNode.children ?? [], ctx, '').join('\n');
  return { code, imports: ctx.imports, usedPropagation: ctx.usedPropagation, helpers: ctx.helpers };
}

/** Body-statement node types that map to a SINGLE emitted line and may carry
 *  an inline same-line trailing comment captured by the migrator into a
 *  `trailingComment=` prop. Mirrors the TS emitter's set. */
const TRAILING_COMMENT_TYPES = new Set(['let', 'assign', 'fmt', 'return', 'throw', 'do', 'continue', 'break']);

/** Convert a captured TS-form trailing comment (a line `// note` or a block
 *  comment) to an idiomatic Python inline comment (`# note`). Mirrors
 *  emitCommentPy. */
function trailingCommentToPy(raw: string): string {
  if (raw.startsWith('//')) return `# ${raw.slice(2).trim()}`.trimEnd();
  if (raw.startsWith('/*') && raw.endsWith('*/')) return `# ${raw.slice(2, -2).trim()}`.trimEnd();
  return `# ${raw}`.trimEnd();
}

function emitChildrenPy(
  children: IRNode[],
  ctx: BodyEmitContext,
  indent: string,
  initialBindings: Array<[string, 'const' | 'let']> = [],
): string[] {
  const lines: string[] = [];
  ctx.localScopes.push(new Map(initialBindings));
  ctx.regexScopes.push(new Map(initialBindings.map(([name]) => [name, null])));
  try {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const trailStart = lines.length;
      if (child.type === 'comment') {
        for (const line of emitCommentPy(child)) lines.push(`${indent}${line}`);
      } else if (child.type === 'cell') {
        for (const line of emitCellPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'set') {
        for (const line of emitSetPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'let') {
        for (const line of emitLetPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'assign') {
        for (const line of emitAssignPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'destructure') {
        for (const line of emitDestructurePy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'fmt') {
        for (const line of emitFmtPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'return') {
        for (const line of emitReturnPy(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'if') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpression(condRaw);
        // Slice-2 review fix: reject propagation `?` in `if cond=` (parallel to TS side).
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}if ${emitPyExprCtx(condIR, ctx)}:`);
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
            const nestedCondIR = parseExpression(nestedCondRaw);
            if (nestedCondIR.kind === 'propagate') {
              throw new Error(
                "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
              );
            }
            lines.push(`${indent}elif ${emitPyExprCtx(nestedCondIR, ctx)}:`);
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
        const condIR = parseExpression(condRaw);
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `while cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}while ${emitPyExprCtx(condIR, ctx)}:`);
        const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP);
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
        const listIR = parseExpression(listRaw);
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
          const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, [
            [k, 'const'],
            [v, 'const'],
          ]);
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
            const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, [[k, 'const']]);
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
            const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, [[v, 'const']]);
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
        const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP, initialBindings);
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
    ctx.localScopes.pop();
    ctx.regexScopes.pop();
  }
  return lines;
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
  const fromIR = parseExpression(String(rawFrom));
  const toIR = parseExpression(String(rawTo));
  const stepIR = parseExpression(rawStep);
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
  const inner = emitChildrenPy(node.children ?? [], ctx, bodyIndent, [[name, 'const']]);
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
  const valueIR = parseExpression(String(rawValue));
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

  const cleanupIR = parseExpression(String(rawCleanup));
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
  const onIR = parseExpression(onRaw);
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
  const initialIR = parseExpression(String(rawInitial));
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
  const valueIR = parseExpression(String(rawTo));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`set to=\` — bind to \`let\` first, then call set.`,
    );
  }
  return [`${pythonName} = ${emitPyExprCtx(valueIR, ctx)}`];
}

function emitLetPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '_');
  validateBodyLetKind(props.kind);
  declareLocalBinding(ctx, name, props.kind === 'let' ? 'let' : 'const');
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`${name} = None`];
  }
  const valueIR = parseExpression(String(rawValue));
  setRegexBinding(ctx, name, valueIR.kind === 'regexLit' ? valueIR : null);
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
  const targetIR = parseExpression(String(rawTarget));
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
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`assign value=\` — bind to \`let\` first, then assign.`,
    );
  }
  const stmt = `${emitPyExprCtx(targetIR, ctx)} ${rawOp} ${emitPyExprCtx(valueIR, ctx)}`;
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
  const source = emitPyExprCtx(parseExpression(String(rawSource)), ctx);
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
    for (const child of bindings) {
      const cp = (child.props ?? {}) as Record<string, unknown>;
      const name = String(cp.name ?? '');
      if (!name) throw new Error('body-statement `binding` requires `name=`.');
      const key = cp.key === undefined || cp.key === '' ? name : String(cp.key);
      lines.push(`${ctx.symbolMap[name] ?? name} = ${tmp}.get(${JSON.stringify(key)})`);
    }
    return lines;
  }

  const tmp = `__k_d${++ctx.gensymCounter}`;
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
          line: `${ctx.symbolMap[name] ?? name} = (${tmp}[${index}] if len(${tmp}) > ${index} else None)`,
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
      const exprIR = parseExpression(inner);
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
  const valueIR = parseExpression(String(rawValue));
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
  const valueIR = parseExpression(String(rawValue));
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
  const valueIR = parseExpression(String(rawValue));
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
  return emitPyExprCtx(node, freshCtx(options));
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
      return 'None';
    case 'regexLit':
      ctx.imports.add('re');
      return `__k_re.compile(${pyRegexPattern(node)}, ${pyRegexFlags(node.flags, { allowGlobal: true })})`;
    case 'ident':
      // Slice 3a — apply symbol-map rename so KERN-form `userId` becomes
      // Python-form `user_id`. Identifiers not in the map (locals, globals,
      // module names) pass through unchanged.
      if (ctx.shadowedSymbols.has(node.name)) return node.name;
      return ctx.symbolMap[node.name] ?? node.name;
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
      return wrapGuardIfAny(lowered);
    }
    case 'await':
      return `await ${emitPyExprCtx(node.argument, ctx)}`;
    case 'new':
      return emitPyExprCtx(node.argument, ctx);
    case 'typeAssert':
      return emitPyExprCtx(node.expression, ctx);
    case 'nonNull':
      return emitPyExprCtx(node.expression, ctx);
    case 'tmplLit': {
      // Lower TS template literals to Python f-strings.
      let out = 'f"';
      for (let i = 0; i < node.quasis.length; i++) {
        out += node.quasis[i]
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\{/g, '{{')
          .replace(/\}/g, '}}');
        if (i < node.expressions.length) out += `{${emitPyExprCtx(node.expressions[i], ctx)}}`;
      }
      out += '"';
      return out;
    }
    case 'binary': {
      if (node.op === '|' || node.op === '&' || node.op === '^' || node.op === '<<' || node.op === '>>' || node.op === '%') {
        const transformed = lowerBitwiseAndModuloAST(node);
        registerHelpers(transformed, ctx);
        return emitPyExprCtx(transformed, ctx);
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
        // mandatory (unlike raw host methods, which emit verbatim). The RHS
        // class name emits as-is — e.g. `Error` stays `Error`, consistent with
        // how host globals like `Date` already emit; KERN's portable surface is
        // the stdlib namespace, not raw host constructors.
        return `isinstance(${left}, ${right})`;
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
        if (isReceiverChainPure(node.left)) {
          return `(${left} if ${left} is not None else ${right})`;
        }
        const tmp = `__k_nc${++ctx.gensymCounter}`;
        return `(${tmp} if (${tmp} := ${left}) is not None else ${right})`;
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
        const transformed = lowerBitwiseAndModuloAST(node);
        registerHelpers(transformed, ctx);
        return emitPyExprCtx(transformed, ctx);
      }
      // Slice 2c — `!x` → `not x`, `-x` → `-x`.
      // Slice typeof — expose the now-eligible native KERN `typeof` shape on
      // Python too. Dynamic Python values are an approximation of JS typeof:
      // Python has no runtime `undefined`, `symbol`, or bigint distinction.
      if (node.op === 'typeof') return emitPyTypeof(node.argument, ctx);
      const arg = emitPyExprCtx(node.argument, ctx);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      if (node.op === '!') return `not ${wrapped}`;
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
      return `${wrap(node.consequent, consStr)} if ${wrap(node.test, testStr)} else ${wrap(node.alternate, altStr)}`;
    }
    case 'spread':
      return `*${emitPyExprCtx(node.argument, ctx)}`;
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is only allowed at statement level (top of \`let value=\` or \`return value=\`). ` +
          `Mid-expression \`${node.op}\` is rejected — bind the call to a \`let\` first, then use the bound name.`,
      );
  }
}

function emitPyTypeof(argument: ValueIR, ctx: BodyEmitContext): string {
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
  const previous = new Set(ctx.shadowedSymbols);
  for (const name of names) ctx.shadowedSymbols.add(name);
  try {
    const params = names.length === 0 ? '' : ` ${names.join(', ')}`;
    return `lambda${params}: ${emitPyExprCtx(node.body, ctx)}`;
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
      return valueReferencesIdent(node.body, name);
    default:
      return false;
  }
}

function containsLambdaCapturingIdent(node: ValueIR, name: string): boolean {
  switch (node.kind) {
    case 'lambda':
      if (node.params.some((p) => p.name === name)) return false;
      return valueReferencesIdent(node.body, name);
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
}

type ChainNode = Extract<ValueIR, { kind: 'member' | 'call' | 'index' }>;

function lowerChain(node: ChainNode, ctx: BodyEmitContext): GuardedExpr {
  if (node.kind === 'member') {
    const obj = node.object;
    const inner: GuardedExpr =
      obj.kind === 'member' || obj.kind === 'call' || obj.kind === 'index'
        ? lowerChain(obj, ctx)
        : { guard: null, expr: emitPyExprCtx(obj, ctx) };
    if (node.optional) {
      // The receiver expression names what we need to test. The expr names
      // the receiver twice (once in test, once in branch); reject when that
      // would re-evaluate side-effecting code.
      if (!isReceiverChainPure(node.object)) {
        throw new Error(
          "Optional chain '?.' on Python target requires a side-effect-free receiver (identifier or pure member chain). " +
            'Bind the call/await result to a `let` first, then use `let.field?.next` on the bound name.',
        );
      }
      const newGuard =
        inner.guard === null ? `${inner.expr} is not None` : `${inner.guard} and ${inner.expr} is not None`;
      return { guard: newGuard, expr: `${inner.expr}.${node.property}` };
    }
    return { guard: inner.guard, expr: `${inner.expr}.${node.property}` };
  }
  if (node.kind === 'index') {
    const obj = node.object;
    const inner: GuardedExpr =
      obj.kind === 'member' || obj.kind === 'call' || obj.kind === 'index'
        ? lowerChain(obj, ctx)
        : { guard: null, expr: emitPyExprCtx(obj, ctx) };
    const index = emitPyExprCtx(node.index, ctx);
    if (node.optional) {
      // The Python lowering names the receiver in the guard and the branch.
      // Keep that single-eval-safe by requiring a pure receiver. The index
      // expression appears only in the selected branch, matching JS `?.[]`.
      if (!isReceiverChainPure(node.object)) {
        throw new Error(
          "Optional element access '?.[]' on Python target requires a side-effect-free receiver. " +
            'Bind call/await receiver results to `let` first, then index the bound name.',
        );
      }
      const newGuard =
        inner.guard === null ? `${inner.expr} is not None` : `${inner.guard} and ${inner.expr} is not None`;
      return { guard: newGuard, expr: `${inner.expr}[${index}]` };
    }
    const wrapped = needsIndexReceiverParens(node.object) ? `(${inner.expr})` : inner.expr;
    return { guard: inner.guard, expr: `${wrapped}[${index}]` };
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
  const callee = node.callee;
  const inner: GuardedExpr =
    callee.kind === 'member' || callee.kind === 'call' || callee.kind === 'index'
      ? lowerChain(callee, ctx)
      : { guard: null, expr: emitPyExprCtx(callee, ctx) };
  const args = node.args.map((a) => emitPyExprCtx(a, ctx)).join(', ');
  return { guard: inner.guard, expr: `${inner.expr}(${args})` };
}

function lowerRegexCallPython(call: Extract<ValueIR, { kind: 'call' }>, ctx: BodyEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  const receiverRegex = resolveRegexExpr(callee.object, ctx);
  if (callee.property === 'test' && receiverRegex !== null) {
    if (call.args.length !== 1) return null;
    if (receiverRegex.flags.includes('g')) {
      throw new Error(
        "Python target does not lower RegExp.test with the 'g' flag because JS mutates lastIndex while Python re.search is stateless. Use Regex.contains once the KERN stdlib grows that cross-target shape.",
      );
    }
    ctx.imports.add('re');
    return `(__k_re.search(${pyRegexPattern(receiverRegex)}, ${emitPyExprCtx(call.args[0], ctx)}, ${pyRegexFlags(receiverRegex.flags)}) is not None)`;
  }
  const matchRegex = call.args.length === 1 ? resolveRegexExpr(call.args[0], ctx) : null;
  if (callee.property === 'match' && matchRegex !== null) {
    if (matchRegex.flags.includes('g')) {
      throw new Error(
        'Python target does not lower String.match(/.../g) because JS returns an array of matches while Python re.search returns a Match object. Use Regex.findAll once the KERN stdlib grows that cross-target shape.',
      );
    }
    ctx.imports.add('re');
    return `__k_re.search(${pyRegexPattern(matchRegex)}, ${emitPyExprCtx(callee.object, ctx)}, ${pyRegexFlags(matchRegex.flags)})`;
  }
  const replaceRegex = call.args.length === 2 ? resolveRegexExpr(call.args[0], ctx) : null;
  if (callee.property === 'replace' && replaceRegex !== null) {
    ctx.imports.add('re');
    const count = replaceRegex.flags.includes('g') ? '0' : '1';
    return `__k_re.sub(${pyRegexPattern(replaceRegex)}, ${emitPyExprCtx(call.args[1], ctx)}, ${emitPyExprCtx(callee.object, ctx)}, count=${count}, flags=${pyRegexFlags(replaceRegex.flags, { allowGlobal: true })})`;
  }
  return null;
}

function resolveRegexExpr(node: ValueIR, ctx: BodyEmitContext): Extract<ValueIR, { kind: 'regexLit' }> | null {
  if (node.kind === 'regexLit') return node;
  if (node.kind === 'ident') return lookupRegexBinding(ctx, node.name);
  return null;
}

function pyRegexPattern(node: Extract<ValueIR, { kind: 'regexLit' }>): string {
  // JS escapes `/` because it delimits the literal; Python string regexes do not
  // treat `/` specially, so preserve the semantic pattern without that escape.
  return JSON.stringify(node.pattern.replace(/\\\//g, '/'));
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
  return parts.length > 0 ? parts.join(' | ') : '0';
}

function wrapGuardIfAny(g: GuardedExpr): string {
  return g.guard === null ? g.expr : `(${g.expr} if ${g.guard} else None)`;
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

/** Slice 2a — KERN-stdlib dispatch for Python. Returns the lowered Python
 *  string when the call matches `<KnownModule>.<method>(args)`, or null when
 *  it doesn't. Throws on `<KnownModule>.<unknownMethod>(...)` with a
 *  did-you-mean suggestion. Mirror of `applyStdlibLoweringTS` in core.
 *
 *  Slice 3b — when the matched entry declares `requires.py`, the import
 *  identifier is added to the per-handler ctx.imports set so the FastAPI
 *  generator can emit `import math` (etc.) at the top of the function body. */
function applyStdlibLoweringPython(call: Extract<ValueIR, { kind: 'call' }>, ctx: BodyEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  if (callee.object.kind !== 'ident') return null;
  const moduleName = callee.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const methodName = callee.property;
  const entry = lookupStdlib(moduleName, methodName);
  if (entry === null) {
    const suggestion = suggestStdlibMethod(moduleName, methodName);
    const hint = suggestion ? ` Did you mean '${moduleName}.${suggestion}'?` : '';
    throw new Error(`Unknown KERN-stdlib method '${moduleName}.${methodName}'.${hint}`);
  }
  // Slice-2 review fix: enforce declared arity (matches TS-side check).
  if (call.args.length !== entry.arity) {
    throw new Error(
      `KERN-stdlib '${moduleName}.${methodName}' takes ${entry.arity} arg${entry.arity === 1 ? '' : 's'}, got ${call.args.length}.`,
    );
  }
  const listLambda = lowerListLambdaPython(moduleName, methodName, call, ctx);
  if (listLambda !== null) return listLambda;
  // Slice 3b — register required imports (e.g., `Number.floor` ⇒ `import math`).
  if (entry.requires?.py) ctx.imports.add(entry.requires.py);
  const args = call.args.map((a) => {
    const emitted = emitPyExprCtx(a, ctx);
    return needsArgParens(a) ? `(${emitted})` : emitted;
  });
  return applyTemplate(entry.py, args);
}

function lowerListLambdaPython(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
  ctx: BodyEmitContext,
): string | null {
  if (moduleName !== 'List') return null;
  if (methodName !== 'map' && methodName !== 'filter') return null;
  const source = emitPyExprCtx(call.args[0], ctx);
  const callback = call.args[1];
  if (callback.kind !== 'lambda') {
    const fn = emitPyExprCtx(callback, ctx);
    return methodName === 'map' ? `list(map(${fn}, ${source}))` : `list(filter(${fn}, ${source}))`;
  }
  if (callback.params.length !== 1) {
    throw new Error(`List.${methodName} expects a one-parameter lambda on the Python target.`);
  }
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

export const KERN_I32_HELPER_PY = [
  'import math',
  'def _i32(x):',
  '    if x is None: return 0',
  '    try:',
  '        if not math.isfinite(x): return 0',
  '        val = int(math.trunc(x))',
  '    except Exception:',
  '        try:',
  '            val = float(x)',
  '            if not math.isfinite(val): return 0',
  '            val = int(math.trunc(val))',
  '        except Exception:',
  '            return 0',
  '    return ((val & 0xFFFFFFFF) ^ 0x80000000) - 0x80000000',
].join('\n');

export const KERN_TMOD_HELPER_PY = [
  'import math',
  'def _tmod(a, b):',
  '    if a is None: a = 0',
  '    if b is None: b = 0',
  '    try:',
  '        fa = float(a)',
  '        fb = float(b)',
  '    except Exception:',
  '        return float(\'nan\')',
  '    if math.isnan(fa) or math.isnan(fb): return float(\'nan\')',
  '    if math.isinf(fa): return float(\'nan\')',
  '    if fb == 0: return float(\'nan\')',
  '    if math.isinf(fb): return fa',
  '    return fa - math.trunc(fa / fb) * fb',
].join('\n');

export function lowerBitwiseAndModuloAST(node: ValueIR): ValueIR {
  switch (node.kind) {
    case 'binary': {
      const left = lowerBitwiseAndModuloAST(node.left);
      const right = lowerBitwiseAndModuloAST(node.right);
      if (node.op === '|' || node.op === '&' || node.op === '^' || node.op === '<<' || node.op === '>>') {
        let rewrittenRight = right;
        if (node.op === '<<' || node.op === '>>') {
          const i32Right = wrapInI32(right);
          rewrittenRight = {
            kind: 'binary',
            op: '&',
            left: i32Right,
            right: { kind: 'numLit', value: 31, raw: '31' }
          };
        } else {
          rewrittenRight = wrapInI32(right);
        }
        const i32Left = wrapInI32(left);
        const bitwiseNode: ValueIR = {
          kind: 'binary',
          op: node.op,
          left: i32Left,
          right: rewrittenRight
        };
        return wrapInI32(bitwiseNode);
      } else if (node.op === '%') {
        return {
          kind: 'call',
          callee: { kind: 'ident', name: '_tmod' },
          args: [left, right],
          optional: false
        };
      }
      return { ...node, left, right };
    }
    case 'unary': {
      const argument = lowerBitwiseAndModuloAST(node.argument);
      if (node.op === '~') {
        const i32Arg = wrapInI32(argument);
        const unaryNode: ValueIR = {
          kind: 'unary',
          op: '~',
          argument: i32Arg
        };
        return wrapInI32(unaryNode);
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
        args: node.args.map(lowerBitwiseAndModuloAST)
      };
    case 'lambda':
      return { ...node, body: lowerBitwiseAndModuloAST(node.body) };
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
        entries: node.entries.map(e =>
          'kind' in e && (e as any).kind === 'spread'
            ? { kind: 'spread', argument: lowerBitwiseAndModuloAST((e as any).argument) }
            : { ...(e as any), value: lowerBitwiseAndModuloAST((e as any).value) }
        )
      };
    case 'arrayLit':
      return { ...node, items: node.items.map(lowerBitwiseAndModuloAST) };
    case 'conditional':
      return {
        ...node,
        test: lowerBitwiseAndModuloAST(node.test),
        consequent: lowerBitwiseAndModuloAST(node.consequent),
        alternate: lowerBitwiseAndModuloAST(node.alternate)
      };
    default:
      return node;
  }
}

function wrapInI32(node: ValueIR): ValueIR {
  return {
    kind: 'call',
    callee: { kind: 'ident', name: '_i32' },
    args: [node],
    optional: false
  };
}

export function registerHelpers(node: ValueIR, ctx: BodyEmitContext) {
  switch (node.kind) {
    case 'call':
      if (node.callee.kind === 'ident') {
        if (node.callee.name === '_i32') {
          ctx.helpers.add(KERN_I32_HELPER_PY);
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
      registerHelpers(node.body, ctx);
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
