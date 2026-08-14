# KERN 5 Trace-Compaction Historical Transition

**Status:** IMPLEMENTED — INDEPENDENT REVIEW PENDING

**Date:** 2026-08-14

**Successor commit:** `45dd2808e9efebcb21e0d2031f58062a444970c8`

**Review-correction successor:** `36d0f660a66c1f3198ca050d4ab56ad688512dbd`

**Ownership-correction successor:** `0df8834f1ec2509118128fbe1f0676ae6d525d25`

**Predecessor commit:** `1868480434adb54186b4077144748dd1afa7d07d`

**Tribunal:** `tribunal-1786694195303-ky48c2-kern5-trace-historical-transitio`
(`claude,codex,agy`, 3/3 substantive). Verdict: NO-GO on distributed
consumer-side composition; GO after one enforced path-keyed chain, immutable
transition identity, and deterministic source-to-compiled correspondence.

**Corrective tribunal:** `tribunal-1786708320748-w7e1cj` (`claude,codex,agy,kimi-for-coding-k3`,
4/4 substantive after one recovered timeout). Verdict: keep public reference
runner signatures unchanged; bind observable-only retention privately, replace
spread joins iteratively, and authenticate F1 failure/scaling evidence.

**Ownership tribunal:** `tribunal-1786712838842-8k4yqe-kern5-f1-machine-owner-contract`
(`claude,codex,agy,kimi-for-coding-k3`, 4/4 substantive; the requested six-seat
roster was narrowed by tribunal routing). Verdict: do not widen the exact
runtime machine-owner allowlist; move retention into typed `SemanticEnv` state,
keep event filtering in `trace.ts`, delete the graph-visible helper, and pin its
absence with a negative contract test.

**Final-blocker tribunal:** `tribunal-1786724836473-m5ph48-kern5-f1-final-blockers`
(`claude,codex,agy,kimi-for-coding-k3`, 4/4 substantive; the requested six-seat
roster was narrowed by tribunal routing). Verdict: derive a private execution
root instead of mutating the caller environment; inherit retention at child and
call-frame creation; replace every reachable variadic trace join with one
ordered iterative primitive; commit the formatted source correction before a
later non-self-referential historical-transition commit.

**Confidence:** 0.97 after incorporating all three tribunal deltas, resolving
the first six-engine review blockers, and passing the final local gates; final
six-engine review remains pending.

## Objective

Preserve every archived canonicalizer source and compiled-core identity after
the private runtime-envelope trace-compaction successor. The transition must
prove exact `successor -> predecessor` bytes and compose before older
runtime-text-cache, Text.splice, structural, and M4 reconstructions without
rewriting any archived digest or weakening exact-once anchors.

## Root Cause

- **[HTC-C1 VERIFIED]** The complete F1 and runtime walls pass, but
  `pnpm test:kern-canonicalizer` fails at the first historical boundary because
  live `internal-effect-machine.ts/js` no longer match the exact successor bytes
  expected by the runtime-text-cache transition.
- **[HTC-C2 VERIFIED]** The source failure is
  `replacements[1].current must occur exactly once`; the new `traceRetention`
  state member changed the same initializer block used by the older transition.
- **[HTC-C3 VERIFIED]** The compiled failure is
  `post-runtime-text-cache compiled source drifted` with live digest
  `2f4762cc...` instead of predecessor digest `b9d9f790...`.
- **[HTC-C4 VERIFIED]** The compiled JavaScript inventory is unchanged. Trace
  compaction is a byte-only successor across existing paths, so no inventory
  transition is permitted.
- **[HTC-C5 VERIFIED]** Existing coverage reconstruction has independent loops
  that may reread live bytes and overwrite the same path in a map. Convention
  alone does not enforce overlap order.
- **[HTC-C6 VERIFIED]** The first corrective implementation introduced a new
  graph-visible helper outside the exact runtime machine-owner contract. The
  runtime-contract gate rejected both source and built closures. The ownership
  successor deletes that helper, makes retention typed environment state, and
  restores the unchanged 133/133 exact closure.
- **[HTC-C7 VERIFIED]** Final six-engine review proved that legacy retention
  binding mutates caller-owned `SemanticEnv` objects and that independent
  `makeEnv` call frames lose the observable-only policy.
- **[HTC-C8 VERIFIED]** Final six-engine review reproduced argument-limit
  `RangeError` at variadic trace joins in try/class execution before envelope
  normalization can enforce `maxEvents`.
- **[HTC-C9 VERIFIED]** Formatting the ownership successor changed three pinned
  source endpoints, so the live tree no longer authenticates directly against
  `0df8834f`; a later transition must bind the final source successor.

## Contract

- **[HTC-K1] Immutable identity.** The transition binds exact claim
  `kern.runtime.trace-compaction.r0`, successor commit, predecessor commit,
  affected normalized paths, and SHA-256 identities for successor and
  predecessor source and compiled bytes.
- **[HTC-K2] One chain executor.** A shared path-keyed executor accepts live
  bytes once and feeds each stage only the previous stage's output. It rejects
  duplicate claims, duplicate path producers, broken digest edges, wrong order,
  skipped stages, malformed paths, empty stages, and non-exact replacements.
- **[HTC-K3] No disk rereads within a chain.** Consumers may load the live path
  once; every overlapping predecessor is derived from the carried bytes.
