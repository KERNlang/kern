import type { IRNode } from '../../types.js';
import { branchPreconditions, branchShapePreconditions, selectBranchPath } from './branch-runtime.js';
import {
  assertDeferredCapabilityInputKnownValues,
  prepareInternalCapabilityEffectWithEvaluator,
  reserveInternalCapabilityEffectShape,
} from './capability-runtime.js';
import { PREFLIGHT_CAUGHT_ERROR } from './caught-error.js';
import { internalEffectMachineEachIterationCount, isInternalEffectMachineEach } from './each-runtime.js';
import { forRuntimeRange, forShapePreconditions } from './for-runtime.js';
import { evaluateIfConditionWithEvaluator } from './if-runtime.js';
import { hasBoundedRootEnvironment, hasOwnedDirectRootEnvironment } from './internal-effect-machine-admission.js';
import {
  applyConditionalBindingEffects,
  branchControlIsDeferred,
  type ConditionalBindingPath,
  clonePreflightEnvironment,
  conditionalBindingEffects,
  controlExpressionIsDeferred,
  forControlIsDeferred,
  guaranteedFinallyEntryPrefix,
  recordEscapingBindingWrites,
} from './internal-effect-machine-control.js';
import { internalMachineExpressionBindings } from './internal-effect-machine-expression-bindings.js';
import {
  assertInternalEffectMachineLeafPreflight,
  assertInternalEffectMachineLeafShapePreflight,
  assertInternalMachineDeferredCaughtExpression,
  isInternalEffectMachineLeafType,
} from './internal-effect-machine-leaf.js';
import { hasNoBody, InternalEffectMachineError, isUnifiedNodeType } from './internal-effect-machine-types.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { childEnv, defineBinding, hasBinding, type SemanticEnv } from './semantic-env.js';
import type { CompletionKind } from './trace.js';
import { tryPreconditions, tryRuntimeParts, UNAVAILABLE_CAUGHT_ERROR } from './try-runtime.js';
import { evaluateWhileConditionWithEvaluator } from './while-runtime.js';

type CompletionSet = Set<CompletionKind>;

function rootSequenceClaimsMachine(nodes: readonly IRNode[]): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === 'branch' || node.type === 'for' || node.type === 'try' || node.type === 'while') continue;
    if (node.type === 'each') {
      if (!isInternalEffectMachineEach(node)) return false;
      continue;
    }
    if (node.type === 'if') {
      if (nodes[index + 1]?.type === 'else') index += 1;
      continue;
    }
    if (
      node.type === 'break' ||
      node.type === 'continue' ||
      node.type === 'else' ||
      !isUnifiedNodeType(node.type) ||
      !hasNoBody(node)
    ) {
      return false;
    }
  }
  return true;
}

export function isInternalEffectMachineEligible(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  return hasBoundedRootEnvironment(env) && rootSequenceClaimsMachine(nodes);
}

export function isInternalEffectMachineDirectEligible(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  return hasOwnedDirectRootEnvironment(env) && rootSequenceClaimsMachine(nodes);
}

