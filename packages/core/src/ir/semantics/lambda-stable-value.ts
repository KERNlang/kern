import type { ValueIR } from '../../value-ir.js';
import { copyLambdaOwnedEnumerableProperties, readLambdaOwnedProperty } from './lambda-owned-property.js';
import { getBinding, hasBinding, type SemanticEnv } from './semantic-env.js';

const OBJECT_CREATE = Object.create;
const ARRAY_IS_ARRAY = Array.isArray;

export type StableValue = { known: boolean; value?: unknown; deferred?: boolean };
export type StableArrayShape = 'array' | 'non-array' | 'unknown';

const unknown = (...values: StableValue[]): StableValue => ({
  known: false,
  deferred: values.some((value) => value.deferred === true),
});

function stableBinary(operator: string, left: unknown, right: unknown): unknown {
  if (operator === '+') return (left as number) + (right as number);
  if (operator === '-') return (left as number) - (right as number);
  if (operator === '*') return (left as number) * (right as number);
  if (operator === '/') return (left as number) / (right as number);
  if (operator === '%') return (left as number) % (right as number);
  if (operator === '==' || operator === '===') return left === right;
  if (operator === '!=' || operator === '!==') return left !== right;
  if (operator === '<') return (left as number) < (right as number);
  if (operator === '<=') return (left as number) <= (right as number);
  if (operator === '>') return (left as number) > (right as number);
  if (operator === '>=') return (left as number) >= (right as number);
  return undefined;
}

export function stableValue(
  node: ValueIR,
  env: SemanticEnv,
  locals: ReadonlyMap<string, unknown>,
  unstableBindings: ReadonlySet<string>,
  localValues: ReadonlyMap<string, StableValue>,
  shadowedBindings: ReadonlySet<string> = new Set(),
  deferredBindings: ReadonlySet<string> = new Set(),
): StableValue {
  if (node.kind === 'numLit' || node.kind === 'strLit' || node.kind === 'boolLit') {
    return { known: true, value: node.value };
  }
  if (node.kind === 'nullLit') return { known: true, value: null };
  if (node.kind === 'undefLit') return { known: true, value: undefined };
  if (node.kind === 'ident') {
    if (shadowedBindings.has(node.name)) {
      return { known: false, deferred: deferredBindings.has(node.name) };
    }
    const local = localValues.get(node.name);
    if (local) return local;
    if (unstableBindings.has(node.name)) return { known: false, deferred: true };
    if (!locals.has(node.name) && hasBinding(env, node.name)) return { known: true, value: getBinding(env, node.name) };
    return { known: false };
  }
  if (node.kind === 'arrayLit') {
    const items = node.items.map((item) =>
      stableValue(item, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings),
    );
    return items.every((item) => item.known)
      ? { known: true, value: items.map((item) => item.value), deferred: items.some((item) => item.deferred) }
      : unknown(...items);
  }
  if (node.kind === 'objectLit') {
    const out = OBJECT_CREATE(null) as Record<string, unknown>;
    const values: StableValue[] = [];
    for (const entry of node.entries) {
      const value = stableValue(
        'kind' in entry && entry.kind === 'spread' ? entry.argument : (entry as { value: ValueIR }).value,
        env,
        locals,
        unstableBindings,
        localValues,
        shadowedBindings,
        deferredBindings,
      );
      values.push(value);
      if (!value.known) return unknown(...values);
      if ('kind' in entry && entry.kind === 'spread') copyLambdaOwnedEnumerableProperties(out, value.value);
      else out[(entry as { key: string }).key] = value.value;
    }
    return { known: true, value: out, deferred: values.some((value) => value.deferred) };
  }
  if (node.kind === 'nonNull' || node.kind === 'typeAssert') {
    return stableValue(node.expression, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings);
  }
  if (node.kind === 'conditional') {
    const test = stableValue(node.test, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings);
    if (!test.known) return test;
    return stableValue(
      test.value ? node.consequent : node.alternate,
      env,
      locals,
      unstableBindings,
      localValues,
      shadowedBindings,
      deferredBindings,
    );
  }
  if (node.kind === 'binary') {
    const left = stableValue(node.left, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings);
    if (!left.known) return left;
    if (node.op === '&&' && !left.value) return left;
    if (node.op === '||' && left.value) return left;
    if (node.op === '??' && left.value !== null && left.value !== undefined) return left;
    const right = stableValue(
      node.right,
      env,
      locals,
      unstableBindings,
      localValues,
      shadowedBindings,
      deferredBindings,
    );
    if (!right.known) return unknown(left, right);
    if (node.op === '&&' || node.op === '||' || node.op === '??') return right;
    return { known: true, value: stableBinary(node.op, left.value, right.value) };
  }
  if (node.kind === 'unary') {
    const argument = stableValue(
      node.argument,
      env,
      locals,
      unstableBindings,
      localValues,
      shadowedBindings,
      deferredBindings,
    );
    if (!argument.known) return argument;
    if (node.op === '!') return { known: true, value: !argument.value };
    if (node.op === '-') return { known: true, value: -(argument.value as number) };
    if (node.op === '+') return { known: true, value: +(argument.value as number) };
    if (node.op === 'typeof') return { known: true, value: typeof argument.value };
    if (node.op === 'void') return { known: true, value: undefined };
  }
  if (node.kind === 'member' || node.kind === 'index') {
    const object = stableValue(
      node.object,
      env,
      locals,
      unstableBindings,
      localValues,
      shadowedBindings,
      deferredBindings,
    );
    if (!object.known || object.value === null || object.value === undefined) return object;
    const key =
      node.kind === 'member'
        ? { known: true, value: node.property }
        : stableValue(node.index, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings);
    if (!key.known) return unknown(object, key);
    return { known: true, value: readLambdaOwnedProperty(object.value, key.value) };
  }
  return { known: false };
}

