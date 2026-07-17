import type { BinaryOp, UnaryOp, ValueIR } from '../../value-ir.js';
import {
  internalMachineClassForNew,
  internalMachineClassGetterForRead,
  internalMachineClassMethodForCall,
} from './internal-effect-machine-class-graph.js';
import {
  isInternalMachineHelperCall,
  isInternalMachineResumableHelperCall,
  isInternalMachineScalarHelperCall,
} from './internal-effect-machine-helper-graph.js';
import {
  assertPortableMachineLetShape,
  assertPortableMachineReturnShape,
  assertPortableMachineScalarShape,
} from './portable-machine-shape.js';
import { assertPortableRecordEntry, assertSingleUseFreshArrayRecordSources } from './portable-record-evaluator.js';
import type { SemanticEnv } from './semantic-env.js';

export type InternalMachineClassValueDisposition = 'pure' | 'suspending' | 'unsupported';

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

function combine(values: readonly InternalMachineClassValueDisposition[]): InternalMachineClassValueDisposition {
  if (values.includes('unsupported')) return 'unsupported';
  return values.includes('suspending') ? 'suspending' : 'pure';
}

export function internalMachineClassValueUsesPrivateReceiver(node: ValueIR): boolean {
  if (node.kind === 'ident') return node.name === 'this' || node.name === 'super';
  if (node.kind === 'unary' || node.kind === 'new' || node.kind === 'spread' || node.kind === 'await') {
    return internalMachineClassValueUsesPrivateReceiver(node.argument);
  }
  if (node.kind === 'propagate') return internalMachineClassValueUsesPrivateReceiver(node.argument);
  if (node.kind === 'binary') {
    return (
      internalMachineClassValueUsesPrivateReceiver(node.left) ||
      internalMachineClassValueUsesPrivateReceiver(node.right)
    );
  }
  if (node.kind === 'conditional') {
    return (
      internalMachineClassValueUsesPrivateReceiver(node.test) ||
      internalMachineClassValueUsesPrivateReceiver(node.consequent) ||
      internalMachineClassValueUsesPrivateReceiver(node.alternate)
    );
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    return internalMachineClassValueUsesPrivateReceiver(node.expression);
  }
  if (node.kind === 'tmplLit') return node.expressions.some(internalMachineClassValueUsesPrivateReceiver);
  if (
    node.kind === 'member' &&
    node.object.kind === 'ident' &&
    (node.object.name === 'this' || node.object.name === 'super')
  ) {
    return false;
  }
  if (node.kind === 'member') return internalMachineClassValueUsesPrivateReceiver(node.object);
  if (node.kind === 'index') {
    return (
      internalMachineClassValueUsesPrivateReceiver(node.object) ||
      internalMachineClassValueUsesPrivateReceiver(node.index)
    );
  }
  if (node.kind === 'call') {
    return (
      internalMachineClassValueUsesPrivateReceiver(node.callee) ||
      node.args.some(internalMachineClassValueUsesPrivateReceiver)
    );
  }
  if (node.kind === 'arrayLit') return node.items.some(internalMachineClassValueUsesPrivateReceiver);
  if (node.kind === 'objectLit') {
    return node.entries.some((entry) =>
      internalMachineClassValueUsesPrivateReceiver('kind' in entry ? entry.argument : entry.value),
    );
  }
  return false;
}

function pureScalarShape(node: ValueIR, env: SemanticEnv): InternalMachineClassValueDisposition {
  try {
    assertPortableMachineScalarShape(node, env);
    return 'pure';
  } catch {
    return 'unsupported';
  }
}

function assertResumableArrayArgumentShape(node: Extract<ValueIR, { kind: 'arrayLit' }>, env: SemanticEnv): void {
  for (const item of node.items) {
    if (item.kind === 'objectLit') {
      throw new Error('machine helper: nested records are outside the portable array domain');
    }
    const disposition = classifyInternalMachineClassHelperArgument(item, env);
    if (disposition === 'unsupported') {
      throw new Error('machine helper: array item is outside the resumable argument domain');
    }
    if (item.kind === 'arrayLit') assertResumableArrayArgumentShape(item, env);
  }
}

