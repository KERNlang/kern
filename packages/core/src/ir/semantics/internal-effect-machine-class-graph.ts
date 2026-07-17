import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { internalMachineClassReceiver } from './internal-effect-machine-class-instance.js';
import {
  assertInternalMachineClassInheritance,
  internalMachineClassMemberFor,
  internalMachineClassVisibleFields,
} from './internal-effect-machine-class-lineage.js';
import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import {
  assertInternalMachineModuleGraph,
  type InternalMachineModuleGraph,
  internalMachineClassForEnv,
  internalMachineModuleScopeForEnv,
} from './internal-effect-machine-module-graph.js';
import { lambdaRequiresIterationBudget } from './lambda-preflight.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import type { RunnerClassBinding, RunnerClassMemberBinding, RunnerModuleScope, SemanticEnv } from './semantic-env.js';

export interface InternalMachineClassGraph {
  readonly classes: ReadonlyMap<string, RunnerClassBinding>;
  readonly moduleGraph: InternalMachineModuleGraph;
  readonly requiresIterationBudget: boolean;
}

function classBodyRequiresIterationBudget(nodes: readonly IRNode[]): boolean {
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (
      node.type === 'each' ||
      node.type === 'for' ||
      node.type === 'while' ||
      (node.type === 'lambda' && lambdaRequiresIterationBudget(node))
    ) {
      return true;
    }
    for (const child of node.children ?? []) pending.push(child);
  }
  return false;
}

function assertGetter(key: string, getter: RunnerClassMemberBinding, cls: RunnerClassBinding): void {
  if (
    getter.name !== key ||
    getter.ownerClass !== cls.name ||
    !isPortableBindingName(key) ||
    getter.params.length !== 0 ||
    !Array.isArray(getter.body)
  ) {
    throw new Error(`machine class: invalid getter "${cls.name}.${key}"`);
  }
}

function assertMethod(key: string, method: RunnerClassMemberBinding, cls: RunnerClassBinding): void {
  if (
    method.name !== key ||
    method.ownerClass !== cls.name ||
    !isPortableBindingName(key) ||
    !Array.isArray(method.body)
  ) {
    throw new Error(`machine class: invalid method "${cls.name}.${key}"`);
  }
  const params = new Set<string>();
  for (const param of method.params) {
    if (!isPortableBindingName(param) || params.has(param)) {
      throw new Error(`machine class: invalid method parameters for "${cls.name}.${key}"`);
    }
    params.add(param);
  }
}

function assertConstructor(cls: RunnerClassBinding): void {
  const ctor = cls.constructor;
  if (!ctor) return;
  if (
    ctor.name !== 'constructor' ||
    ctor.ownerClass !== cls.name ||
    !Array.isArray(ctor.params) ||
    !Array.isArray(ctor.body)
  ) {
    throw new Error(`machine class: invalid constructor for "${cls.name}"`);
  }
  const params = new Set<string>();
  for (const param of ctor.params) {
    if (!isPortableBindingName(param) || params.has(param)) {
      throw new Error(`machine class: invalid constructor parameters for "${cls.name}"`);
    }
    params.add(param);
  }
}

function assertClassBinding(key: string, cls: RunnerClassBinding, scope: RunnerModuleScope): void {
  if (!isPortableBindingName(key) || !isPortableBindingName(cls.name)) {
    throw new Error(`machine class: invalid binding name "${key}"`);
  }
  if (!cls.module || cls.module.classes.get(cls.name) !== cls) {
    throw new Error(`machine class: "${key}" has invalid defining-module identity`);
  }
  if (scope.classes.get(key) !== cls) {
    throw new Error(`machine class: "${key}" is not bound in the selected module`);
  }
  if (cls.extendsName !== undefined && !isPortableBindingName(cls.extendsName)) {
    throw new Error(`machine class: invalid base class name for "${key}"`);
  }
  if (!Array.isArray(cls.fields)) throw new Error(`machine class: invalid fields for "${key}"`);
  const fields = new Set<string>();
  for (const field of cls.fields) {
    if (!isPortableBindingName(field.name) || fields.has(field.name)) {
      throw new Error(`machine class: invalid or duplicate field in "${key}"`);
    }
    if (field.value !== undefined && typeof field.value !== 'string') {
      throw new Error(`machine class: field "${key}.${field.name}" has a non-expression initializer`);
    }
    fields.add(field.name);
  }
  assertConstructor(cls);
  for (const [methodName, method] of cls.methods) assertMethod(methodName, method, cls);
  for (const [getterName, getter] of cls.getters) assertGetter(getterName, getter, cls);
}

