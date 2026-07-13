import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerClassMemberBinding,
  type RunnerFunctionBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from './index.js';
import { runPortableReferenceBody } from './portable-reference-host.js';
import { assertPortableScalar, isRunnerClassInstanceValue, type PortableScalar } from './portable-scalar-domain.js';
import type { Trace } from './trace.js';

export type EvalRunnerClassArgument = (node: ValueIR, env: SemanticEnv) => unknown;

export type AsyncReferenceBodyRunner = (body: readonly IRNode[], env: SemanticEnv) => Promise<Trace>;

export function runnerClassesForEnv(env: SemanticEnv): Map<string, RunnerClassBinding> | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerClasses) return cur.runnerClasses;
  }
  return undefined;
}

export function runnerFunctionsForEnv(env: SemanticEnv): Map<string, RunnerFunctionBinding> | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerFunctions) return cur.runnerFunctions;
  }
  return undefined;
}

export function runnerCallStackForEnv(env: SemanticEnv): readonly string[] {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerCallStack) return cur.runnerCallStack;
  }
  return [];
}

/** Resolve functions and classes in the defining module while preserving runtime state. */
export function withModuleScope(env: SemanticEnv, scope: RunnerModuleScope | undefined): SemanticEnv {
  if (!scope) return env;
  if (env.runnerFunctions === scope.functions && env.runnerClasses === scope.classes) return env;
  return { ...env, runnerFunctions: scope.functions, runnerClasses: scope.classes };
}

export function initializeRunnerClassInstance(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
  evalArgument: EvalRunnerClassArgument,
): void {
  const classes = runnerClassesForEnv(env);
  if (cls.extendsName) {
    const base = classes?.get(cls.extendsName);
    if (!base) throw new Error(`runner-class: unknown base class "${cls.extendsName}"`);
    const explicitSuperArgs = explicitSuperCallArgs(
      cls.constructor?.body ?? [],
      env,
      args,
      cls.constructor?.params ?? [],
      evalArgument,
    );
    initializeRunnerClassInstance(base, instance, explicitSuperArgs ?? [], env, evalArgument);
  }
  for (const field of cls.fields) {
    if (Object.hasOwn(instance.fields, field.name)) continue;
    instance.fields[field.name] =
      typeof field.value === 'string' && field.value !== ''
        ? evalArgument(parseExpression(field.value), env)
        : undefined;
  }
  if (!cls.constructor) return;
  const body = cls.extendsName
    ? cls.constructor.body.filter((child) => !isExplicitSuperCallNode(child))
    : cls.constructor.body;
  runRunnerClassBody(cls.constructor, instance, args, body, env, false);
}

export async function initializeRunnerClassInstanceAsync(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
  runBody: AsyncReferenceBodyRunner,
  evalArgument: EvalRunnerClassArgument,
): Promise<void> {
  const classes = runnerClassesForEnv(env);
  if (cls.extendsName) {
    const base = classes?.get(cls.extendsName);
    if (!base) throw new Error(`runner-class: unknown base class "${cls.extendsName}"`);
    const explicitSuperArgs = explicitSuperCallArgs(
      cls.constructor?.body ?? [],
      env,
      args,
      cls.constructor?.params ?? [],
      evalArgument,
    );
    await initializeRunnerClassInstanceAsync(base, instance, explicitSuperArgs ?? [], env, runBody, evalArgument);
  }
  for (const field of cls.fields) {
    if (Object.hasOwn(instance.fields, field.name)) continue;
    instance.fields[field.name] =
      typeof field.value === 'string' && field.value !== ''
        ? evalArgument(parseExpression(field.value), env)
        : undefined;
  }
  if (!cls.constructor) return;
  const body = cls.extendsName
    ? cls.constructor.body.filter((child) => !isExplicitSuperCallNode(child))
    : cls.constructor.body;
  await runRunnerClassBodyAsync(cls.constructor, instance, args, body, env, false, runBody);
}

