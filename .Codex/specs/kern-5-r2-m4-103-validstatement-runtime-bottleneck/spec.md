# KERN 5 R2 M4.103 — `validstatement` Runtime Bottleneck Investigation

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.94

## Executive Summary

[VERIFIED] Published M4.102 commit
`49b99465b2808fbeeb54fa6e1d6e3d1ee110d46c` freezes the exact
`validstatement` structural runtime floor at 72,195 retained iterations. The
candidate profile 89/125/2100 exceeds the unchanged 65,536 production ceiling
by 6,659 and the 49,152 promotion budget by 23,043.

[DECIDED] M4.103 attributes the deterministic runtime cost of that exact
witness through bounded observer evidence. It does not optimize source or
runtime behavior, change policy, promote the profile, migrate the function, or
claim KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main`
`49b99465b2808fbeeb54fa6e1d6e3d1ee110d46c`.

[VERIFIED] Immutable M4.102 inputs are:

- headroom receipt SHA-256
  `8bed0a4709de4ba79dfffba68e4f9304bdf599e04d771520637bb935865b5e58`;
- measurement harness SHA-256
  `15dd7ae3cb4927ca906b0ada4f1699b7bd5a748eeff680b1ba1b9facef464ba9`;
- statement-helper source SHA-256
  `158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667`;
  and
- public runtime handler SHA-256
  `f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1`.

[VERIFIED] Existing default-off diagnostic owners are:

- observer contract
  `6037e9f2e37e3888b45d64458c627c217abfd52105271de226bf47e053e495b6`;
- helper runtime
  `d3254d54b5bf2b86c89776faad6b49f073d0754c0bc10dd269ce887cd0c3229c`;
- effect-machine sequence
  `fbd95b89099ceffbb6c2e8f2136620bfe51bda5bd2a22ba93de1db7743a68bfe`;
  and
- runtime-envelope execute owner
  `2b364468abdfbaf204fff5ee5f047cf5d9536bcf526e022e8c8b4d77ad1196aa`.

## Diagnostic Contract

[DECIDED] The measurement must execute the exact migrated M4.102 witness
through the composed KERN `canonicalize` handler with candidate profile
89/125/2100.

[DECIDED] Deterministic observer evidence must record:

1. attempted, retained, and rolled-back loop iterations;
2. helper preparations, executions, cache hits, and cache misses;
3. parent restarts and resumable helper-frame suspensions by exact edge;
4. cache-key serialization input volume; and
5. terminal outcome and structural round-trip at the exact floor.

[DECIDED] The authenticated comparison uses the unchanged 65,536 production
ceiling and exact 72,195 success floor. Both observations are bounded; the
production run must fail and the exact-floor run must succeed. The observer
must not change either envelope.

[DECIDED] The diagnosis selects the largest deterministic cost delta by
mechanism from those two observations. It must publish exact counters and a
single next milestone. Wall-clock duration may be recorded for context but
cannot determine the diagnosis.

[EXPECTED] The leading candidates are helper replay, cache-key serialization,
or ordinary committed loops caused by the larger statement/value tables. No
mechanism is accepted until the exact observer delta proves it.

## Implementation Plan

1. Add a RED test at the absent M4.103 measurement/receipt boundary.
2. Reuse the existing default-off observer to measure 65,536 and 72,195.
3. Freeze the exact diagnosis in a closed canonical receipt bound to M4.102 and
   all executable inputs.
4. Integrate the M4.103 status without changing source, runtime, policy, ABI,
   profile, signature, generated tools, or cumulative coverage.
5. Run focused and complete canonicalizer gates, full Node 22 KERN 5 fitness,
   mandatory high-risk role review, then fetch/rebase-first atomic publication.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.102 commit `49b99465`.
- [x] M4.102 receipt, witness, budgets, and diagnostic owner identities are
      grounded.
- [x] RED fails at the absent M4.103 boundary.
- [x] Exact production-ceiling and exact-floor observations terminate.
- [x] Observer-on and observer-off envelopes are byte-identical.
- [x] Exact-floor success structurally round-trips the M4.102 witness.
- [x] Deterministic deltas identify one dominant runtime mechanism.
- [x] Closed receipt rejects mutation, decoration, and input drift.
- [x] M4.103 changes no source, runtime, policy, ABI, profile, signature,
      generated tool, or cumulative base coverage.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- M4.102 receipt, exact floor, witness, or source identity drifts.
- Observer-on and observer-off envelopes differ.
- Either bounded observation does not terminate.
- The exact-floor result does not structurally round-trip.
- Evidence cannot separate committed work from replay/serialization overhead.
- The slice requires runtime/source/policy/ABI/profile/signature/base changes.

## Out of Scope

- Implementing the diagnosed optimization.
- Promoting 89/125/2100 or migrating `validstatement`.
- Raising runtime, KIR, or profile limits.
- Projection-depth/node, unknown-expression, text-character, or exception-flow
  support.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The RED oracle failed at the absent
`runtime-bottleneck-m4-103.mjs` boundary before implementation.

[VERIFIED] The unchanged default-off observer reproduces both prespecified
budgets with observer-on/off envelope parity:

- 65,536: failure, 65,536 attempted and retained `for` iterations, zero
  rollback, zero parent restarts, and no statement-emission executions; and
- 72,195: success with structural round-trip, 72,195 attempted and retained
  `for` iterations, zero rollback, and zero parent restarts.

[VERIFIED] The 6,659-step production deficit is entirely committed loop work,
not replay. Completing the exact-floor tail adds 261 helper executions, 1,084
helper preparations, 228 resumable frame suspensions, and 28,276,387 cache-key
input code units. It includes 73 `emitstatement`, 27 `emitstatementlist`, nine
additional `validstatement`, and three additional `validstatementlist`
executions.

[VERIFIED] The bounded mechanism is
`committed-validation-and-emission-loop-work`; M4.104 receives
`statement-validation-and-emission-table-traversal` as the optimization target.
No optimization or promotion is approved by M4.103.

[VERIFIED] Canonical receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-103.json` has SHA-256
`a8f80c8d63cbaba2ff6d5d579d347ff9c489719e8f5170a95acadfbbfcd19488`.
It rejects mutation, decoration, shared references, and M4.102 drift, and loads
byte-identically in a fresh locale-independent process.

