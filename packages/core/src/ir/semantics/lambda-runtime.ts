import { parseExpression } from '../../parser-expression.js';
import { checkedPortablePower, checkedPortablePowerChain, flattenPortablePowerChain } from '../../portable-power.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { copyLambdaOwnedEnumerableProperties, readLambdaOwnedProperty } from './lambda-owned-property.js';
import {
  assertLambdaPrimitiveBinaryOperands,
  assertLambdaPrimitiveUnaryOperand,
} from './lambda-primitive-operators.js';
import type { SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

const ARRAY = Array;
const BOOLEAN = Boolean;
const IS_ARRAY = ARRAY.isArray;
const MAP = Map;
const MAP_ENTRIES = MAP.prototype.entries;
const OBJECT_CREATE = Object.create;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_TO_STRING = Object.prototype.toString;
const REFLECT_APPLY = Reflect.apply;
const REGEXP_TEST = RegExp.prototype.test;
const STRING = String;
const WEAK_MAP = WeakMap;
const WEAK_MAP_GET = WEAK_MAP.prototype.get;
const WEAK_MAP_HAS = WEAK_MAP.prototype.has;
const WEAK_MAP_SET = WEAK_MAP.prototype.set;
const WEAK_SET = WeakSet;
const WEAK_SET_ADD = WEAK_SET.prototype.add;
const WEAK_SET_DELETE = WEAK_SET.prototype.delete;
const WEAK_SET_HAS = WEAK_SET.prototype.has;
const MAP_ITERATOR_NEXT = OBJECT_GET_PROTOTYPE_OF(
  REFLECT_APPLY(MAP_ENTRIES, new MAP(), []) as MapIterator<[unknown, unknown]>,
).next as (this: MapIterator<[unknown, unknown]>) => IteratorResult<[unknown, unknown]>;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

interface ScopeBinding {
  name: string;
  value: unknown;
}

interface EvalScope {
  bindings: ScopeBinding[];
  parent?: EvalScope;
  consumeIteration?: () => void;
}

interface PrivateClosureData {
  readonly body: ValueIR;
  readonly params: readonly { readonly name: string }[];
  readonly scope: EvalScope;
}

type PrivateClosure = object;
const PRIVATE_CLOSURES = new WEAK_MAP<PrivateClosure, PrivateClosureData>();

function scopeFromEnv(env: SemanticEnv, consumeIteration?: () => void): EvalScope {
  const bindings: ScopeBinding[] = [];
  const iterator = REFLECT_APPLY(MAP_ENTRIES, env.bindings, []) as MapIterator<[string, unknown]>;
  while (true) {
    const result = REFLECT_APPLY(MAP_ITERATOR_NEXT, iterator, []) as IteratorResult<[string, unknown]>;
    if (result.done) {
      return { bindings, consumeIteration, parent: env.parent ? scopeFromEnv(env.parent) : undefined };
    }
    bindings[bindings.length] = { name: result.value[0], value: result.value[1] };
  }
}

function childScope(parent: EvalScope, names: readonly string[], values: readonly unknown[]): EvalScope {
  const bindings = new ARRAY<ScopeBinding>(names.length);
  for (let index = 0; index < names.length; index += 1) {
    bindings[index] = { name: names[index], value: values[index] };
  }
  return { bindings, parent };
}

function ownBinding(scope: EvalScope, name: string): ScopeBinding | undefined {
  for (let index = scope.bindings.length - 1; index >= 0; index -= 1) {
    if (scope.bindings[index].name === name) return scope.bindings[index];
  }
  return undefined;
}

function getBinding(scope: EvalScope, name: string): unknown {
  for (let current: EvalScope | undefined = scope; current; current = current.parent) {
    const binding = ownBinding(current, name);
    if (binding) return binding.value;
  }
  throw new Error(`lambda: binding "${name}" not found`);
}

function setBinding(scope: EvalScope, name: string, value: unknown): void {
  for (let current: EvalScope | undefined = scope; current; current = current.parent) {
    const binding = ownBinding(current, name);
    if (binding) {
      binding.value = value;
      return;
    }
  }
  scope.bindings[scope.bindings.length] = { name, value };
}

function defineBinding(scope: EvalScope, name: string, value: unknown): void {
  const binding = ownBinding(scope, name);
  if (binding) binding.value = value;
  else scope.bindings[scope.bindings.length] = { name, value };
}

function consumeCollectionIteration(scope: EvalScope): void {
  for (let current: EvalScope | undefined = scope; current; current = current.parent) {
    if (current.consumeIteration) {
      current.consumeIteration();
      return;
    }
  }
}

function isPrivateClosure(value: unknown): value is PrivateClosure {
  return (
    typeof value === 'object' && value !== null && (REFLECT_APPLY(WEAK_MAP_HAS, PRIVATE_CLOSURES, [value]) as boolean)
  );
}

function invokePrivateClosure(closure: PrivateClosure, args: readonly unknown[]): unknown {
  const data = REFLECT_APPLY(WEAK_MAP_GET, PRIVATE_CLOSURES, [closure]) as PrivateClosureData | undefined;
  if (!data) throw new Error('lambda: attempted to invoke an invalid private closure');
  const names = new ARRAY<string>(data.params.length);
  for (let index = 0; index < data.params.length; index += 1) names[index] = data.params[index].name;
  return evalValue(data.body, childScope(data.scope, names, args));
}

function makePrivateClosure(body: ValueIR, params: readonly { readonly name: string }[], scope: EvalScope): object {
  const closure = OBJECT_CREATE(null) as object;
  REFLECT_APPLY(WEAK_MAP_SET, PRIVATE_CLOSURES, [closure, { body, params, scope } satisfies PrivateClosureData]);
  return closure;
}

function evalBinary(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) + (right as number);
    }
    case '-': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) - (right as number);
    }
    case '*': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) * (right as number);
    }
    case '/': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) / (right as number);
    }
    case '%': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) % (right as number);
    }
    case '**': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return checkedPortablePower(left, right);
    }
    case '==':
    case '===':
      return left === right;
    case '!=':
    case '!==':
      return left !== right;
    case '<': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) < (right as number);
    }
    case '<=': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) <= (right as number);
    }
    case '>': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) > (right as number);
    }
    case '>=': {
      assertLambdaPrimitiveBinaryOperands(op, left, right);
      return (left as number) >= (right as number);
    }
    default:
      throw new Error(`lambda: unsupported binary op "${op}"`);
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
    if (!IS_ARRAY(source)) throw new Error(`lambda: List.${node.callee.property} source must be an array`);
    const callback = evalValue(node.args[1], scope);
    if (!isPrivateClosure(callback)) throw new Error(`lambda: List.${node.callee.property} callback must be a lambda`);
    const result: unknown[] = [];
    for (let index = 0; index < source.length; index += 1) {
      consumeCollectionIteration(scope);
      const item = source[index];
      const next = invokePrivateClosure(callback, [item]);
      if (node.callee.property === 'map' || BOOLEAN(next))
        result[result.length] = node.callee.property === 'map' ? next : item;
    }
    return result;
  }
  const callee = evalValue(node.callee, scope);
  if (!isPrivateClosure(callee)) throw new Error('lambda: attempted to call a non-private closure');
  const args = new ARRAY<unknown>(node.args.length);
  for (let index = 0; index < node.args.length; index += 1) args[index] = evalValue(node.args[index], scope);
  return invokePrivateClosure(callee, args);
}

