import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { forEachValueIRChild } from '../../value-ir-walk.js';
import { assertInternalMachineClassGraph } from './internal-effect-machine-class-graph.js';
import { assertInternalMachineHelperClassComposition } from './internal-effect-machine-helper-class.js';
import {
  isInternalMachineHelperCall,
  isInternalMachineResumableHelperCall,
  isInternalMachineScalarHelperCall,
  isPortableScalarHelperReturnContract,
} from './internal-effect-machine-helper-contract.js';
import type { InternalMachineModuleGraph } from './internal-effect-machine-module-graph.js';
import { hasNoBody, isUnifiedNodeType } from './internal-effect-machine-types.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import type { RunnerClassBinding, RunnerFunctionBinding, SemanticEnv } from './semantic-env.js';

const PURE_HELPER_CONTAINER_TYPES = new Set(['branch', 'each', 'else', 'for', 'if', 'while']);
const PURE_HELPER_EXCLUDED_TYPES = new Set(['capability', 'lambda', 'print', 'try']);

export interface InternalMachineHelperGraph {
  readonly functions: ReadonlyMap<string, RunnerFunctionBinding>;
  readonly moduleGraph: InternalMachineModuleGraph;
  readonly reachableFunctions: ReadonlySet<RunnerFunctionBinding>;
  readonly requiresIterationBudget: boolean;
  readonly resumableHelpers: ReadonlySet<RunnerFunctionBinding>;
  readonly resumableHelperNames: ReadonlySet<string>;
}

