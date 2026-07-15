import type { IRNode } from '../../types.js';
import { assertExpressionV1BasicShape, expressionV1Preconditions, runExpressionV1 } from './expression-v1-runtime.js';
import { isDecimalValueExpression } from './portable-decimal-evaluator.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableMachineLetShape, assertPortableMachineScalarShape } from './portable-machine-shape.js';
import {
  isRegexGlobalMatchExpression,
  isRegexMatchAllExpression,
  isRegexMatchExpression,
  isRegexReplaceExpression,
  isRegexSplitExpression,
  isRegexTestExpression,
} from './portable-regex.js';
import type { SemanticEnv } from './semantic-env.js';
import type { Trace } from './trace.js';

function isNativeRegexShape(parsed: ReturnType<typeof assertExpressionV1BasicShape>): boolean {
  return (
    isRegexTestExpression(parsed) ||
    isRegexMatchExpression(parsed) ||
    isRegexGlobalMatchExpression(parsed) ||
    isRegexMatchAllExpression(parsed) ||
    isRegexSplitExpression(parsed) ||
    isRegexReplaceExpression(parsed)
  );
}

export function assertInternalMachineExpressionV1Shape(node: IRNode): void {
  const parsed = assertExpressionV1BasicShape(node);
  if (isDecimalValueExpression(parsed) || isNativeRegexShape(parsed)) return;
  if (parsed.kind === 'arrayLit' || parsed.kind === 'objectLit') {
    assertPortableMachineLetShape(parsed);
    return;
  }
  assertPortableMachineScalarShape(parsed);
}

export function runInternalMachineExpressionV1(node: IRNode, env: SemanticEnv): Trace {
  assertInternalMachineExpressionV1Shape(node);
  if (!expressionV1Preconditions(node, env, evalPortableValue)) {
    throw new Error('expression-v1: preconditions failed');
  }
  return runExpressionV1(node, env, evalPortableValue);
}
