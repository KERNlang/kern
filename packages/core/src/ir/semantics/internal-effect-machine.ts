import type { RuntimeCapabilityValue } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import { isAsyncPlannedCapability } from './capability-lane.js';
import {
  invokeInternalRuntimeCapabilityAsync,
  invokeInternalRuntimeCapabilitySync,
  invokeInternalRuntimeSyncCapabilityAsync,
} from './internal-capability-interceptor.js';
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
import type { SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

function unwindMachineAfterProviderError(machine: InternalEffectMachineGenerator, error: unknown): never {
  try {
    machine.throw(error);
  } catch {
    // Preserve the provider/scheduler failure. Injecting it only gives active
    // generator finally blocks a chance to release internal bindings.
  }
  throw error;
}

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
  assertInternalEffectMachineStructureSupported(nodes, env);
  state.helperRegistry = assertInternalMachineHelperGraph(nodes, env).functions;
  state.helperBodyRunner = runInternalEffectMachineSequence;
  const restore = bindInternalEffectMachineState(env, state);
  try {
    return yield* runInternalEffectMachineSequence(nodes, env, state);
  } finally {
    restore();
  }
}

export function runInternalEffectMachineSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalEffectMachineSyncOptions = {},
): Trace {
  const machine = runMachine(nodes, env, { remainingIterations: options.iterationBudget });
  let step = machine.next();
  while (!step.done) {
    let result: RuntimeCapabilityValue | undefined;
    try {
      result = invokeInternalRuntimeCapabilitySync(env, step.value.prepared.call);
    } catch (error) {
      unwindMachineAfterProviderError(machine, error);
    }
    step = machine.next(result);
  }
  return step.value;
}

export async function runInternalEffectMachineAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalEffectMachineAsyncOptions = {},
): Promise<Trace> {
  const machine = runMachine(nodes, env, { remainingIterations: options.iterationBudget });
  let step = machine.next();
  while (!step.done) {
    const call = step.value.prepared.call;
    let result: RuntimeCapabilityValue | undefined;
    try {
      result = isAsyncPlannedCapability(call.namespace, call.operation)
        ? await invokeInternalRuntimeCapabilityAsync(env, options.asyncCapabilities, call, {
            timeoutMs: options.capabilityTimeoutMs,
          })
        : await invokeInternalRuntimeSyncCapabilityAsync(env, call);
    } catch (error) {
      unwindMachineAfterProviderError(machine, error);
    }
    step = machine.next(result);
  }
  return step.value;
}
