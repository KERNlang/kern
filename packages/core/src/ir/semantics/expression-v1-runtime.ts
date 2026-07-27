import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { evalArrayLiteralValue, isArrayLiteralExpression } from './portable-array.js';
import {
  evalDecimalExpression,
  isDecimalValueExpression,
  isRunnerNativeDecimalFailClose,
} from './portable-decimal-evaluator.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import {
  evalRecordArrayFieldReferenceValue,
  evalRecordLiteralValue,
  isRecordLiteralExpression,
  recordArrayFieldsFromValue,
} from './portable-record-evaluator.js';
import {
  evalRegexGlobalMatchExpression,
  evalRegexMatchAllExpression,
  evalRegexMatchExpression,
  evalRegexReplaceExpression,
  evalRegexSplitExpression,
  evalRegexTestExpression,
  isRegexGlobalMatchExpression,
  isRegexMatchAllExpression,
  isRegexMatchExpression,
  isRegexReplaceExpression,
  isRegexSplitExpression,
  isRegexTestExpression,
  isRunnerNativeRegexFailClose,
  makeRegExpMatchListValue,
  makeRegExpMatchValue,
} from './portable-regex.js';
import { isPortableBindingName, makeDecimalValue } from './portable-scalar-domain.js';
import {
  defineArrayAliasBinding,
  defineBinding,
  defineCapturedArrayBinding,
  defineFreshArrayBinding,
  defineRecordBinding,
  getBinding,
  hasBinding,
  hasOwnBinding,
  type SemanticEnv,
} from './semantic-env.js';
import type { Trace } from './trace.js';

interface ExpressionV1Props {
  readonly name?: string;
  readonly expr?: unknown;
}

function propsOf(node: IRNode): ExpressionV1Props {
  return (node.props ?? {}) as ExpressionV1Props;
}

function hasExpressionCode(value: unknown): value is { readonly __expr: true; readonly code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __expr?: unknown }).__expr === true &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

export function expressionV1Source(node: IRNode): string | undefined {
  const value = propsOf(node).expr;
  if (value === undefined || value === null) return undefined;
  if (hasExpressionCode(value)) return value.code;
  return String(value);
}

export function expressionV1Parsed(node: IRNode): ValueIR {
  const source = expressionV1Source(node);
  if (source === undefined || source === '') throw new Error('expression-v1: missing expr');
  return parseExpression(source);
}

export function assertExpressionV1BasicShape(node: IRNode): ValueIR {
  if (node.type !== 'expression-v1') throw new Error('expression-v1: wrong node type');
  if (!isPortableBindingName(propsOf(node).name)) {
    throw new Error('expression-v1: name must be a portable identifier');
  }
  if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > 0)) {
    throw new Error('expression-v1: must not contain a body');
  }
  if (!Object.hasOwn(node.props ?? {}, 'expr')) throw new Error('expression-v1: missing expr');
  return expressionV1Parsed(node);
}

function routesToNativeDecimal(parsed: ValueIR, env: SemanticEnv): boolean {
  return isDecimalValueExpression(parsed) && !hasBinding(env, 'Decimal');
}

function routesToNativeRegexTest(parsed: ValueIR, env: SemanticEnv): boolean {
  return isRegexTestExpression(parsed) && !hasBinding(env, 'RegExp');
}

function routesToNativeRegexMatch(parsed: ValueIR, env: SemanticEnv): boolean {
  return isRegexMatchExpression(parsed) && !hasBinding(env, 'RegExp');
}

function routesToNativeRegexGlobalMatch(parsed: ValueIR, env: SemanticEnv): boolean {
  return isRegexGlobalMatchExpression(parsed) && !hasBinding(env, 'RegExp');
}

function routesToNativeRegexMatchAll(parsed: ValueIR, env: SemanticEnv): boolean {
  return isRegexMatchAllExpression(parsed) && !hasBinding(env, 'RegExp');
}

function routesToNativeRegexSplit(parsed: ValueIR, env: SemanticEnv): boolean {
  return isRegexSplitExpression(parsed) && !hasBinding(env, 'RegExp');
}

function routesToNativeRegexReplace(parsed: ValueIR, env: SemanticEnv): boolean {
  return isRegexReplaceExpression(parsed) && !hasBinding(env, 'RegExp');
}

type ShouldRethrowExpressionV1Error = (error: unknown) => boolean;

