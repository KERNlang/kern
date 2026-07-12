# KERN 5 R1.4b Non-Circular Semantic Ownership Proof

**Status:** IMPLEMENTED - LOCAL CLOSURE GREEN; CI WITNESS PENDING
**Date:** 2026-07-12
**Confidence:** 0.99
**Depends on:** R1.4a commit `332d6fa566b86a1e874f3829006e3851472b8d45`
**Tribunal:** `tribunal-1783812191960-5ml0hf` (`claude,codex,agy`, 3/3)
**Brainstorm:** `brainstorm-1783812471425-noepiv` (`claude,codex,agy`, 3/3)

**Closure evidence:** the complete `pnpm fitness:kern-5` wall passed on
2026-07-12; the final ownership oracle passed 40/40 adversarial checks; lint,
build/typecheck, KERN 5 contract validation, and diff hygiene passed. Final
three-engine Agon review
`review-1783815596958-b1sahk-kern-5-r1-semantic-ownership-fin` completed 3/3
with zero verified or needs-check findings and three non-blocking nits. Linux CI
remains the post-push environment witness.

## Executive Summary

R1.4b adds a versioned, executable ownership proof over the internal KIR reader
candidate. It proves two separate facts without confusing them:

1. the current source runtime and self-hosted tools remain dependent on the
   TypeScript bootstrap authority; and
2. the planned canonical KERN 5 path is acyclic and cannot reach any component
   classified as a bootstrap or differential oracle.

Every successful proof prints `BOOTSTRAP-DEPENDENT`. Passing R1.4b does not
mean runtime cutover, KIR v1 freeze, public export, interpreter shadow parity,
or semantic self-hosting. It only makes the ownership boundary machine-checkable
before R1.5 decides which contracts are eligible to freeze.

## Current State / Root Cause

1. `executeKernSource` resolves and parses source, then executes handler nodes
   through `referenceRunSequence` (`packages/core/src/runner.ts:1091-1152`).
   **VERIFIED**
2. Async source execution uses `asyncReferenceRunSequence`, whose fallback for
   unsupported synchronous nodes is `referenceRun`
   (`packages/core/src/runner.ts:1295-1327`;
   `packages/core/src/ir/semantics/async-reference-runner.ts:72-115`).
   **VERIFIED**
3. `referenceRunSequence` dispatches every node to the TypeScript
   `referenceRun` implementation
   (`packages/core/src/ir/semantics/reference-runner.ts:24-72`). **VERIFIED**
4. The KERN-authored validator and checker are launched with the TypeScript CLI
   (`scripts/check-selfhost-validator.mjs:59-64`;
   `scripts/check-capstone-checker-subset.mjs:83-88`). **VERIFIED**
5. The reader candidate remains absent from core package exports and runtime
   barrels, and imports only candidate-local modules
   (`scripts/check-kir-reader-candidate.mjs:133-150`). **VERIFIED**
6. The release train explicitly says executing a KERN-authored interpreter
   through `referenceRunSequence` is not semantic ownership and schedules the
   proof before ABI freeze (`docs/kern-5-release-train.md:183-190`). **VERIFIED**
7. The architecture plan schedules the actual KERN interpreter shadow and
   cutover after the frontend/runtime lanes consume frozen contracts, not in
   R1.4b (`docs/kern-5-own-language-plan.md`, M8). **VERIFIED**

The root problem is claim ambiguity. A KERN-authored checker can appear
self-hosted while its semantics are still supplied by the TypeScript runner.
A green reader test alone cannot establish semantic ownership.

## Contract

