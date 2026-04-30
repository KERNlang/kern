/** Native KERN handler-body codegen — Python target (slices 1 + 2c).
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

interface BodyEmitContext {
  gensymCounter: number;
}

const INDENT_STEP = '    ';

/** Emit the body of a native KERN handler as Python source. Returns a
 *  multi-line string. Each top-level line is unindented; nested `if`-bodies
 *  carry one level of 4-space indent per level of nesting. */
export function emitNativeKernBodyPython(handlerNode: IRNode): string {
  const ctx: BodyEmitContext = { gensymCounter: 0 };
  return emitChildrenPy(handlerNode.children ?? [], ctx, '').join('\n');
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
      lines.push(`${indent}if ${emitPyExpression(condIR)}:`);
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
    case 'binary': {
      // Slice 2c — arithmetic / comparison / logical lowering for Python.
      // Use precedence-aware paren-wrapping so `a + b * c` doesn't redundantly
      // wrap the right side (`a + (b * c)`) — same rule as the TS side.
      const left = emitPyExpression(node.left);
      const right = emitPyExpression(node.right);
      const lp = needsBinaryParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsBinaryParens(node.right, node.op, 'right') ? `(${right})` : right;
      const op = mapBinaryOpToPython(node.op);
      return `${lp} ${op} ${rp}`;
    }
    case 'unary': {
      // Slice 2c — `!x` → `not x`, `-x` → `-x`, others unsupported.
      const arg = emitPyExpression(node.argument);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      if (node.op === '!') return `not ${wrapped}`;
      if (node.op === '-') return `-${wrapped}`;
      if (node.op === '+') return `+${wrapped}`;
      throw new Error(`emitPyExpression: unary op '${node.op}' has no Python equivalent in slice-2c.`);
    }
    case 'objectLit': {
      // Slice 2d — Python dict literal. Keys are ALWAYS double-quoted (no
      // shorthand-key syntax in Python).
      const entries = node.entries.map((e) => `${JSON.stringify(e.key)}: ${emitPyExpression(e.value)}`);
      return `{${entries.join(', ')}}`;
    }
    case 'arrayLit':
      return `[${node.items.map(emitPyExpression).join(', ')}]`;
    case 'spread':
    case 'regexLit':
      throw new Error(
        `emitPyExpression: ValueIR kind '${node.kind}' is not supported in slice-2 native KERN bodies (Python target).`,
      );
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is statement-level only — body codegen must hoist it before emitPyExpression.`,
      );
  }
}

/** Slice 2c — map KERN/TS-flavored binary ops to Python equivalents.
 *  KERN inherits TS's `===` / `!==` strict-equality syntax; Python uses
 *  `==` / `!=` for the equivalent value-equality semantics on primitives.
 *  `??` (nullish coalesce) lowers to a Python ternary in slice 3 — for
 *  slice 2c it falls through and emits literally, which is invalid Python
 *  (caller should not produce `??` in body codegen until slice 3). */
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
  const args = call.args.map((a) => {
    const emitted = emitPyExpression(a);
    return needsArgParens(a) ? `(${emitted})` : emitted;
  });
  return applyTemplate(entry.py, args);
}
