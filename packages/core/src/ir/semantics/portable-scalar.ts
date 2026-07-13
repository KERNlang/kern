/** Reference-evaluator compatibility facade shared by runner contracts. */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';
import {
  getBinding,
  hasBinding,
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassInstanceValue,
  type RunnerClassMemberBinding,
  type RunnerFunctionBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from './index.js';
import {
  createPortableEvaluator,
  type PortableEvaluator,
} from './portable-core-evaluator.js';
import { PORTABLE_EVAL_NOT_HANDLED, type PortableEvaluatorHost } from './portable-eval-types.js';
import {
  assertPortableScalar,
  assertRunnerPortableValue,
  isIntProvenancedExpr,
  isRunnerClassInstanceValue,
  type EvalRecordLiteralOptions,
  type PortableRecord,
  type PortableScalar,
  type RunnerFunctionValue,
  type RunnerPortableArrayValue,
  type RunnerPortableValue,
} from './portable-scalar-domain.js';
import {
  evalRecordArrayFieldValue as evalRecordArrayFieldValueWithEvaluator,
  evalRecordLiteralValue as evalRecordLiteralValueWithEvaluator,
} from './portable-record-evaluator.js';
import { runPortableReferenceBody } from './portable-reference-host.js';

export {
  assertArithmeticResultNotFloatCollapsed,
  assertPortableScalar,
  assertRunnerPortableValue,
  DECIMAL_VALUE_TAG,
  IDENT_RE,
  isDecimalValue,
  isIntProvenancedExpr,
  isPortableBindingName,
  isPortableRecordValue,
  isPortableScalar,
  isRunnerClassInstanceValue,
  isRunnerPortableArrayValue,
  isSafeIntegerLiteralIndex,
  makeDecimalValue,
  portableTruthy,
  RESERVED_NAMES,
  sameType,
} from './portable-scalar-domain.js';
export type {
  DecimalValue,
  EvalRecordLiteralOptions,
  PortableRecord,
  PortableScalar,
  RunnerFunctionValue,
  RunnerPortableArrayValue,
  RunnerPortableValue,
} from './portable-scalar-domain.js';
export {
  assertPortableRecordEntry,
  assertSingleUseFreshArrayRecordSources,
  evalRecordArrayFieldReferenceValue,
  isRecordLiteralExpression,
} from './portable-record-evaluator.js';
export type { PortableRecordEntry } from './portable-record-evaluator.js';
export { CAUGHT_ERROR_TAG, type CaughtErrorValue, isCaughtErrorValue } from './caught-error.js';
export {
  decimalNamespaceMethod,
  evalDecimalExpression,
  evalRunnerNativeDecimalScalarCall,
  isCanonicalDecimalLiteralFailure,
  isDecimalExpression,
  isDecimalNamespaceCall,
  isDecimalValueExpression,
  isRunnerNativeDecimalFailClose,
} from './portable-decimal-evaluator.js';
export {
  coerceToString,
  evalNumberBinary,
  evalOrderedComparison,
  evalPlusOperator,
} from './portable-core-evaluator.js';

const RUNNER_CLASS_NO_VALUE = Symbol('runnerClassNoValue');
// Milestone 5.1b — same-file recursive helper calls are now SUPPORTED (previously
// ANY re-entrant call to a function already on the call stack was rejected
// outright). The depth limit is the ONLY guard against runaway/infinite
// recursion (a KERN program with no base case still fails closed, just later —
// at MAX_RUNNER_CALL_DEPTH frames deep — instead of on the first re-entry).
// 512 comfortably covers realistic recursive algorithms (tree/list traversal,
// divide-and-conquer) while staying well under Node's default JS call-stack
// budget (each KERN call frame costs several real JS frames: evalPortableValue
// -> evalRunnerFunctionCall -> referenceRunSequence -> referenceRun -> contract
// effects -> ...).
const MAX_RUNNER_CALL_DEPTH = 512;
const MAX_RUNNER_CALL_CACHE_ENTRIES = 1024;

function assertRunnerFunctionArgumentValue(
  value: unknown,
  label: string,
): RunnerPortableValue | RunnerClassInstanceValue {
  if (isRunnerClassInstanceValue(value)) return value;
  return assertRunnerPortableValue(value, label);
}

function assertRunnerFunctionValue(value: unknown, label: string): RunnerFunctionValue {
  if (isRunnerClassInstanceValue(value)) return value;
  return assertRunnerPortableValue(value, label);
}

// Memoization keys must be scoped to the DEFINING module: two modules can each
// declare a private `foo()`, and the call cache is shared across the whole run,
// so a bare-name key would let one module's result satisfy the other's call.
let moduleScopeSeq = 0;
const moduleScopeIds = new WeakMap<object, number>();
function moduleScopeCacheId(scope: RunnerModuleScope | undefined): number {
  if (!scope) return 0;
  let id = moduleScopeIds.get(scope);
  if (id === undefined) {
    id = moduleScopeSeq += 1;
    moduleScopeIds.set(scope, id);
  }
  return id;
}

function runnerFunctionCacheKey(
  moduleId: number,
  fnName: string,
  argValues: readonly RunnerFunctionValue[],
  argIntProvenance: readonly boolean[],
): string | undefined {
  if (argValues.some(isRunnerClassInstanceValue)) return undefined;
  try {
    return JSON.stringify([moduleId, fnName, argValues.map((value, index) => [value, argIntProvenance[index]])]);
  } catch {
    return undefined;
  }
}

export function evalRecordArrayFieldValue(
  value: ValueIR,
  env: SemanticEnv,
  options: EvalRecordLiteralOptions = {},
): RunnerPortableArrayValue | undefined {
  return evalRecordArrayFieldValueWithEvaluator(value, env, evalPortableValue, options);
}

export function evalRecordLiteralValue(
  node: ValueIR,
  env: SemanticEnv,
  options: EvalRecordLiteralOptions = {},
): PortableRecord {
  return evalRecordLiteralValueWithEvaluator(node, env, evalPortableValue, options);
}

const referenceEvaluatorHost: PortableEvaluatorHost = Object.freeze({
  classMember(node: Extract<ValueIR, { kind: 'member' }>, env: SemanticEnv) {
    const value = evalRunnerClassMemberScalar(node, env);
    return value === RUNNER_CLASS_NO_VALUE ? PORTABLE_EVAL_NOT_HANDLED : value;
  },
  classMethod(node: Extract<ValueIR, { kind: 'call' }>, env: SemanticEnv) {
    const value = evalRunnerClassMethodScalar(node, env);
    return value === RUNNER_CLASS_NO_VALUE ? PORTABLE_EVAL_NOT_HANDLED : value;
  },
  functionCall: evalRunnerFunctionCall,
});

const referenceEvaluator: PortableEvaluator = createPortableEvaluator(referenceEvaluatorHost);

export const evalPortableValue = referenceEvaluator.evalPortableValue;

export function evalRunnerClassNewValue(node: ValueIR, env: SemanticEnv): RunnerClassInstanceValue {
  if (node.kind !== 'new' || node.argument.kind !== 'call' || node.argument.callee.kind !== 'ident') {
    throw new Error('expected new');
  }
  return evalRunnerClassNewValueWithArguments(
    node,
    env,
    node.argument.args.map((arg) => evalRunnerClassArgument(arg, env)),
  );
}

export function evalRunnerClassNewValueWithArguments(
  node: ValueIR,
  env: SemanticEnv,
  args: readonly unknown[],
): RunnerClassInstanceValue {
  if (node.kind !== 'new' || node.argument.kind !== 'call' || node.argument.callee.kind !== 'ident') {
    throw new Error('expected new');
  }
  const className = node.argument.callee.name;
  const classes = runnerClassesForEnv(env);
  const cls = classes?.get(className);
  if (!classes || !cls) throw new Error(`runner-class: unknown class "${className}"`);
  const moduleEnv = withModuleScope(env, cls.module);
  const instance: RunnerClassInstanceValue = {
    __kernRunnerClassInstance: true,
    className: cls.name,
    fields: Object.create(null) as Record<string, unknown>,
    ...(cls.module ? { module: cls.module } : {}),
  };
  initializeRunnerClassInstance(cls, instance, args, moduleEnv);
  return instance;
}

export async function evalRunnerClassNewValueWithArgumentsAsync(
  node: ValueIR,
  env: SemanticEnv,
  args: readonly unknown[],
  runBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
): Promise<RunnerClassInstanceValue> {
  if (node.kind !== 'new' || node.argument.kind !== 'call' || node.argument.callee.kind !== 'ident') {
    throw new Error('expected new');
  }
  const className = node.argument.callee.name;
  const classes = runnerClassesForEnv(env);
  const cls = classes?.get(className);
  if (!classes || !cls) throw new Error(`runner-class: unknown class "${className}"`);
  const moduleEnv = withModuleScope(env, cls.module);
  const instance: RunnerClassInstanceValue = {
    __kernRunnerClassInstance: true,
    className: cls.name,
    fields: Object.create(null) as Record<string, unknown>,
    ...(cls.module ? { module: cls.module } : {}),
  };
  await initializeRunnerClassInstanceAsync(cls, instance, args, moduleEnv, runBody);
  return instance;
}

export function assignRunnerClassMember(
  target: string,
  valueExpr: ValueIR,
  env: SemanticEnv,
  mutate = true,
): PortableScalar | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
  if (!match) return undefined;
  const [, receiverName, fieldName] = match;
  if (!hasBinding(env, receiverName)) return undefined;
  const receiver = getBinding(env, receiverName);
  if (!isRunnerClassInstanceValue(receiver)) return undefined;
  const value = evalPortableValue(valueExpr, env);
  if (mutate && env.runnerProtectedClassInstances?.has(receiver)) {
    throw new Error('portable: function mutated class instance argument');
  }
  if (mutate) receiver.fields[fieldName] = value;
  return value;
}

