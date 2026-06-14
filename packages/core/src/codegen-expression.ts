/** Serialize ValueIR to a TypeScript expression string. */

import { isHostNamespaceRoot, unmappedHostNamespaceMessage } from './codegen/host-namespace.js';
import type { StdlibCallEntry } from './codegen/kern-stdlib.js';
import {
  applyTemplate,
  KERN_STDLIB_MODULES,
  lookupStdlibCall,
  lookupStdlibProperty,
  suggestStdlibMethod,
} from './codegen/kern-stdlib.js';
import type { ValueIR } from './value-ir.js';

export interface ExprEmitContext {
  isUserBinding(name: string): boolean;
  validateRawBlock?(rawBlock: string, isUserBinding: (name: string) => boolean): void;
}

const DIRECT_HOST_CALL_ROOTS: ReadonlySet<string> = new Set([
  'Date',
  'Map',
  'Set',
  'Promise',
  'Reflect',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'BigInt',
  'Intl',
  'URL',
]);

function rejectUnmappedHostNamespaceTS(root: string, member: string, ctx: ExprEmitContext | undefined): void {
  if (!isHostNamespaceRoot(root)) return;
  if (isUserBinding(ctx, root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}

function isUserBinding(ctx: ExprEmitContext | undefined, name: string): boolean {
  return ctx?.isUserBinding(name) === true;
}

function withAdditionalUserBindings(ctx: ExprEmitContext | undefined, names: string[]): ExprEmitContext | undefined {
  if (names.length === 0) return ctx;
  const local = new Set(names);
  const next: ExprEmitContext = {
    isUserBinding(name: string): boolean {
      return local.has(name) || ctx?.isUserBinding(name) === true;
    },
  };
  if (ctx?.validateRawBlock) {
    next.validateRawBlock = (rawBlock: string, isUserBinding: (name: string) => boolean): void => {
      ctx.validateRawBlock?.(rawBlock, isUserBinding);
    };
  }
  return next;
}

// Slice 2c — extended precedence table covering equality, relational,
// additive, multiplicative ops alongside the existing nullish/logical.
// Numbers follow MDN's precedence ordering (higher = binds tighter).
const PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  // Slice 6 — bitwise OR/XOR/AND sit between `&&` and equality (JS order:
  // `|` < `^` < `&` < `==`). The gap (4..6 free) leaves room above `&&`.
  '|': 7,
  '^': 8,
  '&': 9,
  '==': 10,
  '!=': 10,
  '===': 10,
  '!==': 10,
  '<': 11,
  '<=': 11,
  '>': 11,
  '>=': 11,
  instanceof: 11,
  // Slice 6 — shift sits between relational (11) and additive (13).
  '<<': 12,
  '>>': 12,
  '>>>': 12,
  '+': 13,
  '-': 13,
  '*': 14,
  '/': 14,
  '%': 14,
};

export function emitExpression(node: ValueIR, ctx?: ExprEmitContext): string {
  switch (node.kind) {
    case 'numLit':
      return node.raw;
    case 'strLit': {
      const q = node.quote;
      const escaped = escapeControlChars(node.value.replace(/\\/g, '\\\\')).replace(new RegExp(q, 'g'), `\\${q}`);
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
        if (i < node.expressions.length) out += `\${${emitExpression(node.expressions[i], ctx)}}`;
      }
      out += '`';
      return out;
    }
    case 'ident':
      return node.name;
    case 'member': {
      const stdlib = applyStdlibPropertyLoweringTS(node);
      if (stdlib !== null) return stdlib;
      const receiverRoot = hostNamespaceReceiverRoot(node.object);
      if (receiverRoot) rejectUnmappedHostNamespaceTS(receiverRoot, hostNamespaceMemberLabel(node.object, node.property), ctx);
      const obj = emitExpression(node.object, ctx);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : '.'}${node.property}`;
    }
    case 'index': {
      rejectKnownStdlibIndexTS(node);
      const receiverRoot = hostNamespaceReceiverRoot(node.object);
      if (receiverRoot) {
        const label = node.index.kind === 'strLit' ? node.index.value : '[computed]';
        rejectUnmappedHostNamespaceTS(receiverRoot, hostNamespaceMemberLabel(node.object, label), ctx);
      }
      const obj = emitExpression(node.object, ctx);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : ''}[${emitExpression(node.index, ctx)}]`;
    }
    case 'call': {
      // Slice 2a — KERN-stdlib dispatch. When the callee is `Module.method`
      // and `Module` is a known stdlib module, route through the per-target
      // lowering table instead of the default emit path.
      const stdlib = applyStdlibLoweringTS(node, ctx);
      if (stdlib !== null) return stdlib;
      if (node.callee.kind === 'ident') {
        if (!isUserBinding(ctx, node.callee.name) && (node.callee.name === 'Array' || node.callee.name === 'Object')) {
          throwUnknownStdlibMember(node.callee.name, 'call');
        }
        if (DIRECT_HOST_CALL_ROOTS.has(node.callee.name)) rejectUnmappedHostNamespaceTS(node.callee.name, 'call', ctx);
      }
      if (node.callee.kind === 'member') {
        const receiverRoot = hostNamespaceReceiverRoot(node.callee.object);
        if (receiverRoot) rejectUnmappedHostNamespaceTS(receiverRoot, hostNamespaceMemberLabel(node.callee.object, node.callee.property), ctx);
      }
      const callee = emitExpression(node.callee, ctx);
      const wrapped = needsReceiverParens(node.callee) ? `(${callee})` : callee;
      const args = node.args.map((arg) => emitExpression(arg, ctx)).join(', ');
      const typeArgs = node.typeArgs ? `<${node.typeArgs}>` : '';
      return node.optional ? `${wrapped}?.${typeArgs}(${args})` : `${wrapped}${typeArgs}(${args})`;
    }
    case 'lambda': {
      const params =
        !node.parenthesized && node.params.length === 1 && !node.params[0].type
          ? node.params[0].name
          : `(${node.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ')})`;
      const returnType = node.returnType ? `: ${node.returnType}` : '';
      const lambdaCtx = withAdditionalUserBindings(
        ctx,
        node.params.map((p) => p.name),
      );
      // Block-bodied arrow (slices 0+1): re-emit the raw block verbatim. The
      // raw text INCLUDES the outer braces, so emission adds nothing inside it
      // and `parse(emit(x))` reproduces `raw` byte-identically — the round-trip
      // invariant `canonicalKernExpression` relies on.
      if (node.bodyBlock) {
        validateRawBlockHostNamespacesTS(node.bodyBlock.raw, lambdaCtx);
        return `${params}${returnType} => ${node.bodyBlock.raw}`;
      }
      return `${params}${returnType} => ${emitExpression(node.body as ValueIR, lambdaCtx)}`;
    }
    case 'binary': {
      const left = emitExpression(node.left, ctx);
      const right = emitExpression(node.right, ctx);
      const lp = needsParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsParens(node.right, node.op, 'right') ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary': {
      // Slice-2 review fix: wrap binary/unary/spread args in parens to preserve
      // unary's tight binding. `!(a === b)` would otherwise emit `!a === b`.
      const arg = emitExpression(node.argument, ctx);
      const wrapped = needsArgParens(node.argument) ? `(${arg})` : arg;
      const sep = node.op === 'typeof' || node.op === 'void' ? ' ' : '';
      return `${node.op}${sep}${wrapped}`;
    }
    case 'spread':
      return `...${emitExpression(node.argument, ctx)}`;
    case 'await': {
      const arg = emitExpression(node.argument, ctx);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `await ${wrapped}`;
    }
    case 'new': {
      const ctorRoot = newExpressionRootIdentifier(node.argument);
      if (ctorRoot && !(ctorRoot === 'Error' && isSimpleErrorConstructor(node.argument))) {
        rejectUnmappedHostNamespaceTS(ctorRoot, 'constructor', ctx);
      }
      const arg = emitExpression(node.argument, ctx);
      const wrapped = needsPrefixArgParens(node.argument) ? `(${arg})` : arg;
      return `new ${wrapped}`;
    }
    case 'typeAssert': {
      const expr = emitExpression(node.expression, ctx);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped} as ${node.type}`;
    }
    case 'nonNull': {
      const expr = emitExpression(node.expression, ctx);
      const wrapped = needsTypeAssertionParens(node.expression) ? `(${expr})` : expr;
      return `${wrapped}!`;
    }
    case 'objectLit': {
      // Slice 2d — TS object literal. Bare-key when valid identifier; else JSON-quote.
      // Empty object emits `{}` to match JS convention.
      if (node.entries.length === 0) return '{}';
      const entries = node.entries.map((e) => {
        if ('kind' in e && (e as any).kind === 'spread') {
          return `...${emitExpression((e as any).argument, ctx)}`;
        }
        const prop = e as { key: string; rawKey?: string; value: ValueIR };
        const k = prop.rawKey ?? (isValidJSIdent(prop.key) ? prop.key : JSON.stringify(prop.key));
        return `${k}: ${emitExpression(prop.value, ctx)}`;
      });
      return `{ ${entries.join(', ')} }`;
    }
    case 'arrayLit':
      return `[${node.items.map((item) => emitExpression(item, ctx)).join(', ')}]`;
    case 'conditional': {
      // Slice α-2: ternary `test ? consequent : alternate`. Right-associative
      // and lower precedence than every binary op — paren-wrap any non-atomic
      // child to keep the round-tripped TS unambiguous to humans and tools.
      const test = emitExpression(node.test, ctx);
      const consequent = emitExpression(node.consequent, ctx);
      const alternate = emitExpression(node.alternate, ctx);
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

function newExpressionRootIdentifier(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'call' && node.callee.kind === 'ident') return node.callee.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return newExpressionRootIdentifier(node.expression);
  return null;
}

function isSimpleErrorConstructor(node: ValueIR): boolean {
  return (
    (node.kind === 'ident' && node.name === 'Error') ||
    (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name === 'Error')
  );
}

function hostNamespaceReceiverRoot(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node.object);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return hostNamespaceReceiverRoot(node.expression);
  return null;
}

function hostNamespaceMemberLabel(receiver: ValueIR, fallback: string): string {
  return firstMemberAfterRoot(receiver) ?? fallback;
}

function firstMemberAfterRoot(node: ValueIR): string | null {
  if (node.kind === 'ident') return null;
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return firstMemberAfterRoot(node.expression);
  if (node.kind === 'member') return firstMemberAfterRoot(node.object) ?? node.property;
  if (node.kind === 'index') {
    const label = node.index.kind === 'strLit' ? node.index.value : '[computed]';
    return firstMemberAfterRoot(node.object) ?? label;
  }
  return null;
}

export function validateRawHostNamespacesTS(source: string, ctx?: ExprEmitContext): void {
  for (const access of collectRawHostNamespaceAccesses(source)) {
    rejectUnmappedHostNamespaceTS(access.root, access.member, ctx);
  }
}

function validateRawBlockHostNamespacesTS(rawBlock: string, ctx: ExprEmitContext | undefined): void {
  if (ctx?.validateRawBlock) {
    ctx.validateRawBlock(rawBlock, ctx.isUserBinding);
    return;
  }
  validateRawHostNamespacesTS(rawBlock, ctx);
}

function collectRawHostNamespaceAccesses(source: string): Array<{ root: string; member: string }> {
  const accesses: Array<{ root: string; member: string }> = [];
  const roots = [
    'Math',
    'JSON',
    'Object',
    'Array',
    'Map',
    'Set',
    'Date',
    'RegExp',
    'Promise',
    'Reflect',
    'Symbol',
    'WeakMap',
    'WeakSet',
    'Proxy',
    'BigInt',
    'Error',
    'Number',
    'String',
    'Boolean',
    'Function',
    'console',
    'process',
    'globalThis',
    'crypto',
    'Intl',
    'URL',
  ].filter(isHostNamespaceRoot);
  if (roots.length === 0) return accesses;
  const rootAlt = roots.map(escapeRegExp).join('|');
  const memberRe = new RegExp(`(?<![\\w$])(${rootAlt})(?:\\s*(?:as\\s+[^.\\[)!]+|!))*\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*(['"])([^'"]+)\\3\\s*\\])`, 'g');
  let memberMatch: RegExpExecArray | null;
  while ((memberMatch = memberRe.exec(source)) !== null) {
    accesses.push({ root: memberMatch[1], member: memberMatch[2] ?? memberMatch[4] ?? '[computed]' });
  }
  const callRe = new RegExp(`(?<![\\w$.])(${rootAlt})\\s*\\(`, 'g');
  let callMatch: RegExpExecArray | null;
  while ((callMatch = callRe.exec(source)) !== null) {
    if (callMatch[1] === 'Error' && isRawNewErrorCall(source, callMatch.index)) continue;
    accesses.push({ root: callMatch[1], member: 'call' });
  }
  return accesses;
}

function isRawNewErrorCall(source: string, rootIndex: number): boolean {
  const prefix = source.slice(0, rootIndex).trimEnd();
  return /\bnew$/.test(prefix);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
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
  return escapeControlChars(s.replace(/\\/g, '\\\\')).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// Control chars that have no readable named escape — re-emitted as \xHH.
// Excludes \x08 \x09 \x0a \x0b \x0c \x0d (named: \b \t \n \v \f \r).
const UNNAMED_CONTROL_RE = /[\x00-\x07\x0e-\x1f\x7f]/g;

function escapeControlChars(s: string): string {
  return s
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\x08/g, '\\b')
    .replace(/\f/g, '\\f')
    .replace(/\v/g, '\\v')
    .replace(UNNAMED_CONTROL_RE, hexEscape);
}

function hexEscape(ch: string): string {
  return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
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
function applyStdlibPropertyLoweringTS(member: Extract<ValueIR, { kind: 'member' }>): string | null {
  if (member.optional) return null;
  if (member.object.kind !== 'ident') return null;
  const moduleName = member.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const entry = lookupStdlibProperty(moduleName, member.property);
  if (entry === null) {
    const callEntry = lookupStdlibCall(moduleName, member.property);
    if (callEntry !== null) {
      throw new Error(
        `KERN-stdlib method '${moduleName}.${member.property}' cannot be referenced as a value in portable expression lowering; call it directly.`,
      );
    }
    throwUnknownStdlibMember(moduleName, member.property);
  }
  return entry.ts;
}

function rejectKnownStdlibIndexTS(index: Extract<ValueIR, { kind: 'index' }>): void {
  if (index.object.kind !== 'ident') return;
  const moduleName = index.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return;
  const member = index.index.kind === 'strLit' ? index.index.value : '[computed]';
  throwUnknownStdlibMember(moduleName, member);
}

function applyStdlibLoweringTS(call: Extract<ValueIR, { kind: 'call' }>, ctx?: ExprEmitContext): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  if (callee.object.kind !== 'ident') return null;
  const moduleName = callee.object.name;
  if (!KERN_STDLIB_MODULES.has(moduleName)) return null;
  const methodName = callee.property;
  const entry = lookupStdlibCall(moduleName, methodName);
  if (entry === null) {
    const propertyEntry = lookupStdlibProperty(moduleName, methodName);
    if (propertyEntry !== null) {
      throw new Error(`KERN-stdlib property '${moduleName}.${methodName}' is not callable.`);
    }
    throwUnknownStdlibMember(moduleName, methodName);
  }
  // Slice-2 review fix: enforce declared arity. Silently ignoring extra args
  // hides bugs (`Text.upper(s, extra)` would emit `s.toUpperCase()` and drop
  // `extra` without warning).
  validateStdlibCallArity(moduleName, methodName, entry, call.args.length);
  if (moduleName === 'Array' && methodName === 'from' && call.args.some((arg) => arg.kind === 'spread')) {
    throw new Error('Array.from portable lowering does not accept spread arguments; pass source and mapper directly.');
  }
  const listLambda = lowerListLambdaTS(moduleName, methodName, call, ctx);
  if (listLambda !== null) return listLambda;
  const args = call.args.map((a, index) => {
    const emitted = emitExpression(a, ctx);
    return needsStdlibArgParens(a, entry.ts, index) ? `(${emitted})` : emitted;
  });
  return typeof entry.ts === 'function' ? entry.ts(args) : applyTemplate(entry.ts, args);
}

function needsStdlibArgParens(arg: ValueIR, template: StdlibCallEntry['ts'], index: number): boolean {
  if (arg.kind === 'spread') return false;
  if (arg.kind !== 'typeAssert') return needsArgParens(arg);
  if (typeof template === 'function') return true;
  return new RegExp(`\\$${index}(?:\\.|\\[)`).test(template);
}

function throwUnknownStdlibMember(moduleName: string, memberName: string): never {
  const suggestion = suggestStdlibMethod(moduleName, memberName);
  const hint = suggestion ? ` Did you mean '${moduleName}.${suggestion}'?` : '';
  throw new Error(`Unknown KERN-stdlib method/member '${moduleName}.${memberName}'.${hint}`);
}

function validateStdlibCallArity(
  moduleName: string,
  methodName: string,
  entry: NonNullable<ReturnType<typeof lookupStdlibCall>>,
  got: number,
): void {
  if (entry.arity !== undefined && got !== entry.arity) {
    throw new Error(
      `KERN-stdlib '${moduleName}.${methodName}' takes ${entry.arity} arg${entry.arity === 1 ? '' : 's'}, got ${got}.`,
    );
  }
  if (entry.minArity !== undefined && got < entry.minArity) {
    throw new Error(`KERN-stdlib '${moduleName}.${methodName}' takes at least ${entry.minArity} args, got ${got}.`);
  }
  if (entry.maxArity !== undefined && got > entry.maxArity) {
    throw new Error(`KERN-stdlib '${moduleName}.${methodName}' takes at most ${entry.maxArity} args, got ${got}.`);
  }
}

function lowerListLambdaTS(
  moduleName: string,
  methodName: string,
  call: Extract<ValueIR, { kind: 'call' }>,
  ctx?: ExprEmitContext,
): string | null {
  if (moduleName !== 'List') return null;
  if (methodName !== 'map' && methodName !== 'filter') return null;
  const callback = call.args[1];
  if (callback.kind !== 'lambda') return null;
  const source = emitExpression(call.args[0], ctx);
  const wrappedSource = needsArgParens(call.args[0]) ? `(${source})` : source;
  return `${wrappedSource}.${methodName}(${emitExpression(callback, ctx)})`;
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