function assertResumableCompositeArgumentShape(
  node: Extract<ValueIR, { kind: 'arrayLit' | 'objectLit' }>,
  env: SemanticEnv,
): void {
  if (node.kind === 'arrayLit') {
    assertResumableArrayArgumentShape(node, env);
    return;
  }
  assertSingleUseFreshArrayRecordSources(node, env);
  const keys: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const rawEntry of node.entries) {
    const entry = assertPortableRecordEntry(rawEntry, keys);
    keys[entry.key] = null;
    if (entry.value.kind === 'objectLit') {
      throw new Error('machine helper: nested records are outside the portable record domain');
    }
    const disposition = classifyInternalMachineClassHelperArgument(entry.value, env);
    if (disposition === 'unsupported') {
      throw new Error(`machine helper: record field "${entry.key}" is outside the resumable argument domain`);
    }
    if (entry.value.kind === 'arrayLit') assertResumableArrayArgumentShape(entry.value, env);
  }
}

export function classifyInternalMachineClassHelperArgument(
  node: ValueIR,
  env: SemanticEnv,
): InternalMachineClassValueDisposition {
  const scalar = classifyInternalMachineClassScalarValue(node, env);
  if (scalar !== 'unsupported') return scalar;
  if (
    node.kind === 'call' &&
    node.callee.kind === 'ident' &&
    isInternalMachineHelperCall(node.callee.name, node.args.length, env)
  ) {
    if (node.args.some(internalMachineClassValueUsesPrivateReceiver)) return 'unsupported';
    const args = combine(node.args.map((argument) => classifyInternalMachineClassHelperArgument(argument, env)));
    if (args === 'unsupported') return args;
    return isInternalMachineResumableHelperCall(node.callee.name, node.args.length, env) ? 'unsupported' : args;
  }
  if (node.kind !== 'arrayLit' && node.kind !== 'objectLit') return 'unsupported';
  const descendants =
    node.kind === 'arrayLit'
      ? combine(node.items.map((item) => classifyInternalMachineClassHelperArgument(item, env)))
      : combine(
          node.entries.map((entry) =>
            classifyInternalMachineClassHelperArgument('kind' in entry ? entry.argument : entry.value, env),
          ),
        );
  if (descendants === 'unsupported') return descendants;
  try {
    assertResumableCompositeArgumentShape(node, env);
    return descendants;
  } catch {
    return 'unsupported';
  }
}

function classifyCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
): InternalMachineClassValueDisposition {
  const method = internalMachineClassMethodForCall(node, env);
  if (method) {
    if (node.args.length !== method.method.params.length) return 'unsupported';
    const args = combine(node.args.map((argument) => classifyInternalMachineClassScalarValue(argument, env)));
    return args === 'unsupported' ? args : 'suspending';
  }
  if (node.optional) return 'unsupported';
  if (node.callee.kind === 'ident' && isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)) {
    if (node.args.some(internalMachineClassValueUsesPrivateReceiver)) return 'unsupported';
    const args = combine(node.args.map((argument) => classifyInternalMachineClassHelperArgument(argument, env)));
    if (args === 'unsupported') return args;
    return args === 'suspending' || isInternalMachineResumableHelperCall(node.callee.name, node.args.length, env)
      ? 'suspending'
      : pureScalarShape(node, env);
  }
  if (node.callee.kind === 'ident' && isInternalMachineHelperCall(node.callee.name, node.args.length, env)) {
    return 'unsupported';
  }
  if (node.callee.kind === 'ident' && node.callee.name === 'String' && node.args.length === 1) {
    return classifyInternalMachineClassScalarValue(node.args[0], env);
  }
  const descendants = combine([
    classifyInternalMachineClassScalarValue(node.callee, env),
    ...node.args.map((argument) => classifyInternalMachineClassScalarValue(argument, env)),
  ]);
  if (descendants !== 'pure') return 'unsupported';
  return pureScalarShape(node, env);
}

