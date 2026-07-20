import type { IRNode } from '../../types.js';
import { isRunnerMachineClassBinding, runnerMachineScopeGraph } from './runner-machine-scope.js';
import type {
  RunnerClassBinding,
  RunnerClassMemberBinding,
  RunnerFunctionBinding,
  RunnerModuleScope,
  SemanticEnv,
} from './semantic-env.js';

export interface InternalMachineModuleGraph {
  readonly classIdentity: ReadonlyMap<RunnerClassBinding, number>;
  readonly functionIdentity: ReadonlyMap<RunnerFunctionBinding, number>;
  readonly root: RunnerModuleScope;
  readonly scopeByFunctions: ReadonlyMap<RunnerModuleScope['functions'], RunnerModuleScope>;
  readonly scopes: readonly RunnerModuleScope[];
}

function snapshotNode(node: IRNode): IRNode {
  return {
    type: node.type,
    ...(node.loc ? { loc: { ...node.loc } } : {}),
    ...(node.props ? { props: structuredClone(node.props) } : {}),
    ...(node.__quotedProps ? { __quotedProps: [...node.__quotedProps] } : {}),
    ...(node.children ? { children: node.children.map(snapshotNode) } : {}),
  };
}

function snapshotMember(member: RunnerClassMemberBinding): RunnerClassMemberBinding {
  return {
    body: member.body.map(snapshotNode),
    ...(member.handler ? { handler: snapshotNode(member.handler) } : {}),
    name: member.name,
    ownerClass: member.ownerClass,
    params: [...member.params],
  };
}

export function assertInternalMachineModuleGraph(env: SemanticEnv): InternalMachineModuleGraph {
  const functions = env.runnerFunctions;
  if (!functions) {
    if (env.runnerClasses && env.runnerClasses.size > 0) {
      throw new Error('machine module: root function scope is missing');
    }
    const root: RunnerModuleScope = { classes: new Map(), functions: new Map() };
    return {
      classIdentity: new Map(),
      functionIdentity: new Map(),
      root,
      scopeByFunctions: new Map([[root.functions, root]]),
      scopes: [root],
    };
  }
  const owned = runnerMachineScopeGraph(functions, env.runnerClasses);
  if (!owned) throw new Error('machine module: root scope graph is not linker-owned');

  const scopeClones = new Map<RunnerModuleScope, RunnerModuleScope>();
  for (const scope of owned.scopes) scopeClones.set(scope, { classes: new Map(), functions: new Map() });

  const functionClones = new Map<RunnerFunctionBinding, RunnerFunctionBinding>();
  const classClones = new Map<RunnerClassBinding, RunnerClassBinding>();
  const cloneFunction = (binding: RunnerFunctionBinding): RunnerFunctionBinding => {
    const existing = functionClones.get(binding);
    if (existing) return existing;
    const module = binding.module ? scopeClones.get(binding.module) : undefined;
    if (!module) throw new Error(`machine module: function "${binding.name}" has a foreign defining scope`);
    const clone: RunnerFunctionBinding = {
      body: binding.body.map(snapshotNode),
      ...(binding.handler ? { handler: snapshotNode(binding.handler) } : {}),
      module,
      name: binding.name,
      params: [...binding.params],
      returns: structuredClone(binding.returns),
    };
    functionClones.set(binding, clone);
    return clone;
  };
  const cloneClass = (binding: RunnerClassBinding): RunnerClassBinding => {
    const existing = classClones.get(binding);
    if (existing) return existing;
    if (!isRunnerMachineClassBinding(binding)) {
      throw new Error('machine module: class binding is not linker-owned');
    }
    const module = binding.module ? scopeClones.get(binding.module) : undefined;
    if (!module) throw new Error(`machine module: class "${binding.name}" has a foreign defining scope`);
    const clone: RunnerClassBinding = {
      name: binding.name,
      ...(binding.extendsName !== undefined ? { extendsName: binding.extendsName } : {}),
      fields: binding.fields.map((field) => ({ name: field.name, value: field.value })),
      constructor: binding.constructor ? snapshotMember(binding.constructor) : undefined,
      methods: new Map([...binding.methods].map(([name, member]) => [name, snapshotMember(member)])),
      getters: new Map([...binding.getters].map(([name, member]) => [name, snapshotMember(member)])),
      module,
    };
    classClones.set(binding, clone);
    return clone;
  };

  for (const original of owned.scopes) {
    const clone = scopeClones.get(original);
    if (!clone) throw new Error('machine module: scope snapshot allocation failed');
    for (const [name, binding] of original.functions) clone.functions.set(name, cloneFunction(binding));
    for (const [name, binding] of original.classes) clone.classes.set(name, cloneClass(binding));
  }

  const root = scopeClones.get(owned.root);
  if (!root) throw new Error('machine module: root scope snapshot is missing');
  const scopes = [...scopeClones.values()];
  const scopeByFunctions = new Map<RunnerModuleScope['functions'], RunnerModuleScope>();
  for (const [original, clone] of scopeClones) {
    scopeByFunctions.set(original.functions, clone);
    scopeByFunctions.set(clone.functions, clone);
  }
  return {
    classIdentity: new Map([...classClones.values()].map((binding, index) => [binding, index])),
    functionIdentity: new Map([...functionClones.values()].map((binding, index) => [binding, index])),
    root,
    scopeByFunctions,
    scopes,
  };
}

export function internalMachineModuleScopeForEnv(
  graph: InternalMachineModuleGraph,
  env: SemanticEnv,
): RunnerModuleScope | undefined {
  return env.runnerFunctions ? graph.scopeByFunctions.get(env.runnerFunctions) : undefined;
}

export function internalMachineFunctionForEnv(
  graph: InternalMachineModuleGraph,
  env: SemanticEnv,
  name: string,
): RunnerFunctionBinding | undefined {
  return internalMachineModuleScopeForEnv(graph, env)?.functions.get(name);
}

export function internalMachineClassForEnv(
  graph: InternalMachineModuleGraph,
  env: SemanticEnv,
  name: string,
): RunnerClassBinding | undefined {
  return internalMachineModuleScopeForEnv(graph, env)?.classes.get(name);
}
