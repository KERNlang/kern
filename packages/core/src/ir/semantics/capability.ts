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
  type NodeContract,
  type NodeFixture,
  registerContract,
  type SemanticEnv,
} from './index.js';
import { invokeInternalRuntimeCapabilitySync } from './internal-capability-interceptor.js';
import { isArrayLiteralExpression } from './portable-array.js';
import { evalPortableValue, isPortableBindingName, isRecordLiteralExpression } from './portable-scalar.js';
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

export function capabilityInput(ir: IRNode, env: SemanticEnv): RuntimeCapabilityValue | undefined {
  if (!Object.hasOwn(ir.props ?? {}, 'input')) return undefined;
  const raw = asCapabilityProps(ir).input;
  if (typeof raw !== 'string') return assertRuntimeCapabilityValue(raw, 'capability input');
  const parsed = parseExpression(raw);
  if (isArrayLiteralExpression(parsed))
    return assertRuntimeCapabilityValue(evalCapabilityInputArray(parsed, env), 'capability input');
  if (isRecordLiteralExpression(parsed))
    return assertRuntimeCapabilityValue(evalCapabilityInputRecord(parsed, env), 'capability input');
  if (parsed.kind === 'ident')
    return assertRuntimeCapabilityValue(capabilityInputBinding(parsed.name, env), 'capability input');
  if (!isValueIR(parsed)) throw new Error('capability: input must be a portable value expression');
  return assertRuntimeCapabilityValue(evalPortableValue(parsed, env), 'capability input');
}

const RESERVED_CAPABILITY_INPUT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function evalCapabilityInputValue(node: ValueIR, env: SemanticEnv): unknown {
  if (isRecordLiteralExpression(node)) return evalCapabilityInputRecord(node, env);
  if (isArrayLiteralExpression(node)) return evalCapabilityInputArray(node, env);
  if (node.kind === 'ident') return capabilityInputBinding(node.name, env);
  return evalPortableValue(node, env);
}

function capabilityInputBinding(name: string, env: SemanticEnv): unknown {
  if (!isPortableBindingName(name)) {
    throw new Error(`capability input: binding "${name}" is outside the portable capability input domain`);
  }
  if (!hasBinding(env, name)) throw new Error(`capability input: binding "${name}" not found`);
  return getBinding(env, name);
}

function evalCapabilityInputRecord(
  node: Extract<ValueIR, { kind: 'objectLit' }>,
  env: SemanticEnv,
): RuntimeCapabilityValue {
  const out: Record<string, RuntimeCapabilityValue> = Object.create(null);
  for (const entry of node.entries) {
    if ('kind' in entry) {
      throw new Error('capability input: object spreads are outside the portable capability input domain');
    }
    if ('rawKey' in entry && entry.rawKey !== undefined) {
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
    out[entry.key] = assertRuntimeCapabilityValue(evalCapabilityInputValue(entry.value, env), 'capability input');
  }
  return Object.freeze(out);
}

function evalCapabilityInputArray(
  node: Extract<ValueIR, { kind: 'arrayLit' }>,
  env: SemanticEnv,
): RuntimeCapabilityValue {
  const out: RuntimeCapabilityValue[] = [];
  for (let index = 0; index < node.items.length; index += 1) {
    if (!(index in node.items)) {
      throw new Error('capability input: array literal items must not contain sparse holes');
    }
    out.push(assertRuntimeCapabilityValue(evalCapabilityInputValue(node.items[index], env), 'capability input'));
  }
  return Object.freeze(out);
}

function capabilityPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  try {
    prepareInternalCapabilityEffect(ir, env);
    return true;
  } catch {
    return false;
  }
}

export interface PreparedInternalCapabilityEffect {
  readonly call: RuntimeCapabilityCall;
  readonly resultBinding: string | undefined;
}

export function prepareInternalCapabilityEffect(ir: IRNode, env: SemanticEnv): PreparedInternalCapabilityEffect {
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
  const input = capabilityInput(ir, env);
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

function capabilityEffects(ir: IRNode, env: SemanticEnv): Trace {
  const prepared = prepareInternalCapabilityEffect(ir, env);
  const result = invokeInternalRuntimeCapabilitySync(env, prepared.call);
  return resumeInternalCapabilityEffect(prepared, result, env);
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([]);

export const capabilityContract: NodeContract = {
  nodeType: 'capability',
  preconditions: capabilityPreconditions,
  effects: capabilityEffects,
  completion: () => ({ kind: 'normal' }),
  forbiddenRewrites: [
    'read capability implementations from globalThis, process, or other implicit host globals',
    'fall back to a host implementation when a capability is not explicitly registered',
    'invoke Node-only RAG, filesystem, network, crypto, or storage modules from the browser runner entry',
  ],
  fixtures: FIXTURES,
};

let registered = false;

export function registerCapabilityContract(): void {
  if (registered) return;
  registerContract(capabilityContract);
  registered = true;
}

export function _resetCapabilityContractForTest(): void {
  registered = false;
}
