# KERN 5 R2 M4.30 — Frozen Unary Parameter Migration

**Status:** READY TO PUBLISH — FULL WALL AND REVIEW PASSED
**Date:** 2026-07-21
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.29 commit
`1aa9764de4368ebe4be33bf6a645d63befe42828` promotes the exact portable unary
family and records one base-only parameter-ready witness:
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#9:numberat`.
The authenticated migration row contains one function, one tool, and two
ordered parameters with counterfactual profile rows 8 nodes, 14 properties,
and 66 values.

[DECIDED] M4.30 applies exactly that frozen singleton cohort to checked-in KERN
source. It removes only `numberat`'s legacy `fn.params` property, prepends the
equivalent ordered direct `param` children, regenerates the canonicalizer
composition and coverage receipts, and leaves the cumulative profile,
capability registry, runtime, and immutable provenance records unchanged.

## Published Input

[VERIFIED] The exact M4.29 source boundary is:

- profile `kern.kir-canonicalizer.profile.m4.29`;
- 32/104 base-complete functions;
- 70 legacy `fn.params` blockers;
- `numberat` as the only base-ready migration witness;
- parameters `id:number` then `values:number[]`;
- two migrated parameter rows and profile rows 8/14/66;
- 69 residual functions under bounded exhaustion of all seven non-empty
  closures of do, exception, and while.

[VERIFIED] M4.29 policy, coverage-summary, and prerequisite-summary SHA-256
values are
`d2bee244fce9cfeae7c3fe327bcdbc694bac1b631c910d7a459dd3a79a4de636`,
`8c31aeb81b5523899eb66ac771e783fadb28f8a2102c5a6d0eb4632008b5c082`,
and `d1d44548a3d332489ce17ac55ca69bd89e196d48373f03f58416ca7617948821`.
The exact expression-helper source is 174 lines at
`3b5c6affbb2232c5bd0cfcf2d73fdb2141b22ca50e074ff750f926798620d417`.

## Root Cause

[VERIFIED] `numberat`'s body already uses only M4.29-promoted structure and
expressions, including its portable unary `-1` return. Its sole live blocker
is the excluded legacy parameter representation.

[VERIFIED] Ordered direct `param` children are the admitted representation.
The parser and runtime already reject mixed legacy/direct forms, so this is a
source representation migration, not a grammar, KIR, evaluator, ABI, or
capability change.

## Migration Contract

| Behavior | Contract | Tag |
|---|---|---|
| Scope | exact singleton `#9:numberat` from M4.29 receipt | VERIFIED |
| Header | remove only `params="id:number,values:number[]"` | DECIDED |
| Parameters | prepend `id:number`, then `values:number[]` | DECIDED |
| Body | preserve handler and every body/call byte | DECIDED |
| Root order | preserve all function ordinals and siblings | DECIDED |
| Profile | remain `kern.kir-canonicalizer.profile.m4.29` | DECIDED |
| Active families | remain do, exception, while in exact order | DECIDED |
| Provenance | preserve every historical record byte-for-byte | DECIDED |
| Generated output | regenerate composition through repository writer | DECIDED |
| Measurement | regenerate from live facts; never hardcode a next family | DECIDED |

## Expected Measurement

[INFERRED] Exact migration should move live base completion from 32/104 to
33/104 and legacy blockers from 70 to 69. The base-only `parameterMigration`
partition should become empty because its complete frozen cohort has been
consumed.

[INFERRED] The same 69 residual functions should remain bounded-exhausted over
the same three active families and seven non-empty closures. Their reason
census and assignment digest should remain stable because `numberat` was
already excluded from the residual partition. These are predictions only;
final counts and digests must come from regenerated authenticated receipts.

## Generated Consumers

[VERIFIED] The expression-helper edit changes the ordered member composition,
so `scripts/kern-canonicalizer/composition.mjs --write` must regenerate
`canonicalizer.composed.kern` and `composition.json`.

