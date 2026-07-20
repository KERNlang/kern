import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import {
  classifyInternalMachineClassReturnValue,
  classifyInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value.js';
import { evalInternalMachineHelperValue } from './internal-effect-machine-helper-runtime.js';
import { isArrayLiteralExpression } from './portable-array.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import {
  assertPortableMachineClassGetterReadShape,
  assertPortableMachineClassMethodCallShape,
  assertPortableMachineReturnShape,
  assertPortableMachineScalarShape,
} from './portable-machine-shape.js';
import {
  evalRecordArrayFieldReferenceValue,
  evalRecordLiteralValue,
  isRecordLiteralExpression,
} from './portable-record-evaluator.js';
import { evalPortableReturnArrayValue } from './portable-return-array.js';
import { assertRunnerPortableValue, isInspectableRunnerPortableValue } from './portable-scalar-domain.js';
import { getBinding, hasBinding, type SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

function requiredExpression(node: IRNode) {
  const value = node.props?.value;
  if (typeof value !== 'string' || value === '') throw new Error(`${node.type}: value is required`);
  return parseExpression(value);
}

export function assertInternalMachinePrintShape(node: IRNode, env?: SemanticEnv): void {
  const value = requiredExpression(node);
  if (env && classifyInternalMachineClassScalarValue(value, env) !== 'unsupported') return;
  if (
    !assertPortableMachineClassMethodCallShape(value, env) &&
    !assertPortableMachineClassGetterReadShape(value, env)
  ) {
    assertPortableMachineScalarShape(value, env);
  }
}

export function assertInternalMachineReturnShape(node: IRNode, env?: SemanticEnv): void {
  if (!Object.hasOwn(node.props ?? {}, 'value')) return;
  const value = node.props?.value;
  if (value === undefined) return;
  if (typeof value === 'string') {
    const parsed = parseExpression(value);
    if (env && classifyInternalMachineClassReturnValue(parsed, env) !== 'unsupported') return;
    assertPortableMachineReturnShape(parsed, env);
  } else if (!isInspectableRunnerPortableValue(value)) {
    throw new Error('return: raw value is outside the machine domain');
  }
}

function printText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (Number.isSafeInteger(value) || !Number.isInteger(value))
  ) {
    return String(value);
  }
  throw new Error('print: non-portable value');
}

export function runInternalMachinePrint(node: IRNode, env: SemanticEnv): Trace {
  const text = printText(evalPortableValue(requiredExpression(node), env));
  return { completion: { kind: 'normal' }, events: [{ op: 'stdout', text }] };
}

function evaluateReturnValue(node: IRNode, env: SemanticEnv): unknown {
  if (!Object.hasOwn(node.props ?? {}, 'value')) return undefined;
  const raw = node.props?.value;
  if (typeof raw !== 'string') return raw;
  const parsed = parseExpression(raw);
  if (isArrayLiteralExpression(parsed)) {
    return evalPortableReturnArrayValue(parsed, env, evalPortableValue);
  }
  if (isRecordLiteralExpression(parsed)) {
    return evalRecordLiteralValue(parsed, env, evalPortableValue);
  }
  const recordArrayField = evalRecordArrayFieldReferenceValue(parsed, env);
  if (recordArrayField !== undefined) return recordArrayField;
  if (parsed.kind === 'new') throw new Error('return: class construction is outside the machine domain');
  if (parsed.kind === 'ident' && hasBinding(env, parsed.name)) {
    return assertRunnerPortableValue(getBinding(env, parsed.name), `binding "${parsed.name}"`);
  }
  if (parsed.kind === 'call' && parsed.callee.kind === 'ident' && env.runnerFunctions?.has(parsed.callee.name)) {
    return evalInternalMachineHelperValue(parsed.callee.name, parsed.args, env, evalPortableValue);
  }
  return evalPortableValue(parsed, env);
}

export function runInternalMachineReturn(node: IRNode, env: SemanticEnv): Trace {
  return {
    completion: { kind: 'return', value: evaluateReturnValue(node, env) },
    events: [],
  };
}
