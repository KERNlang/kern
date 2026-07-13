import type { KernRunnerAsyncCapabilities, RuntimeCapabilityValue } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';
import {
  type PreparedInternalCapabilityEffect,
  prepareInternalCapabilityEffect,
  resumeInternalCapabilityEffect,
} from './capability.js';
import { isAsyncPlannedCapability } from './capability-lane.js';
import { evaluateIfCondition } from './if.js';
import { CONTRACT_REGISTRY, type SemanticEnv } from './index.js';
import {
  invokeInternalRuntimeCapabilityAsync,
  invokeInternalRuntimeCapabilitySync,
  invokeInternalRuntimeSyncCapabilityAsync,
} from './internal-capability-interceptor.js';
import { emptyTrace, type Trace } from './trace.js';

export const INTERNAL_EFFECT_MACHINE_FORMAT = 'kern.runtime.effect-machine.internal.r0' as const;

export const INTERNAL_EFFECT_MACHINE_DISPOSITION = Object.freeze({
  assign: 'unified',
  branch: 'legacy',
  capability: 'unified',
  do: 'legacy',
  each: 'legacy',
  'expression-v1': 'legacy',
  fmt: 'unified',
  for: 'legacy',
  if: 'unified',
  lambda: 'legacy',
  let: 'unified',
  print: 'unified',
  return: 'unified',
  throw: 'unified',
  try: 'legacy',
  while: 'legacy',
} as const);

type UnifiedNodeType = {
  [K in keyof typeof INTERNAL_EFFECT_MACHINE_DISPOSITION]: (typeof INTERNAL_EFFECT_MACHINE_DISPOSITION)[K] extends 'unified'
    ? K
    : never;
}[keyof typeof INTERNAL_EFFECT_MACHINE_DISPOSITION];

export interface InternalEffectMachineAsyncOptions {
  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;
  readonly capabilityTimeoutMs?: number;
}

interface InternalCapabilityEffectRequest {
  readonly format: typeof INTERNAL_EFFECT_MACHINE_FORMAT;
  readonly kind: 'capability';
  readonly prepared: PreparedInternalCapabilityEffect;
}

export class InternalEffectMachineError extends Error {
  readonly node: IRNode;

  constructor(message: string, node: IRNode) {
    super(message);
    this.name = 'InternalEffectMachineError';
    this.node = node;
  }
}

function isUnifiedNodeType(type: string): type is UnifiedNodeType {
  return (
    Object.hasOwn(INTERNAL_EFFECT_MACHINE_DISPOSITION, type) &&
    INTERNAL_EFFECT_MACHINE_DISPOSITION[type as keyof typeof INTERNAL_EFFECT_MACHINE_DISPOSITION] === 'unified'
  );
}

function hasNoBody(node: IRNode): boolean {
  return node.children === undefined || (Array.isArray(node.children) && node.children.length === 0);
}

function hasBoundedRootEnvironment(env: SemanticEnv): boolean {
  return (
    env.parent === undefined &&
    (env.runnerFunctions === undefined || env.runnerFunctions.size === 0) &&
    (env.runnerClasses === undefined || env.runnerClasses.size === 0) &&
    env.runnerThis === undefined
  );
}

export function isInternalEffectMachineEligible(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  return hasBoundedRootEnvironment(env) && rootSequenceClaimsMachine(nodes);
}

function rootSequenceClaimsMachine(nodes: readonly IRNode[]): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === 'if') {
      if (nodes[index + 1]?.type === 'else') index += 1;
      continue;
    }
    if (node.type === 'else' || !isUnifiedNodeType(node.type) || !hasNoBody(node)) return false;
  }
  return true;
}

function runRegisteredNode(node: IRNode, env: SemanticEnv): Trace {
  const contract = CONTRACT_REGISTRY.get(node.type);
  if (!contract?.preconditions(node, env)) {
    throw new InternalEffectMachineError(`effect machine rejected node type "${node.type}"`, node);
  }
  return contract.effects(node, env);
}

function prepareCapability(node: IRNode, env: SemanticEnv): PreparedInternalCapabilityEffect {
  try {
    return prepareInternalCapabilityEffect(node, env);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected capability node', node);
  }
}

function appendTrace(out: Trace, next: Trace): boolean {
  out.events.push(...next.events);
  if (next.completion.kind === 'normal') return false;
  out.completion = next.completion;
  return true;
}

function* runIf(
  node: IRNode,
  elseNode: IRNode | undefined,
  env: SemanticEnv,
): Generator<InternalCapabilityEffectRequest, Trace, RuntimeCapabilityValue | undefined> {
  let selected: readonly IRNode[];
  try {
    selected = evaluateIfCondition(node, env) ? (node.children ?? []) : (elseNode?.children ?? []);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected if node', node);
  }
  return yield* runSequence(selected, env);
}

function* runSequence(
  nodes: readonly IRNode[],
  env: SemanticEnv,
): Generator<InternalCapabilityEffectRequest, Trace, RuntimeCapabilityValue | undefined> {
  const out = emptyTrace();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    let elseNode: IRNode | undefined;
    if (node.type === 'if') {
      elseNode = nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
      if (elseNode) index += 1;
    } else if (node.type === 'else') {
      throw new InternalEffectMachineError('else must immediately follow an if sibling', node);
    }
    let next: Trace;
    if (node.type === 'if') {
      next = yield* runIf(node, elseNode, env);
    } else if (!isUnifiedNodeType(node.type) || !hasNoBody(node)) {
      throw new InternalEffectMachineError(`effect machine rejected nested node type "${node.type}"`, node);
    } else if (node.type === 'capability') {
      const prepared = prepareCapability(node, env);
      const result = yield Object.freeze({
        format: INTERNAL_EFFECT_MACHINE_FORMAT,
        kind: 'capability',
        prepared,
      });
      next = resumeInternalCapabilityEffect(prepared, result, env);
    } else {
      next = runRegisteredNode(node, env);
    }
    if (appendTrace(out, next)) return out;
  }
  return out;
}

function* runMachine(
  nodes: readonly IRNode[],
  env: SemanticEnv,
): Generator<InternalCapabilityEffectRequest, Trace, RuntimeCapabilityValue | undefined> {
  if (!isInternalEffectMachineEligible(nodes, env)) {
    throw new InternalEffectMachineError(
      'input is outside the internal effect-machine corpus',
      nodes[0] ?? { type: '__block' },
    );
  }
  return yield* runSequence(nodes, env);
}

export function runInternalEffectMachineSync(nodes: readonly IRNode[], env: SemanticEnv): Trace {
  const machine = runMachine(nodes, env);
  let step = machine.next();
  while (!step.done) {
    const result = invokeInternalRuntimeCapabilitySync(env, step.value.prepared.call);
    step = machine.next(result);
  }
  return step.value;
}

export async function runInternalEffectMachineAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalEffectMachineAsyncOptions = {},
): Promise<Trace> {
  const machine = runMachine(nodes, env);
  let step = machine.next();
  while (!step.done) {
    const call = step.value.prepared.call;
    const result = isAsyncPlannedCapability(call.namespace, call.operation)
      ? await invokeInternalRuntimeCapabilityAsync(env, options.asyncCapabilities, call, {
          timeoutMs: options.capabilityTimeoutMs,
        })
      : await invokeInternalRuntimeSyncCapabilityAsync(env, call);
    step = machine.next(result);
  }
  return step.value;
}
