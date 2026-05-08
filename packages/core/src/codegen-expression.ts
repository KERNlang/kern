/** Serialize ValueIR to a TypeScript expression string. */

import { applyTemplate, KERN_STDLIB_MODULES, lookupStdlib, suggestStdlibMethod } from './codegen/kern-stdlib.js';
import type { ValueIR } from './value-ir.js';

// Slice 2c — extended precedence table covering equality, relational,
// additive, multiplicative ops alongside the existing nullish/logical.
// Numbers follow MDN's precedence ordering (higher = binds tighter).
const PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 10,
  '!=': 10,
  '===': 10,
  '!==': 10,
  '<': 11,
  '<=': 11,
  '>': 11,
  '>=': 11,
  '+': 13,
  '-': 13,
  '*': 14,
  '/': 14,
  '%': 14,
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
    case 'index': {
      const obj = emitExpression(node.object);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : ''}[${emitExpression(node.index)}]`;
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
    case 'lambda': {
      const params =
        !node.parenthesized && node.params.length === 1 && !node.params[0].type
          ? node.params[0].name
          : `(${node.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ')})`;
      return `${params} => ${emitExpression(node.body)}`;
    }
    case 'binary': {
      const left = emitExpression(node.left);
      const right = emitExpression(node.right);
      const lp = needsParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsParens(node.right, node.op, 'right') ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary': {
      // Slice-2 review fix: wrap binary/unary/spread args in parens to preserve
      // unary's tight binding. `!(a === b)` would otherwise emit `!a === b`.
      const arg = emitExpression(node.argument);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      const sep = node.op === 'typeof' || node.op === 'void' ? ' ' : '';
      return `${node.op}${sep}${wrapped}`;
    }
    case 'spread':
      return `...${emitExpression(node.argument)}`;
    case 'await': {
      const arg = emitExpression(node.argument);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `await ${wrapped}`;
    }
    case 'new': {
      const arg = emitExpression(node.argument);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `new ${wrapped}`;
    }
    case 'typeAssert': {
      const expr = emitExpression(node.expression);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped} as ${node.type}`;
    }
    case 'objectLit': {
      // Slice 2d — TS object literal. Bare-key when valid identifier; else JSON-quote.
      // Empty object emits `{}` to match JS convention.
      if (node.entries.length === 0) return '{}';
      const entries = node.entries.map((e) => {
        if ('kind' in e && (e as any).kind === 'spread') {
          return `...${emitExpression((e as any).argument)}`;
        }
        const prop = e as { key: string; value: ValueIR };
        const k = isValidJSIdent(prop.key) ? prop.key : JSON.stringify(prop.key);
        return `${k}: ${emitExpression(prop.value)}`;
      });
      return `{ ${entries.join(', ')} }`;
    }
    case 'arrayLit':
      return `[${node.items.map(emitExpression).join(', ')}]`;
    case 'conditional': {
      // Slice α-2: ternary `test ? consequent : alternate`. Right-associative
      // and lower precedence than every binary op — paren-wrap any non-atomic
      // child to keep the round-tripped TS unambiguous to humans and tools.
      const test = emitExpression(node.test);
      const consequent = emitExpression(node.consequent);
      const alternate = emitExpression(node.alternate);
      const wrap = (child: ValueIR, emitted: string): string =>
        needsConditionalChildParens(child) ? `(${emitted})` : emitted;
      return `${wrap(node.test, test)} ? ${wrap(node.consequent, consequent)} : ${wrap(node.alternate, alternate)}`;
    }
    case 'propagate':
      throw new Error(
        `Propagation '${node.op}' is only allowed at statement level (top of \`let value=\` or \`return value=\`). ` +
          `Mid-expression \`${node.op}\` (e.g., \`Text.upper(call()${node.op})\`) is rejected — bind the call to a \`let\` first, then use the bound name.`,
      );
  }
}

/** Precedence-aware paren-wrap predicate for binary children — exported so
 *  the Python target can share the same logic. The Python `binary` emitter
 *  doesn't have its own parent-op context outside this helper. */
export function needsBinaryParens(child: ValueIR, parentOp: string, side: 'left' | 'right'): boolean {
  if (child.kind !== 'binary') return false;
  // ?? mixed with || or && requires parens (either direction).
  if (parentOp === '??' && (child.op === '||' || child.op === '&&')) return true;
  if ((parentOp === '||' || parentOp === '&&') && child.op === '??') return true;
  const cp = PREC[child.op];
  const pp = PREC[parentOp];
  if (cp === undefined || pp === undefined) return false;
  if (cp < pp) return true;
  // Same precedence, left-associative: right child needs parens to preserve grouping.
  if (cp === pp && side === 'right') return true;
  return false;
}

