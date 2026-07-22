import { isWellFormedText } from '../../codegen/text-contract.js';
import { DECIMAL_DIV_ZERO_FAILCLOSE, DECIMAL_MOD_ZERO_FAILCLOSE } from '../../decimal/contract.js';
import { assertPortableDecimalPow } from '../../decimal/probe-gates.js';
import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { isSyntacticallyStringMapKey } from './deferred-map-key.js';
import { expressionV1Parsed } from './expression-v1-runtime.js';
import {
  internalMachineClassGetterForRead,
  internalMachineClassMethodForCall,
} from './internal-effect-machine-class-graph.js';
import {
  classifyInternalMachineClassHelperArgument,
  classifyInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value.js';
import { assertInternalMachineDoNamespaceAvailable, parseInternalMachineDo } from './internal-effect-machine-do.js';
import { assertDeferredInternalMachineHelperArgument } from './internal-effect-machine-helper-argument-preflight.js';
import { internalMachineHelperCallInValue } from './internal-effect-machine-helper-graph.js';
import { evalDecimalExpression, isDecimalExpression, isDecimalValueExpression } from './portable-decimal-evaluator.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableMachineLetShape, assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { isPortableMapValue } from './portable-map.js';
import { evalRecordArrayFieldReferenceValue } from './portable-record-evaluator.js';
import {
  isRegexGlobalMatchExpression,
  isRegexMatchAllExpression,
  isRegexMatchExpression,
  isRegexReplaceExpression,
  isRegexSplitExpression,
  isRegexTestExpression,
} from './portable-regex.js';
import {
  assertRunnerPortableValue,
  isIntProvenancedExpr,
  isRunnerClassInstanceValue,
  portableTruthy,
} from './portable-scalar-domain.js';
import { getBinding, hasBinding, isCapturedArrayBinding, type SemanticEnv } from './semantic-env.js';

export function expressionHasDeferredBinding(node: ValueIR, deferredBindings: ReadonlySet<string>): boolean {
  if (node.kind === 'ident') return deferredBindings.has(node.name);
  if (node.kind === 'unary' || node.kind === 'new') {
    return expressionHasDeferredBinding(node.argument, deferredBindings);
  }
  if (node.kind === 'binary') {
    return (
      expressionHasDeferredBinding(node.left, deferredBindings) ||
      expressionHasDeferredBinding(node.right, deferredBindings)
    );
  }
  if (node.kind === 'conditional') {
    return (
      expressionHasDeferredBinding(node.test, deferredBindings) ||
      expressionHasDeferredBinding(node.consequent, deferredBindings) ||
      expressionHasDeferredBinding(node.alternate, deferredBindings)
    );
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    return expressionHasDeferredBinding(node.expression, deferredBindings);
  }
  if (node.kind === 'tmplLit') {
    return node.expressions.some((expression) => expressionHasDeferredBinding(expression, deferredBindings));
  }
  if (node.kind === 'member') return expressionHasDeferredBinding(node.object, deferredBindings);
  if (node.kind === 'index') {
    return (
      expressionHasDeferredBinding(node.object, deferredBindings) ||
      expressionHasDeferredBinding(node.index, deferredBindings)
    );
  }
  if (node.kind === 'call') {
    return node.args.some((argument) => expressionHasDeferredBinding(argument, deferredBindings));
  }
  if (node.kind === 'arrayLit') {
    return node.items.some((item) => expressionHasDeferredBinding(item, deferredBindings));
  }
  if (node.kind === 'objectLit') {
    return node.entries.some((entry) =>
      expressionHasDeferredBinding('kind' in entry ? entry.argument : entry.value, deferredBindings),
    );
  }
  if (node.kind === 'spread' || node.kind === 'await' || node.kind === 'propagate') {
    return expressionHasDeferredBinding(node.argument, deferredBindings);
  }
  return false;
}

export function expressionRequiresDeferredMachinePreflight(
  node: ValueIR,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): boolean {
  return expressionHasDeferredBinding(node, deferredBindings) || internalMachineHelperCallInValue(node, env);
}

function scalarRequiresDeferredMachinePreflight(
  node: ValueIR,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): boolean {
  return (
    classifyInternalMachineClassScalarValue(node, env) === 'suspending' ||
    expressionRequiresDeferredMachinePreflight(node, env, deferredBindings)
  );
}

export function assertDeferredMachineScalarPreflight(
  node: ValueIR,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  const classDisposition = classifyInternalMachineClassScalarValue(node, env);
  if (classDisposition === 'unsupported') assertPortableMachineScalarShape(node, env);
  if (!scalarRequiresDeferredMachinePreflight(node, env, deferredBindings)) {
    evalPortableValue(node, env);
    return;
  }
  if (node.kind === 'ident') return;
  if (node.kind === 'unary') {
    assertDeferredMachineScalarPreflight(node.argument, env, deferredBindings);
    return;
  }
  if (node.kind === 'binary') {
    assertDeferredBinary(node, env, deferredBindings);
    return;
  }
  if (node.kind === 'conditional') {
    if (scalarRequiresDeferredMachinePreflight(node.test, env, deferredBindings)) {
      assertDeferredMachineScalarPreflight(node.test, env, deferredBindings);
      return;
    }
    const test = evalPortableValue(node.test, env);
    assertDeferredMachineScalarPreflight(
      portableTruthy(test) ? node.consequent : node.alternate,
      env,
      deferredBindings,
    );
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertDeferredMachineScalarPreflight(node.expression, env, deferredBindings);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) {
      assertDeferredMachineScalarPreflight(expression, env, deferredBindings);
    }
    return;
  }
  if (node.kind === 'member') {
    if (internalMachineClassGetterForRead(node, env)) return;
    if (node.object.kind === 'ident') {
      const receiver =
        node.object.name === 'this'
          ? env.runnerThis
          : hasBinding(env, node.object.name)
            ? getBinding(env, node.object.name)
            : undefined;
      if (isRunnerClassInstanceValue(receiver)) {
        if (!Object.hasOwn(receiver.fields, node.property)) {
          throw new Error(`machine class: class "${receiver.className}" has no field "${node.property}"`);
        }
        if (receiver.fields[node.property] === undefined) {
          throw new Error(`machine class: field "${node.property}" is uninitialized`);
        }
      }
    }
    return;
  }
  if (node.kind === 'index') {
    assertDeferredIndex(node, env, deferredBindings);
    return;
  }
  if (node.kind === 'call') {
    assertDeferredCall(node, env, deferredBindings);
    return;
  }
  throw new Error(`portable machine: deferred expression ${node.kind} is outside the scalar preflight domain`);
}

