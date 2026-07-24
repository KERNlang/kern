# KERN 5 R2 M4.83 — Residual Blocker Analysis

**Status:** RELEASE CANDIDATE — REVIEW GREEN / PUSH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.82 commit
`89083ba126201067c918ea7e130382ca171f4097` consumed the exact M4.81
parameter queue. The current boundary is 82/105 base-complete functions, 22
legacy `fn.params` blockers, an empty parameter queue, and 22 residual
functions under unchanged 38/61/461 profile ceilings.

[DECIDED] M4.83 is analysis-only. It freezes each current residual assignment,
derives candidate profile settings only from measured function rows, preserves
the published ranking semantics, and publishes one exact next action. It does
not change KERN source, generated consumers, active profile, runtime, KIR, ABI,
package version, or historical receipts. KERN 5 remains incomplete.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-83-residual-analysis` starts from clean
`origin/main` at exact commit
`89083ba126201067c918ea7e130382ca171f4097`.

[VERIFIED] M4.82 binds:

- base identity `kern.kir-canonicalizer.profile.m4.60`;
- active limits 38 node rows, 61 property rows, and 461 value rows;
- 82/105 base-complete functions, 22 legacy blockers, 22 residuals, and no
  parameter-ready function;
- coverage implementation digest
  `5f82778a5af9da23df0c6885fa1ec8188f792df3f105e448d82b26c5cb9c6c86`;
- coverage-policy digest
  `e4a310720a9f41d9c0d8b9340177d5df634d1add5209420fe600ebef46e78da6`;
- function-fact digest
  `75a50e5f254e43391c1643329b15b508c06910e7ee4063f86bd12089010077d2`;
- coverage-summary SHA-256
  `7731ccd53e0cd3ff0d245c667744fbc62465482a38419993d46e854f54e4fb9c`;
- prerequisite-summary SHA-256
  `9632ace6ed8efe06a523bcd4c7e73fb98b5282911b294d37150b6c7f823ea54d`;
- canonicalizer-policy SHA-256
  `6506df16bb042ae3c5544fce3324c500e2401192983fc98ae492d2283ff21495`;
  and
- exhaustion reason-assignment digest
  `37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec`.

## Analysis Contract

[DECIDED] Reuse format `kern.kir-canonicalizer.residual-analysis.3` and the
published M4.78 ranking algorithm without changing semantics:

1. migrate each live legacy function only in memory under the current base;
2. require an empty parameter-ready partition and exactly 22 residuals;
3. record each residual's exact id, tool, parameter rows, measured profile
   rows or `null`, and sorted union of excluded-property/profile reasons;
4. hash canonical ordered `{id,reasons}` assignments;
5. derive one candidate setting per residual with profile rows by raising each
   axis only to `max(current, observed)`;
6. discard the unchanged setting and candidates completing zero functions;
7. rank by fewest changed axes, most complete tools, smallest total delta,
   most complete functions, then canonical limits text; and
8. publish the first candidate without changing live policy.

[VERIFIED] Read-only execution against M4.82 produces 22 assignments, exact
assignment digest
`37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec`,
six residual functions with measurable profile rows, six distinct observed
settings, and six actionable candidates.

## Exact Selected Action

[VERIFIED] The unique ranked recommendation is:

```json
{
  "changedLimits": ["maxValueRows"],
  "completeFunctions": 1,
  "completeTools": 1,
  "limits": {
    "maxNodeRows": 38,
    "maxPropertyRows": 61,
    "maxValueRows": 580
  },
  "totalDelta": 119,
  "witnesses": [
    "examples/capstone-checker-subset/checker.kern#16:argProvenanced"
  ]
}
```

[VERIFIED] `argProvenanced` belongs to tool `checker`, has 19 legacy parameter
rows, exact measured post-migration profile 35/55/580, and only reason
`profile.rows.values`. Node and property rows already fit. M4.83 does not claim
structural runtime headroom for value-row ceiling 580.

## Implementation Plan

1. Add a focused RED test importing the absent M4.83 analyzer and requiring the
   grounded 22-assignment/six-setting/one-witness result.
2. Implement the analyzer with exact M4.82 input binding, canonical plain-data
   validation, immutable digest loading, non-symlink enforcement, and
   writer-only direct invocation.
3. Generate the canonical M4.83 receipt and bind its exact SHA-256 plus M4.82
   input commit.
4. Add mutation, history, live-equality, and fresh-process tests; preserve the
   exact published M4.78 receipt.
5. Integrate exact terminal/status evidence and regenerate only current
   summaries after all implementation bytes settle.
6. Run focused and complete gates, high-risk role-lens review, signed commit,
   fetch/rebase, one atomic no-verify push, and exact remote verification.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.82 commit `89083ba1`.
- [x] Current 82/22/22 empty-queue boundary and input digests are grounded.
- [x] Read-only ranking measures 22 assignments and a six-setting frontier.
- [x] Exact selected action is value-only 38/61/461 to 38/61/580 for
      `argProvenanced` only.
- [x] RED proved the M4.83 module/receipt was absent.
- [x] Receipt contains exactly 22 assignments and six actionable candidates.
- [x] Assignment digest and selected action match this contract.
- [x] Published bytes are canonical, immutable, input-bound, and non-symlink.
- [x] Mutation, history, live-equality, and fresh-process tests fail closed.
- [x] No KERN source, generated artifact, active profile, family, or historical
      receipt changes.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote refs verify identically.

## Completion Evidence

[VERIFIED] The canonical receipt SHA-256 is
`42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546`.
After all implementation bytes settled, the regenerated current summaries
have SHA-256 values
`cb38681a9ad87434c85eef3295e5a7cef4957af2397f75186a9496fc82d9153d`
and
`1236bd16b762ee0a115a31487f622a77662e609520e1a7e15fb48e784820c5d0`;
the live coverage implementation digest is
`e02d1e500c4ddfd668b11854bed8d69c04d0fc79d0adb9484f6d9838ab76c301`.

[VERIFIED] Focused M4.83 coverage tests passed 30/30. The complete
canonicalizer passed 318/318 Node tests plus 55 golden/idempotence/KIR, eight
measured, three profile-limit, and 235 hostile fixtures. The full Node 22
`pnpm fitness:kern-5` command exited zero with `KERN 5 current fitness wall
passed.`

[VERIFIED] Agon review `review-1784886525141-5ilgmv` routed the high-risk diff
to all six usable independent seats with automatic role lenses. Consensus
reported zero verified findings. The possible read-branch placement issue was
refuted against the full file and normal no-write execution; the remaining
DRYness observations describe pre-existing immutable-receipt architecture and
do not justify a scope-expanding historical refactor in this slice.

## Stop Conditions

- M4.82 commit, baseline digests, counts, or active limits differ.
- Any residual lacks exactly one canonical assignment.
- Candidate settings are invented rather than derived from observed rows.
- Ranking does not select only `argProvenanced` under value-only 38/61/580.
- Implementation changes KERN source, generated artifacts, active policy, or
  any historical receipt.
- A required gate or verified review finding remains unresolved.

## Out of Scope

- Runtime-headroom authentication, profile promotion, or parameter migration.
- Raising the value-row limit; a separate slice must authenticate runtime
  headroom first.
- Projection depth/nodes, unknown-expression, exception-flow, runtime cutover,
  stable KIR, RC/stable release, Fable work, or a KERN 5 completion claim.
