import type { ValueIR } from '../../value-ir.js';
import {
  evaluateInternalMachineClassGetterFrame,
  evaluateInternalMachineClassMethodFrame,
  evaluateInternalMachineClassNewFrame,
  type InternalMachineClassEvaluatedValue,
  type InternalMachineClassValueGenerator,
} from './internal-effect-machine-class-frame.js';
import {
  classifyInternalMachineClassHelperArgument,
  classifyInternalMachineClassLetValue,
  classifyInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value.js';
import { isInternalMachineHelperCall } from './internal-effect-machine-helper-graph.js';
import {
  evalInternalMachineHelperArgumentValue,
  evalInternalMachineHelperFrame,
} from './internal-effect-machine-helper-runtime.js';
import type { InternalEffectMachineState } from './internal-effect-machine-types.js';
import {
  coerceToString,
  evalNumberBinary,
  evalOrderedComparison,
  evalPlusOperator,
} from './portable-core-evaluator.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import {
  assertPortableRecordEntry,
  assertSingleUseFreshArrayRecordSources,
  evalRecordArrayFieldValue,
} from './portable-record-evaluator.js';
import {
  assertPortableScalar,
  isIntProvenancedExpr,
  isPortableScalar,
  isRunnerPortableArrayValue,
  type PortableScalar,
  portableTruthy,
  type RunnerPortableArrayValue,
  type RunnerPortableValue,
  sameType,
} from './portable-scalar-domain.js';
import type { RunnerClassInstanceValue, SemanticEnv } from './semantic-env.js';
import type { TraceEvent } from './trace.js';

function evaluated<T = PortableScalar>(
  value: T,
  events: readonly TraceEvent[] = [],
): InternalMachineClassEvaluatedValue<T> {
  return { events, value };
}

function append<T>(events: TraceEvent[], next: InternalMachineClassEvaluatedValue<T>): T {
  events.push(...next.events);
  return next.value;
}

function evaluateBinaryResult(
  op: string,
  left: PortableScalar,
  right: PortableScalar,
  env: SemanticEnv,
): PortableScalar {
  if (op === '+') return evalPlusOperator(left, right, env);
  if (op === '-' || op === '*' || op === '/' || op === '%') return evalNumberBinary(op, left, right, env);
  if (op === '===' || op === '==') return sameType(left, right) ? left === right : false;
  if (op === '!==' || op === '!=') return sameType(left, right) ? left !== right : true;
  if (op === '<' || op === '<=' || op === '>' || op === '>=') {
    if (
      !sameType(left, right) ||
      !(
        (typeof left === 'number' && typeof right === 'number') ||
        (typeof left === 'string' && typeof right === 'string')
      )
    ) {
      throw new Error(`portable: ${op} requires same-typed number or string operands`);
    }
    return evalOrderedComparison(op, left, right);
  }
  throw new Error(`portable: unsupported binary op "${op}"`);
}

