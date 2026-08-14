# KERN 5 Private Execution-Context Isolation

**Status:** APPROVED FOR IMPLEMENTATION

**Date:** 2026-08-14

**Trigger:** Final F1 role-lens review
`review-1786727886609-73wzup` reported two verified blockers.

**Rejected local corrections:**

- `tribunal-1786728336479-yu29wf`: NO-GO on a detached `makeEnv`
  snapshot plus full-retention class audit frames.
- `tribunal-1786728658795-9sfycs`: NO-GO on a parent-linked cloned
  overlay plus call-frame-local mutation audit.

**RFC tribunals:**

- `tribunal-1786729052043-et6pys`: NO-GO pending seven normative deltas.
- `tribunal-1786729525688-23zces`: NO-GO pending six bounded vocabulary and
  lifecycle clarifications.
- `tribunal-1786729843041-trp2xq`: all contract areas accepted except explicit
  Decimal finiteness; the verdict directs the one-word correction below and GO
  without another tribunal round.

## Objective

Provide one private execution identity that is independent of lexical parentage
and runner memo storage. It must preserve scheduler cancellation, timeout, and
capability-interceptor sequencing through every sync/async frame while allowing
legacy observable-only execution to use an isolated semantic environment and a
bounded, pre-write class-mutation audit.

## Root Cause

- **[ECI-C1 VERIFIED]** `bindInternalReferenceTraceRetention()` currently
  returns `childEnv(caller)`. `declaringScope()` follows `parent`, so an
  assignment to a caller binding writes into caller-owned storage.
- **[ECI-C2 VERIFIED]** `runnerCallCache` serves two incompatible roles: runner
  memo storage and the identity key for scheduler/interceptor state.
- **[ECI-C3 VERIFIED]** A detached environment loses scheduler/interceptor state
  because `stateFor()` only searches `runnerCallCache ?? env` along lexical
  parents.
- **[ECI-C4 VERIFIED]** Nested runner function and class frames use `makeEnv()`,
  which sets `parent: undefined`; a parent-linked overlay therefore cannot
  preserve control state through the complete execution graph.
- **[ECI-C5 VERIFIED]** Class mutation rejection depends on dotted `assign`
  events in `finishRunnerClassBody()`. Observable-only retention removes those
  events before the audit.
- **[ECI-C6 VERIFIED]** Forcing full class traces restores the audit but creates
  unbounded peak allocation before envelope normalization applies `maxEvents`.
- **[ECI-C7 VERIFIED]** A call-frame-local audit does not cover nested/super
  frames or caught mutation attempts. Auditing must live in propagated
  execution state and record an attempt before the write.

## Contract

- **[ECI-K1] Private context.** A module-private `WeakMap<SemanticEnv,
  InternalExecutionContext>` associates exact semantic environments with an
  execution context. No context field is added to `SemanticEnv`, public runtime
  declarations, serialized data, or public ABI.
- **[ECI-K2] Split identity.** The context owns a stable `schedulerKey` used
  only by the scheduler registry and an execution-local `interceptorKey` used
  only by the capability-interceptor registry. `runnerCallCache` remains local
  runner memo storage and is never used as control identity once a context is
  present.
- **[ECI-K3] Exact lookup and compatibility fallback.** A context-aware lookup
  uses only the exact context key and never walks lexical parents or falls back
  to a cache key. An environment with no context retains the existing
  `runnerCallCache ?? env` plus parent-walk behavior for compatibility outside
  runtime-envelope execution.
- **[ECI-K4] One frame chokepoint.** `makeExecutionFrame(source, overrides)` is
  the only constructor permitted on an execution-reachable path. It atomically
  calls the exact environment constructor and propagates execution context,
  trace retention, and private effect-machine state. `childEnv()` delegates to
  it. Raw `makeEnv()` is rejected by a deterministic constructor inventory in
  reference-runner, async-runner, function, helper, method, getter, constructor,
  super, module-scope, and class-activation paths.
