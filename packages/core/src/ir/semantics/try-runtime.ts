import type { IRNode } from '../../types.js';
import type { SemanticEnv } from './index.js';

export const UNAVAILABLE_CAUGHT_ERROR = Object.freeze({ message: Object.freeze({}) });

export interface TryParts {
  body: IRNode[];
  catchNode: IRNode | null;
  finallyNode: IRNode | null;
}

export function tryRuntimeParts(children: readonly IRNode[]): TryParts {
  return {
    body: children.filter((child) => child.type !== 'catch' && child.type !== 'finally'),
    catchNode: children.find((child) => child.type === 'catch') ?? null,
    finallyNode: children.find((child) => child.type === 'finally') ?? null,
  };
}

export function tryPreconditions(ir: IRNode, _env?: SemanticEnv): boolean {
  if (!Array.isArray(ir.children)) return false;
  const catches = ir.children.filter((child) => child.type === 'catch');
  const finallies = ir.children.filter((child) => child.type === 'finally');
  if (catches.length > 1 || finallies.length > 1) return false;
  if (catches.length === 0 && finallies.length === 0) return false;
  const catchNode = catches[0];
  if (catchNode) {
    const name = catchNode.props?.name;
    if (typeof name !== 'string' || name === '') return false;
    if (!Array.isArray(catchNode.children)) return false;
  }
  if (finallies[0] && !Array.isArray(finallies[0].children)) return false;
  return true;
}
