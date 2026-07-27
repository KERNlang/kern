# KERN 5 R2 M4.100 — `comparisonOperandsOk` Parameter Migration

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.99 commit
`5c75d1e015f486bb583aace8b97990a42b612eb5` promotes the active
canonicalizer profile to 74/95/832 and publishes exactly one parameter-ready
function:

`examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk`.

[DECIDED] M4.100 consumes only that immutable one-function, one-tool, 24-row
handoff by replacing the target's legacy `fn.params` attribute with 24 ordered
structural `param` children.

[DECIDED] The handler body, call sites, checker behavior, active profile,
runtime/KIR limits, public runtime ABI, and historical evidence remain
unchanged. The generated checker fixture is rebuilt because it embeds the
authored checker-while source.

[DECIDED] M4.100 is a parameter-migration milestone, not KERN 5 completion.
The measured post-migration prerequisite result determines the next slice.

## Published Input

[VERIFIED] This fresh branch starts from exact `origin/main`
`5c75d1e015f486bb583aace8b97990a42b612eb5`.

[VERIFIED] The immutable M4.99 queue is:

| Witness | Tool | Parameter rows | Post-migration profile rows |
|---|---|---:|---|
| `checker-while.kern#15:comparisonOperandsOk` | checker | 24 | 53/95/832 |
| total | 1 tool | 24 | 1 function |

[VERIFIED] The pre-migration target is function ordinal 15 with:

- name `comparisonOperandsOk`;
- return type `boolean`;
- no export flag;
- sole excluded property `fn.params`;
- pre-migration profile rows 29/47/739;
- semantic handler-body digest
  `af4ecfe26afbc017a828e64531f9f5aac2022348adbbe548ae84b520898dfecf`;
- authored source SHA-256
  `525d929ef2f52482b27128b0a936f4b3e491e949b404d7bb0ca33658f95daef7`;
  and
- generated checker fixture SHA-256
  `13c6af59f82c23c122dc8839084e0b0ab870035d9af28a201e03e8ba52c6184c`.

## Exact Migration Contract

[DECIDED] The structural parameter prefix must be exactly:

1. `row: number`
2. `fnName: string`
3. `operator: string`
4. `stmtKind: string[]`
5. `stmtFn: string[]`
6. `stmtParent: number[]`
7. `stmtName: string[]`
8. `stmtTarget: string[]`
9. `stmtExprKind: string[]`
10. `stmtExprName: string[]`
11. `stmtExprNum: string[]`
12. `stmtExprLeftKind: string[]`
13. `stmtExprLeftName: string[]`
14. `stmtExprLeftNum: string[]`
15. `stmtExprLeftMemberObject: string[]`
16. `stmtExprLeftMemberProp: string[]`
17. `stmtExprRightKind: string[]`
18. `stmtExprRightName: string[]`
19. `stmtExprRightNum: string[]`
20. `stmtExprRightMemberObject: string[]`
21. `stmtExprRightMemberProp: string[]`
22. `paramFn: string[]`
23. `paramName: string[]`
24. `paramType: string[]`

[DECIDED] The target guard must reject:

- any retained, quoted, reordered, duplicated, renamed, or retyped parameter;
- target name, return type, export state, ordinal, identity, or body drift;
- any excluded property or profile blocker after migration;
- post-migration profile rows other than exact 53/95/832; and
- any input queue other than the exact M4.99 one-function/24-row handoff.

## Expected Frontier

[DECIDED] Consuming exactly one blocker advances base completion only from
89/109 to 90/109 and reduces legacy `fn.params` blockers only from 17 to 16.

[DECIDED] M4.100 must measure the post-migration prerequisite rather than
invent its outcome. `comparisonOperandsOk` must not re-enter any later
parameter queue.

[DECIDED] Active profile limits remain 74/95/832, runtime
`maxCollectionLength` remains 65,536, and KIR `maxDepth` remains 64.

## Implementation Plan

1. Add a RED M4.100 target guard that fails while `comparisonOperandsOk`
   retains `fn.params`.
2. Convert only the target signature to the exact 24 direct parameter nodes.
3. Rebuild `examples/capstone-checker-subset/main.kern` with the repository
   generator and prove checker outputs remain exact.
4. Bind current coverage and prerequisite assertions to the M4.100 migration,
   then regenerate derived summaries twice for convergence.
5. Run focused tests, the complete canonicalizer gate, full Node 22 KERN 5
   fitness wall, and mandatory independent high-risk review.
