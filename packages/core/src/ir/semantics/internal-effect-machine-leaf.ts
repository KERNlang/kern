import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { isCaughtErrorValue } from './caught-error.js';
import { assertDeferredMachineLeafKnownValues } from './deferred-expression-preflight.js';
import { expressionV1Source } from './expression-v1-runtime.js';
import { preflightDeferredInternalMachineClassLet } from './internal-effect-machine-class-preflight.js';
import {
  assignInternalMachineClassField,
  preflightInternalMachineClassLet,
} from './internal-effect-machine-class-runtime.js';
import {
  classifyInternalMachineClassConstructorArguments,
  classifyInternalMachineClassLetValue,
  classifyInternalMachineClassReturnValue,
  classifyInternalMachineClassScalarValue,
} from './internal-effect-machine-class-value.js';
import {
  internalMachineDoTargetName,
  parseInternalMachineDo,
  runInternalMachineDo,
} from './internal-effect-machine-do.js';
import {
  addInternalMachineExpressionBindings,
  internalMachineExpressionBindings,
} from './internal-effect-machine-expression-bindings.js';
import {
  assertInternalMachineExpressionV1Shape,
  runInternalMachineExpressionV1,
} from './internal-effect-machine-expression-v1.js';
import { internalMachineHelperCallInNode } from './internal-effect-machine-helper-graph.js';
import { evalInternalMachineHelperValue } from './internal-effect-machine-helper-runtime.js';
import { internalMachineRecordArrayFields } from './internal-effect-machine-leaf-record.js';
import {
  assertInternalMachinePrintShape,
  assertInternalMachineReturnShape,
  runInternalMachinePrint,
  runInternalMachineReturn,
} from './internal-effect-machine-leaf-result.js';
import {
  INTERNAL_EFFECT_MACHINE_LEAF_TYPES,
  isInternalEffectMachineLeafType,
} from './internal-effect-machine-leaf-types.js';
import { evalArrayLiteralValue, isArrayLiteralExpression } from './portable-array.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableMachineLetShape, assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { isEmptyMapConstructorCall } from './portable-map.js';
import {
  evalRecordArrayFieldReferenceValue,
  evalRecordLiteralValue,
  isRecordLiteralExpression,
} from './portable-record-evaluator.js';
import { assertRunnerPortableValue, isPortableBindingName, type PortableScalar } from './portable-scalar-domain.js';
import {
  assignBinding,
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
import type { CanonicalError, Trace } from './trace.js';

export { INTERNAL_EFFECT_MACHINE_LEAF_TYPES, isInternalEffectMachineLeafType };

export function assertInternalEffectMachineLeafShape(node: IRNode, env?: SemanticEnv): void {
  if (!isInternalEffectMachineLeafType(node.type)) throw new Error(`unsupported machine leaf "${node.type}"`);
  if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > 0)) {
    throw new Error(`${node.type}: machine leaf must not contain a body`);
  }
  if (node.type === 'assign') validateAssignShape(node, env);
  else if (node.type === 'break' || node.type === 'continue') {
    if (node.props?.label !== undefined) throw new Error(`${node.type}: labels are outside the machine domain`);
  } else if (node.type === 'do') parseInternalMachineDo(node, env);
  else if (node.type === 'expression-v1') assertInternalMachineExpressionV1Shape(node, env);
  else if (node.type === 'fmt') validateFmtShape(node, env);
  else if (node.type === 'let') validateLetShape(node, env);
  else if (node.type === 'print') assertInternalMachinePrintShape(node, env);
  else if (node.type === 'return') assertInternalMachineReturnShape(node, env);
  else validateThrowShape(node, env);
}

export function assertInternalEffectMachineLeafShapePreflight(node: IRNode, env: SemanticEnv): void {
  assertInternalEffectMachineLeafShape(node, env);
  const output =
    node.type === 'let' || node.type === 'fmt' || node.type === 'expression-v1' ? node.props?.name : undefined;
  if (typeof output !== 'string') return;
  if (hasOwnBinding(env, output)) throw new Error(`binding "${output}" already exists`);
  if (node.type === 'let' && preflightInternalMachineClassLet(node, env, evalPortableValue, false)) return;
  defineBinding(env, output, null);
}

