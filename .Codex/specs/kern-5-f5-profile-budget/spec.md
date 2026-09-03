# KERN 5: the F5 profile work-step budget

**Status:** READY TO BUILD
**Date:** 2026-09-03
**Base:** `ac1205cb` (`feat/kern-5-runtime-envelope-max-steps`, the envelope `maxIterations` slice)
**Confidence:** 0.88

## Executive Summary

`profileLimits.maxWorkSteps` in the private F5 projection policy is `33,554,432`. Thirteen
repository compositions of ordinary size (16k-30k source scalars) need `34,810,075` to
`94,490,193` charged steps to finish projecting, so they terminate as `F5_LIMIT` instead of
producing an artifact. The predecessor slice
(`.Codex/specs/kern-5-f5-iteration-budget/spec.md`) measured the crossing points; the
envelope slice (`.Codex/specs/kern-5-runtime-envelope-max-steps/spec.md`) added
`runtimeLimits.maxIterations` so a step budget can be raised without also widening a
collection ceiling. This slice spends that headroom: `maxWorkSteps` and `maxIterations` both
move to `100,663,296` (3x the base cap, the smallest tested multiple that admits all twelve
measured completions).

This admits **nothing** end-to-end. `scheduler.timeoutMs` stays at `120,000` and the
generated projection adapter SIGKILLs the projection child at that deadline, while every one
of the thirteen files needs 263-787 s of compute to reach a terminal result. The slice makes
the step budget *sufficient and legible* — it removes a policy number as the reason those
files fail — and hands the remaining wall-clock problem to the F5 composition performance
milestone. Expected census ratchet delta: zero, by construction.

## Current State / Root Cause

- **VERIFIED:** `scripts/kern-frontend-f5-projection/policy.json:36` sets
  `profileLimits.maxWorkSteps` to `33554432`; `:60` sets `runtimeLimits.maxIterations` to the
  same value.
- **VERIFIED:** the worker passes `profileLimits.maxWorkSteps` as handler argument 7 and
  `runtimeLimits` to the enclosing runtime handler —
  `scripts/kern-frontend-f5-projection/worker.mjs:73,87`.
- **VERIFIED:** the budget is enforced inside KERN. `f5resultgate` compares the accumulated
  `work` against `f5uint(limitValues[1])` and returns
  `f5resultfailure("1", "F5_LIMIT", work)` on any crossing —
  `examples/kern-frontend/f5-result-frame.kern:31-32`.
- **VERIFIED:** `validatePolicy` already ties the two tiers with
  `policy.profileLimits.maxWorkSteps > policy.runtimeLimits.maxIterations` → `limit
  relationship` — `scripts/kern-frontend-f5-projection/policy-validation.mjs:88`.
- **VERIFIED:** 13 of the 32 measured files terminate `fatal:F5_LIMIT` at the base cap
  (first-crossing 34,810,075-77,155,391), and 12 of those 13 reach `projected` once the cap is
  lifted, at 34,810,075-94,490,193 steps, max `examples/selfhost-validator/validator.kern`
  at 94,490,193 = 2.816x the base cap —
  `.agon-goals/f5-measure/{summary,results,summary-budget,results-budget}.json` in the
  `kern-5-f5-iteration-budget` worktree (gitignored measurement record).
- **VERIFIED:** the 13th file, `examples/kern-frontend/f4-declarations-helpers.kern`,
  completes projection under a raised budget and then throws `CanonicalValueDecodeError`
  `limit-depth` from `encodeCanonicalValue` at
  `scripts/kern-frontend-f5-projection/worker.mjs:118`. That is a canonical-depth ceiling,
  not a work ceiling, and belongs to the `f5-canonical-depth` successor.

Root cause: one policy scalar set two milestones below what the composition actually costs.

## [F5B-R1 DECIDED] The value is 100,663,296, and equality with `maxIterations` is a choice

`100,663,296 = 3 x 33,554,432 = 96 x 2^20`.

