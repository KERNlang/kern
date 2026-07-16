# KERN 5 R2 M3.28 Non-Root Environment Ownership

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.99
**Design challenge:** `tribunal-1784164796004-vo6752-kern-5-r2-m3-28-non-root-environ`
(3/3 requested engines completed; AGAINST the initial draft, hardened below)

## Executive Summary

M3.28 removes the final non-class environment blocker from the canonical
source runner. A source sequence may start in a lexical child created by the
private `childEnv` constructor, read bindings through its parent chain, declare
new bindings locally, and assign existing bindings in their exact declaring
scope. Raw, forged, reparented, cyclic, or metadata-invalid environment chains
remain compatibility paths before any provider dispatch.

The selected design records exact structural and parent facts at `makeEnv` and
`childEnv` creation. Admission reads every runtime-relevant field through own
data descriptors, admits only an acyclic coherent chain, and revalidates that
chain after every provider returns or rejects before the machine resumes. It
does not flatten scopes, copy caller state, introduce a transaction layer, or
alter the exported TypeScript shape of `SemanticEnv`.

## Current State / Root Cause

- **VERIFIED:** `makeEnv` creates private-owned binding/provenance containers,
  while `childEnv` creates another owned frame, inherits runner/runtime
  references, and stores a public `parent` link
  (`packages/core/src/ir/semantics/semantic-env.ts:180-204,221-245`).
- **VERIFIED:** reads walk the live environment chain; declarations write the
  current frame; assignment writes the nearest declaring frame
  (`packages/core/src/ir/semantics/semantic-env.ts:247-270,328-347`).
- **VERIFIED:** direct admission already validates private environment and
  composite ownership, exact metadata containers, portable binding graphs,
  empty call state, and inactive class-call state
  (`packages/core/src/ir/semantics/internal-effect-machine-admission.ts:91-109,137-162`).
- **VERIFIED:** the only unconditional environment-shape rejection in that
  direct owner is `env.parent !== undefined`
  (`packages/core/src/ir/semantics/internal-effect-machine-admission.ts:143-152`).
- **VERIFIED:** both source selection and machine execution use the same direct
  eligibility predicate; selection happens before provider execution and a
  selected machine failure never retries on compatibility
  (`packages/core/src/ir/semantics/internal-effect-machine-eligibility.ts:30-41`;
  `packages/core/src/runtime-envelope/source-runner-engine.ts:74-133`).
- **VERIFIED:** the focused lambda suite currently freezes an owned child on
  compatibility solely because it has an incoming parent
  (`packages/core/tests/runtime-envelope-effect-machine-lambda.test.ts:428-434`).
- **VERIFIED:** the executable convergence manifest keeps exactly
  `non-root-environment` deferred to M3.28 alongside the separate M3.29 class
  getter/inheritance blocker
  (`scripts/source-runner-convergence-manifest.json:48-60`).

The root cause is not missing lexical execution behavior. It is missing private
provenance for the `child -> parent` edge, descriptor-safe whole-chain
admission, and a resume guard after host code regains control. Checking only
that both objects were once machine-created would permit caller reparenting or
cycles; checking only once would leave stale trust after provider suspension.

## What Already Works

- Machine structure and runtime already create internal branch/loop children
  with `childEnv` and resolve ancestor bindings through shared semantic helpers.
- Root environment ownership, hostile composite rejection, helper/class graph
  ownership, iteration budgets, and no-retry selection remain unchanged.
- Reference execution already defines the observable lexical semantics; M3.28
  changes admission only and must preserve trace and final environment parity.
- M3.27 class behavior remains separately bounded. Getter, inheritance, `super`,
  imported class, and class-call-frame ownership stay M3.29 work.

## Contract (Verified and Frozen After Tribunal)

> Verified against the cited source on 2026-07-16. Tribunal may narrow this
> table before implementation; no unsupported widening is implicit.

