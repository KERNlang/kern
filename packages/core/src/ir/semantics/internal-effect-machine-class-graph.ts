import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { internalMachineClassReceiver } from './internal-effect-machine-class-instance.js';
import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import { isRunnerMachineClassBinding, runnerMachineRootScope } from './runner-machine-scope.js';
import type { RunnerClassBinding, RunnerClassMemberBinding, RunnerModuleScope, SemanticEnv } from './semantic-env.js';

export interface InternalMachineClassGraph {
  readonly classes: ReadonlyMap<string, RunnerClassBinding>;
}

function snapshotNode(node: IRNode): IRNode {
  return {
    type: node.type,
    ...(node.loc ? { loc: { ...node.loc } } : {}),
    ...(node.props ? { props: { ...node.props } } : {}),
    ...(node.__quotedProps ? { __quotedProps: [...node.__quotedProps] } : {}),
    ...(node.children ? { children: node.children.map(snapshotNode) } : {}),
  };
}

function snapshotClassBinding(cls: RunnerClassBinding): RunnerClassBinding {
  const snapshotMember = (member: RunnerClassMemberBinding): RunnerClassMemberBinding => ({
    body: member.body.map(snapshotNode),
    ...(member.handler ? { handler: snapshotNode(member.handler) } : {}),
    name: member.name,
    ownerClass: member.ownerClass,
    params: [...member.params],
  });
  return {
    name: cls.name,
    fields: cls.fields.map((field) => ({
      name: field.name,
      value: field.value,
    })),
    constructor: cls.constructor
      ? {
          name: cls.constructor.name,
          ownerClass: cls.constructor.ownerClass,
          params: [...cls.constructor.params],
          body: cls.constructor.body.map(snapshotNode),
          ...(cls.constructor.handler ? { handler: snapshotNode(cls.constructor.handler) } : {}),
        }
      : undefined,
    methods: new Map([...cls.methods].map(([name, member]) => [name, snapshotMember(member)])),
    getters: new Map(),
    module: cls.module,
  };
}

function assertMethod(key: string, method: RunnerClassMemberBinding, cls: RunnerClassBinding): void {
  if (method.name !== key || method.ownerClass !== cls.name || !isPortableBindingName(key)) {
    throw new Error(`machine class: invalid method "${cls.name}.${key}"`);
  }
  const params = new Set<string>();
  for (const param of method.params) {
    if (!isPortableBindingName(param) || params.has(param)) {
      throw new Error(`machine class: invalid method parameters for "${cls.name}.${key}"`);
    }
    params.add(param);
  }
  const statement = method.body.length === 1 ? method.body[0] : undefined;
  if (
    statement?.type !== 'return' ||
    typeof statement.props?.value !== 'string' ||
    statement.props.value === '' ||
    (statement.children !== undefined && statement.children.length > 0)
  ) {
    throw new Error(`machine class: method "${cls.name}.${key}" must contain exactly one scalar return`);
  }
}

function assertConstructor(cls: RunnerClassBinding): void {
  const ctor = cls.constructor;
  if (!ctor) return;
  if (ctor.name !== 'constructor' || ctor.ownerClass !== cls.name || !Array.isArray(ctor.params)) {
    throw new Error(`machine class: invalid constructor for "${cls.name}"`);
  }
  const params = new Set<string>();
  for (const param of ctor.params) {
    if (!isPortableBindingName(param) || params.has(param)) {
      throw new Error(`machine class: invalid constructor parameters for "${cls.name}"`);
    }
    params.add(param);
  }
  const fields = new Set(cls.fields.map((field) => field.name));
  for (const node of ctor.body) {
    const match =
      node.type === 'assign' && typeof node.props?.target === 'string'
        ? /^this\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(node.props.target)
        : null;
    if (
      !match ||
      !fields.has(match[1]) ||
      (node.props?.op !== undefined && node.props.op !== '' && node.props.op !== '=') ||
      typeof node.props?.value !== 'string' ||
      node.props.value === '' ||
      (node.children !== undefined && node.children.length > 0)
    ) {
      throw new Error(`machine class: constructor "${cls.name}" must contain only direct own-field assignments`);
    }
  }
}