function nativeTrial(
  parsed: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  shouldRethrow?: ShouldRethrowExpressionV1Error,
): boolean | undefined {
  try {
    if (routesToNativeDecimal(parsed, env)) evalDecimalExpression(parsed, env);
    else if (routesToNativeRegexTest(parsed, env)) evalRegexTestExpression(parsed, env, evaluate);
    else if (routesToNativeRegexMatch(parsed, env)) evalRegexMatchExpression(parsed, env, evaluate);
    else if (routesToNativeRegexGlobalMatch(parsed, env)) evalRegexGlobalMatchExpression(parsed, env, evaluate);
    else if (routesToNativeRegexMatchAll(parsed, env)) evalRegexMatchAllExpression(parsed, env, evaluate);
    else if (routesToNativeRegexSplit(parsed, env)) evalRegexSplitExpression(parsed, env, evaluate);
    else if (routesToNativeRegexReplace(parsed, env)) evalRegexReplaceExpression(parsed, env, evaluate);
    else return undefined;
    return true;
  } catch (error) {
    if (shouldRethrow?.(error)) throw error;
    return isRunnerNativeDecimalFailClose(error) || isRunnerNativeRegexFailClose(error);
  }
}

export function expressionV1Preconditions(
  node: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  shouldRethrow?: ShouldRethrowExpressionV1Error,
): boolean {
  try {
    const parsed = assertExpressionV1BasicShape(node);
    const name = propsOf(node).name as string;
    if (hasOwnBinding(env, name)) return false;
    const native = nativeTrial(parsed, env, evaluate, shouldRethrow);
    if (native !== undefined) return native;
    if (isArrayLiteralExpression(parsed)) evalArrayLiteralValue(parsed, env, evaluate);
    else if (isRecordLiteralExpression(parsed)) {
      evalRecordLiteralValue(parsed, env, evaluate, {
        captureFreshArrayBindings: false,
      });
    } else if (evalRecordArrayFieldReferenceValue(parsed, env) !== undefined) return true;
    else if (parsed.kind === 'ident' && hasBinding(env, parsed.name) && Array.isArray(getBinding(env, parsed.name))) {
      return true;
    } else evaluate(parsed, env);
    return true;
  } catch (error) {
    if (shouldRethrow?.(error)) throw error;
    return false;
  }
}

export function runExpressionV1(node: IRNode, env: SemanticEnv, evaluate: EvalPortableValue): Trace {
  const parsed = assertExpressionV1BasicShape(node);
  const name = propsOf(node).name as string;
  if (hasOwnBinding(env, name)) throw new Error(`expression-v1: binding "${name}" already exists`);
  let value: unknown;
  if (routesToNativeDecimal(parsed, env)) {
    value = evalDecimalExpression(parsed, env);
    defineBinding(env, name, makeDecimalValue(value as string));
  } else if (routesToNativeRegexTest(parsed, env)) {
    value = evalRegexTestExpression(parsed, env, evaluate);
    defineBinding(env, name, value);
  } else if (routesToNativeRegexMatch(parsed, env)) {
    const match = evalRegexMatchExpression(parsed, env, evaluate);
    value = match;
    defineBinding(env, name, match === null ? null : makeRegExpMatchValue(match));
  } else if (routesToNativeRegexGlobalMatch(parsed, env)) {
    const matches = evalRegexGlobalMatchExpression(parsed, env, evaluate);
    value = matches;
    defineBinding(env, name, matches === null ? null : makeRegExpMatchListValue(matches));
  } else if (routesToNativeRegexMatchAll(parsed, env)) {
    value = evalRegexMatchAllExpression(parsed, env, evaluate);
    defineBinding(env, name, makeRegExpMatchListValue(value as readonly unknown[]));
  } else if (routesToNativeRegexSplit(parsed, env)) {
    value = evalRegexSplitExpression(parsed, env, evaluate);
    defineBinding(env, name, makeRegExpMatchListValue(value as readonly unknown[]));
  } else if (routesToNativeRegexReplace(parsed, env)) {
    value = evalRegexReplaceExpression(parsed, env, evaluate);
    defineBinding(env, name, value);
  } else if (isArrayLiteralExpression(parsed)) {
    value = evalArrayLiteralValue(parsed, env, evaluate);
    defineFreshArrayBinding(env, name, value as readonly unknown[]);
  } else if (isRecordLiteralExpression(parsed)) {
    value = evalRecordLiteralValue(parsed, env, evaluate, {
      captureFreshArrayBindings: true,
    });
    defineRecordBinding(env, name, value, recordArrayFieldsFromValue(value));
  } else {
    const recordArrayField = evalRecordArrayFieldReferenceValue(parsed, env);
    if (recordArrayField !== undefined) {
      value = recordArrayField;
      defineCapturedArrayBinding(env, name, recordArrayField);
    } else if (parsed.kind === 'ident' && hasBinding(env, parsed.name) && Array.isArray(getBinding(env, parsed.name))) {
      value = getBinding(env, parsed.name);
      defineArrayAliasBinding(env, name, parsed.name, value);
    } else {
      value = evaluate(parsed, env);
      defineBinding(env, name, value);
    }
  }
  return {
    events: [{ op: 'assign', target: name, value }],
    completion: { kind: 'normal' },
  };
}
