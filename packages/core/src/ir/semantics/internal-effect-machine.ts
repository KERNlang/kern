import type { RuntimeCapabilityValue } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import { isAsyncPlannedCapability } from './capability-lane.js';
import {
  invokeInternalRuntimeCapabilityAsync,
  invokeInternalRuntimeCapabilitySync,
  invokeInternalRuntimeSyncCapabilityAsync,
} from './internal-capability-interceptor.js';
import { hasBoundedRootEnvironment, hasStableOwnedEnvironmentChain } from './internal-effect-machine-admission.js';
import {
  assertInternalMachineClassGraph,
  assertInternalMachineClassUsage,
} from './internal-effect-machine-class-graph.js';
import { assertInternalMachineHelperGraph } from './internal-effect-machine-helper-graph.js';
import { bindInternalEffectMachineState } from './internal-effect-machine-helper-state.js';
import { runInternalEffectMachineSequence } from './internal-effect-machine-sequence.js';
import {
  assertInternalEffectMachineStructureSupported,
  isInternalEffectMachineEligible,
} from './internal-effect-machine-structure.js';
import {
  type InternalEffectMachineAsyncOptions,
  InternalEffectMachineError,
  type InternalEffectMachineGenerator,
  type InternalEffectMachineState,
  type InternalEffectMachineSyncOptions,
} from './internal-effect-machine-types.js';
import { installInternalTextCodePointCache } from './internal-text-code-point-cache.js';
import { isOwnedSemanticEnvironment, type SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

function withMachineState<T>(env: SemanticEnv, state: InternalEffectMachineState, advance: () => T): T {
  const restore = bindInternalEffectMachineState(env, state);
  try {
    return advance();
  } finally {
    restore();
  }
}

function unwindMachineAfterProviderError(
  machine: InternalEffectMachineGenerator,
  nodes: readonly IRNode[],
  env: SemanticEnv,
  state: InternalEffectMachineState,
  error: unknown,
): never {
  assertEnvironmentStillEligible(nodes, env);
  try {
    withMachineState(env, state, () => machine.throw(error));
  } catch {
    // Preserve the provider/scheduler failure. Injecting it only gives active
    // generator finally blocks a chance to release internal bindings.
  }
  throw error;
}

function assertEnvironmentStillEligible(nodes: readonly IRNode[], env: SemanticEnv): void {
  const stable = isOwnedSemanticEnvironment(env)
    ? hasStableOwnedEnvironmentChain(env, true, true)
    : hasBoundedRootEnvironment(env);
  if (stable) return;
  throw new InternalEffectMachineError('environment changed after provider dispatch', nodes[0] ?? { type: '__block' });
}

function assertCapabilityRequest(
  request: YieldType<InternalEffectMachineGenerator>,
  nodes: readonly IRNode[],
): asserts request is Extract<YieldType<InternalEffectMachineGenerator>, { kind: 'capability' }> {
  if (request.kind === 'capability') return;
  throw new InternalEffectMachineError(
    'internal helper dependency escaped the helper frame',
    nodes[0] ?? { type: '__block' },
  );
}

type YieldType<T> = T extends Generator<infer Y, unknown, unknown> ? Y : never;

export { isInternalEffectMachineEligible } from './internal-effect-machine-structure.js';
export type {
  InternalEffectMachineAsyncOptions,
  InternalEffectMachineSyncOptions,
} from './internal-effect-machine-types.js';
export {
  INTERNAL_EFFECT_MACHINE_DISPOSITION,
  INTERNAL_EFFECT_MACHINE_FORMAT,
  InternalEffectMachineError,
} from './internal-effect-machine-types.js';

function* runMachine(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalEffectMachineGenerator {
  if (!isInternalEffectMachineEligible(nodes, env)) {
    throw new InternalEffectMachineError(
      'input is outside the internal effect-machine corpus',
      nodes[0] ?? { type: '__block' },
    );
  }
  const classGraph = assertInternalMachineClassGraph(env);
  state.classRegistry = classGraph.classes;
  state.moduleGraph = classGraph.moduleGraph;
  assertInternalMachineClassUsage(nodes, env, classGraph.classes);
  state.helperBodyRunner = runInternalEffectMachineSequence;
  const helperGraph = assertInternalMachineHelperGraph(nodes, env, classGraph);
  state.helperRegistry = helperGraph.functions;
  state.resumableHelpers = helperGraph.resumableHelpers;
  state.resumableHelperNames = helperGraph.resumableHelperNames;
  assertInternalEffectMachineStructureSupported(nodes, env);
  return yield* runInternalEffectMachineSequence(nodes, env, state);
}

export function runInternalEffectMachineSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalEffectMachineSyncOptions = {},
): Trace {
  const state: InternalEffectMachineState = {
    observer: options.observer,
    remainingIterations: options.iterationBudget,
  };
  if (options.textCodePointCacheBudget !== undefined) {
    installInternalTextCodePointCache(state, options.textCodePointCacheBudget);
  }
  const machine = runMachine(nodes, env, state);
  let step = withMachineState(env, state, () => machine.next());
  while (!step.done) {
    assertCapabilityRequest(step.value, nodes);
    let result: RuntimeCapabilityValue | undefined;
    try {
      result = invokeInternalRuntimeCapabilitySync(env, step.value.prepared.call);
    } catch (error) {
      unwindMachineAfterProviderError(machine, nodes, env, state, error);
    }
    assertEnvironmentStillEligible(nodes, env);
    step = withMachineState(env, state, () => machine.next(result));
  }
  return step.value;
}

export async function runInternalEffectMachineAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalEffectMachineAsyncOptions = {},
): Promise<Trace> {
  const state: InternalEffectMachineState = {
    observer: options.observer,
    remainingIterations: options.iterationBudget,
  };
  if (options.textCodePointCacheBudget !== undefined) {
    installInternalTextCodePointCache(state, options.textCodePointCacheBudget);
  }
  const machine = runMachine(nodes, env, state);
  let step = withMachineState(env, state, () => machine.next());
  while (!step.done) {
    assertCapabilityRequest(step.value, nodes);
    const call = step.value.prepared.call;
    let result: RuntimeCapabilityValue | undefined;
    try {
      result = isAsyncPlannedCapability(call.namespace, call.operation)
        ? await invokeInternalRuntimeCapabilityAsync(env, options.asyncCapabilities, call, {
            timeoutMs: options.capabilityTimeoutMs,
          })
        : await invokeInternalRuntimeSyncCapabilityAsync(env, call);
    } catch (error) {
      unwindMachineAfterProviderError(machine, nodes, env, state, error);
    }
    assertEnvironmentStillEligible(nodes, env);
    step = withMachineState(env, state, () => machine.next(result));
  }
  return step.value;
}
