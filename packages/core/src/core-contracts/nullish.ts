import type { CoreTypeContract } from './schema.js';

export const NULL_CONTRACT = {
  name: 'Null',
  kind: 'nullish',
  strict: true,
  operations: [],
} as const satisfies CoreTypeContract;

export const UNDEFINED_CONTRACT = {
  name: 'Undefined',
  kind: 'nullish',
  strict: true,
  operations: [],
} as const satisfies CoreTypeContract;
