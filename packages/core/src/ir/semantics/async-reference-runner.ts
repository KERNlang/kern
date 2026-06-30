import {
  assertRuntimeCapabilityValue,
  invokeRunnerCapabilityAsync,
  type KernRunnerAsyncCapabilities,
  type RuntimeCapabilityValue,
} from '../../runner-capabilities.js';
import { ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES, CAPABILITY_DESCRIPTORS } from '../../runner-capability-plan.js';
import type { IRNode } from '../../types.js';
import { branchPreconditions, selectBranchPath } from './branch.js';
import { capabilityInput, isCapabilityToken } from './capability.js';
import { eachPreconditions, eachRuntimeSteps } from './each.js';
import { forPreconditions, forRuntimeRange } from './for.js';
import { evaluateIfCondition } from './if.js';
import { childEnv, defineBinding, defineIntBinding, hasOwnBinding, type SemanticEnv } from './index.js';
import { isPortableBindingName } from './portable-scalar.js';
import { ReferenceRunnerError, referenceRun } from './reference-runner.js';
import { emptyTrace, type Trace } from './trace.js';
import { evaluateWhileCondition, WHILE_MAX_ITERATIONS, whilePreconditions } from './while.js';

export interface AsyncReferenceRunnerOptions {
  readonly asyncCapabilities?: KernRunnerAsyncCapabilities;
}

/**
 * Narrow async preview runner.
 *
 * This intentionally mirrors the sync reference runner's sequence/if/capability
 * semantics only where async capability dispatch is needed. Keep capability
 * input/name validation and if-condition behavior synchronized with the sync
 * contracts until the contract registry grows first-class async effects.
 */
export async function asyncReferenceRun(
  node: IRNode,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<Trace> {
  if (node.type === '__block') {
    if (!Array.isArray(node.children)) {
      throw new ReferenceRunnerError('Fixture block requires a children array.', node);
    }
    return asyncReferenceRunSequence(node.children, env, options);
  }
  if (node.type === 'else') {
    throw new ReferenceRunnerError('`else` must immediately follow an `if` sibling.', node);
  }
  if (node.type === 'if') return asyncIfEffects(node, env, options);
  if (node.type === 'branch') return asyncBranchEffects(node, env, options);
  if (node.type === 'while') return asyncWhileEffects(node, env, options);
  if (node.type === 'for') return asyncForEffects(node, env, options);
  if (node.type === 'each') return asyncEachEffects(node, env, options);
  if (node.type === 'capability' && isAsyncPlannedCapabilityNode(node)) {
    return asyncCapabilityEffects(node, env, options);
  }
  if (containsAsyncPlannedCapability(node)) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${node.type}" is unsupported in this preview`,
      node,
    );
  }
  return referenceRun(node, env);
}

export async function asyncReferenceRunSequence(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<Trace> {
  const out: Trace = emptyTrace();
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    let nodeToRun = n;
    if (n.type === 'if' && nodes[i + 1]?.type === 'else') {
      nodeToRun = {
        ...n,
        props: {
          ...(n.props ?? {}),
          __pairedElse: nodes[i + 1],
        },
      };
      i += 1;
    } else if (n.type === 'else') {
      throw new ReferenceRunnerError('`else` must immediately follow an `if` sibling.', n);
    }
    const t = await asyncReferenceRun(nodeToRun, env, options);
    out.events.push(...t.events);
    if (t.completion.kind !== 'normal') {
      out.completion = t.completion;
      return out;
    }
  }
  return out;
}

async function asyncIfEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  let truthy: boolean;
  try {
    truthy = evaluateIfCondition(ir, env);
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const elseNode = ir.props?.__pairedElse;
  const selectedChildren = truthy ? (ir.children ?? []) : isElseNode(elseNode) ? (elseNode.children ?? []) : [];
  const unsupported = unsupportedAsyncContainerInSequence(selectedChildren);
  if (unsupported) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${unsupported.type}" is unsupported in this preview`,
      unsupported,
    );
  }
  if (selectedChildren.length > 0) return asyncReferenceRunSequence(selectedChildren, env, options);
  return emptyTrace();
}

async function asyncBranchEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  if (!branchPreconditions(ir, env)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const selected = selectBranchPath(ir, env);
  if (!selected) return emptyTrace();
  const unsupported = unsupportedAsyncContainer(selected);
  if (unsupported) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${unsupported.type}" is unsupported in this preview`,
      unsupported,
    );
  }
  return asyncReferenceRunSequence(selected.children ?? [], childEnv(env), options);
}

async function asyncWhileEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  if (!whilePreconditions(ir, env)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const unsupported = unsupportedAsyncContainer(ir);
  if (unsupported) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${unsupported.type}" is unsupported in this preview`,
      unsupported,
    );
  }
  const out: Trace = emptyTrace();
  const children = ir.children ?? [];
  let iterations = 0;
  let condition = evaluateInitialAsyncWhileCondition(ir, env);

  while (condition) {
    if (iterations >= WHILE_MAX_ITERATIONS) {
      throw new Error(`while: exceeded ${WHILE_MAX_ITERATIONS} iterations — non-terminating fixture`);
    }
    iterations += 1;

    const childTrace = await asyncReferenceRunSequence(children, childEnv(env), options);
    out.events.push(...childTrace.events);

    const c = childTrace.completion;
    if (c.kind === 'break') break;
    if (c.kind === 'return' || c.kind === 'throw') {
      out.completion = c;
      return out;
    }
    condition = evaluateWhileCondition(ir, env);
    if (c.kind === 'continue') continue;
  }

  return out;
}