function assertClassBinding(key: string, cls: RunnerClassBinding, scope: RunnerModuleScope): void {
  if (!isRunnerMachineClassBinding(cls)) {
    throw new Error(`machine class: "${key}" is not linker-owned`);
  }
  if (cls.name !== key || !isPortableBindingName(cls.name)) {
    throw new Error(`machine class: invalid binding name "${key}"`);
  }
  if (cls.module?.functions !== scope.functions || cls.module.classes !== scope.classes) {
    throw new Error(`machine class: "${key}" is not defined in the selected root module`);
  }
  if (cls.extendsName !== undefined || cls.getters.size !== 0) {
    throw new Error(`machine class: "${key}" has behavior outside the direct-method domain`);
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
}

export function assertInternalMachineClassGraph(env: SemanticEnv): InternalMachineClassGraph {
  const classes = env.runnerClasses;
  if (!classes || classes.size === 0) return { classes: new Map() };
  if (!env.runnerFunctions) throw new Error('machine class: root function scope is missing');
  const scope = runnerMachineRootScope(env.runnerFunctions, classes);
  if (!scope) throw new Error('machine class: root scope is not linker-owned');
  for (const [key, cls] of classes) assertClassBinding(key, cls, scope);
  return {
    classes: new Map([...classes].map(([name, cls]) => [name, snapshotClassBinding(cls)])),
  };
}

function classForConstruction(node: IRNode, env: SemanticEnv): RunnerClassBinding | undefined {
  if (node.type !== 'let' || typeof node.props?.value !== 'string') return undefined;
  const value = parseExpression(node.props.value);
  if (
    value.kind === 'new' &&
    value.argument.kind === 'call' &&
    !value.argument.optional &&
    value.argument.callee.kind === 'ident'
  ) {
    return env.runnerClasses?.get(value.argument.callee.name);
  }
  return undefined;
}

function isDirectClassMethodLeaf(node: IRNode, rootInstances: ReadonlyMap<string, RunnerClassBinding>): boolean {
  if (
    (node.type !== 'let' && node.type !== 'print' && node.type !== 'return') ||
    typeof node.props?.value !== 'string'
  ) {
    return false;
  }
  const value = parseExpression(node.props.value);
  if (
    value.kind !== 'call' ||
    value.optional ||
    value.callee.kind !== 'member' ||
    value.callee.optional ||
    value.callee.object.kind !== 'ident'
  ) {
    return false;
  }
  return rootInstances.get(value.callee.object.name)?.methods.has(value.callee.property) === true;
}

function assertRootClassUsage(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  rootInstances: Map<string, RunnerClassBinding>,
  depth = 0,
): void {
  for (const node of nodes) {
    const constructedClass = classForConstruction(node, env);
    if (depth > 0 && constructedClass) {
      throw new Error('machine class: allocation must occur in the root sequence');
    }
    if (depth === 0 && constructedClass && typeof node.props?.name === 'string') {
      rootInstances.set(node.props.name, constructedClass);
    }
    if (depth > 0 && node.type === 'assign' && String(node.props?.target ?? '').includes('.')) {
      throw new Error('machine class: field mutation must occur in the root sequence');
    }
    if (depth > 0 && isDirectClassMethodLeaf(node, rootInstances)) {
      throw new Error('machine class: method calls must occur in the root sequence');
    }
    if (node.children) assertRootClassUsage(node.children, env, rootInstances, depth + 1);
  }
}

export function assertInternalMachineClassUsage(nodes: readonly IRNode[], env: SemanticEnv): void {
  if ((env.runnerClasses?.size ?? 0) === 0) return;
  assertRootClassUsage(nodes, env, new Map());
}

export function internalMachineClassGraphClaims(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  try {
    assertInternalMachineClassGraph(env);
    assertInternalMachineClassUsage(nodes, env);
    return true;
  } catch {
    return false;
  }
}

export function internalMachineClassGraphHasClasses(env: SemanticEnv): boolean {
  try {
    return assertInternalMachineClassGraph(env).classes.size > 0;
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
  const admitted = internalEffectMachineStateForEnv(env)?.classRegistry?.get(node.argument.callee.name);
  if (admitted) return admitted;
  const cls = env.runnerClasses?.get(node.argument.callee.name);
  if (!cls) return undefined;
  const graph = assertInternalMachineClassGraph(env);
  return graph.classes.get(cls.name);
}

export interface InternalMachineClassMethodCall {
  readonly cls: RunnerClassBinding;
  readonly method: RunnerClassMemberBinding;
  readonly receiverName: string;
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
    node.callee.object.kind !== 'ident' ||
    node.callee.object.name === 'this'
  ) {
    return undefined;
  }
  const receiver = internalMachineClassReceiver(node.callee.object.name, env);
  if (!receiver) return undefined;
  const registry = internalEffectMachineStateForEnv(env)?.classRegistry ?? assertInternalMachineClassGraph(env).classes;
  const cls = registry.get(receiver.className);
  const method = cls?.methods.get(node.callee.property);
  return cls && method ? { cls, method, receiverName: node.callee.object.name } : undefined;
}
