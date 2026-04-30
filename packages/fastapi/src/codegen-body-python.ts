/** Native KERN handler-body codegen — Python target (slices 1–3).
 *
 *  Mirror of `packages/core/src/codegen/body-ts.ts` for the FastAPI/Python
 *  target. Walks the children of a handler with `lang=kern` and emits Python
 *  body lines. Recognized statements:
 *
 *    - `let name=X value="EXPR"` — `X = EXPR` (slice 1)
 *    - `return value="EXPR"` / bare `return` (slice 1)
 *    - `if cond="EXPR"` / sibling `else` — `if EXPR:\n    body\nelse:\n    body` (slice 2c)
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
}

/** Slice 3e — public return shape. `code` is the joined body text;
 *  `imports` is the per-handler set of import identifiers
 *  (e.g., `'math'` ⇒ `import math`) that the generator must emit at the
 *  top of the function body before the code. */
export interface BodyEmitResult {
  code: string;
  imports: Set<string>;
}

interface BodyEmitContext {
  gensymCounter: number;
  imports: Set<string>;
  symbolMap: Record<string, string>;
}

const INDENT_STEP = '    ';

function freshCtx(options?: BodyEmitOptions): BodyEmitContext {
  return {
    gensymCounter: 0,
    imports: new Set<string>(),
    symbolMap: options?.symbolMap ?? {},
  };
}

/** Emit the body of a native KERN handler as Python source. Returns the
 *  joined body text. Each top-level line is unindented; nested `if`-bodies
 *  carry one level of 4-space indent per level of nesting.
 *
 *  Legacy slice 1/2 signature — returns just the code string. Callers
 *  that also need the import set (slice 3b: `math` etc.) and/or want to
 *  pass a symbol map (slice 3a: `userId → user_id`) should use
 *  `emitNativeKernBodyPythonWithImports`. */
export function emitNativeKernBodyPython(handlerNode: IRNode, options?: BodyEmitOptions): string {
  return emitNativeKernBodyPythonWithImports(handlerNode, options).code;
}

/** Slice 3e — context-aware variant returning `{ code, imports }`. The
 *  FastAPI generator uses this to inject `import math` (etc.) at the top
 *  of the function body and to pass the param-rename map (3a) so the body
 *  resolves correctly against the snake_cased Python signature. */
export function emitNativeKernBodyPythonWithImports(handlerNode: IRNode, options?: BodyEmitOptions): BodyEmitResult {
  const ctx = freshCtx(options);
  const code = emitChildrenPy(handlerNode.children ?? [], ctx, '').join('\n');
  return { code, imports: ctx.imports };
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
      const next = children[i + 1];
      if (next && next.type === 'else') {
        lines.push(`${indent}else:`);
        const elseInner = emitChildrenPy(next.children ?? [], ctx, indent + INDENT_STEP);
        if (elseInner.length === 0) lines.push(`${indent}${INDENT_STEP}pass`);
        for (const el of elseInner) lines.push(el);
        i++;
      }
    } else if (child.type === 'else') {
      // Slice-2 review fix: orphan `else` is a structural error (matches TS side).
      throw new Error('`else` must immediately follow an `if` sibling. Found orphan `else` in handler body.');
    }
  }
  return lines;
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
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, `    return ${tmp}`, `${name} = ${tmp}.value`];
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
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitPyExprCtx(valueIR.argument, ctx);
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, `    return ${tmp}`, `return ${tmp}.value`];
  }
  return [`return ${emitPyExprCtx(valueIR, ctx)}`];
}

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
    case 'member': {
      // Slice 3d — optional-chain lowering. TS has a native `?.` operator;
      // Python doesn't, so we lower to a conditional expression. To avoid
      // double-evaluating side-effecting receivers, the receiver MUST be
      // pure (ident or member chain rooted at an ident). Anything else
      // (call/await/binary) is rejected with a let-bind hint.
      if (node.optional) {
        if (!isReceiverPureForOptionalChain(node.object)) {
          throw new Error(
            "Optional chain '?.' on Python target requires a side-effect-free receiver (identifier or pure member chain). " +
              'Bind the call/await result to a `let` first, then use `let.field?.next` on the bound name.',
          );
        }
        const obj = emitPyExprCtx(node.object, ctx);
        return `(${obj}.${node.property} if ${obj} is not None else None)`;
      }
      const obj = emitPyExprCtx(node.object, ctx);
      return `${obj}.${node.property}`;
    }
    case 'call': {
      // Slice 3d — optional call chain `f?.()` is rare and has no clean
      // single-expression Python lowering (would double-eval `f`). Punt to
      // a let-bind workaround until slice 4 introduces statement-level
      // expansion.
      if (node.optional) {
        throw new Error(
          "Optional call '?.()' is not yet supported on Python target. " +
            'Bind the function reference to a `let` first, then test for `none` before calling.',
        );
      }
      // Slice 2a — KERN-stdlib dispatch (Python target).
      const stdlib = applyStdlibLoweringPython(node, ctx);
      if (stdlib !== null) return stdlib;
      const callee = emitPyExprCtx(node.callee, ctx);
      const args = node.args.map((a) => emitPyExprCtx(a, ctx)).join(', ');
      return `${callee}(${args})`;
    }
    case 'await':
      return `await ${emitPyExprCtx(node.argument, ctx)}`;
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
      const entries = node.entries.map((e) => `${JSON.stringify(e.key)}: ${emitPyExprCtx(e.value, ctx)}`);
      return `{${entries.join(', ')}}`;
    }
    case 'arrayLit':
      return `[${node.items.map((i) => emitPyExprCtx(i, ctx)).join(', ')}]`;
    case 'spread':
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

/** Slice 3d — receiver-purity predicate for optional-chain lowering on the
 *  Python target. TS has native `?.`; Python has to lower to a conditional
 *  expression that names the receiver twice, so the receiver MUST be free
 *  of observable side effects. Identifier and member-of-identifier chains
 *  qualify; calls/awaits/binaries don't. */
function isReceiverPureForOptionalChain(node: ValueIR): boolean {
  if (node.kind === 'ident') return true;
  if (node.kind === 'member' && !node.optional) return isReceiverPureForOptionalChain(node.object);
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
    case '??':
      throw new Error(
        "Nullish coalesce '??' is not yet supported in native KERN bodies on Python target. " +
          'Slice 3 introduces a single-eval lowering; for now, write an explicit `if x === none then ...` ' +
          'or use `lang=ts` opt-out for the affected handler.',
      );
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
