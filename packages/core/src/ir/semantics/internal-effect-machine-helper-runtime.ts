import type { ValueIR } from '../../value-ir.js';
import type {
  InternalMachineClassEvaluatedValue,
  InternalMachineClassValueGenerator,
} from './internal-effect-machine-class-frame.js';
import { emitInternalEffectMachineDiagnostic } from './internal-effect-machine-diagnostics.js';
import {
  bindInternalEffectMachineState,
  internalEffectMachineStateForEnv,
} from './internal-effect-machine-helper-state.js';
import { internalMachineFunctionForEnv } from './internal-effect-machine-module-graph.js';
import {
  type InternalEffectMachineGenerator,
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
import {
  lookupRunnerCallCache,
  type PreparedRunnerCallCacheKey,
  prepareRunnerCallCacheKey,
  type RunnerCallCache,
  rememberRunnerCallCache,
} from './runner-call-cache.js';
import {
  getBinding,
  hasBinding,
  makeExecutionFrame,
  type RunnerFunctionBinding,
  type SemanticEnv,
} from './semantic-env.js';
import { emptyTrace, type TraceEvent } from './trace.js';

// Frozen native-runner semantics, shared with the compatibility helper owner.
const RUNNER_CALL_DEPTH_LIMIT = 512;
const RUNNER_CALL_CACHE_LIMIT = 1024;

export function evalInternalMachineHelperArgumentValue(
  node: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): RunnerPortableValue {
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

function helperCache(state: InternalEffectMachineState, fn: RunnerFunctionBinding): RunnerCallCache {
  const caches = (state.helperCallCache ??= new Map());
  let cache = caches.get(fn);
  if (!cache) {
    cache = new Map();
    caches.set(fn, cache);
  }
  return cache;
}

interface PreparedHelperCall {
  readonly cache: RunnerCallCache;
  readonly cacheKey: PreparedRunnerCallCacheKey | undefined;
  readonly env: SemanticEnv;
  readonly fn: RunnerFunctionBinding;
  readonly intProvenance: ReadonlySet<string>;
  readonly name: string;
  readonly state: InternalEffectMachineState;
  readonly values: readonly RunnerPortableValue[];
}

function prepareHelperCallFromValues(
  name: string,
  values: readonly RunnerPortableValue[],
  provenance: readonly boolean[],
  env: SemanticEnv,
): PreparedHelperCall {
  const state = internalEffectMachineStateForEnv(env);
  const fn = state?.moduleGraph
    ? internalMachineFunctionForEnv(state.moduleGraph, env, name)
    : state?.helperRegistry?.get(name);
  if (!state || !fn || !state.helperBodyRunner) {
    throw new Error(`portable machine: function call "${name}" is outside the machine scalar domain`);
  }
  if (values.length !== fn.params.length) {
    throw new Error(`portable: function "${name}" expects ${fn.params.length} arguments, got ${values.length}`);
  }
  const stack = env.runnerCallStack ?? [];
  if (stack.length >= RUNNER_CALL_DEPTH_LIMIT) {
    throw new Error(`portable: runner function call depth exceeded (limit ${RUNNER_CALL_DEPTH_LIMIT})`);
  }
  const intProvenance = new Set<string>();
  for (let index = 0; index < fn.params.length; index += 1) {
    if (provenance[index]) intProvenance.add(fn.params[index]);
  }
  const cache = helperCache(state, fn);
  const cacheKey = prepareRunnerCallCacheKey([], values, provenance);
  if (state.observer !== undefined) {
    emitInternalEffectMachineDiagnostic(state.observer, {
      argumentCount: values.length,
      cacheKeyLength: cacheKey?.encodedLength ?? null,
      cacheOuterStringPathSteps: cacheKey?.outerStrings.length ?? null,
      cacheTerminalCodeUnits: cacheKey?.terminal.length ?? null,
      kind: 'helper-prepare',
      name,
    });
  }
  return {
    cache,
    cacheKey,
    env,
    fn,
    intProvenance,
    name,
    state,
    values,
  };
}

function prepareHelperCall(
  name: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PreparedHelperCall {
  const state = internalEffectMachineStateForEnv(env);
  const fn = state?.moduleGraph
    ? internalMachineFunctionForEnv(state.moduleGraph, env, name)
    : state?.helperRegistry?.get(name);
  if (!state || !fn || !state.helperBodyRunner) {
    throw new Error(`portable machine: function call "${name}" is outside the machine scalar domain`);
  }
  if (args.length !== fn.params.length) {
    throw new Error(`portable: function "${name}" expects ${fn.params.length} arguments, got ${args.length}`);
  }
  const values: RunnerPortableValue[] = [];
  const provenance: boolean[] = [];
  for (let index = 0; index < fn.params.length; index += 1) {
    const value = evalInternalMachineHelperArgumentValue(args[index], env, evaluate);
    const isInteger = isIntProvenancedExpr(args[index], env);
    values.push(value);
    provenance.push(isInteger);
  }
  return prepareHelperCallFromValues(name, values, provenance, env);
}

function cachedHelperValue(call: PreparedHelperCall): RunnerPortableValue | undefined {
  const cached = call.cacheKey === undefined ? { hit: false } : lookupRunnerCallCache(call.cache, call.cacheKey);
  const hit = cached.hit;
  if (call.state.observer !== undefined) {
    emitInternalEffectMachineDiagnostic(call.state.observer, {
      hit,
      kind: 'helper-cache',
      name: call.name,
    });
  }
  if (!hit || call.cacheKey === undefined) return undefined;
  return assertRunnerPortableValue(cached.value, `function "${call.name}" cached return`);
}

function rememberHelperValue(call: PreparedHelperCall, value: RunnerPortableValue): void {
  if (call.cacheKey === undefined) return;
  rememberRunnerCallCache(call.cache, call.cacheKey, value, RUNNER_CALL_CACHE_LIMIT);
}

function helperCallEnvironment(call: PreparedHelperCall): SemanticEnv {
  const fn = call.fn;
  if (call.state.observer !== undefined) {
    emitInternalEffectMachineDiagnostic(call.state.observer, {
      kind: 'helper-execute',
      name: call.name,
    });
  }
  const bindings = new Map(fn.params.map((param, index) => [param, call.values[index]]));
  const scope = fn.module;
  if (!scope) throw new Error(`portable machine: helper "${call.name}" has no defining module`);
  const identity = call.state.moduleGraph?.functionIdentity.get(fn);
  const stackLabel = identity === undefined ? call.name : `module-function:${identity}:${fn.name}`;
  const callEnv = makeExecutionFrame(call.env, {
    bindings,
    intProvenance: new Set(call.intProvenance),
    runnerCallCache: call.cache,
    runnerCallStack: [...(call.env.runnerCallStack ?? []), stackLabel],
    runnerClasses: scope.classes,
    runnerFunctions: scope.functions,
    seed: call.env.seed,
    now: call.env.now,
  });
  return callEnv;
}

function observableHelperEvents(events: readonly TraceEvent[]): readonly TraceEvent[] {
  return events.filter((event) => event.op === 'stdout' || event.op === 'stderr' || event.op === 'capability');
}

export function* evalInternalMachineHelperFrame(
  name: string,
  values: readonly RunnerPortableValue[],
  provenance: readonly boolean[],
  env: SemanticEnv,
): InternalMachineClassValueGenerator<RunnerPortableValue> {
  const call = prepareHelperCallFromValues(name, values, provenance, env);
  const cached = cachedHelperValue(call);
  if (cached !== undefined) return { events: [], value: cached };
  const fn = call.fn;
  const bodyRunner = call.state.helperBodyRunner;
  if (!fn || !bodyRunner) throw new Error(`portable machine: helper "${call.name}" is unavailable`);
  const callEnv = helperCallEnvironment(call);
  const restore = bindInternalEffectMachineState(callEnv, call.state);
  try {
    const trace = yield* bodyRunner(fn.body, callEnv, call.state);
    if (trace.completion.kind !== 'return') {
      throw new Error(`portable: function "${call.name}" must return a portable scalar, record, or array`);
    }
    const value = assertRunnerPortableValue(trace.completion.value, `function "${call.name}" return`);
    const events = observableHelperEvents(trace.events);
    if (events.length === 0) rememberHelperValue(call, value);
    return {
      events,
      value,
    } satisfies InternalMachineClassEvaluatedValue<RunnerPortableValue>;
  } finally {
    restore();
  }
}

interface PreparedHelperExecution {
  readonly call: PreparedHelperCall;
  readonly machine: InternalEffectMachineGenerator;
  readonly restore: () => void;
  closed: boolean;
}

interface PreparedHelperFrame {
  readonly call: PreparedHelperCall;
  execution?: PreparedHelperExecution;
}

type PreparedHelperExecutionStep =
  | { readonly kind: 'complete'; readonly value: RunnerPortableValue }
  | { readonly dependency: PreparedHelperCall; readonly kind: 'dependency' };

function startPreparedHelperExecution(call: PreparedHelperCall): PreparedHelperExecution {
  const bodyRunner = call.state.helperBodyRunner;
  if (!bodyRunner) throw new Error(`portable machine: helper "${call.name}" is unavailable`);
  const callEnv = helperCallEnvironment(call);
  return {
    call,
    machine: bodyRunner(call.fn.body, callEnv, call.state),
    restore: bindInternalEffectMachineState(callEnv, call.state),
    closed: false,
  };
}

function closePreparedHelperExecution(execution: PreparedHelperExecution, unwind: boolean): void {
  if (execution.closed) return;
  execution.closed = true;
  if (unwind) {
    try {
      execution.machine.return(emptyTrace());
    } catch {
      // Preserve the original helper failure while generator finally blocks unwind.
    }
  }
  execution.restore();
}

function preparedHelperDependency(request: unknown, state: InternalEffectMachineState): PreparedHelperCall {
  if (
    typeof request !== 'object' ||
    request === null ||
    !('state' in request) ||
    request.state !== state ||
    !('name' in request) ||
    typeof request.name !== 'string'
  ) {
    throw new Error('portable machine: invalid helper dependency request');
  }
  return request as PreparedHelperCall;
}

function advancePreparedHelperExecution(execution: PreparedHelperExecution): PreparedHelperExecutionStep {
  try {
    const step = execution.machine.next();
    if (!step.done) {
      if (step.value.kind !== 'helper-dependency') {
        throw new Error(`portable: function "${execution.call.name}" produced side effects`);
      }
      return {
        dependency: preparedHelperDependency(step.value.request, execution.call.state),
        kind: 'dependency',
      };
    }
    const trace = step.value;
    if (observableHelperEvents(trace.events).length > 0) {
      throw new Error(`portable: function "${execution.call.name}" produced side effects`);
    }
    if (trace.completion.kind !== 'return') {
      throw new Error(`portable: function "${execution.call.name}" must return a portable scalar, record, or array`);
    }
    const value = assertRunnerPortableValue(trace.completion.value, `function "${execution.call.name}" return`);
    closePreparedHelperExecution(execution, false);
    return { kind: 'complete', value };
  } catch (error) {
    closePreparedHelperExecution(execution, true);
    throw error;
  }
}

function drivePreparedHelper(initial: PreparedHelperCall): RunnerPortableValue {
  const state = initial.state;
  const frames: PreparedHelperFrame[] = [{ call: initial }];
  state.helperEvaluationDepth = 1;
  try {
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.execution === undefined) {
        const cached = cachedHelperValue(frame.call);
        if (cached !== undefined) {
          frames.pop();
          if (frames.length === 0) return cached;
          continue;
        }
        frame.execution = startPreparedHelperExecution(frame.call);
      }
      const step = advancePreparedHelperExecution(frame.execution);
      if (step.kind === 'complete') {
        rememberHelperValue(frame.call, step.value);
        frames.pop();
        if (frames.length === 0) return step.value;
        continue;
      }
      if (state.observer !== undefined) {
        emitInternalEffectMachineDiagnostic(state.observer, {
          dependency: step.dependency.name,
          kind: 'helper-frame-suspend',
          parent: frame.call.name,
        });
      }
      frames.push({ call: step.dependency });
    }
  } finally {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (frame.execution !== undefined) closePreparedHelperExecution(frame.execution, true);
    }
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
