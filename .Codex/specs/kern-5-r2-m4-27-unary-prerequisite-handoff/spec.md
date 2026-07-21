# KERN 5 R2 M4.27 — Unary-Expression Prerequisite Handoff

**Status:** REVIEWED — PUBLICATION READY
**Date:** 2026-07-21
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published `origin/main` commit
`e22a02418f14b6de9619b08b63281abdbc002ef1` contains reviewed M4.26. Its
authenticated prerequisite receipt selects `unary-expression` as the exact
next minimum one-family closure: one canonicalizer function after two
counterfactual direct parameter rows, with 48 catalog occurrences.

[DECIDED] M4.27 is an evidence-only handoff. Freeze the exact published M4.26
commit, coverage summary, prerequisite summary, baseline, unary family,
closure, and witness in a fourth canonical prerequisite-provenance record.
Extend the ordered prerequisite chain from three records to four while keeping
the implementation pointer on binding. Do not migrate `numberat`, implement or
promote unary, or change any KERN source, composition, profile, family registry,
policy, corpus, runtime, or live semantic result.

## Published Input

[VERIFIED] The exact published M4.26 source artifacts are:

- commit `e22a02418f14b6de9619b08b63281abdbc002ef1`;
- coverage-summary format 6, SHA-256
  `276c3d0a0673cf22027f65b9c532a79be4e018749aa7b8d50d421defd125271c`;
- prerequisite-summary format 2, SHA-256
  `8a1bc1d5082760c0cf81a38f71225761ac8bf22accac34ee0ddb7207abb7dffb`;
- canonicalizer composite 39,430 bytes, SHA-256
  `5337c271465e710261901af18fe55d19a6e69a62f976d0d0fe44df209c4a2974`;
- coverage implementation digest
  `8a22fa8e68c94910f16382cf761965b8331279d44b87e0a0219948fca963770c`.

[VERIFIED] Historical prerequisite record digests remain:

1. index expression:
   `3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`;
2. counted iteration:
   `af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`;
3. binding:
   `00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`.

## Current State and Root Cause

[VERIFIED] M4.26 consumed the complete binding parameter-ready cohort. Live
coverage is 32/104 under `kern.kir-canonicalizer.profile.m4.25`, with 70
remaining `fn.params` blockers, a null ordinary winner, and an empty base-only
parameter-migration partition.

[VERIFIED] Residual prerequisite measurement now selects unary expression
alone. Its exact completing witness is
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#9:numberat`,
with two legacy parameters and profile rows 8 nodes / 14 properties / 66
values. The selected family contributes one catalog fact and 48 occurrences.

[VERIFIED] The existing provenance module supports summary formats required by
all historical records, validates exact record shape and causal invariants,
loads exact index/counted/binding records, and enforces a positional
three-record chain. It has no unary pin or loader, so M4.28 cannot consume the
published causal input without first extending authenticated history.

## Unary Snapshot Contract

| Field | Exact contract | Tag |
|---|---|---|
| record format | `kern.kir-canonicalizer.prerequisite-provenance.1` | VERIFIED |
| source commit | exact full M4.26 object id | VERIFIED |
| source coverage | format 6 and exact published SHA-256 | VERIFIED |
| source prerequisite | format 2 and exact published SHA-256 | VERIFIED |
| baseline profile | `kern.kir-canonicalizer.profile.m4.25` | VERIFIED |
| baseline counts | 32 complete / 104 functions / 70 legacy blockers / 9 corpus members / 4 tools | VERIFIED |
| minimum family count | 1 | VERIFIED |
| selected prerequisite | unary expression / 1 catalog fact / 48 occurrences | VERIFIED |
| winning closure | singleton unary / 1 function / 1 tool / 2 rows / 48 occurrences | VERIFIED |
| witness | exact sorted singleton `numberat` id | VERIFIED |
| chain | exact `[index, counted iteration, binding, unary]` order | DECIDED |
| implementation pointer | remains binding provenance at chain index 2 | DECIDED |

## Ownership Boundary

[DECIDED] This slice owns only durable evidence for the already-published
prerequisite result. It does not own unary canonicalization semantics. The
future M4.28 implementation must consume the immutable unary record rather than
remeasuring or citing mutable live summaries as its causal input.

