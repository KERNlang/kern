import type { CoreTypeContract } from './schema.js';

export const FUNCTION_CONTRACT = {
  name: 'Function',
  kind: 'callable',
  strict: true,
  operations: [],
} as const satisfies CoreTypeContract;
