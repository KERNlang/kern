/** Native KERN handler-body codegen — TypeScript target (slices 1–3).
 *
 *  Walks the children of a handler with `lang=kern` and emits a TypeScript
 *  body string. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `const X = EXPR;` (slice 1)
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

import { isSupportedAssignOperator } from '../assignment-operators.js';
import { emitExpression } from '../codegen-expression.js';
import { parseExpression } from '../parser-expression.js';
import type { IRNode } from '../types.js';
import type { ValueIR } from '../value-ir.js';
import { emitFmtTemplate, emitIdentifier, emitTypeAnnotation } from './emitters.js';

/** Slice 3e — caller-provided options, parity with the Python body emitter.
 *  `symbolMap` is currently unused on the TS target; reserved for future
 *  use (e.g., reserved-word renames). */
export interface BodyEmitOptions {
  symbolMap?: Record<string, string>;
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
export function emitNativeKernBodyTSWithImports(handlerNode: IRNode, _options?: BodyEmitOptions): BodyEmitResult {
  const ctx: BodyEmitContext = { gensymCounter: 0, localScopes: [], tryDepth: 0, finallyDepth: 0 };
  const code = emitChildrenTS(handlerNode.children ?? [], ctx, '').join('\n');
  return { code, imports: new Set<string>() };
}

function emitChildrenTS(
  children: IRNode[],
  ctx: BodyEmitContext,
  indent: string,
  initialBindings: Array<[string, 'const' | 'let' | 'cell']> = [],
): string[] {
  const lines: string[] = [];
  ctx.localScopes.push(new Map(initialBindings));
  try {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type === 'comment') {
        for (const line of emitCommentTS(child)) lines.push(`${indent}${line}`);
      } else if (child.type === 'cell') {
        for (const line of emitCellTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'set') {
        for (const line of emitSetTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'let') {
        for (const line of emitLetTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'assign') {
        for (const line of emitAssignTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'destructure') {
        for (const line of emitDestructureTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'fmt') {
        for (const line of emitFmtTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'return') {
        for (const line of emitReturnTS(child, ctx)) lines.push(`${indent}${line}`);
      } else if (child.type === 'if') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpression(condRaw);
        // Slice-2 review fix: propagation `?` in an `if` condition has no
        // sensible single-line lowering; reject early with a clear message
        // pointing users at the let-bind workaround.
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `if cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}if (${emitExpression(condIR)}) {`);
        for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP)) lines.push(sl);
        // Walk the `else` chain so byte-equivalent `else if` chains compile back
        // out as `else if (...)` instead of `else { if (...) {...} else {...} }`.
        // Recognised shapes for `else`:
        //   1. else > [if, else_inner]  → chain: `} else if (cond) {...`, recurse on else_inner
        //   2. else > [if]              → terminal chain: `} else if (cond) {...}` (no else)
        //   3. else > anything else     → plain `} else { ... }`, chain ends
        // Slice 5b's migration emits shape 1/2; hand-written KERN can use any.
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
            lines.push(`${indent}} else if (${emitExpression(nestedCondIR)}) {`);
            for (const sl of emitChildrenTS(ifNode.children ?? [], ctx, indent + INDENT_STEP)) lines.push(sl);
            elseCandidate = ec.length === 2 ? ec[1] : undefined;
          } else {
            lines.push(`${indent}} else {`);
            for (const el of emitChildrenTS(ec, ctx, indent + INDENT_STEP)) lines.push(el);
            break;
          }
        }
        lines.push(`${indent}}`);
      } else if (child.type === 'else') {
        // Slice-2 review fix: orphan `else` (without a preceding `if` sibling)
        // is a structural error — silently dropping it produced confusing
        // miscompiles. The `if` arm above consumes its paired `else` via i++,
        // so reaching one here means it was orphaned.
        throw new Error('`else` must immediately follow an `if` sibling. Found orphan `else` in handler body.');
      } else if (child.type === 'while') {
        const condRaw = String(child.props?.cond ?? '');
        const condIR = parseExpression(condRaw);
        if (condIR.kind === 'propagate') {
          throw new Error(
            "Propagation '?' is not allowed in `while cond=` — bind the call to a `let` first, then test the bound name.",
          );
        }
        lines.push(`${indent}while (${emitExpression(condIR)}) {`);
        for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP)) lines.push(sl);
        lines.push(`${indent}}`);
      } else if (child.type === 'for') {
        for (const line of emitRangeForTS(child, ctx, indent)) lines.push(line);
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
          lines.push(`${indent}} catch (${errName}) {`);
          for (const cl of emitChildrenTS(catchNode.children ?? [], ctx, indent + INDENT_STEP)) lines.push(cl);
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
        const listIR = parseExpression(listRaw);
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
        if (pairKey && pairValue) {
          if (entriesMode && isAwait) {
            throw new Error('body-statement `each entries=true` cannot be combined with `await=true`.');
          }
          if (rawItemType !== undefined && rawItemType !== '') {
            throw new Error('body-statement `each type=` cannot be combined with pair-mode `pairKey=`/`pairValue=`.');
          }
          loopBindings.push([String(pairKey), 'const'], [String(pairValue), 'const']);
          const sourceExpr = emitExpression(listIR);
          const iterableExpr = entriesMode ? `Object.entries(${sourceExpr})` : sourceExpr;
          lines.push(
            `${indent}for${awaitPrefix} (const [${String(pairKey)}, ${String(pairValue)}] of ${iterableExpr}) {`,
          );
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
          const sourceExpr = emitExpression(listIR);
          const iterableExpr = `Object.entries(${sourceExpr})`;
          if (entryKey && entryValue) {
            throw new Error('body-statement `each` cannot combine `entryKey=` and `entryValue=`.');
          }
          if (entryKey) {
            const keyName = String(entryKey);
            loopBindings.push([keyName, 'const']);
            lines.push(`${indent}for (const [${keyName}] of ${iterableExpr}) {`);
          } else {
            const valueName = String(entryValue);
            loopBindings.push([valueName, 'const']);
            lines.push(`${indent}for (const [, ${valueName}] of ${iterableExpr}) {`);
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
            `${indent}for (const [${idxName}, ${asName}]${typeAnn} of (${emitExpression(listIR)}).entries()) {`,
          );
        } else {
          const itemType = rawItemType ? emitTypeAnnotation(String(rawItemType), 'unknown', child) : '';
          const asName = String(child.props?.name ?? child.props?.as ?? 'item');
          const typeAnn = itemType ? `: ${itemType}` : '';
          loopBindings.push([asName, 'const']);
          lines.push(`${indent}for${awaitPrefix} (const ${asName}${typeAnn} of ${emitExpression(listIR)}) {`);
        }
        for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP, loopBindings)) lines.push(sl);
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
    }
  } finally {
    ctx.localScopes.pop();
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
  const fromIR = parseExpression(String(rawFrom));
  const toIR = parseExpression(String(rawTo));
  const stepIR = parseExpression(rawStep);
  if (fromIR.kind === 'propagate' || toIR.kind === 'propagate' || stepIR.kind === 'propagate') {
    throw new Error(
      "Propagation '?' is not allowed in `for from=`/`to=`/`step=` — bind the value to a `let` before the loop.",
    );
  }
  const fromExpr = emitExpression(fromIR);
  const toExpr = emitExpression(toIR);
  const stepExpr = emitExpression(stepIR);
  const update = isRangeStepOne(rawStep) ? `${name}++` : `${name} += ${stepExpr}`;
  const startVar = `__k_for_start_${++ctx.gensymCounter}`;
  const endVar = `__k_for_end_${++ctx.gensymCounter}`;
  const lines = [`${indent}const ${startVar} = ${fromExpr};`, `${indent}const ${endVar} = ${toExpr};`];
  lines.push(`${indent}for (let ${name} = ${startVar}; ${name} < ${endVar}; ${update}) {`);
  for (const sl of emitChildrenTS(node.children ?? [], ctx, indent + INDENT_STEP, [[name, 'const']])) lines.push(sl);
  lines.push(`${indent}}`);
  return lines;
}

