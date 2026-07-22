# KERN 5 R2 M4.51 Property-Row Runtime Headroom

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.50 commit
`8600d8110986b0ddf7772611fc29af3245ee7c1c` selects exactly one current
residual function by raising only `maxPropertyRows` from 30 to 31. The selected
witness is
`examples/selfhost-validator/validator.kern#17:classcyclefrom`, with six
parameter rows and measured structural rows 19/31/202.

[DECIDED] M4.51 is proof-only. It freezes the exact M4.50 analysis, measures
the selected counterfactually migrated structural function through the
checked-in KERN canonicalizer, and publishes an authenticated exact runtime
floor. It changes no KERN source, generated consumer, active profile, parser,
runtime, KIR, ABI, package version, or public API. KERN 5 remains incomplete.

## Published Input

[VERIFIED] The fresh branch starts at exact `origin/main` commit
`8600d8110986b0ddf7772611fc29af3245ee7c1c`.

[VERIFIED] The canonical M4.50 receipt has SHA-256
`14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f`.
It binds:

- active profile 19/30/388;
- 64/104 base-complete functions and 39 residual functions;
- exact empty parameter-ready partition;
- residual assignment digest
  `d3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc`;
- selected candidate 19/31/388 with one function, one tool, total delta one;
- selected witness `classcyclefrom` at 19/31/202 with six parameters.

## Root Problem

[VERIFIED] M4.50 proves counterfactual profile completion, not runtime
feasibility. A row-ceiling promotion cannot be authorized until the exact
selected artifact executes below the precommitted promotion budget under the
unchanged production runtime.

[DECIDED] Use the same structural-KIR artifact, handler ABI, exact-floor
definition, and 49,152 budget established by M4.47. Do not infer the runtime
floor from row counts and do not widen any limit in this slice.

## Runtime Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| Runtime ABI | `kern.runtime.handler.v1` | VERIFIED |
| Production collection/iteration ceiling | 65,536 | VERIFIED |
| Promotion budget | 49,152, exactly 75% of production | DECIDED |
| Candidate profile arguments | 19/31/388 | VERIFIED |
| Artifact | counterfactually migrated single-function structural KIR | DECIDED |
| Success | return value, no diagnostics, no events | DECIDED |
| Exact floor | floor succeeds; floor minus one fails at the public handler boundary | DECIDED |
| Semantic identity | emitted source reparses to byte-identical structural KIR | DECIDED |
| Authority | proof only; no active profile promotion | DECIDED |

## Integrity Contract

[DECIDED] Convert the live M4.50 analyzer into an immutable published loader
before adding M4.51 implementation bytes. Bind its exact receipt digest,
source commit, format, canonical JSON bytes, plain-data shape, and regular
non-symlink storage. Preserve the M4.50 JSON byte-identically.

[DECIDED] The M4.51 receipt must bind:

- exact published M4.50 digest, source commit, selection, and witness id;
- structural codec, canonicalizer composite, composition, policy, and
  validator-source digests;
- runtime ABI, production ceiling, derived promotion budget, and unchanged KIR
  depth;
- six parameter rows and exact structural rows 19/31/202;
- measured exact floor, floor-minus-one failure, floor success, budget margins,
  and byte-identical roundtrip;
- explicit `structural-kir-function` scope and no module-envelope claim.

[DECIDED] Validation fails closed on historical drift, selection drift,
decorated data, source/hash drift, invented limits, incorrect arithmetic,
floor drift, diagnostic/event/completion drift, byte-roundtrip drift, or any
premature profile-promotion claim.

## Implementation Plan

1. Add the M4.51 receipt/performance tests first and capture RED at the missing
   M4.51 module boundary.
2. Freeze M4.50 as an immutable published handoff without changing its JSON.
3. Measure `classcyclefrom` as the same counterfactually migrated structural
   function used by coverage; discover the exact runtime floor by execution.
4. Add the canonical receipt builder/validator/writer and terminal status.
5. Regenerate only current live receipts after implementation bytes settle.
6. Run focused gates, full canonicalizer, complete Node 22 fitness, and
   high-risk independent role-lens review.
7. Create one Agon-signed commit, fetch/rebase, atomically no-verify push the
   fresh feature ref and authorized `main`, and verify both remote hashes.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.50 commit `8600d811`.