export function assertInternalMachineClassGraph(env: SemanticEnv): InternalMachineClassGraph {
  const moduleGraph = assertInternalMachineModuleGraph(env);
  const seen = new Set<RunnerClassBinding>();
  for (const scope of moduleGraph.scopes) {
    for (const [key, cls] of scope.classes) {
      assertClassBinding(key, cls, scope);
      seen.add(cls);
    }
    assertInternalMachineClassInheritance(scope.classes);
  }
  return {
    classes: moduleGraph.root.classes,
    moduleGraph,
    requiresIterationBudget: [...seen].some((cls) =>
      [...(cls.constructor ? [cls.constructor] : []), ...cls.methods.values(), ...cls.getters.values()].some((member) =>
        classBodyRequiresIterationBudget(member.body),
      ),
    ),
  };
}

function classForConstruction(
  node: IRNode,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): RunnerClassBinding | undefined {
  if (node.type !== 'let' || typeof node.props?.value !== 'string') return undefined;
  const value = parseExpression(node.props.value);
  if (
    value.kind === 'new' &&
    value.argument.kind === 'call' &&
    !value.argument.optional &&
    value.argument.callee.kind === 'ident'
  ) {
    return registry.get(value.argument.callee.name);
  }
  return undefined;
}

function valueUsesRootClass(
  value: ValueIR,
  rootInstances: ReadonlyMap<string, RunnerClassBinding>,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): boolean {
  if (value.kind === 'ident') return rootInstances.has(value.name);
  if (value.kind === 'member') {
    if (value.object.kind === 'ident') {
      const cls = rootInstances.get(value.object.name);
      if (
        cls &&
        (internalMachineClassVisibleFields(cls, registry).has(value.property) ||
          internalMachineClassMemberFor(cls, value.property, 'getter', registry))
      ) {
        return true;
      }
    }
    return valueUsesRootClass(value.object, rootInstances, registry);
  }
  if (value.kind === 'call') {
    if (value.callee.kind === 'member' && value.callee.object.kind === 'ident') {
      const cls = rootInstances.get(value.callee.object.name);
      if (cls && internalMachineClassMemberFor(cls, value.callee.property, 'method', registry)) return true;
    }
    return (
      valueUsesRootClass(value.callee, rootInstances, registry) ||
      value.args.some((argument) => valueUsesRootClass(argument, rootInstances, registry))
    );
  }
  if (value.kind === 'index') {
    return (
      valueUsesRootClass(value.object, rootInstances, registry) ||
      valueUsesRootClass(value.index, rootInstances, registry)
    );
  }
  if (value.kind === 'lambda') {
    return value.body ? valueUsesRootClass(value.body, rootInstances, registry) : false;
  }
  if (value.kind === 'binary') {
    return (
      valueUsesRootClass(value.left, rootInstances, registry) ||
      valueUsesRootClass(value.right, rootInstances, registry)
    );
  }
  if (value.kind === 'new') {
    if (
      value.argument.kind === 'call' &&
      value.argument.callee.kind === 'ident' &&
      registry.has(value.argument.callee.name)
    ) {
      return true;
    }
    return valueUsesRootClass(value.argument, rootInstances, registry);
  }
  if (value.kind === 'unary' || value.kind === 'spread' || value.kind === 'await') {
    return valueUsesRootClass(value.argument, rootInstances, registry);
  }
  if (value.kind === 'typeAssert' || value.kind === 'nonNull') {
    return valueUsesRootClass(value.expression, rootInstances, registry);
  }
  if (value.kind === 'propagate') return valueUsesRootClass(value.argument, rootInstances, registry);
  if (value.kind === 'tmplLit') {
    return value.expressions.some((expression) => valueUsesRootClass(expression, rootInstances, registry));
  }
  if (value.kind === 'objectLit') {
    return value.entries.some((entry) =>
      valueUsesRootClass('kind' in entry ? entry.argument : entry.value, rootInstances, registry),
    );
  }
  if (value.kind === 'arrayLit') {
    return value.items.some((item) => valueUsesRootClass(item, rootInstances, registry));
  }
  if (value.kind === 'conditional') {
    return (
      valueUsesRootClass(value.test, rootInstances, registry) ||
      valueUsesRootClass(value.consequent, rootInstances, registry) ||
      valueUsesRootClass(value.alternate, rootInstances, registry)
    );
  }
  return false;
}

