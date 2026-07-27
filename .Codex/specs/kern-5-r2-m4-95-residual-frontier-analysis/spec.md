# KERN 5 R2 M4.95 — Residual Frontier Analysis

**Status:** IMPLEMENTED — COMPLETE FITNESS AND INDEPENDENT REVIEW PASSED
**Date:** 2026-07-27
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.94 commit
`c623388fe7f8a8c288743f85bfaf79d55f889b94` consumes the exact M4.93
one-function/12-row `tablesok` parameter queue. The current frontier is 89/109
base-complete functions, 17 legacy `fn.params` blockers, no parameter-ready
queue, and bounded active-family exhaustion under the unchanged 74/77/580
profile.

[DECIDED] M4.95 publishes an immutable residual-analysis receipt from those
exact M4.94 facts. It changes no KERN source, generated tool, coverage policy,
runtime/KIR limit, runtime ABI, or cumulative base coverage.

[DECIDED] M4.95 does not repeat M4.93's unbounded production observation and
does not reinterpret the 74/95/832 structural candidate as proven runtime
headroom. If deterministic structural ranking selects the same checker witness,
M4.96 must investigate the remaining runtime bottleneck before any profile
promotion.

[DECIDED] KERN 5 remains incomplete after M4.95.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`c623388fe7f8a8c288743f85bfaf79d55f889b94`.

[VERIFIED] The M4.94 baseline is:

- 89/109 base-complete functions;
- 17 legacy parameter blockers and 17 residual functions;
- zero parameter-ready functions and zero parameter rows;
- profile limits 74 node rows, 77 property rows, and 580 value rows;
- coverage implementation digest
  `f3e648ceb482e0b6131c97ee884d623169437408bcea83c427bcf61f99543a0c`;
- coverage policy digest
  `3f68fc1e198be2c8072a619170e4494e05c54f8442dffa6271189bbd33a352c7`;
- function facts digest
  `c99b3c527d0e262a3c8876ea3508f52aac8ab8eaf7914fa6b3ff9792c0ab83f0`;
- residual reason-assignment digest
  `ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f`;
  and
- current coverage/prerequisite receipt SHA-256 identities
  `94a111a804372e6b41105bd70fe9031d463961261334b7f98e05e2b91c54e5fa`
  and
  `e7b913f5c2cd6d0bc6d31ad94620e9fe05c926729680f7624647d20f19a6ce6a`.

## Analysis Contract

[DECIDED] M4.95 reuses residual-analysis format
`kern.kir-canonicalizer.residual-analysis.3` and the established deterministic
ranking:

1. fewer changed profile axes;
2. more completed tools;
3. lower total row-limit delta;
4. more completed functions; and
5. canonical lexical limit order.

[VERIFIED] Exactly two residual functions expose complete structural rows:

- `comparisonOperandsOk`: 53/95/832, 24 parameter rows; and
- `validstatement`: 89/125/2100, 14 parameter rows.

[EXPECTED] Observed-setting evaluation should produce exactly two actionable
structural candidates. The deterministic first candidate remains
74/95/832 and completes only:

`examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk`.

[DECIDED] “Actionable” in the format-3 receipt means structurally completing
under the candidate row profile. It does not mean runtime-headroom approved.
The receipt and status text must preserve that distinction.

## Implementation Plan

1. Add a RED test importing the absent M4.95 analysis boundary.
2. Add a closed M4.95 measurement/validation/loader module bound to the exact
   M4.94 baseline and all 17 residual reason assignments.
3. Write the canonical immutable JSON receipt through the repository writer.
4. Add mutation, historical-preservation, changed-frontier regeneration,
   fresh-process, central integration, and status guards.
5. Run focused and complete canonicalizer gates, full Node 22 KERN 5 fitness,
   independent high-risk review, then signed fetch/rebase-first atomic publish.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.94 commit `c623388f`.
- [x] Exact M4.94 baseline and residual population are grounded.
- [x] RED fails at the absent M4.95 module boundary.
- [x] All 17 residual assignments and the exact reason digest authenticate.
- [x] Only observed structural row settings are evaluated.
- [x] Selected structural candidate is exactly one 24-row checker function at
      74/95/832.
