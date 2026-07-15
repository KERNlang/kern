import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import { isRunnerMachineClassBinding, runnerMachineRootScope } from './runner-machine-scope.js';
import type { RunnerClassBinding, RunnerModuleScope, SemanticEnv } from './semantic-env.js';

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
  return {
    name: cls.name,
    fields: cls.fields.map((field) => ({ name: field.name, value: field.value })),
    constructor: cls.constructor
      ? {
          name: cls.constructor.name,
          ownerClass: cls.constructor.ownerClass,
          params: [...cls.constructor.params],
          body: cls.constructor.body.map(snapshotNode),
          ...(cls.constructor.handler ? { handler: snapshotNode(cls.constructor.handler) } : {}),
        }
      : undefined,
    methods: new Map(),
    getters: new Map(),
    module: cls.module,
  };
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
  if (cls.extendsName !== undefined || cls.methods.size !== 0 || cls.getters.size !== 0) {
    throw new Error(`machine class: "${key}" has behavior outside the state-only domain`);
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
}

export function assertInternalMachineClassGraph(env: SemanticEnv): InternalMachineClassGraph {
  const classes = env.runnerClasses;
  if (!classes || classes.size === 0) return { classes: new Map() };
  if (env.runnerFunctions !== undefined && env.runnerFunctions.size !== 0) {
    throw new Error('machine class: helper/class mixing is outside this slice');
  }
  if (!env.runnerFunctions) throw new Error('machine class: root function scope is missing');
  const scope = runnerMachineRootScope(env.runnerFunctions, classes);
  if (!scope) throw new Error('machine class: root scope is not linker-owned');
  for (const [key, cls] of classes) assertClassBinding(key, cls, scope);
  return { classes: new Map([...classes].map(([name, cls]) => [name, snapshotClassBinding(cls)])) };
}

function isClassConstruction(node: IRNode, env: SemanticEnv): boolean {
  if (node.type !== 'let' || typeof node.props?.value !== 'string') return false;
  const value = parseExpression(node.props.value);
  return (
    value.kind === 'new' &&
    value.argument.kind === 'call' &&
    !value.argument.optional &&
    value.argument.callee.kind === 'ident' &&
    env.runnerClasses?.has(value.argument.callee.name) === true
  );
}

function assertRootClassUsage(nodes: readonly IRNode[], env: SemanticEnv, depth = 0): void {
  for (const node of nodes) {
    if (depth > 0 && isClassConstruction(node, env)) {
      throw new Error('machine class: allocation must occur in the root sequence');
    }
    if (depth > 0 && node.type === 'assign' && String(node.props?.target ?? '').includes('.')) {
      throw new Error('machine class: field mutation must occur in the root sequence');
    }
    if (node.children) assertRootClassUsage(node.children, env, depth + 1);
  }
}

export function assertInternalMachineClassUsage(nodes: readonly IRNode[], env: SemanticEnv): void {
  if ((env.runnerClasses?.size ?? 0) === 0) return;
  assertRootClassUsage(nodes, env);
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
