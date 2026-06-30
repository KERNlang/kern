import { parseExpression } from '../../parser-expression.js';
import {
  assertRuntimeCapabilityValue,
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  type KernRunnerAsyncCapabilities,
  type RuntimeCapabilityValue,
} from '../../runner-capabilities.js';
import { ASYNC_SOURCE_UNSUPPORTED_CONTAINER_TYPES, CAPABILITY_DESCRIPTORS } from '../../runner-capability-plan.js';
import type { IRNode } from '../../types.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';
import { evalPortableValueAsync } from './async-portable-scalar.js';
import { branchPreconditions, selectBranchPath } from './branch.js';
import { isCapabilityToken } from './capability.js';
import { eachPreconditions, eachRuntimeSteps } from './each.js';
import { forPreconditions, forRuntimeRange } from './for.js';
import {
  assignBinding,
  childEnv,
  defineBinding,
  defineIntBinding,
  getBinding,
  hasBinding,
  hasOwnBinding,
  type SemanticEnv,
} from './index.js';
import { isArrayLiteralExpression } from './portable-array.js';
import { makeCaughtErrorValue } from './portable-error.js';
import {
  assertPortableScalar,
  isPortableBindingName,
  isRecordLiteralExpression,
  type PortableScalar,
  portableTruthy,
} from './portable-scalar.js';
import { ReferenceRunnerError, referenceRun } from './reference-runner.js';
import { type CompletionRecord, emptyTrace, type Trace } from './trace.js';
import { tryPreconditions, tryRuntimeParts, UNAVAILABLE_CAUGHT_ERROR } from './try.js';
import { WHILE_MAX_ITERATIONS } from './while.js';

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
  if (node.type === 'let') return asyncLetEffects(node, env, options);
  if (node.type === 'assign') return asyncAssignEffects(node, env, options);
  if (node.type === 'fmt') return asyncFmtEffects(node, env, options);
  if (node.type === 'print') return asyncPrintEffects(node, env, options);
  if (node.type === 'return') return asyncReturnEffects(node, env, options);
  if (node.type === 'if') return asyncIfEffects(node, env, options);
  if (node.type === 'branch') return asyncBranchEffects(node, env, options);
  if (node.type === 'try') return asyncTryEffects(node, env, options);
  if (node.type === 'while') return asyncWhileEffects(node, env, options);
  if (node.type === 'for') return asyncForEffects(node, env, options);
  if (node.type === 'each') return asyncEachEffects(node, env, options);
  if (node.type === 'capability' && isAsyncPlannedCapabilityNode(node)) {
    return asyncCapabilityEffects(node, env, options);
  }
  if (node.type === 'capability') return asyncSyncCapabilityEffects(node, env, options);
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