- **[HTC-K4] Archived authority is immutable.** Existing runtime-text-cache,
  Text.splice, structural, and M4 expected digests and receipts remain byte
  identical. The new transition adapts the authenticated successor to them.
- **[HTC-K5] Inventory neutrality.** The successor and predecessor compiled
  inventories have the same count and digest. No path is added or removed by
  this transition.
- **[HTC-K6] Source-to-compiled correspondence.** Tests build both pinned commits
  deterministically and prove every declared source/compiled endpoint matches
  its transition digest. Checked-in transition data cannot authenticate stale or
  unrelated `dist` bytes.
- **[HTC-K7] Complete affected set.** Every trace-compaction-modified source file
  and every emitted JavaScript file whose bytes change is declared. Type-only
  source changes whose emitted JavaScript stays identical are explicitly
  attested as such.
- **[HTC-K8] Fail closed.** Mutation of claim, commits, path, digest, edge,
  replacement anchor, or endpoint bytes rejects before a historical receipt is
  returned.
- **[HTC-K9] Caller isolation.** Observable-only legacy execution derives an
  internal root and never writes, deletes, re-keys, or privately associates the
  caller environment. Absence of an internal binding remains full retention.
- **[HTC-K10] Frame propagation.** Child, helper, function, constructor, method,
  getter, and async call environments inherit the execution-root retention at
  creation without changing `SemanticEnv`, `makeEnv`, or reference-runner
  signatures.
- **[HTC-K11] Non-variadic joins.** Every trace join reachable through
  try/catch/finally and class execution is iterative, ordered, self-join safe,
  and cannot depend on the host argument-count ceiling.
- **[HTC-K12] Non-self-referential correction.** The formatted source fix is
  committed first. A later transition commit pins that known successor and
  composes it backward through `0df8834f`; no transition names its containing
  commit.

## Design

### Shared chain executor

`historical-transition-chain.mjs` owns validation and execution. A stage is
plain frozen data with `claim`, `path`, `successorDigest`, `predecessorDigest`,
and ordered exact replacements. The executor hashes incoming bytes against the
successor, calls the existing strict `reconstructHistoricalSource`, and verifies
the predecessor. A chain additionally requires each next successor digest to
equal the prior predecessor digest.

### Trace-compaction transition

`trace-compaction-historical-transition.mjs` declares source and compiled stage
sets. Source endpoints are the exact Git blobs at the two pinned commits.
Compiled endpoints come from clean deterministic core builds of those commits.
The module contains no filesystem or Git lookup and performs no work on import.

### Trace-retention ownership transition

`trace-retention-ownership-historical-transition.mjs` binds the exact
`0df8834f -> 36d0f660` source and compiled endpoints. Because the successor
deletes the private helper, this edge authenticates a 317-to-318 reverse
inventory transition and embeds the exact deleted source/compiled predecessor
bytes before the older `36d0f660 -> 45dd2808` transition removes that path.

### Consumers

- M4.97 and runtime bottleneck source consumers run the applicable trace stage
  before their existing runtime-text-cache stage.
- Compiled coverage constructs one stage list per path. Trace compaction is
  first; existing transitions follow in established chronological order. One
  executor call produces the final override, preventing map overwrite or live
  reread ambiguity.
- Transition tests validate the full overlapping
  `current -> pre-trace -> pre-cache -> older milestone` chain.

## Acceptance

- [x] **[HTC-P1]** RED captures the exact source-anchor and compiled-digest
  failures from the complete canonicalizer gate.
- [x] **[HTC-P2]** Every declared successor and predecessor source digest equals
  the corresponding pinned Git blob.
- [x] **[HTC-P3]** Clean deterministic builds of both pinned commits reproduce
  every declared compiled digest and the unchanged inventory identity.
- [x] **[HTC-P4]** Full-chain reconstruction reaches the unchanged M4.97 and
  M4.145 endpoints for overlapping TypeScript and JavaScript paths.
- [x] **[HTC-P5]** Wrong order, skipped stage, duplicate claim/path, broken edge,
  mutated anchor/digest/path/commit/claim, zero occurrence, and duplicate
  occurrence all reject.
- [x] **[HTC-P6]** `pnpm test:kern-canonicalizer` passes without modifying any
  archived expected digest or historical receipt.
- [x] **[HTC-P7]** F1, runtime-envelope, source-runner, build, lint, and the full
  workspace/infra wall pass on the final tree.
- [ ] **[HTC-P8]** Independent Agon review reports no unresolved blocker before
  the combined branch is pushed once to `main`.
- [ ] **[HTC-P9]** Frozen and proxied caller environments observe zero property
  writes across sync/async legacy execution; direct reference runs before and
  after retain full traces; nested function/class frames retain the bound
  observable-only policy.
- [ ] **[HTC-P10]** A deterministic AST gate rejects variadic trace joins in the
  affected effect-machine modules, and large try/class traces preserve exact
  event order without `RangeError`.
- [ ] **[HTC-P11]** The final source successor is a formatter fixed point and a
  later transition commit reconstructs its exact source and compiled endpoints
  through the unchanged ownership-correction history.

## Out of Scope

Changing canonicalizer resource floors, regenerating historical receipts,
weakening exact-once reconstruction, excluding affected runtime files, adding a
compiled inventory transition, or changing the public runtime ABI.