export function assertInternalEffectMachineLeafPreflight(
  node: IRNode,
  env: SemanticEnv,
  deferredBindings: Set<string>,
): void {
  assertInternalEffectMachineLeafShape(node, env);
  const references = leafExpressionBindings(node, env);
  const output = leafOutputName(node, env);
  assertLeafDeferredCaughtUses(node, env, deferredBindings);
  if (
    (node.type === 'let' || node.type === 'fmt' || node.type === 'expression-v1') &&
    output !== undefined &&
    hasOwnBinding(env, output)
  ) {
    throw new Error(`${node.type}: binding "${output}" already exists`);
  }
  if (
    internalMachineHelperCallInNode(node, env) ||
    (output !== undefined && deferredBindings.has(output)) ||
    [...references].some((name) => deferredBindings.has(name))
  ) {
    if (
      node.type === 'let' &&
      preflightDeferredInternalMachineClassLet(node, env, evalPortableValue, deferredBindings)
    ) {
      if (output !== undefined) deferredBindings.add(output);
      return;
    }
    assertDeferredAssignTarget(node, output, env, deferredBindings);
    for (const name of references) {
      const present = name === 'this' ? env.runnerThis !== undefined : hasBinding(env, name);
      if (!deferredBindings.has(name) && !present) throw new Error(`binding "${name}" not found`);
    }
    assertDeferredMachineLeafKnownValues(node, env, deferredBindings);
    // Deferred producers reserve declarations; loop-frame bindings arrive at runtime.
    deferLeafOutput(node, env, deferredBindings);
    return;
  }
  const raw = node.props?.value;
  const value = typeof raw === 'string' && raw !== '' ? parseExpression(raw) : undefined;
  if (
    node.type === 'let' &&
    value &&
    classifyInternalMachineClassConstructorArguments(value, env) !== undefined &&
    preflightDeferredInternalMachineClassLet(node, env, evalPortableValue, deferredBindings)
  ) {
    if (output !== undefined) deferredBindings.add(output);
    return;
  }
  if (node.type === 'let' && preflightInternalMachineClassLet(node, env, evalPortableValue)) return;
  if (value) {
    const disposition =
      node.type === 'let'
        ? classifyInternalMachineClassLetValue(value, env)
        : node.type === 'return'
          ? classifyInternalMachineClassReturnValue(value, env)
          : node.type === 'print'
            ? classifyInternalMachineClassScalarValue(value, env)
            : 'pure';
    if (disposition === 'suspending') {
      deferLeafOutput(node, env, deferredBindings);
      return;
    }
  }
  runInternalEffectMachineLeaf(node, env);
}

function assertDeferredAssignTarget(
  node: IRNode,
  target: string | undefined,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  if (node.type !== 'assign' || target === undefined || deferredBindings.has(target)) return;
  if (assignInternalMachineClassField(node, env, evalPortableValue, false)) return;
  if (!hasBinding(env, target)) throw new Error(`assign: binding "${target}" does not exist`);
  const current = getBinding(env, target);
  if (typeof current !== 'number' && typeof current !== 'string' && typeof current !== 'boolean') {
    throw new Error('assign: target must contain a number, string, or boolean');
  }
  if (node.props?.op === '+=' && typeof current === 'boolean') {
    throw new Error('assign: += requires a number or string target');
  }
}

export function assertInternalMachineDeferredCaughtExpression(
  raw: unknown,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string>,
): void {
  if (typeof raw !== 'string' || raw === '') return;
  assertDeferredCaughtUses(parseExpression(raw), env, deferredBindings);
}

function assertLeafDeferredCaughtUses(node: IRNode, env: SemanticEnv, deferredBindings: ReadonlySet<string>): void {
  if (node.type === 'fmt') {
    assertDeferredCaughtUses(parseExpression(`\`${String(node.props?.template)}\``), env, deferredBindings);
    return;
  }
  assertInternalMachineDeferredCaughtExpression(
    node.type === 'expression-v1' ? expressionV1Source(node) : node.props?.value,
    env,
    deferredBindings,
  );
}

function isDeferredCaughtBinding(name: string, env: SemanticEnv, deferredBindings: ReadonlySet<string>): boolean {
  return deferredBindings.has(name) && hasBinding(env, name) && isCaughtErrorValue(getBinding(env, name));
}

