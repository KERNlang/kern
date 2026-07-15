import type { ValueIR } from '../../value-ir.js';
import {
  bindInternalEffectMachineState,
  internalEffectMachineStateForEnv,
} from './internal-effect-machine-helper-state.js';
import {
  InternalEffectMachineHelperPending,
  type InternalEffectMachineState,
} from './internal-effect-machine-types.js';
import { evalArrayLiteralValue, isArrayLiteralExpression } from './portable-array.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { evalRecordLiteralValue, isRecordLiteralExpression } from './portable-record-evaluator.js';
import {
  assertPortableScalar,
  assertRunnerPortableValue,
  isIntProvenancedExpr,
  type PortableScalar,
  type RunnerPortableValue,
} from './portable-scalar-domain.js';
import { getBinding, hasBinding, makeEnv, type SemanticEnv } from './semantic-env.js';

// Frozen native-runner semantics, shared with the compatibility helper owner.
const RUNNER_CALL_DEPTH_LIMIT = 512;
const RUNNER_CALL_CACHE_LIMIT = 1024;

function helperCacheKey(
  name: string,
  values: readonly RunnerPortableValue[],
  provenance: readonly boolean[],
): string | undefined {
  try {
    return `machine-helper:${JSON.stringify([name, values.map((value, index) => [value, provenance[index]])])}`;
  } catch {
    return undefined;
  }
}

function evaluateArgument(node: ValueIR, env: SemanticEnv, evaluate: EvalPortableValue): RunnerPortableValue {
  if (node.kind === 'ident' && hasBinding(env, node.name)) {
    return assertRunnerPortableValue(getBinding(env, node.name), `function argument "${node.name}"`);
  }
  if (isArrayLiteralExpression(node)) {
    return assertRunnerPortableValue(evalArrayLiteralValue(node, env, evaluate), 'function array argument');
  }
  if (isRecordLiteralExpression(node)) {
    return assertRunnerPortableValue(evalRecordLiteralValue(node, env, evaluate), 'function record argument');
  }
  if (node.kind === 'call' && node.callee.kind === 'ident' && env.runnerFunctions?.has(node.callee.name)) {
    return evalInternalMachineHelperValue(node.callee.name, node.args, env, evaluate);
  }
  return evaluate(node, env);
}

function helperCache(env: SemanticEnv): Map<string, unknown> {
  return (env.runnerCallCache ??= new Map());
}

interface PreparedHelperCall {
  readonly cache: Map<string, unknown>;
  readonly cacheKey: string | undefined;
  readonly env: SemanticEnv;
  readonly intProvenance: ReadonlySet<string>;
  readonly name: string;
  readonly state: InternalEffectMachineState;
  readonly values: readonly RunnerPortableValue[];
}

