/**
 * ReferenceRunner — the canonical TS interpreter that judges both emitters.
 *
 * Three-way parity (council convergence): naive TS-vs-Python comparison hits
 * the "which side is right?" problem. The reference runner is a pure TS
 * implementation of the spec; the [[harness]] compares both emitters against
 * it. A 3-way disagreement isolates which leg is wrong.
 *
 * Phase 1 (PR-1) shipped the dispatcher; concrete node contracts register
 * their behavior through the shared registry.
 */

import type { IRNode } from '../../types.js';
import { CONTRACT_REGISTRY, type SemanticEnv } from './index.js';
import { appendInternalReferenceTraceEvents, emptyTrace, type Trace } from './trace.js';

/**
 * Execute `node` under `env` and return its observable trace.
 *
 * Dispatch is by `node.type` against the contract registry. Nodes with no
 * registered contract throw — better than silently passing through, since
 * the differential harness needs a known judgment.
 */
export function referenceRun(node: IRNode, env: SemanticEnv): Trace {
  if (node.type === '__block') {
    if (!Array.isArray(node.children)) {
      throw new ReferenceRunnerError('Fixture block requires a children array.', node);
    }
    return referenceRunSequence(node.children, env);
  }

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
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    let nodeToRun = n;
    if (n.type === 'if' && nodes[i + 1]?.type === 'else') {
      nodeToRun = {
        ...n,
        props: {
          ...(n.props ?? {}),
          __pairedElse: nodes[i + 1],
        },
      };
      i += 1;
    } else if (n.type === 'else') {
      throw new ReferenceRunnerError('`else` must immediately follow an `if` sibling.', n);
    }
    const t = referenceRun(nodeToRun, env);
    appendInternalReferenceTraceEvents(out, t.events, env.internalReferenceTraceRetention);
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
