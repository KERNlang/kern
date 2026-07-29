# KERN 5 R2 M4.120 — Residual Frontier Analysis

**Status:** VERIFIED; PUBLICATION PENDING
**Date:** 2026-07-29
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.119 commit
`2ffe06f0c31e7b6cbdea62f47df97f5a94b66dad` consumes the final
one-function/58-row parameter queue and leaves a 102/112 base-complete
frontier with five legacy `fn.params` blockers.

[DECIDED] M4.120 publishes an immutable residual-analysis receipt over that
exact frontier. It changes no KERN source, generated tool, coverage policy,
profile limit, runtime/KIR limit, runtime ABI, or cumulative base coverage.

[VERIFIED] Read-only measurement finds no structurally actionable profile
widening: every remaining projection has `profileRows: null`, so there are
zero observed settings, zero actionable candidates, and a null selected
action.

[DECIDED] M4.121 investigates the authenticated projection and canonical
surface blockers. M4.120 does not authorize a limit or language-surface
change and is not KERN 5 completion.

## Published Input

[VERIFIED] This slice starts from exact `origin/main`
`2ffe06f0c31e7b6cbdea62f47df97f5a94b66dad`.

[VERIFIED] The M4.119 baseline is:

- 102/112 base-complete functions;
- five legacy parameter blockers and five residual functions;
- zero parameter-ready functions and zero parameter rows;
- profile limits 122 node rows, 193 property rows, and 2,411 value rows;
- coverage implementation digest
  `b99cc57c7ec9cc55da813e818b60688685fe86b4ae79753fa3b457aa25b61686`;
- coverage policy digest
  `bb64551fcdbacd85759a86f9cd7703ffe7fa14505cfe1a935223d7fe2b953534`;
- function facts digest
  `5f9f2e022f5fd23e8ebdde4523de7a538a49d2d105d2fd04807cd84f99d58906`;
  and
- residual reason-assignment digest
  `7590a3a7dbc3bbd11ca4a05c81e52a907d8cdd5619e4b2a78e198975673c84fe`.

## Analysis Contract

[DECIDED] M4.120 reuses residual-analysis format
`kern.kir-canonicalizer.residual-analysis.3` and its deterministic candidate
ranking. It adds no policy axis and assigns no preferred blocker.

[VERIFIED] Exact read-only measurement produces:

- `rejectLine`, five parameter rows, blocked by projection depth;
- `quotesource`, two parameter rows, blocked by projection depth and six
  unsupported text characters;
- `expressionsources`, six parameter rows, blocked by an unknown let-value
  expression and projection expression kind;
- `canonicalize`, 15 parameter rows, blocked by unknown projection and throw
  expression kinds;
- `validate`, 41 parameter rows, blocked by projection node count;
- zero functions with complete profile rows;
- zero distinct observed profile settings;
- zero actionable profile-widening candidates; and
- `selectedNextAction: null`.

[DECIDED] Terminal status hands off to M4.121 projection/canonical-surface
investigation without implying that KIR depth, node limits, or expression/text
support is approved.

## Implementation Plan

1. Add a RED test importing the absent M4.120 receipt boundary.
2. Add a closed measurement, validation, and loader module bound to the exact
   M4.119 baseline and five residual assignments.
3. Write the canonical immutable JSON receipt through the repository writer.
4. Add mutation, history, fresh-process, central integration, and terminal
   status guards.
5. Run focused and complete canonicalizer gates, the full Node 22 KERN 5
   fitness wall, and mandatory automatic high-risk role-lens review.

## Acceptance Criteria

- [x] RED fails at the absent M4.120 module boundary.
- [x] Exact M4.119 baseline and five-function residual population authenticate.
- [x] All five assignments reproduce reason digest
      `7590a3a7dbc3bbd11ca4a05c81e52a907d8cdd5619e4b2a78e198975673c84fe`.
- [x] Receipt proves zero profile-row facts, settings, and candidates.
- [x] Selected next action is exactly null.
- [x] Receipt uses canonical JSON, is byte-frozen by SHA-256, rejects semantic
      and decorated drift, and reproduces in a locale-independent process.
- [x] M4.114 history remains byte-exact.
- [x] Current KERN source, generated tools, coverage policy, KIR/runtime/profile
      limits, runtime ABI, and cumulative base coverage remain unchanged.
- [x] Status hands off to M4.121 projection/canonical-surface investigation.
- [x] Targeted tests and complete canonicalizer gates pass.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Full-roster Agon review succeeds 6/6 with no verified blocker; the one
      verified copy-paste nit was fixed and its focused gates pass.
- [ ] Signed commit is fetched/rebased before one atomic push and remote `main`
      verifies identically.

## Stop Conditions

- Live M4.119 semantic facts differ from the published baseline or reason
  digest.
- Any residual assignment lacks an authenticated blocker.
- Any observed profile setting or actionable candidate appears.
- The slice requires changing KERN source, generated tools, policy, profile,
  runtime/KIR limits, runtime ABI, or historical receipt bytes.
- Status or receipt wording authorizes a projection or language-surface change.

## Out of Scope

- Choosing or changing projection depth/node limits.
- Adding unknown-expression, text-character, or exception-flow support.
- Migrating any of the five remaining legacy parameter signatures.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release, or
  Fable work.

## Open Questions

None.
