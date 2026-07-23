# KERN 5 R2 M4.70 — Residual Blocker Analysis

**Status:** IMPLEMENTED — REVIEW GREEN, PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.69 commit
`e5069dc45a9d849ce02dbdc047cdfb78d0c55270` consumed the complete M4.68
parameter queue. The live boundary is 78/104 base-complete functions, 25
legacy `fn.params` blockers, an empty parameter queue, and 25 residual
functions under the unchanged 30/50/388 profile.

[DECIDED] M4.70 is an analysis-only release slice. It freezes every current
residual assignment, derives candidate profile settings only from observed
function rows, ranks them with the existing published algorithm, and publishes
one exact next action. It changes no KERN source, generated consumer, profile,
family, runtime, KIR, ABI, public contract, package version, or historical
receipt. KERN 5 remains incomplete.

## Published Input

[VERIFIED] M4.70 starts from exact source commit
`e5069dc45a9d849ce02dbdc047cdfb78d0c55270` with:

- base identity `kern.kir-canonicalizer.profile.m4.60`;
- active limits 30 node rows, 50 property rows, and 388 value rows;
- 78/104 base-complete functions, 25 legacy blockers, 25 residuals, and no
  parameter-ready function;
- coverage implementation digest
  `fd676b3f50986582e76ee96ea93df91d02f36772234770359f35a2bcf5546251`;
- coverage-policy digest
  `10f2a65c811aef65be7cf0190017010f0bd79d5c6c5245221135ed9e2ca31fda`;
- function-fact digest
  `869bfeb7d4694f22ae9c088c649be1c3750a4ca576eef651c7244c31bec0ddee`;
- coverage-summary and prerequisite-summary SHA-256 values
  `b560b3db4986ef317946e795d4ae700d1a4fd9e3edc094f5788222e3d361bdf7`
  and `3d8f65eb97d522f4c585e35eac8a7840ccbd031fcee85c89ae322f7738b0d389`;
- corpus digest
  `2d76f3cc2874f90ef24f070a4f342f22668659fc2ef472f4b754c1ac0ee7f2b2`;