[DECIDED] Adding an unpromoted prerequisite record must not move
`implementationProvenance`. Policy promotion order still ends in binding, so
the live implementation pointer remains family `binding`, provenance kind
`prerequisite`, and the exact M4.23 digest.

[VERIFIED] KERN source and composition remain identical to M4.26. The new
record changes the authenticated prerequisite-history envelope and therefore
the coverage implementation digest and both generated summaries, but it does
not change source functions, function facts, family ranking, or completion.

## Options

| Approach | Consequence | Decision |
|---|---|---|
| Implement unary immediately | changes KERN bytes before freezing the published causal input | Reject |
| Reuse mutable live summaries directly | later source changes erase the exact M4.26 causal boundary | Reject |
| Add a standalone unary record without extending the chain | leaves order and cardinality unauthenticated | Reject |
| Replace binding with unary in the chain | destroys historical promotion evidence | Reject |
| Append exact unary record as chain position four | preserves history and gives M4.28 one immutable input | Select |

## RED and Mutation Plan

[DECIDED] Add a new focused unary-handoff test file before production edits.
It must import the absent unary loader/validator and fail against sealed M4.26
at module instantiation. A separate file avoids growing the existing 457-line
handoff test beyond the 500-line handwritten ceiling.

[DECIDED] After implementation, the focused test must prove:

- exact unary source commit and both published summary hashes;
- exact baseline, selected family, closure, two rows, and singleton witness;
- byte-identical canonical JSON and exact record digest;
- exact four-record chain order and preservation of the first three records;
- rejection of reversal, omission, duplication, claimed-digest drift, record
  drift, source drift, baseline drift, occurrence drift, and row-count drift;
- generic source-format compatibility remains limited to historical formats.

[DECIDED] Existing coverage and terminal checks must advance prerequisite-chain
cardinality to four while proving the implementation pointer remains the
binding record at position two. Both summaries are regenerated only after the
final local `.mjs` edit because every local canonicalizer implementation file
participates in the authenticated implementation digest.

## Implementation Plan

1. Write this claim-tagged contract and the missing unary-loader RED test.
2. Add canonical unary provenance JSON from exact published M4.26 facts.
3. Add the unary constant, exact validator/loader, and fourth positional chain
   member while retaining all historical loaders and bytes.
4. Update coverage/handoff/terminal assertions for exact four-record history
   and unchanged binding implementation provenance.
5. Regenerate coverage and prerequisite summaries from the final source tree;
   record exact new digests and rerun focused gates.
6. Run the complete Node 22 KERN 5 fitness wall and automatic high-risk
   role-lens review, resolve verified material findings, and publish once after
   fetch/rebase.

## File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared M4.27 contract and evidence |
| `coverage-unary-prerequisite-provenance.json` | add | immutable published M4.26 handoff |
| `coverage-prerequisite-provenance.mjs` | modify | exact unary pin/loader and four-record chain |
| `coverage-unary-handoff.test.mjs` | add | RED, exact bytes, chain, and hostile mutations |
| `coverage-handoff.test.mjs` | modify | current history/cardinality and pointer assertions |
| `coverage.test.mjs` | modify | exact four prerequisite digests |
| `coverage-promotion.test.mjs` | modify if required | distinguish chain tail from promoted pointer |
| `check-kern-canonicalizer-coverage.mjs` | modify | terminal four-record authentication |
| coverage/prerequisite summaries | regenerate | authenticate final local implementation graph |
| release train | modify | durable M4.27 evidence |

## Acceptance Criteria

- [x] Fresh M4.27 branch starts from published M4.26 `origin/main` commit
      `e22a02418f14b6de9619b08b63281abdbc002ef1`.
- [x] Published summary hashes, live prerequisite facts, and all provenance
      clients are grounded in current source.
- [x] RED fails because M4.26 has no unary handoff loader or four-record chain.
- [x] Canonical unary bytes bind exact M4.26 commit, summary hashes, baseline,
      singleton family, closure, row count, occurrence count, and witness.
- [x] Exact unary validation rejects structurally valid causal drift.
- [x] Chain is exactly index, counted iteration, binding, unary and rejects
      omission, reordering, duplication, digest drift, and record drift.
- [x] Existing three record bytes and exact loaders remain unchanged.
- [x] Coverage receipt and summaries authenticate four records while
      implementation provenance remains binding at chain index 2.
