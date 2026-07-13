import { parseExpression } from '../../parser-expression.js';
import {
  assertRuntimeCapabilityValue,
  KernCapabilityError,
  type RuntimeCapabilityCall,
  type RuntimeCapabilityValue,
} from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';
import {
  defineBinding,
  getBinding,
  hasBinding,
  hasOwnBinding,
  type SemanticEnv,
} from './index.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { isArrayLiteralExpression } from './portable-array.js';
import { isRecordLiteralExpression } from './portable-record-evaluator.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import type { Trace } from './trace.js';

interface CapabilityProps {
  namespace?: unknown;
  operation?: unknown;
  name?: unknown;
  input?: unknown;
}

function asCapabilityProps(ir: IRNode): CapabilityProps {
  return (ir.props ?? {}) as CapabilityProps;
}

export function isCapabilityToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function capabilityInputBinding(name: string, env: SemanticEnv): unknown {
  if (!isPortableBindingName(name)) {
    throw new Error(`capability input: binding "${name}" is outside the portable capability input domain`);
  }
  if (!hasBinding(env, name)) throw new Error(`capability input: binding "${name}" not found`);
  return getBinding(env, name);
}

const RESERVED_CAPABILITY_INPUT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function evalCapabilityInputValue(node: ValueIR, env: SemanticEnv, evaluate: EvalPortableValue): unknown {
  if (isRecordLiteralExpression(node)) return evalCapabilityInputRecord(node, env, evaluate);
  if (isArrayLiteralExpression(node)) return evalCapabilityInputArray(node, env, evaluate);
  if (node.kind === 'ident') return capabilityInputBinding(node.name, env);
  return evaluate(node, env);
}

function evalCapabilityInputRecord(
  node: Extract<ValueIR, { kind: 'objectLit' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): RuntimeCapabilityValue {
  const out: Record<string, RuntimeCapabilityValue> = Object.create(null);
  for (const entry of node.entries) {
    if ('kind' in entry) {
      throw new Error('capability input: object spreads are outside the portable capability input domain');
    }
    if (entry.rawKey !== undefined) {
      throw new Error('capability input: numeric record keys are outside the portable capability input domain');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
      throw new Error('capability input: record keys must be identifier-like strings');
    }
    if (RESERVED_CAPABILITY_INPUT_KEYS.has(entry.key)) {
      throw new Error(`capability input: reserved key "${entry.key}" is outside the portable capability input domain`);
    }
    if (Object.hasOwn(out, entry.key)) {
      throw new Error(`capability input: duplicate key "${entry.key}" is outside the portable capability input domain`);
    }
    out[entry.key] = assertRuntimeCapabilityValue(
      evalCapabilityInputValue(entry.value, env, evaluate),
      'capability input',
    );
  }
  return Object.freeze(out);
}

function evalCapabilityInputArray(
  node: Extract<ValueIR, { kind: 'arrayLit' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): RuntimeCapabilityValue {
  const out: RuntimeCapabilityValue[] = [];
  for (let index = 0; index < node.items.length; index += 1) {
    if (!(index in node.items)) {
      throw new Error('capability input: array literal items must not contain sparse holes');
    }
    out.push(assertRuntimeCapabilityValue(evalCapabilityInputValue(node.items[index], env, evaluate), 'capability input'));
  }
  return Object.freeze(out);
}

export function capabilityInputWithEvaluator(
  ir: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): RuntimeCapabilityValue | undefined {
  if (!Object.hasOwn(ir.props ?? {}, 'input')) return undefined;
  const raw = asCapabilityProps(ir).input;
  if (typeof raw !== 'string') return assertRuntimeCapabilityValue(raw, 'capability input');
  const parsed = parseExpression(raw);
  if (isArrayLiteralExpression(parsed)) {
    return assertRuntimeCapabilityValue(evalCapabilityInputArray(parsed, env, evaluate), 'capability input');
  }
  if (isRecordLiteralExpression(parsed)) {
    return assertRuntimeCapabilityValue(evalCapabilityInputRecord(parsed, env, evaluate), 'capability input');
  }
  if (parsed.kind === 'ident') {
    return assertRuntimeCapabilityValue(capabilityInputBinding(parsed.name, env), 'capability input');
  }
  if (!isValueIR(parsed)) throw new Error('capability: input must be a portable value expression');
  return assertRuntimeCapabilityValue(evaluate(parsed, env), 'capability input');
}

export interface PreparedInternalCapabilityEffect {
  readonly call: RuntimeCapabilityCall;
  readonly resultBinding: string | undefined;
}

export function prepareInternalCapabilityEffectWithEvaluator(
  ir: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PreparedInternalCapabilityEffect {
  const props = asCapabilityProps(ir);
  if (!isCapabilityToken(props.namespace) || !isCapabilityToken(props.operation)) {
    throw new KernCapabilityError(
      String(props.namespace ?? ''),
      String(props.operation ?? ''),
      'capability node is malformed',
    );
  }
  const namespace = props.namespace;
  const operation = props.operation;
  const input = capabilityInputWithEvaluator(ir, env, evaluate);
  let resultBinding: string | undefined;
  if (props.name !== undefined && props.name !== '') {
    if (typeof props.name !== 'string' || !isPortableBindingName(props.name) || hasOwnBinding(env, props.name)) {
      throw new KernCapabilityError(namespace, operation, 'capability result binding is invalid');
    }
    resultBinding = props.name;
  }
  return { call: { namespace, operation, input }, resultBinding };
}

export function resumeInternalCapabilityEffect(
  prepared: PreparedInternalCapabilityEffect,
  result: RuntimeCapabilityValue | undefined,
  env: SemanticEnv,
): Trace {
  const { input, namespace, operation } = prepared.call;
  const events: Trace['events'] = [{ op: 'capability', namespace, operation, input, result }];
  if (prepared.resultBinding !== undefined) {
    if (result === undefined) {
      throw new KernCapabilityError(
        namespace,
        operation,
        `capability: ${namespace}.${operation} returned no value for name=${prepared.resultBinding}`,
      );
    }
    defineBinding(env, prepared.resultBinding, result);
    events.push({ op: 'assign', target: prepared.resultBinding, value: result });
  }
  return { events, completion: { kind: 'normal' } };
}
