/** Native KERN handler-body codegen — TypeScript target (slice 1).
 *
 *  Walks `let` / `return` child nodes of a handler with `lang=kern` and
 *  emits a TypeScript body string. Reuses `parseExpression` for value
 *  expressions and `emitExpression` for the non-propagate path; lowers
 *  statement-level propagation `?` via the same hoisted shape that slice 7
 *  established for raw-body propagation:
 *
 *      const __k_t1 = await call();
 *      if (__k_t1.kind === 'err') return __k_t1;
 *      const u = __k_t1.value;
 *
 *  Slice 1 scope:
 *    - Result-flavored propagation only (`'err'` discriminant). Option-flavored
 *      propagation in native bodies is deferred to slice 8 (typecheck-driven).
 *    - `let name=X value="EXPR"` and `return value="EXPR"` (or bare `return`).
 *    - Other child types are silently skipped at slice 1; later slices add
 *      `if`/`else`, expression statements, etc.
 *
 *  `gensymCounter` is local to each emit call — every handler gets its own
 *  fresh `__k_t1`, `__k_t2`, … sequence (same convention as slice 7). */

import { emitExpression } from '../codegen-expression.js';
import { parseExpression } from '../parser-expression.js';
import type { IRNode } from '../types.js';

interface BodyEmitContext {
  gensymCounter: number;
}

/** Emit the body of a native KERN handler as TypeScript source.
 *
 *  Returns a multi-line string suitable for splicing into a function body.
 *  Each line is unindented; the caller is responsible for indenting to match
 *  the surrounding TS scope. */
export function emitNativeKernBodyTS(handlerNode: IRNode): string {
  const ctx: BodyEmitContext = { gensymCounter: 0 };
  const lines: string[] = [];
  const children = handlerNode.children ?? [];
  for (const child of children) {
    if (child.type === 'let') {
      for (const line of emitLetTS(child, ctx)) lines.push(line);
    } else if (child.type === 'return') {
      for (const line of emitReturnTS(child, ctx)) lines.push(line);
    }
    // Other child types fall through silently — slice 2+ will recognize them.
  }
  return lines.join('\n');
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
    const tmp = `__k_t${++ctx.gensymCounter}`;
    const inner = emitExpression(valueIR.argument);
    return [`const ${tmp} = ${inner};`, `if (${tmp}.kind === 'err') return ${tmp};`, `return ${tmp}.value;`];
  }
  return [`return ${emitExpression(valueIR)};`];
}