| Field / Behavior | Contract | Evidence | Tag |
| --- | --- | --- | --- |
| Entry frame | exact environment produced by `childEnv`, not a caller-shaped object | `semantic-env.ts:221-245` | VERIFIED |
| Field mechanics | every machine-read environment field is an own data property read from its descriptor; accessors/inherited replacements reject without invocation | tribunal verdict; acceptance | FROZEN |
| Parent edge | own-data `child.parent` must equal the private parent recorded when that child was created | tribunal verdict; acceptance | FROZEN |
| Chain | every frame through the root is private-owned, exact-structural-container-valid, portable, coherent, and visited once | `internal-effect-machine-admission.ts:91-109,137-162`; tribunal | FROZEN |
| Root | chain terminates at an owned root with private root provenance and own-data `parent: undefined` | `semantic-env.ts:176-204`; tribunal | FROZEN |
| Reads | nearest lexical declaration wins through the existing parent walk | `semantic-env.ts:247-263` | VERIFIED |
| Declarations | `let`/derived declarations remain local to the entry child frame | `semantic-env.ts:266-325` | VERIFIED |
| Assignments | an existing ancestor binding is mutated in that exact ancestor; an absent target still rejects | `semantic-env.ts:328-347`; leaf contract | VERIFIED |
| Shadowing | a child-local declaration shadows an ancestor without replacing it | `semantic-env.ts:258-269`; let contract | VERIFIED |
| Runner graph | helper/class maps remain subject to their existing private same-root graph owners | `internal-effect-machine-eligibility.ts:33-40` | VERIFIED |
| Chain coherence | runner maps, call/cache state, receiver state, capabilities/context, seed, and time remain referentially/value identical on every child-parent edge | tribunal verdict; acceptance | FROZEN |
| Class call frames | `runnerThis`, `runnerSuperClass`, and protected-instance frames remain excluded | `internal-effect-machine-admission.ts:148-150` | FROZEN |
| Effects | invalid chains select compatibility before provider/accessor invocation; selected machine failures never retry | `source-runner-engine.ts:74-133` | VERIFIED |
| Resume guard | after every sync or async provider return/rejection, the chain is revalidated before `next`/`throw`; invalidation fails closed without retry | tribunal verdict; acceptance | FROZEN |
| Concurrency | overlapping executions retain per-run machine state; M3.28 adds no shared global current-environment slot | current scheduler contract; acceptance | FROZEN |
| Manifest | `non-root-environment` moves to unified; `runner-classes-state` remains deferred to M3.29 | convergence manifest; acceptance | FROZEN |

## Implementation Options

### Option A - Private parent-edge provenance plus whole-chain admission (selected)

Record root/child structural facts and `child -> parent` in a module-private
`WeakMap` inside `semantic-env.ts`. Replace root-only direct admission with a
descriptor-driven chain walker that validates exact edge identity, cycle
freedom, structural-container identity, portable binding graphs, coherent
runtime graph fields, and existing class-frame exclusions. Reuse the existing
lexical helpers for execution, and call the same environment guard before every
post-provider generator resume.

This is the smallest design that distinguishes an authentic child from an
owned environment whose public `parent` field was forged after construction.

### Option B - Admit any owned environment with an owned parent

Rejected. Private ownership of two frame objects does not prove their current
relationship. A caller can reparent an authentic child, create a cycle, or
splice independent roots while both endpoints still satisfy object ownership.

### Option C - Flatten or clone the chain into a synthetic root