function normalCompletion(): CompletionSet {
  return new Set(['normal']);
}
function addCompletions(target: CompletionSet, source: CompletionSet): void {
  for (const completion of source) target.add(completion);
}
function analyzeBranchFrame(
  node: IRNode,
  loopDepth: number,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  evaluateControls: boolean,
): CompletionSet {
  if (!branchShapePreconditions(node)) {
    throw new InternalEffectMachineError('effect machine rejected branch node', node);
  }
  if (evaluateControls && !branchControlIsDeferred(node, unstableBindings) && !branchPreconditions(node, env)) {
    throw new InternalEffectMachineError('effect machine rejected branch node', node);
  }
  let selectedPath: IRNode | undefined;
  const hasKnownSelection = evaluateControls && !branchControlIsDeferred(node, unstableBindings);
  if (hasKnownSelection) {
    try {
      selectedPath = selectBranchPath(node, env);
    } catch {
      throw new InternalEffectMachineError('effect machine rejected branch node', node);
    }
  }
  const possible = hasKnownSelection && selectedPath !== undefined ? new Set<CompletionKind>() : normalCompletion();
  const frameBindings = new Set(unstableBindings);
  const frameWrites = new Set<string>();
  for (const path of node.children ?? []) {
    const pathEnv = childEnv(clonePreflightEnvironment(env));
    const pathSelected = !hasKnownSelection || path === selectedPath;
    const completions = analyzeSequence(
      path.children ?? [],
      loopDepth,
      pathEnv,
      new Set(frameBindings),
      pathSelected ? evaluateControls : false,
    );
    if (pathSelected) {
      addCompletions(possible, completions);
      recordEscapingBindingWrites(path.children ?? [], frameWrites);
    }
  }
  addBindingWrites(unstableBindings, frameWrites);
  return possible;
}
function analyzeLoop(
  children: readonly IRNode[],
  loopDepth: number,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  frameNode?: IRNode,
  evaluateControls = true,
  bodyExecution?: boolean,
): CompletionSet {
  const bodyCanExecute = evaluateControls && bodyExecution !== false;
  const bodyMustExecute = bodyExecution === true;
  const loopEnv = childEnv(clonePreflightEnvironment(env));
  const loopBindings = new Set(unstableBindings);
  const loopLocals = new Set<string>();
  if (frameNode) {
    recordNodeBindingWrites(frameNode, loopBindings);
    recordNodeBindingWrites(frameNode, loopLocals);
  }
  const body = analyzeSequence(
    children,
    loopDepth + 1,
    loopEnv,
    loopBindings,
    bodyCanExecute ? evaluateControls : false,
  );
  if (bodyCanExecute) recordEscapingBindingWrites(children, unstableBindings, loopLocals);
  const possible = new Set<CompletionKind>();
  if (!bodyMustExecute || body.has('normal') || body.has('continue') || body.has('break')) {
    possible.add('normal');
  }
  if (body.has('return')) possible.add('return');
  if (body.has('throw')) possible.add('throw');
  return possible;
}

function analyzeTry(
  node: IRNode,
  loopDepth: number,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  evaluateControls: boolean,
): CompletionSet {
  if (!tryPreconditions(node)) {
    throw new InternalEffectMachineError('effect machine rejected try node', node);
  }
  const { body, catchNode, finallyNode } = tryRuntimeParts(node.children ?? []);
  // Only bindings guaranteed before every canonical exit flow into catch/finally.
  const bodyPrefix = guaranteedFinallyEntryPrefix(body);
  const bodyCompletions = analyzeSequence(
    body,
    loopDepth,
    clonePreflightEnvironment(env),
    new Set(unstableBindings),
    evaluateControls,
  );
  const catchBindings = new Set(unstableBindings);
  const catchEnv = clonePreflightEnvironment(env);
  applyConditionalBindingEffects([{ nodes: bodyPrefix }], catchEnv, catchBindings);
  if (catchNode) {
    const caught = catchNode.props?.name;
    if (typeof caught === 'string' && caught !== '') defineBinding(catchEnv, caught, PREFLIGHT_CAUGHT_ERROR);
    recordNodeBindingWrites(catchNode, catchBindings);
  }
  const catchCompletions = catchNode
    ? analyzeSequence(catchNode.children ?? [], loopDepth, catchEnv, catchBindings, evaluateControls)
    : normalCompletion();
  if (catchNode && bodyCompletions.has('return')) {
    throw new InternalEffectMachineError('try: body return with catch is outside the portable domain', node);
  }

  if (finallyNode) {
    const finallyEnv = clonePreflightEnvironment(env);
    const finallyBindings = new Set(unstableBindings);
    applyConditionalBindingEffects([{ nodes: bodyPrefix }], finallyEnv, finallyBindings);
    if (catchNode && bodyCompletions.has('throw')) {
      applyCatchFinallyEffects(
        catchNode,
        finallyEnv,
        finallyBindings,
        bodyCompletions.size === 1 && bodyCompletions.has('throw'),
      );
      installCaughtTombstone(catchNode, finallyEnv, finallyBindings);
    }
    const finallyCompletions = analyzeSequence(
      finallyNode.children ?? [],
      0,
      finallyEnv,
      finallyBindings,
      evaluateControls,
    );
    if (finallyCompletions.size !== 1 || !finallyCompletions.has('normal')) {
      throw new InternalEffectMachineError(
        'try: finally must complete normally (cleanup-only this slice)',
        finallyNode,
      );
    }
  }

  const normalPaths: ConditionalBindingPath[] = [];
  if (bodyCompletions.has('normal')) normalPaths.push({ nodes: body });
  if (catchNode && bodyCompletions.has('throw')) {
    const caught = catchNode.props?.name;
    normalPaths.push({
      initialBindings: typeof caught === 'string' && caught !== '' ? [caught] : [],
      nodes: [...bodyPrefix, ...(catchNode.children ?? [])],
    });
  }
  if (normalPaths.length > 0) applyConditionalBindingEffects(normalPaths, env, unstableBindings);
  if (finallyNode) {
    applyConditionalBindingEffects([{ nodes: finallyNode.children ?? [] }], env, unstableBindings);
  }
  if (catchNode && bodyCompletions.has('throw')) {
    installCaughtTombstone(catchNode, env, unstableBindings);
  }
  const possible = new Set(bodyCompletions);
  // Machine catches consume only canonical KERN `throw` completions.
  if (catchNode && possible.delete('throw')) addCompletions(possible, catchCompletions);
  return possible;
}

