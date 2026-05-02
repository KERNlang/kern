/** Native KERN handler-body codegen — TypeScript target (slices 1–3).
 *
 *  Walks the children of a handler with `lang=kern` and emits a TypeScript
 *  body string. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `const X = EXPR;` (slice 1)
 *    - `return value="EXPR"` / bare `return` — `return EXPR;` (slice 1)
 *    - `if cond="EXPR"` / sibling `else` — `if (EXPR) { … } else { … }` (slice 2c)
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
 *      `else if` chains land in slice 3 — for slice 2c users nest `if` inside
 *      the `else` branch.
 *
 *  `gensymCounter` is local to each emit call — every handler gets its own
 *  fresh `__k_t1`, `__k_t2`, … sequence (same convention as slice 7).
 *
 *  Indentation: the recursive walk threads an `indent` string so nested
 *  `if`/`else` branches indent correctly. The caller adds the leading indent
 *  for the surrounding function body. */

import { emitExpression } from '../codegen-expression.js';
import { parseExpression } from '../parser-expression.js';
import type { IRNode } from '../types.js';

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
  /** Slice 4c review fix (OpenCode + Gemini critical) — depth of nested
   *  `try` blocks the emitter is currently inside. Propagation `?` lowers
   *  to a `return` that exits the function — that bypasses the enclosing
   *  `catch`, which is almost never what users mean. Increment on try
   *  entry, decrement on try exit; the let/return propagation paths
   *  check `tryDepth > 0` and throw with a let-bind hint. */
  tryDepth: number;
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
  const ctx: BodyEmitContext = { gensymCounter: 0, tryDepth: 0 };
  const code = emitChildrenTS(handlerNode.children ?? [], ctx, '').join('\n');
  return { code, imports: new Set<string>() };
}

function emitChildrenTS(children: IRNode[], ctx: BodyEmitContext, indent: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'let') {
      for (const line of emitLetTS(child, ctx)) lines.push(`${indent}${line}`);
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
      const next = children[i + 1];
      if (next && next.type === 'else') {
        lines.push(`${indent}} else {`);
        for (const el of emitChildrenTS(next.children ?? [], ctx, indent + INDENT_STEP)) lines.push(el);
        i++;
      }
      lines.push(`${indent}}`);
    } else if (child.type === 'else') {
      // Slice-2 review fix: orphan `else` (without a preceding `if` sibling)
      // is a structural error — silently dropping it produced confusing
      // miscompiles. The `if` arm above consumes its paired `else` via i++,
      // so reaching one here means it was orphaned.
      throw new Error('`else` must immediately follow an `if` sibling. Found orphan `else` in handler body.');
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
      const catchIdx = tryChildren.findIndex((c) => c.type === 'catch');
      if (catchIdx === -1) {
        throw new Error('`try` must contain a `catch` child. Found orphan `try` in handler body.');
      }
      const catchNode = tryChildren[catchIdx];
      const tryBlockChildren = tryChildren.filter((c) => c.type !== 'catch');
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
      const errName = String(catchNode.props?.name ?? 'e');
      lines.push(`${indent}} catch (${errName}) {`);
      for (const cl of emitChildrenTS(catchNode.children ?? [], ctx, indent + INDENT_STEP)) lines.push(cl);
      lines.push(`${indent}}`);
    } else if (child.type === 'catch') {
      throw new Error('`catch` must be a child of `try`. Found top-level `catch` in handler body.');
    } else if (child.type === 'throw') {
      // Slice 4c — throw statement.
      for (const line of emitThrowTS(child, ctx)) lines.push(`${indent}${line}`);
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
      const asName = String(child.props?.name ?? child.props?.as ?? 'item');
      const listIR = parseExpression(listRaw);
      lines.push(`${indent}for (const ${asName} of ${emitExpression(listIR)}) {`);
      for (const sl of emitChildrenTS(child.children ?? [], ctx, indent + INDENT_STEP)) lines.push(sl);
      lines.push(`${indent}}`);
    }
    // Other child types fall through silently — slice 3 adds more.
  }
  return lines;
}

/** Slice 4c review fix (OpenCode + Gemini critical) — propagation `?`
 *  inside a `try` block has no clean lowering. The hoisted err-branch
 *  emits `return tmp` which exits the function entirely, BYPASSING the
 *  enclosing `catch`. That's almost never what users mean — they wrote
 *  `?` to flag a Result.err and (presumably) to let the catch handle
 *  it. Reject at codegen with a let-bind hint. Same shape as
 *  slice-2's reject-`?`-in-`if-cond` rule. */
function rejectPropagationInsideTry(ctx: BodyEmitContext): void {
  if (ctx.tryDepth > 0) {
    throw new Error(
      "Propagation '?' is not allowed inside a `try` block — `return` from the err branch exits the function and bypasses the enclosing `catch`. " +
        'Bind the call to a `let` outside the try, then use `if x.kind === "err" throw new Error(...)` inside the try, OR use raw `lang=ts`/`lang=python` for the affected handler.',
    );
  }
}

function emitLetTS(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '_');
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`const ${name} = undefined;`];
  }
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitExpression(valueIR.argument);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`, `const ${name} = ${tmp}.value;`];
  }
  return [`const ${name} = ${emitExpression(valueIR)};`];
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