[VERIFIED] `canonicalizer.kern` is a separate unchanged handwritten member and
must remain exactly 23,666 bytes at SHA-256
`5472494a26004621d1ac76b0571432462c74da88563e4e3fca9ca7a2394a42e2`.
No checker or validator generated consumer changes because this slice touches
only the canonicalizer expression-helper member.

## RED and Mutation Plan

[DECIDED] Extend `assertStructuredParameterMigrations` before editing source to
require `numberat` in the exact migrated target list, 176 expression-helper
lines, ordered direct parameter children, ten remaining legacy siblings,
eleven total migrated parameter nodes in the helper target cohort, no
`fn.params` exclusion, and exact live profile rows 8/14/66.

[DECIDED] Update live coverage/prerequisite pins only after the source RED is
observed. Mutations must continue rejecting mixed parameters, reordered or
mistyped direct parameters, source ordinal drift, profile widening, receipt
fabrication, and provenance changes.

## Implementation Plan

1. Add RED exact-source assertions for the frozen singleton and capture the
   unchanged M4.29 failure.
2. Rewrite only `numberat`'s parameter representation.
3. Regenerate canonicalizer composition using the repository writer and prove
   the main member remains byte-identical.
4. Update the one changed corpus digest and regenerate authenticated coverage
   and prerequisite summaries.
5. Pin the measured 33/104 boundary, empty migration queue, bounded residual
   outcome, generated hashes, spec evidence, and release-train evidence.
6. Run focused canonicalizer checks, the complete Node 22 KERN 5 wall, and the
   mandatory usable-roster review; fix every verified material finding.
7. Commit with Agon identity, fetch/rebase onto `origin/main`, atomically push
   the fresh feature ref and explicitly authorized main once with
   `--no-verify`, verify both refs, and start M4.31 from fresh `origin/main`.

## File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared migration contract |
| expression-helper KERN | modify | singleton signature migration |
| canonicalizer composite/record | regenerate | exact member-byte change |
| parameter migration assertions | modify | RED source/profile boundary |
| coverage policy | modify | changed corpus member digest |
| coverage/prerequisite summaries | regenerate | authenticated live boundary |
| coverage/prerequisite/handoff tests | modify as measured | exact M4.30 facts |
| terminal coverage check | modify | release-fact pins/status |
| release train | modify | durable M4.30 evidence |

## Acceptance Criteria

- [x] Fresh M4.30 branch starts at published M4.29 `origin/main` commit
      `1aa9764de4368ebe4be33bf6a645d63befe42828`.
- [x] Exact singleton/two-row source and receipt input is grounded.
- [x] RED fails against unchanged M4.29 at the intended `numberat` boundary.
- [x] Only `numberat` loses `fn.params` and gains two ordered direct params.
- [x] Expression helper becomes 176 lines and reproduces profile rows 8/14/66.
- [x] Canonicalizer main and all non-target handwritten corpus members remain
      exact; only the expression-helper corpus digest changes.
- [x] Generated composition and receipt files reproduce through writers.
- [x] Live measurement is derived and pinned without inventing a prerequisite.
- [x] Focused canonicalizer gate and complete `pnpm fitness:kern-5` wall pass.
- [x] Full usable-roster review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      fresh feature ref and authorized main; both remote hashes verify.

## Stop Conditions

- Migration requires any semantic body or call-site change.
- Any non-target handwritten source must change.
- Parser, KIR, runtime, ABI, profile, family registry, or historical
  provenance must change.
- `numberat` does not reproduce frozen 8/14/66 rows or become base-complete.
- Post-migration partitioning invents a ready function or loses a residual.
- Generated composition cannot be reproduced by its repository writer.

## Out of Scope

- Migrating any function other than `numberat`.
- Implementing or promoting do, exception, or while capability.
- Changing unary semantics, operators, negative-zero behavior, or KIR shape.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Open Questions

None. Post-migration hashes and exact receipt digests are measured outputs, not
design choices.

## Current Evidence

[VERIFIED] The source-shape RED fails on sealed M4.29 at the exact intended
boundary: expression-helper line count 174 does not equal required M4.30 count
176. The other 17 coverage subtests pass, isolating the failure to the frozen
`numberat` migration contract.

