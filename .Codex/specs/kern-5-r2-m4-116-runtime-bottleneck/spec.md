# KERN 5 R2 M4.116 — `checkModule` Runtime Bottleneck Investigation

**Status:** VERIFIED FOR PUBLICATION
**Date:** 2026-07-29
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.115 freezes the exact structural runtime floor for
`examples/capstone-checker-subset/checker.kern#24:checkModule` at 176,119
retained iterations. That exceeds the unchanged 65,536 production ceiling by
110,583 and the 49,152 promotion budget by 126,967
(`scripts/kern-canonicalizer/triple-row-headroom-m4-115.json`).

[DECIDED] M4.116 will attribute that cost using the existing default-off
runtime observer at the exact promotion, production, and success boundaries.
It is an evidence-only slice: no KERN source, runtime, ABI, policy, profile,
signature, generated-tool, or cumulative-coverage change is permitted.

## Current State / Root Cause Boundary

[VERIFIED] This branch starts at exact published M4.115 commit
`b278b00ae1a03cc36e52449980c76cdcaa9ad536`
(`git rev-parse HEAD`, 2026-07-29).

[VERIFIED] The immutable M4.115 inputs are:

- receipt SHA-256
  `0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d`;
- measurement harness SHA-256
  `a2686430ed13626e8678cf1efa074c7795c341c673cabd463447f7422261df0d`;
- witness source SHA-256
  `f8c9b50d5be28074479bebed4c93e6e6d7f8f15ea9efab54c2b396dcde924d99`;
- composed canonicalizer SHA-256
  `75546d8edbf2753fc49aacaf24ab2fa416d7b3d3bd8984b37dd76317691ce88f`;
- composition receipt SHA-256
  `18ff4b7116de086ab43a9d501545727ab27a6b99c10f991215d6d07607ed3216`;
  and
- runtime policy SHA-256
  `919726462eabc002cb072cd8004fffe7f3e731ed430574dd608788580ca1f163`.

[VERIFIED] The exact witness contains 58 parameters and structural profile
122/193/2411, round-trips byte-identically at 176,119, fails at 176,118, and
has public/internal runtime parity
(`scripts/kern-canonicalizer/triple-row-headroom-m4-115.json`).

[VERIFIED] The composed `canonicalize` handler first validates `tablesok`,
then validates the function/parameter/statement structure, then emits source
(`examples/kern-canonicalizer/canonicalizer.composed.kern:844-949`).

[VERIFIED] The current observer exposes helper preparation, cache,
helper-execution entry, helper-frame suspension, parent-restart rollback, and
loop-iteration events without exposing observer controls through the public
handler ABI
(`packages/core/src/ir/semantics/internal-effect-machine-diagnostics.ts:1-45`;
`packages/core/src/ir/semantics/internal-effect-machine.ts:112-147`).

[EXPECTED] The large value table may make `valuefacts`, value access, or later
statement validation dominant. This expectation is not an acceptance oracle;
the authenticated counters must select the actual mechanism.

## What Already Works

[VERIFIED] The M4.115 harness reconstructs the exact migrated witness, enforces
KIR depth 76 and runtime depth 64, executes the internal runtime handler, and
proves structural round-trip plus optional public parity
(`scripts/kern-canonicalizer/triple-row-headroom-m4-115-measure.mjs:42-158`).

[VERIFIED] The observer is default-off and catches observer failures so
diagnostics cannot change execution
(`packages/core/src/ir/semantics/internal-effect-machine-diagnostics.ts:36-45`).

[DECIDED] M4.116 will reuse those owners. It will not add a public diagnostic
surface or modify the production runtime.

## Diagnostic Contract

> Verified against the M4.115 receipt/harness and current runtime observer on
> 2026-07-29.

| Behavior | Evidence | Tag |
|---|---|---|
| promotion observation at 49,152 | M4.115 `limits.promotionBudget` | VERIFIED |
| production observation at 65,536 | M4.115 `limits.productionMaxCollectionLength` | VERIFIED |
| exact-floor observation at 176,119 | M4.115 `summary.maxExactFloor` | VERIFIED |
| observer-on/off envelopes must be deeply equal | M4.103/M4.105 diagnostic precedent | DECIDED |
| exact-floor success must structurally round-trip | M4.115 witness contract | VERIFIED |
| failed boundaries must not claim helper completion from `helper-execute` | observer event is emitted on helper-body entry at `internal-effect-machine-helper-runtime.ts:176-185` | VERIFIED |
| diagnosis uses deterministic counters, never elapsed time | M4.103/M4.105 receipt precedent | DECIDED |
| M4.117 is one bounded optimization target selected by the measured deltas | M4.115 `promotion.nextMilestone` hands to M4.116 investigation | DECIDED |

The frozen observations must include:

1. attempted, retained, and rolled-back iterations by loop type;
2. helper preparations and execution-entry events by helper;
3. cache hits, misses, and cache-key input volume;
4. helper-frame suspension and parent-restart edges;
5. terminal outcome, observer parity, and exact-floor round-trip; and
6. exact deltas from promotion to production and from production to floor.

## Implementation Option

[DECIDED] Reuse the M4.115 witness builder and the existing diagnostic observer
shape in a new M4.116 measurement owner. Freeze the three bounded observations
in a closed canonical receipt, bind every executable input by digest, and add a
single status handoff to M4.117.