function runnerClassesForEnv(env: SemanticEnv): Map<string, RunnerClassBinding> | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerClasses) return cur.runnerClasses;
  }
  return undefined;
}

/**
 * View `env` through a module's callable scope: the returned env resolves
 * functions/classes in `scope` (the DEFINING module) while preserving the
 * caller's capabilities, call stack, cache, seed, and clock. Used so an imported
 * helper or class member executes against its own module's private symbols
 * rather than the importer's flat namespace.
 */
function withModuleScope(env: SemanticEnv, scope: RunnerModuleScope | undefined): SemanticEnv {
  if (!scope) return env;
  if (env.runnerFunctions === scope.functions && env.runnerClasses === scope.classes) return env;
  return { ...env, runnerFunctions: scope.functions, runnerClasses: scope.classes };
}

function evalRunnerClassArgument(node: ValueIR, env: SemanticEnv): unknown {
  if (node.kind === 'new') return evalRunnerClassNewValue(node, env);
  if (node.kind === 'ident' && hasBinding(env, node.name)) return getBinding(env, node.name);
  if (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name !== 'String') {
    return evalRunnerFunctionValue(node.callee.name, node.args, env);
  }
  return evalPortableValue(node, env);
}

export function evalRunnerFunctionArgumentValue(node: ValueIR, env: SemanticEnv): RunnerFunctionValue {
  return assertRunnerFunctionArgumentValue(evalRunnerClassArgument(node, env), 'function argument');
}

