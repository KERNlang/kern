/**
 * ReferenceRunner — the canonical TS interpreter that judges both emitters.
 *
 * Three-way parity (council convergence): naive TS-vs-Python comparison hits
 * the "which side is right?" problem. The reference runner is a pure TS
 * implementation of the spec; the [[harness]] compares both emitters against
 * it. A 3-way disagreement isolates which leg is wrong.
 *
 * Phase 1 (PR-1) ships the dispatcher only. PR-2 lands the `each` case body.
 */

import type { IRNode } from '../../types.js';
import { CONTRACT_REGISTRY, type SemanticEnv } from './index.js';
import { emptyTrace, type Trace } from './trace.js';

/**
 * Execute `node` under `env` and return its observable trace.
 *
 * Dispatch is by `node.type` against the contract registry. Nodes with no
 * registered contract throw — better than silently passing through, since
 * the differential harness needs a known judgment.
 */
export function referenceRun(node: IRNode, env: SemanticEnv): Trace {
  const contract = CONTRACT_REGISTRY.get(node.type);
  if (!contract) {
    throw new ReferenceRunnerError(
      `No semantic contract registered for IR node type "${node.type}". ` +
        'Add a contract under packages/core/src/ir/semantics/ and register it.',
      node,
    );
  }
  if (!contract.preconditions(node, env)) {
    throw new ReferenceRunnerError(`Preconditions failed for node type "${node.type}".`, node);
  }
  return contract.effects(node, env);
}

/** Run a sequence of nodes, threading the env. Stops on non-normal completion. */
export function referenceRunSequence(nodes: readonly IRNode[], env: SemanticEnv): Trace {
  const out: Trace = emptyTrace();
  for (const n of nodes) {
    const t = referenceRun(n, env);
    out.events.push(...t.events);
    if (t.completion.kind !== 'normal') {
      out.completion = t.completion;
      return out;
    }
  }
  return out;
}

export class ReferenceRunnerError extends Error {
  readonly node: IRNode;
  constructor(message: string, node: IRNode) {
    super(message);
    this.name = 'ReferenceRunnerError';
    this.node = node;
  }
}
