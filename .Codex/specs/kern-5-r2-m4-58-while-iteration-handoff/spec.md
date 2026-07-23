# KERN 5 R2 M4.58 While-Iteration Prerequisite Handoff

**Status:** IMPLEMENTED — FULL GATES AND REVIEW PASS; PENDING PUBLICATION
**Date:** 2026-07-20
**Base commit:** `5ad4f524f9e3434fb039033803f2988316a04564`

## Objective

[VERIFIED] M4.57 publishes live coverage at 72/104 base-complete functions
with 31 legacy `fn.params` blockers and no parameter-ready queue. Its exact
next prerequisite is `while-iteration`: two catalog facts and two occurrences
form a one-family closure that completes only
`examples/selfhost-validator/validator.kern#19:sortstrings` at profile
25/43/266 with one legacy parameter row.

[DECIDED] M4.58 freezes that exact published frontier as the sixth immutable
prerequisite-provenance record. It does not implement or promote `while`,
migrate `sortstrings`, alter the canonicalizer, change coverage limits, or
claim additional base completion.

## Immutable Input

[VERIFIED] The authenticated M4.57 inputs are:

- source commit `5ad4f524f9e3434fb039033803f2988316a04564`;
- coverage summary format `kern.kir-canonicalizer.coverage-summary.6` and
  SHA-256 `b6f8ae2a49de9b8c2a859605a6c6a5da1bfcbc90d440efa9cdf259ccb7db7015`;
- prerequisite summary format
  `kern.kir-canonicalizer.prerequisite-summary.3` and SHA-256
  `31a90a6e1bb413939a56ab9637c12c660dbfb6247b24a347698312839c366c58`.

[DECIDED] The canonical provenance snapshot must contain exactly:

- baseline: 72/104 base-complete, base profile
  `kern.kir-canonicalizer.profile.m4.36`, nine corpus members, four tools,
  and 31 legacy parameter blockers;
- selected prerequisite: `while-iteration`, two catalog facts, two
  occurrences;
- winning closure: one function, one tool, family `while-iteration`, one
  parameter row, two occurrences, and only the `sortstrings` witness.

[VERIFIED] The canonical M4.58 provenance bytes authenticate at SHA-256
`5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07`.
The six-record loader module bytes authenticate at
`11cad7ae42af06e90fa18709d8a4c72c2be2f09788c1c8869db54b882e02c839`.

## Behavioral Boundary

[DECIDED] M4.58 must not modify any handwritten `.kern` source, generated
consumer, coverage policy, base profile, family registry, runtime, KIR codec,
ABI, package version, or public API.

[DECIDED] The existing prerequisite provenance chain remains append-only and
ordered: index expression, counted iteration, binding, unary expression, do
statement, then while iteration.

[DECIDED] The exact while handoff must fail closed on noncanonical bytes,
wrong digest, wrong source commit or receipt digest, baseline drift, family or
occurrence drift, closure-count drift, witness substitution, record
reordering, omission, duplication, and unknown/decorated fields.

## Test-First Plan

1. Add exact while-handoff and six-record-chain assertions and capture RED
   while the loader/artifact are absent.
2. Add the canonical provenance JSON and digest-pinned loader entry.
3. Extend cumulative provenance, handoff, status, and release-train evidence
   without changing live coverage or KERN source.
4. Run the focused canonicalizer tests, full Node 22 fitness wall, mandatory
   high-risk role-lens review, then signed publication after fetch/rebase.

## Acceptance

- [x] RED fails because the while provenance loader/artifact does not exist.
- [x] Exact canonical provenance bytes and digest authenticate.
- [x] Every causal field and six-record ordering mutation fails closed.
- [x] Live coverage remains 72/104 with 31 legacy parameter blockers.
- [x] `while-iteration` remains selected and unpromoted; `sortstrings` remains
      unchanged with its one legacy parameter row.
- [x] Targeted gates, full Node 22 fitness, and high-risk review pass.
- [ ] The signed commit is rebased before atomic publication to the feature
      ref and `main`, and both refs resolve to the same commit.

## Release Boundary

[DECIDED] M4.58 is evidence only, not KERN 5 completion. M4.59 may consume
this immutable handoff to implement exact canonicalizer validation/emission
for the selected `while-iteration` profile without promoting policy or
migrating `sortstrings`.
