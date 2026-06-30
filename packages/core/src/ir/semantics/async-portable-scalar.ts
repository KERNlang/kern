import { CAPABILITY_DESCRIPTORS } from '../../runner-capability-plan.js';
import type { ValueIR } from '../../value-ir.js';
import { isIntProvenanced, makeEnv, type RunnerFunctionBinding, type SemanticEnv } from './index.js';
import {
  assertPortableScalar,
  coerceToString,
  evalNumberBinary,
  evalOrderedComparison,
  evalPortableValue,
  isCaughtErrorValue,
  isDecimalValue,
  isSafeIntegerLiteralIndex,
  type PortableScalar,
  portableTruthy,
  sameType,
} from './portable-scalar.js';
import type { Trace } from './trace.js';

const MAX_RUNNER_CALL_DEPTH = 64;

export interface AsyncPortableEvalOptions {
  readonly runFunctionBody: (body: readonly import('../../types.js').IRNode[], env: SemanticEnv) => Promise<Trace>;
}

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

export async function evalPortableValueAsync(
  node: ValueIR,
  env: SemanticEnv,
  options: AsyncPortableEvalOptions,
): Promise<PortableScalar> {
  switch (node.kind) {
    case 'numLit':
    case 'strLit':
    case 'boolLit':
    case 'nullLit':
    case 'ident':
    case 'member':
    case 'index':
      return evalPortableValue(node, env);
    case 'unary': {
      const value = await evalPortableValueAsync(node.argument, env, options);
      if (node.op === '!') return !portableTruthy(value);
      if (node.op === '-' || node.op === '+') {
        if (typeof value !== 'number') throw new Error(`portable: unary ${node.op} requires a number`);
        const out = node.op === '-' ? -value : value;
        return assertPortableScalar(out, `unary ${node.op}`);
      }
      throw new Error(`portable: unsupported unary op "${node.op}"`);
    }
    case 'binary':
      return evalPortableBinaryAsync(node, env, options);
    case 'conditional':
      return portableTruthy(await evalPortableValueAsync(node.test, env, options))
        ? evalPortableValueAsync(node.consequent, env, options)
        : evalPortableValueAsync(node.alternate, env, options);
    case 'typeAssert':
    case 'nonNull':
      return evalPortableValueAsync(node.expression, env, options);
    case 'tmplLit': {
      let result = '';
      for (let i = 0; i < node.quasis.length; i += 1) {
        result += node.quasis[i];
        if (i < node.expressions.length) {
          const val = await evalPortableValueAsync(node.expressions[i], env, options);
          result += coerceToString(val);
        }
      }
      return result;
    }
    case 'call': {
      if (node.optional) throw new Error('portable: optional calls are outside the portable scalar domain');
      if (node.callee.kind === 'ident' && node.callee.name === 'String') {
        if (node.args.length !== 1) throw new Error('portable: String() expects exactly 1 argument');
        return coerceToString(await evalPortableValueAsync(node.args[0], env, options));
      }
      if (node.callee.kind === 'ident') return evalRunnerFunctionCallAsync(node.callee.name, node.args, env, options);
      return evalPortableValue(node, env);
    }
    default:
      return evalPortableValue(node, env);
  }
}

async function evalPortableBinaryAsync(
  node: Extract<ValueIR, { kind: 'binary' }>,
  env: SemanticEnv,
  options: AsyncPortableEvalOptions,
): Promise<PortableScalar> {
  if (node.op === '&&') {
    const left = await evalPortableValueAsync(node.left, env, options);
    return portableTruthy(left) ? evalPortableValueAsync(node.right, env, options) : left;
  }
  if (node.op === '||') {
    const left = await evalPortableValueAsync(node.left, env, options);
    return portableTruthy(left) ? left : evalPortableValueAsync(node.right, env, options);
  }
  if (node.op === '??') {
    const left = await evalPortableValueAsync(node.left, env, options);
    return left === null ? evalPortableValueAsync(node.right, env, options) : left;
  }

  const left = await evalPortableValueAsync(node.left, env, options);
  const right = await evalPortableValueAsync(node.right, env, options);
  switch (node.op) {
    case '+':
      if (typeof left === 'number' && typeof right === 'number') return assertPortableScalar(left + right, '+');
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      throw new Error('portable: + requires two numbers or two strings');
    case '-':
    case '*':
    case '/':
    case '%':
      return evalNumberBinary(node.op, left, right);
    case '===':
    case '==':
      return sameType(left, right) ? left === right : false;
    case '!==':
    case '!=':
      return sameType(left, right) ? left !== right : true;
    case '<':
    case '<=':
    case '>':
    case '>=':
      if (
        !sameType(left, right) ||
        !(
          (typeof left === 'number' && typeof right === 'number') ||
          (typeof left === 'string' && typeof right === 'string')
        )
      ) {
        throw new Error(`portable: ${node.op} requires same-typed number or string operands`);
      }
      return evalOrderedComparison(node.op, left, right);
    default:
      throw new Error(`portable: unsupported binary op "${node.op}"`);
  }
}

