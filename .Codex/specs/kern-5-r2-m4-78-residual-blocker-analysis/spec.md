# KERN 5 R2 M4.78 — Residual Blocker Analysis

**Status:** IMPLEMENTED — LOCAL GATES AND REVIEW PASSED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.77 commit
`2ee34545f1a97acd5889f95e52bdd0952eb362bd` consumed the complete M4.76
parameter queue. The live boundary is 80/104 base-complete functions, 23
legacy `fn.params` blockers, an empty parameter queue, and 23 residual
functions under unchanged 38/53/461 profile ceilings.

[DECIDED] M4.78 is an analysis-only release slice. It freezes every current
residual assignment, derives candidate profile settings only from measured
function rows, preserves the published ranking algorithm, and emits one exact
next action. It changes no KERN source, generated consumer, active profile,
coverage family, runtime, KIR, ABI, public contract, package version, or
historical receipt. KERN 5 remains incomplete.

## Published Input

[VERIFIED] The fresh branch
`feat/kern-5-r2-m4-78-residual-analysis` starts from exact `origin/main`
commit `2ee34545f1a97acd5889f95e52bdd0952eb362bd` with a clean worktree.

[VERIFIED] Published M4.77 binds:

- base identity `kern.kir-canonicalizer.profile.m4.60`;
- active limits 38 node rows, 53 property rows, and 461 value rows;
- 80/104 base-complete functions, 23 legacy blockers, 23 residuals, and no
  parameter-ready function;
- coverage implementation digest
  `da5ef9ae66bb6e4d1ba703c39a9a15ce99cddaae1176973e1754598742b957df`;
- coverage-policy digest
  `1c923bfd76386c4e91296815fa3b5a3632c472f188cdba1094364d6dfd782813`;
- function-fact digest
  `054731c28f3cbb33c029826c9cd8af335aa0894b1129a39424a66b506d102bc2`;
- coverage-summary SHA-256
  `c4867e74fc6646f8bdfbdfb17b3cc5b068897786ab343e830357a82eb2bfbaba`;
- prerequisite-summary SHA-256
  `f817e68032161fc8781edb72cae82cd75aed6b8f2423f1200770c5fd295ab702`;
- canonicalizer-policy SHA-256
  `ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244`;
  and
- exhaustion reason-assignment digest
  `0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7`.

## Analysis Contract

[DECIDED] Reuse format `kern.kir-canonicalizer.residual-analysis.3` and the
published M4.74 algorithm without changing ranking semantics:

1. migrate each live legacy function only in memory under the current base;
2. require an empty parameter-ready partition and exactly 23 residuals;
3. assign each residual its exact id, tool, parameter rows, measured profile
   rows or `null`, and sorted union of excluded-property/profile reasons;
4. hash canonical ordered `{id,reasons}` assignments;
5. derive one candidate setting per residual with profile rows by independently
   raising each axis only to `max(current, observed)`;
6. discard the unchanged setting and candidates completing zero functions;
7. rank by fewest changed axes, most complete tools, smallest total delta, most
   complete functions, then canonical limits text; and
8. publish the first candidate without changing live policy.

[VERIFIED] Read-only execution against exact M4.77 input produces:

- 23 assignments;
- assignment digest
  `0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7`;
- seven residual functions with measurable profile rows;
- seven distinct non-current observed settings; and
- seven actionable candidates.

## Exact Selected Action

[VERIFIED] The unique ranked recommendation is:

```json
{
  "changedLimits": ["maxPropertyRows"],
  "completeFunctions": 1,
  "completeTools": 1,
  "limits": {
    "maxNodeRows": 38,
    "maxPropertyRows": 61,
    "maxValueRows": 461
  },
  "totalDelta": 8,
  "witnesses": [
    "examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore"
  ]
}
```

[VERIFIED] `checkWhileCore` belongs to tool `checker`, has 22 legacy parameter
rows, exact measured post-migration profile rows 38/61/460, and only reason
`profile.rows.properties`. Node and value rows already fit the active ceilings.
The next ranked candidate changes node and property rows to 41/67 and selects
two checker functions; it ranks after the unique one-axis action. M4.78 does
not claim structural runtime headroom for property-row ceiling 61.

## Files and Evidence

[DECIDED] Add only:

- this claim-tagged specification;
- `coverage-residual-analysis-m4-78.mjs`;
- canonical receipt `coverage-residual-analysis-m4-78.json`; and
- `coverage-residual-analysis-m4-78.test.mjs`.

[DECIDED] Update only direct current-evidence consumers:

