import { classifyEachCollectionReference } from '../../each-collection-reference.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { evalRecordArrayFieldReferenceValue } from './portable-record-evaluator.js';
import { isPortableScalar } from './portable-scalar-domain.js';
import { getBinding, hasBinding, recordArrayFieldsForBinding, type SemanticEnv } from './semantic-env.js';

const ARRAY_IS_ARRAY = Array.isArray;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_KEYS = Object.keys;
const OBJECT_VALUES = Object.values;
const REFLECT_APPLY = Reflect.apply;
const MAP_ENTRIES = Map.prototype.entries;
const MAP_SIZE_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(Map.prototype, 'size')?.get;
const SET_SIZE_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(Set.prototype, 'size')?.get;
const MAP_ITERATOR_NEXT = OBJECT_GET_PROTOTYPE_OF(
  REFLECT_APPLY(MAP_ENTRIES, new Map(), []) as MapIterator<[unknown, unknown]>,
).next as (this: MapIterator<[unknown, unknown]>) => IteratorResult<[unknown, unknown]>;

export type EachShape = 'array' | 'array-indexed' | 'pair-sync' | 'pair-async' | 'entry-key' | 'entry-value';

export interface EachProps {
  name?: string;
  index?: string;
  pairKey?: string;
  pairValue?: string;
  entryKey?: string;
  entryValue?: string;
  entries?: boolean;
  await?: boolean;
  in?: string;
  type?: string;
  key?: string;
}

export interface EachIterationStep {
  bindings: Array<[string, unknown]>;
  /** The primary binding surfaced in the `iter-next` trace event. */
  primary: [string, unknown];
}

function asEachProps(ir: IRNode): EachProps {
  return (ir.props ?? {}) as EachProps;
}

/** Detect the single iteration shape selected by an `each` node. */
export function detectEachShape(p: EachProps): EachShape | null {
  const hasName = typeof p.name === 'string';
  const hasIndex = typeof p.index === 'string';
  const hasPairKey = typeof p.pairKey === 'string';
  const hasPairValue = typeof p.pairValue === 'string';
  const hasEntryKey = typeof p.entryKey === 'string';
  const hasEntryValue = typeof p.entryValue === 'string';
  const isAwait = p.await === true;
  const isEntries = p.entries === true;

  const arrayMode = hasName && !hasPairKey && !hasPairValue && !hasEntryKey && !hasEntryValue && !isEntries;
  const pairMode = hasPairKey && hasPairValue && !hasName && !hasEntryKey && !hasEntryValue && !hasIndex && !isEntries;
  const entryKeyMode = hasEntryKey && !hasName && !hasPairKey && !hasPairValue && !hasEntryValue && !hasIndex;
  const entryValueMode = hasEntryValue && !hasName && !hasPairKey && !hasPairValue && !hasEntryKey && !hasIndex;

  if (arrayMode) {
    if (isAwait) return null;
    return hasIndex ? 'array-indexed' : 'array';
  }
  if (pairMode) return isAwait ? 'pair-async' : 'pair-sync';
  if (entryKeyMode && isEntries && !isAwait) return 'entry-key';
  if (entryValueMode && isEntries && !isAwait) return 'entry-value';
  return null;
}

export function eachShapePreconditions(ir: IRNode): boolean {
  const p = asEachProps(ir);
  return (
    typeof p.in === 'string' && detectEachShape(p) !== null && Array.isArray(ir.children) && ir.children.length > 0
  );
}

export function eachPreconditions(ir: IRNode, _env: SemanticEnv): boolean {
  return eachShapePreconditions(ir);
}

export function isInternalEffectMachineEach(ir: IRNode): boolean {
  return eachShapePreconditions(ir);
}

export function internalEffectMachineEachIterationCount(ir: IRNode, env: SemanticEnv): number {
  if (!isInternalEffectMachineEach(ir)) {
    throw new Error('each: node is outside the internal effect-machine domain');
  }
  const props = asEachProps(ir);
  const shape = detectEachShape(props) as EachShape;
  const collection = resolveEachCollection(props.in as string, env);
  if (shape === 'array' || shape === 'array-indexed') {
    if (!ARRAY_IS_ARRAY(collection)) throw new Error('each array mode: `in=` must resolve to an array');
    return collection.length;
  }
  if (shape === 'pair-sync' || shape === 'pair-async') {
    const size = collectionSize(MAP_SIZE_GETTER, collection);
    if (size !== undefined) return size;
    if (!ARRAY_IS_ARRAY(collection)) {
      throw new Error('each pair-mode `in=` must resolve to a Map or array of [k, v] pairs');
    }
    for (let index = 0; index < collection.length; index += 1) {
      const pair = collection[index];
      if (!ARRAY_IS_ARRAY(pair) || pair.length !== 2) {
        throw new Error('each pair-mode array element is not a [k, v] tuple');
      }
    }
    return collection.length;
  }
  assertPlainObject(collection, shape);
  return OBJECT_KEYS(collection as Record<string, unknown>).length;
}

function collectionSize(getter: (() => number) | undefined, collection: unknown): number | undefined {
  if (!getter) return undefined;
  try {
    return REFLECT_APPLY(getter, collection, []) as number;
  } catch {
    return undefined;
  }
}

function assertPlainObject(collection: unknown, shape: string): void {
  if (
    typeof collection !== 'object' ||
    collection === null ||
    ARRAY_IS_ARRAY(collection) ||
    collectionSize(MAP_SIZE_GETTER, collection) !== undefined ||
    collectionSize(SET_SIZE_GETTER, collection) !== undefined
  ) {
    throw new Error(`each ${shape} mode: \`in=\` must resolve to a plain object`);
  }
}