function assertDeferredCaughtUses(node: ValueIR, env: SemanticEnv, deferredBindings: ReadonlySet<string>): void {
  if (node.kind === 'ident') {
    if (isDeferredCaughtBinding(node.name, env, deferredBindings)) {
      throw new Error(`caught binding "${node.name}" is only portable through .message`);
    }
    return;
  }
  if (node.kind === 'member') {
    if (node.object.kind === 'ident' && isDeferredCaughtBinding(node.object.name, env, deferredBindings)) {
      if (node.optional || node.property !== 'message') {
        throw new Error(`caught binding "${node.object.name}" is only portable through .message`);
      }
      return;
    }
    assertDeferredCaughtUses(node.object, env, deferredBindings);
    return;
  }
  if (node.kind === 'unary') assertDeferredCaughtUses(node.argument, env, deferredBindings);
  else if (node.kind === 'binary') {
    assertDeferredCaughtUses(node.left, env, deferredBindings);
    assertDeferredCaughtUses(node.right, env, deferredBindings);
  } else if (node.kind === 'conditional') {
    assertDeferredCaughtUses(node.test, env, deferredBindings);
    assertDeferredCaughtUses(node.consequent, env, deferredBindings);
    assertDeferredCaughtUses(node.alternate, env, deferredBindings);
  } else if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertDeferredCaughtUses(node.expression, env, deferredBindings);
  } else if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) assertDeferredCaughtUses(expression, env, deferredBindings);
  } else if (node.kind === 'index') {
    assertDeferredCaughtUses(node.object, env, deferredBindings);
    assertDeferredCaughtUses(node.index, env, deferredBindings);
  } else if (node.kind === 'call') {
    for (const argument of node.args) assertDeferredCaughtUses(argument, env, deferredBindings);
  } else if (node.kind === 'arrayLit') {
    for (const item of node.items) assertDeferredCaughtUses(item, env, deferredBindings);
  } else if (node.kind === 'objectLit') {
    for (const entry of node.entries) {
      assertDeferredCaughtUses('kind' in entry ? entry.argument : entry.value, env, deferredBindings);
    }
  } else if (node.kind === 'new') assertDeferredCaughtUses(node.argument, env, deferredBindings);
}

function deferLeafOutput(node: IRNode, env: SemanticEnv, deferredBindings: Set<string>): void {
  const name = leafOutputName(node, env);
  if (typeof name !== 'string') return;
  if (node.type === 'let' || node.type === 'fmt' || node.type === 'expression-v1') defineBinding(env, name, null);
  deferredBindings.add(name);
}

function leafOutputName(node: IRNode, env?: SemanticEnv): string | undefined {
  const name =
    node.type === 'assign'
      ? node.props?.target
      : node.type === 'fmt' || node.type === 'let' || node.type === 'expression-v1'
        ? node.props?.name
        : node.type === 'do'
          ? internalMachineDoTargetName(node, env)
          : undefined;
  return typeof name === 'string' ? name : undefined;
}

function leafExpressionBindings(node: IRNode, env?: SemanticEnv): Set<string> {
  const out = new Set<string>();
  if (node.type === 'do') {
    const parsed = parseInternalMachineDo(node, env);
    if (parsed.kind === 'noop') return out;
    out.add(parsed.targetName);
    if (parsed.kind === 'push') addInternalMachineExpressionBindings(out, parsed.element);
    else {
      addInternalMachineExpressionBindings(out, parsed.key);
      addInternalMachineExpressionBindings(out, parsed.value);
    }
    return out;
  }
  if (node.type === 'fmt') {
    const parsed = parseExpression(`\`${String(node.props?.template)}\``);
    if (parsed.kind === 'tmplLit') {
      for (const expression of parsed.expressions) addInternalMachineExpressionBindings(out, expression);
    }
    return out;
  }
  const raw = node.type === 'expression-v1' ? expressionV1Source(node) : node.props?.value;
  if (typeof raw === 'string' && raw !== '') {
    for (const name of internalMachineExpressionBindings(raw)) out.add(name);
  }
  return out;
}

export function runInternalEffectMachineLeaf(node: IRNode, env: SemanticEnv): Trace {
  assertInternalEffectMachineLeafShape(node, env);
  if (node.type === 'assign') return runAssign(node, env);
  if (node.type === 'break') return { completion: { kind: 'break' }, events: [] };
  if (node.type === 'continue') return { completion: { kind: 'continue' }, events: [] };
  if (node.type === 'fmt') return runFmt(node, env);
  if (node.type === 'let') return runLet(node, env);
  if (node.type === 'print') return runInternalMachinePrint(node, env);
  if (node.type === 'return') return runInternalMachineReturn(node, env);
  if (node.type === 'do') return runInternalMachineDo(node, env);
  if (node.type === 'expression-v1') return runInternalMachineExpressionV1(node, env);
  return runThrow(node, env);
}

