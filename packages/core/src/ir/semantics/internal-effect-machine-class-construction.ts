import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import type { RunnerClassBinding } from './semantic-env.js';

const EXPRESSION_PROPS = ['cond', 'expr', 'from', 'in', 'input', 'on', 'step', 'to', 'value'] as const;

export interface InternalMachineClassConstructorPlan {
  readonly mode: 'implicit' | 'none' | 'explicit';
  readonly postSuper: readonly IRNode[];
  readonly preSuper: readonly IRNode[];
  readonly superArguments: readonly ValueIR[];
}

function directSuperCall(node: IRNode): Extract<ValueIR, { kind: 'call' }> | undefined {
  if (node.type !== 'do' || typeof node.props?.value !== 'string') return undefined;
  const value = parseExpression(node.props.value);
  return value.kind === 'call' && value.callee.kind === 'ident' && value.callee.name === 'super' ? value : undefined;
}

function superCallCount(value: ValueIR): number {
  if (value.kind === 'lambda') return 0;
  let count = value.kind === 'call' && value.callee.kind === 'ident' && value.callee.name === 'super' ? 1 : 0;
  if (value.kind === 'member') return count + superCallCount(value.object);
  if (value.kind === 'call') {
    count += superCallCount(value.callee);
    for (const argument of value.args) count += superCallCount(argument);
    return count;
  }
  if (value.kind === 'index') return count + superCallCount(value.object) + superCallCount(value.index);
  if (value.kind === 'new' || value.kind === 'unary' || value.kind === 'spread' || value.kind === 'await') {
    return count + superCallCount(value.argument);
  }
  if (value.kind === 'typeAssert' || value.kind === 'nonNull') return count + superCallCount(value.expression);
  if (value.kind === 'propagate') return count + superCallCount(value.argument);
  if (value.kind === 'binary') return count + superCallCount(value.left) + superCallCount(value.right);
  if (value.kind === 'conditional') {
    return count + superCallCount(value.test) + superCallCount(value.consequent) + superCallCount(value.alternate);
  }
  if (value.kind === 'tmplLit') {
    return count + value.expressions.reduce((sum, expression) => sum + superCallCount(expression), 0);
  }
  if (value.kind === 'objectLit') {
    return (
      count +
      value.entries.reduce((sum, entry) => sum + superCallCount('kind' in entry ? entry.argument : entry.value), 0)
    );
  }
  if (value.kind === 'arrayLit') {
    return count + value.items.reduce((sum, item) => sum + superCallCount(item), 0);
  }
  return count;
}

function bodySuperCallCount(nodes: readonly IRNode[]): number {
  let count = 0;
  for (const node of nodes) {
    for (const key of EXPRESSION_PROPS) {
      const source = node.props?.[key];
      if (typeof source === 'string' && source !== '') count += superCallCount(parseExpression(source));
    }
    if (typeof node.props?.template === 'string') {
      count += superCallCount(parseExpression(`\`${node.props.template}\``));
    }
    if (node.children) count += bodySuperCallCount(node.children);
  }
  return count;
}

function assertSuperArgument(node: ValueIR): void {
  if (node.kind === 'numLit' || node.kind === 'strLit' || node.kind === 'boolLit' || node.kind === 'nullLit') return;
  if (node.kind === 'ident') {
    if (node.name !== 'this' && node.name !== 'super') return;
    throw new Error(`machine class: super argument cannot use "${node.name}"`);
  }
  if (node.kind === 'unary') {
    assertSuperArgument(node.argument);
    return;
  }
  if (node.kind === 'binary') {
    assertSuperArgument(node.left);
    assertSuperArgument(node.right);
    return;
  }
  if (node.kind === 'conditional') {
    assertSuperArgument(node.test);
    assertSuperArgument(node.consequent);
    assertSuperArgument(node.alternate);
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertSuperArgument(node.expression);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) assertSuperArgument(expression);
    return;
  }
  throw new Error(`machine class: super argument kind "${node.kind}" is outside this slice`);
}

function effectiveBaseConstructor(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): RunnerClassBinding | undefined {
  // Cross-module inheritance is rejected before constructor planning; every
  // admitted candidate therefore resolves through this one defining registry.
  const seen = new Set<string>();
  let current: RunnerClassBinding | undefined = cls.extendsName ? registry.get(cls.extendsName) : undefined;
  while (current) {
    if (seen.has(current.name)) throw new Error(`machine class: cyclic inheritance at "${current.name}"`);
    seen.add(current.name);
    if (current.constructor) return current;
    current = current.extendsName ? registry.get(current.extendsName) : undefined;
  }
  return undefined;
}

export function internalMachineClassConstructorPlan(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): InternalMachineClassConstructorPlan {
  const body = cls.constructor?.body ?? [];
  const count = bodySuperCallCount(body);
  if (!cls.extendsName) {
    if (count !== 0) throw new Error(`machine class: root constructor "${cls.name}" calls super`);
    return { mode: 'none', postSuper: body, preSuper: [], superArguments: [] };
  }
  const effectiveBase = effectiveBaseConstructor(cls, registry);
  if (count === 0) {
    if ((effectiveBase?.constructor?.params.length ?? 0) !== 0) {
      throw new Error(`machine class: implicit super for "${cls.name}" requires base arguments`);
    }
    return { mode: 'implicit', postSuper: body, preSuper: [], superArguments: [] };
  }
  const superIndex = body.findIndex((node) => directSuperCall(node) !== undefined);
  const direct = superIndex >= 0 ? directSuperCall(body[superIndex]) : undefined;
  if (count !== 1 || !direct) {
    throw new Error(`machine class: constructor super for "${cls.name}" must be one direct top-level call`);
  }
  for (const argument of direct.args) assertSuperArgument(argument);
  const immediateBase = registry.get(cls.extendsName);
  if (!immediateBase) throw new Error(`machine class: unknown base class "${cls.extendsName}"`);
  if (immediateBase.constructor) {
    if (direct.args.length !== immediateBase.constructor.params.length) {
      throw new Error(`machine class: super for "${cls.name}" has invalid arity`);
    }
  } else {
    if (direct.args.length !== 0) {
      throw new Error(`machine class: super arguments cannot cross constructor-less base "${immediateBase.name}"`);
    }
    if ((effectiveBase?.constructor?.params.length ?? 0) !== 0) {
      throw new Error(`machine class: constructor-less base for "${cls.name}" requires arguments`);
    }
  }
  return {
    mode: 'explicit',
    postSuper: body.slice(superIndex + 1),
    preSuper: body.slice(0, superIndex),
    superArguments: direct.args,
  };
}

export function assertInternalMachineClassConstructorPlans(registry: ReadonlyMap<string, RunnerClassBinding>): void {
  for (const cls of registry.values()) internalMachineClassConstructorPlan(cls, registry);
}
