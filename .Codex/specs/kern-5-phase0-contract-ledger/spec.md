# KERN 5 Phase 0 Completion-Ledger Reconciliation

**Status:** COMPLETE; PHASE 1 READY

**Date:** 2026-08-13

**Baseline:** `bc1682880671b4dcac036ad74be8c4db4987810b`

**M4.171 implementation:** `50407d08ac97eeb4bfe9ee007f1072841b058991`

**Tribunal:** `tribunal-1786575544153-9w7nhh-kern5-phase0-contract-ledger`
(3/3 succeeded)

**Review:** `review-1786576326194-gstji9-kern5-phase0-contract-ledger`
(`agy` counted; stale-roster `minimax` supplemental), plus current-roster
correctness confirmation
`review-1786576550183-3radrk-kern5-phase0-claude-confirmation` (1/1, no findings)

**Confidence:** 0.99

## Decision

[P0-D1] **VERIFIED:** M4.171 was published directly to `main`; there is no
merge commit to invent. `50407d08` is the implementation commit and
`bc168288` is the post-publication documentation/goal baseline.

[P0-D2] **VERIFIED:** The execution policy currently declares 50 `current`
gates and five `planned` gates. It intentionally accepts only `id`, `label`,
`status`, and `argv` for a gate.

[P0-D3] **DECIDED:** Keep execution authority in
`scripts/kern-5-fitness-policy.json`. Add a separate versioned completion
authority at `scripts/kern-5-remaining-gates-v1.json`. The validator must bind
the two authorities exactly on terminal ID, order, status, and argv. The ledger
must never supply current executable gates independently.

[P0-D4] **DECIDED:** Phase 0 adds `kern-checker`, `kern-formatter`, and
`kern-canonical-cutover` as `planned`, producing exactly 58 declared gates:
50 current and eight planned. Their root package scripts remain absent.

[P0-D5] **DECIDED:** Phase 0 is contract-only. It does not add parser,
formatter, checker, compiler, interpreter, KIR, cutover, or release
implementation; expose KIR publicly; or add placeholder scripts.

## Frozen Contract Classification Vocabulary

These identifiers classify the evidence each terminal gate must eventually
provide. They do not claim that the exact Phase 1 grammar, diagnostic catalog,
KIR bytes, fixture corpus, or public API is already implemented.

1. `source`: admitted v5 source/module shapes and stable source-location
   evidence, including the boundary between accepted and unsupported source.
2. `diagnostics`: normalized diagnostic identity, ordering, multiplicity,
   location spans, and failure precedence.
3. `trivia`: required whitespace, comment, quoting, and raw source evidence
   preserved across parsing and formatting.
4. `kir`: versioned structural KIR identity, canonical encoding, module graph,
   and source/diagnostic binding.
5. `handlers`: handler declaration, binding, invocation, typed result, and
   failure behavior.
6. `capabilities`: explicit host capability requests/results plus cancellation,
   timeout, and effect containment.
7. `traces`: ordered observable events, stdout/stderr, effects, completion, and
   other sanctioned runtime evidence.
8. `determinism`: identical admitted inputs, configuration, and capabilities
   produce identical canonical outputs and receipts in fresh roots.
9. `limits`: declared input, collection, execution, and artifact bounds,
   including exact-bound success and first-excess failure.
10. `rejection-behavior`: unsupported or malformed states fail closed and
    atomically before partial output, result, diagnostic tape, or host effect.

[P0-C1] **CLAIM:** The ledger contains these ten identifiers exactly once in
this order. Each terminal row lists only applicable identifiers in global
order, and their union covers all ten.

[P0-C2] **BOUNDARY:** Exact behavioral contracts under these headings are
frozen by the implementation gate that promotes a terminal row. Phase 0 only
freezes classification, applicability, promotion meaning, and accepted
documentary evidence.

## Terminal Gate Contract

The exact terminal order is:

1. `kern-checker`
2. `kern-formatter`
3. `kern-frontend`
4. `kern-compiler`
5. `selfhost-fixed-point`
6. `kern-interpreter-shadow`
7. `kern-canonical-cutover`
8. `packed-release`

[P0-C3] **CLAIM:** The policy contains this exact terminal suffix. The ledger
contains the same rows. The marked support-matrix gate table renders the
policy cell-for-cell.

[P0-C4] **CLAIM:** A terminal row may be `planned` only while its root script is
absent. Promotion to `current` must add the real root script and synchronize
policy, ledger, and matrix atomically.

[P0-C5] **CLAIM:** At this baseline all eight terminal rows are `planned`, all
eight root scripts are absent, and `runKern5Fitness` receives exactly the 50
current non-terminal gates.

[P0-C6] **CLAIM:** Ledger evidence is non-empty and restricted to existing,
already tracked accepted contract artifacts. Arbitrary local paths cannot
satisfy the ledger.

## File Contract

| File | Change | Purpose |
| --- | --- | --- |
| `scripts/kern-5-remaining-gates-v1.json` | add | versioned completion authority |
| `scripts/kern-5-fitness.mjs` | update | strict ledger validation and policy binding |
| `scripts/kern-5-fitness.test.mjs` | update | RED-first mutation and current-only proofs |
| `scripts/kern-5-fitness-policy.json` | update | add three planned terminal rows |
| `docs/kern-5-support-matrix.md` | update | exact rendered policy plus current baseline truth |
| `docs/kern-5-release-train.md` | update | non-revisionist publication and Phase 0 receipt |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | update | actual baseline and reconciled 58/50/8 state |
| `.Codex/specs/kern-5-post-m4-171-completion/spec.md` | update | post-publication Phase 0 status and ledger link |
| `package.json` | no change | planned root scripts remain absent |

## RED-First Oracles

[P0-T1] Before the ledger/policy implementation, tests fail because the three
terminal rows and ledger artifact are absent.

[P0-T2] Mutations fail for missing, duplicate, unknown, reordered, or malformed
category identifiers and terminal rows.

[P0-T3] Mutations fail when policy and ledger differ on terminal ID, order,
status, or argv, or when the matrix differs from policy.

[P0-T4] Mutations fail when evidence is empty, unsafe, unapproved, or not a
tracked accepted artifact.

[P0-T5] Mutations fail when a planned root script appears prematurely. The
validated execution projection remains exactly 50 current gates and contains
none of the terminal rows.

## Acceptance

- [x] RED tests fail for the missing ledger/three rows before implementation.
- [x] Ledger schema, terminal suffix, categories, evidence, and horizon rules
      pass with named mutation coverage.
- [x] Policy and marked support matrix contain exactly 58 gates: 50 current
      and eight planned.
- [x] `package.json` remains byte-identical to `bc168288`.
- [x] M4.171 is recorded as direct-main published; stale merge/pending language
      is removed without rewriting history.
- [x] `pnpm test:kern-5-fitness`, `pnpm check:kern-5-contract`, lint, and
      `git diff --check` pass.
- [x] Independent automatic Agon review completes and every finding is checked
      against current source before publication.

## Out of Scope

- Implementing or promoting any terminal gate.
- Adding placeholder commands.
- Public KIR exports or claiming KIR/product authority before consumer cutover.
- Re-running the multi-hour full current wall unless executable selection or
  current implementation changes.