function explicitSuperCallArgs(
  body: readonly { type: string; props?: Record<string, unknown> }[],
  outerEnv: SemanticEnv,
  args: readonly unknown[],
  params: readonly string[],
  evalArgument: EvalRunnerClassArgument,
): readonly unknown[] | undefined {
  const superNode = body.find(isExplicitSuperCallNode);
  if (!superNode || typeof superNode.props?.value !== 'string') return undefined;
  const parsed = parseExpression(superNode.props.value);
  if (parsed.kind !== 'call' || parsed.callee.kind !== 'ident' || parsed.callee.name !== 'super') return undefined;
  const bindings = new Map<string, unknown>();
  for (let index = 0; index < params.length; index += 1) bindings.set(params[index], args[index]);
  const env = makeEnv({
    bindings,
    runnerFunctions: runnerFunctionsForEnv(outerEnv),
    runnerClasses: runnerClassesForEnv(outerEnv),
    runnerCallStack: outerEnv.runnerCallStack,
    runnerCallCache: outerEnv.runnerCallCache,
    capabilities: outerEnv.capabilities,
    capabilityContext: outerEnv.capabilityContext,
    seed: outerEnv.seed,
    now: outerEnv.now,
  });
  return parsed.args.map((arg) => evalArgument(arg, env));
}

function isExplicitSuperCallNode(node: { type: string; props?: Record<string, unknown> }): boolean {
  return node.type === 'do' && typeof node.props?.value === 'string' && node.props.value.trim().startsWith('super(');
}

export function findRunnerClassMember(
  className: string,
  name: string,
  kind: 'method' | 'getter',
  env: SemanticEnv,
): RunnerClassMemberBinding | undefined {
  return findRunnerClassMemberFrom(className, name, kind, env);
}

export function findRunnerClassMemberFrom(
  className: string,
  name: string,
  kind: 'method' | 'getter',
  env: SemanticEnv,
): RunnerClassMemberBinding | undefined {
  const classes = runnerClassesForEnv(env);
  for (let current: string | undefined = className; current; ) {
    const cls: RunnerClassBinding | undefined = classes?.get(current);
    if (!cls) return undefined;
    const member = kind === 'method' ? cls.methods.get(name) : cls.getters.get(name);
    if (member) return member;
    current = cls.extendsName;
  }
  return undefined;
}

export function invokeRunnerClassMember(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
): PortableScalar {
  return runRunnerClassBody(member, receiver, args, member.body, env, true);
}

function runRunnerClassBody(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  body: readonly IRNode[],
  env: SemanticEnv,
  requireReturn: boolean,
): PortableScalar {
  if (args.length !== member.params.length) {
    throw new Error(
      `runner-class: member "${member.name}" expects ${member.params.length} arguments, got ${args.length}`,
    );
  }
  const callStack = runnerCallStackForEnv(env);
  const label = `${member.ownerClass}.${member.name}`;
  if (callStack.includes(label)) throw new Error(`runner-class: recursive member call "${label}" is unsupported`);
  const bindings = new Map<string, unknown>([['this', receiver]]);
  for (let index = 0; index < member.params.length; index += 1) bindings.set(member.params[index], args[index]);
  const callEnv = makeEnv({
    bindings,
    runnerFunctions: runnerFunctionsForEnv(env),
    runnerClasses: runnerClassesForEnv(env),
    runnerCallStack: [...callStack, label],
    runnerCallCache: env.runnerCallCache,
    runnerThis: receiver,
    runnerSuperClass: runnerClassesForEnv(env)?.get(member.ownerClass)?.extendsName,
    capabilities: env.capabilities,
    capabilityContext: env.capabilityContext,
    seed: env.seed,
    now: env.now,
  });
  callEnv.bindings.set('this', receiver);
  callEnv.runnerThis = receiver;
  const fieldSnapshot = requireReturn ? cloneRunnerClassFields(receiver.fields) : undefined;
  if (runnerClassBodyHasCapability(body)) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  let trace: ReturnType<typeof runPortableReferenceBody>;
  try {
    trace = runPortableReferenceBody(body, callEnv);
  } catch (error) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw error;
  }
  return finishRunnerClassBody(trace, receiver, fieldSnapshot, label, requireReturn);
}

