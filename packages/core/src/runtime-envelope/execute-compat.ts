import type { SemanticEnv } from '../ir/semantics/index.js';
import { INTERNAL_EFFECT_MACHINE_FORMAT } from '../ir/semantics/internal-effect-machine.js';
import type { IRNode } from '../types.js';
import { executeInternalRuntimeEnvelopeAsync, executeInternalRuntimeEnvelopeSync } from './execute.js';
import { selectInternalRuntimeEngine } from './internal-engine.js';
import {
  type InternalLegacyAsyncOptions,
  runInternalLegacyEngineAsync,
  runInternalLegacyEngineSync,
} from './internal-legacy-engine.js';
import {
  installInternalRuntimeScheduler,
  throwIfInternalRuntimeSchedulerTerminated,
  waitForInternalRuntimeScheduler,
} from './internal-scheduler.js';
import { normalizeInternalRuntimeTrace } from './normalize.js';
import { normalizeInternalRuntimeCompatFailure } from './normalize-compat.js';
import {
  type InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeOptions,
} from './types.js';
import { validateInternalRuntimeLimits } from './value.js';

export type InternalRuntimeCompatAsyncOptions = InternalLegacyAsyncOptions;

function enabled(options: InternalRuntimeEnvelopeOptions | undefined): InternalRuntimeEnvelopeOptions {
  if (options?.enabled !== true) {
    throw new InternalRuntimeEnvelopeError('disabled', 'internal runtime compatibility envelope is default-off');
  }
  validateInternalRuntimeLimits(options.limits);
  return options;
}

export function executeInternalRuntimeEnvelopeCompatSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options?: InternalRuntimeEnvelopeOptions,
): InternalRuntimeEnvelope {
  const accepted = enabled(options);
  const disposition = selectInternalRuntimeEngine(nodes, env);
  if (disposition === INTERNAL_EFFECT_MACHINE_FORMAT) {
    return executeInternalRuntimeEnvelopeSync(nodes, env, accepted);
  }
  let disposeScheduler = () => {};
  try {
    disposeScheduler = installInternalRuntimeScheduler(env, accepted.scheduler);
    throwIfInternalRuntimeSchedulerTerminated(env);
    const trace = runInternalLegacyEngineSync(nodes, env);
    throwIfInternalRuntimeSchedulerTerminated(env);
    return normalizeInternalRuntimeTrace(trace, accepted.limits);
  } catch (error) {
    return normalizeInternalRuntimeCompatFailure(error);
  } finally {
    disposeScheduler();
  }
}

export async function executeInternalRuntimeEnvelopeCompatAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalRuntimeEnvelopeOptions | undefined,
  asyncOptions: InternalRuntimeCompatAsyncOptions = {},
): Promise<InternalRuntimeEnvelope> {
  const accepted = enabled(options);
  const disposition = selectInternalRuntimeEngine(nodes, env);
  if (disposition === INTERNAL_EFFECT_MACHINE_FORMAT) {
    return executeInternalRuntimeEnvelopeAsync(nodes, env, accepted, asyncOptions);
  }
  let disposeScheduler = () => {};
  try {
    disposeScheduler = installInternalRuntimeScheduler(env, accepted.scheduler);
    throwIfInternalRuntimeSchedulerTerminated(env);
    const trace = await waitForInternalRuntimeScheduler(env, () =>
      runInternalLegacyEngineAsync(nodes, env, asyncOptions),
    );
    throwIfInternalRuntimeSchedulerTerminated(env);
    return normalizeInternalRuntimeTrace(trace, accepted.limits);
  } catch (error) {
    return normalizeInternalRuntimeCompatFailure(error);
  } finally {
    disposeScheduler();
  }
}
