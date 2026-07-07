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

import type { KernRunnerCapabilities, KernRunnerCapabilityContext } from '../../runner-capabilities.js';
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
  intProvenance?: Set<string>;
  runnerFunctions?: Map<string, RunnerFunctionBinding>;
  runnerClasses?: Map<string, RunnerClassBinding>;
  runnerCallStack?: string[];
  runnerCallCache?: Map<string, unknown>;
  runnerThis?: RunnerClassInstanceValue;
  runnerSuperClass?: string;
  runnerProtectedClassInstances?: WeakSet<RunnerClassInstanceValue>;
  capabilities?: KernRunnerCapabilities;
  capabilityContext?: KernRunnerCapabilityContext;
  /** Float/int fence escape hatch, set only for `Text.*` safe-integer index
   *  args (`requireSafeIntegerArg`), which never print/return the value. */
  intIndexCtx?: boolean;
  /**
   * Enclosing lexical scope, if any. A `let` binds in THIS scope's `bindings`;
   * reads and `assign` walk up `parent` to the declaring scope (write-through).
   * A block that introduces fresh bindings (a loop-body iteration, a lambda
   * call) runs in a child scope (see [[childEnv]]) so its inner `let`s are
   * discarded when the scope ends, while mutations to OUTER bindings persist.
   * Undefined on a root scope. NOTE: every contract MUST access bindings through
   * the [[lookupBinding]] / [[hasBinding]] / [[defineBinding]] / [[assignBinding]]
   * helpers, never `env.bindings.get/set/has` directly, or chain semantics break.
   */
  parent?: SemanticEnv;
  seed: number;
  now: number;
}

/**
 * A module's private callable environment: the functions and classes visible
 * for resolution WITHIN that module (its own declarations plus the symbols it
 * imports). Each callable binding carries the scope of the module that DEFINED
 * it, so an imported helper resolves its own module's private helpers/classes
 * rather than the importer's — modules are singletons with their own scope, not
 * flattened into the root namespace.
 */
export interface RunnerModuleScope {
  readonly functions: Map<string, RunnerFunctionBinding>;
  readonly classes: Map<string, RunnerClassBinding>;
}

export interface RunnerFunctionBinding {
  readonly name: string;
  readonly params: readonly string[];
  readonly returns?: unknown;
  readonly handler?: IRNode;
  readonly body: readonly IRNode[];
  /** Defining module's scope; the body resolves calls here, not in the caller's scope. */
  readonly module?: RunnerModuleScope;
}

export interface RunnerClassFieldBinding {
  readonly name: string;
  readonly value?: unknown;
}

export interface RunnerClassMemberBinding {
  readonly name: string;
  readonly params: readonly string[];
  readonly handler?: IRNode;
  readonly body: readonly IRNode[];
  readonly ownerClass: string;
}

export interface RunnerClassBinding {
  readonly name: string;
  readonly extendsName?: string;
  readonly fields: readonly RunnerClassFieldBinding[];
  readonly constructor?: RunnerClassMemberBinding;
  readonly methods: ReadonlyMap<string, RunnerClassMemberBinding>;
  readonly getters: ReadonlyMap<string, RunnerClassMemberBinding>;
  /** Defining module's scope; construction and members resolve calls here. */
  readonly module?: RunnerModuleScope;
}

export interface RunnerClassInstanceValue {
  readonly __kernRunnerClassInstance: true;
  readonly className: string;
  readonly fields: Record<string, unknown>;
  /** Defining module's scope, so member resolution follows the class's module across boundaries. */
  readonly module?: RunnerModuleScope;
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
    intProvenance: overrides.intProvenance ? new Set(overrides.intProvenance) : new Set(),
    runnerFunctions: overrides.runnerFunctions,
    runnerClasses: overrides.runnerClasses,
    runnerCallStack: overrides.runnerCallStack ? [...overrides.runnerCallStack] : [],
    runnerCallCache: overrides.runnerCallCache,
    runnerThis: overrides.runnerThis,
    runnerSuperClass: overrides.runnerSuperClass,
    runnerProtectedClassInstances: overrides.runnerProtectedClassInstances,
    capabilities: overrides.capabilities,
    capabilityContext: overrides.capabilityContext ? { ...overrides.capabilityContext } : {},
    seed: overrides.seed ?? 0,
    now: overrides.now ?? 0,
  };
}

function cloneBindings(bindings: Map<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of bindings) out.set(key, cloneSemanticValue(value));
  return out;
}

