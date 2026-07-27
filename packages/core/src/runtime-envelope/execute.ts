import type { SemanticEnv } from '../ir/semantics/semantic-env.js';
import type { IRNode } from '../types.js';
import {
  assertInternalRuntimeEngineSupported,
  type InternalRuntimeAsyncOptions,
  runInternalRuntimeEngineAsync,
  runInternalRuntimeEngineSync,
} from './internal-engine.js';
import {
  installInternalRuntimeScheduler,
  throwIfInternalRuntimeSchedulerTerminated,
  waitForInternalRuntimeScheduler,
} from './internal-scheduler.js';
import { normalizeInternalRuntimeFailure, normalizeInternalRuntimeTrace } from './normalize.js';
import {
  type InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeOptions,
} from './types.js';
import { validateInternalRuntimeLimits } from './value.js';

function enabled(options: InternalRuntimeEnvelopeOptions | undefined): InternalRuntimeEnvelopeOptions {
  if (options?.enabled !== true) {
    throw new InternalRuntimeEnvelopeError('disabled', 'internal runtime envelope is default-off');
  }
  validateInternalRuntimeLimits(options.limits);
  return options;
}

export function executeInternalRuntimeEnvelopeSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options?: InternalRuntimeEnvelopeOptions,
): InternalRuntimeEnvelope {
  const accepted = enabled(options);
  let disposeScheduler = () => {};
  try {
    assertInternalRuntimeEngineSupported(nodes, env);
    disposeScheduler = installInternalRuntimeScheduler(env, accepted.scheduler);
    throwIfInternalRuntimeSchedulerTerminated(env);
    const trace = runInternalRuntimeEngineSync(nodes, env, accepted.limits.maxCollectionLength, accepted.observer);
    throwIfInternalRuntimeSchedulerTerminated(env);
    return normalizeInternalRuntimeTrace(trace, accepted.limits);
  } catch (error) {
    return normalizeInternalRuntimeFailure(error);
  } finally {
    disposeScheduler();
  }
}

export async function executeInternalRuntimeEnvelopeAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalRuntimeEnvelopeOptions | undefined,
  asyncOptions: InternalRuntimeAsyncOptions = {},
): Promise<InternalRuntimeEnvelope> {
  const accepted = enabled(options);
  let disposeScheduler = () => {};
  try {
    assertInternalRuntimeEngineSupported(nodes, env);
    disposeScheduler = installInternalRuntimeScheduler(env, accepted.scheduler);
    throwIfInternalRuntimeSchedulerTerminated(env);
    const trace = await waitForInternalRuntimeScheduler(env, () =>
      runInternalRuntimeEngineAsync(nodes, env, {
        ...asyncOptions,
        iterationBudget: accepted.limits.maxCollectionLength,
        observer: accepted.observer,
      }),
    );
    throwIfInternalRuntimeSchedulerTerminated(env);
    return normalizeInternalRuntimeTrace(trace, accepted.limits);
  } catch (error) {
    return normalizeInternalRuntimeFailure(error);
  } finally {
    disposeScheduler();
  }
}
