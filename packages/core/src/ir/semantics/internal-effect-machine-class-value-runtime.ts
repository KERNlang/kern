import type { ValueIR } from '../../value-ir.js';
import {
  evaluateInternalMachineClassGetterFrame,
  evaluateInternalMachineClassMethodFrame,
  evaluateInternalMachineClassNewFrame,
  type InternalMachineClassEvaluatedValue,
  type InternalMachineClassValueGenerator,
} from './internal-effect-machine-class-frame.js';
import {
  classifyInternalMachineClassLetValue,
  classifyInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value.js';
import type { InternalEffectMachineState } from './internal-effect-machine-types.js';
import {
  coerceToString,
  evalNumberBinary,
  evalOrderedComparison,
  evalPlusOperator,
} from './portable-core-evaluator.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableScalar, type PortableScalar, portableTruthy, sameType } from './portable-scalar-domain.js';
import type { RunnerClassInstanceValue, SemanticEnv } from './semantic-env.js';
import type { TraceEvent } from './trace.js';

function evaluated(value: PortableScalar, events: readonly TraceEvent[] = []): InternalMachineClassEvaluatedValue {
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
