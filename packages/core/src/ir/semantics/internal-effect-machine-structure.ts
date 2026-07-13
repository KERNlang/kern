import type { IRNode } from '../../types.js';
import { branchShapePreconditions } from './branch-runtime.js';
import { isInternalEffectMachineArrayEach } from './each-runtime.js';
import { forShapePreconditions } from './for-runtime.js';
import type { SemanticEnv } from './index.js';
import { hasNoBody, InternalEffectMachineError, isUnifiedNodeType } from './internal-effect-machine-types.js';
import type { CompletionKind } from './trace.js';
import { tryPreconditions, tryRuntimeParts } from './try-runtime.js';

type CompletionSet = Set<CompletionKind>;

function hasBoundedRootEnvironment(env: SemanticEnv): boolean {
  return (
    env.parent === undefined &&
    (env.runnerFunctions === undefined || env.runnerFunctions.size === 0) &&
    (env.runnerClasses === undefined || env.runnerClasses.size === 0) &&
    env.runnerThis === undefined
  );
}

function rootSequenceClaimsMachine(nodes: readonly IRNode[]): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === 'branch' || node.type === 'for' || node.type === 'try' || node.type === 'while') continue;
    if (node.type === 'each') {
      if (!isInternalEffectMachineArrayEach(node)) return false;
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

function normalCompletion(): CompletionSet {
  return new Set(['normal']);
}

function addCompletions(target: CompletionSet, source: CompletionSet): void {
  for (const completion of source) target.add(completion);
}

function analyzeBranchFrame(node: IRNode, loopDepth: number): CompletionSet {
  if (!branchShapePreconditions(node)) {
    throw new InternalEffectMachineError('effect machine rejected branch node', node);
  }
  const possible = normalCompletion();
  for (const path of node.children ?? []) {
    addCompletions(possible, analyzeSequence(path.children ?? [], loopDepth));
  }
  return possible;
}

function analyzeLoop(children: readonly IRNode[], loopDepth: number): CompletionSet {
  const body = analyzeSequence(children, loopDepth + 1);
  const possible = normalCompletion();
  if (body.has('return')) possible.add('return');
  if (body.has('throw')) possible.add('throw');
  return possible;
}

function analyzeTry(node: IRNode, loopDepth: number): CompletionSet {
  if (!tryPreconditions(node)) {
    throw new InternalEffectMachineError('effect machine rejected try node', node);
  }
  const { body, catchNode, finallyNode } = tryRuntimeParts(node.children ?? []);
  const bodyCompletions = analyzeSequence(body, loopDepth);
  const catchCompletions = catchNode ? analyzeSequence(catchNode.children ?? [], loopDepth) : normalCompletion();
  if (catchNode && bodyCompletions.has('return')) {
    throw new InternalEffectMachineError('try: body return with catch is outside the portable domain', node);
  }
  if (finallyNode) {
    const finallyCompletions = analyzeSequence(finallyNode.children ?? [], 0);
    if (finallyCompletions.size !== 1 || !finallyCompletions.has('normal')) {
      throw new InternalEffectMachineError(
        'try: finally must complete normally (cleanup-only this slice)',
        finallyNode,
      );
    }
  }
  const possible = new Set(bodyCompletions);
  if (catchNode && possible.delete('throw')) addCompletions(possible, catchCompletions);
  return possible;
}

function analyzeSequence(nodes: readonly IRNode[], loopDepth: number): CompletionSet {
  let possible = normalCompletion();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    let nodeCompletions: CompletionSet;
    let elseNode: IRNode | undefined;
    if (node.type === 'if') {
      if (typeof node.props?.cond !== 'string' || node.props.cond.trim() === '') {
        throw new InternalEffectMachineError('effect machine rejected if node', node);
      }
      elseNode = nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
      if (elseNode) index += 1;
      nodeCompletions = analyzeSequence(node.children ?? [], loopDepth);
      if (elseNode) addCompletions(nodeCompletions, analyzeSequence(elseNode.children ?? [], loopDepth));
      else nodeCompletions.add('normal');
    } else if (node.type === 'else') {
      throw new InternalEffectMachineError('else must immediately follow an if sibling', node);
    } else if (node.type === 'branch') {
      nodeCompletions = analyzeBranchFrame(node, loopDepth);
    } else if (node.type === 'for') {
      if (!forShapePreconditions(node)) {
        throw new InternalEffectMachineError('effect machine rejected for node', node);
      }
      nodeCompletions = analyzeLoop(node.children ?? [], loopDepth);
    } else if (node.type === 'each') {
      if (!isInternalEffectMachineArrayEach(node)) {
        throw new InternalEffectMachineError('effect machine rejected each node', node);
      }
      nodeCompletions = analyzeLoop(node.children ?? [], loopDepth);
    } else if (node.type === 'while') {
      if (typeof node.props?.cond !== 'string' || node.props.cond.trim() === '' || !Array.isArray(node.children)) {
        throw new InternalEffectMachineError('effect machine rejected while node', node);
      }
      nodeCompletions = analyzeLoop(node.children, loopDepth);
    } else if (node.type === 'try') {
      nodeCompletions = analyzeTry(node, loopDepth);
    } else if (node.type === 'break' || node.type === 'continue') {
      if (loopDepth === 0 || node.props?.label !== undefined || !hasNoBody(node)) {
        throw new InternalEffectMachineError(`effect machine rejected ${node.type} node`, node);
      }
      nodeCompletions = new Set<CompletionKind>([node.type === 'break' ? 'break' : 'continue']);
    } else if (!isUnifiedNodeType(node.type) || !hasNoBody(node)) {
      throw new InternalEffectMachineError(`effect machine rejected nested node type "${node.type}"`, node);
    } else if (node.type === 'return' || node.type === 'throw') {
      nodeCompletions = new Set<CompletionKind>([node.type === 'return' ? 'return' : 'throw']);
    } else {
      nodeCompletions = normalCompletion();
    }

    const next = new Set([...possible].filter((completion) => completion !== 'normal'));
    if (possible.has('normal')) addCompletions(next, nodeCompletions);
    possible = next;
  }
  return possible;
}

export function assertInternalEffectMachineStructureSupported(nodes: readonly IRNode[], loopDepth = 0): void {
  analyzeSequence(nodes, loopDepth);
}