function assertNestedIterationScalarElements(collection: readonly unknown[], label: string): void {
  for (const item of collection) {
    if (!isPortableScalar(item)) {
      throw new Error(`each: ${label} elements must be portable scalars`);
    }
  }
}

function resolveEachCollection(inRaw: string, env: SemanticEnv): unknown {
  if (hasBinding(env, inRaw)) {
    const collection = getBinding(env, inRaw);
    if (collection === null || collection === undefined) {
      throw new Error(`each: binding "${inRaw}" is nullish`);
    }
    return collection;
  }

  const classification = classifyEachCollectionReference(inRaw);
  if (classification.status === 'missing-binding') {
    throw new Error(`each: binding "${classification.name}" not found in env`);
  }
  if (classification.status === 'reference') {
    const reference = classification.reference;
    if (reference.form === 'binding') {
      throw new Error(`each: binding "${reference.name}" not found in env`);
    }
    const fields = recordArrayFieldsForBinding(env, reference.receiver);
    if (fields === undefined || !fields.has(reference.property)) {
      throw new Error(`each: nested record-array receiver "${reference.receiver}.${reference.property}" is not proven`);
    }
    const expression: ValueIR = {
      kind: 'member',
      object: { kind: 'ident', name: reference.receiver },
      optional: false,
      property: reference.property,
    };
    const collection = evalRecordArrayFieldReferenceValue(expression, env);
    if (collection === undefined) {
      throw new Error(
        `each: nested record-array receiver "${reference.receiver}.${reference.property}" must be an array`,
      );
    }
    assertNestedIterationScalarElements(collection, `${reference.receiver}.${reference.property}`);
    return collection;
  }

  throw new Error('each: `in=` must resolve to an array binding or proven record array field');
}

function* iterateCollection(
  shape: EachShape,
  collection: unknown,
  p: EachProps,
  beforeIteration?: () => void,
): Generator<EachIterationStep, void, unknown> {
  if ((shape === 'array' || shape === 'array-indexed') && !ARRAY_IS_ARRAY(collection)) {
    throw new Error('each array mode: `in=` must resolve to an array');
  }
  switch (shape) {
    case 'array': {
      const name = p.name as string;
      const values = collection as unknown[];
      for (let index = 0; index < values.length; index += 1) {
        beforeIteration?.();
        const value = values[index];
        yield { bindings: [[name, value]], primary: [name, value] };
      }
      return;
    }
    case 'array-indexed': {
      const name = p.name as string;
      const index = p.index as string;
      const values = collection as unknown[];
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        beforeIteration?.();
        const value = values[valueIndex];
        yield {
          bindings: [
            [name, value],
            [index, valueIndex],
          ],
          primary: [name, value],
        };
      }
      return;
    }
    case 'pair-sync':
    case 'pair-async': {
      const keyName = p.pairKey as string;
      const valueName = p.pairValue as string;
      if (collectionSize(MAP_SIZE_GETTER, collection) !== undefined) {
        const iterator = REFLECT_APPLY(MAP_ENTRIES, collection, []) as MapIterator<[unknown, unknown]>;
        while (true) {
          const result = REFLECT_APPLY(MAP_ITERATOR_NEXT, iterator, []) as IteratorResult<[unknown, unknown]>;
          if (result.done) return;
          beforeIteration?.();
          const key = result.value[0];
          const value = result.value[1];
          yield {
            bindings: [
              [keyName, key],
              [valueName, value],
            ],
            primary: [valueName, value],
          };
        }
      } else if (ARRAY_IS_ARRAY(collection)) {
        for (let index = 0; index < collection.length; index += 1) {
          const pair = collection[index];
          if (!ARRAY_IS_ARRAY(pair) || pair.length !== 2) {
            throw new Error('each pair-mode array element is not a [k, v] tuple');
          }
          beforeIteration?.();
          const key = pair[0];
          const value = pair[1];
          yield {
            bindings: [
              [keyName, key],
              [valueName, value],
            ],
            primary: [valueName, value],
          };
        }
      } else {
        throw new Error('each pair-mode `in=` must resolve to a Map or array of [k, v] pairs');
      }
      return;
    }
    case 'entry-key': {
      const name = p.entryKey as string;
      assertPlainObject(collection, 'entry-key');
      const keys = OBJECT_KEYS(collection as Record<string, unknown>);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        beforeIteration?.();
        yield { bindings: [[name, key]], primary: [name, key] };
      }
      return;
    }
    case 'entry-value': {
      const name = p.entryValue as string;
      assertPlainObject(collection, 'entry-value');
      const values = OBJECT_VALUES(collection as Record<string, unknown>);
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        beforeIteration?.();
        yield { bindings: [[name, value]], primary: [name, value] };
      }
      return;
    }
  }
}

/** Lazily yields canonical iteration steps without materializing the collection. */
export function* iterateEachRuntimeSteps(
  ir: IRNode,
  env: SemanticEnv,
  beforeIteration?: () => void,
): Generator<EachIterationStep, void, unknown> {
  const p = asEachProps(ir);
  const shape = detectEachShape(p);
  if (shape === null) {
    throw new Error('each: invariant violated — preconditions passed but shape is null');
  }
  const collection = resolveEachCollection(p.in as string, env);
  yield* iterateCollection(shape, collection, p, beforeIteration);
}

/** Compatibility surface for legacy sync and async reference runners. */
export function eachRuntimeSteps(ir: IRNode, env: SemanticEnv): readonly EachIterationStep[] {
  return Array.from(iterateEachRuntimeSteps(ir, env));
}