function nodeUsesRootClass(
  node: IRNode,
  rootInstances: ReadonlyMap<string, RunnerClassBinding>,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): boolean {
  for (const key of ['cond', 'expr', 'from', 'in', 'input', 'on', 'step', 'to', 'value'] as const) {
    const raw = node.props?.[key];
    if (typeof raw === 'string' && raw !== '' && valueUsesRootClass(parseExpression(raw), rootInstances, registry)) {
      return true;
    }
  }
  return (
    typeof node.props?.template === 'string' &&
    valueUsesRootClass(parseExpression(`\`${node.props.template}\``), rootInstances, registry)
  );
}

function assertRootClassUsage(
  nodes: readonly IRNode[],
  rootInstances: Map<string, RunnerClassBinding>,
  registry: ReadonlyMap<string, RunnerClassBinding>,
  depth = 0,
): void {
  for (const node of nodes) {
    const constructedClass = classForConstruction(node, registry);
    if (depth > 0 && constructedClass) {
      throw new Error('machine class: allocation must occur in the root sequence');
    }
    if (depth === 0 && constructedClass && typeof node.props?.name === 'string') {
      rootInstances.set(node.props.name, constructedClass);
    }
    if (depth > 0 && node.type === 'assign' && String(node.props?.target ?? '').includes('.')) {
      throw new Error('machine class: field mutation must occur in the root sequence');
    }
    if (depth > 0 && nodeUsesRootClass(node, rootInstances, registry)) {
      throw new Error('machine class: class use must occur in the root sequence');
    }
    if (node.children) assertRootClassUsage(node.children, rootInstances, registry, depth + 1);
  }
}

export function assertInternalMachineClassUsage(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  admittedRegistry = assertInternalMachineClassGraph(env).classes,
): void {
  if (admittedRegistry.size === 0) return;
  assertRootClassUsage(nodes, new Map(), admittedRegistry);
}

export function internalMachineClassGraphClaims(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  try {
    const graph = assertInternalMachineClassGraph(env);
    assertInternalMachineClassUsage(nodes, env, graph.classes);
    return true;
  } catch {
    return false;
  }
}

export function internalMachineClassGraphHasClasses(env: SemanticEnv): boolean {
  try {
    return assertInternalMachineClassGraph(env).moduleGraph.scopes.some((scope) => scope.classes.size > 0);
  } catch {
    return false;
  }
}

export function internalMachineClassGraphRequiresIterationBudget(env: SemanticEnv): boolean {
  try {
    return assertInternalMachineClassGraph(env).requiresIterationBudget;
  } catch {
    return false;
  }
}

export function internalMachineClassForNew(node: ValueIR, env: SemanticEnv): RunnerClassBinding | undefined {
  if (
    node.kind !== 'new' ||
    node.argument.kind !== 'call' ||
    node.argument.optional ||
    node.argument.callee.kind !== 'ident'
  ) {
    return undefined;
  }
  const state = internalEffectMachineStateForEnv(env);
  const admitted = state?.moduleGraph
    ? internalMachineClassForEnv(state.moduleGraph, env, node.argument.callee.name)
    : state?.classRegistry?.get(node.argument.callee.name);
  if (admitted) return admitted;
  const cls = env.runnerClasses?.get(node.argument.callee.name);
  if (!cls) return undefined;
  try {
    return assertInternalMachineClassGraph(env).classes.get(node.argument.callee.name);
  } catch {
    return undefined;
  }
}