function installCaughtTombstone(catchNode: IRNode, env: SemanticEnv, deferredBindings: Set<string>): void {
  const caught = catchNode.props?.name;
  if (typeof caught !== 'string' || caught === '') return;
  // Frozen runtime semantics overwrite catch parameters with an unavailable sentinel.
  defineBinding(env, caught, UNAVAILABLE_CAUGHT_ERROR);
  deferredBindings.delete(caught);
}

function applyCatchFinallyEffects(
  catchNode: IRNode,
  env: SemanticEnv,
  deferredBindings: Set<string>,
  includeDeclarations: boolean,
): void {
  const caught = catchNode.props?.name;
  const caughtName = typeof caught === 'string' && caught !== '' ? caught : undefined;
  const effects = conditionalBindingEffects([
    {
      initialBindings: caughtName ? [caughtName] : [],
      nodes: guaranteedFinallyEntryPrefix(catchNode.children ?? []),
    },
  ]);
  for (const name of effects.assigned) {
    if (name !== caughtName && hasBinding(env, name)) deferredBindings.add(name);
  }
  if (!includeDeclarations) return;
  for (const name of effects.declared) {
    if (name === caughtName || hasBinding(env, name)) continue;
    defineBinding(env, name, null);
    deferredBindings.add(name);
  }
}