async function asyncLetEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  const props = ir.props ?? {};
  const name = props.name;
  if (!isPortableBindingName(name) || hasOwnBinding(env, name)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  if (!Object.hasOwn(props, 'value') || props.value === '') {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  if (props.kind !== undefined && props.kind !== '' && props.kind !== 'let' && props.kind !== 'const') {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }

  let value: unknown;
  try {
    const parsed = parseExpression(String(props.value));
    value = isArrayLiteralExpression(parsed)
      ? await evalArrayLiteralValueAsync(parsed, env, options)
      : isRecordLiteralExpression(parsed)
        ? await evalRecordLiteralValueAsync(parsed, env, options)
        : await evalPortableValueForAsyncRunner(parsed, env, options);
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  defineBinding(env, name, value);
  return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
}

async function asyncAssignEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  const props = ir.props ?? {};
  const target = props.target;
  if (
    !isPortableBindingName(target) ||
    !hasBinding(env, target) ||
    !Object.hasOwn(props, 'value') ||
    props.value === ''
  ) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const op = props.op === undefined || props.op === '' ? '=' : props.op;
  if (op !== '=' && op !== '+=') {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const current = getBinding(env, target);
  if (typeof current !== 'number' && typeof current !== 'string' && typeof current !== 'boolean') {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }

  let rhs: PortableScalar;
  try {
    rhs = await evalPortableValueForAsyncRunner(parseExpression(String(props.value)), env, options);
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }

  let value: PortableScalar;
  if (op === '=') {
    if (typeof rhs !== typeof current) {
      throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
    }
    value = rhs;
  } else if (typeof current === 'number' && typeof rhs === 'number') {
    value = current + rhs;
    if (!Number.isFinite(value)) throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  } else if (typeof current === 'string' && typeof rhs === 'string') {
    value = current + rhs;
  } else {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }

  assignBinding(env, target, value);
  return { events: [{ op: 'assign', target, value }], completion: { kind: 'normal' } };
}

async function asyncFmtEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  const props = ir.props ?? {};
  const name = props.name;
  if (props.return === true || props.return === 'true' || !isPortableBindingName(name) || hasOwnBinding(env, name)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  if (typeof props.template !== 'string') {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }

  let value = '';
  try {
    const node = parseExpression(`\`${props.template}\``);
    if (node.kind !== 'tmplLit') throw new Error('fmt: template did not parse as a template literal');
    for (let i = 0; i < node.quasis.length; i += 1) {
      if (node.quasis[i].includes('\\')) throw new Error('fmt: escape sequences are outside this contract');
      value += node.quasis[i];
      if (i < node.expressions.length) {
        value += canonicalFmt(await evalPortableValueForAsyncRunner(node.expressions[i], env, options));
      }
    }
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }

  defineBinding(env, name, value);
  return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
}

async function asyncPrintEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  const raw = ir.props?.value;
  if (typeof raw !== 'string') throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  let text: string;
  try {
    text = printText(await evalPortableValueForAsyncRunner(parseExpression(raw), env, options));
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  return { events: [{ op: 'stdout', text }], completion: { kind: 'normal' } };
}

async function asyncReturnEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  const value = ir.props?.value;
  if (typeof value !== 'string') return { events: [], completion: { kind: 'return', value } };
  try {
    return {
      events: [],
      completion: {
        kind: 'return',
        value: await evalPortableValueForAsyncRunner(parseExpression(value), env, options),
      },
    };
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
}

async function asyncIfEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  let truthy: boolean;
  try {
    truthy = await evaluateIfConditionAsync(ir, env, options);
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

async function asyncTryEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  if (!tryPreconditions(ir, env)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const unsupported = unsupportedAsyncContainer(ir);
  if (unsupported) {
    throw new ReferenceRunnerError(
      `async source execution for node type "${unsupported.type}" is unsupported in this preview`,
      unsupported,
    );
  }

  const { body, catchNode, finallyNode } = tryRuntimeParts(ir.children ?? []);
  const out: Trace = emptyTrace();

  const bodyTrace = await asyncReferenceRunSequence(body, env, options);
  out.events.push(...bodyTrace.events);
  let completion: CompletionRecord = bodyTrace.completion;

  if (completion.kind === 'return' && catchNode) {
    throw new ReferenceRunnerError('try: body return with catch is outside the portable domain', ir);
  }

  if (completion.kind === 'throw' && catchNode) {
    const caught = catchNode.props?.name;
    const hasBinding = typeof caught === 'string' && caught !== '';
    if (hasBinding) {
      const caughtValue = completion.error ? makeCaughtErrorValue(completion.error) : null;
      defineBinding(env, caught, caughtValue ?? UNAVAILABLE_CAUGHT_ERROR);
    }
    let catchTrace: Trace;
    try {
      catchTrace = await asyncReferenceRunSequence(catchNode.children ?? [], env, options);
    } finally {
      if (hasBinding) defineBinding(env, caught, UNAVAILABLE_CAUGHT_ERROR);
    }
    out.events.push(...catchTrace.events);
    completion = catchTrace.completion;
  }

  if (finallyNode) {
    const finallyTrace = await asyncReferenceRunSequence(finallyNode.children ?? [], env, options);
    out.events.push(...finallyTrace.events);
    if (finallyTrace.completion.kind !== 'normal') {
      throw new ReferenceRunnerError('try: finally must complete normally (cleanup-only this slice)', finallyNode);
    }
  }

  out.completion = completion;
  return out;
}

async function asyncWhileEffects(ir: IRNode, env: SemanticEnv, options: AsyncReferenceRunnerOptions): Promise<Trace> {
  if (!Array.isArray(ir.children)) {
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
  let condition = await evaluateInitialAsyncWhileCondition(ir, env, options);

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
    if (c.kind === 'continue') {
      condition = await evaluateWhileConditionAsync(ir, env, options);
      continue;
    }
    condition = await evaluateWhileConditionAsync(ir, env, options);
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

async function evaluateInitialAsyncWhileCondition(
  ir: IRNode,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<boolean> {
  try {
    return await evaluateWhileConditionAsync(ir, env, options);
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
    input = await capabilityInputAsync(ir, env, options);
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

async function asyncSyncCapabilityEffects(
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
    input = await capabilityInputAsync(ir, env, options);
  } catch {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${ir.type}".`, ir);
  }
  const result = invokeRunnerCapability(env.capabilities, { namespace, operation, input }, env.capabilityContext);
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

function asyncEvalOptions(options: AsyncReferenceRunnerOptions) {
  return {
    runFunctionBody: (body: readonly IRNode[], env: SemanticEnv) => asyncReferenceRunSequence(body, env, options),
  };
}

function evalPortableValueForAsyncRunner(
  node: ValueIR,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<PortableScalar> {
  return evalPortableValueAsync(node, env, asyncEvalOptions(options));
}

async function evalArrayLiteralValueAsync(
  node: Extract<ValueIR, { kind: 'arrayLit' }>,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<readonly unknown[]> {
  const out: unknown[] = [];
  for (let index = 0; index < node.items.length; index += 1) {
    if (!(index in node.items)) throw new Error('array: sparse arrays are outside the portable domain');
    const item = node.items[index];
    out.push(
      isArrayLiteralExpression(item)
        ? await evalArrayLiteralValueAsync(item, env, options)
        : await evalPortableValueForAsyncRunner(item, env, options),
    );
  }
  return Object.freeze(out);
}

async function evalRecordLiteralValueAsync(
  node: Extract<ValueIR, { kind: 'objectLit' }>,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<Readonly<Record<string, PortableScalar>>> {
  const out: Record<string, PortableScalar> = Object.create(null);
  for (const entry of node.entries) {
    if ('kind' in entry) throw new Error('portable-record: object spreads are outside the portable record domain');
    if ('rawKey' in entry && entry.rawKey !== undefined) {
      throw new Error('portable-record: numeric record keys are outside the portable record domain');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
      throw new Error('portable-record: record keys must be identifier-like strings');
    }
    if (['__proto__', 'prototype', 'constructor'].includes(entry.key)) {
      throw new Error(`portable-record: reserved key "${entry.key}" is outside the portable record domain`);
    }
    if (Object.hasOwn(out, entry.key)) {
      throw new Error(`portable-record: duplicate key "${entry.key}" is outside the portable record domain`);
    }
    out[entry.key] = await evalPortableValueForAsyncRunner(entry.value, env, options);
  }
  return Object.freeze(out);
}

async function capabilityInputAsync(
  ir: IRNode,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<RuntimeCapabilityValue | undefined> {
  if (!Object.hasOwn(ir.props ?? {}, 'input')) return undefined;
  const raw = ir.props?.input;
  if (typeof raw !== 'string') return assertRuntimeCapabilityValue(raw, 'capability input');
  const parsed = parseExpression(raw);
  if (isArrayLiteralExpression(parsed)) {
    return assertRuntimeCapabilityValue(await evalCapabilityInputArrayAsync(parsed, env, options), 'capability input');
  }
  if (isRecordLiteralExpression(parsed)) {
    return assertRuntimeCapabilityValue(await evalCapabilityInputRecordAsync(parsed, env, options), 'capability input');
  }
  if (parsed.kind === 'ident')
    return assertRuntimeCapabilityValue(capabilityInputBinding(parsed.name, env), 'capability input');
  if (!isValueIR(parsed)) throw new Error('capability: input must be a portable value expression');
  return assertRuntimeCapabilityValue(await evalPortableValueForAsyncRunner(parsed, env, options), 'capability input');
}

async function evalCapabilityInputValueAsync(
  node: ValueIR,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<unknown> {
  if (isRecordLiteralExpression(node)) return evalCapabilityInputRecordAsync(node, env, options);
  if (isArrayLiteralExpression(node)) return evalCapabilityInputArrayAsync(node, env, options);
  if (node.kind === 'ident') return capabilityInputBinding(node.name, env);
  return evalPortableValueForAsyncRunner(node, env, options);
}

async function evalCapabilityInputRecordAsync(
  node: Extract<ValueIR, { kind: 'objectLit' }>,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<RuntimeCapabilityValue> {
  const out: Record<string, RuntimeCapabilityValue> = Object.create(null);
  for (const entry of node.entries) {
    if ('kind' in entry)
      throw new Error('capability input: object spreads are outside the portable capability input domain');
    if ('rawKey' in entry && entry.rawKey !== undefined) {
      throw new Error('capability input: numeric record keys are outside the portable capability input domain');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
      throw new Error('capability input: record keys must be identifier-like strings');
    }
    if (['__proto__', 'prototype', 'constructor'].includes(entry.key)) {
      throw new Error(`capability input: reserved key "${entry.key}" is outside the portable capability input domain`);
    }
    if (Object.hasOwn(out, entry.key)) {
      throw new Error(`capability input: duplicate key "${entry.key}" is outside the portable capability input domain`);
    }
    out[entry.key] = assertRuntimeCapabilityValue(
      await evalCapabilityInputValueAsync(entry.value, env, options),
      'capability input',
    );
  }
  return Object.freeze(out);
}

async function evalCapabilityInputArrayAsync(
  node: Extract<ValueIR, { kind: 'arrayLit' }>,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<readonly RuntimeCapabilityValue[]> {
  const out: RuntimeCapabilityValue[] = [];
  for (let index = 0; index < node.items.length; index += 1) {
    if (!(index in node.items)) throw new Error('capability input: array literal items must not contain sparse holes');
    out.push(
      assertRuntimeCapabilityValue(
        await evalCapabilityInputValueAsync(node.items[index], env, options),
        'capability input',
      ),
    );
  }
  return Object.freeze(out);
}

function capabilityInputBinding(name: string, env: SemanticEnv): unknown {
  if (!isPortableBindingName(name)) {
    throw new Error(`capability input: binding "${name}" is outside the portable capability input domain`);
  }
  if (!hasBinding(env, name)) throw new Error(`capability input: binding "${name}" not found`);
  return getBinding(env, name);
}

async function evaluateIfConditionAsync(
  ir: IRNode,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<boolean> {
  const cond = ir.props?.cond;
  if (typeof cond !== 'string' || cond.trim().length === 0) {
    throw new Error('if: cond= must be a non-empty string expression');
  }
  return portableTruthy(await conditionValueAsync(cond, env, options));
}

async function conditionValueAsync(
  cond: string,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<PortableScalar> {
  const trimmed = cond.trim();
  if (trimmed === 'true' || trimmed === 'True') return true;
  if (trimmed === 'false' || trimmed === 'False') return false;
  if (trimmed === 'null' || trimmed === 'undefined' || trimmed === 'None') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return parseStringLiteral(trimmed);
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    if (!hasBinding(env, trimmed)) throw new Error(`if: binding "${trimmed}" not found in env`);
    return assertPortableScalar(getBinding(env, trimmed), `binding "${trimmed}"`);
  }
  if (trimmed.startsWith('!')) return !portableTruthy(await conditionValueAsync(trimmed.slice(1), env, options));
  return evalPortableValueForAsyncRunner(parseExpression(trimmed), env, options);
}

async function evaluateWhileConditionAsync(
  ir: IRNode,
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<boolean> {
  const cond = ir.props?.cond;
  if (typeof cond !== 'string' || cond === '') {
    throw new Error('while: cond= must be a non-empty string expression');
  }
  const value = await evalPortableValueForAsyncRunner(parseExpression(cond), env, options);
  if (typeof value !== 'boolean') {
    throw new Error('while: condition must evaluate to a strict boolean (no truthy/numeric/string conditions)');
  }
  return value;
}

function parseStringLiteral(text: string): string {
  if (text.startsWith('"')) return JSON.parse(text) as string;
  const inner = text.slice(1, -1);
  return inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function printText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('print: value must be a portable scalar (null, boolean, string, or safe integer)');
}

function canonicalFmt(value: PortableScalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (!Number.isInteger(value)) throw new Error('fmt: only finite integers are portable in interpolation');
  return String(value);
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