function evalValue(node: ValueIR, scope: EvalScope): unknown {
  switch (node.kind) {
    case 'numLit':
    case 'strLit':
    case 'boolLit':
      return node.value;
    case 'nullLit':
      return null;
    case 'undefLit':
      return undefined;
    case 'ident':
      return getBinding(scope, node.name);
    case 'arrayLit': {
      const result = new ARRAY<unknown>(node.items.length);
      for (let index = 0; index < node.items.length; index += 1) result[index] = evalValue(node.items[index], scope);
      return result;
    }
    case 'objectLit': {
      const out = OBJECT_CREATE(null) as Record<string, unknown>;
      for (let index = 0; index < node.entries.length; index += 1) {
        const entry = node.entries[index];
        if ('kind' in entry && entry.kind === 'spread') {
          copyLambdaOwnedEnumerableProperties(out, evalValue(entry.argument, scope));
        } else {
          const property = entry as { key: string; value: ValueIR };
          out[property.key] = evalValue(property.value, scope);
        }
      }
      return out;
    }
    case 'member': {
      if (node.object.kind === 'ident' && node.object.name === 'List') {
        return { __kernStdlib: 'List', method: node.property };
      }
      const object = evalValue(node.object, scope) as Record<string, unknown> | null | undefined;
      if (object === null || object === undefined) {
        if (node.optional) return undefined;
        throw new Error(`lambda: cannot read member "${node.property}" from nullish value`);
      }
      if (isPrivateClosure(object)) throw new Error('lambda: private closures are opaque');
      return readLambdaOwnedProperty(object, node.property);
    }
    case 'index': {
      const object = evalValue(node.object, scope) as Record<string, unknown> | null | undefined;
      if (object === null || object === undefined) {
        if (node.optional) return undefined;
        throw new Error('lambda: cannot index a nullish value');
      }
      if (isPrivateClosure(object)) throw new Error('lambda: private closures are opaque');
      return readLambdaOwnedProperty(object, evalValue(node.index, scope));
    }
    case 'call':
      return evalCall(node, scope);
    case 'lambda':
      if (node.bodyBlock || !node.body) throw new Error('lambda: block-bodied closures are not executable');
      return makePrivateClosure(node.body, node.params, scope);
    case 'binary': {
      if (node.op === '**') {
        return checkedPortablePowerChain(flattenPortablePowerChain(node).map((operand) => evalValue(operand, scope)));
      }
      const left = evalValue(node.left, scope);
      if (node.op === '&&') return left ? evalValue(node.right, scope) : left;
      if (node.op === '||') return left ? left : evalValue(node.right, scope);
      if (node.op === '??') return left === null || left === undefined ? evalValue(node.right, scope) : left;
      return evalBinary(node.op, left, evalValue(node.right, scope));
    }
    case 'unary': {
      const argument = evalValue(node.argument, scope);
      if (node.op === '!') return !argument;
      if (node.op === '-' || node.op === '+') {
        assertLambdaPrimitiveUnaryOperand(node.op, argument);
        return node.op === '-' ? -(argument as number) : +(argument as number);
      }
      if (node.op === 'typeof') return typeof argument;
      if (node.op === 'void') return undefined;
      throw new Error(`lambda: unsupported unary op "${node.op}"`);
    }
    case 'conditional':
      return evalValue(node.test, scope) ? evalValue(node.consequent, scope) : evalValue(node.alternate, scope);
    case 'nonNull':
    case 'typeAssert':
      return evalValue(node.expression, scope);
    default:
      throw new Error(`lambda: unsupported expression kind "${node.kind}"`);
  }
}

