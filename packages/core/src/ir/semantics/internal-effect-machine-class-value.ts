import type { BinaryOp, UnaryOp, ValueIR } from '../../value-ir.js';
import {
  internalMachineClassForNew,
  internalMachineClassGetterForRead,
  internalMachineClassMethodForCall,
} from './internal-effect-machine-class-graph.js';
import { isInternalMachineHelperCall } from './internal-effect-machine-helper-graph.js';
import {
  assertPortableMachineLetShape,
  assertPortableMachineReturnShape,
  assertPortableMachineScalarShape,
} from './portable-machine-shape.js';
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

function pureScalarShape(node: ValueIR, env: SemanticEnv): InternalMachineClassValueDisposition {
  try {
    assertPortableMachineScalarShape(node, env);
    return 'pure';
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
  if (node.callee.kind === 'ident' && isInternalMachineHelperCall(node.callee.name, node.args.length, env)) {
    return env.runnerClasses && env.runnerClasses.size > 0 ? 'unsupported' : pureScalarShape(node, env);
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
  const scalar = classifyInternalMachineClassScalarValue(node, env);
  if (scalar !== 'unsupported') return scalar;
  try {
    assertPortableMachineReturnShape(node, env);
    return 'pure';
  } catch {
    return 'unsupported';
  }
}
