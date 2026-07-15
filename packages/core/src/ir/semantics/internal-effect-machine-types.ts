import type { KernRunnerAsyncCapabilities, RuntimeCapabilityValue } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import type { PreparedInternalCapabilityEffect } from './capability-runtime.js';
import type { SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

export const INTERNAL_EFFECT_MACHINE_FORMAT = 'kern.runtime.effect-machine.internal.r0' as const;

export const INTERNAL_EFFECT_MACHINE_DISPOSITION = Object.freeze({
  assign: 'unified',
  branch: 'unified',
  break: 'unified',
  capability: 'unified',
  continue: 'unified',
  do: 'unified',
  each: 'partial',
  'expression-v1': 'unified',
  fmt: 'unified',
  for: 'unified',
  if: 'unified',
  lambda: 'legacy',
  let: 'unified',
  print: 'unified',
  return: 'unified',
  throw: 'unified',
  try: 'unified',
  while: 'unified',
} as const);

export type UnifiedNodeType = {
  [K in keyof typeof INTERNAL_EFFECT_MACHINE_DISPOSITION]: (typeof INTERNAL_EFFECT_MACHINE_DISPOSITION)[K] extends 'unified'
    ? K
    : never;
}[keyof typeof INTERNAL_EFFECT_MACHINE_DISPOSITION];

export interface InternalEffectMachineAsyncOptions {
  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;
  readonly capabilityTimeoutMs?: number;
  readonly iterationBudget?: number;
}

export interface InternalEffectMachineSyncOptions {
  readonly iterationBudget?: number;
}

export interface InternalCapabilityEffectRequest {
  readonly format: typeof INTERNAL_EFFECT_MACHINE_FORMAT;
  readonly kind: 'capability';
  readonly prepared: PreparedInternalCapabilityEffect;
}

export interface InternalEffectMachineState {
  remainingIterations: number | undefined;
}

export type InternalEffectMachineGenerator = Generator<
  InternalCapabilityEffectRequest,
  Trace,
  RuntimeCapabilityValue | undefined
>;

export type InternalEffectMachineChildSequenceRunner = (
  nodes: readonly IRNode[],
  env: SemanticEnv,
  state: InternalEffectMachineState,
) => InternalEffectMachineGenerator;

export class InternalEffectMachineError extends Error {
  readonly node: IRNode;

  constructor(message: string, node: IRNode, cause?: unknown) {
    super(message, { cause });
    this.name = 'InternalEffectMachineError';
    this.node = node;
  }
}

export function isUnifiedNodeType(type: string): type is UnifiedNodeType {
  return (
    Object.hasOwn(INTERNAL_EFFECT_MACHINE_DISPOSITION, type) &&
    INTERNAL_EFFECT_MACHINE_DISPOSITION[type as keyof typeof INTERNAL_EFFECT_MACHINE_DISPOSITION] === 'unified'
  );
}

export function hasNoBody(node: IRNode): boolean {
  return node.children === undefined || (Array.isArray(node.children) && node.children.length === 0);
}