function needsParens(child: ValueIR, parentOp: string, side: 'left' | 'right'): boolean {
  if (child.kind === 'typeAssert') return true;
  return needsBinaryParens(child, parentOp, side);
}

function needsReceiverParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'typeAssert' ||
    child.kind === 'conditional' ||
    child.kind === 'await' ||
    child.kind === 'lambda'
  );
}

function needsTypeAssertionParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'conditional' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'await' ||
    child.kind === 'new' ||
    child.kind === 'typeAssert' ||
    child.kind === 'lambda'
  );
}

function needsPrefixArgParens(child: ValueIR): boolean {
  return (
    child.kind === 'binary' ||
    child.kind === 'conditional' ||
    child.kind === 'unary' ||
    child.kind === 'spread' ||
    child.kind === 'typeAssert' ||
    child.kind === 'lambda'
  );
}

/** Slice α-2: paren-wrap predicate for ternary children. Ternary has very
 *  low precedence — only `,` and assignment are lower. Atoms (idents,
 *  literals, calls, members, parenthesized) emit without extra parens.
 *  Binary/unary/await/spread/new/conditional get wrapped for clarity. */
function needsConditionalChildParens(child: ValueIR): boolean {
  switch (child.kind) {
    case 'binary':
    case 'unary':
    case 'spread':
    case 'await':
    case 'new':
    case 'typeAssert':
    case 'conditional':
    case 'lambda':
      return true;
    default:
      return false;
  }
}

function escapeTemplateQuasi(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Slice 2d — used by objectLit emit to decide between bare-key (`{a: 1}`)
 *  and JSON-quoted key (`{"a-b": 1}`) in TS output. Mirrors the lexical-form
 *  rule for TS object-literal property names. */
function isValidJSIdent(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

/** Slice 2a — KERN-stdlib dispatch for TS. Returns the lowered TS string when
 *  the call matches `<KnownModule>.<method>(args)`, or null when it doesn't.
 *  Throws on `<KnownModule>.<unknownMethod>(...)` with a did-you-mean.
 *
 *  Args whose ValueIR is `binary`/`unary`/`spread` are wrapped in parens
 *  before template substitution so templates like `'$0.length'` produce
 *  correct precedence even when `$0` is `a + b` (→ `(a + b).length`). */
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
  // Slice-2 review fix: enforce declared arity. Silently ignoring extra args
  // hides bugs (`Text.upper(s, extra)` would emit `s.toUpperCase()` and drop
  // `extra` without warning).
  if (call.args.length !== entry.arity) {
    throw new Error(
      `KERN-stdlib '${moduleName}.${methodName}' takes ${entry.arity} arg${entry.arity === 1 ? '' : 's'}, got ${call.args.length}.`,
    );
  }
  const listLambda = lowerListLambdaTS(moduleName, methodName, call);
  if (listLambda !== null) return listLambda;
  const args = call.args.map((a) => {
    const emitted = emitExpression(a);
    return needsArgParens(a) ? `(${emitted})` : emitted;
  });
  return applyTemplate(entry.ts, args);
}

function lowerListLambdaTS(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
): string | null {
  if (moduleName !== 'List') return null;
  if (methodName !== 'map' && methodName !== 'filter') return null;
  const callback = call.args[1];
  if (callback.kind !== 'lambda') return null;
  const source = emitExpression(call.args[0]);
  const wrappedSource = needsArgParens(call.args[0]) ? `(${source})` : source;
  return `${wrappedSource}.${methodName}(${emitExpression(callback)})`;
}

/** Slice 2b helper — wrap an arg in parens when it's structurally a binary,
 *  unary, or spread expression. Templates like `'$0.length'` would otherwise
 *  bind member-access tighter than the arg's own ops. */
export function needsArgParens(arg: ValueIR): boolean {
  return (
    arg.kind === 'binary' ||
    arg.kind === 'unary' ||
    arg.kind === 'spread' ||
    arg.kind === 'typeAssert' ||
    arg.kind === 'conditional' ||
    arg.kind === 'await' ||
    arg.kind === 'lambda'
  );
}