- coverage status formatter and test;
- coverage checker registration, assertions, and terminal evidence;
- current coverage implementation digest/summary and direct expectations; and
- historical/current tests whose live-summary pins authenticate the settled
  current implementation.

[DECIDED] Every historical receipt, all KERN source, generated KERN artifacts,
coverage-policy semantics, and active-profile bytes remain unchanged. After
all `.mjs` bytes settle, regenerate current summaries only through the
repository-owned writer.

## RED and Implementation Plan

1. Add a focused test importing the absent M4.78 module and requiring the
   grounded 23-assignment/seven-setting/one-witness result; capture RED.
2. Implement the M4.78 analyzer by preserving the M4.74 schema, canonical-data
   validator, ranking, regular-file/symlink rejection, and writer-only entry.
3. Generate the canonical receipt through its repository writer and bind its
   exact SHA-256 plus M4.77 input commit.
4. Add mutation tests for format, decoration, assignments, ordering, baseline,
   limits, witnesses, cycles, shared references, and live measurement equality;
   prove M4.74 and earlier receipts remain exact and fresh-process loading is
   byte-identical.
5. Integrate exact terminal/status evidence and regenerate current summaries
   only after all implementation bytes settle.
6. Run focused tests, complete canonicalizer, full Node 22 fitness, high-risk
   role-lens review, signed commit, final fetch/rebase, one atomic authorized
   push, and exact remote-ref verification.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.77 commit `2ee34545`.
- [x] Current 80/23/23 empty-queue boundary and input digests are grounded.
- [x] Read-only ranking measures 23 assignments and a seven-setting frontier.
- [x] Exact selected action is property-only 38/53/461 to 38/61/461 for
      `checkWhileCore` only.
- [x] RED proves the M4.78 module/receipt is absent.
- [x] Receipt contains exactly 23 assignments and seven actionable candidates.
- [x] Assignment digest and selected action match the grounded contract.
- [x] Published bytes are canonical, immutable, input-bound, and non-symlink.
- [x] Mutation, history, live-equality, and fresh-process tests fail closed.
- [x] No KERN source, generated artifact, active profile, family, or historical
      receipt changes.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push;
      feature and `main` refs verify identically.

## Completion Evidence

[VERIFIED] The repository writer produced canonical receipt SHA-256
`f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2`.
After all `.mjs` bytes settled, repository regeneration produced current
coverage-summary SHA-256
`e47d481662172a8dbbdd0605f284f2248f9b6631e8653a189117a37d806d4ec7`,
prerequisite-summary SHA-256
`4c65daf66262f22bd476638a67976b5461f9ae9383e122c0025a7f05eb90fc4f`,
and live coverage implementation digest
`c8d4a6f063c0021993022ccc5a05360717311fef8934c774a1aee49c86305ea8`.
The M4.78 receipt intentionally binds the published M4.77 implementation
digest `da5ef9ae66bb6e4d1ba703c39a9a15ce99cddaae1176973e1754598742b957df`.

[VERIFIED] The focused transition cluster passed 67/67 tests. The complete
canonicalizer passed 302/302 Node tests, 55 golden/idempotence/KIR fixtures,
eight measured witnesses, three profile-limit fixtures, and 235 hostile
fixtures. The complete Node 22 `fitness:kern-5` wall ended with
`KERN 5 current fitness wall passed.` `git diff --check` also passed, and the
diff contains no `.kern` file.

[VERIFIED] High-risk role-lens Agon review run
`review-1784862339468-gxezyf` completed 6/6 usable reviewers with zero verified
findings. Two DRYness findings required checking and were rejected after source
inspection: each 281-line milestone module intentionally owns frozen validation
semantics rather than inheriting behavior from a mutable historical helper, and
the cumulative checker is an independent release oracle rather than a duplicate
of the adversarial receipt test. Security, correctness, and both overall seats
reported no findings; no material review finding remains unresolved.

## Stop Conditions

- M4.77 commit, baseline digests, counts, or active limits differ.
- Any residual lacks exactly one canonical assignment.
- Candidate settings are invented rather than derived from observed rows.
- Ranking does not select only `checkWhileCore` under property-only 38/61/461.
- Implementation changes KERN source, generated artifacts, active policy, or
  any historical receipt.
- A required gate or verified review finding remains unresolved.

## Out of Scope

- Runtime-headroom authentication, profile promotion, or parameter migration.
- Raising the property-row limit; that requires separate runtime evidence and
  profile-promotion slices.
- Projection depth/nodes, unknown-expression, exception-flow, runtime cutover,
  KIR v1 freeze, RC/stable release, Fable work, or a KERN 5 completion claim.
