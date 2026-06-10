/**
 * `lambda` runtime semantics — executable contract for single-expression closures.
 *
 * Scope:
 *   - expression-bodied lambdas only
 *   - normal by-reference capture for outer non-loop bindings
 *   - fresh per-iteration capture for callback loop parameters (the canonical
 *     KERN behavior matching TS callback invocation scope)
 *
 * Multi-statement/block closures are intentionally out of scope for this
 * contract. Fixtures use this node as a semantics wrapper: production emitters
 * see only normal KERN body statements after fixture lowering.
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import type { Trace } from './trace.js';

interface EvalScope {
  bindings: Map<string, unknown>;
  parent?: EvalScope;
}

type LambdaFn = (...args: unknown[]) => unknown;

function childScope(parent: EvalScope, bindings: Iterable<[string, unknown]> = []): EvalScope {
  return { bindings: new Map(bindings), parent };
}

function getBinding(scope: EvalScope, name: string): unknown {
  for (let cur: EvalScope | undefined = scope; cur; cur = cur.parent) {
    if (cur.bindings.has(name)) return cur.bindings.get(name);
  }
  throw new Error(`lambda: binding "${name}" not found`);
}

function setBinding(scope: EvalScope, name: string, value: unknown): void {
  for (let cur: EvalScope | undefined = scope; cur; cur = cur.parent) {
    if (cur.bindings.has(name)) {
      cur.bindings.set(name, value);
      return;
    }
  }
  scope.bindings.set(name, value);
}

function isLambdaFn(value: unknown): value is LambdaFn {
  return typeof value === 'function';
}

function evalValue(node: ValueIR, scope: EvalScope): unknown {
  switch (node.kind) {
    case 'numLit':
      return node.value;
    case 'strLit':
      return node.value;
    case 'boolLit':
      return node.value;
    case 'nullLit':
    case 'undefLit':
      return undefined;
    case 'ident':
      return getBinding(scope, node.name);
    case 'arrayLit':
      return node.items.map((item) => evalValue(item, scope));
    case 'objectLit': {
      const out: Record<string, unknown> = {};
      for (const entry of node.entries) {
        if ('kind' in entry && entry.kind === 'spread') {
          Object.assign(out, evalValue(entry.argument, scope));
        } else {
          const prop = entry as { key: string; value: ValueIR };
          out[prop.key] = evalValue(prop.value, scope);
        }
      }
      return out;
    }
    case 'member': {
      if (node.object.kind === 'ident' && node.object.name === 'List') {
        return { __kernStdlib: 'List', method: node.property };
      }
      const obj = evalValue(node.object, scope) as Record<string, unknown> | null | undefined;
      if (obj == null) {
        if (node.optional) return undefined;
        throw new Error(`lambda: cannot read member "${node.property}" from nullish value`);
      }
      return obj[node.property];
    }
    case 'index': {
      const obj = evalValue(node.object, scope) as Record<string, unknown> | unknown[];
      const idx = evalValue(node.index, scope) as string | number;
      return (obj as Record<string, unknown>)[idx];
    }
    case 'call':
      return evalCall(node, scope);
    case 'lambda': {
      const captured = scope;
      // Block-bodied arrows (slices 0+1) carry raw text, not an expression
      // `body`; the expression-semantics reference interpreter does not
      // execute statement blocks. They never reach here in practice (the
      // contract harness runs expression IR only).
      if (!node.body) {
        throw new Error(
          'evalValue: block-bodied arrow closures are not executable by the expression reference interpreter.',
        );
      }
      const lambdaBody = node.body;
      return (...args: unknown[]) => {
        const params = node.params.map((p, i) => [p.name, args[i]] as [string, unknown]);
        return evalValue(lambdaBody, childScope(captured, params));
      };
    }
    case 'binary':
      return evalBinary(node.op, evalValue(node.left, scope), evalValue(node.right, scope));
    case 'unary': {
      const arg = evalValue(node.argument, scope);
      if (node.op === '!') return !arg;
      if (node.op === '-') return -(arg as number);
      if (node.op === '+') return +(arg as number);
      if (node.op === 'typeof') return typeof arg;
      if (node.op === 'void') return undefined;
      throw new Error(`lambda: unsupported unary op "${node.op}"`);
    }
    case 'conditional':
      return evalValue(node.test, scope) ? evalValue(node.consequent, scope) : evalValue(node.alternate, scope);
    case 'nonNull':
    case 'typeAssert':
      return evalValue(node.expression, scope);
    case 'spread':
    case 'await':
    case 'new':
    case 'propagate':
    case 'regexLit':
    case 'tmplLit':
      throw new Error(`lambda: unsupported expression kind "${node.kind}" in semantic fixture`);
  }
}

function evalCall(node: Extract<ValueIR, { kind: 'call' }>, scope: EvalScope): unknown {
  if (
    node.callee.kind === 'member' &&
    node.callee.object.kind === 'ident' &&
    node.callee.object.name === 'List' &&
    (node.callee.property === 'map' || node.callee.property === 'filter')
  ) {
    if (node.args.length !== 2) throw new Error(`lambda: List.${node.callee.property} expects 2 args`);
    const source = evalValue(node.args[0], scope);
    if (!Array.isArray(source)) throw new Error(`lambda: List.${node.callee.property} source must be an array`);
    const callback = evalValue(node.args[1], scope);
    if (!isLambdaFn(callback)) throw new Error(`lambda: List.${node.callee.property} callback must be a lambda`);
    if (node.callee.property === 'map') return source.map((item) => callback(item));
    return source.filter((item) => Boolean(callback(item)));
  }

  const callee = evalValue(node.callee, scope);
  if (!isLambdaFn(callee)) throw new Error('lambda: attempted to call a non-function value');
  return callee(...node.args.map((arg) => evalValue(arg, scope)));
}

function evalBinary(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+':
      return (left as number) + (right as number);
    case '-':
      return (left as number) - (right as number);
    case '*':
      return (left as number) * (right as number);
    case '/':
      return (left as number) / (right as number);
    case '%':
      return (left as number) % (right as number);
    case '==':
    case '===':
      return left === right;
    case '!=':
    case '!==':
      return left !== right;
    case '<':
      return (left as number) < (right as number);
    case '<=':
      return (left as number) <= (right as number);
    case '>':
      return (left as number) > (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '&&':
      return left && right;
    case '||':
      return left || right;
    case '??':
      return left ?? right;
    default:
      throw new Error(`lambda: unsupported binary op "${op}"`);
  }
}

function runSetup(children: readonly IRNode[], scope: EvalScope): void {
  for (const child of children) {
    const props = (child.props ?? {}) as Record<string, unknown>;
    if (child.type === 'let') {
      const name = String(props.name ?? '');
      if (!name) throw new Error('lambda: setup let requires name');
      const rawValue = props.value;
      setBinding(
        scope,
        name,
        rawValue === undefined || rawValue === '' ? undefined : evalValue(parseExpression(String(rawValue)), scope),
      );
      continue;
    }
    if (child.type === 'assign') {
      const target = String(props.target ?? '');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
        throw new Error('lambda: setup assign supports identifier targets only');
      }
      const rawValue = props.value;
      if (rawValue === undefined || rawValue === '') throw new Error('lambda: setup assign requires value');
      setBinding(scope, target, evalValue(parseExpression(String(rawValue)), scope));
      continue;
    }
    throw new Error(`lambda: unsupported setup node "${child.type}"`);
  }
}

function traceText(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  return value.map((item) => String(item)).join(',');
}

function lambdaPreconditions(ir: IRNode): boolean {
  if (typeof ir.props?.expr !== 'string' || ir.props.expr.length === 0) return false;
  try {
    parseExpression(ir.props.expr);
    for (const child of ir.children ?? []) {
      if (child.type !== 'let' && child.type !== 'assign') return false;
      const raw = child.type === 'let' ? child.props?.value : child.props?.value;
      if (raw !== undefined && raw !== '') parseExpression(String(raw));
    }
    return true;
  } catch {
    return false;
  }
}

function lambdaEffects(ir: IRNode, env: SemanticEnv): Trace {
  const scope: EvalScope = { bindings: new Map(env.bindings) };
  runSetup(ir.children ?? [], scope);
  const result = evalValue(parseExpression(String(ir.props?.expr)), scope);
  return {
    events: [{ op: 'stdout', text: traceText(result) }],
    completion: { kind: 'normal' },
  };
}

function lambdaCompletion(ir: IRNode, env: SemanticEnv) {
  return lambdaEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'convert by-reference outer captures into by-value snapshots',
  'reuse callback loop binding across closure instances (Python late-binding closure bug)',
  'rewrite single-expression lambda body into multi-statement closure',
  'evaluate lambda body before invocation',
]);

function envBinding(name: string, value: unknown): Partial<SemanticEnv> {
  return { bindings: new Map([[name, value]]) };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'lambda: List.map transforms each item with a single-expression callback',
    ir: { type: 'lambda', props: { expr: 'List.map(xs, x => x * 2)' } },
    env: envBinding('xs', [1, 2, 3]),
    expected: { events: [{ op: 'stdout', text: '2,4,6' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: List.filter keeps items whose callback returns truthy',
    ir: { type: 'lambda', props: { expr: 'List.filter(xs, x => x > 1)' } },
    env: envBinding('xs', [1, 2, 3]),
    expected: { events: [{ op: 'stdout', text: '2,3' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: closure reads the current outer binding by reference',
    ir: {
      type: 'lambda',
      props: { expr: '[fn()]' },
      children: [
        { type: 'let', props: { name: 'outer', kind: 'let', value: '1' } },
        { type: 'let', props: { name: 'fn', value: '() => outer' } },
        { type: 'assign', props: { target: 'outer', value: '2' } },
      ],
    },
    expected: { events: [{ op: 'stdout', text: '2' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: two closures capture and read different outer bindings',
    ir: {
      type: 'lambda',
      props: { expr: '[readA(), readB()]' },
      children: [
        { type: 'let', props: { name: 'a', kind: 'let', value: '1' } },
        { type: 'let', props: { name: 'b', kind: 'let', value: '2' } },
        { type: 'let', props: { name: 'readA', value: '() => a' } },
        { type: 'let', props: { name: 'readB', value: '() => b' } },
        { type: 'assign', props: { target: 'a', value: '10' } },
        { type: 'assign', props: { target: 'b', value: '20' } },
      ],
    },
    expected: { events: [{ op: 'stdout', text: '10,20' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: closures produced in a callback loop capture fresh per-iteration bindings',
    ir: {
      type: 'lambda',
      props: { expr: 'List.map(List.map(xs, x => () => x), f => f())' },
    },
    env: envBinding('xs', [1, 2, 3]),
    expected: { events: [{ op: 'stdout', text: '1,2,3' }], completion: { kind: 'normal' } },
  },
]);

export const lambdaContract: NodeContract = {
  nodeType: 'lambda',
  preconditions: lambdaPreconditions,
  effects: lambdaEffects,
  completion: lambdaCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerLambdaContract(): void {
  if (registered) return;
  registerContract(lambdaContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetLambdaContractForTest(): void {
  registered = false;
}
