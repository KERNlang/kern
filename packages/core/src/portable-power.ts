/** KERN-owned portable exponentiation semantics and target helper renderings. */

import { toSnakeCaseIdentifier } from './identifier-case.js';
import type { ValueIR } from './value-ir.js';

export const PORTABLE_POWER_OPERAND_ERROR =
  'portable: ** requires a safe-integer base and nonnegative safe-integer exponent';
export const PORTABLE_POWER_RESULT_ERROR = 'portable: ** result exceeds the safe-integer domain';
export const PORTABLE_POWER_SPREAD_ERROR = 'portable: ** does not accept spread operands';
export const KERN_POWER_HELPER_TS_NAME = '__kern_pow_int';
export const KERN_POWER_HELPER_PY_NAME = '_kern_pow_int';

export type PortablePowerErrorCode = 'invalid-operands' | 'unsafe-result';

export class PortablePowerError extends Error {
  constructor(
    readonly code: PortablePowerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PortablePowerError';
  }
}

function failOperands(): never {
  throw new PortablePowerError('invalid-operands', PORTABLE_POWER_OPERAND_ERROR);
}

function failResult(): never {
  throw new PortablePowerError('unsafe-result', PORTABLE_POWER_RESULT_ERROR);
}

/** Reject user bindings that would capture a generated checked-power helper. */
export function assertNotPortablePowerHelperBinding(name: string): void {
  if (name === KERN_POWER_HELPER_TS_NAME || toSnakeCaseIdentifier(name) === KERN_POWER_HELPER_PY_NAME) {
    throw new Error(`Binding "${name}" is reserved for the KERN portable power helper.`);
  }
}

/** Reject a spread in an operand slot before target emission can change call arity. */
export function assertPortablePowerOperand(node: ValueIR): void {
  let operand = node;
  while (operand.kind === 'typeAssert' || operand.kind === 'nonNull' || operand.kind === 'propagate') {
    operand = operand.kind === 'propagate' ? operand.argument : operand.expression;
  }
  if (operand.kind === 'spread') throw new Error(PORTABLE_POWER_SPREAD_ERROR);
}

/**
 * Flatten only the implicit right-associative spine of a power expression.
 * Explicit left nesting remains inside an operand and therefore keeps its
 * authored meaning, while a flat source chain can be consumed iteratively.
 */
export function flattenPortablePowerChain(node: Extract<ValueIR, { kind: 'binary' }>): ValueIR[] {
  const operands: ValueIR[] = [];
  let current: ValueIR = node;
  while (current.kind === 'binary' && current.op === '**') {
    operands.push(current.left);
    current = current.right;
  }
  operands.push(current);
  return operands;
}

function isPortablePowerInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0);
}

function checkedPortableIntegerProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  if (Math.abs(left) > Math.floor(Number.MAX_SAFE_INTEGER / Math.abs(right))) failResult();
  return left * right;
}

/**
 * Evaluate KERN integer power without delegating semantics to a host power
 * operator. Every multiplication is range-checked before it occurs, and the
 * exponent is halved each iteration, so large accepted exponents are bounded
 * to logarithmic work.
 */
export function checkedPortablePower(base: unknown, exponent: unknown): number {
  if (!isPortablePowerInteger(base) || !isPortablePowerInteger(exponent) || exponent < 0) failOperands();

  let result = 1;
  let factor = base;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = checkedPortableIntegerProduct(result, factor);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor = checkedPortableIntegerProduct(factor, factor);
  }
  return result;
}

/** Fold an already-evaluated power chain from right to left. */
export function foldPortablePowerChain<T>(operands: readonly T[], power: (base: T, exponent: T) => T): T {
  let result = operands[operands.length - 1] as T;
  for (let index = operands.length - 2; index >= 0; index -= 1) {
    result = power(operands[index], result);
  }
  return result;
}

/** Evaluate a right-associative power chain after its operands were observed left-to-right. */
export function checkedPortablePowerChain(operands: readonly unknown[]): number {
  if (operands.length < 2) failOperands();
  return foldPortablePowerChain<unknown>(operands, checkedPortablePower) as number;
}