[VERIFIED] The implementation diff changes only `numberat`'s header and two
ordered direct parameter children in handwritten source. Expression helpers
are 176 lines at SHA-256
`55c8a6e54bc4442ee91af43eb7fc4fb0c2fad325d48477710bbbcce7e138ba91`.
Canonicalizer main remains
`5472494a26004621d1ac76b0571432462c74da88563e4e3fca9ca7a2394a42e2`
and statement helpers remain
`cc4e9aaafc55269e1278d354776c67924737d32e1824413708cb01a6ac2f4f62`.

[VERIFIED] The repository writer regenerates a 40,441-byte composite at
`bf2b2c1f1e8fa85174d72503d836b3a305467af20c560a6e9f037ac616b97bb5`
and composition-record SHA-256
`94c997891d71e0c96b3867f48c4aba523eae2b74509010db333cb3bc9bde55d0`.

[VERIFIED] Policy, coverage-summary, and prerequisite-summary SHA-256 values
are `6c19138011e493a28444fca1899c1c9418b292f30f0aff0ab7e02341d9a50f67`,
`2af38c98be269861f472182463df850b7111e40389acf0e49e1fc65e3c4b4c5b`,
and `9dd7d8e117deeb473c6d802d735e9e4fbdad7a8d8d34ac304ef4eea5c483501a`.
Authenticated implementation, corpus, function-facts, and profile digests are
`4dd05c3344fc334b106471258ddf992c15480ce18971e3c80d05e70bc6582344`,
`5a92fbd4a085bc73827818fd1de0c614e889550b60df7eaa7f6404f31660805e`,
`74187341fcce01494d0e5cf4f5f85a4c422084197660a47ad91ba3bbf3421299`,
and `2f17f2ec8537172a761fc8043f0a3c9e19a1852d4bb4755daf182c4bec2d1afa`.

[VERIFIED] Live coverage is 33/104 with 69 `fn.params` blockers, no ordinary
winner, and an empty parameter-migration queue. The same residual 69 functions
remain bounded-exhausted over all seven active-family closures with unchanged
assignment digest
`7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c`.
The focused Node 22 gate passes 95/95 tests, 48 exact runtime fixtures, eight
measured witnesses, three profile-limit fixtures, 218 hostile fixtures, and
the exact terminal receipt check.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall exits zero on the
implemented M4.30 product-source tree. It passes repository consistency,
lint, build, all workspace and
infrastructure tests, cross-target conformance, 233 native KERN tests, runner
smoke, the 48/48 checker subset, 39/39 self-host validator verdicts, 40
application-behavior fixtures across three legs, drift showcase, browser
budget, KIR seam and reader gates, runtime containment, and the repeated exact
canonicalizer terminal check. The terminal result is `KERN 5 current fitness
wall passed.`

[VERIFIED] Automatic high-risk role-lens review
`review-1784656775259-u4e3qa-kern-5-r2-m4-30-numberat-paramet` completed 6/6
usable reviewers. It returned no verified or speculative findings and two
needs-check findings that independently identified the same test-invariant
coverage gap. The validator already rejected parameter-migration/residual
overlap; the review fix restored the always-on live/test disjointness checks
and added a synthetic overlapping selected-summary mutation that proves the
specific rejection branch. No KERN, runtime, profile, composition, or policy
source changed.

[VERIFIED] The assertion-only review fix regenerated authenticated receipt
digests from the settled code. The implementation digest is
`4dd05c3344fc334b106471258ddf992c15480ce18971e3c80d05e70bc6582344`;
coverage-summary and prerequisite-summary SHA-256 values are
`2af38c98be269861f472182463df850b7111e40389acf0e49e1fc65e3c4b4c5b` and
`9dd7d8e117deeb473c6d802d735e9e4fbdad7a8d8d34ac304ef4eea5c483501a`.
The exact post-review focused gate again passes 95/95 plus 48/8/3/218 and the
terminal 33/104, 69-blocker receipt check.
