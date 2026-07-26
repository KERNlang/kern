# KERN 5 R2 M4.92 — Residual Profile Analysis

**Status:** PUBLISHED
**Date:** 2026-07-26
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.91 commit
`730aa181e1e3ea40b88dd22f74c58e853a706009` consumes the exact M4.90
four-function/47-row parameter queue. The current frontier is 88/106
base-complete functions, 18 legacy `fn.params` blockers, no parameter-ready
queue, and bounded active-family exhaustion under the 74/77/580 profile.

[DECIDED] M4.92 publishes an immutable residual-analysis receipt from those
exact M4.91 facts. It does not change KERN source, generated tools, coverage
policy, runtime limits, KIR limits, or cumulative base coverage.

[DECIDED] KERN 5 remains incomplete after M4.92. This slice selects evidence
for the next runtime-headroom card only; it does not promote a profile, migrate
parameters, cut over the runtime, freeze KIR v1, or claim semantic self-hosting.

## Published Input

[VERIFIED] The branch starts clean from `origin/main` at exact commit
`730aa181e1e3ea40b88dd22f74c58e853a706009`.

[VERIFIED] The M4.91 baseline is:

- 88/106 base-complete functions;
- 18 legacy parameter blockers and 18 residual functions;
- profile limits 74 node rows, 77 property rows, and 580 value rows;
- coverage implementation digest
  `e7657b9c2a8e2a238bc5f1dbc190a804341a17d5cc70ed4e595aeea1062813c3`;
- coverage policy digest
  `6cbdac4c6dfaa9746be103d1d8d10f01d89655f9e7ba9b2299f418d27beb9453`;
- function facts digest
  `df84fe6408fa96768ec67f9c2940ac27277ae7dbc1f0c81dbfb2ced29f58a225`;
- residual reason-assignment digest
  `b222027da0639addba00e2c0149684e1e02a9bfd199feacae921b5fc028e07fe`.

## Analysis Contract

[DECIDED] M4.92 uses the existing deterministic ranking:

1. fewer changed profile axes;
2. more completed tools;
3. lower total row-limit delta;
4. more completed functions;
5. canonical lexical limit order.

[EXPECTED] The smallest actionable observed setting is 74/95/832. It changes
only `maxPropertyRows` and `maxValueRows` and should complete exactly:

`examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk`.

[EXPECTED] Its exact parameter row count is 24 and its exact measured profile
is 53 node rows, 95 property rows, and 832 value rows. The analysis module must
measure and authenticate this result; these expected values are not permission
to bypass live fact comparison.

## Implementation Plan

1. Add a RED test importing the absent M4.92 analysis boundary.
2. Add a closed M4.92 measurement/validation/loader module bound to the exact
   M4.91 baseline and reason assignments.
3. Write the canonical immutable JSON receipt through the repository writer.
4. Add mutation, historical-preservation, fresh-process, central integration,
   and status-format guards.
5. Run focused and complete canonicalizer gates, full Node 22 KERN 5 fitness,
   six-engine high-risk review, then one fetch/rebase-first atomic push.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.91 commit `730aa181`.
- [x] RED fails at the absent M4.92 module boundary.
- [x] Exact M4.91 baseline and all 18 residual reason assignments authenticate.
- [x] Analysis evaluates only observed row settings and preserves deterministic
      candidate ordering.
- [x] Selected action is exactly one 24-parameter checker function at
      candidate limits 74/95/832.
- [x] M4.92 changes no KERN source, generated tool, profile, runtime, KIR, or
      cumulative base-coverage state.
- [x] M4.87–M4.91 receipts remain immutable and exact.
- [x] Focused, complete, and full Node 22 KERN 5 gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- The live M4.91 facts differ from the published baseline or reason digest.
- Any residual assignment lacks an authenticated blocker.
- The deterministic ranking does not select the expected single checker
  witness at 74/95/832.
- Completing the slice requires changing KERN source, policy, runtime/KIR
  limits, generated artifacts, or historical receipt bytes.

## Out of Scope

- Measuring or approving structural runtime headroom for 74/95/832.
- Promoting property/value row limits or publishing a parameter queue.
- Migrating `comparisonOperandsOk`.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, release versioning,
  RC/stable release, or Fable.

## Plan Delta

[VERIFIED] The live M4.91 facts reproduce all 18 residual assignments and the
published reason digest exactly. Only two residual functions have measurable
profile rows above the active limits, producing exactly two observed candidate
settings.

[VERIFIED] The deterministic ranking selects 74/95/832 and exactly
`comparisonOperandsOk` with 24 parameter rows. The second candidate,
89/125/2100, completes both `comparisonOperandsOk` and `validstatement` but
changes three axes and therefore ranks behind the selected two-axis widening.

[VERIFIED] The immutable receipt SHA-256 is
`c6311d6351db075292af7a36a850787dd3bdf135ab290b60098da3ce25509e24`.
Focused M4.92/status tests and the complete non-performance canonicalizer
suite pass, including exact writer reproduction and fresh-process loading.

[VERIFIED] The focused M4.92/status suites pass 40/40, the complete
canonicalizer suite passes 377/377, and the full Node 22
`pnpm fitness:kern-5` wall completes successfully.

[VERIFIED] Six independent high-risk role-lens reviewers completed
successfully. The only two elevated suggestions were checked against the
repository: the receipt-module similarity is the intentional immutable
milestone pattern already used by M4.87, while the proposed shared frontier
implementation is actually the frozen M4.31 receipt loader and contains no
ranking algorithm to reuse. No material finding remains.
