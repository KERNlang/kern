import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { assertInternalMachineClassGraph } from './internal-effect-machine-class-graph.js';
import { assertInternalMachineHelperClassComposition } from './internal-effect-machine-helper-class.js';
import {
  isInternalMachineHelperCall,
  isInternalMachineResumableHelperCall,
  isInternalMachineScalarHelperCall,
  isPortableScalarHelperReturnContract,
} from './internal-effect-machine-helper-contract.js';
import { hasNoBody, isUnifiedNodeType } from './internal-effect-machine-types.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import { runnerMachineRootScope } from './runner-machine-scope.js';
import type { RunnerClassBinding, RunnerFunctionBinding, RunnerModuleScope, SemanticEnv } from './semantic-env.js';

const PURE_HELPER_CONTAINER_TYPES = new Set(['branch', 'each', 'else', 'for', 'if', 'while']);
const PURE_HELPER_EXCLUDED_TYPES = new Set(['capability', 'lambda', 'print', 'try']);

export interface InternalMachineHelperGraph {
  readonly functions: ReadonlyMap<string, RunnerFunctionBinding>;
  readonly requiresIterationBudget: boolean;
  readonly resumableHelperNames: ReadonlySet<string>;
}

function transitiveResumableHelpers(
  direct: ReadonlySet<string>,
  calls: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const resumable = new Set(direct);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [caller, callees] of calls) {
      if (resumable.has(caller) || ![...callees].some((callee) => resumable.has(callee))) continue;
      resumable.add(caller);
      changed = true;
    }
  }
  return resumable;
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

function snapshotFunctionBinding(fn: RunnerFunctionBinding): RunnerFunctionBinding {
  return {
    body: fn.body.map(snapshotNode),
    ...(fn.handler ? { handler: snapshotNode(fn.handler) } : {}),
    module: fn.module,
    name: fn.name,
    params: [...fn.params],
    returns: structuredClone(fn.returns),
  };
}

function valueCalls(node: ValueIR, names: ReadonlyMap<string, RunnerFunctionBinding>, out: Set<string>): void {
  if (node.kind === 'call') {
    if (node.callee.kind === 'ident' && names.has(node.callee.name)) out.add(node.callee.name);
    valueCalls(node.callee, names, out);
    for (const argument of node.args) valueCalls(argument, names, out);
    return;
  }
  if (node.kind === 'unary' || node.kind === 'new' || node.kind === 'spread' || node.kind === 'await') {
    valueCalls(node.argument, names, out);
    return;
  }
  if (node.kind === 'propagate') {
    valueCalls(node.argument, names, out);
    return;
  }
  if (node.kind === 'binary') {
    valueCalls(node.left, names, out);
    valueCalls(node.right, names, out);
    return;
  }
  if (node.kind === 'conditional') {
    valueCalls(node.test, names, out);
    valueCalls(node.consequent, names, out);
    valueCalls(node.alternate, names, out);
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    valueCalls(node.expression, names, out);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) valueCalls(expression, names, out);
    return;
  }
  if (node.kind === 'member') {
    valueCalls(node.object, names, out);
    return;
  }
  if (node.kind === 'index') {
    valueCalls(node.object, names, out);
    valueCalls(node.index, names, out);
    return;
  }
  if (node.kind === 'arrayLit') {
    for (const item of node.items) valueCalls(item, names, out);
    return;
  }
  if (node.kind === 'objectLit') {
    for (const entry of node.entries) valueCalls('kind' in entry ? entry.argument : entry.value, names, out);
  }
}

function nodeExpressionSources(node: IRNode): readonly string[] {
  const props = node.props ?? {};
  const sources: string[] = [];
  for (const key of ['cond', 'expr', 'from', 'in', 'input', 'on', 'step', 'to', 'value'] as const) {
    if (
      key === 'value' &&
      node.type === 'path' &&
      (node.props?.default === true || node.props?.default === 'true' || node.__quotedProps?.includes('value') === true)
    ) {
      continue;
    }
    const value = props[key];
    if (typeof value === 'string' && value !== '') sources.push(value);
  }
  if (typeof props.template === 'string') sources.push(`\`${props.template}\``);
  return sources;
}

function directNodeCalls(node: IRNode, names: ReadonlyMap<string, RunnerFunctionBinding>, out: Set<string>): void {
  for (const source of nodeExpressionSources(node)) valueCalls(parseExpression(source), names, out);
}