function validatePositiveRangeStep(rawStep: string): void {
  const trimmed = rawStep.trim();
  const numeric = Number(trimmed);
  if (!/^[0-9]+$/.test(trimmed) || !Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(
      'body-statement `for step=` must be a positive integer literal in this cross-target range-loop slice.',
    );
  }
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
  return /^[0-9]+$/.test(rawStep.trim()) && Number.isSafeInteger(numeric) && numeric === 1;
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
  const onIR = parseExpression(onRaw);
  const out: string[] = [];
  out.push(`${indent}switch (${emitExpression(onIR)}) {`);
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
    return [`${bindingKind} ${name}${typeAnn} = undefined;`];
  }
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitExpression(valueIR.argument);
    return [
      `const ${tmp} = ${inner};`,
      `if (${tmp}.kind === 'err') return ${tmp};`,
      `${bindingKind} ${name}${typeAnn} = ${tmp}.value;`,
    ];
  }
  return [`${bindingKind} ${name}${typeAnn} = ${emitExpression(valueIR)};`];
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
  if (rawValue === undefined || rawValue === '') {
    throw new Error('body-statement `assign` requires `value=`.');
  }
  if (!isSupportedAssignOperator(rawOp)) {
    throw new Error(`body-statement \`assign op=\` does not support \`${rawOp}\`.`);
  }
  const targetIR = parseExpression(String(rawTarget));
  if (!isAssignableTarget(targetIR)) {
    throw new Error('body-statement `assign target=` must be an identifier, member access, or index access.');
  }
  assertAssignableLocalTarget(targetIR, ctx);
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`assign value=\` — bind to \`let\` first, then assign.`,
    );
  }
  // Cell assignment auto-lowers to its React setter so authors can use the
  // same `assign target=X value=Y` shape regardless of whether X is a `let`
  // or a `cell`. For compound assigns (`+=`, `-=`, …), use the functional
  // updater form `setX((prev) => prev + value)` so multiple updates in the
  // same render turn compose correctly under React's batching (the naive
  // `setX(X + value)` form captures stale state).
  if (targetIR.kind === 'ident' && lookupLocalBinding(ctx, targetIR.name) === 'cell') {
    const setter = cellSetterName(targetIR.name);
    if (rawOp === '=') {
      return [`${setter}(${emitExpression(valueIR)});`];
    }
    const baseOp = rawOp.slice(0, -1);
    return [`${setter}((prev) => prev ${baseOp} ${emitExpression(valueIR)});`];
  }
  return [`${emitExpression(targetIR)} ${rawOp} ${emitExpression(valueIR)};`];
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
    rawInitial === undefined || rawInitial === '' ? 'undefined' : emitExpression(parseExpression(String(rawInitial)));
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
  const valueIR = parseExpression(String(rawTo));
  if (valueIR.kind === 'propagate') {
    throw new Error(
      `Propagation \`${valueIR.op}\` is not supported in \`set to=\` — bind to \`let\` first, then call set.`,
    );
  }
  // touch ctx to suppress unused-var lint if needed
  void ctx;
  return [`${setter}(${emitExpression(valueIR)});`];
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

function emitDestructureTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawSource = props.source;
  if (rawSource === undefined || rawSource === '') {
    throw new Error('body-statement `destructure` requires `source=`.');
  }
  const pattern = formatBodyDestructurePattern(node);
  const kind = props.kind === 'let' ? 'let' : 'const';
  const typeAnn = props.type ? `: ${emitTypeAnnotation(String(props.type), 'unknown', node)}` : '';
  const sourceIR = parseExpression(String(rawSource));
  if (sourceIR.kind === 'propagate' && sourceIR.op === '?') rejectPropagationInsideTry(ctx);
  return [`${kind} ${pattern}${typeAnn} = ${emitExpression(sourceIR)};`];
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
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitExpression(valueIR.argument);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`, `return ${tmp}.value;`];
  }
  return [`return ${emitExpression(valueIR)};`];
}

function emitThrowTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`throw new Error();`];
  }
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitExpression(valueIR.argument);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`, `throw ${tmp}.value;`];
  }
  return [`throw ${emitExpression(valueIR)};`];
}

function emitDoTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [];
  }
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitExpression(valueIR.argument);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`];
  }
  return [`${emitExpression(valueIR)};`];
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
  return [`${kind} ${name}${typeAnn} = \`${escapedTemplate}\`;`];
}