Alternative runtime instrumentation is rejected because the existing observer
already exposes the deterministic mechanisms needed for first-order
attribution; changing runtime source would contaminate the baseline being
measured.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-116-runtime-bottleneck/spec.md` | add | claim-tagged contract and durable evidence |
| `scripts/kern-canonicalizer/runtime-bottleneck-m4-116-measure.mjs` | add | diagnostic-only bounded measurement |
| `scripts/kern-canonicalizer/runtime-bottleneck-m4-116.{mjs,json,test.mjs}` | add | immutable owner, receipt, and oracle |
| `scripts/kern-canonicalizer/runtime-bottleneck-m4-116-check.mjs` | add | exact central status assertion |
| `scripts/kern-canonicalizer/coverage-status.mjs` and test | edit | M4.116 status formatter |
| `scripts/check-kern-canonicalizer-coverage.mjs` | edit | append authenticated status |
| generated coverage summaries | regenerate | bind the changed coverage implementation |

## Acceptance Criteria

- [x] RED fails at the absent M4.116 owner boundary.
- [x] The exact M4.115 receipt, witness, budgets, and executable inputs remain
      immutable.
- [x] Measurements at 49,152 and 65,536 fail; 176,119 succeeds and
      byte-round-trips.
- [x] Observer-on and observer-off envelopes are deeply equal at all three
      boundaries.
- [x] The receipt freezes loop, helper, cache, suspension, and restart counters
      plus both boundary deltas.
- [x] The evidence identifies one dominant mechanism and one bounded M4.117
      optimization target without treating helper-entry events as completions.
- [x] The receipt rejects mutation, decoration, sharing, cycles, symlinks, and
      executable-input drift.
- [x] No KERN source, runtime, ABI, policy, profile, signature, generated-tool,
      or cumulative-coverage behavior changes.
- [x] Targeted tests, the complete Node 22 KERN 5 fitness wall, and mandatory
      high-risk independent review pass with no unresolved verified blocker.
- [ ] The signed commit is fetched/rebased before one atomic push to `main`,
      and local/remote hashes match.

## Implementation Evidence

[VERIFIED] RED failed at the absent
`scripts/kern-canonicalizer/runtime-bottleneck-m4-116.mjs` import boundary
before implementation.

[VERIFIED] Live observer-on/off measurements reproduce the frozen boundaries:

- 49,152: failure, 49,152 retained `for` iterations, zero rollback, zero
  parent restart, and zero `validstatementlist` or emission entries;
- 65,536: failure, 65,536 retained `for` iterations, zero rollback, zero
  parent restart, and zero `validstatementlist` or emission entries; and
- 176,119: success with byte-identical structural round-trip, 175,937 retained
  `for` plus 182 retained `while` iterations, zero rollback, and zero parent
  restart
  (`node --test scripts/kern-canonicalizer/runtime-bottleneck-m4-116.test.mjs`,
  5/5 pass, 2026-07-29).

[VERIFIED] `typefields` scans all 2,411 value rows on every execution
(`examples/kern-canonicalizer/canonicalizer.composed.kern:222-242`). The
successful boundary completes 59 scans, accounting for 142,249 iterations or
8,077 basis points of the exact floor. Promotion and production fail during
function-parameter type validation before any statement-validation helper
entry. The bounded mechanism is
`repeated-full-value-table-scans-during-function-parameter-type-validation`;
M4.117 receives `single-pass-authenticated-function-type-field-index`.

[DECIDED] Minimum-share basis points are floored so the published lower bound
cannot overstate guaranteed attribution; the exact-floor share is rounded to
the nearest basis point because all 59 scans complete.

[VERIFIED] Canonical receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-116.json` has SHA-256
`5342271907023c75b1c3b5acfd714860f6686d31a5a3bf60c37e7d8f73803056`.
It binds the exact M4.115 receipt, measurement owner, witness, composition,
policy, compiled core JavaScript, observer/runtime owners, and public runtime
handler.

[VERIFIED] Focused M4.116 and status tests pass 63/63. The central coverage
checker regenerates and reloads byte-identically with unchanged 101/111 base
completion and six `fn.params` blockers. Coverage summary SHA-256 is
`300d63b110d05ff8fae6bcf4f81e201ce76b905f36e3336ba3c03c0c8c5a0839`;
prerequisite summary SHA-256 is
`1c32d0ede2421433692f6f96085b4430e5c2ae734aed929614b01eff82bbd7b1`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed through the
final `KERN 5 current fitness wall passed` oracle. Mandatory high-risk
role-lens review `review-1785290496790-2gi5jd` completed 6/6 with zero verified
findings. Seven needs-check candidates were validated as deliberate
release-evidence or fail-closed behavior: live boundary replay, repeated
within-process input authentication, independent test ordering, raw-byte
receipt attestation, and an import-side-effect argv fixture. No production
change was required.

## Out of Scope

- Implementing the M4.117 optimization.
- Promoting 122/193/2411 or migrating `checkModule`.
- Raising runtime, KIR, or profile limits.
- Adding or changing public observer/runtime APIs.
- Solving the other five residual projection/canonical-surface blockers.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Stop Conditions

- Any M4.115 receipt, witness, source, policy, or runtime identity drifts.
- Observer-on and observer-off envelopes differ.
- A bounded observation does not terminate.
- The exact-floor result does not structurally round-trip.
- Existing observer events cannot separate the leading mechanisms.
- The diagnosis would require a runtime/source/policy/ABI/profile change.

## Open Questions

None block implementation. The dominant helper/phase is intentionally unknown
until measured and is excluded from the pre-measurement oracle.

## Deploy Order

This slice is repository-internal evidence with no version-skew contract. It
publishes atomically after the full local gate and independent review.

## Corrections Log

No corrected claims yet.
