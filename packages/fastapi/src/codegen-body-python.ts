/** Native KERN handler-body codegen — Python target (slices 1–3).
 *
 *  Mirror of `packages/core/src/codegen/body-ts.ts` for the FastAPI/Python
 *  target. Walks the children of a handler with `lang=kern` and emits Python
 *  body lines. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `X = EXPR` (slice 1)
 *    - `return value="EXPR"` / bare `return` (slice 1)
 *    - `if cond="EXPR"` / sibling `else` — `if EXPR:\n    body\nelse:\n    body` (slice 2c).
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
}

/** Slice 3e — public return shape. `code` is the joined body text;
 *  `imports` is the per-handler set of import identifiers
 *  (e.g., `'math'` ⇒ `import math`) that the generator must emit at the
 *  top of the function body before the code.
 *
 *  Slice 4a review fix — `usedPropagation` is true iff the body emitted at
 *  least one `?` propagation hoist. Callers using `propagateStyle:
 *  'http-exception'` use this signal to decide whether to add `from
 *  fastapi import HTTPException` to the route file's imports. */
export interface BodyEmitResult {
  code: string;
  imports: Set<string>;
  usedPropagation: boolean;
}

interface BodyEmitContext {
  gensymCounter: number;
  imports: Set<string>;
  symbolMap: Record<string, string>;
  propagateStyle: 'value' | 'http-exception';
  usedPropagation: boolean;
  /** Slice 4c review fix (OpenCode + Gemini critical) — depth of nested
   *  `try` blocks. Propagation `?` lowers to `return tmp` (or `raise
   *  HTTPException` in route mode), and BOTH bypass the enclosing
   *  `except` clause unexpectedly. Reject `?` inside try with a clear
   *  let-bind hint. Increment on try entry, decrement on try exit. */
  tryDepth: number;
}

const INDENT_STEP = '    ';

function freshCtx(options?: BodyEmitOptions): BodyEmitContext {
  return {
    gensymCounter: 0,
    imports: new Set<string>(),
    symbolMap: options?.symbolMap ?? {},
    propagateStyle: options?.propagateStyle ?? 'value',
    usedPropagation: false,
    tryDepth: 0,
  };
}

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
  return { code, imports: ctx.imports, usedPropagation: ctx.usedPropagation };
}

function emitChildrenPy(children: IRNode[], ctx: BodyEmitContext, indent: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'let') {
      for (const line of emitLetPy(child, ctx)) lines.push(`${indent}${line}`);
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
      const catchIdx = tryChildren.findIndex((c) => c.type === 'catch');
      if (catchIdx === -1) {
        throw new Error('`try` must contain a `catch` child. Found orphan `try` in handler body.');
      }
      const catchNode = tryChildren[catchIdx];
      const tryBlockChildren = tryChildren.filter((c) => c.type !== 'catch');
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
      const errName = String(catchNode.props?.name ?? 'e');
      lines.push(`${indent}except Exception as ${errName}:`);
      const catchInner = emitChildrenPy(catchNode.children ?? [], ctx, indent + INDENT_STEP);
      if (catchInner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
      for (const cl of catchInner) lines.push(cl);
    } else if (child.type === 'catch') {
      throw new Error('`catch` must be a child of `try`. Found top-level `catch` in handler body.');
    } else if (child.type === 'throw') {
      for (const line of emitThrowPy(child, ctx)) lines.push(`${indent}${line}`);
    } else if (child.type === 'do') {
      for (const line of emitDoPy(child, ctx)) lines.push(`${indent}${line}`);
    } else if (child.type === 'each') {
      // Slice 4d — each loop.
      // Slice 4c+4d review fix (Codex P1) — read schema-compliant
      // `name`/`in` props (legacy `list`/`as` accepted as fallback).
      const listRaw = String(child.props?.in ?? child.props?.list ?? '[]');
      const asName = String(child.props?.name ?? child.props?.as ?? 'item');
      const listIR = parseExpression(listRaw);
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
      const iterVar = `__k_each_${++ctx.gensymCounter}`;
      lines.push(`${indent}for ${iterVar} in ${emitPyExprCtx(listIR, ctx)}:`);
      lines.push(`${indent}${INDENT_STEP}${asName} = ${iterVar}`);
      const inner = emitChildrenPy(child.children ?? [], ctx, indent + INDENT_STEP);
      if (inner.length === 0 && asName === iterVar) lines.push(`${indent}${INDENT_STEP}pass`);
      for (const sl of inner) lines.push(sl);
    }
  }
  return lines;
}

