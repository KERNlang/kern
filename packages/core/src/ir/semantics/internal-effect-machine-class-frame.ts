import type { RuntimeCapabilityValue } from '../../runner-capabilities.js';
import type { ValueIR } from '../../value-ir.js';
import {
  createInternalMachineClassInstance,
  internalMachineClassConstructorArgumentNodes,
  makeInternalMachineClassMemberEnv,
} from './internal-effect-machine-class-activation.js';
import {
  internalMachineClassForNew,
  internalMachineClassGetterForRead,
  internalMachineClassMethodForCall,
  internalMachineClassRegistryForEnv,
} from './internal-effect-machine-class-graph.js';
import { internalMachineClassReceiver } from './internal-effect-machine-class-instance.js';
import { bindInternalEffectMachineState } from './internal-effect-machine-helper-state.js';
import type { InternalCapabilityEffectRequest, InternalEffectMachineState } from './internal-effect-machine-types.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableScalar, type PortableScalar } from './portable-scalar-domain.js';
import type { RunnerClassInstanceValue, SemanticEnv } from './semantic-env.js';
import type { TraceEvent } from './trace.js';

export interface InternalMachineClassEvaluatedValue<T = PortableScalar> {
  readonly events: readonly TraceEvent[];
  readonly value: T;
}

export type InternalMachineClassValueGenerator<T = PortableScalar> = Generator<
  InternalCapabilityEffectRequest,
  InternalMachineClassEvaluatedValue<T>,
  RuntimeCapabilityValue | undefined
>;

export type InternalMachineClassValueEvaluator = (
  node: ValueIR,
  env: SemanticEnv,
  state: InternalEffectMachineState,
) => InternalMachineClassValueGenerator;

function appendEvaluation<T>(target: TraceEvent[], evaluated: InternalMachineClassEvaluatedValue<T>): T {
  target.push(...evaluated.events);
  return evaluated.value;
}

export function* evaluateInternalMachineClassNewFrame(
  value: ValueIR,
  env: SemanticEnv,
  state: InternalEffectMachineState,
  evaluate: InternalMachineClassValueEvaluator,
): InternalMachineClassValueGenerator<RunnerClassInstanceValue> {
  const candidate = internalMachineClassForNew(value, env);
  const registry = state.classRegistry;
  const cls = candidate ? registry?.get(candidate.name) : undefined;
  const bodyRunner = state.helperBodyRunner;
  if (!registry || !cls || !bodyRunner) throw new Error('machine class: construction is unavailable');

  const events: TraceEvent[] = [];
  const values: PortableScalar[] = [];
  for (const argument of internalMachineClassConstructorArgumentNodes(value, cls)) {
    values.push(appendEvaluation(events, yield* evaluate(argument, env, state)));
  }
  const { constructorEnv, instance } = createInternalMachineClassInstance(
    cls,
    env,
    values,
    evalPortableValue,
    state,
    registry,
  );
  const body = cls.constructor?.body ?? [];
  if (body.length === 0) return { events, value: instance };

  const restore = bindInternalEffectMachineState(constructorEnv, state);
  try {
    const trace = yield* bodyRunner(body, constructorEnv, state);
    events.push(...trace.events);
    if (trace.completion.kind !== 'normal') {
      throw new Error(`machine class: constructor "${cls.name}" completed abnormally`);
    }
    return { events, value: instance };
  } finally {
    restore();
  }
}

export function* evaluateInternalMachineClassMethodFrame(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  state: InternalEffectMachineState,
  evaluate: InternalMachineClassValueEvaluator,
): InternalMachineClassValueGenerator {
  const resolved = internalMachineClassMethodForCall(node, env);
  if (!resolved) throw new Error('machine class: method call is unavailable');
  const receiver = internalMachineClassReceiver(resolved.receiverName, env);
  const bodyRunner = state.helperBodyRunner;
  if (!receiver || !bodyRunner) throw new Error('machine class: method receiver is unavailable');
  if (node.args.length !== resolved.method.params.length) {
    throw new Error(`machine class: method "${resolved.cls.name}.${resolved.method.name}" has invalid arity`);
  }

  const events: TraceEvent[] = [];
  const values: PortableScalar[] = [];
  for (const argument of node.args) values.push(appendEvaluation(events, yield* evaluate(argument, env, state)));
  const registry = internalMachineClassRegistryForEnv(env);
  const methodEnv = makeInternalMachineClassMemberEnv(resolved.cls, resolved.method, receiver, values, env, registry);
  const restore = bindInternalEffectMachineState(methodEnv, state);
  try {
    const trace = yield* bodyRunner(resolved.method.body, methodEnv, state);
    events.push(...trace.events);
    if (trace.completion.kind !== 'return') {
      throw new Error(`machine class: method "${resolved.cls.name}.${resolved.method.name}" must return a scalar`);
    }
    return {
      events,
      value: assertPortableScalar(
        trace.completion.value,
        `method "${resolved.cls.name}.${resolved.method.name}" return`,
      ),
    };
  } finally {
    restore();
  }
}

export function* evaluateInternalMachineClassGetterFrame(
  node: Extract<ValueIR, { kind: 'member' }>,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalMachineClassValueGenerator {
  const resolved = internalMachineClassGetterForRead(node, env);
  if (!resolved) throw new Error('machine class: getter read is unavailable');
  const receiver = internalMachineClassReceiver(resolved.receiverName, env);
  const bodyRunner = state.helperBodyRunner;
  if (!receiver || !bodyRunner) throw new Error('machine class: getter receiver is unavailable');

  const registry = internalMachineClassRegistryForEnv(env);
  const getterEnv = makeInternalMachineClassMemberEnv(resolved.cls, resolved.getter, receiver, [], env, registry);
  const restore = bindInternalEffectMachineState(getterEnv, state);
  try {
    const trace = yield* bodyRunner(resolved.getter.body, getterEnv, state);
    if (trace.completion.kind !== 'return') {
      throw new Error(`machine class: getter "${resolved.cls.name}.${resolved.getter.name}" must return a scalar`);
    }
    return {
      events: trace.events,
      value: assertPortableScalar(
        trace.completion.value,
        `getter "${resolved.cls.name}.${resolved.getter.name}" return`,
      ),
    };
  } finally {
    restore();
  }
}
