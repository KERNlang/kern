import type { BinaryOp, UnaryOp, ValueIR } from '../../value-ir.js';
import { isDecimalExpression } from './portable-decimal-evaluator.js';
import { assertPortableRecordEntry } from './portable-record-evaluator.js';
import { isPortableBindingName, isSafeIntegerLiteralIndex } from './portable-scalar-domain.js';

const SCALAR_BINARY_OPS = new Set<BinaryOp>([
  '+',
  '-',
  '*',
  '/',
  '%',
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

function fail(kind: string): never {
  throw new Error(`portable machine: expression ${kind} is outside the structural domain`);
}

function assertScalarCallShape(node: Extract<ValueIR, { kind: 'call' }>): void {
  if (node.optional) fail('optional call');
  if (node.callee.kind === 'ident') {
    if (node.callee.name !== 'String' || node.args.length !== 1) fail('function call');
    assertPortableMachineScalarShape(node.args[0]);
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
    if (
      method !== 'length' ||
      node.args.length !== 1 ||
      node.args[0].kind !== 'ident' ||
      !isPortableBindingName(node.args[0].name)
    ) {
      fail('List call');
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
    assertPortableMachineScalarShape(node.args[1]);
    return;
  }
  if (namespace === 'Text') {
    if (TEXT_ARITY[method] !== node.args.length) fail('Text call');
    for (const argument of node.args) assertPortableMachineScalarShape(argument);
    return;
  }
  fail('namespace call');
}

function assertMemberShape(node: Extract<ValueIR, { kind: 'member' }>): void {
  if (node.optional) fail('optional member');
  if (node.object.kind === 'ident') return;
  if (
    node.property !== 'length' ||
    node.object.kind !== 'member' ||
    node.object.optional ||
    node.object.object.kind !== 'ident'
  ) {
    fail('member');
  }
}

function assertIndexShape(node: Extract<ValueIR, { kind: 'index' }>): void {
  if (node.optional) fail('optional index');
  if (node.object.kind === 'ident') {
    assertPortableMachineScalarShape(node.index);
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

export function assertPortableMachineScalarShape(node: ValueIR): void {
  if (node.kind === 'numLit') {
    if (node.bigint || !Number.isFinite(node.value)) fail('number literal');
    return;
  }
  if (node.kind === 'strLit' || node.kind === 'boolLit' || node.kind === 'nullLit' || node.kind === 'ident') return;
  if (node.kind === 'unary') {
    if (!SCALAR_UNARY_OPS.has(node.op)) fail('unary');
    assertPortableMachineScalarShape(node.argument);
    return;
  }
  if (node.kind === 'binary') {
    if (!SCALAR_BINARY_OPS.has(node.op)) fail('binary');
    assertPortableMachineScalarShape(node.left);
    assertPortableMachineScalarShape(node.right);
    return;
  }
  if (node.kind === 'conditional') {
    assertPortableMachineScalarShape(node.test);
    assertPortableMachineScalarShape(node.consequent);
    assertPortableMachineScalarShape(node.alternate);
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertPortableMachineScalarShape(node.expression);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) assertPortableMachineScalarShape(expression);
    return;
  }
  if (node.kind === 'member') {
    assertMemberShape(node);
    return;
  }
  if (node.kind === 'index') {
    assertIndexShape(node);
    return;
  }
  if (node.kind === 'call') {
    assertScalarCallShape(node);
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

function assertRecordShape(node: Extract<ValueIR, { kind: 'objectLit' }>): void {
  const keys: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const rawEntry of node.entries) {
    const entry = assertPortableRecordEntry(rawEntry, keys);
    keys[entry.key] = null;
    if (entry.value.kind === 'arrayLit') assertArrayShape(entry.value, true);
    else assertPortableMachineScalarShape(entry.value);
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

export function assertPortableMachineLetShape(node: ValueIR): void {
  if (node.kind === 'arrayLit') {
    assertArrayShape(node, false);
    return;
  }
  if (node.kind === 'objectLit') {
    assertRecordShape(node);
    return;
  }
  if (isEmptyMapConstructor(node)) return;
  assertPortableMachineScalarShape(node);
}

export function assertPortableMachineReturnShape(node: ValueIR): void {
  if (node.kind === 'arrayLit') {
    assertArrayShape(node, false);
    return;
  }
  if (node.kind === 'objectLit') {
    assertRecordShape(node);
    return;
  }
  assertPortableMachineScalarShape(node);
}