[VERIFIED] Focused diagnosis/status/history tests pass 64/64. The central
coverage checker converges with unchanged 90/109 base coverage, 16 legacy
parameter blockers, no ready queue, coverage implementation digest
`351a16a8644ec291c85c8b6eb5cc241c20613c5f813d13dcc94d80374434ad3a`,
coverage summary SHA-256
`51027d9d2faa80b1e63a78ee9b6703fc17a502ffb94af638a3eed88e262f379a`,
and prerequisite summary SHA-256
`58707d2d0591981ac503db883cb88f51b6f840087d24e3ec6926ce4b13458797`.

[VERIFIED] The pre-review complete canonicalizer gate passed 439/439 and the
full Node 22 `pnpm fitness:kern-5` wall passed through the final
`KERN 5 current fitness wall passed` oracle.

[VERIFIED] Mandatory high-risk role-lens review
`review-1785149796868-qzrhnk` completed across all six usable reviewers with
one verified blocker, three needs-check findings, and 13 nits. The verified
provenance blocker is fixed: M4.103 now recomputes the framed digest of the
entire compiled-core JavaScript tree and every direct executable input before
loading the receipt. The valid test-gap finding is fixed by reasserting live
helper execution, preparation, and frame-suspension totals plus selected helper
maps. The two duplication findings are intentionally deferred because
extracting shared historical receipt or witness machinery would expand this
evidence-only slice.

[VERIFIED] Post-review focused M4.103 tests pass 6/6 and the central coverage
checker regenerates and then reloads byte-identically with the digests above.

[VERIFIED] After the review fixes, the complete canonicalizer corpus passes
439/439 in both invocations and the complete Node 22 `pnpm fitness:kern-5`
wall passes again through repo consistency, lint, production build, all
workspace and infrastructure tests, conformance/showcase/browser-budget lanes,
KIR/runtime gates, and the final `KERN 5 current fitness wall passed` oracle.
