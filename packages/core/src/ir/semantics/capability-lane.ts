import { CAPABILITY_DESCRIPTORS } from '../../runner-capability-plan.js';
import type { IRNode } from '../../types.js';

export function isAsyncPlannedCapability(namespace: string, operation: string): boolean {
  return (
    CAPABILITY_DESCRIPTORS[`${namespace}.${operation}` as keyof typeof CAPABILITY_DESCRIPTORS]?.syncBoundary ===
    'async-planned'
  );
}

export function isAsyncPlannedCapabilityNode(node: IRNode): boolean {
  const namespace = node.props?.namespace;
  const operation = node.props?.operation;
  return (
    typeof namespace === 'string' && typeof operation === 'string' && isAsyncPlannedCapability(namespace, operation)
  );
}
