# KERN 5 R2 M4.76 — Node+Value Profile Promotion

**Status:** IMPLEMENTED — LOCAL GATES AND REVIEW PASSED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.75 commit
`177212fc4cc1ba0c15f04e1092657b4d335067e9` authenticates the exact
counterfactual structural runtime floor for `typesource` under candidate
profile 38/53/461. Its canonical receipt SHA-256 is
`c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6`.

[DECIDED] M4.76 promotes only `profileLimits.maxNodeRows` from 31 to 38 and
`profileLimits.maxValueRows` from 388 to 461. `maxPropertyRows` remains 53.
Before policy moves, this slice freezes M4.75 into an immutable published
handoff. The promoted profile exposes exactly one function, one tool, and six
legacy parameter rows for M4.77. It does not migrate source. KERN 5 remains
incomplete.

## Published Inputs

[VERIFIED] The fresh branch
`feat/kern-5-r2-m4-76-node-value-promotion` starts from exact `origin/main`
commit `177212fc4cc1ba0c15f04e1092657b4d335067e9` with a clean worktree.

[VERIFIED] Published M4.75 binds:

- receipt digest
  `c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6`;
- source commit `177212fc4cc1ba0c15f04e1092657b4d335067e9`;
- M4.74 residual-analysis digest
  `dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0`;
- structural-function scope and candidate profile 38/53/461;
- witness `examples/kern-canonicalizer/canonicalizer.kern#0:typesource`;
- structural rows 38/51/461 and six legacy parameter rows;
- exact floor 46,255, promotion headroom 2,897, and production headroom
  19,281; and
- explicit `not-claimed` module-envelope disposition at KIR depth 64.

[VERIFIED] The exact live M4.75 boundary additionally binds:

- coverage implementation digest
  `76858d2155b359169567db03929a2888790d0b32c64361af6375108a5105eebe`;
- coverage-summary SHA-256
  `34f35e56be7ba09f97f3b7d4fe5b5783cc1047dc477ec1967ac60873fbf9f588`;
- prerequisite-summary SHA-256
  `8fa0f96eb0e01ce3403793be4fbe9c53541e52ce11aaecf3ce08d0719be08f73`;
  and
- active policy SHA-256
  `a4b53907df9507d12606fafb1bbf42fd5e129589e389e5ac349c154a8e3ab964`.

## Candidate Projection

[VERIFIED] M4.74 evaluated every one of the 24 residual functions against
candidate profile 38/53/461 and selected exactly one completing function.
M4.75 independently authenticated that same function and row assignment
through the public runtime boundary. Therefore the promotion projection is:

| Field | Active 31/53/388 | Candidate 38/53/461 |
|---|---:|---:|
| authored functions | 104 | 104 |
| base-complete functions | 79 | 79 |
| legacy `fn.params` blockers | 24 | 24 |
| parameter-ready functions | 0 | 1 |
| parameter-ready tools | 0 | 1 |
| parameter-ready rows | 0 | 6 |
| residual functions after queue | 24 | 23 |

[VERIFIED] The candidate queue is exactly:

| Function | Tool | Params | Rows N/P/V |
|---|---|---:|---:|
| `canonicalizer.kern#0:typesource` | canonicalizer | 6 | 38/51/461 |

## Exact Promotion Contract

| Field | Before | After |
|---|---:|---:|
| `maxNodeRows` | 31 | 38 |
| `maxPropertyRows` | 53 | 53 |
| `maxValueRows` | 388 | 461 |
| production runtime ceiling | 65,536 | 65,536 |
| promotion runtime budget | 49,152 | 49,152 |
| KIR depth | 64 | 64 |

[DECIDED] No coverage family, base profile, source function, generated
consumer, runtime limit, KIR limit, ABI, package version, or public API may
change in this slice.

## Integrity and Freeze Contract

[DECIDED] Before policy moves, convert the live M4.75 measurer, validator, and
writer into an immutable loader bound to its exact receipt digest, published
source commit, canonical JSON bytes, and regular non-symlink path. Preserve the
M4.75 receipt bytes exactly. Independent tests and the terminal checker must
repeat the digest and source-commit anchors.

[DECIDED] Promotion tests must fail closed on:

- M4.75 digest, source commit, candidate profile, witness identity, rows,
  floor, headroom, round trip, or module no-claim drift;
- movement of any policy value other than node rows 31→38 and value rows
  388→461;
- any queue member other than the exact M4.75 witness;
- any queue cardinality other than 1 function/1 tool/6 rows;
- any direct source function becoming newly base-complete;
- loss of rejection at exact 39-node, 54-property, or 462-value boundaries;
  and
- historical M4.74 or M4.75 receipt-byte drift.

[VERIFIED] Exact candidate hostile witnesses are measurable without changing
policy:

| Boundary | Rows N/P/V | Admitted only when |
|---|---:|---|
| node | 39/45/62 | `maxNodeRows` is widened to 39 |
| property | 27/54/87 | `maxPropertyRows` is widened to 54 |
| value | 18/21/462 | `maxValueRows` is widened to 462 |

## RED and Implementation Plan

1. Add the M4.76 promotion oracle first and capture RED against the absent
   immutable M4.75 published-loader exports.