function collectNodeCalls(
  nodes: readonly IRNode[],
  names: ReadonlyMap<string, RunnerFunctionBinding>,
  out: Set<string>,
): void {
  for (const node of nodes) {
    directNodeCalls(node, names, out);
    if (node.children) collectNodeCalls(node.children, names, out);
  }
}

function collectClassBodyCalls(
  classes: ReadonlyMap<string, RunnerClassBinding>,
  names: ReadonlyMap<string, RunnerFunctionBinding>,
  out: Set<string>,
): void {
  for (const cls of classes.values()) {
    if (cls.constructor) collectNodeCalls(cls.constructor.body, names, out);
    for (const member of cls.methods.values()) collectNodeCalls(member.body, names, out);
    for (const getter of cls.getters.values()) collectNodeCalls(getter.body, names, out);
  }
}

function assertPureHelperBody(nodes: readonly IRNode[]): boolean {
  let requiresIterationBudget = false;
  for (const node of nodes) {
    if (PURE_HELPER_EXCLUDED_TYPES.has(node.type)) {
      throw new Error(`machine helper: node type "${node.type}" is outside the pure helper domain`);
    }
    if (node.type === 'branch') {
      for (const path of node.children ?? []) {
        if (path.type !== 'path') {
          throw new Error('machine helper: branch path is outside the canonical sequence domain');
        }
        if (assertPureHelperBody(path.children ?? [])) requiresIterationBudget = true;
      }
      continue;
    }
    const container = PURE_HELPER_CONTAINER_TYPES.has(node.type);
    if (!container && (!isUnifiedNodeType(node.type) || !hasNoBody(node))) {
      throw new Error(`machine helper: node type "${node.type}" is outside the canonical sequence domain`);
    }
    if (node.type === 'each' || node.type === 'for' || node.type === 'while') requiresIterationBudget = true;
    if (node.children && assertPureHelperBody(node.children)) requiresIterationBudget = true;
  }
  return requiresIterationBudget;
}

function assertScalarHelperReturns(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  name: string,
  isScalarHelperCall: (name: string, arity: number) => boolean,
  isPortableHelperCall: (name: string, arity: number) => boolean,
  classScalarReturns: ReadonlySet<IRNode>,
): void {
  for (const node of nodes) {
    if (node.type === 'return') {
      const value = node.props?.value;
      if (typeof value !== 'string' || value === '') {
        throw new Error(`machine helper: scalar function "${name}" has a non-scalar return`);
      }
      try {
        assertPortableMachineScalarShape(parseExpression(value), env, isScalarHelperCall, isPortableHelperCall);
      } catch {
        if (classScalarReturns.has(node)) continue;
        throw new Error(`machine helper: scalar function "${name}" has a non-scalar return`);
      }
    }
    if (node.children) {
      assertScalarHelperReturns(node.children, env, name, isScalarHelperCall, isPortableHelperCall, classScalarReturns);
    }
  }
}

function assertScalarHelperContracts(
  functions: ReadonlyMap<string, RunnerFunctionBinding>,
  env: SemanticEnv,
  classScalarReturns: ReadonlyMap<string, ReadonlySet<IRNode>>,
): void {
  const helperFunctions = new Map(functions);
  const scalarFunctions = new Map(
    [...helperFunctions].filter(([, fn]) => isPortableScalarHelperReturnContract(fn.returns)),
  );
  const helperEnv: SemanticEnv = { ...env, runnerFunctions: helperFunctions };
  const isScalarHelperCall = (name: string, arity: number): boolean => {
    const fn = scalarFunctions.get(name);
    return fn !== undefined && fn.params.length === arity;
  };
  const isPortableHelperCall = (name: string, arity: number): boolean =>
    helperFunctions.get(name)?.params.length === arity;
  for (const [name, fn] of scalarFunctions) {
    assertScalarHelperReturns(
      fn.body,
      helperEnv,
      name,
      isScalarHelperCall,
      isPortableHelperCall,
      classScalarReturns.get(name) ?? new Set(),
    );
  }
}

