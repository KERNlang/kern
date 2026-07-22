# KERN 5 R2 M4.37 — Frozen `appendid` Parameter Migration

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.36 commit
`f1bd51b4c3a845a412fdf62d41fcbe592b7e6707` promotes the exact do-statement
profile and authenticates one base-only parameter-ready witness:
`examples/selfhost-validator/validator.kern#14:appendid`. Its frozen migration
contract contains ordered `xs:number[]` and `id:number` parameters, two rows,
and counterfactual profile rows 9 nodes, 16 properties, and 80 values.

[DECIDED] M4.37 consumes exactly that singleton receipt cohort. It removes
only `appendid`'s legacy `fn.params` property, prepends the two equivalent
ordered direct `param` children, regenerates the validator-derived checker
fixture and authenticated coverage receipts, and changes no body, call site,
root ordinal, profile, capability family, runtime, KIR, ABI, or historical
provenance record.

## Published Input

[VERIFIED] The exact M4.36 boundary is:

- profile `kern.kir-canonicalizer.profile.m4.36`;
- 45/104 base-complete functions;
- 57 legacy `fn.params` blockers;
- null ordinary-family winner;
- `appendid` as the sole base-ready parameter-migration witness;
- two parameter rows with profile rows 9/16/80;
- bounded exhaustion over exception-flow and while-iteration;
- three evaluated non-empty closures, zero completing closures, and 56
  residual functions;
- residual assignment digest
  `8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`.

[VERIFIED] M4.36 policy, coverage-summary, and prerequisite-summary SHA-256
values are
`5e806bf8f4078bf07a2190df6b1be11a8a2fc3e4e77cad668e6030ac1ca1cb0b`,
`d334c6843c9730a25cca07ca26c389563609cc8deb39ea6de214f41d8e9caf21`,
and `20055d5b554a116776d8bda54b832703fca85eddb6f5f7bbf7f7957b4d0f751f`.
The validator is 488 lines and 22,291 bytes at
`91028ca731e7054d72339bff91e86c2bac5bf271e8895732e9cd157c80a2f920`.

## Root Cause

[VERIFIED] `appendid`'s body is already complete under the M4.36 cumulative
profile. Its sole live blocker is the excluded legacy parameter
representation `params="xs:number[],id:number"`.

[VERIFIED] Ordered direct `param` children are already the admitted parser,
structural KIR, runtime, and canonicalizer representation. Mixed legacy/direct
forms fail closed. This is a representation migration, not a grammar or
semantic extension.

## Frozen Migration Contract

| Surface | Contract | Tag |
|---|---|---|
| Scope | exact singleton `validator.kern#14:appendid` | VERIFIED |
| Header | remove only `params="xs:number[],id:number"` | DECIDED |
| Parameters | prepend `xs:number[]`, then `id:number` | DECIDED |
| Body | preserve handler and every body/call byte | DECIDED |
| Root order | preserve `appendid` at root ordinal 14 and every sibling | DECIDED |
| Profile | remain `kern.kir-canonicalizer.profile.m4.36` | DECIDED |
| Families | remain exception-flow, while-iteration in exact order | DECIDED |
| Provenance | preserve all nine promotions and five prerequisite handoffs | DECIDED |
| Measurement | regenerate only from authenticated live facts | DECIDED |

## Generated Consumers