Rejected. Flattening loses shadowing and declaring-scope identity. Cloning
changes the public mutation contract because ancestor assignments would not be
visible on the caller's original environment. A commit-back transaction adds a
new conflict/rollback contract that M3.28 does not require.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-r2-m3-28-non-root-environment/spec.md` | add | frozen cross-owner contract and evidence |
| `semantic-env.ts` | edit | record private exact parent provenance at construction |
| `internal-effect-machine-admission.ts` | edit | validate the complete authentic environment chain |
| `internal-effect-machine-eligibility.ts` | edit | consume generalized direct-environment ownership |
| `internal-effect-machine.ts` | edit | revalidate before every post-provider generator resume |
| focused non-root environment test | add | RED/GREEN parity, rejection, async, and mutation oracles |
| existing lambda selector test | edit | replace the legacy guardrail with the owned-child positive case |
| convergence manifest/checker/tests | edit | promote only the exact non-root blocker |
| KERN 5 fitness policy/package script | edit | bind the aggregate wall to M3.28 evidence |
| release train | edit after gates | record completion and leave M3.29 exact |

## Acceptance Criteria

- [x] A one-level `childEnv(makeEnv(...))` selects and executes on the machine
      through sync and real-async source APIs.
- [x] A multi-level authentic child chain reads the nearest lexical binding,
      preserves shadowing, creates declarations only in the entry frame, and
      mutates an existing ancestor in its exact declaring frame with reference
      trace parity.
- [x] Scalar, array, record, map, decimal, lambda, helper, and admitted class
      values retain their existing ownership and provenance behavior when read
      through an authentic parent chain.
- [x] A raw environment object, raw parent frame, replaced parent, spliced
      independent root, cycle, malformed metadata container, hostile accessor,
      unowned composite, non-empty call stack, or active class-call frame
      selects compatibility before invoking a provider or accessor.
- [x] Accessors or inherited replacements on `parent`, bindings/provenance,
      runner maps, call/cache state, receiver state, capabilities/context,
      seed, or time reject without invoking the accessor.
- [x] Divergent runner maps, call/cache state, receiver state,
      capabilities/context, seed, or time across a child-parent edge reject.
- [x] Mutation of a chain, structural container, or binding graph after
      sync/async provider dispatch is detected before the next generator
      `next`/`throw`; execution fails closed without compatibility retry.
- [x] Two overlapping async runs on independent child chains do not share
      private machine state or binding mutations.
- [x] Root environments and internal loop/branch children retain current
      behavior; no public type, serialized ABI, or capability contract changes.
- [x] `non-root-environment` becomes unified in convergence evidence while
      `runner-classes-state` remains exactly deferred to M3.29.
- [x] Every touched handwritten source/test file stays below 500 lines.
- [x] Focused tests, convergence/import closure, browser wall, and exact
      `pnpm fitness:kern-5` pass.
- [x] Final `agon review -e claude,codex,agy` completes with every verified
      finding fixed or explicitly adjudicated against current source.

## Completion Evidence

- The design tribunal completed 3/3 and rejected the initial entry-only design:
  `tribunal-1784164796004-vo6752-kern-5-r2-m3-28-non-root-environ`. Its
  descriptor, chain-coherence, and post-provider resume requirements are in the
  final implementation.
- RED tests proved that authentic children still selected compatibility, an
  environment getter could be invoked, and post-provider chain mutation was not
  guarded. The focused non-root suite now covers authentic one- and multi-level
  chains, exact ancestor writes, shadowing, forged/replaced/cyclic edges,
  accessor-free rejection, sync/async mutation, live scalar updates, and
  overlapping runs.
- The first aggregate wall exposed two resume-state domains absent from the
  focused draft: machine-created aliases and normalized capability graphs with
  records nested in arrays. Entry admission remains strict; the resume-only
  descriptor walker admits those privately owned runtime states and rejects
  cycles or unowned composites. The complete source-executor suite proves the
  preserved structured-capability and descriptor-handler behavior.
- The exact final `pnpm fitness:kern-5` wall passed: 432/432 conformance
  fixtures, 109/109 class cases, 233 native cases, 48/48 checker fixtures with
  36 accept-but-abstain attempts rejected, 39/39 validator lines, and 40
  application fixtures on three legs plus whole-app Express/FastAPI boot.
- The final browser wall passed at 135 modules, 1,432,650 raw bytes, 313,744
  gzip bytes, 49 ms cold execution, and 76 ms median browser execution.
- The required three-engine review completed at
  `review-1784167478723-wugqlu-kern-5-r2-m3-28-non-root-environ`. The
  ancestor-accessor ordering and falsy-input findings were fixed with focused
  regressions. The proposed resume-time global `Map.prototype` rejection was
  adjudicated against the existing captured-intrinsics contract; the aggregate
  wall reproduced the conflict, and the final wall passed after retaining that
  frozen behavior.

## Out of Scope

- Caller-forged or manually constructed `SemanticEnv` parents.
- Flattened scope semantics, transactional clones, commit-back, rollback, or
  concurrent mutation conflict detection.
- Active helper/class invocation frames as source-runner entry environments.
- Getter/setter, inheritance, `super`, imported-class, or full class-row
  promotion; these remain M3.29.
- Public API or persisted format changes.

## Open Questions

None. Tribunal is asked to challenge whether private parent-edge identity plus
whole-chain validation is sufficient. Its verified counterexamples are now
incorporated as descriptor, coherence, and resume-guard requirements.

## Deploy Order

M3.28 is additive source-runner admission on top of M3.27. Older runtimes keep
authentic child environments on compatibility; newer runtimes select the
machine only for the frozen chain. No serialized state crosses versions.
Rollback restores the root-only admission check and the manifest deferral.

Delivery follows the standing branch rule: fetch and inspect `origin/main`
immediately before push. If the stacked prerequisites have merged, rebase onto
`origin/main` and publish a fresh M3.28 branch; otherwise continue the current
stacked branch in one push.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| Non-root execution behavior is missing from the machine. | Machine branches, loops, reads, and assignments already execute through lexical children. | M3.28 is an entry-admission/provenance slice, not a second scope runtime. |
| Environment ownership alone proves a safe parent chain. | Authentic owned frames expose mutable public `parent` fields. | Bind the exact edge privately and validate the whole acyclic chain. |
| Entry-only chain validation is enough. | Provider code can replace public environment fields while sync/async execution is suspended. | Revalidate before every post-provider generator resume and never retry. |
| Ordinary property reads are harmless during validation. | A caller can replace an authentic field with an accessor and trigger it during admission. | Read and validate own data descriptors; reject accessors/inherited replacements without invocation. |
| Entry binding validation can be reused unchanged after a provider. | Machine execution may create legitimate aliases and bind normalized capability graphs wider than the entry domain. | Keep entry admission strict and use a private-owned, descriptor-safe runtime graph validator only on resume. |