- **VERIFIED:** three of the twelve exceed 2x (67,108,864) —
  `selfhost-validator/validator.kern` 94,490,193 (2.816x),
  `generic-property-style-theme-replay.kern` 69,490,792 (2.071x),
  `f4-module-set-closure.kern` 68,343,156 (2.037x) — and none exceeds 3x
  (`summary-budget.json` `fittingWithin: {"2x": 9, "3x": 12, "4x": 12}`).
- The exact observed maximum is `94,490,193`. 3x is the smallest *stated* multiple of the base
  cap that covers it with 6.5% headroom; the alternatives are a bare `95,420,416`
  (next mebi-multiple, 1.0% headroom — too tight for a composition that grows every slice) and
  `134,217,728` (4x, 42% headroom over a wall nothing can reach anyway).

The validator requires only `maxWorkSteps <= maxIterations`. **Equality is not required.** It
is nevertheless what this slice ships, for one reason: the envelope budget exists to stop
runaway iteration, and F5's own work meter is the tighter, better-diagnosed of the two
(`F5_LIMIT` with a step count, versus `unsupported-runtime-input`). Setting them equal means
F5 always reports the crossing itself and the envelope never gets there first. A deliberate
slack (`maxIterations > maxWorkSteps`) would be equally valid and is left to a future slice
that has a reason for it. The oracle asserts both `<=` directions and that equality is
un-enforced (leg B2), so nothing later has to re-litigate this.

## [F5B-R2 DECIDED] The amendment gate does **not** apply

The F5/closure amendment protocol introduced by RT-8 governs **composition digests only**.

- **VERIFIED:** `scripts/kern-frontend-closure/amend-record.mjs:1` —
  `export const PINS = { 'scripts/kern-frontend-f5-projection/policy.json': 'composition' }`.
  The mapped section is `composition`; `amend.mjs` `plan()` iterates
  `load(pin)[section]`, i.e. `policy.composition[*]`, and nothing else
  (`scripts/kern-frontend-closure/amend.mjs:34,49-70`).
- **VERIFIED:** `policy.json` is the *pin container*, not a pinned path. It appears in no
  `composition`, `mappingAuthorities`, or `f4Policy` descriptor, and its own digest
  (`1ec6cbe20b5f6284060911f5f871c94e078babfb8829de43f7b0060de79f336d` at base) is referenced
  by no tracked file — `rg` over the tree excluding `node_modules` and `dist`, 2026-09-03,
  zero hits.
- **VERIFIED:** the `runtime-contract-v1` chain does not apply either. Its authority pins
  `constitution.json`, `proof-inventory.json`, `public-declaration-schema.json`,
  `goldens.json` and `lineage.json` (`scripts/runtime-contract-v1/authority.json`); none
  contains a work-step or iteration *value* (`grep 33554432 scripts/runtime-contract-v1/` →
  zero hits, 2026-09-03; `goldens.json:9` carries `maxIterations: 64`, a test fixture).

So: **no amendment record, no `amend.mjs --write`, no chain edge.** The composition `.kern`
sources are untouched, every `composition[i].sha256` still matches its live source, and
`plan()` returns zero pending re-pins before and after the change. Leg B5 asserts all of
this as a *negative* gate, so a future slice cannot quietly widen `PINS` to cover limits
without the oracle noticing.

## [F5B-R3 DECIDED] The extra digit costs zero charged steps

The predecessor spec recorded a caveat that `String(maxWorkSteps)` gaining a digit "shifts the
encoded frame length and therefore step counts by a few steps". **That is wrong.** Corrected:

- `examples/kern-frontend/f5-projection-main.kern:130` builds `constructorLimits` from
  `f5frame("i", String(maxWorkSteps))` and five siblings;
  `f5frame` returns `tag + String(Text.length(value)) + ":" + value`
  (`examples/kern-frontend/f5-canonical-instructions.kern:10-14`), so the string does grow by
  one character (`i8:33554432` → `i9:100663296`).
- **VERIFIED:** that string is charged nowhere on a live path. `limits` is forwarded verbatim
  through `f5projecttree` / `f5projectmodules` / `f5expression` into `f5resultgate`, and the
  only `Text.length(limits)` in the whole composition is on the `limitValues.length != 6`
  drift branch — `examples/kern-frontend/f5-result-frame.kern:22-24`. The success formula at
  `:25-26` charges `instructionScalars`, `nodes`, `depth`, `maxCollection`, `maxString` and
  `textLength`, never `limits`. `grep -rn 'Text.length(limits)' examples/kern-frontend/f5-*.kern`
  → one hit, the drift branch, 2026-09-03.