// ── Lexical scope chain ──────────────────────────────────────────────────────
// Generalized from the closure-evaluator scope in `lambda.ts`. A flat env
// (`parent === undefined`) makes every helper below behave IDENTICALLY to direct
// `env.bindings.get/set/has` — so migrating contracts onto these helpers is
// behavior-preserving until a child scope is actually introduced.

/**
 * Open a child scope nested under `parent`. `let` binds in the child; reads and
 * `assign` fall through to `parent`. Used for lexically-scoped blocks (a loop
 * body iteration, a lambda call) so inner declarations are fresh per scope and
 * mutations to outer bindings write through to where they were declared.
 */
export function childEnv(parent: SemanticEnv): SemanticEnv {
  // `intProvenance` is PER-SCOPE binding metadata (which names declared in THIS
  // scope are guaranteed safe integers). A child starts EMPTY — it does not clone
  // the parent's set; `isIntProvenanced` walks `declaringScope` first, so a
  // counter declared in an outer scope is still found from a nested scope.
  return {
    bindings: new Map(),
    intProvenance: new Set(),
    runnerFunctions: parent.runnerFunctions,
    runnerClasses: parent.runnerClasses,
    runnerCallStack: parent.runnerCallStack,
    runnerCallCache: parent.runnerCallCache,
    runnerThis: parent.runnerThis,
    runnerSuperClass: parent.runnerSuperClass,
    runnerProtectedClassInstances: parent.runnerProtectedClassInstances,
    capabilities: parent.capabilities,
    capabilityContext: parent.capabilityContext,
    parent,
    seed: parent.seed,
    now: parent.now,
  };
}

/** The nearest scope in the chain that declares `name`, or undefined if unbound. */
function declaringScope(env: SemanticEnv, name: string): SemanticEnv | undefined {
  for (let cur: SemanticEnv | undefined = env; cur; cur = cur.parent) {
    if (cur.bindings.has(name)) return cur;
  }
  return undefined;
}

/** True if `name` is bound anywhere in the scope chain. */
export function hasBinding(env: SemanticEnv, name: string): boolean {
  return declaringScope(env, name) !== undefined;
}

/** True if `name` is bound in the INNERMOST scope only (for `let`-redeclaration checks). */
export function hasOwnBinding(env: SemanticEnv, name: string): boolean {
  return env.bindings.has(name);
}

/** Read `name` walking the chain; returns `undefined` if unbound (pair with a prior has-check). */
export function getBinding(env: SemanticEnv, name: string): unknown {
  return declaringScope(env, name)?.bindings.get(name);
}

/** Declare `name` in the INNERMOST scope (`let`). Overwrites a same-scope binding. */
export function defineBinding(env: SemanticEnv, name: string, value: unknown): void {
  env.bindings.set(name, value);
  env.intProvenance?.delete(name);
}

/** Declare `name` in the INNERMOST scope and mark it as a guaranteed safe integer. */
export function defineIntBinding(env: SemanticEnv, name: string, value: unknown): void {
  env.bindings.set(name, value);
  (env.intProvenance ??= new Set()).add(name);
}

/**
 * Write `name` in its declaring scope (write-through, `assign`). If `name` is not
 * declared anywhere in the chain, writes in the innermost scope — callers that
 * require an existing binding must check [[hasBinding]] first (the `assign`
 * contract does).
 */
export function assignBinding(env: SemanticEnv, name: string, value: unknown): void {
  const scope = declaringScope(env, name) ?? env;
  scope.bindings.set(name, value);
  scope.intProvenance?.delete(name);
}

/** True iff `name` is declared in a scope that marks it as a guaranteed safe integer. */
export function isIntProvenanced(env: SemanticEnv, name: string): boolean {
  const scope = declaringScope(env, name);
  return scope?.intProvenance?.has(name) ?? false;
}

/** Delete `name` from the INNERMOST scope only (scope teardown). */
export function deleteOwnBinding(env: SemanticEnv, name: string): void {
  env.bindings.delete(name);
}

function cloneSemanticValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    (value as Partial<RunnerClassInstanceValue>).__kernRunnerClassInstance === true
  ) {
    const instance = value as RunnerClassInstanceValue;
    return {
      __kernRunnerClassInstance: true,
      className: instance.className,
      fields: Object.fromEntries(
        Object.entries(instance.fields).map(([key, fieldValue]) => [key, cloneSemanticValue(fieldValue)]),
      ),
      // Preserve the defining-module scope by reference so a cloned instance
      // (e.g. passed as a function argument) still resolves its own module's members.
      ...(instance.module ? { module: instance.module } : {}),
    } satisfies RunnerClassInstanceValue;
  }
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
