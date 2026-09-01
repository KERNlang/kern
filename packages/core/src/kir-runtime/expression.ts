import { type KernKirEvent, KernKirFault, type KernKirValue } from './contracts.js';
import type { RuntimeMeter } from './inspect.js';
import { parseKernJson, stringifyKernJson } from './json.js';
import type {
  LinkedKernKirBinaryOperator,
  LinkedKernKirExpression,
  LinkedKernKirHandler,
  LinkedKernKirParameterType,
  LinkedKernKirStatement,
} from './linked-kir-program/index.js';

export interface ExpressionRuntime {
  readonly checkAbort: () => void;
  readonly events: KernKirEvent[];
  readonly helpers: ReadonlyMap<string, LinkedKernKirHandler> | undefined;
  readonly maxEvents: number;
}

export function matchesType(value: KernKirValue, type: LinkedKernKirParameterType): boolean {
  if (type.kind !== 'list') return value.tag === type.kind;
  return value.tag === 'list' && value.value.every((item) => item.tag === type.element);
}

type BinaryEvaluator = (left: KernKirValue, right: () => KernKirValue) => KernKirValue;

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

const BINARY_EVALUATORS = Object.freeze({
  '&&': (left, right) => (booleanOperand(left).value === false ? left : booleanOperand(right())),
  '||': (left, right) => (booleanOperand(left).value === true ? left : booleanOperand(right())),
  '==': (left, right) => booleanValue(operandsEqual(left, right())),
  '!=': (left, right) => booleanValue(!operandsEqual(left, right())),
  '<': (left, right) => booleanValue(integerOperand(left) < integerOperand(right())),
  '<=': (left, right) => booleanValue(integerOperand(left) <= integerOperand(right())),
  '>': (left, right) => booleanValue(integerOperand(left) > integerOperand(right())),
  '>=': (left, right) => booleanValue(integerOperand(left) >= integerOperand(right())),
}) satisfies Record<LinkedKernKirBinaryOperator, BinaryEvaluator>;

function callHelper(
  handler: LinkedKernKirHandler,
  args: readonly KernKirValue[],
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
): KernKirValue {
  meter.step();
  const bindings = new Map<string, KernKirValue>();
  for (const [index, parameter] of handler.parameters.entries()) {
    const value = args[index];
    if (value === undefined || !matchesType(value, parameter.type)) {
      throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_CALL_ARGUMENT_TAG');
    }
    bindings.set(parameter.name, value);
  }
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
    if (statement.kind !== 'return') meter.step();
    runtime.checkAbort();
    if (statement.kind === 'let') {
      bindings.set(statement.name, evaluateExpression(statement.value, bindings, meter, runtime));
    } else if (statement.kind === 'print') {
      const value = evaluateExpression(statement.value, bindings, meter, runtime);
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
    } else if (statement.kind === 'return') {
      const value = evaluateExpression(statement.value, bindings, meter, runtime);
      if (!matchesType(value, handler.returnType)) {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_CALL_RETURN_TAG');
      }
      return value;
    } else {
      throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_CALL_CALLEE_CAPABILITY');
    }
  }
  throw new KernKirFault('handler-entry-unsupported', 'execution', 'helper did not return');
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
      return BINARY_EVALUATORS[expression.op](evaluateExpression(expression.left, bindings, meter, runtime), () =>
        evaluateExpression(expression.right, bindings, meter, runtime),
      );
    case 'user-call': {
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
