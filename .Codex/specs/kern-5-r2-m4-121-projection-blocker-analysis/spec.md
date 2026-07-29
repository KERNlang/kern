# KERN 5 R2 M4.121 — Projection and Canonical-Surface Blocker Analysis

**Status:** VERIFIED; PUBLICATION PENDING
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.120 commit
`195e3fbadc48146c520a5cbcfcbb1b3567db2717` freezes the exact
five-function post-M4.119 residual frontier and proves that ordinary profile
widening cannot act while structural projection fails.

[VERIFIED] Live counterfactual measurement separates the remaining blockers:

- `rejectLine` requires only KIR `maxDepth: 77`, then projects at
  `8/15/106` rows and completes under the current profile;
- `quotesource` requires `maxDepth: 93`, then projects at `54/82/932` rows
  but retains six unsupported text-character constraints;
- `expressionsources` and `canonicalize` remain structurally unprojectable
  because `new` expressions are outside the structural expression catalog;
  and
- `validate` requires `maxBytes: 273051`, `maxDepth: 98`, and
  `maxNodes: 5313`, then projects at `202/308/4493` rows and still exceeds
  every current profile axis.

[DECIDED] M4.121 is analysis-only. It publishes exact requirements and ranks
only settings derived from observed minima. It changes no KIR/runtime/profile
policy, KERN source, expression catalog, runtime ABI, generated tool, or
cumulative base coverage.

[VERIFIED] The deterministic first candidate changes only KIR `maxDepth` from
76 to 77 and makes exactly one checker function with five direct parameter
rows complete.

[DECIDED] M4.122 must authenticate structural KIR and runtime-envelope safety
for depth 77 before any policy promotion. M4.121 is not KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main`
`195e3fbadc48146c520a5cbcfcbb1b3567db2717`.

[VERIFIED] The immutable M4.120 receipt SHA-256 is
`02789e8cc4f0fff5da641942cf1716e5fdc6c71975170afd82524fccef487bc5`.
It authenticates:

- 102/112 base-complete functions;
- five legacy parameter blockers and five residual functions;
- zero parameter-ready functions and parameter rows;
- profile limits `122/193/2411`;
- reason-assignment digest
  `7590a3a7dbc3bbd11ca4a05c81e52a907d8cdd5619e4b2a78e198975673c84fe`;
  and
- a null profile-widening action.

[VERIFIED] Current structural KIR limits are exactly:

- `maxBytes: 262144`;
- `maxDepth: 76`; and
- `maxNodes: 4096`.

## Measurement Contract

[DECIDED] For every exact M4.120 assignment, M4.121 removes the legacy
`fn.params` property in memory, inserts the ordered direct-`param` prefix, and
evaluates the canonical structural KIR codec.

[DECIDED] Only declared numeric KIR limits may vary. Every exact minimum must
pass while the immediately lower value fails with the expected structural
limit code. Unsupported expression kinds remain explicit non-limit outcomes.

[VERIFIED] A generous bounded probe projects three functions and leaves two
functions unsupported. Exact projected requirements are:

| Function | Required KIR change | Profile rows | Remaining canonical blockers |
|---|---:|---:|---|
| `rejectLine` | depth 77 | 8/15/106 | none |
| `quotesource` | depth 93 | 54/82/932 | six text characters |
| `validate` | bytes 273051, depth 98, nodes 5313 | 202/308/4493 | all three profile axes |

[VERIFIED] Both unsupported roots fail with
`projection.unknown-expression-kind`; the structural error paths identify
`new` expressions in the direct-parameter migrated roots.

[DECIDED] Candidate settings are derived only from the three exact projected
requirements. Completion delegates to the canonical migration and completion
owners with current base and profile limits.

[DECIDED] Candidate ordering remains capability-neutral: fewer changed KIR
axes, more completed tools, lower total limit delta, more completed functions,
then the canonical limit signature.

## Selected Candidate

[VERIFIED] The first candidate is exactly:

```json
{
  "changedLimits": ["maxDepth"],
  "completeFunctions": 1,
  "completeTools": 1,
  "kirLimits": {
    "maxBytes": 262144,
    "maxDepth": 77,
    "maxNodes": 4096
  },
  "migratedParameterRows": 5,
  "totalDelta": 1,
  "witnesses": [
    "examples/capstone-checker-subset/checker.kern#2:rejectLine"
  ]
}
```

[DECIDED] This is a recommendation, not a promotion.

## Implementation Plan

1. Add a RED test importing the absent M4.121 analysis boundary.
2. Implement exact five-function projection requirement measurement against
   the immutable M4.120 population.
3. Freeze canonical receipt bytes, source commit, input digest, requirements,
   candidate ranking, and selected witness.
4. Add mutation, lower-bound, historical-preservation, fresh-process, central
   integration, and terminal-status guards.
5. Regenerate deterministic summaries twice, run targeted and complete
   canonicalizer gates, the full Node 22 KERN 5 fitness wall, and mandatory
   high-risk automatic role-lens review.
6. Create one signed commit, fetch/rebase, push once to `main`, and verify the
   remote hash.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-121-projection-blocker-analysis/spec.md` | add | Claim and evidence boundary |