function* evaluateInternalMachineHelperArgument(
  node: ValueIR,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalMachineClassValueGenerator<RunnerPortableValue> {
  const disposition = classifyInternalMachineClassHelperArgument(node, env);
  if (disposition === 'pure') {
    return evaluated(evalInternalMachineHelperArgumentValue(node, env, evalPortableValue));
  }
  if (disposition === 'unsupported') {
    throw new Error(`machine helper: argument kind "${node.kind}" is outside the resumable domain`);
  }
  if (
    node.kind === 'call' &&
    node.callee.kind === 'ident' &&
    isInternalMachineHelperCall(node.callee.name, node.args.length, env)
  ) {
    return yield* evaluateInternalMachineHelperCall(node, env, state);
  }
  if (node.kind === 'arrayLit') {
    const events: TraceEvent[] = [];
    const out: Array<PortableScalar | RunnerPortableArrayValue> = [];
    for (const item of node.items) {
      const value = append(events, yield* evaluateInternalMachineHelperArgument(item, env, state));
      if (!isPortableScalar(value) && !isRunnerPortableArrayValue(value)) {
        throw new Error('machine helper: array item is outside the portable domain');
      }
      out.push(value);
    }
    return { events, value: Object.freeze(out) };
  }
  if (node.kind === 'objectLit') {
    assertSingleUseFreshArrayRecordSources(node, env);
    const events: TraceEvent[] = [];
    const out: Record<string, PortableScalar | RunnerPortableArrayValue> = Object.create(null);
    for (const rawEntry of node.entries) {
      const entry = assertPortableRecordEntry(rawEntry, out);
      const entryDisposition = classifyInternalMachineClassHelperArgument(entry.value, env);
      const arrayValue =
        entryDisposition === 'pure' ? evalRecordArrayFieldValue(entry.value, env, evalPortableValue) : undefined;
      if (arrayValue !== undefined) {
        out[entry.key] = arrayValue;
        continue;
      }
      const value = append(events, yield* evaluateInternalMachineHelperArgument(entry.value, env, state));
      if (!isPortableScalar(value) && !isRunnerPortableArrayValue(value)) {
        throw new Error(`machine helper: record field "${entry.key}" is outside the portable domain`);
      }
      out[entry.key] = value;
    }
    return { events, value: Object.freeze(out) };
  }
  if (classifyInternalMachineClassScalarValue(node, env) === 'suspending') {
    return yield* evaluateInternalMachineClassScalarValue(node, env, state);
  }
  throw new Error(`machine helper: unsupported resumable argument kind "${node.kind}"`);
}

function* evaluateInternalMachineHelperCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalMachineClassValueGenerator<RunnerPortableValue> {
  if (node.callee.kind !== 'ident') throw new Error('machine helper: resumable call target is unavailable');
  const events: TraceEvent[] = [];
  const values: RunnerPortableValue[] = [];
  const provenance: boolean[] = [];
  for (const argument of node.args) {
    values.push(append(events, yield* evaluateInternalMachineHelperArgument(argument, env, state)));
    provenance.push(isIntProvenancedExpr(argument, env));
  }
  const body = yield* evalInternalMachineHelperFrame(node.callee.name, values, provenance, env);
  events.push(...body.events);
  return { events, value: body.value };
}

export function* evaluateInternalMachineClassScalarValue(
  node: ValueIR,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalMachineClassValueGenerator {
  const disposition = classifyInternalMachineClassScalarValue(node, env);
  if (disposition === 'pure') return evaluated(evalPortableValue(node, env));
  if (disposition === 'unsupported') {
    throw new Error(`machine class: expression kind "${node.kind}" is outside the resumable scalar domain`);
  }

  if (node.kind === 'member') return yield* evaluateInternalMachineClassGetterFrame(node, env, state);
  if (node.kind === 'call') {
    if (node.callee.kind === 'ident' && isInternalMachineHelperCall(node.callee.name, node.args.length, env)) {
      const result = yield* evaluateInternalMachineHelperCall(node, env, state);
      return {
        events: result.events,
        value: assertPortableScalar(result.value, `function "${node.callee.name}" return`),
      };
    }
    if (node.callee.kind === 'ident' && node.callee.name === 'String') {
      const argument = yield* evaluateInternalMachineClassScalarValue(node.args[0], env, state);
      return evaluated(coerceToString(argument.value), argument.events);
    }
    return yield* evaluateInternalMachineClassMethodFrame(node, env, state, evaluateInternalMachineClassScalarValue);
  }
  if (node.kind === 'unary') {
    const argument = yield* evaluateInternalMachineClassScalarValue(node.argument, env, state);
    if (node.op === '!') return evaluated(!portableTruthy(argument.value), argument.events);
    if (typeof argument.value !== 'number') throw new Error(`portable: unary ${node.op} requires a number`);
    return evaluated(
      assertPortableScalar(node.op === '-' ? -argument.value : argument.value, `unary ${node.op}`),
      argument.events,
    );
  }
  if (node.kind === 'binary') {
    const events: TraceEvent[] = [];
    const left = append(events, yield* evaluateInternalMachineClassScalarValue(node.left, env, state));
    if (node.op === '&&' && !portableTruthy(left)) return evaluated(left, events);
    if (node.op === '||' && portableTruthy(left)) return evaluated(left, events);
    if (node.op === '??' && left !== null) return evaluated(left, events);
    const right = append(events, yield* evaluateInternalMachineClassScalarValue(node.right, env, state));
    if (node.op === '&&' || node.op === '||' || node.op === '??') return evaluated(right, events);
    return evaluated(evaluateBinaryResult(node.op, left, right, env), events);
  }
  if (node.kind === 'conditional') {
    const events: TraceEvent[] = [];
    const test = append(events, yield* evaluateInternalMachineClassScalarValue(node.test, env, state));
    const branch = portableTruthy(test) ? node.consequent : node.alternate;
    return evaluated(append(events, yield* evaluateInternalMachineClassScalarValue(branch, env, state)), events);
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    return yield* evaluateInternalMachineClassScalarValue(node.expression, env, state);
  }
  if (node.kind === 'tmplLit') {
    const events: TraceEvent[] = [];
    let value = '';
    for (let index = 0; index < node.quasis.length; index += 1) {
      value += node.quasis[index];
      if (index < node.expressions.length) {
        value += coerceToString(
          append(events, yield* evaluateInternalMachineClassScalarValue(node.expressions[index], env, state)),
        );
      }
    }
    return evaluated(value, events);
  }
  throw new Error(`machine class: unsupported resumable expression kind "${node.kind}"`);
}

export function* evaluateInternalMachineClassLetValue(
  node: ValueIR,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalMachineClassValueGenerator<PortableScalar | RunnerClassInstanceValue> {
  const disposition = classifyInternalMachineClassLetValue(node, env);
  if (disposition !== 'suspending') {
    throw new Error('machine class: let value is not a resumable class expression');
  }
  if (node.kind === 'new') {
    return yield* evaluateInternalMachineClassNewFrame(node, env, state, evaluateInternalMachineClassScalarValue);
  }
  return yield* evaluateInternalMachineClassScalarValue(node, env, state);
}
