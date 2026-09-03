import type { KernRuntimeHandlerLimits } from '@kernlang/core/runtime/handler';

const DECLARED = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxIterations',
  'maxStringBytes',
] as const;

type Declared = (typeof DECLARED)[number];

type ExactLimitKeys = [Exclude<keyof KernRuntimeHandlerLimits, Declared>] extends [never]
  ? [Exclude<Declared, keyof KernRuntimeHandlerLimits>] extends [never]
    ? readonly Declared[]
    : never
  : never;

export const KERN_RUNTIME_HANDLER_LIMIT_KEYS: ExactLimitKeys = DECLARED;