export async function runRunnerClassBodyAsync(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  body: readonly IRNode[],
  env: SemanticEnv,
  requireReturn: boolean,
  runBody: AsyncReferenceBodyRunner,
): Promise<PortableScalar> {
  if (args.length !== member.params.length) {
    throw new Error(
      `runner-class: member "${member.name}" expects ${member.params.length} arguments, got ${args.length}`,
    );
  }
  const callStack = runnerCallStackForEnv(env);
  const label = `${member.ownerClass}.${member.name}`;
  if (callStack.includes(label)) throw new Error(`runner-class: recursive member call "${label}" is unsupported`);
  const bindings = new Map<string, unknown>([['this', receiver]]);
  for (let index = 0; index < member.params.length; index += 1) bindings.set(member.params[index], args[index]);
  const callEnv = makeEnv({
    bindings,
    runnerFunctions: runnerFunctionsForEnv(env),
    runnerClasses: runnerClassesForEnv(env),
    runnerCallStack: [...callStack, label],
    runnerCallCache: env.runnerCallCache,
    runnerThis: receiver,
    runnerSuperClass: runnerClassesForEnv(env)?.get(member.ownerClass)?.extendsName,
    capabilities: env.capabilities,
    capabilityContext: env.capabilityContext,
    seed: env.seed,
    now: env.now,
  });
  callEnv.bindings.set('this', receiver);
  callEnv.runnerThis = receiver;
  const fieldSnapshot = requireReturn ? cloneRunnerClassFields(receiver.fields) : undefined;
  if (runnerClassBodyHasCapability(body)) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  let trace: Trace;
  try {
    trace = await runBody(body, callEnv);
  } catch (error) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw error;
  }
  return finishRunnerClassBody(trace, receiver, fieldSnapshot, label, requireReturn);
}

function finishRunnerClassBody(
  trace: Trace,
  receiver: RunnerClassInstanceValue,
  fieldSnapshot: Record<string, unknown> | undefined,
  label: string,
  requireReturn: boolean,
): PortableScalar {
  if (
    trace.events.some(
      (event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'call' || event.op === 'capability',
    )
  ) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" produced side effects`);
  }
  if (
    requireReturn &&
    trace.events.some(
      (event) => event.op === 'assign' && typeof event.target === 'string' && event.target.includes('.'),
    )
  ) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" mutated instance state`);
  }
  if (trace.completion.kind === 'normal' && !requireReturn) return null;
  if (trace.completion.kind !== 'return') {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw new Error(`runner-class: member "${label}" must return a portable scalar`);
  }
  return assertPortableScalar(trace.completion.value, `member "${label}" return`);
}

function runnerClassBodyHasCapability(nodes: readonly IRNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'capability') return true;
    if (node.children && runnerClassBodyHasCapability(node.children)) return true;
  }
  return false;
}

function cloneRunnerClassFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, cloneRunnerClassFieldValue(value)]));
}

function cloneRunnerClassFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneRunnerClassFieldValue);
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, nested]) => [key, cloneRunnerClassFieldValue(nested)]));
  }
  if (value instanceof Set) return new Set(Array.from(value.values(), cloneRunnerClassFieldValue));
  if (isRunnerClassInstanceValue(value)) {
    return {
      __kernRunnerClassInstance: true,
      className: value.className,
      fields: cloneRunnerClassFields(value.fields),
      ...(value.module ? { module: value.module } : {}),
    } satisfies RunnerClassInstanceValue;
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key,
          cloneRunnerClassFieldValue(nested),
        ]),
      );
    }
  }
  return value;
}

function restoreRunnerClassFields(target: Record<string, unknown>, snapshot: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(snapshot)) target[key] = cloneRunnerClassFieldValue(value);
}