export function assertDeferredMachineLeafKnownValues(
  node: IRNode,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  if (node.type === 'break' || node.type === 'continue') return;
  if (node.type === 'do') {
    assertDeferredDo(node, env, deferredBindings);
    return;
  }
  if (node.type === 'expression-v1') {
    assertDeferredExpressionV1(node, env, deferredBindings);
    return;
  }
  if (node.type === 'fmt') {
    const parsed = parseExpression(`\`${String(node.props?.template)}\``);
    if (parsed.kind !== 'tmplLit') throw new Error('fmt: invalid template');
    for (const expression of parsed.expressions) {
      assertDeferredMachineScalarPreflight(expression, env, deferredBindings);
    }
    return;
  }
  const raw = node.props?.value;
  if (typeof raw !== 'string' || raw === '') return;
  const parsed = parseExpression(raw);
  if (parsed.kind === 'arrayLit') return;
  if (parsed.kind === 'objectLit') {
    for (const entry of parsed.entries) {
      if (!('kind' in entry) && entry.value.kind !== 'arrayLit') {
        assertDeferredMachineScalarPreflight(entry.value, env, deferredBindings);
      }
    }
    return;
  }
  const expression = node.type === 'throw' ? explicitErrorArgument(parsed) : parsed;
  if (expression) assertDeferredMachineScalarPreflight(expression, env, deferredBindings);
}

