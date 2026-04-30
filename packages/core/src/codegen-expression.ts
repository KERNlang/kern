/** Serialize ValueIR to a TypeScript expression string. */

import { KERN_STDLIB_MODULES, lookupStdlib, type StdlibLowering, suggestStdlibMethod } from './codegen/kern-stdlib.js';
import type { ValueIR } from './value-ir.js';

const PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
};

export function emitExpression(node: ValueIR): string {
  switch (node.kind) {
    case 'numLit':
      return node.raw;
    case 'strLit': {
      const q = node.quote;
      const escaped = node.value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/\x08/g, '\\b')
        .replace(/\f/g, '\\f')
        .replace(/\v/g, '\\v')
        .replace(new RegExp(q, 'g'), `\\${q}`);
      return `${q}${escaped}${q}`;
    }
    case 'boolLit':
      return node.value ? 'true' : 'false';
    case 'nullLit':
      return 'null';
    case 'undefLit':
      return 'undefined';
    case 'regexLit':
      return `/${node.pattern}/${node.flags}`;
    case 'tmplLit': {
      let out = '`';
      for (let i = 0; i < node.quasis.length; i++) {
        out += escapeTemplateQuasi(node.quasis[i]);
        if (i < node.expressions.length) out += `\${${emitExpression(node.expressions[i])}}`;
      }
      out += '`';
      return out;
    }
    case 'ident':
      return node.name;
    case 'member': {
      const obj = emitExpression(node.object);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : '.'}${node.property}`;
    }
    case 'call': {
      // Slice 2a — KERN-stdlib dispatch. When the callee is `Module.method`
      // and `Module` is a known stdlib module, route through the per-target
      // lowering table instead of the default emit path.
      const stdlib = applyStdlibLoweringTS(node);
      if (stdlib !== null) return stdlib;
      const callee = emitExpression(node.callee);
      const wrapped = needsReceiverParens(node.callee) ? `(${callee})` : callee;
      const args = node.args.map(emitExpression).join(', ');
      return node.optional ? `${wrapped}?.(${args})` : `${wrapped}(${args})`;
    }
    case 'binary': {
      const left = emitExpression(node.left);
      const right = emitExpression(node.right);
      const lp = needsParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsParens(node.right, node.op, 'right') ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary':
      return `${node.op}${node.op === 'typeof' || node.op === 'void' ? ' ' : ''}${emitExpression(node.argument)}`;
    case 'spread':
      return `...${emitExpression(node.argument)}`;
    case 'await':
      return `await ${emitExpression(node.argument)}`;
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is statement-level only — body codegen must hoist it before emitExpression. Got ${node.op} on ${node.argument.kind}.`,
      );
  }
}

function needsParens(child: ValueIR, parentOp: string, side: 'left' | 'right'): boolean {
  if (child.kind !== 'binary') return false;
  // TS forbids ?? mixed with || or && without parens (either direction)
  if (parentOp === '??' && (child.op === '||' || child.op === '&&')) return true;
  if ((parentOp === '||' || parentOp === '&&') && child.op === '??') return true;
  const cp = PREC[child.op];
  const pp = PREC[parentOp];
  if (cp === undefined || pp === undefined) return false;
  if (cp < pp) return true;
  // Same precedence, left-associative: right child needs parens to preserve grouping
  if (cp === pp && side === 'right') return true;
  return false;
}

function needsReceiverParens(child: ValueIR): boolean {
  return child.kind === 'binary' || child.kind === 'unary' || child.kind === 'spread';
}

function escapeTemplateQuasi(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Slice 2a — KERN-stdlib dispatch for TS. Returns the lowered TS string when
 *  the call matches `<KnownModule>.<method>(args)`, or null when it doesn't.
 *  Throws on `<KnownModule>.<unknownMethod>(...)` with a did-you-mean. */
function applyStdlibLoweringTS(call: Extract<ValueIR, { kind: 'call' }>): string | null {
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
  const args = call.args.map(emitExpression);
  return applyLowering(entry.ts, args);
}

/** Shared shape-driven emit for TS and Python lowerings. Used by both targets;
 *  the only target-specific input is the `args` array (already emitted in the
 *  target's syntax). */
export function applyLowering(lowering: StdlibLowering, args: string[]): string {
  if (lowering.kind === 'method') {
    const receiver = args[lowering.receiver];
    const rest = args.filter((_, i) => i !== lowering.receiver).join(', ');
    return `${receiver}.${lowering.name}(${rest})`;
  }
  if (lowering.kind === 'prop') {
    return `${args[lowering.receiver]}.${lowering.name}`;
  }
  // freeFn
  return `${lowering.name}(${args.join(', ')})`;
}