| Behavior | R1.4b contract | Tag |
|---|---|---|
| Proof schema | A closed, versioned policy defines components, roles, statuses, canonical flow edges, forbidden oracle roles, current witnesses, and explicit non-claims | VERIFIED design decision |
| Current authority | TypeScript parser/runner/reference runners are recorded as current bootstrap authority, never as permanent KERN 5 owners | VERIFIED design decision |
| Planned path | Source -> KERN frontend -> internal reader boundary -> KERN interpreter -> host capability boundary is acyclic | VERIFIED design decision |
| Oracle exclusion | No node reachable on the planned canonical path may have a bootstrap-oracle or differential-oracle role | VERIFIED design decision |
| Source binding | Current authority witnesses are bound to literal source evidence so stale or relabeled claims fail closed | VERIFIED design decision |
| Reader containment | The reader remains an internal data boundary and is not imported by runtime entrypoints or publicly exported | VERIFIED design decision |
| Live reader binding | The proof positively binds the current `kern.semantic-kir.probe.1` candidate source while preserving its internal, unfrozen status | VERIFIED design decision |
| Output | Success visibly includes `BOOTSTRAP-DEPENDENT` and the non-claims | VERIFIED tribunal requirement |

## Rejected Options

### Minimal KERN interpreter in R1.4b

Rejected. It pulls M8 forward before KIR and runtime contracts are eligible to
freeze, risks shaping the ABI around the partial candidate, and widens the
rollback unit.

### ReferenceRunner as the permanent KERN 5 semantic owner

Rejected. It contradicts Bar C and the own-language architecture. It remains a
bootstrap/differential oracle during migration.

### Documentation-only ownership diagram

Rejected. A prose diagram cannot reject cycles, hidden oracle reachability,
source drift, multiple ownership, or accidental runtime adoption of the reader.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/semantic-ownership/policy.json` | add | Versioned graph, roles, witnesses, and non-claims |
| `scripts/semantic-ownership/validate.mjs` | add | Pure validator used by the gate and mutations |
| `scripts/semantic-ownership/validate.test.mjs` | add | Kill cycles, oracle reachability, source drift, relabeling, and false claims |
| `scripts/check-semantic-ownership.mjs` | add | Repository-bound R1.4b gate and visible output |
| `package.json` | modify | Add `test:kern-semantic-ownership` |
| `scripts/kern-5-fitness-policy.json` | modify | Make the internal proof a current fitness gate and truthful ownership row |
| `scripts/kern-5-fitness.test.mjs` | modify | Lock the new gate and status |
| `docs/kern-5-release-train.md` | modify | Close R1.4b with bounded wording |

No runtime, parser, candidate source, public export, or ABI file changes.
Every handwritten file remains below 500 lines.

## Acceptance Criteria

- [x] Base branch is RED because `test:kern-semantic-ownership` does not exist.
- [x] The valid repository policy passes and prints `BOOTSTRAP-DEPENDENT`.
- [x] Current sync, async, fallback, CLI, checker, and validator authority edges
      are verified against literal source evidence.
- [x] The planned canonical graph has exactly one source and sink, is acyclic,
      and reaches every planned canonical component.
- [x] No canonical component or reachable dependency has an oracle role.
- [x] Mutations reject a self-cycle, reverse edge, disconnected component,
      bootstrap/oracle reachability, reader promotion to semantic owner,
      missing/altered source evidence, false runtime-cutover claim, false KIR
      freeze, and removal of the bootstrap-dependent marker.
- [x] Runtime entrypoints and public exports still cannot reference the reader
      candidate directly or through their bounded module import graph; direct,
      compact-syntax, literal-dynamic, and adapter-mediated mutations fail.
- [x] Existing KIR reader/probe gates and the complete `fitness:kern-5` wall pass.
- [x] Local repo/typecheck/test/build gates pass, then Agon review runs with
      exactly `claude,codex,agy`; verified blockers are fixed and re-gated.

## Out of Scope / Explicit Non-Claims

- Runtime cutover or any change to `executeKernSource*`.
- A KERN-authored interpreter implementation or shadow parity.
- KIR v1, value, diagnostic, trace, handler, or capability ABI freeze.
- Public KIR reader exports.
- Fixed-point self-hosting.
- Independence of this proof runner from Node/TypeScript bootstrap tooling.

## Deploy and Rollback

R1.4b stacks on R1.4a and ships as repository policy plus a release gate. It
does not affect installed packages. Rollback removes the policy/gate and marks
R1.4b open again; the R1.4a candidate and all KERN 4.5 execution paths remain
unchanged.