function renderPowerHelper(typed: boolean): string {
  const operandsParam = typed ? 'operands: readonly unknown[]' : 'operands';
  const numberParams = typed ? 'left: number, right: number' : 'left, right';
  const unknownParams = typed ? 'base: unknown, exponent: unknown' : 'base, exponent';
  const numberReturn = typed ? ': number' : '';
  const stringParam = typed ? 'message: string' : 'message';
  const failReturn = typed ? ': never' : '';
  const valueParam = typed ? 'value: unknown' : 'value';
  const integerReturn = typed ? ': value is number' : '';
  const unaryNumberParam = typed ? 'value: number' : 'value';
  const unknownResult = typed ? '  let result: unknown' : '  let result';
  const finalResult = typed ? '  return result as number;' : '  return result;';

  return [
    `function ${KERN_POWER_HELPER_TS_NAME}(${operandsParam})${numberReturn} {`,
    '  const maxSafe = 9007199254740991;',
    `  const fail = (${stringParam})${failReturn} => { throw { name: 'Error', message }; };`,
    `  const isSafeInteger = (${valueParam})${integerReturn} =>`,
    `    typeof value === 'number' && value === value && value % 1 === 0 &&`,
    '    value >= -maxSafe && value <= maxSafe && !(value === 0 && 1 / value < 0);',
    `  const abs = (${unaryNumberParam})${numberReturn} => value < 0 ? -value : value;`,
    `  if (operands.length < 2) fail(${JSON.stringify(PORTABLE_POWER_OPERAND_ERROR)});`,
    `  const multiply = (${numberParams})${numberReturn} => {`,
    '    if (left === 0 || right === 0) return 0;',
    '    if (abs(left) > maxSafe / abs(right)) {',
    `      fail(${JSON.stringify(PORTABLE_POWER_RESULT_ERROR)});`,
    '    }',
    '    return left * right;',
    '  };',
    `  const power = (${unknownParams})${numberReturn} => {`,
    `    if (!isSafeInteger(base) || !isSafeInteger(exponent) || exponent < 0) {`,
    `      fail(${JSON.stringify(PORTABLE_POWER_OPERAND_ERROR)});`,
    '    }',
    '    let value = 1;',
    '    let factor = base;',
    '    let remaining = exponent;',
    '    while (remaining > 0) {',
    '      if (remaining % 2 === 1) value = multiply(value, factor);',
    '      remaining = (remaining - (remaining % 2)) / 2;',
    '      if (remaining > 0) factor = multiply(factor, factor);',
    '    }',
    '    return value;',
    '  };',
    `${unknownResult} = operands[operands.length - 1];`,
    '  for (let index = operands.length - 2; index >= 0; index -= 1) {',
    '    result = power(operands[index], result);',
    '  }',
    finalResult,
    '}',
  ].join('\n');
}

const KERN_POWER_HELPER_TS = renderPowerHelper(true);

/** TypeScript production preamble rendering. */
export function portablePowerHelperTS(): string {
  return KERN_POWER_HELPER_TS;
}

/** Type-free rendering used by the VM differential harness. */
export const KERN_POWER_HELPER_JS = renderPowerHelper(false);

const PYTHON_MAX_SAFE_INTEGER = String(Number.MAX_SAFE_INTEGER);

/** Python production helper, co-located with the authoritative core algorithm. */
export const KERN_POWER_HELPER_PY = [
  `def ${KERN_POWER_HELPER_PY_NAME}(operands):`,
  '    import builtins as __kern_power_builtins',
  '    import math as __kern_power_math',
  `    max_safe = ${PYTHON_MAX_SAFE_INTEGER}`,
  `    if __kern_power_builtins.len(operands) < 2:`,
  `        raise __kern_power_builtins.Exception(${JSON.stringify(PORTABLE_POWER_OPERAND_ERROR)})`,
  '    def is_safe_integer(value):',
  '        value_type = __kern_power_builtins.type(value)',
  '        if value_type is __kern_power_builtins.bool:',
  '            return False',
  '        if value_type is __kern_power_builtins.int:',
  '            return __kern_power_builtins.abs(value) <= max_safe',
  '        if value_type is not __kern_power_builtins.float:',
  '            return False',
  '        if not __kern_power_math.isfinite(value) or not value.is_integer():',
  '            return False',
  '        if value == 0.0 and __kern_power_math.copysign(1.0, value) < 0:',
  '            return False',
  '        return __kern_power_builtins.abs(value) <= max_safe',
  '    def multiply(left, right):',
  '        if left == 0 or right == 0:',
  '            return 0',
  '        if __kern_power_builtins.abs(left) > max_safe // __kern_power_builtins.abs(right):',
  `            raise __kern_power_builtins.Exception(${JSON.stringify(PORTABLE_POWER_RESULT_ERROR)})`,
  '        return left * right',
  '    def power(base, exponent):',
  '        if not is_safe_integer(base) or not is_safe_integer(exponent) or exponent < 0:',
  `            raise __kern_power_builtins.Exception(${JSON.stringify(PORTABLE_POWER_OPERAND_ERROR)})`,
  '        factor = __kern_power_builtins.int(base)',
  '        remaining = __kern_power_builtins.int(exponent)',
  '        value = 1',
  '        while remaining > 0:',
  '            if remaining % 2 == 1:',
  '                value = multiply(value, factor)',
  '            remaining //= 2',
  '            if remaining > 0:',
  '                factor = multiply(factor, factor)',
  '        return value',
  '    result = operands[-1]',
  '    for index in __kern_power_builtins.range(__kern_power_builtins.len(operands) - 2, -1, -1):',
  '        result = power(operands[index], result)',
  '    return result',
].join('\n');
