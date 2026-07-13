import type { SemanticEnv } from '../ir/semantics/index.js';
import { registerAllContracts } from '../ir/semantics/register-all.js';
import type { IRNode } from '../types.js';
import {
  type AsyncReferenceRunnerOptions,
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
    disposeScheduler = installInternalRuntimeScheduler(env, accepted.scheduler);
    throwIfInternalRuntimeSchedulerTerminated(env);
    registerAllContracts();
    const trace = runInternalRuntimeEngineSync(nodes, env);
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
  asyncOptions: AsyncReferenceRunnerOptions = {},
): Promise<InternalRuntimeEnvelope> {
  const accepted = enabled(options);
  let disposeScheduler = () => {};
  try {
    disposeScheduler = installInternalRuntimeScheduler(env, accepted.scheduler);
    throwIfInternalRuntimeSchedulerTerminated(env);
    registerAllContracts();
    const trace = await waitForInternalRuntimeScheduler(env, () =>
      runInternalRuntimeEngineAsync(nodes, env, asyncOptions),
    );
    throwIfInternalRuntimeSchedulerTerminated(env);
    return normalizeInternalRuntimeTrace(trace, accepted.limits);
  } catch (error) {
    return normalizeInternalRuntimeFailure(error);
  } finally {
    disposeScheduler();
  }
}