- **[ECI-K5] Isolated legacy root.** Observable-only legacy execution accepts
  only an exact root environment and creates a parentless exact-local clone of
  its own bindings. Bindings, provenance, and `runnerThis` use one transactional
  memo; runner memo storage and call stack are empty; no cache entry is copied.
  The derived context shares only the caller's `schedulerKey`, creates a local
  `interceptorKey` bound to the same interceptor with sequence zero, selects
  observable-only retention, and starts with an empty audit stack.
- **[ECI-K6] Closed fail-closed clone domain.** Admitted atoms are `null`,
  booleans, strings, finite numbers, and finite exact owned frozen Decimal
  carriers.
  Admitted composites are dense exact arrays with canonical length and default
  writable/enumerable/configurable index descriptors; undecorated exact
  Maps/Sets; enumerable data-only plain/null-prototype records whose properties
  use default writable/enumerable/configurable descriptors; and exact runner
  instances whose complete field graphs consist of those values. Sparse arrays,
  non-default descriptors, functions, accessors, symbols, WeakMap/WeakSet,
  exotic prototypes, decorated collections, and hostile proxies reject.
  Cycles and aliases are allowed and preserved by one memo. Validation finishes
  before the destination environment or provider/timer/interceptor state is
  created. No shared rejection sentinel may enter an executable environment.
  `undefined` is not an admitted binding value and cannot act as an override
  tombstone; omission and explicit `undefined` therefore cannot diverge.
- **[ECI-K7] Bounded audit.** The context carries one constant-size audit record
  per active method/getter activation. The stack is bounded by the existing
  runner-call-depth limit, so storage is `O(active depth)` with a fixed maximum;
  overflow rejects. Constructors are outside this audit, matching the existing
  `requireReturn` boundary.
- **[ECI-K8] Four-phase pre-RHS enforcement.** Dotted assignment executes in
  this exact order: parse and validate the target; resolve the receiver without
  evaluating the right-hand side; poison every active audit whose dynamic
  receiver matches; reject if any audit matched; only otherwise evaluate the
  right-hand side and write. `this.x = capability()` therefore invokes no
  provider. Poisoning survives guest `try/catch`, and the activation fails at
  finish even if an inner rejection is caught.
- **[ECI-K9] Nested receiver identity.** Audit matching uses the execution-local
  cloned dynamic receiver and propagates through nested, getter, and super
  frames. `super` audits the current dynamic `this`, and every alias of that
  receiver matches every active audit for the same identity. Audit depth is
  capped by the existing runner-call-depth limit and overflow rejects.
- **[ECI-K10] Exact rollback.** Existing field snapshots remain a defensive
  fallback and preserve cycles and cross-field aliases with one memo. The
  prohibited audited write path must be blocked before mutation, not repaired
  after an async yield.
- **[ECI-K11] Bounded traces.** Observable-only retention remains active in all
  frames. No full-trace audit buffer or event-count-proportional side channel is
  introduced.
- **[ECI-K12] Cache and key continuity.** The isolated root has a fresh runner
  memo cache. Scheduler continuity is proved only through the shared
  `schedulerKey`; interceptor authority continuity is proved through a new
  derivation-local `interceptorKey` bound to the same interceptor with sequence
  zero. Neither key is inferred from shared memo writes or lexical parents.
- **[ECI-K13] Shared/local lifecycle matrix.** Two isolated derivations from one
  caller share scheduler terminal state, cancellation, timeout, and pending-work
  accounting through `schedulerKey`. Each derivation has its own interceptor
  sequence counter and linearizes a request immediately before provider entry;
  it also has its own memo cache, call stack, trace retention, and audit stack.
  Disposing the caller scheduler stops new work but retains shared terminal
  state until pending work in every derivation settles. The interceptor
  function/authority may be shared; mutable interceptor sequencing may not.
- **[ECI-K14] Active invocation context.** A closure/function body always binds
  to the caller's active execution context, never to a context associated with
  its captured definition/module environment. The first argument of
  `makeExecutionFrame(activeCaller, overrides)` is always the active caller
  frame. Lexical/module definition maps travel only in `overrides`; they supply
  names, never execution-control identity.
