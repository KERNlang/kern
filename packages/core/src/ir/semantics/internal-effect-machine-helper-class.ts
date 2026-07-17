import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import {
  internalMachineClassLineageBaseFirst,
  internalMachineClassMemberFor,
  internalMachineClassVisibleFields,
} from './internal-effect-machine-class-lineage.js';
import { isPortableScalarHelperReturnContract } from './internal-effect-machine-helper-contract.js';
import { assertPortableMachineLetShape, assertPortableMachineScalarShape } from './portable-machine-shape.js';
import type { RunnerClassBinding, RunnerClassMemberBinding, SemanticEnv } from './semantic-env.js';

interface ClassFrame {
  readonly owner: RunnerClassBinding;
  readonly receiver: RunnerClassBinding;
}

function expressionSources(node: IRNode): readonly string[] {
  const out: string[] = [];
  for (const key of ['cond', 'expr', 'from', 'in', 'input', 'on', 'step', 'to', 'value'] as const) {
    if (
      key === 'value' &&
      node.type === 'path' &&
      (node.props?.default === true || node.props?.default === 'true' || node.__quotedProps?.includes('value') === true)
    ) {
      continue;
    }
    const value = node.props?.[key];
    if (typeof value === 'string' && value !== '') out.push(value);
  }
  if (typeof node.props?.template === 'string') out.push(`\`${node.props.template}\``);
  return out;
}

function valueChildren(node: ValueIR): readonly ValueIR[] {
  if (node.kind === 'unary' || node.kind === 'new' || node.kind === 'spread' || node.kind === 'await') {
    return [node.argument];
  }
  if (node.kind === 'propagate') return [node.argument];
  if (node.kind === 'binary') return [node.left, node.right];
  if (node.kind === 'conditional') return [node.test, node.consequent, node.alternate];
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return [node.expression];
  if (node.kind === 'tmplLit') return node.expressions;
  if (node.kind === 'member') return [node.object];
  if (node.kind === 'index') return [node.object, node.index];
  if (node.kind === 'call') return [node.callee, ...node.args];
  if (node.kind === 'arrayLit') return node.items.filter((item): item is ValueIR => item !== undefined);
  if (node.kind === 'objectLit') {
    return node.entries.map((entry) => ('kind' in entry ? entry.argument : entry.value));
  }
  return [];
}