6. Create one Agon-signed commit, fetch and immediately rebase on
   `origin/main`, then atomically push the feature branch and main once with
   `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.99 commit `5c75d1e0`.
- [x] M4.99 queue and target identity, signature, body, source, and profile
      facts are grounded.
- [x] RED fails at the intended retained-`fn.params` boundary.
- [x] Only `comparisonOperandsOk` receives the exact 24 structural parameters.
- [x] Handler body digest, call sites, and checker behavior remain exact.
- [x] Coverage advances only from 89/109 to 90/109.
- [x] Legacy `fn.params` blockers fall only from 17 to 16.
- [x] Active profile remains 74/95/832; runtime and KIR limits remain exact.
- [x] M4.99 promotion evidence and all historical receipts remain immutable.
- [x] Generated checker fixture reproduces only from the repository writer.
- [x] The post-migration prerequisite is measured and bounded exactly.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- The migration changes the handler body, call sites, or checker outputs.
- Any function other than `comparisonOperandsOk` changes parameter
  representation.
- The target's post-migration profile differs from 53/95/832.
- The implementation requires a profile, runtime, KIR, ABI, or production
  limit increase.
- M4.99 queue identity or any historical receipt drifts.

## Out of Scope

- Migrating any of the remaining 16 legacy-parameter functions.
- Raising node, property, value, runtime, collection, or KIR limits.
- Further canonicalizer runtime optimization.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The RED target test failed before implementation because the
M4.100 migration module did not yet exist.

[VERIFIED] The authored target now has exactly the required 24 direct
parameters. Its semantic body digest remains
`af4ecfe26afbc017a828e64531f9f5aac2022348adbbe548ae84b520898dfecf`;
its post-migration source SHA-256 is
`df856b8a6a674b0803273a65a755e64ebb13f699fed692fc7dd7db88bee8c802`.

[VERIFIED] The repository generator rebuilt the embedded checker fixture to
SHA-256
`7c04980d7b1de3ba6f683a138a53c4f70b4de014ab204822ab64175a67513ce2`.
The numeric fixture remained byte-identical.

[VERIFIED] Current measurement reports exact post-migration profile rows
53/95/832, cumulative base 90/109, 16 bounded `fn.params` blockers, and an
empty parameter-ready queue. The active profile remains 74/95/832.

[VERIFIED] Historical runtime receipt
`runtime-bottleneck-m4-96-measure.mjs` remains byte-identical at SHA-256
`e0871fd3bab09099d3159e0b00b0e0983091c52ba943ef26159ac17426db2b2e`.
Direct-parameter compatibility lives in the shared prerequisite normalizer,
which continues to reject mixed or malformed parameter representations.

[VERIFIED] Derived summaries converged at:

- coverage summary SHA-256
  `d09c4653140dddfc6050ef2bbb4aff462da58940181a9873b532126ab0ca9eb1`;
- prerequisite summary SHA-256
  `ccc3a0004b31a2a7dc8c5202b03f44729e182de7ecb15095cd52190870d9f88f`;
- coverage implementation digest
  `7809416075a702b6165ca035aa991a1aa1b6b5bfdde31d43ab93ded799f3c552`;
  and
- coverage-policy digest
  `e5fdb18d2de95a15429e51364fb817b3f99342d272105db6c53091e3baf00b8c`.

[VERIFIED] The complete canonicalizer gate passed all 420 Node tests, 55
golden/idempotence/KIR fixtures, 8 measured runtime witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `fitness:kern-5` wall passed, including the
22-package workspace suite, 434 cross-target fixtures, 109 class fixtures, 233
native KERN tests at 100% coverage, 48 checker-subset fixtures, 39 self-host
validator verdicts, all KIR/runtime ownership proofs, and the final repeated
canonicalizer gate.

[VERIFIED] High-risk role-lens review
`review-1785140185458-95xuqe` completed with all 6/6 usable engines. Consensus
reported zero verified findings, one needs-check item, one speculative item,
and 13 nits.

[VERIFIED] The needs-check historical-SHA concern is not a blocker. The old
whole-file checker SHA and generated-main SHA necessarily stop matching when a
later target in that shared source is migrated. Current bytes are authenticated
by `coverage-policy.json`, the M4.100 source/generated digests, and writer
reproduction; the historical M4.82 target shape/body and M4.81 published
handoff remain authenticated.

[VERIFIED] A separate review concern about divergent prerequisite-normalizer
root shapes was disproved against the implementation: the legacy branch inserts
canonical `param` children before returning, while the direct branch preserves
the already-canonical prefix. Both feed the same profile and occurrence
measurement path.
