import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import {
  classifyInternalMachineClassLetValue,
  classifyInternalMachineClassReturnValue,
  classifyInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value.js';
import {
  evaluateInternalMachineClassLetValue,
  evaluateInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value-runtime.js';
import { runInternalEffectMachineLeaf } from './internal-effect-machine-leaf.js';
import type { InternalEffectMachineGenerator, InternalEffectMachineState } from './internal-effect-machine-types.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { isPortableBindingName, type PortableScalar } from './portable-scalar-domain.js';
import { defineBinding, hasOwnBinding, type SemanticEnv } from './semantic-env.js';

function requiredExpression(node: IRNode): ReturnType<typeof parseExpression> {
  const value = node.props?.value;
  if (typeof value !== 'string' || value === '') throw new Error(`${node.type}: value is required`);
  return parseExpression(value);
}

function printText(value: PortableScalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (Number.isFinite(value) && (Number.isSafeInteger(value) || !Number.isInteger(value))) return String(value);
  throw new Error('print: non-portable value');
}

export function* runInternalEffectMachineClassLeaf(
  node: IRNode,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalEffectMachineGenerator {
  if (node.type === 'let') {
    const valueNode = requiredExpression(node);
    const disposition = classifyInternalMachineClassLetValue(valueNode, env);
    const classScalarDisposition = classifyInternalMachineClassScalarValue(valueNode, env);
    if (disposition === 'pure' && (env.runnerThis === undefined || classScalarDisposition !== 'pure')) {
      return runInternalEffectMachineLeaf(node, env);
    }
    if (disposition === 'unsupported') throw new Error('let: class expression is outside the resumable domain');
    const name = node.props?.name;
    if (!isPortableBindingName(name)) throw new Error('let: name must be a portable identifier');
    if (hasOwnBinding(env, name)) throw new Error(`let: binding "${name}" already exists`);
    const result =
      disposition === 'pure'
        ? { events: [], value: evalPortableValue(valueNode, env) }
        : yield* evaluateInternalMachineClassLetValue(valueNode, env, state);
    defineBinding(env, name, result.value);
    return {
      completion: { kind: 'normal' },
      events: [...result.events, { op: 'assign', target: name, value: result.value }],
    };
  }

  if (node.type === 'print') {
    const valueNode = requiredExpression(node);
    const disposition = classifyInternalMachineClassScalarValue(valueNode, env);
    if (disposition === 'pure') return runInternalEffectMachineLeaf(node, env);
    if (disposition === 'unsupported') throw new Error('print: class expression is outside the resumable domain');
    const result = yield* evaluateInternalMachineClassScalarValue(valueNode, env, state);
    return {
      completion: { kind: 'normal' },
      events: [...result.events, { op: 'stdout', text: printText(result.value) }],
    };
  }

  if (node.type === 'return' && typeof node.props?.value === 'string') {
    const valueNode = requiredExpression(node);
    const disposition = classifyInternalMachineClassReturnValue(valueNode, env);
    if (disposition === 'pure' && env.runnerThis === undefined) return runInternalEffectMachineLeaf(node, env);
    if (disposition === 'unsupported') throw new Error('return: class expression is outside the resumable domain');
    const result =
      disposition === 'pure'
        ? { events: [], value: evalPortableValue(valueNode, env) }
        : yield* evaluateInternalMachineClassScalarValue(valueNode, env, state);
    return {
      completion: { kind: 'return', value: result.value },
      events: [...result.events],
    };
  }

  return runInternalEffectMachineLeaf(node, env);
}
