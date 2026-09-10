import { type KernKirEvent, KernKirFault, type KernKirValue } from './contracts.js';
import type { RuntimeMeter } from './inspect.js';
import { parseKernJson, stringifyKernJson } from './json.js';
import type {
  LinkedKernKirBinaryOperator,
  LinkedKernKirExpression,
  LinkedKernKirHandler,
  LinkedKernKirParameterType,
  LinkedKernKirUnaryOperator,
} from './linked-kir-program/index.js';
import { HELPER_WALK_POLICY, WALK_SEED, walkStatements } from './statement-walker.js';

export {
  ENTRY_WALK_POLICY,
  HELPER_WALK_POLICY,
  type StatementStep,
  type StatementWalkPolicy,
  type StatementWalkResult,
  WALK_SEED,
  walkStatements,
} from './statement-walker.js';
export interface ExpressionRuntime {
  readonly asyncHelpers: ReadonlySet<string>;
  readonly checkAbort: () => void;
  readonly events: KernKirEvent[];
  readonly helpers: ReadonlyMap<string, LinkedKernKirHandler> | undefined;
  readonly maxEvents: number;
}

export function matchesType(value: KernKirValue, type: LinkedKernKirParameterType): boolean {
  if (type.kind !== 'list') return value.tag === type.kind;
  return value.tag === 'list' && value.value.every((item) => item.tag === type.element);
}

type BinaryEvaluator = (left: KernKirValue, right: () => KernKirValue, meter: RuntimeMeter) => KernKirValue;

type UnaryEvaluator = (operand: KernKirValue, meter: RuntimeMeter) => KernKirValue;

function operandFault(): never {
  throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_BINARY_OPERAND_TYPE');
}

function booleanOperand(value: KernKirValue): Extract<KernKirValue, { tag: 'boolean' }> {
  if (value.tag !== 'boolean') operandFault();
  return value;
}

export function integerOperand(value: KernKirValue): bigint {
  if (value.tag !== 'integer') operandFault();
  return BigInt(value.value);
}

function operandsEqual(left: KernKirValue, right: KernKirValue): boolean {
  if (left.tag !== right.tag) operandFault();
  if (left.tag === 'boolean' && right.tag === 'boolean') return left.value === right.value;
  if (left.tag === 'integer' && right.tag === 'integer') return BigInt(left.value) === BigInt(right.value);
  operandFault();
}

function booleanValue(flag: boolean): KernKirValue {
  return Object.freeze({ tag: 'boolean', value: flag });
}

// Arithmetic is the only expression that mints a new integer payload, so it is the only place the
// per-string limit is not already enforced by request inspection or the frontend's literal wall.
export function integerValue(value: bigint, meter: RuntimeMeter): KernKirValue {
  return Object.freeze({ tag: 'integer', value: meter.integerText(value, 'arithmetic result') });
}

const BINARY_EVALUATORS = Object.freeze({
  '&&': (left, right) => (booleanOperand(left).value === false ? left : booleanOperand(right())),
  '||': (left, right) => (booleanOperand(left).value === true ? left : booleanOperand(right())),
  '==': (left, right) => booleanValue(operandsEqual(left, right())),
  '!=': (left, right) => booleanValue(!operandsEqual(left, right())),
  '<': (left, right) => booleanValue(integerOperand(left) < integerOperand(right())),
  '<=': (left, right) => booleanValue(integerOperand(left) <= integerOperand(right())),
  '>': (left, right) => booleanValue(integerOperand(left) > integerOperand(right())),
  '>=': (left, right) => booleanValue(integerOperand(left) >= integerOperand(right())),
  '+': (left, right, meter) => integerValue(integerOperand(left) + integerOperand(right()), meter),
  '-': (left, right, meter) => integerValue(integerOperand(left) - integerOperand(right()), meter),
  '*': (left, right, meter) => integerValue(integerOperand(left) * integerOperand(right()), meter),
}) satisfies Record<LinkedKernKirBinaryOperator, BinaryEvaluator>;

const UNARY_EVALUATORS = Object.freeze({
  '-': (operand, meter) => integerValue(-integerOperand(operand), meter),
}) satisfies Record<LinkedKernKirUnaryOperator, UnaryEvaluator>;

