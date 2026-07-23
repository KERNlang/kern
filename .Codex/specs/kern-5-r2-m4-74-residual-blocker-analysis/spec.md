# KERN 5 R2 M4.74 — Residual Blocker Analysis

**Status:** IMPLEMENTED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.73 commit
`1fe7851101cf2a25e1aebfd561655bb458aec66b` consumed the complete M4.72
parameter queue. The live boundary is 79/104 base-complete functions, 24
legacy `fn.params` blockers, an empty parameter queue, and 24 residual
functions under unchanged 31/53/388 policy.

[DECIDED] M4.74 is an analysis-only release slice. It freezes every current
residual assignment, derives candidate profile settings only from observed
function rows, preserves the published ranking algorithm, and emits one exact
next action. It changes no KERN source, generated consumer, active profile,
coverage family, runtime, KIR, ABI, public contract, package version, or
historical receipt. KERN 5 remains incomplete.

## Published Input

[VERIFIED] The fresh branch
`feat/kern-5-r2-m4-74-residual-analysis` starts from exact `origin/main`
commit `1fe7851101cf2a25e1aebfd561655bb458aec66b` with a clean worktree.

[VERIFIED] Published M4.73 binds:

- base identity `kern.kir-canonicalizer.profile.m4.60`;
- active limits 31 node rows, 53 property rows, and 388 value rows;
- 79/104 base-complete functions, 24 legacy blockers, 24 residuals, and no
  parameter-ready function;
- coverage implementation digest
  `7a378888f6dad20dc2b56660658068b02d169e312d25385e0de76f9ec9b63b49`;
- coverage-policy digest
  `60c907324d92462afdd16fb6d43b6f4ff837231cdf561caece4ad064053ab2f9`;
- function-fact digest
  `5bd2779a0abc83fcb9bd0f5bcfe74e162e3d45fd0c6dda4a37c9caef573fba03`;
- coverage-summary SHA-256
  `68df5ada4f4da0e81d2c0840851871f52347dc210305d69e121c79e989095d31`;
- prerequisite-summary SHA-256
  `5212bf7447ff9264ace9450191311a93ef02a900b0da816275936293c0348c73`;
- corpus digest
  `47165ce1ef23445d3e66f268b3785f400453113a2ceef3c96139ccef083015d5`;
- canonicalizer digest
  `c1b42e6183731a757cdad7150339ec38090c11aeaa6404095ae16f34412a3b89`;
  and
- exhaustion reason-assignment digest
  `bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831`.

## Analysis Contract

[DECIDED] Reuse format `kern.kir-canonicalizer.residual-analysis.3` and the
published M4.70 algorithm without changing ranking semantics:

1. migrate each live legacy function only in memory under the current base;
2. require an empty parameter-ready partition and exactly 24 residuals;
3. assign each residual its exact id, tool, parameter rows, measured profile
   rows or `null`, and sorted union of excluded-property/profile reasons;
4. hash canonical ordered `{id,reasons}` assignments;
5. derive one candidate setting per residual with profile rows by independently
   raising each axis only to `max(current, observed)`;
6. discard the unchanged setting and candidates completing zero functions;
7. rank by fewest changed axes, most complete tools, smallest total delta, most
   complete functions, then canonical limits text; and
8. publish the first candidate without changing live policy.

[VERIFIED] Read-only execution against exact M4.73 input produces:

- 24 assignments;
- assignment digest
  `bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831`;
- eight residual functions with measurable profile rows;
- eight distinct non-current observed settings; and
- eight actionable candidates.

## Exact Selected Action

[VERIFIED] The unique ranked recommendation is:

```json
{
  "changedLimits": ["maxNodeRows", "maxValueRows"],
  "completeFunctions": 1,
  "completeTools": 1,
  "limits": {
    "maxNodeRows": 38,
    "maxPropertyRows": 53,
    "maxValueRows": 461
  },
  "totalDelta": 80,
  "witnesses": [
    "examples/kern-canonicalizer/canonicalizer.kern#0:typesource"
  ]
}
```

[VERIFIED] `typesource` has six legacy parameter rows, exact measured profile
rows 38/51/461, tool `canonicalizer`, and residual reasons
`profile.rows.nodes` plus `profile.rows.values`. Its property rows already fit
the active 53-row ceiling. The next ranked candidate changes all three axes to
74/77/572 for five functions and three tools, so it ranks after the unique
two-axis action. M4.74 does not claim structural runtime headroom for 38/461.