function evalRunnerClassReceiver(node: ValueIR, env: SemanticEnv): RunnerClassInstanceValue | undefined {
  if (node.kind === 'ident') {
    if (node.name === 'this' && env.runnerThis) return env.runnerThis;
    if (!hasBinding(env, node.name)) return undefined;
    const value = getBinding(env, node.name);
    return isRunnerClassInstanceValue(value) ? value : undefined;
  }
  if (node.kind === 'new') return evalRunnerClassNewValue(node, env);
  return undefined;
}

function evalRunnerClassMemberScalar(
  node: Extract<ValueIR, { kind: 'member' }>,
  env: SemanticEnv,
): PortableScalar | typeof RUNNER_CLASS_NO_VALUE {
  if (node.optional) return RUNNER_CLASS_NO_VALUE;
  if (!isValueIR(node.object)) return RUNNER_CLASS_NO_VALUE;
  const receiver = evalRunnerClassReceiver(node.object, env);
  if (!receiver) return RUNNER_CLASS_NO_VALUE;
  if (Object.hasOwn(receiver.fields, node.property)) {
    return assertPortableScalar(receiver.fields[node.property], `field "${node.property}"`);
  }
  const menv = withModuleScope(env, receiver.module);
  const getter = findRunnerClassMember(receiver.className, node.property, 'getter', menv);
  if (!getter) throw new Error(`runner-class: class "${receiver.className}" has no field or getter "${node.property}"`);
  return invokeRunnerClassMember(getter, receiver, [], menv);
}

