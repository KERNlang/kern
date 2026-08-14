import { type AsyncReferenceRunnerOptions, asyncReferenceRunSequence } from '../ir/semantics/async-reference-runner.js';
import {
  bindInternalReferenceTraceRetention,
  type InternalReferenceTraceRetention,
  type SemanticEnv,
} from '../ir/semantics/index.js';
import { referenceRunSequence } from '../ir/semantics/reference-runner.js';
import { registerAllContracts } from '../ir/semantics/register-all.js';
import type { Trace } from '../ir/semantics/trace.js';
import type { IRNode } from '../types.js';

export type { AsyncReferenceRunnerOptions as InternalLegacyAsyncOptions };

/** Dirty compatibility runner. Call only after the compat entry selects legacy. */
export function runInternalLegacyEngineSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  traceRetention: InternalReferenceTraceRetention = 'full',
): Trace {
  registerAllContracts();
  const restore = bindInternalReferenceTraceRetention(env, traceRetention);
  try {
    return referenceRunSequence(nodes, env);
  } finally {
    restore();
  }
}

/** Dirty compatibility runner. Call only after the compat entry selects legacy. */
export async function runInternalLegacyEngineAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
  traceRetention: InternalReferenceTraceRetention = 'full',
): Promise<Trace> {
  registerAllContracts();
  const restore = bindInternalReferenceTraceRetention(env, traceRetention);
  try {
    return await asyncReferenceRunSequence(nodes, env, options);
  } finally {
    restore();
  }
}