- **VERIFIED empirically:** `runProjectionWithProfileLimits` on
  `fn name=limit export=true` charges `16,287` steps at `maxWorkSteps` of 8, 9 **and** 10
  digits (33,554,432 / 100,663,296 / 1,073,741,824). Oracle leg B3 pins this.

Three consequences:

1. `scripts/kern-frontend-f5-projection/review-constructor-metrics.test.mjs:277`
   (`assert.equal(result.receipt.workSteps, 14467)`) — the only hard-coded work-step golden in
   the tree — does not move.
2. Measurement 2's step counts were taken at a 9-digit cap (`134,217,728`) and therefore apply
   verbatim at `100,663,296`. The derivation needs no re-measurement.
3. No canonical artifact byte changes: `work` is the only limits-derived quantity that reaches
   a result frame, and it is invariant.

## [F5B-R4 DECIDED] Zero census ratchet, and CI cannot go red

The 120 s wall makes this a policy-legibility change with no observable public effect on any
repository file.

- **VERIFIED:** the generated adapter's per-invocation deadline *is* the F5 scheduler timeout:
  `limits.ipc.timeoutMs = f5.scheduler.timeoutMs`
  (`scripts/build-kern-frontend-projection-assets.mjs:115`), enforced by
  `setTimeout(..., limits.ipc.timeoutMs)` at `:208` → `child.kill('SIGKILL')` at `:218`.
- **VERIFIED:** only 2 of the 32 measured files finish projection under 120 s at the base cap
  (`summary.json` `finishingUnder: {"120000": 2}`), and every one of the 13 `F5_LIMIT` files
  takes 263,444-589,265 ms (`.agon-goals/f5-measure/run.log`). All thirteen are already
  SIGKILLed by the adapter today, before their `F5_LIMIT` frame commits. Raising the cap makes
  them run *further* inside the same 120 s and be killed at the same place, producing the same
  public `projection-fatal`.
- **VERIFIED:** a raised budget cannot manufacture a census infrastructure failure. The census
  probe timeout is `DEFAULT_TIMEOUT_MS = 300_000`
  (`scripts/kern-5-admission-census/sweep.mjs:8`) and only a probe exceeding it yields
  `stage: 'timeout'`, which `validateReport` turns into a hard error
  (`scripts/ci/kern-5-census-sweep.mjs:29-30`). The projection stage is bounded at 120 s by
  the adapter, i.e. 2.5x under the harness timeout. Leg B4 asserts the inequality rather than
  the folklore.
- **VERIFIED:** `admitted.json` holds one row,
  `examples/kern-5-preview-app/ui.kern`, whose whole admission takes 5.4 s
  (`scripts/kern-5-admission-census/admission.json`). Its charged work is orders of magnitude
  below either cap. A raised *ceiling* is monotone — it can only turn an `F5_LIMIT` fatal into
  something else, never the reverse — so `admitted.json` can only grow, and cannot here.

**Finding (OPEN, recorded not resolved):** the committed
`scripts/kern-5-admission-census/admission.json` is stale relative to this base. It was
written at `00883c46`, records `timeoutMs: 300000` and 8 `projection-fatal` rows, and codes
**all 32** measured files as `projection`/`UNEXPECTED_TOKEN` — a pre-F5 lexical rejection,
disjoint from the 8. The measurement rows carry `quotingIterations: 2` and
`schedulerTimeoutMsUsed: 2147483647`, so the deleted measurement harness both lifted the
scheduler deadline and applied a source transform; whether the 32 reach F5 from their
*repository* bytes at this base is unverified. This does not move the chosen value (the step
counts are real measurements of real compositions of the right size) and it does not weaken
[F5B-R4] (neither branch yields an admission), but it means **no fixture in this slice may
assert a census row code**, and the refresh belongs to whoever owns the census sweep. Leg B4
pins `admission.json` byte-identical precisely so this slice does not silently adopt it.