function assertDeferredExpressionV1(node: IRNode, env: SemanticEnv, deferredBindings: ReadonlySet<string>): void {
  const parsed = expressionV1Parsed(node);
  if (isDecimalValueExpression(parsed)) {
    if (hasBinding(env, 'Decimal')) throw new Error('portable machine: namespace "Decimal" is shadowed');
    assertDeferredDecimalOperand(parsed, env, deferredBindings);
    return;
  }
  if (isRegexTestExpression(parsed)) {
    if (hasBinding(env, 'RegExp')) throw new Error('portable machine: namespace "RegExp" is shadowed');
    if (parsed.kind !== 'call') throw new Error('portable machine: invalid deferred regex test');
    assertDeferredMachineScalarPreflight(parsed.args[0], env, deferredBindings);
    return;
  }
  if (
    isRegexMatchExpression(parsed) ||
    isRegexGlobalMatchExpression(parsed) ||
    isRegexMatchAllExpression(parsed) ||
    isRegexSplitExpression(parsed) ||
    isRegexReplaceExpression(parsed)
  ) {
    if (hasBinding(env, 'RegExp')) throw new Error('portable machine: namespace "RegExp" is shadowed');
    if (parsed.kind !== 'call' || parsed.callee.kind !== 'member') {
      throw new Error('portable machine: invalid deferred regex expression');
    }
    assertDeferredMachineScalarPreflight(parsed.callee.object, env, deferredBindings);
    return;
  }
  if (parsed.kind === 'arrayLit') return;
  if (parsed.kind === 'objectLit') {
    for (const entry of parsed.entries) {
      if (!('kind' in entry) && entry.value.kind !== 'arrayLit') {
        assertDeferredMachineScalarPreflight(entry.value, env, deferredBindings);
      }
    }
    return;
  }
  assertDeferredMachineScalarPreflight(parsed, env, deferredBindings);
}

function assertDeferredDo(node: IRNode, env: SemanticEnv, deferredBindings: ReadonlySet<string>): void {
  const parsed = parseInternalMachineDo(node, env);
  if (parsed.kind === 'noop') return;
  assertInternalMachineDoNamespaceAvailable(parsed, env);
  if (!hasBinding(env, parsed.targetName)) throw new Error(`do: target "${parsed.targetName}" must be a known binding`);
  const target = getBinding(env, parsed.targetName);
  if (parsed.kind === 'push') {
    if (!Array.isArray(target)) throw new Error(`do: "${parsed.targetName}.push(...)" requires an array binding`);
    if (isCapturedArrayBinding(env, parsed.targetName)) {
      throw new Error(`fresh array binding "${parsed.targetName}" was already captured by a record field`);
    }
    if (parsed.element.kind === 'arrayLit') return;
    assertDeferredMachineScalarPreflight(parsed.element, env, deferredBindings);
    return;
  }
  if (!isPortableMapValue(target)) throw new Error(`portable: "${parsed.targetName}" is not a Map binding`);
  const deferredKey = expressionRequiresDeferredMachinePreflight(parsed.key, env, deferredBindings);
  if (deferredKey && !isSyntacticallyStringMapKey(parsed.key)) {
    throw new Error('portable: Map key must be a known string before deferred input');
  }
  assertDeferredMachineScalarPreflight(parsed.key, env, deferredBindings);
  if (!deferredKey && typeof evalPortableValue(parsed.key, env) !== 'string') {
    throw new Error('portable: Map key must be a string');
  }
  assertDeferredMachineScalarPreflight(parsed.value, env, deferredBindings);
}

function explicitErrorArgument(node: ValueIR): ValueIR | undefined {
  if (node.kind !== 'new' || node.argument.kind !== 'call') return undefined;
  const call = node.argument;
  if (call.optional || call.callee.kind !== 'ident' || call.callee.name !== 'Error' || call.args.length !== 1) {
    return undefined;
  }
  return call.args[0];
}

