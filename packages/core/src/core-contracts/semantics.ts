import { checkedPortablePower, PortablePowerError } from '../portable-power.js';
import {
  CORE_FIXTURE_UNDEFINED,
  type CoreFixtureValue,
  type CoreTypeName,
  isCoreFixtureFunction,
  isCoreFixtureUndefined,
} from './schema.js';

export class CoreContractEvaluationError extends Error {
  constructor(
    readonly code: 'strict-type' | 'division-by-zero' | 'invalid-power' | 'unsupported-operation',
    message: string,
  ) {
    super(message);
    this.name = 'CoreContractEvaluationError';
  }
}

export function coreFixtureValueType(value: CoreFixtureValue): CoreTypeName {
  if (typeof value === 'string') return 'String';
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'number') return 'Number';
  if (value === null) return 'Null';
  if (isCoreFixtureUndefined(value)) return 'Undefined';
  if (isCoreFixtureFunction(value)) return 'Function';
  if (Array.isArray(value)) return 'List';
  return 'Record';
}

export function evaluateCoreContractOperation(
  operationId: string,
  args: readonly CoreFixtureValue[],
): CoreFixtureValue {
  switch (operationId) {
    case 'Boolean.not': {
      const [value] = expectCoreTypes(operationId, args, ['Boolean']);
      return !value;
    }
    case 'Boolean.and': {
      const [left, right] = expectCoreTypes(operationId, args, ['Boolean', 'Boolean']);
      return left && right;
    }
    case 'Boolean.or': {
      const [left, right] = expectCoreTypes(operationId, args, ['Boolean', 'Boolean']);
      return left || right;
    }
    case 'Boolean.equals': {
      const [left, right] = expectCoreTypes(operationId, args, ['Boolean', 'Boolean']);
      return left === right;
    }
    case 'Boolean.toString': {
      const [value] = expectCoreTypes(operationId, args, ['Boolean']);
      return value ? 'true' : 'false';
    }
    case 'String.length': {
      const [value] = expectCoreTypes(operationId, args, ['String']);
      return stringCodePoints(value).length;
    }
    case 'String.index': {
      const [value, index] = expectCoreTypes(operationId, args, ['String', 'Number']);
      if (!Number.isInteger(index) || index < 0) return CORE_FIXTURE_UNDEFINED;
      const chars = stringCodePoints(value);
      return index < chars.length ? (chars[index] ?? '') : CORE_FIXTURE_UNDEFINED;
    }
    case 'String.includes': {
      const [value, search] = expectCoreTypes(operationId, args, ['String', 'String']);
      return value.includes(search);
    }
    case 'String.startsWith': {
      const [value, search] = expectCoreTypes(operationId, args, ['String', 'String']);
      return value.startsWith(search);
    }
    case 'String.endsWith': {
      const [value, search] = expectCoreTypes(operationId, args, ['String', 'String']);
      return value.endsWith(search);
    }
    case 'String.slice': {
      const [value, start, end] = expectCoreTypes(operationId, args, ['String', 'Number', 'Number']);
      return stringCodePoints(value).slice(truncateOffset(start), truncateOffset(end)).join('');
    }
    case 'String.trim': {
      const [value] = expectCoreTypes(operationId, args, ['String']);
      return value.trim();
    }
    case 'String.lower': {
      const [value] = expectCoreTypes(operationId, args, ['String']);
      return value.toLowerCase();
    }
    case 'String.upper': {
      const [value] = expectCoreTypes(operationId, args, ['String']);
      return value.toUpperCase();
    }
    case 'String.concat': {
      const [left, right] = expectCoreTypes(operationId, args, ['String', 'String']);
      return left + right;
    }
    case 'String.equals': {
      const [left, right] = expectCoreTypes(operationId, args, ['String', 'String']);
      return left === right;
    }
    case 'String.lessThan': {
      const [left, right] = expectCoreTypes(operationId, args, ['String', 'String']);
      return compareStrings(left, right) < 0;
    }
    case 'String.lessThanOrEqual': {
      const [left, right] = expectCoreTypes(operationId, args, ['String', 'String']);
      return compareStrings(left, right) <= 0;
    }
    case 'String.greaterThan': {
      const [left, right] = expectCoreTypes(operationId, args, ['String', 'String']);
      return compareStrings(left, right) > 0;
    }
    case 'String.greaterThanOrEqual': {
      const [left, right] = expectCoreTypes(operationId, args, ['String', 'String']);
      return compareStrings(left, right) >= 0;
    }
    case 'String.toString': {
      const [value] = expectCoreTypes(operationId, args, ['String']);
      return value;
    }
    case 'Number.negate': {
      const [value] = expectCoreTypes(operationId, args, ['Number']);
      return finiteNumberResult(operationId, -value);
    }
    case 'Number.add': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return finiteNumberResult(operationId, left + right);
    }
    case 'Number.subtract': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return finiteNumberResult(operationId, left - right);
    }
    case 'Number.multiply': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return finiteNumberResult(operationId, left * right);
    }
    case 'Number.divide': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      if (right === 0) throw new CoreContractEvaluationError('division-by-zero', 'Number.divide division by zero.');
      return finiteNumberResult(operationId, left / right);
    }
    case 'Number.remainder': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      if (right === 0) throw new CoreContractEvaluationError('division-by-zero', 'Number.remainder division by zero.');
      return finiteNumberResult(operationId, left % right);
    }
    case 'Number.power': {
      const [base, exponent] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      try {
        return checkedPortablePower(base, exponent);
      } catch (error) {
        if (error instanceof PortablePowerError) {
          throw new CoreContractEvaluationError('invalid-power', error.message);
        }
        throw error;
      }
    }
    case 'Number.lessThan': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return left < right;
    }
    case 'Number.lessThanOrEqual': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return left <= right;
    }
    case 'Number.greaterThan': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return left > right;
    }
    case 'Number.greaterThanOrEqual': {
      const [left, right] = expectCoreTypes(operationId, args, ['Number', 'Number']);
      return left >= right;
    }
    case 'List.length': {
      const [value] = expectCoreTypes(operationId, args, ['List']);
      return value.length;
    }
    case 'List.index': {
      const [value, index] = expectCoreTypes(operationId, args, ['List', 'Number']);
      if (!Number.isInteger(index) || index < 0) return CORE_FIXTURE_UNDEFINED;
      return index < value.length && Object.hasOwn(value, index)
        ? (value[index] as CoreFixtureValue)
        : CORE_FIXTURE_UNDEFINED;
    }
    case 'Record.get': {
      const [value, key] = expectCoreTypes(operationId, args, ['Record', 'String']);
      return Object.hasOwn(value, key) ? (value[key] as CoreFixtureValue) : CORE_FIXTURE_UNDEFINED;
    }
    default:
      throw new CoreContractEvaluationError(
        'unsupported-operation',
        `Unsupported core contract operation: ${operationId}`,
      );
  }
}

