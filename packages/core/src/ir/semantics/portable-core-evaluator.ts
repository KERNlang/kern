import { isValueIR, type ValueIR } from '../../value-ir.js';
import { isCaughtErrorValue } from './caught-error.js';
import { getBinding, hasBinding, type SemanticEnv } from './index.js';
import { evalRunnerNativeDecimalScalarCall } from './portable-decimal-evaluator.js';
import {
  type EvalPortableValue,
  PORTABLE_EVAL_NOT_HANDLED,
  type PortableEvaluatorHost,
} from './portable-eval-types.js';
import { evalMapReadCall } from './portable-map.js';
import {
  PORTABLE_RECORD_FIELD_MISSING,
  portableNestedArrayField,
  portableNestedIndexArrayField,
  portableRecordScalarField,
} from './portable-record-evaluator.js';
import {
  assertArithmeticResultNotFloatCollapsed,
  assertPortableScalar,
  isIntProvenancedExpr,
  isPortableBindingName,
  isSafeIntegerLiteralIndex,
  type PortableScalar,
  portableTruthy,
  sameType,
} from './portable-scalar-domain.js';
import { evalStringOpCall } from './portable-string.js';

export interface PortableEvaluator {
  readonly evalPortableBinary: (node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv) => PortableScalar;
  readonly evalPortableValue: EvalPortableValue;
}