function assertFunctionBinding(key: string, fn: RunnerFunctionBinding, scope: RunnerModuleScope): void {
  if (fn.name !== key || !isPortableBindingName(fn.name)) {
    throw new Error(`machine helper: invalid binding name "${key}"`);
  }
  if (fn.module?.functions !== scope.functions || fn.module.classes !== scope.classes) {
    throw new Error(`machine helper: "${key}" is not defined in the selected root module`);
  }
  if (!Array.isArray(fn.params) || !Array.isArray(fn.body)) {
    throw new Error(`machine helper: "${key}" has invalid params or body`);
  }
  const params = new Set<string>();
  for (const param of fn.params) {
    if (!isPortableBindingName(param) || params.has(param)) {
      throw new Error(`machine helper: "${key}" has invalid or duplicate parameters`);
    }
    params.add(param);
  }
  if (fn.returns === undefined || fn.returns === '' || fn.returns === 'void') {
    throw new Error(`machine helper: "${key}" must declare a non-void return`);
  }
}

function helperScope(env: SemanticEnv): RunnerModuleScope | undefined {
  if (!env.runnerFunctions || env.runnerFunctions.size === 0) return undefined;
  const scope = runnerMachineRootScope(env.runnerFunctions, env.runnerClasses);
  if (!scope) throw new Error('machine helper: root scope is not linker-owned');
  return scope;
}

export function assertInternalMachineHelperGraph(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  admittedClasses = assertInternalMachineClassGraph(env).classes,
): InternalMachineHelperGraph {
  const scope = helperScope(env);
  if (!scope) {
    return { functions: new Map(), requiresIterationBudget: false, resumableHelperNames: new Set() };
  }
  const pending = new Set<string>();
  collectNodeCalls(nodes, scope.functions, pending);
  collectClassBodyCalls(admittedClasses, scope.functions, pending);
  const functions = new Map<string, RunnerFunctionBinding>();
  const classScalarReturns = new Map<string, ReadonlySet<IRNode>>();
  const directResumableHelpers = new Set<string>();
  const helperCalls = new Map<string, ReadonlySet<string>>();
  let requiresIterationBudget = false;
  while (pending.size > 0) {
    const name = pending.values().next().value as string;
    pending.delete(name);
    if (functions.has(name)) continue;
    const fn = scope.functions.get(name);
    if (!fn) throw new Error(`machine helper: unknown function "${name}"`);
    assertFunctionBinding(name, fn, scope);
    if (assertPureHelperBody(fn.body)) requiresIterationBudget = true;
    const snapshot = snapshotFunctionBinding(fn);
    const composition = assertInternalMachineHelperClassComposition(snapshot.body, admittedClasses, env);
    classScalarReturns.set(name, composition.classScalarReturns);
    if (composition.composesClass) directResumableHelpers.add(name);
    functions.set(name, snapshot);
    const nested = new Set<string>();
    collectNodeCalls(snapshot.body, scope.functions, nested);
    helperCalls.set(name, nested);
    for (const called of nested) if (!functions.has(called)) pending.add(called);
  }
  assertScalarHelperContracts(functions, env, classScalarReturns);
  return {
    functions,
    requiresIterationBudget,
    resumableHelperNames: transitiveResumableHelpers(directResumableHelpers, helperCalls),
  };
}

export function internalMachineHelperGraphClaims(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  try {
    assertInternalMachineHelperGraph(nodes, env);
    return true;
  } catch {
    return false;
  }
}

export function internalMachineHelperGraphRequiresIterationBudget(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  try {
    return assertInternalMachineHelperGraph(nodes, env).requiresIterationBudget;
  } catch {
    return false;
  }
}

export function internalMachineHelperGraphHasReachableFunctions(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  try {
    return assertInternalMachineHelperGraph(nodes, env).functions.size > 0;
  } catch {
    return false;
  }
}

export function internalMachineHelperCallInValue(node: ValueIR, env: SemanticEnv): boolean {
  const functions = env.runnerFunctions;
  if (!functions || functions.size === 0) return false;
  const calls = new Set<string>();
  valueCalls(node, functions, calls);
  return calls.size > 0;
}

export function internalMachineHelperCallInRaw(raw: unknown, env: SemanticEnv): boolean {
  if (typeof raw !== 'string' || raw === '') return false;
  try {
    return internalMachineHelperCallInValue(parseExpression(raw), env);
  } catch {
    return false;
  }
}

export function internalMachineHelperCallInNode(node: IRNode, env: SemanticEnv): boolean {
  const functions = env.runnerFunctions;
  if (!functions || functions.size === 0) return false;
  const calls = new Set<string>();
  try {
    directNodeCalls(node, functions, calls);
  } catch {
    return false;
  }
  return calls.size > 0;
}

export { isInternalMachineHelperCall, isInternalMachineResumableHelperCall, isInternalMachineScalarHelperCall };
