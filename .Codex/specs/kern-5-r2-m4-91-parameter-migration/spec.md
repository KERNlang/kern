# KERN 5 R2 M4.91 — Four-Function Parameter Migration

**Status:** PUBLISHED
**Date:** 2026-07-26
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.90 commit
`8d9d8d66d61b4f2e241fa418fb8de444ae23b533` promotes only the
canonicalizer profile to 74 node rows, 77 property rows, and 580 value rows.
It publishes an exact four-function, three-tool, 47-row parameter queue.

[DECIDED] M4.91 consumes only that queue by replacing each selected function's
legacy `fn.params` string with ordered structural `param` children. Function
names, ordinals, return/export contracts, semantic bodies, callers, policy,
runtime/KIR limits, and historical receipts remain unchanged.

[DECIDED] KERN 5 remains incomplete after M4.91. This slice advances
canonicalizer coverage; it does not claim runtime cutover, KIR v1 freeze,
semantic self-hosting, RC/stable release, or Fable readiness.

## Published Input

[VERIFIED] The branch starts from clean `origin/main` at exact commit
`8d9d8d66d61b4f2e241fa418fb8de444ae23b533`.

[VERIFIED] The immutable M4.90 queue is:

| Witness | Tool | Parameters | Migrated profile |
|---|---|---:|---|
| `checker.kern#18:indexRejectDetail` | checker | 24 | 41/67/404 |
| `checker.kern#23:callRejectCode` | checker | 15 | 47/64/478 |
| `canonicalizer.kern#2:exprsource` | canonicalizer | 7 | 13/23/175 |
| `validator.kern#2:isreserved` | validator | 1 | 74/77/572 |
| total | 3 tools | 47 | 4 functions |

[VERIFIED] Before migration, the frontier is 84/106 base-complete functions,
22 legacy `fn.params` blockers, and 18 residual functions after excluding the
published queue.

[VERIFIED] Pre-migration source SHA-256 values are:

- checker: `a04a2242cb7762b9753f16e49cc0b849eadd736d2d1667d691d267603394ad59`;
- canonicalizer: `b8f82357548884f4ea40f73d345ccf76c3d2c70e9c5084a4db94943930c96f52`;
- validator: `a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee`.

## Migration Contract

[DECIDED] The structural parameter order is exactly the order encoded by the
M4.90 legacy signatures:

1. `indexRejectDetail`: 24 rows from `fnName:string` through
   `paramOrdinal:number[]`.
2. `callRejectCode`: 15 rows from `callId:number` through `stmtFn:string[]`.
3. `exprsource`: 7 rows from `id:number` through `valueBool:number[]`.
4. `isreserved`: one `name:string` row.

[VERIFIED] Pre-migration semantic body digests are:

- `indexRejectDetail`:
  `4c6edccfacd31bff7de4c8d807248989d43e59d0305ffc65dcfc3a5ce91e3aea`;
- `callRejectCode`:
  `c2fa1c369693a7dee0bce6d5d64e0a7d6c3fee56e3163a05feae36e18d722d75`;
- `exprsource`:
  `bf84b072a57127293b581d0bcc1901d7147f7e19dd2712596fb6059c367c4861`;
- `isreserved`:
  `e473be1c4b6b70b8aec33c1a893a6839092024d29d4182f45f94b7e00c07e39a`.

[DECIDED] Direct measurement after migration must show exactly 88/106
base-complete functions and 18 remaining legacy parameter blockers. The next
queue, bounded-exhaustion record, and reason-assignment digest must be measured
rather than assumed.

## Implementation Plan

1. Add RED M4.91 tests importing an absent migration module.
2. Add an exact four-target migration guard bound to the M4.90 queue.
3. Convert only the four selected legacy signatures to ordered structural
   parameter children.
4. Regenerate repository-owned checker, validator, and canonicalizer products.
5. Re-measure the frontier and update only current guards, status, summaries,
   and historical assertions that intentionally track the live frontier.
6. Run focused tests, complete canonicalizer/capstone gates, full Node 22
   fitness, six-engine high-risk review, then one rebase-first atomic push.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.90 commit `8d9d8d66`.
- [x] RED fails at the absent M4.91 migration module boundary.
- [x] Exact M4.90 four-function/47-row handoff is authenticated.
- [x] Only the four selected functions lose `fn.params` and gain the exact
      ordered structural parameter children.
- [x] Identity, ordinals, return/export contracts, bodies, and migrated
      41/67/404, 47/64/478, 13/23/175, and 74/77/572 rows remain exact.
- [x] Base coverage advances exactly from 84 to 88 of 106 functions.
- [x] Legacy parameter blockers fall exactly from 22 to 18 functions.
- [x] Generated products reproduce only from repository writers.
- [x] M4.87–M4.90 receipts and all policy/runtime/KIR limits remain exact.
- [x] Focused, complete, and full Node 22 KERN 5 gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- The M4.90 queue differs in identity, ordering, rows, or tool ownership.
- Structural conversion changes a semantic body, caller, signature order/type,
  function identity, export state, or migrated profile.
- Any policy, runtime, KIR, ABI, canonicalizer behavior, or historical receipt
  must change to complete the migration.
- Direct measurement does not advance the base by exactly four or remove
  exactly the four selected legacy blockers.

## Out of Scope

- Selecting or consuming a subsequent residual tranche.
- Raising any profile, runtime, collection, projection, or KIR limit.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  release versioning, or Fable.

## Plan Delta

[VERIFIED] The migration consumed exactly the published four-function,
47-parameter queue without changing any selected body digest, function
identity, ordinal, return/export contract, caller, profile, policy, runtime
limit, or KIR limit.

[VERIFIED] Direct measurement produced 88/106 base-complete functions and
exactly 18 residual `fn.params` blockers. No further parameter-ready tranche
exists under the current 74/77/580 profile, so M4.91 records bounded
active-family exhaustion instead of inventing a follow-on queue. The residual
reason digest remains
`b222027da0639addba00e2c0149684e1e02a9bfd199feacae921b5fc028e07fe`.

[VERIFIED] Repository writers reproduce the checker, validator, and
canonicalizer artifacts exactly. The complete canonicalizer gate passes
371/371 tests plus 55 golden/idempotence/KIR fixtures, 8 measured witnesses,
3 profile-limit fixtures, and 235 hostile fixtures.

[VERIFIED] Six independent high-risk role-lens reviewers completed across the
main Agon run and a successful retry of the timed-out security seat. No
verified finding remained. Three needs-check items were rejected against the
code: two treated immutable M4.89 receipt pins as live drift guards even though
the receipt is digest-bound and current M4.90/M4.91 guards own live state; one
was a maintainability preference against deliberately independent frontier
assertions rather than a correctness defect.
