# KERN 5 R2 M4.23 — Binding Prerequisite Handoff

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published `origin/main` commit
`ca99949f28aca5c39f182f67a35b1342762cc6cd` contains reviewed M4.22. Its
authenticated prerequisite receipt selects `binding` as the next minimum
one-family closure: five functions across two tools after nine direct parameter
rows, with 801 catalog occurrences.

[DECIDED] M4.23 is an evidence-only handoff. Freeze the exact published M4.22
commit, coverage summary, prerequisite summary, baseline, binding family,
closure, and witnesses in a third canonical prerequisite-provenance record.
Extend the exact ordered prerequisite chain from two records to three while
retaining both historical compatibility loaders and keeping the implementation
pointer on counted iteration. Do not change KERN source, composition, coverage
policy, profile, family registry, or live semantic results.

## Current State / Root Cause

[VERIFIED] M4.22 consumed all six base-only parameter-ready witnesses. Live
coverage is 27/104 with 75 `fn.params` blockers, a null ordinary winner, and no
remaining base-only parameter migration. The residual prerequisite ranking now
selects binding alone (`coverage-prerequisite-summary.json:1-122`).

[VERIFIED] The prerequisite validator already defines the required canonical
record shape and causal invariants. Its source guard admits coverage-summary
formats 5 and 6 but only prerequisite-summary format 1, and its exact loaders
and chain cardinality stop at the M4.16 index and M4.19 counted-iteration
records (`coverage-prerequisite-provenance.mjs:1-274`).

[VERIFIED] The exact published M4.22 artifacts are:

- commit `ca99949f28aca5c39f182f67a35b1342762cc6cd`;
- coverage-summary format 6, SHA-256
  `9cfabe1ea53540a69d3ba4aa4444a2578f9d0c992c53f17a63826600abf2434a`;
- prerequisite-summary format 2, SHA-256
  `44b2ce6e4542770cad06201a7d1cc9763a01b2960ce4ef654657b7d455836c8f`;
- unchanged immutable index and counted-iteration prerequisite digests
  `3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`
  and `af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.

## What Already Works

[VERIFIED] Generic prerequisite validation rejects unknown fields, malformed
counts, unsorted or duplicate closure data, witness-count mismatch, impossible
tool/baseline counts, malformed commits, and malformed digests
(`coverage-prerequisite-provenance.mjs:21-201`).

[VERIFIED] Exact M4.16 and M4.19 loaders reject structurally valid causal drift,
and the ordered two-record chain rejects reversal, omission, duplication,
claimed-digest drift, and record drift (`coverage-handoff.test.mjs:64-269`).

[VERIFIED] All clients of the prerequisite chain are enumerated: coverage
composition, the standalone coverage checker, handoff tests, and promotion
tests. The current implementation pointer is policy-derived and remains the
counted-iteration provenance at chain index 1; adding unpromoted binding
evidence must not change it (`coverage-implementation.mjs:383-452`).

## Contract (Verified)

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| record format | `kern.kir-canonicalizer.prerequisite-provenance.1` | current validator | VERIFIED |
| source commit | exact full published M4.22 object id | `origin/main`; `git rev-parse` | VERIFIED |
| source coverage | format 6 plus exact published SHA-256 | published `coverage-summary.json` | VERIFIED |
| source prerequisite | format 2 plus exact published SHA-256 | published prerequisite summary | VERIFIED |
| baseline | profile M4.21, 27/104, 75 parameter blockers, 9 corpus members, 4 tools | live prerequisite baseline | VERIFIED |
| selected prerequisite | binding, 6 catalog facts, 801 occurrences | live selected prerequisite | VERIFIED |
| winning closure | singleton binding; 5 functions, 2 tools, 9 parameter rows, 801 occurrences | live ranking row 0 | VERIFIED |
| witnesses | exact five sorted function ids and counts | live ranking witnesses | VERIFIED |
| prerequisite history | exact ordered `[index, counted-iteration, binding]` chain | two immutable records plus M4.22 result | DECIDED |
| compatibility | retain index and counted-iteration loaders unchanged | repository client search | DECIDED |
| implementation pointer | remains counted iteration until a later promotion | current base promotion tail | VERIFIED |
| ownership | no binding implementation, promotion, KERN source, export, or cutover change | slice boundary | DECIDED |

## Exact Binding Snapshot

[VERIFIED] The binding record freezes this canonical semantic snapshot:

- baseline: `baseId=kern.kir-canonicalizer.profile.m4.21`, 27 complete,
  104 functions, 75 legacy blockers, 9 corpus members, and 4 tools;
- minimum family count: 1;
- selected prerequisite: binding, 6 catalog facts, 801 occurrences;
- winning closure: binding, 5 complete functions, 2 complete tools, 9 migrated
  parameter rows, 801 occurrences;
- witnesses, in bytewise order:
  - `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#11:childcount`;
  - `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#13:valuechildcount`;
  - `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#7:propcount`;
  - `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#0:indentation`;
  - `examples/selfhost-validator/validator.kern#9:paramcount`.

## Implementation Options

| Option | Result | Decision |
|---|---|---|
| Implement binding immediately | changes KERN bytes before freezing the published causal input | Reject |
| Replace either historical prerequisite record | destroys immutable promotion evidence | Reject |
| Add a standalone binding record without extending the chain | freezes bytes but leaves order/cardinality unauthenticated | Reject |
| Add the exact binding record and ordered three-record chain | preserves history and gives M4.24 one authenticated input | Select |

## Implementation Plan

1. Add RED imports/assertions for the missing binding loader, exact published
   source, snapshot, canonical bytes, and ordered three-record chain.