[VERIFIED] The checker-subset fixture writer flattens source that includes the
self-host validator. The validator migration therefore requires
`scripts/capstone-checker-subset/gen-fixtures-kern.mjs`; generated
`examples/capstone-checker-subset/main.kern` must change as derived evidence,
while `numeric-main.kern` must remain byte-identical at
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`.

[VERIFIED] The validator is not a canonicalizer composition member. The
41,190-byte canonicalizer composite must remain byte-identical at
`40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`,
with unchanged composition record
`31eec256bb2861f4a7901e0f25949da2777cf7baf1d59b0f6ade36d9b5d39279`.

## Expected Live Transition

[INFERRED] Exact migration should advance base completion from 45/104 to
46/104 and reduce legacy `fn.params` blockers from 57 to 56. The base-only
parameter-migration partition should become empty because its complete frozen
cohort has been consumed.

[INFERRED] The same 56 residual functions should remain bounded-exhausted over
the same two active families and three non-empty closures. Their reason census
and assignment digest should remain stable because `appendid` was already
excluded from the residual partition. These are predictions; regenerated
authenticated receipts decide the final facts.

## RED and Mutation Plan

[DECIDED] Before editing KERN source, extend
`assertStructuredParameterMigrations` to require:

- validator length 490 lines;
- `appendid` in the exact structured target set at ordinal 14;
- no `fn.params` on the target;
- ordered direct parameters `xs:number[]`, then `id:number`;
- ten remaining legacy validator siblings;
- 18 direct parameter rows across the established validator target set;
- exact live `appendid` profile rows 9/16/80.

[DECIDED] RED must fail on unchanged M4.36 at the source-shape boundary before
the source edit. Post-migration receipt tests must reject a surviving or mixed
legacy property, reordered/mistyped parameters, target ordinal drift,
fabricated parameter-ready evidence, profile widening, residual overlap, and
historical provenance changes.

## Implementation Plan

1. Add exact RED source assertions and capture the intended M4.36 failure.
2. Rewrite only `appendid`'s parameter representation.
3. Regenerate the validator-derived checker fixture and prove the numeric
   fixture and canonicalizer composition remain byte-identical.
4. Update only the validator corpus digest and regenerate authenticated
   coverage and prerequisite summaries.
5. Pin measured post-migration coverage, blockers, empty parameter queue,
   residual outcome, generated hashes, and next action.
6. Run focused validator/checker/canonicalizer gates, the complete Node 22
   KERN 5 fitness wall, and automatic high-risk role-lens review.
7. Resolve every verified material finding, commit with Agon identity,
   fetch/rebase onto `origin/main`, atomically push the fresh feature ref and
   explicitly authorized main once with `--no-verify`, verify both refs, and
   start the next slice from fresh `origin/main`.

## File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-slice frozen migration contract |
| `examples/selfhost-validator/validator.kern` | modify | singleton signature migration |
| checker-subset `main.kern` | regenerate | validator-derived fixture evidence |
| structured-migration assertions | modify | RED source/profile boundary |
| coverage policy | modify | changed validator corpus digest |
| coverage/prerequisite summaries | regenerate | authenticated live transition |
| coverage/prerequisite/handoff tests | modify as measured | exact M4.37 facts |
| terminal coverage check | modify | release facts and next action |
| release train | modify | durable M4.37 evidence |

## Measured Result

[VERIFIED] RED rejected the unchanged M4.36 source because `appendid` retained
legacy `fn.params`. The final source is 490 lines and 22,318 bytes at
`d0a458b709e8e3c2675f2b017623557679cb59007ca0012dd6c44b5ddbb8b7cd`;
its semantic body digest remains
`24064fe7a08b3e1c82733710d090dd7f10ec2e8ee1621b7cc2a4e6983aeed72e`.

[VERIFIED] Live coverage advances to 46/104 and 56 legacy blockers. The
parameter queue is empty, while bounded exhaustion stays at three evaluated
closures, zero completing closures, 56 residual functions, and assignment
digest `8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`.
Policy, coverage, and prerequisite summary SHA-256 values are
`f441b42d80b0fbbe1d858efafddfc8b713b3633699f0d125df9541f90afdb987`,
`677f7ec0ae9616017a0db891d5cf87bce93fbb0d93b05f20a758153c2d7eda81`,
and `2922af3886bd0436cdd9f11f247cb46092cf8a94c6d70b07f80b914d3ee5b849`.
Authenticated implementation and function-facts digests are
`b4109faec4bbb69b9198ca8d996ff7d23bbd4ac3c560de6d5728e02d1511c681`
and `513653af8508b60955f8f2fc9cb9289bcb26ad9f38a081380692d51cfd3a10c3`.

[VERIFIED] The generated checker fixture reproduces at
`fc71450c1e5a79accd971ee5a3afd046042a25bb305abdf947986b0528ecfa65`.
The numeric fixture remains
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`,
and the 41,190-byte KERN composite remains
`40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`.

[VERIFIED] Focused gates pass: generated fixture drift check, 48/48 checker
fixtures, 39/39 self-host validator verdicts, 35/35 targeted structural and
receipt tests, 104/104 complete canonicalizer tests, 51 golden/KIR/idempotence
fixtures, eight measured witnesses, three profile-limit fixtures, and 226
hostile mutations.

## Acceptance Criteria

- [x] Fresh M4.37 branch starts at published M4.36 `origin/main` commit
      `f1bd51b4c3a845a412fdf62d41fcbe592b7e6707`.
- [x] Exact singleton/two-row M4.36 receipt input is grounded.
- [x] RED fails on unchanged M4.36 at the intended `appendid` source boundary.
- [x] Only `appendid` loses `fn.params` and gains two ordered direct params.
- [x] Target body, calls, root ordinal, other properties, and siblings remain
      exact; no mixed parameter representation exists.
- [x] Validator-derived checker fixture reproduces through its writer while
      numeric fixture and canonicalizer composition remain exact.
- [x] Every historical promotion, prerequisite handoff, profile limit, and
      family-registry fact remains exact.
- [x] Live measurement is regenerated and pinned without inventing a next
      family or parameter witness.
- [x] Focused checker, validator, structural/receipt, and canonicalizer gates
      pass.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Automatic high-risk role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      feature and explicitly authorized `main`; both refs are verified.

## Stop Conditions

- Migration requires a body, call-site, parser, runtime, KIR, ABI, profile,
  family-registry, or public-contract change.
- `appendid` identity, root ordinal, ordered signature, or frozen 9/16/80 rows
  differ from the M4.36 receipt.
- A non-target handwritten KERN source changes.
- Generated consumer output cannot be reproduced by its repository writer.
- Base completion/blockers differ from the exact regenerated measurement.
- A consumed parameter witness remains ready, enters residual ranking, or is
  replaced by an unauthenticated witness.
- Any historical provenance or M4.36 promoted profile byte changes.

## Out of Scope

- Migrating any function other than `appendid`.
- Implementing or promoting exception-flow or while-iteration.
- Widening value/node/property/depth limits or optimizing coverage search.
- Parser, KIR, runtime, ABI, evaluator, public export, package version, or
  KERN 5 release changes.

## Open Questions

None. Post-migration hashes, blocker census, residual result, and next action
are measured outputs rather than design choices.