function evalRunnerClassMethodScalar(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
): PortableScalar | typeof RUNNER_CLASS_NO_VALUE {
  if (node.callee.kind !== 'member' || node.callee.optional) return RUNNER_CLASS_NO_VALUE;
  if (!isValueIR(node.callee.object)) return RUNNER_CLASS_NO_VALUE;
  if (node.callee.object.kind === 'ident' && node.callee.object.name === 'super') {
    if (!env.runnerThis || !env.runnerSuperClass) return RUNNER_CLASS_NO_VALUE;
    const method = findRunnerClassMemberFrom(env.runnerSuperClass, node.callee.property, 'method', env);
    if (!method) throw new Error(`runner-class: super has no method "${node.callee.property}"`);
    return invokeRunnerClassMember(
      method,
      env.runnerThis,
      node.args.map((arg) => evalRunnerClassArgument(arg, env)),
      env,
    );
  }
  const receiver = evalRunnerClassReceiver(node.callee.object, env);
  if (!receiver) return RUNNER_CLASS_NO_VALUE;
  const menv = withModuleScope(env, receiver.module);
  const method = findRunnerClassMember(receiver.className, node.callee.property, 'method', menv);
  if (!method) throw new Error(`runner-class: class "${receiver.className}" has no method "${node.callee.property}"`);
  return invokeRunnerClassMember(
    method,
    receiver,
    node.args.map((arg) => evalRunnerClassArgument(arg, env)),
    menv,
  );
}

export function evalRunnerClassMethodScalarWithArguments(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  args: readonly unknown[],
): PortableScalar | undefined {
  if (node.callee.kind !== 'member' || node.callee.optional) return undefined;
  if (!isValueIR(node.callee.object)) return undefined;
  if (node.callee.object.kind === 'ident' && node.callee.object.name === 'super') {
    if (!env.runnerThis || !env.runnerSuperClass) return undefined;
    const method = findRunnerClassMemberFrom(env.runnerSuperClass, node.callee.property, 'method', env);
    if (!method) throw new Error(`runner-class: super has no method "${node.callee.property}"`);
    return invokeRunnerClassMember(method, env.runnerThis, args, env);
  }
  const receiver = evalRunnerClassReceiver(node.callee.object, env);
  if (!receiver) return undefined;
  const menv = withModuleScope(env, receiver.module);
  const method = findRunnerClassMember(receiver.className, node.callee.property, 'method', menv);
  if (!method) throw new Error(`runner-class: class "${receiver.className}" has no method "${node.callee.property}"`);
  return invokeRunnerClassMember(method, receiver, args, menv);
}

export async function evalRunnerClassMethodScalarWithArgumentsAsync(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  args: readonly unknown[],
  runBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
): Promise<PortableScalar | undefined> {
  if (node.callee.kind !== 'member' || node.callee.optional) return undefined;
  if (!isValueIR(node.callee.object)) return undefined;
  if (node.callee.object.kind === 'ident' && node.callee.object.name === 'super') {
    if (!env.runnerThis || !env.runnerSuperClass) return undefined;
    const method = findRunnerClassMemberFrom(env.runnerSuperClass, node.callee.property, 'method', env);
    if (!method) throw new Error(`runner-class: super has no method "${node.callee.property}"`);
    return runRunnerClassBodyAsync(method, env.runnerThis, args, method.body, env, true, runBody);
  }
  const receiver = evalRunnerClassReceiver(node.callee.object, env);
  if (!receiver) return undefined;
  const menv = withModuleScope(env, receiver.module);
  const method = findRunnerClassMember(receiver.className, node.callee.property, 'method', menv);
  if (!method) throw new Error(`runner-class: class "${receiver.className}" has no method "${node.callee.property}"`);
  return runRunnerClassBodyAsync(method, receiver, args, method.body, menv, true, runBody);
}

