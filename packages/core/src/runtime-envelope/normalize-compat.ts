import { ReferenceRunnerError } from '../ir/semantics/reference-runner.js';
import { internalRuntimeFailure, normalizeInternalRuntimeFailure } from './normalize.js';
import type { InternalRuntimeEnvelope } from './types.js';

export function normalizeInternalRuntimeCompatFailure(error: unknown): InternalRuntimeEnvelope {
  return error instanceof ReferenceRunnerError
    ? internalRuntimeFailure('unsupported-runtime-input')
    : normalizeInternalRuntimeFailure(error);
}