[VERIFIED] The canonical published receipt SHA-256 is
`dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0`.
After all M4.74 `.mjs` bytes settled, the repository writer changed only the
live coverage implementation digest to
`025fbf7ea33aecf8e1ee36fc6ef2334fbb2a71641777660473953e9da38a36ee`.
The resulting live coverage-summary SHA-256 is
`728cf911c27bd81ccbd466d9dbb2c3a7ef08fd7131eda446168cd05a8d8b3e2d`
and the prerequisite-summary SHA-256 is
`57f140620f1d8b604b709708e7a2480d2e08311ab045f5c02a77b6d754f8b4be`.

[VERIFIED] The focused M4.74/status suite passes 22/22. The complete
canonicalizer gate passes 282/282 tests plus 55 golden/idempotence/KIR
fixtures, eight measured witnesses, three profile-limit fixtures, and 235
hostile fixtures. The full Node 22 aggregate ends with
`KERN 5 current fitness wall passed.`

[VERIFIED] High-risk role-lens review run
`/Users/nicolascukas/.agon/runs/review-1784845794416-8n1gtq` used all six
usable independent identities. The review found one genuine test gap: the
receipt tests authenticated loaded bytes but did not compare the live M4.74
analyzer result with those published bytes. The test now asserts exact live
measurement equality. The suggested shared-validator refactor was rejected
because milestone validators are deliberately self-contained so historical
receipts cannot drift through mutable shared logic. The new test byte changed
the authenticated implementation digest, so the repository writer refreshed
only the two live summaries to the hashes above.

[VERIFIED] After the review fix and final summary regeneration, the focused
suite passes 22/22 again, the complete 282-test canonicalizer chain reaches
its terminal checker, and the terminal checker again passes all 301 fixture
classes plus the exact M4.74 coverage assertion.

## Files and Evidence

[DECIDED] Add only:

- this claim-tagged specification;
- `coverage-residual-analysis-m4-74.mjs`;
- canonical receipt `coverage-residual-analysis-m4-74.json`; and
- `coverage-residual-analysis-m4-74.test.mjs`.

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

1. Add a focused test importing the absent M4.74 module and requiring the
   grounded 24-assignment/eight-setting/one-witness result; capture RED.
2. Implement the M4.74 analyzer by preserving the M4.70 schema, canonical-data
   validator, ranking, regular-file/symlink rejection, and writer-only entry.
3. Generate the canonical receipt through its repository writer and bind its
   exact SHA-256 plus M4.73 input commit.
4. Add mutation tests for format, decoration, assignments, ordering, baseline,
   limits, witnesses, cycles, and shared references; prove M4.70 and earlier
   receipts remain exact and fresh-process loading is byte-identical.
5. Integrate exact terminal/status evidence and regenerate current summaries
   only after all implementation bytes settle.
6. Run focused tests, complete canonicalizer, full Node 22 fitness, high-risk
   role-lens review, signed commit, final fetch/rebase, one atomic authorized
   push, and exact remote-ref verification.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.73 commit `1fe78511`.
- [x] Current 79/24/24 empty-queue boundary and input digests are grounded.
- [x] Read-only ranking measures 24 assignments and an eight-setting frontier.
- [x] Exact selected action is dual-axis 31/53/388 to 38/53/461 for
      `typesource` only.
- [x] RED proves the M4.74 module/receipt is absent.
- [x] Receipt contains exactly 24 assignments and eight actionable candidates.
- [x] Assignment digest and selected action match the grounded contract.
- [x] Published bytes are canonical, immutable, input-bound, and non-symlink.
- [x] Mutation, history, and fresh-process tests fail closed.
- [x] No KERN source, generated artifact, active profile, family, or historical
      receipt changes.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push;
      feature and `main` refs verify identically.

## Stop Conditions

- M4.73 commit, baseline digests, counts, or active limits differ.
- Any residual lacks exactly one canonical assignment.
- Candidate settings are invented rather than derived from observed rows.
- Ranking does not select only `typesource` under dual-axis 38/53/461.
- Implementation changes KERN source, generated artifacts, active policy, or
  any historical receipt.
- A required gate or verified review finding remains unresolved.

## Out of Scope

- Runtime-headroom authentication, profile promotion, or parameter migration.
- Raising either row limit; that requires separate runtime evidence and profile
  promotion slices.
- Projection depth/nodes, unknown-expression, exception-flow, runtime-cutover,
  KIR v1 freeze, RC/stable release, Fable work, or a KERN 5 completion claim.