## What Already Works

- The relationship clause, the seven-key `runtimeLimits` shape, and positive-safe-integer
  validation all landed with the envelope slice
  (`scripts/kern-frontend-f5-projection/policy-validation.mjs:34-43,63-89`). No validator
  change is needed — a scalar move is already inside the contract.
- `loadPinned()` authenticates the F4 policy, mapping authorities and composition sources
  from the policy's own descriptors (`policy-validation.mjs:92-100`); a limits change
  re-pins none of them.
- The asset builder is the single regenerator. It hashes `policy.json` into
  `assets.json` as `f5PolicyDigest` and copies `profileLimits` into the manifest
  (`scripts/build-kern-frontend-projection-assets.mjs:313-321`), and
  `loadProjectionAssetState()` re-verifies every asset digest on load
  (`packages/core/src/frontend-projection/assets.ts:141-148`). A stale build fails closed at
  `packages/core/src/frontend-projection.ts:197`, where the receipt's `policySha256` is
  compared to the manifest digest — so the rebuild is self-enforcing, not a checklist item.
- `scripts/kern-frontend-closure/validate.mjs` never reads the F5 policy
  (`grep -n 'f5\|policy'` → zero hits, 2026-09-03), and the closure static goldens pin type
  lowerings, not work counts. Nothing in `scripts/kern-frontend-closure/` re-pins.
- The `scripts/kern-canonicalizer/*` receipts' `policySha256` fields pin the **canonicalizer**
  policy, reconstructed by `scripts/kern-canonicalizer/historical-policy.mjs`, not the F5
  policy (`grep -c maxWorkSteps scripts/kern-canonicalizer/policy.mjs` → 0). No re-pin.
- `packages/core/src` carries no work-step value, only the key name
  (`packages/core/src/frontend-projection/contracts.ts:6`). No `src` edit is in scope.

## Contract (Verified)

> Verified against the files and commands cited, in
> `/Users/nicolascukas/KERN/.worktrees/kern-5-f5-profile-budget` at `ac1205cb`, on 2026-09-03.

| Field / Behavior | Base → Target | Evidence | Tag |
|---|---|---|---|
| `profileLimits.maxWorkSteps` | `33554432` → `100663296` | `policy.json:36` | VERIFIED |
| `runtimeLimits.maxIterations` | `33554432` → `100663296` | `policy.json:60` | VERIFIED |
| `runtimeLimits.maxCollectionLength` | `1048576`, untouched | `policy.json:56` | VERIFIED |
| `profileLimits.maxCollectionLength` | `262144`, untouched | `policy.json:39` | VERIFIED |
| `canonicalLimits.maxCollectionLength` | `262144`, untouched | `policy.json:44` | VERIFIED |
| `scheduler.timeoutMs` | `120000`, untouched (ruled) | `policy.json:63` | VERIFIED |
| `maxWorkSteps <= maxIterations` | enforced, equality optional | `policy-validation.mjs:88` | VERIFIED |
| Public budget ceiling | caller `budgets.maxWorkSteps` capped at the manifest value | `frontend-projection/contracts.ts:244-248` | VERIFIED |
| Charged steps vs. cap digits | invariant | `f5-result-frame.kern:22-26`; probe = 16,287 at 8/9/10 digits | VERIFIED |
| Amendment gate scope | `policy.composition[*].sha256` only | `amend-record.mjs:1`; `amend.mjs:34,49-70` | VERIFIED |

### Everything the change must re-pin

| Pin | Owner | Action |
|---|---|---|
| `scripts/kern-frontend-f5-projection/policy.json` | hand edit | the two scalars |
| `packages/core/dist/frontend-projection-assets/scripts/.../policy.json` | asset builder | copied bytes (gitignored) |
| `packages/core/dist/frontend-projection-assets/assets.json` | asset builder | that asset's `sha256`, `f5PolicyDigest`, `profileLimits.maxWorkSteps` (gitignored) |
| `scripts/kern-5-runtime-envelope-max-steps/f5-policy.test.mjs:10` | hand edit | `F5_WORK_STEPS = 33_554_432` → `100_663_296` (its L4 test asserts equality against this constant) |
| `package.json` | hand edit | `test:kern-5-f5-profile-budget`, appended to `test:kern-5-script-family` |
| `scripts/ci/test-tier-contract.test.mjs:63` | hand edit | `kern5EvidenceCommands` gains the new lane |