function parseRequiredExpression(node: IRNode, prop: string): ValueIR {
  const value = node.props?.[prop];
  if (typeof value !== 'string' || value === '') throw new Error(`${node.type}: ${prop} is required`);
  return parseExpression(value);
}

function validateAssignShape(node: IRNode, env?: SemanticEnv): void {
  if (env && assignInternalMachineClassField(node, env, evalPortableValue, false)) return;
  if (!isPortableBindingName(node.props?.target)) throw new Error('assign: target must be a portable identifier');
  const op = node.props?.op;
  if (op !== undefined && op !== '' && op !== '=' && op !== '+=') throw new Error('assign: unsupported operator');
  assertPortableMachineScalarShape(parseRequiredExpression(node, 'value'), env);
}

function runAssign(node: IRNode, env: SemanticEnv): Trace {
  const classAssignment = assignInternalMachineClassField(node, env, evalPortableValue);
  if (classAssignment) return classAssignment;
  const target = node.props?.target as string;
  if (!hasBinding(env, target)) throw new Error(`assign: binding "${target}" does not exist`);
  const current = getBinding(env, target);
  if (typeof current !== 'number' && typeof current !== 'string' && typeof current !== 'boolean') {
    throw new Error('assign: target must contain a number, string, or boolean');
  }
  const right = evalPortableValue(parseRequiredExpression(node, 'value'), env);
  const op = node.props?.op === '+=' ? '+=' : '=';
  let value: PortableScalar;
  if (op === '=') {
    if (typeof right !== typeof current) throw new Error('assign: replacement must preserve the binding type');
    value = right;
  } else if (typeof current === 'number' && typeof right === 'number') {
    value = current + right;
    if (!Number.isFinite(value)) throw new Error('assign: addition produced a non-finite number');
  } else if (typeof current === 'string' && typeof right === 'string') value = current + right;
  else throw new Error('assign: += requires two numbers or two strings');
  assignBinding(env, target, value);
  return {
    completion: { kind: 'normal' },
    events: [{ op: 'assign', target, value }],
  };
}

function validateLetShape(node: IRNode, env?: SemanticEnv): void {
  if (!isPortableBindingName(node.props?.name)) throw new Error('let: name must be a portable identifier');
  const kind = node.props?.kind;
  if (kind !== undefined && kind !== '' && kind !== 'let' && kind !== 'const') {
    throw new Error('let: unsupported declaration kind');
  }
  const value = parseRequiredExpression(node, 'value');
  if (env && classifyInternalMachineClassLetValue(value, env) !== 'unsupported') return;
  assertPortableMachineLetShape(value, env);
}

type MachineLetSource = 'array' | 'class' | 'map' | 'other' | 'record' | 'record-field';

function evaluateLetValue(
  node: IRNode,
  env: SemanticEnv,
): { parsed: ValueIR; source: MachineLetSource; value: unknown } {
  const parsed = parseRequiredExpression(node, 'value');
  if (isArrayLiteralExpression(parsed)) {
    return {
      parsed,
      source: 'array',
      value: evalArrayLiteralValue(parsed, env, evalPortableValue),
    };
  }
  if (isRecordLiteralExpression(parsed)) {
    return {
      parsed,
      source: 'record',
      value: evalRecordLiteralValue(parsed, env, evalPortableValue, {
        captureFreshArrayBindings: true,
      }),
    };
  }
  const recordArrayField = evalRecordArrayFieldReferenceValue(parsed, env);
  if (recordArrayField !== undefined) return { parsed, source: 'record-field', value: recordArrayField };
  if (parsed.kind === 'new' && isEmptyMapConstructorCall(parsed.argument, env)) {
    return { parsed, source: 'map', value: new Map() };
  }
  if (parsed.kind === 'new') throw new Error('let: class construction is outside the machine domain');
  if (parsed.kind === 'ident' && hasBinding(env, parsed.name)) {
    return {
      parsed,
      source: 'other',
      value: assertRunnerPortableValue(getBinding(env, parsed.name), `binding "${parsed.name}"`),
    };
  }
  if (parsed.kind === 'call' && parsed.callee.kind === 'ident' && env.runnerFunctions?.has(parsed.callee.name)) {
    return {
      parsed,
      source: 'other',
      value: evalInternalMachineHelperValue(parsed.callee.name, parsed.args, env, evalPortableValue),
    };
  }
  return { parsed, source: 'other', value: evalPortableValue(parsed, env) };
}