/** Slice 4c review fix (OpenCode + Gemini critical) — propagation `?`
 *  inside `try` has no clean lowering on either propagateStyle: the
 *  'value' style emits `return tmp` (exits the function bypassing
 *  except), and the 'http-exception' style emits `raise HTTPException`
 *  (caught by the bare `except Exception` we generate, swallowing the
 *  err). Reject at codegen with a let-bind hint. */
function rejectPropagationInsideTry(ctx: BodyEmitContext): void {
  if (ctx.tryDepth > 0) {
    throw new Error(
      "Propagation '?' is not allowed inside a `try` block — `return`/`raise` from the err branch interacts incorrectly with the enclosing `except` clause. " +
        'Bind the call to a `let` outside the try, then use `if x.kind == "err" then throw ...` inside the try, OR use raw `lang=ts`/`lang=python` for the affected handler.',
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

function emitLetPy(node: IRNode, ctx: BodyEmitContext): string[] {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const name = String(props.name ?? '_');
  const rawValue = props.value;
  if (rawValue === undefined || rawValue === '') {
    return [`${name} = None`];
  }
  const valueIR = parseExpression(String(rawValue));
  if (valueIR.kind === 'propagate' && valueIR.op === '?') {
    rejectPropagationInsideTry(ctx);
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    ctx.usedPropagation = true;
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, errPropagationLine(tmp, ctx), `${name} = ${tmp}.value`];
  }
  return [`${name} = ${emitPyExprCtx(valueIR, ctx)}`];
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
    case 'ident':
      // Slice 3a — apply symbol-map rename so KERN-form `userId` becomes
      // Python-form `user_id`. Identifiers not in the map (locals, globals,
      // module names) pass through unchanged.
      return ctx.symbolMap[node.name] ?? node.name;
    case 'member':
    case 'call': {
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
      const lowered = lowerMemberOrCall(node, ctx);
      return wrapGuardIfAny(lowered);
    }
    case 'await':
      return `await ${emitPyExprCtx(node.argument, ctx)}`;
    case 'new':
      return emitPyExprCtx(node.argument, ctx);
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
      // Slice 2c — `!x` → `not x`, `-x` → `-x`, others unsupported.
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
    case 'regexLit':
      throw new Error(
        `emitPyExpression: ValueIR kind '${node.kind}' is not supported in slice-2 native KERN bodies (Python target).`,
      );
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is only allowed at statement level (top of \`let value=\` or \`return value=\`). ` +
          `Mid-expression \`${node.op}\` is rejected — bind the call to a \`let\` first, then use the bound name.`,
      );
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

type MemberOrCall = Extract<ValueIR, { kind: 'member' | 'call' }>;

function lowerMemberOrCall(node: MemberOrCall, ctx: BodyEmitContext): GuardedExpr {
  if (node.kind === 'member') {
    const obj = node.object;
    const inner: GuardedExpr =
      obj.kind === 'member' || obj.kind === 'call'
        ? lowerMemberOrCall(obj, ctx)
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
  const stdlib = applyStdlibLoweringPython(node, ctx);
  if (stdlib !== null) return { guard: null, expr: stdlib };
  const callee = node.callee;
  const inner: GuardedExpr =
    callee.kind === 'member' || callee.kind === 'call'
      ? lowerMemberOrCall(callee, ctx)
      : { guard: null, expr: emitPyExprCtx(callee, ctx) };
  const args = node.args.map((a) => emitPyExprCtx(a, ctx)).join(', ');
  return { guard: inner.guard, expr: `${inner.expr}(${args})` };
}

function wrapGuardIfAny(g: GuardedExpr): string {
  return g.guard === null ? g.expr : `(${g.expr} if ${g.guard} else None)`;
}

/** Slice 3d (review fix) — receiver-purity walk for the optional-chain
 *  short-circuit lowering. Pure means: no observable side effects when
 *  re-named twice (once in the `is not None` guard, once in the branch).
 *
 *  Pure: `ident`, member chains rooted at `ident` (whether optional or
 *  not — repeated attribute access on `None` raises but never silently
 *  side-effects). NOT pure: `call`, `await`, `binary`, `unary`, `propagate`,
 *  literals (which are technically pure but never sensible receivers). */
function isReceiverChainPure(node: ValueIR): boolean {
  if (node.kind === 'ident') return true;
  if (node.kind === 'member') return isReceiverChainPure(node.object);
  return false;
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
  // Slice 3b — register required imports (e.g., `Number.floor` ⇒ `import math`).
  if (entry.requires?.py) ctx.imports.add(entry.requires.py);
  const args = call.args.map((a) => {
    const emitted = emitPyExprCtx(a, ctx);
    return needsArgParens(a) ? `(${emitted})` : emitted;
  });
  return applyTemplate(entry.py, args);
}