export function internalMachineClassRegistryForEnv(env: SemanticEnv): ReadonlyMap<string, RunnerClassBinding> {
  const state = internalEffectMachineStateForEnv(env);
  if (state?.moduleGraph) {
    const scope = internalMachineModuleScopeForEnv(state.moduleGraph, env);
    if (scope) return scope.classes;
  }
  return state?.classRegistry ?? assertInternalMachineClassGraph(env).classes;
}

function internalMachineClassRegistryForReceiver(
  env: SemanticEnv,
  receiver: { readonly module?: RunnerModuleScope },
): ReadonlyMap<string, RunnerClassBinding> {
  const state = internalEffectMachineStateForEnv(env);
  if (state?.moduleGraph && receiver.module && state.moduleGraph.scopes.includes(receiver.module)) {
    return receiver.module.classes;
  }
  return internalMachineClassRegistryForEnv(env);
}

export interface InternalMachineClassMethodCall {
  readonly cls: RunnerClassBinding;
  readonly method: RunnerClassMemberBinding;
  readonly receiverName: string;
}

export interface InternalMachineClassGetterRead {
  readonly cls: RunnerClassBinding;
  readonly getter: RunnerClassMemberBinding;
  readonly receiverName: string;
}

export function internalMachineClassGetterForRead(
  node: Extract<ValueIR, { kind: 'member' }>,
  env: SemanticEnv,
): InternalMachineClassGetterRead | undefined {
  if (node.optional || node.object.kind !== 'ident' || node.object.name === 'super') return undefined;
  const receiver = internalMachineClassReceiver(node.object.name, env);
  if (!receiver || Object.hasOwn(receiver.fields, node.property)) return undefined;
  const registry = internalMachineClassRegistryForReceiver(env, receiver);
  const cls = registry.get(receiver.className);
  const resolved = cls ? internalMachineClassMemberFor(cls, node.property, 'getter', registry) : undefined;
  return resolved ? { cls: resolved.cls, getter: resolved.member, receiverName: node.object.name } : undefined;
}

export function internalMachineClassMethodForCall(
  node: ValueIR,
  env: SemanticEnv,
): InternalMachineClassMethodCall | undefined {
  if (
    node.kind !== 'call' ||
    node.optional ||
    node.callee.kind !== 'member' ||
    node.callee.optional ||
    node.callee.object.kind !== 'ident'
  ) {
    return undefined;
  }
  if (node.callee.object.name === 'super') {
    const receiver = internalMachineClassReceiver('this', env);
    const baseName = env.runnerSuperClass;
    if (!receiver || !baseName) return undefined;
    const registry = internalMachineClassRegistryForReceiver(env, receiver);
    const base = registry.get(baseName);
    const resolved = base ? internalMachineClassMemberFor(base, node.callee.property, 'method', registry) : undefined;
    return resolved ? { cls: resolved.cls, method: resolved.member, receiverName: 'this' } : undefined;
  }
  if (node.callee.object.name === 'this') {
    const receiver = internalMachineClassReceiver('this', env);
    if (!receiver) return undefined;
    const registry = internalMachineClassRegistryForReceiver(env, receiver);
    const cls = registry.get(receiver.className);
    const resolved = cls ? internalMachineClassMemberFor(cls, node.callee.property, 'method', registry) : undefined;
    return resolved ? { cls: resolved.cls, method: resolved.member, receiverName: 'this' } : undefined;
  }
  const receiver = internalMachineClassReceiver(node.callee.object.name, env);
  if (!receiver) return undefined;
  const registry = internalMachineClassRegistryForReceiver(env, receiver);
  const cls = registry.get(receiver.className);
  const resolved = cls ? internalMachineClassMemberFor(cls, node.callee.property, 'method', registry) : undefined;
  return resolved ? { cls: resolved.cls, method: resolved.member, receiverName: node.callee.object.name } : undefined;
}
