export const INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxIterations',
  'maxStringBytes',
] as const;

export type InternalRuntimeEnvelopeLimitKey = (typeof INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS)[number];