- [x] Receipt explicitly avoids a runtime-headroom or promotion claim.
- [x] M4.95 changes no KERN source, generated tool, policy, runtime/KIR limit,
      ABI, or cumulative base-coverage state.
- [x] M4.92/M4.93 immutable receipts and M4.94 source/policy identities remain
      exact.
- [x] Focused, complete, and full Node 22 KERN 5 gates pass.
- [x] Independent high-risk review has no verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- Live M4.94 facts differ from the published baseline or reason digest.
- Any residual assignment lacks an authenticated blocker.
- Candidate ranking differs from the measured observed-setting result.
- The slice requires changing KERN source, coverage policy, runtime/KIR limits,
  runtime ABI, generated artifacts, or historical receipt bytes.
- Status or receipt wording implies production headroom or profile promotion.

## Out of Scope

- Proving runtime headroom for 74/95/832.
- Promoting property/value rows or migrating `comparisonOperandsOk`.
- Implementing projection-depth/node, unknown-expression, or exception-flow
  support.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implemented Evidence

[VERIFIED] The RED oracle failed at the absent M4.95 module boundary before
implementation.

[VERIFIED] The immutable M4.95 receipt SHA-256 is
`f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928`.
It authenticates all 17 residual assignments and exact reason digest
`ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f`.

[VERIFIED] Exactly two observed settings are evaluated. The selected structural
candidate is 74/95/832, changes only property/value rows, and completes exactly
the 24-parameter `comparisonOperandsOk` checker function. The second setting
89/125/2100 completes that checker function plus `validstatement`, but changes
three axes and has a larger total delta.

[VERIFIED] Status output says M4.96 must investigate the remaining runtime
bottleneck before any profile promotion. It does not claim structural runtime
headroom from the M4.93 non-terminal production observation.

[VERIFIED] The first writer attempt failed closed because the new M4.95 module
itself advances the aggregate coverage-implementation digest. The closed design
now preserves the exact pre-slice M4.94 implementation digest as receipt
baseline evidence while comparing live semantic inputs that do not
self-invalidate, matching the established historical analysis boundary.

[VERIFIED] Regenerated current receipt identities are:

- coverage implementation
  `3809c2ccab5fde4616ee355214e971b710e7aaf1a1ee957f8daea5ae02112171`;
- coverage summary
  `134be0baa2805e64259c77fd919042dd9c7599541604196ab9aba5baec69a204`;
  and
- prerequisite summary
  `a1fc571e661be453c7e1a490e65712e8b8cc5318f1941cf2ba80972302b40383`.

[VERIFIED] The M4.95/status suite passes 43/43, the integrated
M4.95/status/prerequisite/history suite passes 60/60, and the complete coverage
family passes 285/285 tests. Central coverage output includes the exact M4.95
handoff.

[VERIFIED] The complete canonicalizer wall passes 393/393 Node tests, 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` release wall exits 0
with `KERN 5 current fitness wall passed`, including repository consistency,
lint/build/workspace tests, source-runner convergence, repeated canonicalizer
walls, cross-target conformance, runner/capstone/self-host smoke, application
behavior, browser budget, KIR closure, semantic ownership, runtime envelope,
and final diff hygiene.

[VERIFIED] The mandatory high-risk role-lens Agon review completed with all six
independent engines successful: 0 verified findings, 2 needs-check findings,
and 14 nits. No reviewer identified a blocking correctness, contract, runtime,
or receipt-integrity defect.

[DECIDED] Both needs-check findings are deferred architectural debt rather than
M4.95 blockers. The central coverage validator accumulates explicit milestone
integration blocks, and the M4.95 module repeats the established immutable
residual-analysis boundary. Consolidating either now would rewrite historical
validation surfaces, advance authenticated implementation identities, and
materially widen this evidence-only slice. The same reasoning disposes the
non-blocking ordering, error-wording, bounded-complexity, and direct-CLI nits.