- canonicalizer digest
  `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
  and
- live exhaustion reason-assignment digest
  `42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685`.

## Analysis Contract

[DECIDED] Reuse format `kern.kir-canonicalizer.residual-analysis.3` and the
published M4.66 algorithm:

1. migrate each live legacy function only in memory under the current base;
2. require an empty parameter-ready partition and exactly 25 residuals;
3. assign each residual its exact id, tool, parameter rows, measured profile
   rows or `null`, and sorted union of excluded-property/profile reasons;
4. hash the canonical ordered `{id,reasons}` assignments;
5. derive one candidate setting per residual with profile rows by independently
   raising each axis only to `max(current, observed)`;
6. discard the unchanged setting and candidates completing zero functions;
7. rank by fewest changed axes, most complete tools, smallest total delta, most
   complete functions, then canonical limits text; and
8. publish the first candidate without changing the live profile.

[VERIFIED] Read-only execution of that algorithm against the exact M4.69 input
produces:

- 25 assignments;
- assignment digest
  `42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685`;
- nine residual functions with measurable profile rows;
- nine distinct non-current observed settings; and
- nine actionable candidates.

[VERIFIED] The repository writer produced canonical receipt SHA-256
`2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401`.

## Exact Selected Action

[VERIFIED] The unique ranked recommendation is:

```json
{
  "changedLimits": ["maxNodeRows", "maxPropertyRows"],
  "completeFunctions": 1,
  "completeTools": 1,
  "limits": {
    "maxNodeRows": 31,
    "maxPropertyRows": 53,
    "maxValueRows": 388
  },
  "totalDelta": 4,
  "witnesses": [
    "examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist"
  ]
}
```

[VERIFIED] `validstatementlist` has 14 legacy parameter rows, exact measured
profile rows 31/53/370, tool `canonicalizer`, and residual reasons
`profile.rows.nodes` plus `profile.rows.properties`. The next ranked candidate
changes all three axes to 74/77/572 for six functions and three tools, but its
three changed axes rank after the selected two-axis action. M4.70 does not
claim structural runtime headroom for 31/53 rows.

## Files and Evidence

[DECIDED] Add only:

- this claim-tagged specification;
- `coverage-residual-analysis-m4-70.mjs`;
- canonical receipt `coverage-residual-analysis-m4-70.json`; and
- `coverage-residual-analysis-m4-70.test.mjs`.

[DECIDED] Update only direct current evidence consumers:

- coverage status formatter and test;
- coverage checker registration, assertions, and terminal evidence;
- current coverage implementation digest/summary and direct expectations; and
- historical/current tests whose live-summary pins intentionally authenticate
  the settled current implementation.

[DECIDED] Every historical receipt, all KERN source, generated KERN artifacts,
coverage policy semantics, and active profile bytes remain unchanged. After
all `.mjs` bytes settle, regenerate current summaries only through the
repository-owned writer.

## RED and Implementation Plan

1. Add a focused test importing the absent M4.70 module and requiring the
   grounded 25-assignment/9-setting/one-witness result; capture RED.
2. Implement the M4.70 analyzer by preserving the M4.66 schema, canonical-data
   validator, ranking, regular-file/symlink rejection, and writer-only entry.
3. Generate the canonical receipt through its repository writer and bind its
   exact SHA-256 plus M4.69 input commit.
4. Add mutation tests for format, decoration, assignments, ordering, baseline,
   limits, witnesses, cycles, and shared references; prove M4.66 and earlier
   receipts remain exact and fresh-process loading is byte-identical.
5. Integrate exact terminal/status evidence and regenerate current summaries
   only after all implementation bytes settle.
6. Run focused tests, complete canonicalizer, full Node 22 fitness, high-risk
   role-lens review, targeted review-fix gates if needed, signed commit, final
   fetch/rebase, one atomic authorized push, and remote ref verification.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.69 commit `e5069dc4`.
- [x] Current 78/25/25 empty-queue boundary and input digests are grounded.
- [x] Read-only ranking measures 25 assignments and a nine-setting frontier.
- [x] Exact selected action is dual-axis 30/50 → 31/53 for
      `validstatementlist` only.
- [x] RED proves the M4.70 module/receipt is absent.
- [x] Receipt contains exactly 25 assignments and nine actionable candidates.
- [x] Assignment digest and selected action match the grounded contract.
- [x] Published bytes are canonical, immutable, input-bound, and non-symlink.
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
  `0aeeed3bff415320699728083fedb6f174ca66b956e67e0fb53c0b8a8437edc6`;
- coverage-policy digest
  `10f2a65c811aef65be7cf0190017010f0bd79d5c6c5245221135ed9e2ca31fda`;
- function-fact digest
  `869bfeb7d4694f22ae9c088c649be1c3750a4ca576eef651c7244c31bec0ddee`;
- coverage-summary SHA-256
  `426b283e3e26714cdb42c46c732da85a854814f721dd263b50d890737ecd603a`;
- prerequisite-summary SHA-256
  `44d1defc107af16fd29505a24e0e8b7dda22a1831fd4dd4087517d906ec3c18d`;
- M4.70 receipt SHA-256
  `2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401`.

[VERIFIED] The first writer attempt failed closed because adding an
authenticated M4.70 `.mjs` file necessarily changed the live implementation
digest. The traced predecessor contract records the M4.69 digest in the frozen
baseline while comparing only live semantic facts that remain stable across
the new analysis implementation. Restoring that established lifecycle allowed
the writer to publish the exact grounded receipt without weakening semantic
input validation.

[VERIFIED] The affected cluster passed 58/58 tests. The complete canonicalizer
gate passed 262/262 Node tests plus 55 golden/idempotence/KIR fixtures, eight
measured witnesses, three profile-limit fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 release wall exited zero with terminal marker
`KERN 5 current fitness wall passed.` Its outer final canonicalizer rerun again
passed 262/262 Node tests plus the same 55 golden/idempotence/KIR, eight
measured-witness, three profile-limit, and 235 hostile fixtures.

[VERIFIED] Independent high-risk role-lens review completed with all 6/6 usable
reviewers and zero verified findings. The single needs-check item correctly
identified that M4.70 preserves the established per-milestone immutable
analysis-module pattern. Extracting a shared factory would widen this
analysis-only slice across historical implementation modules and invalidate
the settled implementation closure, so it is a separate refactor rather than
an M4.70 fix. The five nits were also checked: repository history confirms
prior M4 specs are tracked; the oversized checker and per-milestone formatter
are pre-existing release-evidence conventions; and repeated digest literals
are intentional independent pins. No review-driven code change is warranted.

## Stop Conditions

- M4.69 commit, baseline digests, counts, or active limits differ.
- Any residual lacks exactly one canonical assignment.
- Candidate settings are invented rather than derived from observed rows.
- Ranking does not select only `validstatementlist` under dual-axis 31/53/388.
- Implementation changes KERN source, generated artifacts, active policy, or
  any historical receipt.
- A required gate or verified review finding remains unresolved.

## Out of Scope

- Runtime-headroom authentication, profile promotion, or parameter migration.
- Raising either row limit; that requires separate runtime evidence and profile
  promotion slices.
- Projection-depth/node or unknown-expression/exception-flow implementation.
- Runtime cutover, KIR v1 freeze, release-candidate publication, Fable work, or
  a KERN 5 completion claim.