function prepareHelperCall(
  name: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PreparedHelperCall {
  const state = internalEffectMachineStateForEnv(env);
  const fn = state?.helperRegistry?.get(name);
  if (!state || !fn || !state.helperBodyRunner) {
    throw new Error(`portable machine: function call "${name}" is outside the machine scalar domain`);
  }
  if (args.length !== fn.params.length) {
    throw new Error(`portable: function "${name}" expects ${fn.params.length} arguments, got ${args.length}`);
  }
  const stack = env.runnerCallStack ?? [];
  if (stack.length >= RUNNER_CALL_DEPTH_LIMIT) {
    throw new Error(`portable: runner function call depth exceeded (limit ${RUNNER_CALL_DEPTH_LIMIT})`);
  }
  const values: RunnerPortableValue[] = [];
  const provenance: boolean[] = [];
  const intProvenance = new Set<string>();
  for (let index = 0; index < fn.params.length; index += 1) {
    const value = evaluateArgument(args[index], env, evaluate);
    const isInteger = isIntProvenancedExpr(args[index], env);
    values.push(value);
    provenance.push(isInteger);
    if (isInteger) intProvenance.add(fn.params[index]);
  }
  return {
    cache: helperCache(env),
    cacheKey: helperCacheKey(name, values, provenance),
    env,
    intProvenance,
    name,
    state,
    values,
  };
}

function cachedHelperValue(call: PreparedHelperCall): RunnerPortableValue | undefined {
  if (call.cacheKey === undefined || !call.cache.has(call.cacheKey)) return undefined;
  return assertRunnerPortableValue(call.cache.get(call.cacheKey), `function "${call.name}" cached return`);
}

function rememberHelperValue(call: PreparedHelperCall, value: RunnerPortableValue): void {
  if (call.cacheKey === undefined) return;
  if (call.cache.size >= RUNNER_CALL_CACHE_LIMIT) {
    const oldest = call.cache.keys().next().value;
    if (oldest !== undefined) call.cache.delete(oldest);
  }
  call.cache.set(call.cacheKey, value);
}

function executePreparedHelper(call: PreparedHelperCall): RunnerPortableValue {
  const fn = call.state.helperRegistry?.get(call.name);
  const bodyRunner = call.state.helperBodyRunner;
  if (!fn || !bodyRunner) throw new Error(`portable machine: helper "${call.name}" is unavailable`);
  const bindings = new Map(fn.params.map((param, index) => [param, call.values[index]]));
  const callEnv = makeEnv({
    bindings,
    intProvenance: new Set(call.intProvenance),
    runnerCallCache: call.cache,
    runnerCallStack: [...(call.env.runnerCallStack ?? []), call.name],
    runnerClasses: call.env.runnerClasses,
    runnerFunctions: call.env.runnerFunctions,
    seed: call.env.seed,
    now: call.env.now,
  });
  const restore = bindInternalEffectMachineState(callEnv, call.state);
  try {
    const first = bodyRunner(fn.body, callEnv, call.state).next();
    if (!first.done) throw new Error(`portable: function "${call.name}" produced side effects`);
    const trace = first.value;
    if (trace.events.some((event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'capability')) {
      throw new Error(`portable: function "${call.name}" produced side effects`);
    }
    if (trace.completion.kind !== 'return') {
      throw new Error(`portable: function "${call.name}" must return a portable scalar, record, or array`);
    }
    return assertRunnerPortableValue(trace.completion.value, `function "${call.name}" return`);
  } finally {
    restore();
  }
}

function drivePreparedHelper(initial: PreparedHelperCall): RunnerPortableValue {
  const state = initial.state;
  const frames: PreparedHelperCall[] = [initial];
  state.helperEvaluationDepth = 1;
  try {
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const cached = cachedHelperValue(frame);
      if (cached !== undefined) {
        frames.pop();
        if (frames.length === 0) return cached;
        continue;
      }
      const remainingIterations = state.remainingIterations;
      try {
        const value = executePreparedHelper(frame);
        rememberHelperValue(frame, value);
        frames.pop();
        if (frames.length === 0) return value;
      } catch (error) {
        if (!(error instanceof InternalEffectMachineHelperPending)) throw error;
        state.remainingIterations = remainingIterations;
        frames.push(error.request as PreparedHelperCall);
      }
    }
  } finally {
    state.helperEvaluationDepth = 0;
  }
  throw new Error('portable machine: helper trampoline completed without a value');
}

export function evalInternalMachineHelperValue(
  name: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): RunnerPortableValue {
  const call = prepareHelperCall(name, args, env, evaluate);
  const cached = cachedHelperValue(call);
  if (cached !== undefined) return cached;
  if ((call.state.helperEvaluationDepth ?? 0) > 0) throw new InternalEffectMachineHelperPending(call);
  return drivePreparedHelper(call);
}

export function evalInternalMachineHelperScalar(
  name: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PortableScalar {
  return assertPortableScalar(evalInternalMachineHelperValue(name, args, env, evaluate), `function "${name}" return`);
}