function transitiveResumableHelpers(
  direct: ReadonlySet<RunnerFunctionBinding>,
  calls: ReadonlyMap<RunnerFunctionBinding, ReadonlySet<RunnerFunctionBinding>>,
): ReadonlySet<RunnerFunctionBinding> {
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

function valueCalls(
  node: ValueIR,
  names: ReadonlyMap<string, RunnerFunctionBinding>,
  out: Set<RunnerFunctionBinding>,
): void {
  const stack: ValueIR[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as ValueIR;
    if (current.kind === 'call' && current.callee.kind === 'ident') {
      const binding = names.get(current.callee.name);
      if (binding) out.add(binding);
    }
    // Preserve the helper graph's existing closure boundary: calls inside a
    // ValueIR lambda are owned by lambda admission, not the enclosing helper.
    if (current.kind === 'lambda') continue;
    const children: ValueIR[] = [];
    forEachValueIRChild(current, (child) => children.push(child));
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
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

function directNodeCalls(
  node: IRNode,
  names: ReadonlyMap<string, RunnerFunctionBinding>,
  out: Set<RunnerFunctionBinding>,
): void {
  for (const source of nodeExpressionSources(node)) valueCalls(parseExpression(source), names, out);
}

function collectNodeCalls(
  nodes: readonly IRNode[],
  names: ReadonlyMap<string, RunnerFunctionBinding>,
  out: Set<RunnerFunctionBinding>,
): void {
  for (const node of nodes) {
    directNodeCalls(node, names, out);
    if (node.children) collectNodeCalls(node.children, names, out);
  }
}

function collectClassBodyCalls(
  classes: ReadonlyMap<string, RunnerClassBinding>,
  out: Set<RunnerFunctionBinding>,
): void {
  for (const cls of new Set(classes.values())) {
    const names = cls.module?.functions;
    if (!names) throw new Error(`machine helper: class "${cls.name}" has no defining function scope`);
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
  functions: ReadonlySet<RunnerFunctionBinding>,
  env: SemanticEnv,
  classScalarReturns: ReadonlyMap<RunnerFunctionBinding, ReadonlySet<IRNode>>,
): void {
  for (const fn of functions) {
    if (!isPortableScalarHelperReturnContract(fn.returns)) continue;
    const scope = fn.module;
    if (!scope) throw new Error(`machine helper: "${fn.name}" has no defining module`);
    const helperEnv: SemanticEnv = { ...env, runnerClasses: scope.classes, runnerFunctions: scope.functions };
    const isScalarHelperCall = (name: string, arity: number): boolean => {
      const called = scope.functions.get(name);
      return (
        called !== undefined && called.params.length === arity && isPortableScalarHelperReturnContract(called.returns)
      );
    };
    const isPortableHelperCall = (name: string, arity: number): boolean =>
      scope.functions.get(name)?.params.length === arity;
    assertScalarHelperReturns(
      fn.body,
      helperEnv,
      fn.name,
      isScalarHelperCall,
      isPortableHelperCall,
      classScalarReturns.get(fn) ?? new Set(),
    );
  }
}

function assertFunctionBinding(fn: RunnerFunctionBinding): void {
  if (!isPortableBindingName(fn.name)) throw new Error(`machine helper: invalid binding name "${fn.name}"`);
  if (!fn.module || fn.module.functions.get(fn.name) !== fn) {
    throw new Error(`machine helper: "${fn.name}" has invalid defining-module identity`);
  }
  if (!Array.isArray(fn.params) || !Array.isArray(fn.body)) {
    throw new Error(`machine helper: "${fn.name}" has invalid params or body`);
  }
  const params = new Set<string>();
  for (const param of fn.params) {
    if (!isPortableBindingName(param) || params.has(param)) {
      throw new Error(`machine helper: "${fn.name}" has invalid or duplicate parameters`);
    }
    params.add(param);
  }
  if (fn.returns === undefined || fn.returns === '' || fn.returns === 'void') {
    throw new Error(`machine helper: "${fn.name}" must declare a non-void return`);
  }
}

export function assertInternalMachineHelperGraph(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  admittedClassGraph = assertInternalMachineClassGraph(env),
): InternalMachineHelperGraph {
  const moduleGraph = admittedClassGraph.moduleGraph;
  const scope = moduleGraph.root;
  const pending = new Set<RunnerFunctionBinding>();
  collectNodeCalls(nodes, scope.functions, pending);
  collectClassBodyCalls(scope.classes, pending);
  const functions = new Set<RunnerFunctionBinding>();
  const classScalarReturns = new Map<RunnerFunctionBinding, ReadonlySet<IRNode>>();
  const directResumableHelpers = new Set<RunnerFunctionBinding>();
  const helperCalls = new Map<RunnerFunctionBinding, ReadonlySet<RunnerFunctionBinding>>();
  let requiresIterationBudget = false;
  while (pending.size > 0) {
    const fn = pending.values().next().value as RunnerFunctionBinding;
    pending.delete(fn);
    if (functions.has(fn)) continue;
    assertFunctionBinding(fn);
    if (assertPureHelperBody(fn.body)) requiresIterationBudget = true;
    const defining = fn.module;
    if (!defining) throw new Error(`machine helper: "${fn.name}" has no defining module`);
    const helperEnv: SemanticEnv = {
      ...env,
      runnerClasses: defining.classes,
      runnerFunctions: defining.functions,
    };
    const composition = assertInternalMachineHelperClassComposition(fn.body, defining.classes, helperEnv);
    classScalarReturns.set(fn, composition.classScalarReturns);
    if (composition.composesClass) directResumableHelpers.add(fn);
    functions.add(fn);
    const nested = new Set<RunnerFunctionBinding>();
    collectNodeCalls(fn.body, defining.functions, nested);
    for (const called of composition.reachableFunctions) nested.add(called);
    helperCalls.set(fn, nested);
    for (const called of nested) if (!functions.has(called)) pending.add(called);
  }
  assertScalarHelperContracts(functions, env, classScalarReturns);
  const resumableHelpers = transitiveResumableHelpers(directResumableHelpers, helperCalls);
  return {
    functions: scope.functions,
    moduleGraph,
    reachableFunctions: functions,
    requiresIterationBudget,
    resumableHelpers,
    resumableHelperNames: new Set([...resumableHelpers].map((fn) => fn.name)),
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
    return assertInternalMachineHelperGraph(nodes, env).reachableFunctions.size > 0;
  } catch {
    return false;
  }
}

export function internalMachineHelperCallInValue(node: ValueIR, env: SemanticEnv): boolean {
  const functions = env.runnerFunctions;
  if (!functions || functions.size === 0) return false;
  const calls = new Set<RunnerFunctionBinding>();
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
  const calls = new Set<RunnerFunctionBinding>();
  try {
    directNodeCalls(node, functions, calls);
  } catch {
    return false;
  }
  return calls.size > 0;
}

export { isInternalMachineHelperCall, isInternalMachineResumableHelperCall, isInternalMachineScalarHelperCall };
