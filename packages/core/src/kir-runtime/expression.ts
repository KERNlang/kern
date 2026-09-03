import {
  type KernKirDiagnosticCode,
  type KernKirEvent,
  KernKirFault,
  type KernKirSlot,
  type KernKirValue,
} from './contracts.js';
import type { RuntimeMeter } from './inspect.js';
import { parseKernJson, stringifyKernJson } from './json.js';
import type {
  LinkedKernKirBinaryOperator,
  LinkedKernKirEntryHandler,
  LinkedKernKirExpression,
  LinkedKernKirHandler,
  LinkedKernKirParameterType,
  LinkedKernKirStatement,
  LinkedKernKirUnaryOperator,
} from './linked-kir-program/index.js';

export interface ExpressionRuntime {
  readonly asyncHelpers: ReadonlySet<string>;
  readonly checkAbort: () => void;
  readonly events: KernKirEvent[];
  readonly helpers: ReadonlyMap<string, LinkedKernKirHandler> | undefined;
  readonly maxEvents: number;
}

export type StatementStep =
  | {
      readonly kind: 'capability';
      readonly input: KernKirSlot;
      readonly statement: Extract<LinkedKernKirStatement, { kind: 'capability' }>;
    }
  | {
      readonly kind: 'call';
      readonly arguments: readonly KernKirValue[];
      readonly handler: LinkedKernKirHandler;
    };

// A drained walk is not an error on its own: RT-6's void entry completes there, while a helper and
// a value-returning entry both fail closed. The core reports which happened and each driver decides.
export type StatementWalkResult =
  | { readonly kind: 'returned'; readonly value: KernKirValue }
  | { readonly kind: 'drained' };

export interface StatementWalkPolicy {
  readonly meterReturn: boolean;
  readonly returnCode: KernKirDiagnosticCode;
  readonly returnMessage: string;
}

export const ENTRY_WALK_POLICY = Object.freeze({
  meterReturn: true,
  returnCode: 'invalid-handler-result',
  returnMessage: 'return type mismatch',
}) satisfies StatementWalkPolicy;

export const HELPER_WALK_POLICY = Object.freeze({
  meterReturn: false,
  returnCode: 'unsupported-runtime-input',
  returnMessage: 'KIR_CALL_RETURN_TAG',
}) satisfies StatementWalkPolicy;

// A driver seeds the first next() with this and the walk discards it, so neither driver needs a
// special case for the first resumption.
export const WALK_SEED: KernKirValue = Object.freeze({ tag: 'null' });

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

function integerOperand(value: KernKirValue): bigint {
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
function integerValue(value: bigint, meter: RuntimeMeter): KernKirValue {
  return Object.freeze({ tag: 'integer', value: meter.text(String(value), 'arithmetic result') });
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

function* statementValue(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, KernKirValue>,
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
): Generator<StatementStep, KernKirValue, KernKirValue> {
  if (expression.kind !== 'user-call' || !runtime.asyncHelpers.has(expression.handlerName)) {
    return evaluateExpression(expression, bindings, meter, runtime);
  }
  meter.step();
  const handler = runtime.helpers?.get(expression.handlerName);
  if (handler === undefined) {
    throw new KernKirFault('handler-link-error', 'execution', `missing helper ${expression.handlerName}`);
  }
  const args = expression.arguments.map((argument) => evaluateExpression(argument, bindings, meter, runtime));
  return yield Object.freeze({ arguments: Object.freeze(args), handler, kind: 'call' as const });
}

export function* walkStatements(
  handler: LinkedKernKirEntryHandler,
  bindings: Map<string, KernKirValue>,
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
  policy: StatementWalkPolicy,
): Generator<StatementStep, StatementWalkResult, KernKirValue> {
  const frames: { readonly statements: readonly LinkedKernKirStatement[]; index: number }[] = [
    { statements: handler.statements, index: 0 },
  ];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.statements.length) {
      frames.pop();
      continue;
    }
    const statement = frame.statements[frame.index];
    frame.index += 1;
    if (statement.kind !== 'return' || policy.meterReturn) meter.step();
    runtime.checkAbort();
    if (statement.kind === 'let') {
      bindings.set(statement.name, yield* statementValue(statement.value, bindings, meter, runtime));
    } else if (statement.kind === 'assign') {
      bindings.set(statement.target, yield* statementValue(statement.value, bindings, meter, runtime));
    } else if (statement.kind === 'capability') {
      const input: KernKirSlot =
        statement.input === undefined
          ? Object.freeze({ presence: 'absent' })
          : Object.freeze({
              presence: 'value',
              value: evaluateExpression(statement.input, bindings, meter, runtime),
            });
      if (runtime.events.length + 1 > runtime.maxEvents) {
        throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
      }
      bindings.set(statement.name, yield Object.freeze({ input, kind: 'capability' as const, statement }));
    } else if (statement.kind === 'print') {
      const value = yield* statementValue(statement.value, bindings, meter, runtime);
      if (value.tag !== 'text') throw new KernKirFault('unsupported-runtime-input', 'execution', 'print expects text');
      if (runtime.events.length + 1 > runtime.maxEvents) {
        throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
      }
      runtime.events.push(Object.freeze({ op: 'stdout', text: value.value }));
    } else if (statement.kind === 'if') {
      const condition = evaluateExpression(statement.condition, bindings, meter, runtime);
      if (condition.tag !== 'boolean') {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'if condition expects boolean');
      }
      const branch = condition.value === true ? statement.thenBranch : statement.elseBranch;
      if (branch !== undefined) frames.push({ statements: branch, index: 0 });
    } else {
      const { returnType } = handler;
      if (returnType.kind === 'void') {
        throw new KernKirFault('invalid-handler-result', 'execution', 'a void handler must not return a value');
      }
      const value = yield* statementValue(statement.value, bindings, meter, runtime);
      if (!matchesType(value, returnType)) {
        throw new KernKirFault(policy.returnCode, 'execution', policy.returnMessage);
      }
      return Object.freeze({ kind: 'returned' as const, value });
    }
  }
  return Object.freeze({ kind: 'drained' as const });
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
