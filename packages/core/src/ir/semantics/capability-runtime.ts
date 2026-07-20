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
  assertDeferredMachineScalarPreflight,
  expressionRequiresDeferredMachinePreflight,
} from './deferred-expression-preflight.js';
import { isInternalMachineHelperCall } from './internal-effect-machine-helper-graph.js';
import { evalInternalMachineHelperValue } from './internal-effect-machine-helper-runtime.js';
import { isArrayLiteralExpression } from './portable-array.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { isRecordLiteralExpression } from './portable-record-evaluator.js';
import { isPortableBindingName, isPortableRecordKey } from './portable-scalar-domain.js';
import { defineBinding, getBinding, hasBinding, hasOwnBinding, type SemanticEnv } from './semantic-env.js';
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

function evalCapabilityInputValue(node: ValueIR, env: SemanticEnv, evaluate: EvalPortableValue): unknown {
  if (isRecordLiteralExpression(node)) return evalCapabilityInputRecord(node, env, evaluate);
  if (isArrayLiteralExpression(node)) return evalCapabilityInputArray(node, env, evaluate);
  if (node.kind === 'ident') return capabilityInputBinding(node.name, env);
  if (
    node.kind === 'call' &&
    node.callee.kind === 'ident' &&
    isInternalMachineHelperCall(node.callee.name, node.args.length, env)
  ) {
    return evalInternalMachineHelperValue(node.callee.name, node.args, env, evaluate);
  }
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
    if (!isPortableRecordKey(entry.key)) {
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
    out.push(
      assertRuntimeCapabilityValue(evalCapabilityInputValue(node.items[index], env, evaluate), 'capability input'),
    );
  }
  return Object.freeze(out);
}

function assertCapabilityInputValueShape(node: ValueIR, env?: SemanticEnv): void {
  if (isRecordLiteralExpression(node)) {
    const keys = new Set<string>();
    for (const entry of node.entries) {
      if ('kind' in entry) {
        throw new Error('capability input: object spreads are outside the portable capability input domain');
      }
      if (entry.rawKey !== undefined) {
        throw new Error('capability input: numeric record keys are outside the portable capability input domain');
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key) || !isPortableRecordKey(entry.key)) {
        throw new Error(`capability input: record key "${entry.key}" is outside the portable capability input domain`);
      }
      if (keys.has(entry.key)) {
        throw new Error(
          `capability input: duplicate key "${entry.key}" is outside the portable capability input domain`,
        );
      }
      keys.add(entry.key);
      assertCapabilityInputValueShape(entry.value, env);
    }
    return;
  }
  if (isArrayLiteralExpression(node)) {
    for (let index = 0; index < node.items.length; index += 1) {
      if (!(index in node.items)) {
        throw new Error('capability input: array literal items must not contain sparse holes');
      }
      assertCapabilityInputValueShape(node.items[index], env);
    }
    return;
  }
  if (node.kind === 'ident' && !isPortableBindingName(node.name)) {
    throw new Error(`capability input: binding "${node.name}" is outside the portable capability input domain`);
  }
  assertPortableMachineScalarShape(node, env);
}

function assertCapabilityInputShape(ir: IRNode, env?: SemanticEnv): void {
  if (!Object.hasOwn(ir.props ?? {}, 'input')) return;
  const raw = asCapabilityProps(ir).input;
  if (typeof raw !== 'string') {
    assertRuntimeCapabilityValue(raw, 'capability input');
    return;
  }
  const parsed = parseExpression(raw);
  if (!isValueIR(parsed)) throw new Error('capability: input must be a portable value expression');
  assertCapabilityInputValueShape(parsed, env);
}

/** Validate a capability node without resolving inputs or consulting runtime bindings. */
export function assertInternalCapabilityEffectShape(ir: IRNode, env?: SemanticEnv): string | undefined {
  const props = asCapabilityProps(ir);
  if (!isCapabilityToken(props.namespace) || !isCapabilityToken(props.operation)) {
    throw new KernCapabilityError(
      String(props.namespace ?? ''),
      String(props.operation ?? ''),
      'capability node is malformed',
    );
  }
  assertCapabilityInputShape(ir, env);
  if (props.name === undefined || props.name === '') return undefined;
  if (typeof props.name !== 'string' || !isPortableBindingName(props.name)) {
    throw new KernCapabilityError(props.namespace, props.operation, 'capability result binding is invalid');
  }
  return props.name;
}

export function reserveInternalCapabilityEffectShape(ir: IRNode, env: SemanticEnv): void {
  const resultBinding = assertInternalCapabilityEffectShape(ir, env);
  if (resultBinding === undefined) return;
  if (hasOwnBinding(env, resultBinding)) throw new Error('capability result binding is already reserved');
  defineBinding(env, resultBinding, null);
}

export function assertDeferredCapabilityInputKnownValues(
  raw: string,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  deferredBindings: ReadonlySet<string>,
): void {
  const parsed = parseExpression(raw);
  if (!isValueIR(parsed)) throw new Error('capability: input must be a portable value expression');
  assertDeferredCapabilityValue(parsed, env, evaluate, deferredBindings);
}

function assertDeferredCapabilityValue(
  node: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  deferredBindings: ReadonlySet<string>,
): void {
  if (!expressionRequiresDeferredMachinePreflight(node, env, deferredBindings)) {
    assertRuntimeCapabilityValue(evalCapabilityInputValue(node, env, evaluate), 'capability input');
    return;
  }
  if (isRecordLiteralExpression(node)) {
    for (const entry of node.entries) {
      if (!('kind' in entry)) assertDeferredCapabilityValue(entry.value, env, evaluate, deferredBindings);
    }
    return;
  }
  if (isArrayLiteralExpression(node)) {
    for (const item of node.items) assertDeferredCapabilityValue(item, env, evaluate, deferredBindings);
    return;
  }
  assertDeferredMachineScalarPreflight(node, env, deferredBindings);
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
  if (parsed.kind === 'ident') {
    return assertRuntimeCapabilityValue(capabilityInputBinding(parsed.name, env), 'capability input');
  }
  if (isArrayLiteralExpression(parsed)) {
    return assertRuntimeCapabilityValue(evalCapabilityInputArray(parsed, env, evaluate), 'capability input');
  }
  if (isRecordLiteralExpression(parsed)) {
    return assertRuntimeCapabilityValue(evalCapabilityInputRecord(parsed, env, evaluate), 'capability input');
  }
  if (!isValueIR(parsed)) throw new Error('capability: input must be a portable value expression');
  return assertRuntimeCapabilityValue(evalCapabilityInputValue(parsed, env, evaluate), 'capability input');
}

export interface PreparedInternalCapabilityEffect {
  readonly call: RuntimeCapabilityCall;
  readonly resultBinding: string | undefined;
}

export function prepareInternalCapabilityEffectWithEvaluator(
  ir: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  options: { readonly shapeOnlyInput?: boolean } = {},
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
  let input: RuntimeCapabilityValue | undefined;
  if (options.shapeOnlyInput === true) assertCapabilityInputShape(ir, env);
  else input = capabilityInputWithEvaluator(ir, env, evaluate);
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