function analyzeSequence(
  nodes: readonly IRNode[],
  loopDepth: number,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  evaluateControls = true,
): CompletionSet {
  let possible = normalCompletion();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const evaluateNode = evaluateControls && possible.has('normal');
    let nodeCompletions: CompletionSet;
    let elseNode: IRNode | undefined;
    if (node.type === 'if') {
      if (typeof node.props?.cond !== 'string' || node.props.cond.trim() === '') {
        throw new InternalEffectMachineError('effect machine rejected if node', node);
      }
      let knownCondition: boolean | undefined;
      if (evaluateNode && !controlExpressionIsDeferred(node.props.cond, unstableBindings)) {
        try {
          knownCondition = evaluateIfConditionWithEvaluator(node, env, evalPortableValue);
        } catch {
          throw new InternalEffectMachineError('effect machine rejected if node', node);
        }
      }
      elseNode = nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
      if (elseNode) index += 1;
      const frameBindings = new Set(unstableBindings);
      const thenNodes = node.children ?? [];
      const elseNodes = elseNode?.children ?? [];
      if (knownCondition !== undefined) {
        const selectedNodes = knownCondition ? thenNodes : elseNodes;
        const unselectedNodes = knownCondition ? elseNodes : thenNodes;
        const unselectedEnv = clonePreflightEnvironment(env);
        nodeCompletions = analyzeSequence(selectedNodes, loopDepth, env, unstableBindings, evaluateNode);
        analyzeSequence(unselectedNodes, loopDepth, unselectedEnv, new Set(frameBindings), false);
      } else {
        nodeCompletions = analyzeSequence(
          thenNodes,
          loopDepth,
          clonePreflightEnvironment(env),
          new Set(frameBindings),
          evaluateNode,
        );
        if (elseNode) {
          addCompletions(
            nodeCompletions,
            analyzeSequence(elseNodes, loopDepth, clonePreflightEnvironment(env), new Set(frameBindings), evaluateNode),
          );
        } else nodeCompletions.add('normal');
        applyConditionalBindingEffects([{ nodes: thenNodes }, { nodes: elseNodes }], env, unstableBindings);
      }
    } else if (node.type === 'else') {
      throw new InternalEffectMachineError('else must immediately follow an if sibling', node);
    } else if (node.type === 'branch') {
      nodeCompletions = analyzeBranchFrame(node, loopDepth, env, unstableBindings, evaluateNode);
    } else if (node.type === 'for') {
      if (!forShapePreconditions(node)) {
        throw new InternalEffectMachineError('effect machine rejected for node', node);
      }
      let bodyExecution: boolean | undefined;
      if (evaluateNode && !forControlIsDeferred(node, unstableBindings)) {
        try {
          const range = forRuntimeRange(node, env);
          bodyExecution = range.step > 0 ? range.from < range.to : range.from > range.to;
        } catch {
          throw new InternalEffectMachineError('effect machine rejected for node', node);
        }
      }
      nodeCompletions = analyzeLoop(
        node.children ?? [],
        loopDepth,
        env,
        unstableBindings,
        node,
        evaluateNode,
        bodyExecution,
      );
    } else if (node.type === 'each') {
      if (!isInternalEffectMachineEach(node)) {
        throw new InternalEffectMachineError('effect machine rejected each node', node);
      }
      let bodyExecution: boolean | undefined;
      if (evaluateNode && !controlExpressionIsDeferred(node.props?.in, unstableBindings)) {
        try {
          bodyExecution = internalEffectMachineEachIterationCount(node, env) > 0;
        } catch {
          throw new InternalEffectMachineError('effect machine rejected each node', node);
        }
      }
      nodeCompletions = analyzeLoop(
        node.children ?? [],
        loopDepth,
        env,
        unstableBindings,
        node,
        evaluateNode,
        bodyExecution,
      );
    } else if (node.type === 'while') {
      if (typeof node.props?.cond !== 'string' || node.props.cond.trim() === '' || !Array.isArray(node.children)) {
        throw new InternalEffectMachineError('effect machine rejected while node', node);
      }
      let bodyExecution: boolean | undefined;
      if (evaluateNode && !controlExpressionIsDeferred(node.props.cond, unstableBindings)) {
        try {
          bodyExecution = evaluateWhileConditionWithEvaluator(node, env, evalPortableValue);
        } catch {
          throw new InternalEffectMachineError('effect machine rejected while node', node);
        }
      }
      nodeCompletions = analyzeLoop(
        node.children,
        loopDepth,
        env,
        unstableBindings,
        undefined,
        evaluateNode,
        bodyExecution,
      );
    } else if (node.type === 'try') {
      nodeCompletions = analyzeTry(node, loopDepth, env, unstableBindings, evaluateNode);
    } else if (node.type === 'capability') {
      if (evaluateNode) assertMachineCapability(node, env, unstableBindings);
      else assertMachineCapabilityShape(node, env);
      nodeCompletions = normalCompletion();
    } else if (node.type === 'break' || node.type === 'continue') {
      if (loopDepth === 0 || node.props?.label !== undefined || !hasNoBody(node)) {
        throw new InternalEffectMachineError(`effect machine rejected ${node.type} node`, node);
      }
      assertMachineLeaf(node, env, unstableBindings, evaluateNode);
      nodeCompletions = new Set<CompletionKind>([node.type === 'break' ? 'break' : 'continue']);
    } else if (!isUnifiedNodeType(node.type) || !hasNoBody(node)) {
      throw new InternalEffectMachineError(`effect machine rejected nested node type "${node.type}"`, node);
    } else if (isInternalEffectMachineLeafType(node.type)) {
      assertMachineLeaf(node, env, unstableBindings, evaluateNode);
      if (node.type === 'return' || node.type === 'throw') {
        nodeCompletions = new Set<CompletionKind>([node.type === 'return' ? 'return' : 'throw']);
      } else nodeCompletions = normalCompletion();
    } else throw new InternalEffectMachineError(`effect machine rejected node type "${node.type}"`, node);

    const next = new Set([...possible].filter((completion) => completion !== 'normal'));
    if (possible.has('normal')) addCompletions(next, nodeCompletions);
    possible = next;
  }
  return possible;
}

