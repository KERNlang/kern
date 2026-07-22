import { flattenPortablePowerChain } from '../../portable-power.js';
import type { BinaryOp, UnaryOp, ValueIR } from '../../value-ir.js';
import {
  internalMachineClassForNew,
  internalMachineClassGetterForRead,
  internalMachineClassMethodForCall,
} from './internal-effect-machine-class-graph.js';
import { isInternalMachineHelperCall } from './internal-effect-machine-helper-contract.js';
import { isDecimalExpression } from './portable-decimal-evaluator.js';
import { assertPortableRecordEntry } from './portable-record-evaluator.js';
import { isPortableBindingName, isSafeIntegerLiteralIndex } from './portable-scalar-domain.js';
import type { SemanticEnv } from './semantic-env.js';

const SCALAR_BINARY_OPS = new Set<BinaryOp>([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '??',
]);
const SCALAR_UNARY_OPS = new Set<UnaryOp>(['!', '-', '+']);
const DECIMAL_SCALAR_METHODS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'cmp']);
const TEXT_ARITY: Readonly<Record<string, number>> = Object.freeze({
  charAt: 2,
  indexOf: 2,
  length: 1,
  slice: 3,
  startsWith: 2,
});

type ScalarHelperCall = (name: string, arity: number, env: SemanticEnv) => boolean;

function fail(kind: string): never {
  throw new Error(`portable machine: expression ${kind} is outside the structural domain`);
}