export function stableArrayShape(
  node: ValueIR,
  env: SemanticEnv,
  locals: ReadonlyMap<string, unknown>,
  unstableBindings: ReadonlySet<string>,
  localValues: ReadonlyMap<string, StableValue>,
  localShapes: ReadonlyMap<string, StableArrayShape>,
  shadowedBindings: ReadonlySet<string> = new Set(),
  shadowedShapes: ReadonlyMap<string, StableArrayShape> = new Map(),
  deferredBindings: ReadonlySet<string> = new Set(),
): StableArrayShape {
  const stable = stableValue(node, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings);
  if (stable.known) return ARRAY_IS_ARRAY(stable.value) ? 'array' : 'non-array';
  if (node.kind === 'ident') {
    return shadowedBindings.has(node.name)
      ? (shadowedShapes.get(node.name) ?? 'unknown')
      : (localShapes.get(node.name) ?? 'unknown');
  }
  if (node.kind === 'arrayLit') return 'array';
  if (node.kind === 'nonNull' || node.kind === 'typeAssert') {
    return stableArrayShape(
      node.expression,
      env,
      locals,
      unstableBindings,
      localValues,
      localShapes,
      shadowedBindings,
      shadowedShapes,
      deferredBindings,
    );
  }
  if (node.kind === 'conditional') {
    const consequent = stableArrayShape(
      node.consequent,
      env,
      locals,
      unstableBindings,
      localValues,
      localShapes,
      shadowedBindings,
      shadowedShapes,
      deferredBindings,
    );
    const alternate = stableArrayShape(
      node.alternate,
      env,
      locals,
      unstableBindings,
      localValues,
      localShapes,
      shadowedBindings,
      shadowedShapes,
      deferredBindings,
    );
    return consequent === alternate ? consequent : 'unknown';
  }
  if (node.kind === 'binary' && (node.op === '&&' || node.op === '||' || node.op === '??')) {
    const left = stableArrayShape(
      node.left,
      env,
      locals,
      unstableBindings,
      localValues,
      localShapes,
      shadowedBindings,
      shadowedShapes,
      deferredBindings,
    );
    const right = stableArrayShape(
      node.right,
      env,
      locals,
      unstableBindings,
      localValues,
      localShapes,
      shadowedBindings,
      shadowedShapes,
      deferredBindings,
    );
    return left === right ? left : 'unknown';
  }
  if (
    node.kind === 'call' &&
    node.callee.kind === 'member' &&
    node.callee.object.kind === 'ident' &&
    node.callee.object.name === 'List' &&
    (node.callee.property === 'map' || node.callee.property === 'filter')
  ) {
    return 'array';
  }
  return 'unknown';
}

export function stableArrayElementShape(
  node: ValueIR,
  env: SemanticEnv,
  locals: ReadonlyMap<string, unknown>,
  unstableBindings: ReadonlySet<string>,
  localValues: ReadonlyMap<string, StableValue>,
  shadowedBindings: ReadonlySet<string> = new Set(),
  deferredBindings: ReadonlySet<string> = new Set(),
): StableArrayShape {
  const stable = stableValue(node, env, locals, unstableBindings, localValues, shadowedBindings, deferredBindings);
  if (!stable.known || !ARRAY_IS_ARRAY(stable.value) || stable.value.length === 0) return 'unknown';
  const first = ARRAY_IS_ARRAY(stable.value[0]) ? 'array' : 'non-array';
  for (let index = 1; index < stable.value.length; index += 1) {
    if ((ARRAY_IS_ARRAY(stable.value[index]) ? 'array' : 'non-array') !== first) return 'unknown';
  }
  return first;
}