function initializeRunnerClassInstance(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
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
    );
    initializeRunnerClassInstance(base, instance, explicitSuperArgs ?? [], env);
  }
  for (const field of cls.fields) {
    if (Object.hasOwn(instance.fields, field.name)) continue;
    instance.fields[field.name] =
      typeof field.value === 'string' && field.value !== ''
        ? evalRunnerClassArgument(parseExpression(field.value), env)
        : undefined;
  }
  if (!cls.constructor) return;
  const body = cls.extendsName
    ? cls.constructor.body.filter((child) => !isExplicitSuperCallNode(child))
    : cls.constructor.body;
  runRunnerClassBody(cls.constructor, instance, args, body, env, false);
}

async function initializeRunnerClassInstanceAsync(
  cls: RunnerClassBinding,
  instance: RunnerClassInstanceValue,
  args: readonly unknown[],
  env: SemanticEnv,
  runBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
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
    );
    await initializeRunnerClassInstanceAsync(base, instance, explicitSuperArgs ?? [], env, runBody);
  }
  for (const field of cls.fields) {
    if (Object.hasOwn(instance.fields, field.name)) continue;
    instance.fields[field.name] =
      typeof field.value === 'string' && field.value !== ''
        ? evalRunnerClassArgument(parseExpression(field.value), env)
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
  return parsed.args.map((arg) => evalRunnerClassArgument(arg, env));
}

function isExplicitSuperCallNode(node: { type: string; props?: Record<string, unknown> }): boolean {
  return node.type === 'do' && typeof node.props?.value === 'string' && node.props.value.trim().startsWith('super(');
}

function findRunnerClassMember(
  className: string,
  name: string,
  kind: 'method' | 'getter',
  env: SemanticEnv,
): RunnerClassMemberBinding | undefined {
  return findRunnerClassMemberFrom(className, name, kind, env);
}

function findRunnerClassMemberFrom(
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

function invokeRunnerClassMember(
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

async function runRunnerClassBodyAsync(
  member: RunnerClassMemberBinding,
  receiver: RunnerClassInstanceValue,
  args: readonly unknown[],
  body: readonly IRNode[],
  env: SemanticEnv,
  requireReturn: boolean,
  runBody: (body: readonly IRNode[], env: SemanticEnv) => Promise<import('./trace.js').Trace>,
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
  let trace: import('./trace.js').Trace;
  try {
    trace = await runBody(body, callEnv);
  } catch (error) {
    if (fieldSnapshot) restoreRunnerClassFields(receiver.fields, fieldSnapshot);
    throw error;
  }
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

/**
 * Milestone 5.1b — `List.length(xs)`, the KERN-stdlib NAMESPACE-CALL form of
 * the SAME operation the `member` case already certifies as `xs.length`
 * (see kern-stdlib.ts's `List.length` lowering: `ts: '$0.length'`,
 * `py: 'len($0)'`). Returns `undefined` when `node` is not this exact shape
 * (so the caller falls through to the generic call path); throws on a
 * recognized-but-invalid shape (wrong arity, non-ident/non-array receiver) so
 * the runner abstains atomically. Gated on `List` being UNSHADOWED, mirroring
 * the Decimal/Map namespace-call precedent.
 */
function runnerFunctionsForEnv(env: SemanticEnv): Map<string, RunnerFunctionBinding> | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerFunctions) return cur.runnerFunctions;
  }
  return undefined;
}

function runnerCallStackForEnv(env: SemanticEnv): readonly string[] {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerCallStack) return cur.runnerCallStack;
  }
  return [];
}

