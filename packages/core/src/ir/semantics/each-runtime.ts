import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { isParenthesized, isValueIR } from '../../value-ir.js';
import { getBinding, hasBinding, recordArrayFieldsForBinding, type SemanticEnv } from './index.js';
import { evalRecordArrayFieldReferenceValue, isPortableScalar } from './portable-scalar.js';

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

export function isInternalEffectMachineArrayEach(ir: IRNode): boolean {
  if (!eachShapePreconditions(ir)) return false;
  const shape = detectEachShape(asEachProps(ir));
  return shape === 'array' || shape === 'array-indexed';
}

function assertPlainObject(collection: unknown, shape: string): void {
  if (
    typeof collection !== 'object' ||
    collection === null ||
    Array.isArray(collection) ||
    collection instanceof Map ||
    collection instanceof Set
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

  const expr = parseExpression(inRaw);
  if (expr.kind === 'ident') {
    throw new Error(`each: binding "${expr.name}" not found in env`);
  }
  if (
    expr.kind === 'member' &&
    !expr.optional &&
    isValueIR(expr.object) &&
    expr.object.kind === 'ident' &&
    !isParenthesized(expr.object)
  ) {
    const fields = recordArrayFieldsForBinding(env, expr.object.name);
    if (fields === undefined || !fields.has(expr.property)) {
      throw new Error(`each: nested record-array receiver "${expr.object.name}.${expr.property}" is not proven`);
    }
    const collection = evalRecordArrayFieldReferenceValue(expr, env);
    if (collection === undefined) {
      throw new Error(`each: nested record-array receiver "${expr.object.name}.${expr.property}" must be an array`);
    }
    assertNestedIterationScalarElements(collection, `${expr.object.name}.${expr.property}`);
    return collection;
  }

  throw new Error('each: `in=` must resolve to an array binding or proven record array field');
}

function* iterateCollection(
  shape: EachShape,
  collection: unknown,
  p: EachProps,
  beforeArrayElementRead?: () => void,
): Generator<EachIterationStep, void, unknown> {
  if ((shape === 'array' || shape === 'array-indexed') && !Array.isArray(collection)) {
    throw new Error('each array mode: `in=` must resolve to an array');
  }
  switch (shape) {
    case 'array': {
      const name = p.name as string;
      const values = collection as unknown[];
      for (let index = 0; index < values.length; index += 1) {
        beforeArrayElementRead?.();
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
        beforeArrayElementRead?.();
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
      if (collection instanceof Map) {
        for (const [key, value] of collection) {
          yield {
            bindings: [
              [keyName, key],
              [valueName, value],
            ],
            primary: [valueName, value],
          };
        }
      } else if (Array.isArray(collection)) {
        for (const pair of collection) {
          if (!Array.isArray(pair) || pair.length !== 2) {
            throw new Error('each pair-mode array element is not a [k, v] tuple');
          }
          const [key, value] = pair as [unknown, unknown];
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
      for (const key of Object.keys(collection as Record<string, unknown>)) {
        yield { bindings: [[name, key]], primary: [name, key] };
      }
      return;
    }
    case 'entry-value': {
      const name = p.entryValue as string;
      assertPlainObject(collection, 'entry-value');
      for (const value of Object.values(collection as Record<string, unknown>)) {
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
  beforeArrayElementRead?: () => void,
): Generator<EachIterationStep, void, unknown> {
  const p = asEachProps(ir);
  const shape = detectEachShape(p);
  if (shape === null) {
    throw new Error('each: invariant violated — preconditions passed but shape is null');
  }
  const collection = resolveEachCollection(p.in as string, env);
  yield* iterateCollection(shape, collection, p, beforeArrayElementRead);
}

/** Compatibility surface for legacy sync and async reference runners. */
export function eachRuntimeSteps(ir: IRNode, env: SemanticEnv): readonly EachIterationStep[] {
  return Array.from(iterateEachRuntimeSteps(ir, env));
}
