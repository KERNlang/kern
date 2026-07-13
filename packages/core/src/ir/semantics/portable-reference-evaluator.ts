import { isValueIR, type ValueIR } from '../../value-ir.js';
import {
  getBinding,
  hasBinding,
  makeEnv,
  type RunnerClassInstanceValue,
  type RunnerModuleScope,
  type SemanticEnv,
} from './index.js';
import { createPortableEvaluator, type PortableEvaluator } from './portable-core-evaluator.js';
import { PORTABLE_EVAL_NOT_HANDLED, type PortableEvaluatorHost } from './portable-eval-types.js';
import {
  evalRecordArrayFieldValue as evalRecordArrayFieldValueWithEvaluator,
  evalRecordLiteralValue as evalRecordLiteralValueWithEvaluator,
} from './portable-record-evaluator.js';
import {
  type AsyncReferenceBodyRunner,
  findRunnerClassMember,
  findRunnerClassMemberFrom,
  initializeRunnerClassInstance,
  initializeRunnerClassInstanceAsync,
  invokeRunnerClassMember,
  runnerCallStackForEnv,
  runnerClassesForEnv,
  runnerFunctionsForEnv,
  runRunnerClassBodyAsync,
  withModuleScope,
} from './portable-reference-body.js';
import { runPortableReferenceBody } from './portable-reference-host.js';
import {
  assertPortableScalar,
  assertRunnerPortableValue,
  type EvalRecordLiteralOptions,
  isIntProvenancedExpr,
  isRunnerClassInstanceValue,
  type PortableRecord,
  type PortableScalar,
  type RunnerFunctionValue,
  type RunnerPortableArrayValue,
  type RunnerPortableValue,
} from './portable-scalar-domain.js';

const RUNNER_CLASS_NO_VALUE = Symbol('runnerClassNoValue');
// Same-file recursive helper calls are supported. This explicit depth limit is
// the fail-closed guard against runaway recursion.
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

// Cache keys include the defining module so same-named private functions never
// satisfy one another through the run-wide memoization map.
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
  initializeRunnerClassInstance(cls, instance, args, moduleEnv, evalRunnerClassArgument);
  return instance;
}

export async function evalRunnerClassNewValueWithArgumentsAsync(
  node: ValueIR,
  env: SemanticEnv,
  args: readonly unknown[],
  runBody: AsyncReferenceBodyRunner,
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
  await initializeRunnerClassInstanceAsync(cls, instance, args, moduleEnv, runBody, evalRunnerClassArgument);
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
  runBody: AsyncReferenceBodyRunner,
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
    const value = evalRunnerFunctionArgumentValue(arg, env);
    const isSafeIntArg = isIntProvenancedExpr(arg, env);
    argValues.push(value);
    argIntProvenance.push(isSafeIntArg);
    bindings.set(fn.params[index], value);
    if (isSafeIntArg) intProvenance.add(fn.params[index]);
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

export function evalPortableBinary(node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv): PortableScalar {
  return referenceEvaluator.evalPortableBinary(node, env);
}