function assertScalarCallShape(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv | undefined,
  scalarHelperCall: ScalarHelperCall,
  portableHelperCall: ScalarHelperCall,
): void {
  if (node.optional) fail('optional call');
  if (node.callee.kind === 'ident') {
    if (node.callee.name === 'String' && node.args.length === 1) {
      assertPortableMachineScalarShape(node.args[0], env, scalarHelperCall, portableHelperCall);
      return;
    }
    if (!env || !scalarHelperCall(node.callee.name, node.args.length, env)) fail('function call');
    for (const argument of node.args) assertPortableMachineLetShape(argument, env, portableHelperCall);
    return;
  }
  if (node.callee.kind !== 'member' || node.callee.optional || node.callee.object.kind !== 'ident') {
    fail('non-namespace call');
  }
  const namespace = node.callee.object.name;
  const method = node.callee.property;
  if (namespace === 'Decimal') {
    if (!DECIMAL_SCALAR_METHODS.has(method) || !isDecimalExpression(node)) fail('Decimal call');
    return;
  }
  if (namespace === 'List') {
    const expectedArity = method === 'length' ? 1 : method === 'index' ? 2 : 0;
    if (
      expectedArity === 0 ||
      node.args.length !== expectedArity ||
      node.args[0].kind !== 'ident' ||
      !isPortableBindingName(node.args[0].name)
    ) {
      fail('List call');
    }
    if (method === 'index') {
      assertPortableMachineScalarShape(node.args[1], env, scalarHelperCall, portableHelperCall);
    }
    return;
  }
  if (namespace === 'Map') {
    if (
      (method !== 'get' && method !== 'has') ||
      node.args.length !== 2 ||
      node.args[0].kind !== 'ident' ||
      !isPortableBindingName(node.args[0].name)
    ) {
      fail('Map call');
    }
    assertPortableMachineScalarShape(node.args[1], env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (namespace === 'Text') {
    if (TEXT_ARITY[method] !== node.args.length) fail('Text call');
    for (const argument of node.args) {
      assertPortableMachineScalarShape(argument, env, scalarHelperCall, portableHelperCall);
    }
    return;
  }
  fail('namespace call');
}

function assertMemberShape(node: Extract<ValueIR, { kind: 'member' }>, env?: SemanticEnv): void {
  if (node.optional) fail('optional member');
  if (node.object.kind === 'ident') {
    if (env && internalMachineClassGetterForRead(node, env)) fail('nested class getter');
    return;
  }
  if (
    node.property !== 'length' ||
    node.object.kind !== 'member' ||
    node.object.optional ||
    node.object.object.kind !== 'ident'
  ) {
    fail('member');
  }
}

function assertIndexShape(
  node: Extract<ValueIR, { kind: 'index' }>,
  env: SemanticEnv | undefined,
  scalarHelperCall: ScalarHelperCall,
  portableHelperCall: ScalarHelperCall,
): void {
  if (node.optional) fail('optional index');
  if (node.object.kind === 'ident') {
    assertPortableMachineScalarShape(node.index, env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (
    node.object.kind !== 'member' ||
    node.object.optional ||
    node.object.object.kind !== 'ident' ||
    !isSafeIntegerLiteralIndex(node.index)
  ) {
    fail('index');
  }
}

export function assertPortableMachineScalarShape(
  node: ValueIR,
  env?: SemanticEnv,
  scalarHelperCall: ScalarHelperCall = isInternalMachineHelperCall,
  portableHelperCall: ScalarHelperCall = scalarHelperCall,
): void {
  if (node.kind === 'numLit') {
    if (node.bigint || !Number.isFinite(node.value)) fail('number literal');
    return;
  }
  if (node.kind === 'strLit' || node.kind === 'boolLit' || node.kind === 'nullLit' || node.kind === 'ident') return;
  if (node.kind === 'unary') {
    if (!SCALAR_UNARY_OPS.has(node.op)) fail('unary');
    assertPortableMachineScalarShape(node.argument, env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (node.kind === 'binary') {
    if (!SCALAR_BINARY_OPS.has(node.op)) fail('binary');
    if (node.op === '**') {
      for (const operand of flattenPortablePowerChain(node)) {
        assertPortableMachineScalarShape(operand, env, scalarHelperCall, portableHelperCall);
      }
      return;
    }
    assertPortableMachineScalarShape(node.left, env, scalarHelperCall, portableHelperCall);
    assertPortableMachineScalarShape(node.right, env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (node.kind === 'conditional') {
    assertPortableMachineScalarShape(node.test, env, scalarHelperCall, portableHelperCall);
    assertPortableMachineScalarShape(node.consequent, env, scalarHelperCall, portableHelperCall);
    assertPortableMachineScalarShape(node.alternate, env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertPortableMachineScalarShape(node.expression, env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) {
      assertPortableMachineScalarShape(expression, env, scalarHelperCall, portableHelperCall);
    }
    return;
  }
  if (node.kind === 'member') {
    assertMemberShape(node, env);
    return;
  }
  if (node.kind === 'index') {
    assertIndexShape(node, env, scalarHelperCall, portableHelperCall);
    return;
  }
  if (node.kind === 'call') {
    assertScalarCallShape(node, env, scalarHelperCall, portableHelperCall);
    return;
  }
  fail(node.kind);
}

function assertArrayShape(node: Extract<ValueIR, { kind: 'arrayLit' }>, allowFiniteNumbers: boolean): void {
  for (const item of node.items) {
    if (item.kind === 'arrayLit') {
      assertArrayShape(item, allowFiniteNumbers);
      continue;
    }
    if (item.kind === 'numLit') {
      if (item.bigint || !Number.isFinite(item.value)) fail('array number');
      if (allowFiniteNumbers) continue;
      if (!/^-?[0-9]+$/.test(item.raw) || !Number.isSafeInteger(item.value) || String(item.value) !== item.raw) {
        fail('array number');
      }
      continue;
    }
    if (item.kind !== 'strLit' && item.kind !== 'boolLit' && item.kind !== 'nullLit') fail('array element');
  }
}

function assertReturnArrayShape(
  node: Extract<ValueIR, { kind: 'arrayLit' }>,
  env?: SemanticEnv,
  helperCall: ScalarHelperCall = isInternalMachineHelperCall,
): void {
  for (const item of node.items) {
    if (item.kind === 'arrayLit') assertArrayShape(item, false);
    else assertPortableMachineScalarShape(item, env, helperCall);
  }
}

function assertRecordShape(
  node: Extract<ValueIR, { kind: 'objectLit' }>,
  env?: SemanticEnv,
  helperCall: ScalarHelperCall = isInternalMachineHelperCall,
): void {
  const keys: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const rawEntry of node.entries) {
    const entry = assertPortableRecordEntry(rawEntry, keys);
    keys[entry.key] = null;
    if (entry.value.kind === 'arrayLit') assertArrayShape(entry.value, true);
    else assertPortableMachineScalarShape(entry.value, env, helperCall);
  }
}

function isEmptyMapConstructor(node: ValueIR): boolean {
  return (
    node.kind === 'new' &&
    node.argument.kind === 'call' &&
    !node.argument.optional &&
    node.argument.args.length === 0 &&
    node.argument.callee.kind === 'ident' &&
    node.argument.callee.name === 'Map'
  );
}

function assertClassConstructionShape(
  node: ValueIR,
  env?: SemanticEnv,
  helperCall: ScalarHelperCall = isInternalMachineHelperCall,
): boolean {
  if (!env) return false;
  const cls = internalMachineClassForNew(node, env);
  if (!cls || node.kind !== 'new' || node.argument.kind !== 'call') return false;
  const params = cls.constructor?.params ?? [];
  if (node.argument.args.length !== params.length) fail('class constructor arity');
  for (const argument of node.argument.args) assertPortableMachineScalarShape(argument, env, helperCall);
  return true;
}

export function assertPortableMachineClassMethodCallShape(
  node: ValueIR,
  env?: SemanticEnv,
  helperCall: ScalarHelperCall = isInternalMachineHelperCall,
): boolean {
  if (!env) return false;
  const resolved = internalMachineClassMethodForCall(node, env);
  if (!resolved || node.kind !== 'call') return false;
  if (node.args.length !== resolved.method.params.length) fail('class method arity');
  for (const argument of node.args) assertPortableMachineScalarShape(argument, env, helperCall);
  return true;
}

export function assertPortableMachineClassGetterReadShape(node: ValueIR, env?: SemanticEnv): boolean {
  return Boolean(env && node.kind === 'member' && internalMachineClassGetterForRead(node, env));
}

export function assertPortableMachineLetShape(
  node: ValueIR,
  env?: SemanticEnv,
  helperCall: ScalarHelperCall = isInternalMachineHelperCall,
): void {
  if (node.kind === 'arrayLit') {
    assertArrayShape(node, false);
    return;
  }
  if (node.kind === 'objectLit') {
    assertRecordShape(node, env, helperCall);
    return;
  }
  if (isEmptyMapConstructor(node)) return;
  if (assertClassConstructionShape(node, env, helperCall)) return;
  if (assertPortableMachineClassMethodCallShape(node, env, helperCall)) return;
  if (assertPortableMachineClassGetterReadShape(node, env)) return;
  assertPortableMachineScalarShape(node, env, helperCall);
}

export function assertPortableMachineReturnShape(node: ValueIR, env?: SemanticEnv): void {
  if (node.kind === 'arrayLit') {
    assertReturnArrayShape(node, env);
    return;
  }
  if (node.kind === 'objectLit') {
    assertRecordShape(node, env);
    return;
  }
  if (assertPortableMachineClassMethodCallShape(node, env)) return;
  if (assertPortableMachineClassGetterReadShape(node, env)) return;
  assertPortableMachineScalarShape(node, env);
}