function assertDeferredBinary(
  node: Extract<ValueIR, { kind: 'binary' }>,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  if (node.op === '&&' || node.op === '||' || node.op === '??') {
    if (scalarRequiresDeferredMachinePreflight(node.left, env, deferredBindings)) {
      assertDeferredMachineScalarPreflight(node.left, env, deferredBindings);
      return;
    }
    const left = evalPortableValue(node.left, env);
    const reachesRight =
      node.op === '&&' ? portableTruthy(left) : node.op === '||' ? !portableTruthy(left) : left === null;
    if (reachesRight) assertDeferredMachineScalarPreflight(node.right, env, deferredBindings);
    return;
  }
  assertDeferredMachineScalarPreflight(node.left, env, deferredBindings);
  assertDeferredMachineScalarPreflight(node.right, env, deferredBindings);
}

function assertDeferredIndex(
  node: Extract<ValueIR, { kind: 'index' }>,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  if (!expressionRequiresDeferredMachinePreflight(node.object, env, deferredBindings)) {
    assertKnownIndexReceiver(node.object, env);
  }
  if (!expressionRequiresDeferredMachinePreflight(node.index, env, deferredBindings)) {
    if (!isIntProvenancedExpr(node.index, env)) throw new Error('portable: array index is not integer-provenanced');
    const index = evalPortableValue(node.index, { ...env, intIndexCtx: true });
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      throw new Error('portable: array index must be a non-negative safe integer');
    }
  }
}

function assertKnownIndexReceiver(node: ValueIR, env: SemanticEnv): void {
  if (node.kind === 'ident') {
    if (!hasBinding(env, node.name)) throw new Error(`portable: binding "${node.name}" not found`);
    if (!Array.isArray(getBinding(env, node.name))) {
      throw new Error(`portable: index access on "${node.name}" requires an array binding`);
    }
    return;
  }
  const nested = evalRecordArrayFieldReferenceValue(node, env);
  if (!nested) throw new Error('portable: index receiver is outside the array domain');
}

function assertDeferredCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  if (internalMachineClassMethodForCall(node, env)) {
    for (const argument of node.args) assertDeferredMachineScalarPreflight(argument, env, deferredBindings);
    return;
  }
  if (node.callee.kind === 'ident') {
    const helper = env.runnerFunctions?.get(node.callee.name);
    if (helper) {
      if (node.args.length !== helper.params.length) {
        throw new Error(
          `portable: function "${node.callee.name}" expects ${helper.params.length} arguments, got ${node.args.length}`,
        );
      }
      for (const argument of node.args) {
        const helperDisposition = classifyInternalMachineClassHelperArgument(argument, env);
        if (helperDisposition === 'unsupported') {
          throw new Error('portable machine: helper argument is outside the resumable domain');
        }
        if (helperDisposition === 'pure' && (argument.kind === 'arrayLit' || argument.kind === 'objectLit')) {
          assertPortableMachineLetShape(argument, env);
        } else if (argument.kind === 'arrayLit') {
          assertDeferredInternalMachineHelperArgument(
            argument,
            env,
            deferredBindings,
            assertDeferredMachineScalarPreflight,
          );
        } else if (argument.kind === 'objectLit') {
          assertDeferredInternalMachineHelperArgument(
            argument,
            env,
            deferredBindings,
            assertDeferredMachineScalarPreflight,
          );
        } else if (expressionRequiresDeferredMachinePreflight(argument, env, deferredBindings)) {
          assertDeferredMachineScalarPreflight(argument, env, deferredBindings);
        } else {
          const value =
            argument.kind === 'ident' && hasBinding(env, argument.name)
              ? getBinding(env, argument.name)
              : evalPortableValue(argument, env);
          assertRunnerPortableValue(value, 'function argument');
        }
      }
      return;
    }
    if (node.callee.name !== 'String' || node.args.length !== 1) {
      throw new Error('portable machine: unsupported deferred function call');
    }
    assertDeferredMachineScalarPreflight(node.args[0], env, deferredBindings);
    return;
  }
  if (node.callee.kind !== 'member' || node.callee.object.kind !== 'ident') {
    throw new Error('portable machine: unsupported deferred namespace call');
  }
  const namespace = node.callee.object.name;
  if (hasBinding(env, namespace)) throw new Error(`portable machine: namespace "${namespace}" is shadowed`);
  if (namespace === 'Map') {
    assertDeferredMapCall(node, env, deferredBindings);
    return;
  }
  if (namespace === 'List') {
    assertDeferredListCall(node, env, deferredBindings);
    return;
  }
  if (namespace === 'Decimal') {
    for (const argument of node.args) assertDeferredDecimalOperand(argument, env, deferredBindings);
    return;
  }
  if (namespace === 'Text') {
    assertDeferredTextCall(node, env, deferredBindings);
    return;
  }
  throw new Error(`portable machine: unsupported deferred namespace "${namespace}"`);
}

function assertDeferredListCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  const receiver = node.args[0];
  if (!expressionRequiresDeferredMachinePreflight(receiver, env, deferredBindings)) {
    if (receiver.kind !== 'ident' || !hasBinding(env, receiver.name)) {
      throw new Error('portable: List receiver binding is missing');
    }
    if (!Array.isArray(getBinding(env, receiver.name))) {
      throw new Error(`portable: "${receiver.name}" is not an array binding`);
    }
  }
  if (node.callee.kind !== 'member' || node.callee.property !== 'index') return;
  const index = node.args[1];
  assertDeferredMachineScalarPreflight(index, env, deferredBindings);
  if (
    !expressionRequiresDeferredMachinePreflight(index, env, deferredBindings) &&
    typeof evalPortableValue(index, env) !== 'number'
  ) {
    throw new Error('portable: List.index index must be a number');
  }
}

function assertDeferredMapCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  const receiver = node.args[0];
  if (!expressionRequiresDeferredMachinePreflight(receiver, env, deferredBindings)) {
    if (receiver.kind !== 'ident' || !hasBinding(env, receiver.name)) {
      throw new Error('portable: Map receiver binding is missing');
    }
    if (!isPortableMapValue(getBinding(env, receiver.name))) {
      throw new Error(`portable: "${receiver.name}" is not a Map binding`);
    }
  }
  const key = node.args[1];
  assertDeferredMachineScalarPreflight(key, env, deferredBindings);
  if (
    !expressionRequiresDeferredMachinePreflight(key, env, deferredBindings) &&
    typeof evalPortableValue(key, env) !== 'string'
  ) {
    throw new Error('portable: Map key must be a string');
  }
}

function assertDeferredDecimalOperand(node: ValueIR, env: SemanticEnv, deferredBindings: ReadonlySet<string>): void {
  if (!expressionRequiresDeferredMachinePreflight(node, env, deferredBindings)) {
    evalDecimalExpression(node, env);
    return;
  }
  if (node.kind === 'ident') return;
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertDeferredDecimalOperand(node.expression, env, deferredBindings);
    return;
  }
  if (node.kind !== 'call' || !isDecimalExpression(node) || node.callee.kind !== 'member') {
    throw new Error('portable-decimal: invalid deferred operand');
  }
  for (const argument of node.args) assertDeferredDecimalOperand(argument, env, deferredBindings);
  const method = node.callee.property;
  if (
    (method === 'div' || method === 'mod') &&
    !expressionRequiresDeferredMachinePreflight(node.args[1], env, deferredBindings) &&
    evalDecimalExpression(node.args[1], env) === '0'
  ) {
    throw new Error(method === 'div' ? DECIMAL_DIV_ZERO_FAILCLOSE : DECIMAL_MOD_ZERO_FAILCLOSE);
  }
  if (method === 'pow') assertPortableDecimalPow(node.args[0], node.args[1]);
}

function assertDeferredTextCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  for (let index = 0; index < node.args.length; index += 1) {
    const argument = node.args[index];
    assertDeferredMachineScalarPreflight(argument, env, deferredBindings);
    if (expressionRequiresDeferredMachinePreflight(argument, env, deferredBindings)) continue;
    const value = evalPortableValue(argument, index > 0 ? { ...env, intIndexCtx: true } : env);
    const method = node.callee.kind === 'member' ? node.callee.property : '';
    const stringArgument = index === 0 || method === 'indexOf' || method === 'startsWith';
    if (stringArgument && (typeof value !== 'string' || !isWellFormedText(value))) {
      throw new Error(`portable: Text.${method} requires well-formed text`);
    }
    if (!stringArgument && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`portable: Text.${method} index must be a non-negative safe integer`);
    }
  }
}