- [x] RED failed at the missing M4.51 module/receipt boundary.
- [x] M4.50 receipt remains byte-identical and loads only as published evidence.
- [x] Candidate and witness match exact published M4.50 evidence.
- [x] Exact runtime floor is measured rather than guessed.
- [x] Floor minus one fails and exact floor succeeds without diagnostics/events.
- [x] Exact floor is at or below the 49,152 promotion budget.
- [x] Emitted source reparses to byte-identical structural KIR.
- [x] M4.51 receipt authenticates exact source and arithmetic evidence.
- [x] No KERN source, generated consumer, active profile, parser, runtime, KIR,
      ABI, package version, or public API changes.
- [x] Focused, full canonicalizer, and complete Node 22 fitness gates pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Measured Evidence

[VERIFIED] The exact counterfactually migrated `classcyclefrom` artifact has
six parameter rows and structural rows 19/31/202. Binary search through the
public `kern.runtime.handler.v1` boundary established exact runtime floor
11,951: max steps 11,950 returns the expected `unsupported-runtime-input`
completion failure with no events and no result, while 11,951 returns the
expected value with no diagnostics or events. The emitted source reparses to
byte-identical structural KIR.

[VERIFIED] The floor leaves 37,201 steps below the 49,152 promotion budget and
53,585 below the unchanged 65,536 production ceiling. The authenticated M4.51
receipt has SHA-256
`c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe`.
The receipt builder/validator, runtime-floor oracle, and immutable M4.50 loader
authenticate at
`de5dff024f27c92df8d528a58a14895550b8f38fd6a72713791172667811d945`,
`1565b98f4f711e167c2de6209c5b0b7c026e66071732d918360dd544375a413a`,
and
`92e085a1b7050d5800143e1c11bf2560a01217b08c339bf23d45c961a3c047c4`.

[VERIFIED] Live coverage binds implementation digest
`0b40930cdb0f9224c492e389df7b421af4bd8f490b9dab5ba1652e75288570e0`,
policy digest
`3f72981ab56a3b7c6d27b675384349cd93b1a36b5d554dfcead57648794ad00e`,
function-facts digest
`8b2c88aac92ede8551155c55b870bc2245db042e7cc246946ee60eaa1285c35e`,
and corpus digest
`a918c5e489e4fa8046ad790a4502844b5b9fb0ed703d8c728e6ea4434d392092`.

[VERIFIED] Focused published-handoff, M4.51, and status tests pass 11/11;
the runtime performance contract passes 2/2; the standalone canonicalizer
passes 165/165 tests plus 51 golden/idempotence/KIR, eight measured, three
profile-limit, and 226 hostile fixtures; and the complete Node 22
`fitness:kern-5` wall passes.

[VERIFIED] The runtime oracle imports the built `packages/core/dist` parser,
structural codec, and handler artifacts. The complete fitness wall builds the
workspace before this oracle executes, so fresh source-derived output is the
external gate that prevents a stale `dist` measurement; the receipt separately
binds the canonical structural-codec source and runtime ABI.

[VERIFIED] High-risk automatic role-lens review
`review-1784756402233-2v34x8-kern-5-r2-m4-51` completed all 6/6 usable
independent reviewers with zero consensus-verified findings, zero needs-check
findings, and zero blockers. The sole speculative observation was the now
documented source-to-`dist` gate dependency. Remaining nits concern unreachable
pluralization under the exact one-witness digest, deliberate immutable-loader
patterns, or test-only refactoring outside this proof slice.

## Stop Conditions

- M4.50 receipt digest, source commit, selection, or witness identity differs.
- Structural rows differ from 19/31/202 or parameter rows differ from six.
- The exact floor exceeds 49,152 or floor minus one does not fail at the public
  handler runtime boundary.
- Roundtrip changes structural KIR bytes.
- Evidence requires changing profile, runtime, KIR, source, ABI, or public API.

## Decision

[DECIDED] The exact floor has sufficient structural runtime headroom. Subject
to independent review and publication of this handoff, M4.52 may raise only
`maxPropertyRows` from 30 to 31. It must preserve max node rows 19, max value
rows 388, runtime limits, KIR depth, source parameters, and the explicit lack
of a module-envelope claim. M4.52 must first convert M4.51 into an immutable
published loader in the same promotion change so the active-policy mutation
cannot invalidate this historical evidence gate.