function runSetup(children: readonly IRNode[], scope: EvalScope): void {
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const props = (child.props ?? {}) as Record<string, unknown>;
    if (child.type === 'let') {
      const name = STRING(props.name ?? '');
      if (name === '') throw new Error('lambda: setup let requires name');
      const rawValue = props.value;
      defineBinding(
        scope,
        name,
        rawValue === undefined || rawValue === '' ? undefined : evalValue(parseExpression(STRING(rawValue)), scope),
      );
    } else if (child.type === 'assign') {
      const target = STRING(props.target ?? '');
      if (!(REFLECT_APPLY(REGEXP_TEST, IDENTIFIER, [target]) as boolean)) {
        throw new Error('lambda: setup assign supports identifier targets only');
      }
      const rawValue = props.value;
      if (rawValue === undefined || rawValue === '') throw new Error('lambda: setup assign requires value');
      setBinding(scope, target, evalValue(parseExpression(STRING(rawValue)), scope));
    } else throw new Error(`lambda: unsupported setup node "${child.type}"`);
  }
}

function traceText(value: unknown, seen: WeakSet<object> = new WEAK_SET()): string {
  if (!IS_ARRAY(value)) {
    if (typeof value === 'object' && value !== null) {
      return REFLECT_APPLY(OBJECT_TO_STRING, value, []) as string;
    }
    return STRING(value);
  }
  if (REFLECT_APPLY(WEAK_SET_HAS, seen, [value]) as boolean) {
    throw new Error('lambda: cyclic trace values are not executable');
  }
  REFLECT_APPLY(WEAK_SET_ADD, seen, [value]);
  let out = '';
  try {
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) out += ',';
      out += traceText(value[index], seen);
    }
  } finally {
    REFLECT_APPLY(WEAK_SET_DELETE, seen, [value]);
  }
  return out;
}

export function evaluateLambdaEffects(ir: IRNode, env: SemanticEnv, consumeIteration?: () => void): Trace {
  const scope = childScope(scopeFromEnv(env, consumeIteration), [], []);
  runSetup(ir.children ?? [], scope);
  const result = evalValue(parseExpression(STRING(ir.props?.expr)), scope);
  return { completion: { kind: 'normal' }, events: [{ op: 'stdout', text: traceText(result) }] };
}

export function evaluateLambdaCompletion(ir: IRNode, env: SemanticEnv) {
  return evaluateLambdaEffects(ir, env).completion;
}