- **[ECI-K15] Historical continuity.** The corrective source commit C is followed
  by a later non-self-referential historical transition that reconstructs exact
  source and compiled bytes through `b3d3f5fc` without changing archived
  receipts or compiled inventory. Transition T pins C's known full hash, exact
  path manifest, and source/compiled digests; it never reads `HEAD`, worktree
  bytes, or executes KERN while deriving historical data. The receipt is
  `scripts/kern-canonicalizer/execution-context-isolation-historical-transition.mjs`;
  every byte identity uses SHA-256 and every manifest is normalized,
  lexicographically sorted, and path-framed before hashing.
- **[ECI-K16] Quarantine before trust.** Isolated binding construction clones the
  source graph once with one memo shared by `bindings` and `runnerThis`, then
  validates only the completed clone. Validation never reconsults the source,
  so stateful proxy observations cannot replace an admitted scalar with a host
  function between validation and execution.
- **[ECI-K17] Stable collection intrinsics.** The isolation clone captures the
  complete Map/Set operation closure at module initialization: constructors,
  entries/values, iterator `next`, set/add, and the invocation primitive. Both
  nested collections and the top-level bindings map use only those captured
  intrinsics; later prototype replacement cannot execute attacker callbacks.
- **[ECI-K18] Receiver aliases are audited identities.** Every class activation
  frame restores the exact dynamic receiver for `this`, `runnerThis`, and each
  argument whose incoming identity equals the receiver. This applies to sync
  and async reference members plus effect-machine member and constructor
  frames, so aliased dotted writes poison the owning audit and roll back.
- **[ECI-K19] Derivation is target-only.** Deriving an isolated context never
  associates a previously unassociated caller. Scheduler and interceptor state
  can only be installed after explicit caller association; the scheduler
  retention path therefore performs lookup without installation. A target
  derived from an unassociated source receives fresh private keys, while a
  target derived from an associated source shares only the existing scheduler
  key and receives a fresh interceptor key.

## Design

### Internal execution context

The context is plain internal runtime state:

```text
InternalExecutionContext
  schedulerKey: object
  interceptorKey: object
  traceRetention: full | observable-only
  audits: bounded stack of active receiver-audit records
```

The context does not own the runner memo cache. Root installation creates a new
scheduler key and interceptor key. Derived legacy execution reuses only the
scheduler key and binds a new interceptor key to the same authority. Ordinary
child and call frames inherit the same context object through
`makeExecutionFrame`. An isolated concurrent legacy execution derives a new
context object with local interceptor sequence and audit stack.

Scheduler state owns a `derivations` reference count. Deriving an isolated
context registers that reference synchronously before environment construction
or guest scheduling and releases it in the outer sync/async `finally`. Scheduler
disposal deletes state only when `disposed`, `pendingWork === 0`, and
`derivations === 0`. This closes the zero-pending window between derivation and
its first scheduled operation.

### Control registries

Scheduler and interceptor modules obtain exact keys from the private context.
If no context exists, each module uses the existing `runnerCallCache ?? env`
key and parent traversal. Context-aware lookup never traverses parents. The
scheduler registry is shared by derived contexts; interceptor installation
creates a derivation-local registry state with its own sequence counter.

### Isolated environment construction

A single private constructor in `semantic-env.ts` creates a quarantined clone
using one memo for bindings and `runnerThis`, validates only that completed
clone, then creates an exact parentless root. It copies provenance containers, shares capability
functions and runtime-immutable runner definitions, creates an empty memo
cache/call stack, marks the environment exact only after construction, and
attaches a derived context. Any failure leaves no partially constructed exact
environment or registered control state.

All non-root execution frames use `makeExecutionFrame(source, overrides)`.
This factory binds the caller's active context regardless of definition/module
scope, then copies private effect-machine state in the same atomic construction
step. Direct `makeEnv()` remains available only for new external roots and
tests outside an active execution.

### Mutation audit

