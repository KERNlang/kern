/** Native KERN handler-body codegen — TypeScript target (slices 1 + 2c).
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

interface BodyEmitContext {
  gensymCounter: number;
}

const INDENT_STEP = '  ';

/** Emit the body of a native KERN handler as TypeScript source. Returns a
 *  multi-line string. Each top-level line is unindented; nested branches
 *  indent by 2 spaces per level. */
export function emitNativeKernBodyTS(handlerNode: IRNode): string {
  const ctx: BodyEmitContext = { gensymCounter: 0 };
  return emitChildrenTS(handlerNode.children ?? [], ctx, '').join('\n');
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
    }
    // Other child types fall through silently — slice 3 adds more.
  }
  return lines;
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