export function createPortableEvaluator(host: PortableEvaluatorHost): PortableEvaluator {
  const evaluate: EvalPortableValue = (node, env) => {
    switch (node.kind) {
      case 'numLit': {
        if (node.bigint || !Number.isFinite(node.value)) throw new Error('portable: number literal must be finite');
        if (!env.intIndexCtx && (node.raw.includes('.') || /[eE]/.test(node.raw)) && Number.isInteger(node.value)) {
          throw new Error('portable: float literal has an integer value (float/int divergence)');
        }
        return node.value;
      }
      case 'strLit':
        return node.value;
      case 'boolLit':
        return node.value;
      case 'nullLit':
        return null;
      case 'ident': {
        if (!hasBinding(env, node.name)) throw new Error(`portable: binding "${node.name}" not found`);
        return assertPortableScalar(getBinding(env, node.name), `binding "${node.name}"`);
      }
      case 'unary': {
        const value = evaluate(node.argument, env);
        if (node.op === '!') return !portableTruthy(value);
        if (node.op === '-' || node.op === '+') {
          if (typeof value !== 'number') throw new Error(`portable: unary ${node.op} requires a number`);
          return assertPortableScalar(node.op === '-' ? -value : value, `unary ${node.op}`);
        }
        throw new Error(`portable: unsupported unary op "${node.op}"`);
      }
      case 'binary':
        return evalBinary(node, env);
      case 'conditional':
        return portableTruthy(evaluate(node.test, env))
          ? evaluate(node.consequent, env)
          : evaluate(node.alternate, env);
      case 'member':
        return evalMember(node, env);
      case 'index':
        return evalIndex(node, env);
      case 'typeAssert':
      case 'nonNull':
        return evaluate(node.expression, env);
      case 'tmplLit': {
        let result = '';
        for (let index = 0; index < node.quasis.length; index += 1) {
          result += node.quasis[index];
          if (index < node.expressions.length) result += coerceToString(evaluate(node.expressions[index], env));
        }
        return result;
      }
      case 'call': {
        if (node.optional) throw new Error('portable: optional calls are outside the portable scalar domain');
        const decimal = evalRunnerNativeDecimalScalarCall(node, env);
        if (decimal !== undefined) return decimal;
        const method = host.classMethod(node, env, evaluate);
        if (method !== PORTABLE_EVAL_NOT_HANDLED) return method;
        if (node.callee.kind === 'ident' && node.callee.name === 'String') {
          if (node.args.length !== 1) throw new Error('portable: String() expects exactly 1 argument');
          return coerceToString(evaluate(node.args[0], env));
        }
        const listLength = evalListLength(node, env);
        if (listLength !== undefined) return listLength;
        const map = evalMapReadCall(node, env, evaluate);
        if (map !== undefined) return map;
        const text = evalStringOpCall(node, env, evaluate);
        if (text !== undefined) return text;
        if (node.callee.kind === 'ident') return host.functionCall(node.callee.name, node.args, env, evaluate);
        throw new Error('portable: unsupported non-identifier call');
      }
      default:
        throw new Error(`portable: expression kind "${node.kind}" is outside the portable scalar domain`);
    }
  };

  function evalMember(node: Extract<ValueIR, { kind: 'member' }>, env: SemanticEnv): PortableScalar {
    const hosted = host.classMember(node, env, evaluate);
    if (hosted !== PORTABLE_EVAL_NOT_HANDLED) return hosted;
    if (node.optional) throw new Error('portable: optional member access is outside the portable scalar domain');
    const nested = portableNestedArrayField(node, env);
    if (nested !== PORTABLE_RECORD_FIELD_MISSING) {
      if (node.property !== 'length') {
        throw new Error(
          `portable: nested array field "${nested.recordName}.${nested.fieldName}" has no portable property "${node.property}" (only .length is admitted)`,
        );
      }
      return nested.value.length;
    }
    if (!isValueIR(node.object) || node.object.kind !== 'ident') {
      throw new Error('portable: member access is only admitted on an array, record, or caught-error binding');
    }
    if (!hasBinding(env, node.object.name)) throw new Error(`portable: binding "${node.object.name}" not found`);
    const object = getBinding(env, node.object.name);
    if (Array.isArray(object)) {
      if (node.property !== 'length') {
        throw new Error(`portable: array has no portable property "${node.property}" (only .length is admitted)`);
      }
      return object.length;
    }
    const field = portableRecordScalarField(object, node.object.name, node.property);
    if (field !== PORTABLE_RECORD_FIELD_MISSING) return field;
    if (!isCaughtErrorValue(object)) {
      throw new Error(`portable: member access on "${node.object.name}" is outside the portable scalar domain`);
    }
    if (node.property !== 'message') {
      throw new Error(`portable: caught error has no portable property "${node.property}" (only .message is admitted)`);
    }
    return object.message;
  }

  function evalIndex(node: Extract<ValueIR, { kind: 'index' }>, env: SemanticEnv): PortableScalar {
    if (node.optional) throw new Error('portable: optional index access is outside the portable scalar domain');
    const nested = portableNestedIndexArrayField(node, env);
    if (nested !== PORTABLE_RECORD_FIELD_MISSING) {
      if (!isValueIR(node.index) || !isSafeIntegerLiteralIndex(node.index)) {
        throw new Error('portable: nested array index must be a bare non-negative safe-integer literal');
      }
      const index = evaluate(node.index, env);
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= nested.value.length) {
        throw new Error('portable: nested array index must be an in-bounds non-negative safe integer');
      }
      if (!(index in nested.value)) throw new Error('portable: nested array index must point at an existing element');
      return assertPortableScalar(nested.value[index], `element "${nested.recordName}.${nested.fieldName}[${index}]"`);
    }
    if (!isValueIR(node.object) || node.object.kind !== 'ident') {
      throw new Error('portable: index access is only admitted on an array-binding identifier');
    }
    if (!isValueIR(node.index) || !isIntProvenancedExpr(node.index, env)) {
      throw new Error(
        'portable: array index must be a bare non-negative safe-integer literal, an integer-provenanced loop counter, or +/- arithmetic between them',
      );
    }
    if (!hasBinding(env, node.object.name)) throw new Error(`portable: binding "${node.object.name}" not found`);
    const array = getBinding(env, node.object.name);
    if (!Array.isArray(array)) {
      throw new Error(`portable: index access on "${node.object.name}" requires an array binding`);
    }
    const index = evaluate(node.index, env);
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= array.length) {
      throw new Error('portable: array index must be an in-bounds non-negative safe integer');
    }
    if (!(index in array)) throw new Error('portable: array index must point at an existing element');
    return assertPortableScalar(array[index], `element "${node.object.name}[${index}]"`);
  }

  function evalListLength(node: Extract<ValueIR, { kind: 'call' }>, env: SemanticEnv): number | undefined {
    if (node.optional) return undefined;
    const callee = node.callee;
    if (callee.kind !== 'member' || callee.optional || callee.property !== 'length') return undefined;
    if (callee.object.kind !== 'ident' || callee.object.name !== 'List' || hasBinding(env, 'List')) return undefined;
    if (node.args.length !== 1) throw new Error('portable: List.length expects exactly 1 argument');
    const argument = node.args[0];
    if (!isValueIR(argument) || argument.kind !== 'ident') {
      throw new Error('portable: List.length argument must be a bare array-binding identifier');
    }
    if (!isPortableBindingName(argument.name)) {
      throw new Error('portable: List.length argument must be a bare array-binding identifier');
    }
    if (!hasBinding(env, argument.name)) throw new Error(`portable: binding "${argument.name}" not found`);
    const value = getBinding(env, argument.name);
    if (!Array.isArray(value)) throw new Error(`portable: "${argument.name}" is not an array binding`);
    return value.length;
  }

  function evalBinary(node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv): PortableScalar {
    if (node.op === '&&') {
      const left = evaluate(node.left, env);
      return portableTruthy(left) ? evaluate(node.right, env) : left;
    }
    if (node.op === '||') {
      const left = evaluate(node.left, env);
      return portableTruthy(left) ? left : evaluate(node.right, env);
    }
    if (node.op === '??') {
      const left = evaluate(node.left, env);
      return left === null ? evaluate(node.right, env) : left;
    }
    const left = evaluate(node.left, env);
    const right = evaluate(node.right, env);
    switch (node.op) {
      case '+':
        return evalPlusOperator(left, right, env);
      case '-':
      case '*':
      case '/':
      case '%':
        return evalNumberBinary(node.op, left, right, env);
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

  return { evalPortableBinary: evalBinary, evalPortableValue: evaluate };
}

export function coerceToString(value: PortableScalar): string {
  return value === null ? 'null' : String(value);
}

export function evalPlusOperator(left: PortableScalar, right: PortableScalar, env: SemanticEnv): PortableScalar {
  if (typeof left === 'number' && typeof right === 'number') {
    const result = assertPortableScalar(left + right, '+');
    return env.intIndexCtx ? result : assertArithmeticResultNotFloatCollapsed(left, right, result, '+');
  }
  if (typeof left === 'string' && typeof right === 'string') return left + right;
  throw new Error('portable: + requires two numbers or two strings');
}

export function evalNumberBinary(
  op: string,
  left: PortableScalar,
  right: PortableScalar,
  env: SemanticEnv,
): PortableScalar {
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`portable: ${op} requires numbers`);
  let result: PortableScalar;
  if (op === '-') result = assertPortableScalar(left - right, op);
  else if (op === '*') result = assertPortableScalar(left * right, op);
  else if (op === '/') result = assertPortableScalar(left / right, op);
  else result = assertPortableScalar(left % right, op);
  return env.intIndexCtx ? result : assertArithmeticResultNotFloatCollapsed(left, right, result, op);
}

export function evalOrderedComparison(op: string, left: string | number, right: string | number): boolean {
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  return left >= right;
}