| `projection-analysis-m4-121.mjs` | add | Deterministic live measurement and immutable loader |
| `projection-analysis-m4-121.json` | add | Canonical published handoff |
| `projection-analysis-m4-121.test.mjs` | add | Exact receipt, drift, minima, history, and fresh-process oracle |
| `coverage-m4-121-central.mjs` | add | Keep exact assertions outside the oversized wall driver |
| `coverage-status.{mjs,test.mjs}` | modify | Publish the M4.122 safety handoff |
| `check-kern-canonicalizer-coverage.mjs` | modify | Make the receipt release-blocking |
| generated coverage summaries | modify | Refresh authenticated implementation digests |

## Acceptance Criteria

- [x] RED fails because `projection-analysis-m4-121.mjs` is absent.
- [x] Exact M4.120 digest, assignment digest, and five-function population
      authenticate.
- [x] Current KIR base remains exact `262144/76/4096`.
- [x] Three functions project under the bounded probe and two remain
      unsupported with `unknown-expression-kind`.
- [x] Every projected minimum passes and value-minus-one fails with the
      expected limit code.
- [x] Requirements reproduce exact rows and minima for `rejectLine`,
      `quotesource`, and `validate`.
- [x] Exactly three observed settings are ranked.
- [x] Selected action is exact depth 77, one checker function, and five
      parameter rows with witness `rejectLine`.
- [x] Receipt is canonical JSON, byte-frozen by SHA-256, rejects semantic and
      decorated drift, and reproduces in a locale-independent process.
- [x] M4.120 and earlier historical receipts remain byte-exact.
- [x] Current KERN source, generated tools, coverage policy,
      KIR/runtime/profile limits, runtime ABI, and cumulative base coverage
      remain unchanged.
- [x] Status hands off depth-77 safety proof to M4.122 without claiming a
      promotion.
- [x] Targeted tests, complete canonicalizer gates, and the full Node 22
      KERN 5 fitness wall pass.
- [x] Full-roster automatic role-lens review has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic push and remote
      `main` verifies identically.

## Verification Evidence

[VERIFIED] The RED import test failed before
`projection-analysis-m4-121.mjs` existed.

[VERIFIED] The published receipt SHA-256 is
`2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1`.
The regenerated coverage summary and prerequisite summary SHA-256 values are
respectively
`2e49e629e454b55a13c79b48be2318dde11373ef5484effb59296d7f4e8f81dd`
and
`c5855b1e295ee26a19ecda0c1e90fec2e84f69f082d916651140a04542e43725`.

[VERIFIED] Focused M4.121 and status tests pass 5/5. The complete
canonicalizer gate passes 546/546 Node tests, 55 golden/idempotence/KIR
fixtures, 8 measured witnesses, 3 profile-limit fixtures, and 235 hostile
fixtures.

[VERIFIED] `pnpm fitness:kern-5` passes under Node 22, including repository
consistency, lint over 1327 files, production builds, all 22 workspace package
test suites, release-policy and semantic-ownership gates, structural KIR,
runtime-envelope and runtime-ABI gates, cross-target conformance, native KERN
tests with complete coverage, runner smoke tests, app behavior, browser
budget, KIR seam and reader probes, and the terminal canonicalizer repetition.

[VERIFIED] Automatic high-risk role-lens review completed with all 6/6 usable
reviewers. Consensus reported zero verified findings, one needs-check
maintainability concern, two speculative findings, and no blocker. The
needs-check suggestion to share the M4.110/M4.121 analyzer was rejected because
milestone owners are intentionally versioned archival boundaries and changing
the published M4.110 implementation would enlarge this analysis-only slice.
The speculative symlink concern matches the established M4.110 and earlier
receipt-loader contract and did not reproduce under the complete fitness wall.
No material finding remains unresolved.

## Stop Conditions

- M4.120 receipt, assignment digest, or live five-function population differs.
- A measured minimum does not fail exactly one value below with the expected
  structural limit code.
- Candidate selection requires an invented limit or preferred tool.
- Depth 77 does not select exactly `rejectLine` with five parameter rows.
- Implementation requires a KIR/runtime/profile policy, KERN source,
  expression catalog, generated tool, runtime ABI, or base-coverage change.

## Out of Scope

- Promoting KIR depth 77 or changing a runtime envelope.
- Migrating `rejectLine` or any other legacy parameter signature.
- Adding `new`, exception-flow, or text-character support.
- Raising profile, KIR byte, or KIR node limits.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release, or
  Fable work.

## Open Questions

None.
