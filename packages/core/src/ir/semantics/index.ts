/**
 * IR runtime semantics — executable contracts (the spec) for each IR node type.
 *
 * Source of truth for cross-target parity. Each contract module exports a
 * [[NodeContract]] describing preconditions, observable effects, completion,
 * forbidden rewrites, and machine-readable fixtures. The [[harness]] consumes
 * these directly. Docs (under `docs/ir-semantics/`, gitignored) are generated
 * from JSDoc on contracts and fixture descriptions — never hand-edited.
 *
 * Phase 1 started with `each`; later contracts add body-statement control
 * flow such as `if` / sibling `else`.
 */

import type { IRNode } from '../../types.js';
import type { CompletionRecord, Trace } from './trace.js';

/**
 * The execution environment a contract evaluator sees. Deliberately minimal —
 * additions require a contract revision because they widen observable state.
 *
 *   - `bindings`: name → value lookup. Mutating this is an [[TraceEvent]] of
 *     kind `assign`, not a silent change.
 *   - `stdout` / `stderr`: write-only stream sinks. Implementations append to
 *     a trace event list; readers never see them as strings.
 *   - `seed`: RNG seed for fixtures that exercise randomness. Frozen per run.
 *   - `now`: frozen clock value in ms. Same value for the duration of one
 *     contract evaluation so async timing never leaks into traces.
 */
export interface SemanticEnv {
  bindings: Map<string, unknown>;
  seed: number;
  now: number;
}

/**
 * Build a fresh environment with deterministic defaults.
 *
 * **Always clones `overrides.bindings` and their JSON-shaped values** —
 * passing the same fixture env to multiple legs (or multiple runs of the same
 * fixture) must not allow mutation in one to bleed into another. Callers that
 * want shared bindings must opt in by writing through a shared reference
 * explicitly.
 */
export function makeEnv(overrides: Partial<SemanticEnv> = {}): SemanticEnv {
  return {
    bindings: overrides.bindings ? cloneBindings(overrides.bindings) : new Map(),
    seed: overrides.seed ?? 0,
    now: overrides.now ?? 0,
  };
}

function cloneBindings(bindings: Map<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of bindings) out.set(key, cloneSemanticValue(value));
  return out;
}

function cloneSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneSemanticValue);
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([k, v]) => [cloneSemanticValue(k), cloneSemanticValue(v)]));
  }
  if (value instanceof Set) return new Set(Array.from(value.values(), cloneSemanticValue));
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneSemanticValue(v)]),
      );
    }
  }
  return value;
}

/**
 * A fixture is a self-contained semantic test vector. The [[harness]] feeds
 * `ir` to the reference runner, the TS emitter, and the Python emitter, then
 * compares all three traces against `expected`.
 *
 * `description` is consumed by the doc generator AND surfaces in failure
 * messages — write it as a sentence-cased declarative statement.
 */
export interface NodeFixture {
  description: string;
  ir: IRNode;
  /** Optional initial bindings layered onto the default environment. */
  env?: Partial<SemanticEnv>;
  expected: Trace;
}

/**
 * The contract for one IR node type. Every field is intentional — adding or
 * removing one is a spec revision and requires touching all current contracts.
 */
export interface NodeContract<TNode extends IRNode = IRNode> {
  /** The `type:` discriminator value this contract governs (e.g. `'each'`). */
  readonly nodeType: string;
  /** Whether this IR shape is well-formed. Returns false → schema violation. */
  preconditions: (ir: TNode, env: SemanticEnv) => boolean;
  /** Compute the observable trace produced by executing `ir` in `env`. */
  effects: (ir: TNode, env: SemanticEnv) => Trace;
  /** Compute the completion record. Usually `effects(...).completion`. */
  completion: (ir: TNode, env: SemanticEnv) => CompletionRecord;
  /**
   * Emitter rewrites the spec explicitly forbids — e.g. `'hoist iteration
   * binding'`. Listed for human review; the harness does not enforce them
   * mechanically (yet).
   */
  forbiddenRewrites: readonly string[];
  fixtures: readonly NodeFixture[];
}

/**
 * Registry of all node contracts.
 * Adding an entry here is the canonical way to register a new node spec —
 * the harness, doc generator, and CI gate all read from this map.
 */
export const CONTRACT_REGISTRY: Map<string, NodeContract> = new Map();

/** Register a contract. Idempotent: re-registering with the same nodeType throws. */
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
// NOTE: the differential-TEST harness (`runDifferential`, `runAllContracts`,
// `DifferentialResult`, `Verdict`) is DELIBERATELY NOT re-exported here. It pulls
// the in-process TS-emitter leg (`harness → ts-leg → body-ts → closure-eligibility
// → typescript`, ~10MB) and is test-only. Keeping it out of this runtime barrel is
// what lets the standalone runner entry (`@kernlang/core/runner`) stay typescript-
// free. The harness lives in the sibling `./testing.js` barrel; the anti-rot guard
// `tests/runner-entry-import-graph.test.ts` pins the runner closure to zero TS.
export { ReferenceRunnerError, referenceRun, referenceRunSequence } from './reference-runner.js';
export { registerAllContracts } from './register-all.js';
export type {
  CanonicalError,
  CompletionKind,
  CompletionRecord,
  Trace,
  TraceEvent,
} from './trace.js';
export { completionsEqual, deepEqual, emptyTrace, eventsEqual, tracesEqual } from './trace.js';