function mapValue(node: ValueIR, map: (child: ValueIR) => ValueIR): ValueIR {
  if (node.kind === 'unary' || node.kind === 'new' || node.kind === 'spread' || node.kind === 'await') {
    return { ...node, argument: map(node.argument) };
  }
  if (node.kind === 'propagate') return { ...node, argument: map(node.argument) };
  if (node.kind === 'binary') return { ...node, left: map(node.left), right: map(node.right) };
  if (node.kind === 'conditional') {
    return {
      ...node,
      test: map(node.test),
      consequent: map(node.consequent),
      alternate: map(node.alternate),
    };
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return { ...node, expression: map(node.expression) };
  if (node.kind === 'tmplLit') return { ...node, expressions: node.expressions.map(map) };
  if (node.kind === 'member') return { ...node, object: map(node.object) };
  if (node.kind === 'index') return { ...node, object: map(node.object), index: map(node.index) };
  if (node.kind === 'call') return { ...node, callee: map(node.callee), args: node.args.map(map) };
  if (node.kind === 'lambda') return node.body ? { ...node, body: map(node.body) } : node;
  if (node.kind === 'arrayLit') return { ...node, items: node.items.map(map) };
  if (node.kind === 'objectLit') {
    return {
      ...node,
      entries: node.entries.map((entry) =>
        'kind' in entry ? { ...entry, argument: map(entry.argument) } : { ...entry, value: map(entry.value) },
      ),
    };
  }
  return node;
}

function classScalarPlaceholder(): ValueIR {
  return { kind: 'numLit', value: 0, raw: '0' };
}

function classForNew(node: ValueIR, classes: ReadonlyMap<string, RunnerClassBinding>): RunnerClassBinding | undefined {
  if (node.kind !== 'new') return undefined;
  const target = node.argument;
  if (target.kind === 'ident') return classes.get(target.name);
  if (target.kind !== 'call' || target.optional || target.callee.kind !== 'ident') return undefined;
  return classes.get(target.callee.name);
}

function memberKey(owner: RunnerClassBinding, member: RunnerClassMemberBinding): string {
  return `${owner.name}.${member.name}`;
}

function assertReachedMember(
  owner: RunnerClassBinding,
  receiver: RunnerClassBinding,
  member: RunnerClassMemberBinding,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  stack: Set<string>,
): void {
  const key = memberKey(owner, member);
  if (stack.has(key)) throw new Error(`machine helper: recursive class member "${key}" is outside this slice`);
  stack.add(key);
  try {
    assertReachedClassNodes(member.body, { owner, receiver }, classes, env, stack);
  } finally {
    stack.delete(key);
  }
}

function assertReachedClassValue(
  node: ValueIR,
  frame: ClassFrame,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  stack: Set<string>,
): ValueIR {
  if (node.kind === 'new' && classForNew(node, classes)) {
    throw new Error('machine helper: class-to-class allocation is outside this slice');
  }
  if (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name === 'super') {
    for (const argument of node.args) {
      assertPortableMachineScalarShape(assertReachedClassValue(argument, frame, classes, env, stack), env);
    }
    return classScalarPlaceholder();
  }
  if (node.kind === 'call' && node.callee.kind === 'member' && node.callee.object.kind === 'ident') {
    if (node.optional || node.callee.optional) {
      throw new Error('machine helper: optional class method is outside this slice');
    }
    const receiverName = node.callee.object.name;
    const start =
      receiverName === 'this'
        ? frame.receiver
        : receiverName === 'super' && frame.owner.extendsName
          ? classes.get(frame.owner.extendsName)
          : undefined;
    if (start) {
      const resolved = internalMachineClassMemberFor(start, node.callee.property, 'method', classes);
      if (!resolved || node.args.length !== resolved.member.params.length) {
        throw new Error('machine helper: reached class method is unavailable');
      }
      for (const argument of node.args) {
        assertPortableMachineScalarShape(assertReachedClassValue(argument, frame, classes, env, stack), env);
      }
      assertReachedMember(resolved.cls, frame.receiver, resolved.member, classes, env, stack);
      return classScalarPlaceholder();
    }
  }
  if (node.kind === 'call' && node.callee.kind === 'ident') {
    const helper = env.runnerFunctions?.get(node.callee.name);
    if (helper) {
      if (node.optional || node.args.length !== helper.params.length) {
        throw new Error('machine helper: reached helper call is unavailable');
      }
      const args = node.args.map((argument) => assertReachedClassValue(argument, frame, classes, env, stack));
      for (const argument of args) assertPortableMachineLetShape(argument, env);
      return { ...node, args };
    }
  }
  if (node.kind === 'member' && node.object.kind === 'ident') {
    if (node.optional) throw new Error('machine helper: optional class member is outside this slice');
    const receiverName = node.object.name;
    const start =
      receiverName === 'this'
        ? frame.receiver
        : receiverName === 'super' && frame.owner.extendsName
          ? classes.get(frame.owner.extendsName)
          : undefined;
    if (start) {
      if (receiverName === 'this' && internalMachineClassVisibleFields(start, classes).has(node.property)) {
        return classScalarPlaceholder();
      }
      const resolved = internalMachineClassMemberFor(start, node.property, 'getter', classes);
      if (!resolved) throw new Error('machine helper: reached class field or getter is unavailable');
      assertReachedMember(resolved.cls, frame.receiver, resolved.member, classes, env, stack);
      return classScalarPlaceholder();
    }
  }
  if (node.kind === 'ident' && (node.name === 'this' || node.name === 'super')) {
    throw new Error('machine helper: private receiver cannot cross a class member boundary');
  }
  return mapValue(node, (child) => assertReachedClassValue(child, frame, classes, env, stack));
}

function assertReachedClassNodes(
  nodes: readonly IRNode[],
  frame: ClassFrame,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  stack: Set<string>,
): void {
  for (const node of nodes) {
    for (const source of expressionSources(node)) {
      assertReachedClassValue(parseExpression(source), frame, classes, env, stack);
    }
    if (node.children) assertReachedClassNodes(node.children, frame, classes, env, stack);
  }
}

function assertReachedConstruction(
  cls: RunnerClassBinding,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  stack: Set<string>,
): void {
  for (const layer of internalMachineClassLineageBaseFirst(cls, classes)) {
    if (layer.constructor) assertReachedMember(layer, cls, layer.constructor, classes, env, stack);
  }
}

function assertHelperValue(
  node: ValueIR,
  bindings: ReadonlyMap<string, RunnerClassBinding>,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  stack: Set<string>,
): void {
  if (node.kind === 'ident' && (node.name === 'this' || node.name === 'super')) {
    throw new Error('machine helper: class use is outside the pure helper domain');
  }
  if (node.kind === 'ident' && bindings.has(node.name)) {
    throw new Error('machine helper: class instance cannot cross the helper-local boundary');
  }
  if (node.kind === 'new' && classForNew(node, classes)) {
    throw new Error('machine helper: class allocation must bind a helper-local let');
  }
  if (node.kind === 'call' && node.callee.kind === 'member' && node.callee.object.kind === 'ident') {
    if (node.optional || node.callee.optional) {
      throw new Error('machine helper: optional class method is outside this slice');
    }
    const receiver = bindings.get(node.callee.object.name);
    if (receiver) {
      const resolved = internalMachineClassMemberFor(receiver, node.callee.property, 'method', classes);
      if (!resolved || node.args.length !== resolved.member.params.length) {
        throw new Error('machine helper: reached class method is unavailable');
      }
      for (const argument of node.args) {
        assertHelperValue(argument, bindings, classes, env, stack);
        assertPortableMachineScalarShape(portableHelperScalarShape(argument, bindings), env);
      }
      assertReachedMember(resolved.cls, receiver, resolved.member, classes, env, stack);
      return;
    }
  }
  if (node.kind === 'member' && node.object.kind === 'ident') {
    if (node.optional) throw new Error('machine helper: optional class member is outside this slice');
    const receiver = bindings.get(node.object.name);
    if (receiver) {
      if (internalMachineClassVisibleFields(receiver, classes).has(node.property)) return;
      const resolved = internalMachineClassMemberFor(receiver, node.property, 'getter', classes);
      if (!resolved) throw new Error('machine helper: reached class field or getter is unavailable');
      assertReachedMember(resolved.cls, receiver, resolved.member, classes, env, stack);
      return;
    }
  }
  for (const child of valueChildren(node)) assertHelperValue(child, bindings, classes, env, stack);
}

function usesHelperLocalClassScalar(node: ValueIR, bindings: ReadonlyMap<string, RunnerClassBinding>): boolean {
  if (
    node.kind === 'call' &&
    node.callee.kind === 'member' &&
    node.callee.object.kind === 'ident' &&
    bindings.has(node.callee.object.name)
  ) {
    return true;
  }
  if (node.kind === 'member' && node.object.kind === 'ident' && bindings.has(node.object.name)) return true;
  return valueChildren(node).some((child) => usesHelperLocalClassScalar(child, bindings));
}

function portableHelperScalarShape(node: ValueIR, bindings: ReadonlyMap<string, RunnerClassBinding>): ValueIR {
  if (
    node.kind === 'call' &&
    !node.optional &&
    node.callee.kind === 'member' &&
    !node.callee.optional &&
    node.callee.object.kind === 'ident' &&
    bindings.has(node.callee.object.name)
  ) {
    return classScalarPlaceholder();
  }
  if (node.kind === 'member' && !node.optional && node.object.kind === 'ident' && bindings.has(node.object.name)) {
    return classScalarPlaceholder();
  }
  return mapValue(node, (child) => portableHelperScalarShape(child, bindings));
}

function assertHelperNodes(
  nodes: readonly IRNode[],
  inherited: ReadonlyMap<string, RunnerClassBinding>,
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
  stack: Set<string>,
  classScalarReturns: Set<IRNode>,
  composition: { composesClass: boolean },
): void {
  const bindings = new Map(inherited);
  for (const node of nodes) {
    if (node.type === 'assign' && typeof node.props?.target === 'string' && bindings.has(node.props.target)) {
      throw new Error('machine helper: class binding identity cannot be reassigned');
    }
    const letValue =
      node.type === 'let' && typeof node.props?.value === 'string' ? parseExpression(node.props.value) : undefined;
    const constructed = letValue ? classForNew(letValue, classes) : undefined;
    if (constructed && letValue?.kind === 'new' && letValue.argument.kind === 'call') {
      composition.composesClass = true;
      for (const argument of letValue.argument.args) {
        assertHelperValue(argument, bindings, classes, env, stack);
        assertPortableMachineScalarShape(portableHelperScalarShape(argument, bindings), env);
      }
      assertReachedConstruction(constructed, classes, env, stack);
      const name = node.props?.name;
      if (typeof name !== 'string' || name === '') throw new Error('machine helper: class let requires a binding');
      bindings.set(name, constructed);
    } else {
      for (const source of expressionSources(node)) {
        assertHelperValue(parseExpression(source), bindings, classes, env, stack);
      }
      if (node.type === 'return' && typeof node.props?.value === 'string') {
        const value = parseExpression(node.props.value);
        if (usesHelperLocalClassScalar(value, bindings)) {
          composition.composesClass = true;
          const isScalarHelperCall = (name: string, arity: number): boolean => {
            const helper = env.runnerFunctions?.get(name);
            return helper?.params.length === arity && isPortableScalarHelperReturnContract(helper.returns);
          };
          const isPortableHelperCall = (name: string, arity: number): boolean =>
            env.runnerFunctions?.get(name)?.params.length === arity;
          assertPortableMachineScalarShape(
            portableHelperScalarShape(value, bindings),
            env,
            isScalarHelperCall,
            isPortableHelperCall,
          );
          classScalarReturns.add(node);
        }
      }
    }
    if (node.children) {
      assertHelperNodes(node.children, bindings, classes, env, stack, classScalarReturns, composition);
    }
  }
}

export interface InternalMachineHelperClassComposition {
  readonly classScalarReturns: ReadonlySet<IRNode>;
  readonly composesClass: boolean;
}

export function assertInternalMachineHelperClassComposition(
  nodes: readonly IRNode[],
  classes: ReadonlyMap<string, RunnerClassBinding>,
  env: SemanticEnv,
): InternalMachineHelperClassComposition {
  const classScalarReturns = new Set<IRNode>();
  const composition = { composesClass: false };
  assertHelperNodes(nodes, new Map(), classes, env, new Set(), classScalarReturns, composition);
  return { classScalarReturns, composesClass: composition.composesClass };
}
