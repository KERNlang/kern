# KERN 5 R2 M4.66 — Residual Blocker Analysis

**Status:** IMPLEMENTED — VERIFIED — REVIEWED — PUBLISH PENDING
**Date:** 2026-07-23
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.65 commit
`e81c1b9543ad53625f81c9bd9a513e55bfb18083` consumed the complete M4.64
parameter queue. The live boundary is 77/104 base-complete functions, 26
legacy `fn.params` blockers, an empty parameter queue, and 26 residual
functions under the unchanged 28/50/388 profile.

[DECIDED] M4.66 is an analysis-only release slice. It freezes every current
residual assignment, derives candidate profile settings only from observed
function rows, ranks them with the existing published algorithm, and publishes
one exact next action. It changes no KERN source, generated consumer, profile,
family, runtime, KIR, ABI, public contract, or historical receipt. KERN 5
remains incomplete.

## Published Input

[VERIFIED] M4.66 starts from exact source commit
`e81c1b9543ad53625f81c9bd9a513e55bfb18083` with:

- base identity `kern.kir-canonicalizer.profile.m4.60`;
- active limits 28 node rows, 50 property rows, and 388 value rows;
- 77/104 base-complete functions, 26 legacy blockers, 26 residuals, and no
  parameter-ready function;
- coverage implementation digest
  `acac325be26eb7ec7ebdfbb0d5d1b7446a056333e63c3183d17e4fb322d56c8c`;
- coverage-policy digest
  `b3f720fb34255cf93466430c17924fd9f3b6f81b588cae8a0526dc598ed8cfcf`;
- function-fact digest
  `5b2b03d3e5659e391462f3591416d3d032bf9becef42658396bf894af86bc4d1`;
- coverage-summary and prerequisite-summary SHA-256 values
  `22590f4e83fa52f239e0cb31359c83235b37690f6ad7036055cf0c33fd5dfb19`
  and `5f15dd8f025f11812842471e4ed8f2e18a0529cbc28360d4eae78b6e8862ddaf`;
- corpus digest
  `e7acd4b5bcec72247b44347e90664fbe064d56380994078b312984e4ce68733c`;
  and
- live exhaustion reason-assignment digest
  `68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6`.

## Analysis Contract

[DECIDED] Reuse format `kern.kir-canonicalizer.residual-analysis.3` and the
published M4.62 algorithm:

1. migrate each live legacy function only in memory under the current base;
2. require an empty parameter-ready partition and exactly 26 residuals;
3. assign each residual its exact id, tool, parameter rows, measured profile
   rows or `null`, and sorted union of excluded-property/profile reasons;
4. hash the canonical ordered `{id,reasons}` assignments;
5. derive one candidate setting per residual with profile rows by independently
   raising each axis only to `max(current, observed)`;
6. discard the unchanged setting and candidates completing zero functions;
7. rank by fewest changed axes, most complete tools, smallest total delta, most
   complete functions, then canonical limits text; and
8. publish the first candidate without changing the live profile.

[VERIFIED] The grounded current analysis has:

- 26 assignments;
- bytewise canonical assignment digest
  `68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6`;
- 10 residual functions with measurable profile rows;
- 10 distinct non-current observed settings; and
- 10 actionable candidates.

[VERIFIED] The repository writer produced canonical receipt SHA-256
`7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736`.

## Exact Selected Action

[VERIFIED] The unique ranked recommendation is:

```json
{
  "changedLimits": ["maxNodeRows"],
  "completeFunctions": 1,
  "completeTools": 1,
  "limits": {
    "maxNodeRows": 30,
    "maxPropertyRows": 50,
    "maxValueRows": 388
  },
  "totalDelta": 2,
  "witnesses": [
    "examples/capstone-checker-subset/checker.kern#3:isSurfaceKind"
  ]
}
```

[VERIFIED] `isSurfaceKind` has one legacy parameter row, exact measured profile
rows 30/32/219, tool `checker`, and sole residual reason
`profile.rows.nodes`. The next candidate changes two axes (31/53/388) and is
therefore ranked after it. M4.66 does not claim runtime headroom for 30 rows.

## Files and Evidence

[DECIDED] Add only:

- this claim-tagged specification;
- `coverage-residual-analysis-m4-66.mjs`;
- canonical receipt `coverage-residual-analysis-m4-66.json`; and
- `coverage-residual-analysis-m4-66.test.mjs`.

[DECIDED] Update only current evidence consumers:

- coverage status formatter/test;
- coverage checker;
- current coverage implementation digest/summary and its direct expectations;
- package/fitness registration if required by the existing discovery path.