export function classifyInternalMachineClassScalarValue(
  node: ValueIR,
  env: SemanticEnv,
): InternalMachineClassValueDisposition {
  if (node.kind === 'member') {
    if (internalMachineClassGetterForRead(node, env)) return 'suspending';
    const object = classifyInternalMachineClassScalarValue(node.object, env);
    return object === 'pure' ? pureScalarShape(node, env) : 'unsupported';
  }
  if (node.kind === 'call') return classifyCall(node, env);
  if (
    node.kind === 'numLit' ||
    node.kind === 'strLit' ||
    node.kind === 'boolLit' ||
    node.kind === 'nullLit' ||
    node.kind === 'ident'
  ) {
    return pureScalarShape(node, env);
  }
  if (node.kind === 'unary') {
    if (!SCALAR_UNARY_OPS.has(node.op)) return 'unsupported';
    return classifyInternalMachineClassScalarValue(node.argument, env);
  }
  if (node.kind === 'binary') {
    if (!SCALAR_BINARY_OPS.has(node.op)) return 'unsupported';
    return combine([
      classifyInternalMachineClassScalarValue(node.left, env),
      classifyInternalMachineClassScalarValue(node.right, env),
    ]);
  }
  if (node.kind === 'conditional') {
    return combine([
      classifyInternalMachineClassScalarValue(node.test, env),
      classifyInternalMachineClassScalarValue(node.consequent, env),
      classifyInternalMachineClassScalarValue(node.alternate, env),
    ]);
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    return classifyInternalMachineClassScalarValue(node.expression, env);
  }
  if (node.kind === 'tmplLit') {
    return combine(node.expressions.map((expression) => classifyInternalMachineClassScalarValue(expression, env)));
  }
  if (node.kind === 'index') {
    const descendants = combine([
      classifyInternalMachineClassScalarValue(node.object, env),
      classifyInternalMachineClassScalarValue(node.index, env),
    ]);
    return descendants === 'pure' ? pureScalarShape(node, env) : 'unsupported';
  }
  return 'unsupported';
}

export function classifyInternalMachineClassLetValue(
  node: ValueIR,
  env: SemanticEnv,
): InternalMachineClassValueDisposition {
  const constructorArguments = classifyInternalMachineClassConstructorArguments(node, env);
  if (constructorArguments) return constructorArguments === 'unsupported' ? constructorArguments : 'suspending';
  const scalar = classifyInternalMachineClassScalarValue(node, env);
  if (scalar !== 'unsupported') return scalar;
  try {
    assertPortableMachineLetShape(node, env);
    return 'pure';
  } catch {
    return 'unsupported';
  }
}

export function classifyInternalMachineClassConstructorArguments(
  node: ValueIR,
  env: SemanticEnv,
): InternalMachineClassValueDisposition | undefined {
  const cls = internalMachineClassForNew(node, env);
  if (cls && node.kind === 'new' && node.argument.kind === 'call') {
    const params = cls.constructor?.params ?? [];
    if (node.argument.args.length !== params.length) return 'unsupported';
    return combine(node.argument.args.map((argument) => classifyInternalMachineClassScalarValue(argument, env)));
  }
  return undefined;
}

export function classifyInternalMachineClassReturnValue(
  node: ValueIR,
  env: SemanticEnv,
): InternalMachineClassValueDisposition {
  if (
    node.kind === 'call' &&
    node.callee.kind === 'ident' &&
    isInternalMachineHelperCall(node.callee.name, node.args.length, env) &&
    !isInternalMachineScalarHelperCall(node.callee.name, node.args.length, env)
  ) {
    return 'unsupported';
  }
  const scalar = classifyInternalMachineClassScalarValue(node, env);
  if (scalar !== 'unsupported') return scalar;
  try {
    assertPortableMachineReturnShape(node, env);
    return 'pure';
  } catch {
    return 'unsupported';
  }
}