async function asyncForEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  if (!forPreconditions(ir, env)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const unsupported = unsupportedAsyncContainer(ir);
  if (unsupported) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${unsupported.type}" is unsupported in this preview`,
      unsupported,
    );
  }
  const { name, from, to, step, children } = forRuntimeRange(ir, env);
  const out: Trace = emptyTrace();

  for (let i = from; step > 0 ? i < to : i > to; i += step) {
    out.events.push({ op: 'iter-next', binding: name, value: i });

    const iterEnv = childEnv(env);
    defineIntBinding(iterEnv, name, i);

    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);
    out.events.push(...childTrace.events);

    const c = childTrace.completion;
    if (c.kind === 'break') break;
    if (c.kind === 'continue') continue;
    if (c.kind === 'return' || c.kind === 'throw') {
      out.completion = c;
      return out;
    }
  }

  return out;
}

function evaluateInitialAsyncWhileCondition(ir: IRNode, env: SemanticEnv): boolean {
  try {
    return evaluateWhileCondition(ir, env);
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
}

async function asyncEachEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  if (!eachPreconditions(ir, env)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const unsupported = unsupportedAsyncContainer(ir);
  if (unsupported) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${unsupported.type}" is unsupported in this preview`,
      unsupported,
    );
  }
  const out: Trace = emptyTrace();
  const children = ir.children ?? [];

  for (const step of eachRuntimeSteps(ir, env)) {
    out.events.push({ op: 'iter-next', binding: step.primary[0], value: step.primary[1] });

    const iterEnv = childEnv(env);
    for (const [k, v] of step.bindings) defineBinding(iterEnv, k, v);

    const childTrace = await asyncReferenceRunSequence(children, iterEnv, options);
    out.events.push(...childTrace.events);

    const c = childTrace.completion;
    if (c.kind === 'break') break;
    if (c.kind === 'continue') continue;
    if (c.kind === 'return' || c.kind === 'throw') {
      out.completion = c;
      return out;
    }
  }

  return out;
}

async function asyncCapabilityEffects(
  ir: IRNode,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<Trace> {
  const props = ir.props ?? {};
  const namespace = props.namespace;
  const operation = props.operation;
  if (!isCapabilityToken(namespace) || !isCapabilityToken(operation)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const name = props.name;
  if (name !== undefined && name !== '') {
    if (typeof name !== 'string' || !isPortableBindingName(name) || hasOwnBinding(env, name)) {
      throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
    }
  }

  let input: RuntimeCapabilityValue | undefined;
  try {
    input = capabilityInput(ir, env);
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const rawResult = await invokeRunnerCapabilityAsync(
    options.asyncCapabilities,
    { namespace, operation, input },
    env.capabilityContext,
  );
  const result =
    rawResult === undefined
      ? undefined
      : assertRuntimeCapabilityValue(rawResult, `async capability ${namespace}.${operation} result`);
  const events: Trace['events'] = [{ op: 'capability', namespace, operation, input, result }];
  if (name !== undefined && name !== '') {
    if (result === undefined) {
      throw new ReferenceRunnerError(
        `capability: ${namespace}.${operation} returned no value for name=${String(name)}`,
        ir,
      );
    }
    defineBinding(env, name, result);
    events.push({ op: 'assign', target: name, value: result });
  }
  return { events, completion: { kind: 'normal' } };
}

function containsAsyncPlannedCapability(root: IRNode): boolean {
  for (const node of walkNodes(root)) {
    if (node.type === 'capability' && isAsyncPlannedCapabilityNode(node)) return true;
  }
  return false;
}

function unsupportedAsyncContainer(root: IRNode): IRNode | undefined {
  for (const node of walkNodesForUnsupportedAsync(root)) {
    if (node === root || node.type === 'if' || node.type === 'branch') continue;
    if (ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES.has(node.type) && containsAsyncPlannedCapability(node)) return node;
  }
  return undefined;
}

function unsupportedAsyncContainerInSequence(nodes: readonly IRNode[]): IRNode | undefined {
  return unsupportedAsyncContainer({ type: '__block', children: [...nodes] });
}

function isAsyncPlannedCapabilityNode(node: IRNode): boolean {
  const namespace = node.props?.namespace;
  const operation = node.props?.operation;
  if (typeof namespace !== 'string' || typeof operation !== 'string') return false;
  return (
    CAPABILITY_DESCRIPTORS[`${namespace}.${operation}` as keyof typeof CAPABILITY_DESCRIPTORS]?.syncBoundary ===
    'async-planned'
  );
}

function isElseNode(value: unknown): value is IRNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as IRNode).type === 'else';
}

function* walkNodes(root: IRNode): Generator<IRNode> {
  const stack: IRNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    yield node;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
    const pairedElse = node.props?.__pairedElse;
    if (isElseNode(pairedElse)) stack.push(pairedElse);
  }
}

function* walkNodesForUnsupportedAsync(root: IRNode): Generator<IRNode> {
  const stack: IRNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    yield node;
    if (node !== root && (node.type === 'branch' || node.type === 'if' || node.type === 'else')) continue;
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
    const pairedElse = node.props?.__pairedElse;
    if (isElseNode(pairedElse)) stack.push(pairedElse);
  }
}
