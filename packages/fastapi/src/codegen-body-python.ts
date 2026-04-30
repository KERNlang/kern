/** Native KERN handler-body codegen — Python target (slice 1).
 *
 *  Mirror of `packages/core/src/codegen/body-ts.ts` for the FastAPI/Python
 *  target. Walks `let` / `return` child nodes of a handler with `lang=kern`
 *  and emits Python body lines.
 *
 *  Lowering parallels slice 7's TS hoist, in Python form:
 *
 *      __k_t1 = await call()
 *      if __k_t1.kind == 'err':
 *          return __k_t1
 *      u = __k_t1.value
 *
 *  Slice 1 surface: literals (str/num/bool/none), idents, calls, member
 *  access (data fields only), `await`, statement-level propagation `?` on
 *  Result-flavored callees. All other ValueIR kinds are slice 2+.
 *
 *  Output lines are unindented; the FastAPI generator indents them to match
 *  the surrounding `async def` / `def` body. The Python `if`-body line carries
 *  its own 4-space relative indent so the post-indent result is well-formed. */

import type { IRNode, ValueIR } from '@kernlang/core';
import { applyLowering, KERN_STDLIB_MODULES, lookupStdlib, parseExpression, suggestStdlibMethod } from '@kernlang/core';

interface BodyEmitContext {
  gensymCounter: number;
}

/** Emit the body of a native KERN handler as Python source.
 *
 *  Returns a multi-line string suitable for splicing into a `def`/`async def`
 *  body. Each top-level line is unindented; nested `if`-bodies carry a single
 *  level of 4-space indent (relative to the surrounding body). */
export function emitNativeKernBodyPython(handlerNode: IRNode): string {
  const ctx: BodyEmitContext = { gensymCounter: 0 };
  const lines: string[] = [];
  const children = handlerNode.children ?? [];
  for (const child of children) {
    if (child.type === 'let') {
      for (const line of emitLetPy(child, ctx)) lines.push(line);
    } else if (child.type === 'return') {
      for (const line of emitReturnPy(child, ctx)) lines.push(line);
    }
  }
  return lines.join('\n');
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
    const inner = emitPyExpression(valueIR.argument);
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, `    return ${tmp}`, `${name} = ${tmp}.value`];
  }
  return [`${name} = ${emitPyExpression(valueIR)}`];
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
    const inner = emitPyExpression(valueIR.argument);
    return [`${tmp} = ${inner}`, `if ${tmp}.kind == 'err':`, `    return ${tmp}`, `return ${tmp}.value`];
  }
  return [`return ${emitPyExpression(valueIR)}`];
}

/** Slice-1 ValueIR → Python expression. Covers the surface that body-ts.ts
 *  emits today; later slices extend per the spec. */
export function emitPyExpression(node: ValueIR): string {
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
      return node.name;
    case 'member': {
      const obj = emitPyExpression(node.object);
      // Slice-1 KERN-body forbids method calls on values; field access only.
      // The optional `?.` chain has no direct Python equivalent — slice 2
      // will introduce explicit `Option.flatten(...)` lowering. For now we
      // emit a plain `.` and let downstream tests flag if it surfaces.
      return `${obj}.${node.property}`;
    }
    case 'call': {
      // Slice 2a — KERN-stdlib dispatch (Python target).
      const stdlib = applyStdlibLoweringPython(node);
      if (stdlib !== null) return stdlib;
      const callee = emitPyExpression(node.callee);
      const args = node.args.map(emitPyExpression).join(', ');
      return `${callee}(${args})`;
    }
    case 'await':
      return `await ${emitPyExpression(node.argument)}`;
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
        if (i < node.expressions.length) out += `{${emitPyExpression(node.expressions[i])}}`;
      }
      out += '"';
      return out;
    }
    case 'binary':
    case 'unary':
    case 'spread':
    case 'regexLit':
      throw new Error(
        `emitPyExpression: ValueIR kind '${node.kind}' is not supported in slice-1 native KERN bodies (Python target).`,
      );
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is statement-level only — body codegen must hoist it before emitPyExpression.`,
      );
  }
}

/** Slice 2a — KERN-stdlib dispatch for Python. Returns the lowered Python
 *  string when the call matches `<KnownModule>.<method>(args)`, or null when
 *  it doesn't. Throws on `<KnownModule>.<unknownMethod>(...)` with a
 *  did-you-mean suggestion. Mirror of `applyStdlibLoweringTS` in core. */
function applyStdlibLoweringPython(call: Extract<ValueIR, { kind: 'call' }>): string | null {
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
  const args = call.args.map(emitPyExpression);
  return applyLowering(entry.py, args);
}