2. Extend generic source validation to admit only historical prerequisite
   summary formats 1 and 2; add the exact binding record and digest-pinned
   loader while preserving existing exact loaders.
3. Extend the chain to exactly three positional records and add mutations for
   reorder, omission, duplication, claimed digest drift, binding record drift,
   and unsupported source-format invention.
4. Update standalone/current-receipt assertions so all three prerequisite
   records authenticate while implementation provenance remains counted
   iteration; regenerate both live summaries after the final `.mjs` edit.
5. Run focused and complete Node 22 gates, automatic high-risk review,
   fetch/rebase, and one atomic publication. Stop before binding implementation.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-slice contract and evidence |
| `coverage-binding-prerequisite-provenance.json` | add | immutable M4.22 binding handoff bytes |
| `coverage-prerequisite-provenance.mjs` | modify | format-1/2 source support, exact binding pin/loader, three-record chain |
| `coverage-handoff.test.mjs` | modify | RED, exact bytes, mutations, order, compatibility |
| `check-kern-canonicalizer-coverage.mjs` | modify | assert all handoffs and unchanged implementation pointer |
| `coverage-summary.json` | regenerate | authenticate three-record history and changed implementation digest |
| `coverage-prerequisite-summary.json` | regenerate | bind changed local implementation digest only |
| `coverage.test.mjs` | modify if needed | exact three-record receipt cardinality |
| `coverage-promotion.test.mjs` | modify if needed | distinguish chain tail from promoted implementation pointer |
| release train | modify | durable M4.23 evidence |

## Acceptance Criteria

- [x] Fresh branch starts from exact published M4.22 `origin/main`.
- [x] All prerequisite-provenance clients are enumerated by repository search.
- [x] RED fails because M4.22 has no immutable binding handoff or exact
      three-record prerequisite chain.
- [x] New canonical bytes bind the exact M4.22 commit and both published
      summary hashes.
- [x] Snapshot binds the exact M4.22 baseline, singleton binding closure,
      selected family, and five witnesses.
- [x] Generic validation supports only historical prerequisite summary formats
      1 and 2; all three exact validators reject structurally valid drift.
- [x] The chain is exactly index, counted iteration, binding and rejects
      omission, reordering, duplication, digest drift, and record drift.
- [x] Existing index/counted bytes and loaders remain unchanged.
- [x] Coverage receipt/summary authenticate all three records while
      implementation provenance remains counted iteration.
- [x] KERN source, composition digest, policy digest, base profile, live
      counts, parameter-migration result, ranking, and selected binding
      prerequisite remain semantically exact.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster high-risk role-lens review has no unresolved material
      finding.
- [ ] KERN-signed commit is fetched/rebased before one atomic `--no-verify`
      push to the feature ref and explicitly authorized `main`.

## Out of Scope

- Binding canonicalizer implementation or promotion.
- Migrating any additional legacy KERN function signature.
- Changing prerequisite ranking or format-2 parameter-migration semantics.
- Changing KERN source, composition, family registry, coverage policy, base
  profile, parser, structural KIR, runtime ABI, or public exports.
- Refactoring historical selection provenance or changing the counted-iteration
  implementation pointer.
- KIR v1 freeze, public reader export, runtime cutover, or semantic self-hosting.

## Measured Implementation Evidence

[VERIFIED] The RED test first failed because
`loadCanonicalizerBindingPrerequisiteProvenance` did not exist. The canonical
binding record now hashes to
`00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`.
Coverage-summary and prerequisite-summary SHA-256 values after extending the
authenticated chain are
`7544fee6ffe3239b7f9851b364b72244f54f36585c8b946474aa2cbfcd5626e5`
and
`b118993d69f35b40a632dec123e49d9ea1628e400bc64d18ebea1d269063aa2e`.

[VERIFIED] The focused Node 22 canonicalizer gate passes 86/86 structural and
authentication tests, 36 runtime fixtures, 8 measured witnesses, 3
profile-limit fixtures, and 179 hostile fixtures. The complete Node 22
`pnpm fitness:kern-5` wall passed repo consistency, lint, production build,
all workspace and infrastructure suites, 432/432 cross-target fixtures,
109/109 class fixtures, 233 native assertions at 100% declared coverage,
runner/browser budgets, 40 whole-app fixtures, every KIR/runtime/ownership and
convergence gate, and the final repeated canonicalizer stage.

## Open Questions

None. The published hashes, schema extension, closure, witnesses, consumers,
and implementation pointer are all verified against current repository state.

## Deploy Order

[DECIDED] Add the immutable binding record, exact validator/loader, ordered
chain, hostile mutations, regenerated receipts, spec, and release evidence in
one slice. Run focused and full gates, then high-risk independent review.
Immediately before the only push, fetch and rebase onto `origin/main`; publish
the feature ref and authorized `main` atomically with `--no-verify`, verify both
remote refs, then start M4.24 from a new branch based on fresh `origin/main`.

## Stop Conditions

- Published M4.22 summary bytes or causal facts differ from the exact hashes
  and snapshot above.
- Freezing the handoff requires changing KERN source, policy, corpus, registry,
  parser, runtime, or measurement semantics.
- Either historical prerequisite record or the counted-iteration implementation
  pointer drifts.
- An exact three-record chain cannot preserve historical bytes while rejecting
  order, omission, duplication, and digest drift.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.23 could begin binding implementation immediately | The evidence-first M4.16/M4.19 ladder freezes the published prerequisite before implementation | M4.23 is evidence-only; implementation starts in M4.24 |
| The existing two-record chain can remain unchanged | Binding must be available to later consumers as authenticated ordered evidence | Deliberately revise exact chain cardinality from two to three |