async function evalRunnerFunctionCallAsync(
  fnName: string,
  args: readonly ValueIR[],
  env: SemanticEnv,
  options: AsyncPortableEvalOptions,
): Promise<PortableScalar> {
  const functions = runnerFunctionsForEnv(env);
  const fn = functions?.get(fnName);
  if (!fn) throw new Error(`portable: unsupported call to "${fnName}"`);
  if (args.length !== fn.params.length) {
    throw new Error(`portable: function "${fnName}" expects ${fn.params.length} arguments, got ${args.length}`);
  }

  const callStack = runnerCallStackForEnv(env);
  if (callStack.includes(fnName)) throw new Error(`portable: recursive function call "${fnName}" is unsupported`);
  if (callStack.length >= MAX_RUNNER_CALL_DEPTH) throw new Error('portable: runner function call depth exceeded');

  const bindings = new Map<string, unknown>();
  const intProvenance = new Set<string>();
  for (let index = 0; index < fn.params.length; index += 1) {
    const arg = args[index];
    const value = await evalPortableValueAsync(arg, env, options);
    const isSafeIntArg = isSafeIntegerLiteralIndex(arg) || (arg.kind === 'ident' && isIntProvenanced(env, arg.name));
    bindings.set(fn.params[index], value);
    if (isSafeIntArg) intProvenance.add(fn.params[index]);
  }

  const callEnv = makeEnv({
    bindings,
    intProvenance,
    runnerFunctions: functions,
    runnerCallStack: [...callStack, fnName],
    capabilities: undefined,
    capabilityContext: env.capabilityContext,
    seed: env.seed,
    now: env.now,
  });
  const trace = await options.runFunctionBody(fn.body, callEnv);
  if (trace.events.some(isDisallowedHelperSideEffect)) {
    throw new Error(`portable: function "${fnName}" produced side effects`);
  }
  if (trace.completion.kind !== 'return') {
    throw new Error(`portable: function "${fnName}" must return a portable scalar`);
  }
  return assertPortableScalar(trace.completion.value, `function "${fnName}" return`);
}

function isDisallowedHelperSideEffect(event: Trace['events'][number]): boolean {
  if (event.op === 'stdout' || event.op === 'stderr' || event.op === 'call') return true;
  if (event.op !== 'capability') return false;
  const id = `${event.namespace}.${event.operation}` as keyof typeof CAPABILITY_DESCRIPTORS;
  return CAPABILITY_DESCRIPTORS[id]?.syncBoundary !== 'async-planned';
}

export function portableRecordScalarFieldAsync(obj: unknown, recordName: string, property: string): PortableScalar {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`portable: member access on "${recordName}" is outside the portable scalar domain`);
  }
  if (isDecimalValue(obj) || isCaughtErrorValue(obj)) {
    throw new Error(`portable: member access on "${recordName}" is outside the portable scalar domain`);
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`portable: member access on "${recordName}" is outside the portable scalar domain`);
  }
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new Error(`portable: record "${recordName}" is outside the portable scalar domain`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(obj, property);
  if (!descriptor) throw new Error(`portable: record "${recordName}" has no field "${property}"`);
  if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
    throw new Error(`portable: record "${recordName}" field "${property}" is outside the portable scalar domain`);
  }
  return assertPortableScalar(descriptor.value, `field "${recordName}.${property}"`);
}