- [x] KERN source, composition, policy, profile, registry, corpus, live
      32/104 result, 70 blockers, and unary prerequisite remain exact.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster high-risk role-lens review has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`; both refs are verified.

## Out of Scope

- Migrating `numberat` from legacy `fn.params`.
- Implementing or promoting unary expression.
- Implementing or promoting do, exception, or while families.
- Changing prerequisite selection, parameter partitioning, profile limits, or
  family ranking.
- Changing KERN source, composition, coverage policy, family registry, parser,
  KIR, runtime ABI, evaluator, public exports, or package versions.
- Refactoring historical provenance loaders or generalizing the deliberately
  exact positional chain into dynamic policy.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Deploy Order

[DECIDED] Ship the immutable unary record, exact loader/validator, ordered
four-record chain, hostile mutations, regenerated receipts, spec, and release
evidence atomically. Run focused and complete local gates plus independent
high-risk review. Immediately before the only push, fetch and rebase onto
`origin/main`; publish the fresh feature ref and explicitly authorized `main`
with `--no-verify`, verify both hashes, fetch again, and start M4.28 from a new
branch based on `origin/main`.

## Stop Conditions

- Published M4.26 commit or summary hashes differ from the exact inputs above.
- The live unary closure differs from one function, one tool, two rows, one
  catalog fact, 48 occurrences, or the exact `numberat` witness.
- Freezing evidence requires any KERN, policy, profile, registry, parser, KIR,
  runtime, ABI, evaluator, or measurement-semantics change.
- Any existing prerequisite record byte or exact loader changes.
- Appending unary moves the implementation pointer away from binding.
- Exact four-record validation cannot reject order, cardinality, claimed
  digest, or structurally valid record drift.

## Current Evidence

[VERIFIED] The focused RED failed at module instantiation because sealed M4.26
did not export `loadCanonicalizerUnaryPrerequisiteProvenance`. The new
canonical unary record is 1,214 bytes at SHA-256
`e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`
and binds the exact published commit, both published summary hashes, baseline,
singleton closure, two rows, 48 occurrences, and `numberat` witness.

[VERIFIED] The exact prerequisite chain is now index, counted iteration,
binding, unary. Historical record digests remain byte-identical. Reversal,
omission, duplication, every claimed digest mutation, and structurally valid
unary source/snapshot drift reject. The live implementation pointer remains
binding at chain position two.

[VERIFIED] Regenerated coverage-summary and prerequisite-summary SHA-256 values
are `79a0b773b85eb44fac193d7ee50f4f7161dc44b8affc4ce85fb59767eb32ce40`
and `a3cc02fedb90c211c3621a06daad7ba0bb3c4323a6747d046a9bdbfdf1913e32`.
Their authenticated coverage implementation digest is
`2fd49ffdc1e07c9eda5e7830b411117485b26ae9a95acdf466910749c1d2190a`.
KERN composite and coverage-policy digests remain
`5337c271465e710261901af18fe55d19a6e69a62f976d0d0fe44df209c4a2974`
and `9a1175b209c38ee0a56ef2da8ee114170e87455e6a0ccd79a3f838dd8558e653`.

[VERIFIED] The complete focused Node 22 canonicalizer gate passes 91/91
structural/authentication/profile tests, 40 golden/KIR/idempotence fixtures,
eight measured witnesses, three profile-limit fixtures, 202 hostile fixtures,
and the exact terminal 32/104 coverage check with unary still next.

[VERIFIED] Terminal Agon review
`review-1784637760933-cyd05w-kern-5-r2-m4-27-unary-prerequisi` completed with
the exact `claude,codex,agy` roster: 3/3 engines succeeded with zero verified,
needs-check, speculative, or nit findings.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on this exact
tree. It includes every workspace, release, and infrastructure gate; 432/432
cross-target fixtures; 109/109 class fixtures; 233/233 native contracts with
13/13 coverage; 40 whole-app fixtures across three legs plus Express/FastAPI
boot; runner and browser budgets; the checker, validator, KIR, runtime,
ownership, and convergence gates; and the repeated canonicalizer result of
91/91 structural tests, 40 runtime fixtures, eight witnesses, three profile
limits, 202 hostile fixtures, and exact 32/104 coverage with unary still next.

## Open Questions

None. All inputs are exact published artifacts or deterministic current-source
facts; no assumption feeds implementation.
