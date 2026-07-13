import type { IRNode } from '../../types.js';
import { branchShapePreconditions } from './branch.js';
import { isInternalEffectMachineArrayEach } from './each-runtime.js';
import { forShapePreconditions } from './for.js';
import type { SemanticEnv } from './index.js';
import { hasNoBody, InternalEffectMachineError, isUnifiedNodeType } from './internal-effect-machine-types.js';

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
    if (node.type === 'branch' || node.type === 'for' || node.type === 'while') continue;
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

function assertBranchFrameSupported(node: IRNode, loopDepth: number): void {
  if (!branchShapePreconditions(node)) {
    throw new InternalEffectMachineError('effect machine rejected branch node', node);
  }
  for (const path of node.children ?? []) {
    assertInternalEffectMachineStructureSupported(path.children ?? [], loopDepth);
  }
}

export function assertInternalEffectMachineStructureSupported(nodes: readonly IRNode[], loopDepth = 0): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    let elseNode: IRNode | undefined;
    if (node.type === 'if') {
      if (typeof node.props?.cond !== 'string' || node.props.cond.trim() === '') {
        throw new InternalEffectMachineError('effect machine rejected if node', node);
      }
      elseNode = nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
      if (elseNode) index += 1;
      assertInternalEffectMachineStructureSupported(node.children ?? [], loopDepth);
      if (elseNode) assertInternalEffectMachineStructureSupported(elseNode.children ?? [], loopDepth);
      continue;
    }
    if (node.type === 'else') {
      throw new InternalEffectMachineError('else must immediately follow an if sibling', node);
    }
    if (node.type === 'branch') {
      assertBranchFrameSupported(node, loopDepth);
      continue;
    }
    if (node.type === 'for') {
      if (!forShapePreconditions(node)) {
        throw new InternalEffectMachineError('effect machine rejected for node', node);
      }
      assertInternalEffectMachineStructureSupported(node.children ?? [], loopDepth + 1);
      continue;
    }
    if (node.type === 'each') {
      if (!isInternalEffectMachineArrayEach(node)) {
        throw new InternalEffectMachineError('effect machine rejected each node', node);
      }
      assertInternalEffectMachineStructureSupported(node.children ?? [], loopDepth + 1);
      continue;
    }
    if (node.type === 'while') {
      if (typeof node.props?.cond !== 'string' || node.props.cond.trim() === '' || !Array.isArray(node.children)) {
        throw new InternalEffectMachineError('effect machine rejected while node', node);
      }
      assertInternalEffectMachineStructureSupported(node.children, loopDepth + 1);
      continue;
    }
    if (node.type === 'break' || node.type === 'continue') {
      if (loopDepth === 0 || node.props?.label !== undefined || !hasNoBody(node)) {
        throw new InternalEffectMachineError(`effect machine rejected ${node.type} node`, node);
      }
      continue;
    }
    if (!isUnifiedNodeType(node.type) || !hasNoBody(node)) {
      throw new InternalEffectMachineError(`effect machine rejected nested node type "${node.type}"`, node);
    }
  }
}