function runLet(node: IRNode, env: SemanticEnv): Trace {
  const name = node.props?.name as string;
  if (hasOwnBinding(env, name)) throw new Error(`let: binding "${name}" already exists`);
  const { parsed, source, value } = evaluateLetValue(node, env);
  if (source === 'array') defineFreshArrayBinding(env, name, value as readonly unknown[]);
  else if (source === 'record') defineRecordBinding(env, name, value, internalMachineRecordArrayFields(value));
  else if (source === 'record-field') {
    defineCapturedArrayBinding(env, name, value as readonly unknown[]);
  } else if (parsed.kind === 'ident' && defineArrayAliasBinding(env, name, parsed.name, value)) {
    // Alias metadata is handled by defineArrayAliasBinding.
  } else defineBinding(env, name, value);
  return {
    completion: { kind: 'normal' },
    events: [{ op: 'assign', target: name, value }],
  };
}

function validateFmtShape(node: IRNode, env?: SemanticEnv): void {
  if (!isPortableBindingName(node.props?.name)) throw new Error('fmt: name must be a portable identifier');
  if (node.props?.return === true || node.props?.return === 'true') throw new Error('fmt: return form is unsupported');
  const template = node.props?.template;
  if (typeof template !== 'string') throw new Error('fmt: template is required');
  const parsed = parseExpression(`\`${template}\``);
  if (parsed.kind !== 'tmplLit' || parsed.quasis.some((quasi) => quasi.includes('\\'))) {
    throw new Error('fmt: invalid machine template');
  }
  for (const expression of parsed.expressions) assertPortableMachineScalarShape(expression, env);
}

function canonicalFmt(value: PortableScalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (!Number.isInteger(value)) throw new Error('fmt: interpolation requires an integer');
  return String(value);
}

function runFmt(node: IRNode, env: SemanticEnv): Trace {
  const name = node.props?.name as string;
  if (hasOwnBinding(env, name)) throw new Error(`fmt: binding "${name}" already exists`);
  const parsed = parseExpression(`\`${String(node.props?.template)}\``);
  if (parsed.kind !== 'tmplLit') throw new Error('fmt: invalid template');
  let value = '';
  for (let index = 0; index < parsed.quasis.length; index += 1) {
    value += parsed.quasis[index];
    if (index < parsed.expressions.length) value += canonicalFmt(evalPortableValue(parsed.expressions[index], env));
  }
  defineBinding(env, name, value);
  return {
    completion: { kind: 'normal' },
    events: [{ op: 'assign', target: name, value }],
  };
}

function validateThrowShape(node: IRNode, env?: SemanticEnv): void {
  if (typeof node.props?.errorKind === 'string') return;
  const parsed = parseRequiredExpression(node, 'value');
  const argument = explicitErrorArgument(parsed);
  if (!argument) throw new Error('throw: only new Error(message) is supported');
  assertPortableMachineScalarShape(argument, env);
}

function explicitErrorArgument(node: ValueIR): ValueIR | undefined {
  if (node.kind !== 'new' || node.argument.kind !== 'call') return undefined;
  const call = node.argument;
  if (call.optional || call.callee.kind !== 'ident' || call.callee.name !== 'Error' || call.args.length !== 1) {
    return undefined;
  }
  return call.args[0];
}

function runThrow(node: IRNode, env: SemanticEnv): Trace {
  let error: CanonicalError;
  if (typeof node.props?.errorKind === 'string') {
    error = {
      kind: node.props.errorKind,
      messagePattern: node.props?.messagePattern as RegExp | undefined,
    };
  } else {
    const argument = explicitErrorArgument(parseRequiredExpression(node, 'value'));
    if (!argument) throw new Error('throw: invalid explicit Error');
    const message = evalPortableValue(argument, env);
    if (typeof message !== 'string') throw new Error('throw: Error message must be text');
    error = { kind: 'Error', message };
  }
  return { completion: { error, kind: 'throw' }, events: [] };
}