Method/getter activation pushes a constant-size audit record before running its
body and pops it in `finally`. Dotted assignment parses and resolves its target
before evaluating the RHS, poisons all matching active records, and throws.
Finish rejects any poisoned audit even if guest control flow caught the inner
error. Nested activation gets its own record while retaining outer records;
`super` and aliases compare against the same dynamic receiver identity.

## Acceptance

- [ ] **[ECI-P1]** RED proves sync and async observable-only legacy assignment
  changes caller bindings and runner memo state on the current implementation.
- [ ] **[ECI-P2]** RED proves observable-only method/getter dotted assignment can
  bypass rejection, including same-value assignment and caught assignment.
- [ ] **[ECI-P3]** Scheduler cancellation and timeout plus capability-interceptor
  sequencing remain exact through nested sync/async function, method, getter,
  and super frames.
- [ ] **[ECI-P3a]** Two concurrent derivations observe one scheduler terminal
  state and shared pending-work disposal, but start independent interceptor
  sequences and memo caches with one pinned provider-entry linearization point.
  Disposal between derivation registration and first enqueue retains state;
  deletion occurs only after both derivation references and pending work reach
  zero.
- [ ] **[ECI-P4]** Caller bindings, provenance containers, call stack, memo cache,
  runner instance fields, and private context association remain unchanged after
  isolated sync/async execution.
- [ ] **[ECI-P5]** Binding aliases, cycles, class-instance aliases, and
  `runnerThis` identity are preserved within the isolated graph but share no
  mutable admitted value with the caller graph.
- [ ] **[ECI-P6]** Hostile proxies, exotic values, and unclonable inputs reject
  before providers, publications, timers, or caller state change.
- [ ] **[ECI-P7]** Dotted writes to audited receivers reject before RHS
  evaluation or mutation; `this.x = capability()`, caught, same-value, nested,
  getter, aliased, multi-activation, and super attempts poison every owning
  activation; constructors and legal reads remain accepted.
- [ ] **[ECI-P8]** Audit state is one constant-size record per activation,
  bounded by the existing runner-call-depth limit, cleaned in `finally`, and
  isolated across two concurrent executions on one caller.
- [ ] **[ECI-P9]** Deterministic AST/constructor inventory covers every relevant
  execution frame, rejects raw `makeEnv()` in the reachable closure, proves
  caller-active context beats captured definition context, and rejects a
  deleted propagation edge.
- [ ] **[ECI-P10]** Runtime public declarations and the exact 133/133 source and
  built machine-owner closures remain unchanged.
- [ ] **[ECI-P11]** F1 full-cap, runtime-contract, source-runner convergence,
  canonicalizer, lint, build, and repository consistency gates pass.
- [ ] **[ECI-P12]** Corrective commit C lands before transition commit T; T pins
  C's known hash, complete affected-path manifest, and exact source/compiled
  endpoints without `HEAD`, worktree-byte, or KERN-evaluation dependence;
  independent Agon review has no blocker.
- [ ] **[ECI-P13]** A stateful proxy that changes descriptors between observations
  cannot inject a function into the isolated graph; the admitted clone reflects
  only its quarantine observation, and validation performs no source reread.
- [ ] **[ECI-P14]** Replacing Map/Set entries, values, iterator-next, set, or add
  after module initialization produces zero attacker callbacks during isolated
  cloning and preserves exact aliases/cycles.
- [ ] **[ECI-P15]** Sync, async, effect-machine member, and constructor frames
  preserve direct receiver aliases; aliased same-value, caught, and ordinary
  dotted writes reject and roll back exactly like `this` writes.
- [ ] **[ECI-P16]** Derivation and scheduler retention leave unassociated callers
  without private scheduler/interceptor keys. Installed scheduler continuity,
  cancellation, disposal refcounts, and derivation-local interceptor sequences
  retain their existing behavior.

## Out of Scope

Changing public runtime options, serializing execution context, changing guest
constructor semantics, admitting new mutable host values, sharing runner memo
entries across isolated executions, weakening scheduler/interceptor authority,
or replacing the existing effect-machine trace-retention state.