function expectCoreTypes<const T extends readonly CoreTypeName[]>(
  operationId: string,
  args: readonly CoreFixtureValue[],
  types: T,
): CoreTypeTuple<T> {
  if (args.length !== types.length) throw strictTypeError(operationId, types);
  for (let index = 0; index < types.length; index += 1) {
    if (!Object.hasOwn(args, index)) throw strictTypeError(operationId, types);
    const arg = args[index] as CoreFixtureValue;
    if (coreFixtureValueType(arg) !== types[index]) throw strictTypeError(operationId, types);
    if (types[index] === 'Number' && (typeof arg !== 'number' || !Number.isFinite(arg))) {
      throw strictTypeError(operationId, types);
    }
  }
  return args as CoreTypeTuple<T>;
}

function strictTypeError(operationId: string, types: readonly CoreTypeName[]): CoreContractEvaluationError {
  return new CoreContractEvaluationError('strict-type', `${operationId} expects ${types.join(', ')}.`);
}

function stringCodePoints(value: string): string[] {
  return Array.from(value);
}

function compareStrings(left: string, right: string): number {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return leftPoints.length - rightPoints.length;
}

function truncateOffset(value: number): number {
  return Math.trunc(value);
}

function finiteNumberResult(operationId: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new CoreContractEvaluationError('strict-type', `${operationId} result must be finite.`);
  }
  return value;
}

type CoreTypeTuple<T extends readonly CoreTypeName[]> = {
  readonly [Index in keyof T]: T[Index] extends 'Boolean'
    ? boolean
    : T[Index] extends 'Number'
      ? number
      : T[Index] extends 'String'
        ? string
        : T[Index] extends 'List'
          ? readonly CoreFixtureValue[]
          : T[Index] extends 'Record'
            ? { readonly [key: string]: CoreFixtureValue }
            : T[Index] extends 'Null'
              ? null
              : T[Index] extends 'Undefined'
                ? typeof CORE_FIXTURE_UNDEFINED
                : T[Index] extends 'Function'
                  ? never
                  : CoreFixtureValue;
};