2. Freeze M4.75 as published evidence from commit `177212fc`; route its
   receipt, performance proof, terminal checker, and tests through the
   immutable loader.
3. Raise only node rows 31→38 and value rows 388→461 in `policy.json`.
4. Move the hostile profile fixtures to exact 39-node and 462-value rejection
   boundaries; retain the exact 54-property rejection boundary.
5. Assert the exact 1/1/6 queue, unchanged 79/104 base completion and 24 legacy
   blockers, and exact 23-function residual frontier. Do not migrate source.
6. Update current-frontier assertions without mutating any historical receipt,
   then regenerate active coverage and prerequisite summaries only after all
   MJS implementation bytes settle.
7. Run focused tests, the complete canonicalizer gate, the complete Node 22
   KERN 5 fitness wall, and automatic high-risk role-lens review; resolve every
   verified material finding.
8. Create one Agon-signed commit, fetch and rebase onto current `origin/main`,
   atomically push the fresh feature ref and authorized `main` once with
   `--no-verify`, and verify identical remote hashes.

## Implementation Evidence

[VERIFIED] The RED oracle failed first because
`dual-row-headroom-m4-75.mjs` did not export
`loadPublishedCanonicalizerDualRowHeadroomM475`. The implementation then:

- converted M4.75 runtime evidence into an immutable published loader bound to
  digest `c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6`
  and source commit `177212fc4cc1ba0c15f04e1092657b4d335067e9`;
- promoted the active policy to exact limits 38/53/461;
- moved hostile fixtures to exact rejection rows 39/45/62, 27/54/87, and
  18/21/462;
- exposed only `canonicalizer.kern#0:typesource` as one function, one tool,
  and six parameter rows at 38/51/461; and
- corrected the historical M4.74 oracle so its immutable published receipt is
  no longer re-measured against a later live policy. Its receipt digest,
  schema, baseline, mutation rejection, prior-handoff continuity, and
  fresh-process reproduction remain enforced.

[VERIFIED] Final generated evidence binds:

- coverage implementation digest
  `4415a15894d6be6300aecad354a239f89ca81f384596b0923012c8281fd3839f`;
- active policy SHA-256
  `ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244`;
- coverage-summary SHA-256
  `ec4708e71383d3a4033ff8b5b665b781e2c0d9c180550fab8c246094913a5572`;
- prerequisite-summary SHA-256
  `a963c0df94b563eb7df5e50eba68faf12cd607f92229ab0c748c412eaa3e88ca`;
- function-facts digest
  `b625ad26618fa7d2ec0e50f64030b8074445a47f4738f91ca79238f77558638a`;
  and
- residual reason-assignment digest
  `0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7`.

[VERIFIED] Local gates passed:

- focused promotion/history/prerequisite cluster: 35/35;
- complete canonicalizer suite: 293/293 tests, 55 golden/idempotence/KIR
  fixtures, 8 measured witnesses, 3 exact boundary fixtures, and 235 hostile
  fixtures; and
- full Node 22 `pnpm fitness:kern-5`, ending with
  `KERN 5 current fitness wall passed.`

[VERIFIED] The final diff contains no `.kern` source, generated consumer,
package manifest, lockfile, parser, runtime, KIR, ABI, version, or public API
change. KERN 5 remains incomplete; M4.77 must consume the exact `typesource`
parameter queue.

[VERIFIED] Automatic high-risk role-lens review completed with all six usable
independent seats: 6/6 succeeded, 0 verified findings, 0 needs-check findings,
0 speculative findings, and 6 nits. Repo-wide search confirms no remaining
M4.75 measure/write export reference. The retained M4.74 measurer is not dead:
its direct `--write` path still calls it and its exact M4.73 input guard now
fails closed under the promoted policy. The DRY suggestions would weaken the
intended self-contained historical receipt boundary, so no nit justified a
review-driven implementation change.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.75 commit `177212fc`.
- [x] Exact M4.75 digest, source commit, witness, rows, and floor are grounded.
- [x] Candidate projection yields exact 1-function/1-tool/6-row queue and 23
      residual functions.
- [x] RED fails against the missing immutable M4.75 published loader.
- [x] M4.75 receipt stays byte-identical and loads only as published evidence.
- [x] Only node rows 31→38 and value rows 388→461 change; property rows stay 53.
- [x] Exact 39-node, 54-property, and 462-value hostile fixtures reject.
- [x] Queue equals only `typesource` at 38/51/461 and six rows.
- [x] Base completion stays 79/104; legacy blockers stay 24; residuals become 23.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates, complete canonicalizer, and Node 22 fitness pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.75 receipt digest, source commit, witness, floor, or headroom differs.
- Candidate projection admits an additional function or changes base completion.
- Promotion requires source, family, runtime, KIR, ABI, or property-row changes.
- Exact 39-node, 54-property, or 462-value rejection cannot be demonstrated.
- M4.77 would not consume the exact one-function/six-row queue.

## Out of Scope

- Migrating `typesource`; that belongs to the fresh M4.77 slice.
- Adding or promoting another prerequisite family.
- Widening property rows, runtime limits, KIR depth, or module-envelope admission.
- Runtime, KIR, ABI, public API, package version, RC, or stable-release changes.
- Claiming KERN 5 completion.