function assertMachineLeaf(
  node: IRNode,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  evaluateValues: boolean,
): void {
  try {
    if (evaluateValues) assertInternalEffectMachineLeafPreflight(node, env, unstableBindings);
    else assertInternalEffectMachineLeafShapePreflight(node, env);
  } catch {
    throw new InternalEffectMachineError(`effect machine rejected ${node.type} node`, node);
  }
}

function assertMachineCapabilityShape(node: IRNode, env: SemanticEnv): void {
  try {
    reserveInternalCapabilityEffectShape(node, env);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected capability node', node);
  }
}

function assertMachineCapability(node: IRNode, env: SemanticEnv, deferredBindings: Set<string>): void {
  try {
    const capabilityEnv = clonePreflightEnvironment(env);
    const input = node.props?.input;
    let shapeOnlyInput = false;
    if (typeof input === 'string') {
      assertInternalMachineDeferredCaughtExpression(input, capabilityEnv, deferredBindings);
      for (const name of internalMachineExpressionBindings(input)) {
        if (deferredBindings.has(name)) shapeOnlyInput = true;
        else if (!hasBinding(capabilityEnv, name)) throw new Error(`capability input binding "${name}" is missing`);
      }
      if (shapeOnlyInput) {
        assertDeferredCapabilityInputKnownValues(input, capabilityEnv, evalPortableValue, deferredBindings);
      }
    }
    const prepared = prepareInternalCapabilityEffectWithEvaluator(node, capabilityEnv, evalPortableValue, {
      shapeOnlyInput,
    });
    if (prepared.resultBinding !== undefined) {
      if (deferredBindings.has(prepared.resultBinding)) {
        throw new Error('capability result binding is already reserved');
      }
      defineBinding(env, prepared.resultBinding, null);
      deferredBindings.add(prepared.resultBinding);
    }
  } catch {
    throw new InternalEffectMachineError('effect machine rejected capability node', node);
  }
}

function recordNodeBindingWrites(node: IRNode, out: Set<string>): void {
  const bindingProps = ['entryKey', 'entryValue', 'index', 'name', 'pairKey', 'pairValue', 'target'] as const;
  for (const prop of bindingProps) {
    const value = node.props?.[prop];
    if (typeof value === 'string' && value !== '') out.add(value);
  }
}

function addBindingWrites(target: Set<string>, source: ReadonlySet<string>): void {
  for (const name of source) target.add(name);
}

export function assertInternalEffectMachineStructureSupported(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  loopDepth = 0,
): void {
  analyzeSequence(nodes, loopDepth, clonePreflightEnvironment(env), new Set());
}