[DECIDED] Every historical receipt, all KERN source, generated KERN artifacts,
coverage policy semantics, and active profile bytes remain unchanged. If the
current implementation digest changes because the analysis/checker scripts are
part of the authenticated implementation set, regenerate only repository-owned
current receipts and pin the resulting exact values.

## RED and Implementation Plan

1. Add a focused test importing the missing M4.66 analysis module and requiring
   the grounded 26-assignment/10-setting/one-witness result; capture RED.
2. Implement the M4.66 analyzer by preserving the M4.62 schema, canonical-data
   validator, ranking, regular-file/symlink rejection, and writer-only entry.
3. Generate the canonical receipt through its repository writer and then bind
   its exact SHA-256 plus M4.65 source commit.
4. Add mutation tests for format, decoration, assignments, ordering, baseline,
   limits, and witness drift; prove historical M4.62/M4.54 receipts remain exact
   and fresh-process loading is byte-identical.
5. Integrate exact terminal/status evidence and current implementation digests.
6. Run focused tests, complete canonicalizer, full Node 22 fitness, high-risk
   role-lens review, targeted review-fix gates, signed commit, final fetch/rebase,
   one atomic authorized push, and remote ref verification.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.65 commit `e81c1b95`.
- [x] Current 77/26/26 empty-queue boundary and input digests are grounded.
- [x] All 26 assignments and the 10-setting frontier are measured read-only.
- [x] Exact selected action is node-only 28→30 for `isSurfaceKind`.
- [x] RED proves the M4.66 module/receipt is absent.
- [x] Receipt contains exactly 26 assignments and 10 actionable candidates.
- [x] Assignment digest and selected action match the grounded contract.
- [x] Published bytes are canonical, immutable, source-bound, and non-symlink.
- [x] Mutation, history, and fresh-process tests fail closed.
- [x] No KERN source, generated artifact, active profile, family, or historical
      receipt changes.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push;
      feature and `main` refs verify identically.

## Verification Evidence

[VERIFIED] The final authenticated current evidence is:

- coverage implementation digest
  `b65add555ec46dc7d004b676fa27564a6365538ce2923e237f113b98ee39fbfc`;
- coverage-policy digest
  `b3f720fb34255cf93466430c17924fd9f3b6f81b588cae8a0526dc598ed8cfcf`;
- function-fact digest
  `5b2b03d3e5659e391462f3591416d3d032bf9becef42658396bf894af86bc4d1`;
- coverage-summary SHA-256
  `4c07835ae37b1e01cb748ef78775ebe20f245b008daf719f3ae9d179c1416e44`;
- prerequisite-summary SHA-256
  `f8498979d75943b9cd6b025571562c84d9de00e72e97c52c4a383c6ee3f7aefc`;
- M4.66 receipt SHA-256
  `7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736`.

[VERIFIED] The focused M4.66/status suite passed, the complete canonicalizer
gate passed 243/243 tests plus 55 golden, 8 measured-witness, 3 profile-limit,
and 235 hostile fixtures, and the complete KERN 5 current fitness wall exited
zero. The wall also passed 434/434 cross-target fixtures, 109/109 class
fixtures, and 233 native KERN assertions at 100% coverage.

[REVIEWED] Agon review `review-1784816610978-7d9gg8` routed high risk with
role lenses to all 6/6 usable independent reviewers; every reviewer returned
`ok`. The one genuine needs-check finding reproduced a shared-reference alias
that canonical JSON bytes cannot represent. The fix now constructs the selected
action as an independent tree and rejects cycles or shared references before a
validated record escapes; its RED regression and all targeted gates pass.

[REVIEWED] The remaining needs-check items were non-material after direct code
validation: milestone-local validators, formatters, and exact checker assertions
intentionally keep immutable historical contracts isolated; `inputCommit` is
the code-bound provenance returned by all format-3 predecessor loaders; and the
fresh-process test supplies an explicit repository-root `cwd` derived from
`import.meta.url`.

## Stop Conditions

- M4.65 commit, baseline digests, counts, or active limits differ.
- Any residual lacks exactly one canonical assignment.
- Candidate settings are invented rather than derived from observed rows.
- Ranking does not select only `isSurfaceKind` under node-only 30/50/388.
- Implementation changes KERN source, generated artifacts, active policy, or
  any historical receipt.
- A required gate or verified review finding remains unresolved.

## Out of Scope

- Runtime-headroom authentication, profile promotion, or parameter migration.
- Raising `maxNodeRows` to 30; that requires the separate M4.67 evidence slice.
- Projection-depth/node or unknown-expression/exception-flow implementation.
- Runtime cutover, KIR v1 freeze, release-candidate publication, Fable work, or
  a KERN 5 completion claim.