export function calleeBindings(
  handler: LinkedKernKirHandler,
  args: readonly KernKirValue[],
): Map<string, KernKirValue> {
  const bindings = new Map<string, KernKirValue>();
  for (const [index, parameter] of handler.parameters.entries()) {
    const value = args[index];
    if (value === undefined || !matchesType(value, parameter.type)) {
      throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_CALL_ARGUMENT_TAG');
    }
    bindings.set(parameter.name, value);
  }
  return bindings;
}

export function clampThrowLabel(value: KernKirValue): string {
  const entry = (key: string): KernKirValue | undefined =>
    value.tag === 'record' ? value.value.find((item) => item.key === key)?.value : undefined;
  const message = entry('message');
  const code = entry('code');
  if (message?.tag !== 'text') return '';
  const label = message.value.slice(0, 256);
  return code?.tag === 'text' ? `${label} [${code.value.slice(0, 64)}]` : label;
}

// A synchronous generator suspends and resumes with no microtask hop, so the synchronous call
// boundary keeps the tick discipline RT-2 established while sharing the walk with the async driver.
function callHelper(
  handler: LinkedKernKirHandler,
  args: readonly KernKirValue[],
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
): KernKirValue {
  meter.step();
  const walk = walkStatements(handler, calleeBindings(handler, args), meter, runtime, HELPER_WALK_POLICY);
  const step = walk.next(WALK_SEED);
  if (!step.done) throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_CALL_CALLEE_CAPABILITY');
  if (step.value.kind === 'drained') {
    throw new KernKirFault('handler-entry-unsupported', 'execution', 'helper did not return');
  }
  if (step.value.kind === 'threw') {
    throw new KernKirFault('handler-link-error', 'execution', 'KIR_TRY_FAMILY_IN_HELPER');
  }
  return step.value.value;
}

export function evaluateExpression(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, KernKirValue>,
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
): KernKirValue {
  meter.step();
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'binary':
      return BINARY_EVALUATORS[expression.op](
        evaluateExpression(expression.left, bindings, meter, runtime),
        () => evaluateExpression(expression.right, bindings, meter, runtime),
        meter,
      );
    case 'unary':
      return UNARY_EVALUATORS[expression.op](evaluateExpression(expression.argument, bindings, meter, runtime), meter);
    case 'user-call': {
      if (runtime.asyncHelpers.has(expression.handlerName)) {
        throw new KernKirFault('handler-link-error', 'execution', 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
      }
      const callee = runtime.helpers?.get(expression.handlerName);
      if (callee === undefined) {
        throw new KernKirFault('handler-link-error', 'execution', `missing helper ${expression.handlerName}`);
      }
      return callHelper(
        callee,
        expression.arguments.map((argument) => evaluateExpression(argument, bindings, meter, runtime)),
        meter,
        runtime,
      );
    }
    case 'identifier': {
      const value = bindings.get(expression.name);
      if (value === undefined) {
        throw new KernKirFault('handler-link-error', 'execution', `missing binding ${expression.name}`);
      }
      return value;
    }
    case 'list':
      return Object.freeze({
        tag: 'list',
        value: Object.freeze(expression.items.map((item) => evaluateExpression(item, bindings, meter, runtime))),
      });
    case 'record':
      return Object.freeze({
        tag: 'record',
        value: Object.freeze(
          expression.entries.map((entry) =>
            Object.freeze({ key: entry.key, value: evaluateExpression(entry.value, bindings, meter, runtime) }),
          ),
        ),
      });
    case 'member': {
      const object = evaluateExpression(expression.object, bindings, meter, runtime);
      if (object.tag === 'null' && expression.optional) return Object.freeze({ tag: 'null' });
      if (object.tag !== 'record') {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'member object is not a record');
      }
      const value = object.value.find((entry) => entry.key === expression.property)?.value;
      if (value !== undefined) return value;
      if (expression.optional) return Object.freeze({ tag: 'null' });
      throw new KernKirFault('unsupported-runtime-input', 'execution', `missing member ${expression.property}`);
    }
    case 'json-call': {
      const argument = evaluateExpression(expression.argument, bindings, meter, runtime);
      if (expression.operation === 'parse') {
        if (argument.tag !== 'text') {
          throw new KernKirFault('unsupported-runtime-input', 'execution', 'Json.parse expects text');
        }
        return parseKernJson(argument.value, meter);
      }
      return Object.freeze({ tag: 'text', value: stringifyKernJson(argument, meter) });
    }
  }
}
