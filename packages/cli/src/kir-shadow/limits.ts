import type { KernKirLimits } from '@kernlang/core/runtime/kir';

export const KIR_SHADOW_LIMITS: KernKirLimits = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

export const KIR_SHADOW_SOURCE_MAX_BYTES = 1_000_000;
export const KIR_SHADOW_CHILD_TIMEOUT_MS = 5_000;
export const KIR_SHADOW_CHILD_MAX_BYTES = 500_000;
export const KIR_SHADOW_ERROR_MAX_BYTES = 480;
