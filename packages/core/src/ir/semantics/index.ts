/**
 * IR runtime semantics — executable contracts and the compatibility registry.
 *
 * Runtime environment ownership lives in `semantic-env.ts`; it is re-exported
 * here so existing contract and test imports remain source-compatible. Direct
 * machine code imports the clean owner and never this registry barrel.
 */

import type { IRNode } from '../../types.js';
import type { SemanticEnv } from './semantic-env.js';
import type { CompletionRecord, Trace } from './trace.js';

export * from './semantic-env.js';

export interface NodeFixture {
  description: string;
  ir: IRNode;
  env?: Partial<SemanticEnv>;
  expected: Trace;
}

export interface NodeContract<TNode extends IRNode = IRNode> {
  readonly nodeType: string;
  preconditions: (ir: TNode, env: SemanticEnv) => boolean;
  effects: (ir: TNode, env: SemanticEnv) => Trace;
  completion: (ir: TNode, env: SemanticEnv) => CompletionRecord;
  forbiddenRewrites: readonly string[];
  fixtures: readonly NodeFixture[];
}

/** Compatibility registry for the reference runners and differential harness. */
export const CONTRACT_REGISTRY: Map<string, NodeContract> = new Map();

export function registerContract(contract: NodeContract): void {
  if (CONTRACT_REGISTRY.has(contract.nodeType)) {
    throw new Error(
      `Contract already registered for node type "${contract.nodeType}". ` +
        'Each node type has exactly one canonical contract.',
    );
  }
  CONTRACT_REGISTRY.set(contract.nodeType, contract);
}

export {
  type ContractDoc,
  type FixtureSample,
  type RegistryDoc,
  serializeJson,
  serializeMarkdown,
  snapshotRegistry,
} from './doc-generator.js';

export type {
  CanonicalError,
  CompletionKind,
  CompletionRecord,
  Trace,
  TraceEvent,
} from './trace.js';
export { completionsEqual, deepEqual, emptyTrace, eventsEqual, tracesEqual } from './trace.js';