function runnerCallCacheForEnv(env: SemanticEnv): Map<string, unknown> {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.runnerCallCache) return cur.runnerCallCache;
  }
  env.runnerCallCache = new Map();
  return env.runnerCallCache;
}

export function evalRunnerFunctionValue(
  fnName: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
): RunnerFunctionValue {
  const functions = runnerFunctionsForEnv(env);
  const fn = functions?.get(fnName);
  if (!fn) throw new Error(`portable: unsupported call to "${fnName}"`);
  if (args.length !== fn.params.length) {
    throw new Error(`portable: function "${fnName}" expects ${fn.params.length} arguments, got ${args.length}`);
  }

  // Milestone 5.1b — same-file recursion (direct self-calls AND mutual/indirect
  // cycles through another helper) is now permitted; the ONLY fail-closed fence
  // left is the explicit depth limit below. Recursive calls stay side-effect-free
  // and memoized exactly like non-recursive ones (the cache below), so a pure
  // recursive helper (factorial, fibonacci-with-memo, tree depth, …) behaves
  // identically to hand-unrolled iteration on every leg.
  const callStack = runnerCallStackForEnv(env);
  if (callStack.length >= MAX_RUNNER_CALL_DEPTH) {
    throw new Error(`portable: runner function call depth exceeded (limit ${MAX_RUNNER_CALL_DEPTH})`);
  }

  const argValues: RunnerFunctionValue[] = [];
  const argIntProvenance: boolean[] = [];
  const bindings = new Map<string, unknown>();
  const intProvenance = new Set<string>();
  for (let index = 0; index < fn.params.length; index += 1) {
    const arg = args[index];
    // Merge of module linking (5.1a) + provenance arithmetic (5.1b): the 5.1a
    // argument evaluator admits class-instance arguments; the 5.1b predicate
    // subsumes literal, ident-provenance, and +/- arithmetic provenance.
    const value = evalRunnerFunctionArgumentValue(arg, env);
    const isSafeIntArg = isIntProvenancedExpr(arg, env);
    argValues.push(value);
    argIntProvenance.push(isSafeIntArg);
    bindings.set(fn.params[index], value);
    if (isSafeIntArg) {
      intProvenance.add(fn.params[index]);
    }
  }

  const cache = runnerCallCacheForEnv(env);
  const cacheKey = runnerFunctionCacheKey(moduleScopeCacheId(fn.module), fnName, argValues, argIntProvenance);
  if (cacheKey !== undefined && cache.has(cacheKey)) {
    return assertRunnerPortableValue(cache.get(cacheKey), `function "${fnName}" cached return`);
  }

  const callEnv = makeEnv({
    bindings,
    intProvenance,
    runnerFunctions: fn.module?.functions ?? functions,
    runnerClasses: fn.module?.classes ?? runnerClassesForEnv(env),
    runnerCallStack: [...callStack, fnName],
    runnerCallCache: cache,
    seed: env.seed,
    now: env.now,
  });
  callEnv.runnerProtectedClassInstances = new WeakSet(
    Array.from(callEnv.bindings.values()).filter(isRunnerClassInstanceValue),
  );
  const trace = runPortableReferenceBody(fn.body, callEnv);
  if (trace.events.some((event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'call')) {
    throw new Error(`portable: function "${fnName}" produced side effects`);
  }
  if (trace.completion.kind !== 'return') {
    throw new Error(`portable: function "${fnName}" must return a portable scalar, record, or array`);
  }
  const out = assertRunnerFunctionValue(trace.completion.value, `function "${fnName}" return`);
  if (cacheKey !== undefined && !isRunnerClassInstanceValue(out)) {
    if (cache.size >= MAX_RUNNER_CALL_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(cacheKey, out);
  }
  return out;
}

function evalRunnerFunctionCall(fnName: string, args: readonly ValueIR[], env: SemanticEnv): PortableScalar {
  return assertPortableScalar(evalRunnerFunctionValue(fnName, args, env), `function "${fnName}" return`);
}

export function evalPortableBinary(
  node: Extract<ValueIR, { kind: 'binary' }>,
  env: SemanticEnv,
): PortableScalar {
  return referenceEvaluator.evalPortableBinary(node, env);
}