### Everything that pins nothing and must not move

`scripts/kern-frontend-closure/**` (no amendment record, no `--write`, no golden);
`scripts/kern-frontend-f5-projection/review-constructor-metrics.test.mjs:277` (14,467 stands,
per [F5B-R3]); `scripts/kern-canonicalizer/**` receipts; `scripts/runtime-contract-v1/**`;
`scripts/kern-5-admission-census/{admitted,admission}.json`; `packages/core/src/**`;
`examples/kern-frontend/*.kern`; `scripts/kern-frontend-f5-projection/policy-validation.mjs`.

## Implementation Plan

One option. Two scalars and one re-pinned test constant; the alternatives (a bare
`95,420,416`, or 4x) are argued in [F5B-R1] and differ only in the number.

1. `scripts/kern-frontend-f5-projection/policy.json`: `profileLimits.maxWorkSteps` and
   `runtimeLimits.maxIterations` → `100663296`.
2. `scripts/kern-5-runtime-envelope-max-steps/f5-policy.test.mjs:10`: `F5_WORK_STEPS` →
   `100_663_296`.
3. Rebuild `@kernlang/core` and `node ./scripts/build-kern-frontend-projection-assets.mjs`.
4. `pnpm test:kern-5-f5-profile-budget`, then
   `pnpm test:kern-frontend-f5-projection`, `pnpm test:kern-frontend-closure`,
   `pnpm test:kern-5-runtime-envelope-max-steps`, `node --test scripts/ci/test-tier-contract.test.mjs`.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-f5-profile-budget/spec.md` | Add | This document |
| `scripts/kern-5-f5-profile-budget/**` | Add | RED oracle, 5 legs |
| `package.json` | Modify | Root script + evidence-family aggregate |
| `scripts/ci/test-tier-contract.test.mjs` | Modify | `kern5EvidenceCommands` |
| `scripts/kern-frontend-f5-projection/policy.json` | Modify | The two scalars |
| `scripts/kern-5-runtime-envelope-max-steps/f5-policy.test.mjs` | Re-pin | `F5_WORK_STEPS` |
| `packages/core/dist/frontend-projection-assets/**` | Rebuild | Never hand-edited |

## Acceptance Criteria

Each row is one oracle leg. Every claim behind them is VERIFIED above; the census-staleness
OPEN in [F5B-R4] feeds no fixture — leg B4 asserts byte-identity of the recorded artefacts,
never a row code.

- [ ] **B1 policy values.** `profileLimits.maxWorkSteps == runtimeLimits.maxIterations ==
      100,663,296 == 3 x 33,554,432 == 96 x 2^20`; exactly those two keys differ from the
      base-`ac1205cb` snapshot of all three limits sections; no collection ceiling moves
      (1,048,576 / 262,144 / 262,144); `scheduler.timeoutMs` is still 120,000 with `timeoutMs`
      its only key; no section gained or lost a key.
- [ ] **B2 validator relationship.** `validatePolicy` accepts the shipped policy; refuses
      `maxIterations = maxWorkSteps - 1` **and** `maxWorkSteps = maxIterations + 1` with
      `F5 projection policy: limit relationship`; accepts `maxIterations` both equal to and one
      above `maxWorkSteps`, proving equality is un-enforced; refuses `0`, `-1`, `1.5` and
      `MAX_SAFE_INTEGER + 1` at both tiers; the depth and instruction-scalar relationships
      still hold; and `f5-policy.test.mjs` no longer carries `33_554_432`.
- [ ] **B3 fast boundary probe.** Charged work steps for one small module are identical at
      `maxWorkSteps` of 8, 9 and 10 digits ([F5B-R3]); the `F5_LIMIT` gate still admits exactly
      the baseline count and refuses one under; the packaged manifest carries
      `profileLimits.maxWorkSteps = 100,663,296` and an `f5PolicyDigest` equal to the live
      policy bytes; and the **public** `projectKernModules` accepts
      `budgets.maxWorkSteps = 100,663,296` while refusing one over the shipped ceiling with
      `projection-request-invalid`. **No 32-file replay** (p50 222 s) and no >33.5M-step run.
- [ ] **B4 ratchet and census invariance.** `admitted.json` is byte-identical to base
      (`056556a9…`) and still holds exactly `examples/kern-5-preview-app/ui.kern`;
      `admission.json` is byte-identical to base (`3d139be0…`); and the generated adapter's
      `limits.ipc.timeoutMs` equals `scheduler.timeoutMs` equals 120,000, at least 2x under the
      census probe timeout of 300,000 — so no raised budget can produce a `stage: 'timeout'`
      row. **No sweep is run.**
- [ ] **B5 amendment gate, negative.** `PINS` maps the F5 policy to `composition` and nothing
      else, and the policy is not itself a governed path; every `composition[i].sha256` matches
      its live source; `amend.mjs` `plan()` returns zero pending re-pins; and neither
      `scripts/kern-frontend-closure/amendments/` nor
      `scripts/runtime-contract-v1/amendments/` gains a record, with `lineage.json` still at
      one version.
- [ ] `pnpm test:kern-frontend-f5-projection`, `pnpm test:kern-frontend-closure`,
      `pnpm test:kern-5-runtime-envelope-max-steps` and
      `node --test scripts/ci/test-tier-contract.test.mjs` pass.
- [ ] `pnpm test:kern-5-f5-profile-budget` is in `test:kern-5-script-family` exactly once, last,
      and in `kern5EvidenceCommands`.

## Oracle

`scripts/kern-5-f5-profile-budget/`, root script `test:kern-5-f5-profile-budget`, modelled on
`test:kern-5-rt8-integer-signatures` minus the `amend.mjs` step this slice must not need
([F5B-R2]) and plus the asset rebuild the manifest fixtures require. Builds
`@kernlang/core`, rebuilds the projection assets, then runs the five legs in order.

**26 tests: 7 RED, 19 GREEN at base `ac1205cb`.** Every RED has the single cause
`maxWorkSteps`/`maxIterations` is `33,554,432`, not `100,663,296`.

| Leg | File | Tests | RED | GREEN |
|---|---|---|---|---|
| B1 policy values | `policy-values.test.mjs` | 7 | 4 | 3 |
| B2 validator relationship | `policy-relationship.test.mjs` | 6 | 1 | 5 |
| B3 fast boundary probe | `work-budget-boundary.test.mjs` | 4 | 2 | 2 |
| B4 ratchet and census | `ratchet.test.mjs` | 4 | 0 | 4 |
| B5 amendment gate | `amendment-gate.test.mjs` | 5 | 0 | 5 |

The 14 GREEN-at-base rows in B2/B4/B5 are deliberate: they are the guards that the change does
**not** widen a collection ceiling, raise the scheduler timeout, move the ratchet, or drag the
amendment protocol into a limits edit. A slice whose whole risk is over-reach needs its
non-effects asserted, not just its effect.

Full run at base, `node --test scripts/kern-5-f5-profile-budget/*.test.mjs`: `# tests 26`,
`# pass 19`, `# fail 7`.

## Out of Scope

- `packages/core/src/**` and `examples/kern-frontend/**` — no source or composition edit.
- `scheduler.timeoutMs` — stays 120,000 (ruled DECIDED in the predecessor spec).
- `canonicalLimits.maxDepth` / `profileLimits.maxDepth` and the unclassified
  `encodeCanonicalValue` throw — owned by `f5-canonical-depth`.
- Re-running or refreshing `scripts/kern-5-admission-census/admission.json`.
- Making any repository file admissible end-to-end.
- Any amendment record, in either chain.

## Open Questions

- **OPEN — census provenance.** The recorded census codes all 32 measured files
  `UNEXPECTED_TOKEN`, disjoint from its own 8 `projection-fatal` rows, while the measurement
  drove them to `F5_LIMIT` with `quotingIterations: 2` and the scheduler deadline lifted. The
  harness is deleted. Detail and containment in [F5B-R4]; it feeds no fixture and caps
  confidence at 0.88.
- **OPEN — no end-to-end proof of the moved boundary.** No fixture runs a composition that
  actually charges more than 33,554,432 steps, because none can finish inside the adapter's
  120 s SIGKILL (the cheapest measured crossing is 263 s of compute). Leg B3 proves the
  transport — the shipped value is what the gate and the public ceiling enforce — and
  substitutes the manifest digest for the run, as the slice brief permits. Resolving this is
  the F5 composition performance milestone's job, not a fixture this slice can buy.
- **Accepted risk — longer synchronous CPU per request (MS-R10).** Raising the manifest
  ceiling 3x raises the maximum work a *public* caller may request: `normalizeProjectionRequest`
  caps `budgets.maxWorkSteps` at the manifest value and rejects anything above it
  (`packages/core/src/frontend-projection/contracts.ts:244-248`). The bound is unchanged: the
  generated adapter SIGKILLs the projection child at `scheduler.timeoutMs` = 120,000 ms
  (`scripts/build-kern-frontend-projection-assets.mjs:115,208,218`), so the worst case is
  still 120 s of child CPU, now more often spent than short-circuited by `F5_LIMIT`. Accepted:
  the deadline is the real quota and it does not move.

## Queued successors

1. **f5-canonical-depth** — two mandatory halves for
   `examples/kern-frontend/f4-declarations-helpers.kern`: classify the
   `encodeCanonicalValue` throw at `worker.mjs:118` as an F5 diagnostic, and raise
   `canonicalLimits.maxDepth` / `profileLimits.maxDepth` from 256 toward the 512
   `runtimeLimits.maxDepth` ceiling, respecting
   `canonical.maxDepth <= profile.maxDepth <= runtime.maxDepth`.
2. **F5 composition performance milestone** — target p95 projection wall time under 120 s at
   production concurrency, so a raised work budget becomes reachable. This is the slice that
   turns [F5B-R4]'s "zero ratchet by construction" into a real admission.
3. **Census refresh** — regenerate `admission.json` at a known base and settle the
   [F5B-R4] OPEN. Owned by the census sweep, not by a policy slice.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Raising `maxWorkSteps` "shifts F5 charged work by a handful of steps" via `String(maxWorkSteps)` in `constructorLimits` | The limits string is charged only on the `limitValues.length != 6` drift branch (`f5-result-frame.kern:22-24`); charged work is 16,287 at 8, 9 and 10 digits | Measurement 2's counts apply verbatim at the new cap; the 14,467 golden and all canonical bytes are untouched; [F5B-R3] |
| The 13 `F5_LIMIT` files "still time out at 120 s" so census rows do not change | They do not change, but for a stronger reason and a different one for the recorded artefact: all 13 are already SIGKILLed at 120 s today (263-589 s of compute needed), and the committed census codes them `UNEXPECTED_TOKEN` — it is stale, not merely unchanged | The zero-ratchet argument rests on the adapter deadline and ratchet monotonicity, not on a census row; [F5B-R4] |
| A policy limit change may be amendment-gated and might need an amendment record | `PINS` maps the F5 policy to its `composition` section alone, and the policy is not a pinned path in any chain | No amendment record; leg B5 asserts the gate's scope as a negative fixture |
| The census timeout is 120,000 ms | `scheduler.timeoutMs` is 120,000 (the F5 adapter deadline); the census probe timeout is `DEFAULT_TIMEOUT_MS = 300_000` (`sweep.mjs:8`) | The 2.5x margin is what proves CI cannot produce a `stage: 'timeout'` row; leg B4 asserts it |
| `profileLimits.maxCollectionLength` is 1,048,576 and must stay untouched | 1,048,576 is `runtimeLimits.maxCollectionLength`; the profile and canonical ceilings are 262,144 | Leg B1 pins all three at their real values |
| 32 census files hit `F5_LIMIT` at the base cap | 32 files were replayed; 13 hit `F5_LIMIT` and 19 projected (`summary.json` `outcomeHistogram`) | The budget derivation rests on the 13, and on the 12 of them that complete |
