# KERN 5 R2 M4.18 — Index-Expression Promotion and Remeasurement

**Status:** REVIEWED — PUBLICATION PENDING
**Date:** 2026-07-21
**Confidence:** 0.93

## Executive Summary

[VERIFIED] Published `origin/main` commit
`7c78b96f600bef7b4be4484f13c2556ce8517c16` contains the reviewed M4.17
index-expression implementation. Its KERN-authored canonicalizer accepts the
exact non-optional structural `{ index, object, optional }` family, recursively
owns both operands, emits bracket syntax, and passes the complete KERN 5
fitness wall plus six-engine terminal review.

[VERIFIED] Index cannot truthfully use the existing ordinary-selection
promotion field. M4.15 proved it has no singleton completion witness, and
M4.16 froze a distinct prerequisite record with SHA-256
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`.
That record selects index as the one-catalog-fact prerequisite inside the
minimum completing pair with counted iteration.

[DECIDED] Evolve the internal coverage policy, receipt, and summary schemas so
every promotion names its provenance kind and digest. Preserve the four exact
ordinary selection records, authenticate index against the exact M4.16
prerequisite record, promote index into the cumulative base, remove it from
active candidates, and remeasure without inventing selection evidence.

## Current State and Root Cause

[VERIFIED] Coverage policy format 2 admits promotion entries only as
`{ family, selectionProvenanceDigest }`. Coverage measurement builds its
promotion evidence solely from the four-record selection chain. Reusing that
field for the M4.16 prerequisite digest would be semantically false, while
creating an ordinary index selection record would contradict the published
zero-singleton result.

[VERIFIED] The cumulative M4.14 base contains nine expression kinds and 21 of
104 complete functions. Index remains an active family with zero ordinary
singleton completions because all six causal witnesses also require counted
iteration and counterfactual parameter migration.

[INFERRED] Adding exact index support to the base therefore keeps ordinary
base completion at 21/104 and keeps the ordinary winner null. Under the
existing prerequisite measurement, the prior two-family winning closure
should collapse to singleton counted iteration: six functions, three tools,
14 migrated parameter rows, and 468 occurrences. Executable measurement must
confirm these values before publication.

## Promotion Contract

| Behavior | Contract | Tag |
|---|---|---|
| Policy format | advance to `kern.kir-canonicalizer.coverage-policy.3` | DECIDED |
| Promotion row | exactly `{ family, provenanceDigest, provenanceKind }` | DECIDED |
| Provenance kinds | only `selection` or `prerequisite` | DECIDED |
| Historical promotions | binary, conditional, call, and member keep exact selection digests | VERIFIED |
| Index promotion | append index with M4.16 prerequisite digest and kind `prerequisite` | DECIDED |
| Base identity | advance to `kern.kir-canonicalizer.profile.m4.18` | DECIDED |
| Base expressions | add sorted `index`; preserve every prior expression kind | DECIDED |
| Candidate families | remove `index-expression`; preserve all others | DECIDED |
| Receipt/summary | advance to formats 6 and carry prerequisite evidence explicitly | DECIDED |
| Selection history | preserve the four-record chain byte-for-byte | DECIDED |
| Prerequisite history | preserve the M4.16 record byte-for-byte | DECIDED |

## Exact Index Profile

[DECIDED] Local base validation must call the structural expression validator,
require exact structural fields, and separately require `optional=false`.
Recursive profile traversal must reject an optional index nested in either
operand and must keep any unpromoted expression dependency outside the base.

[DECIDED] Valid evidence includes direct integer indexing, binary indices,
nested indexing, already-promoted object and index expressions, and index
values consumed by promoted member and call expressions. Hostile evidence
includes missing/extra/malformed fields, non-boolean and true optional values,
nested optional index, and an unpromoted unary dependency.

## Options

| Approach | Result | Decision |
|---|---|---|
| Relabel prerequisite digest as selection evidence | smallest diff but publishes a false causal claim | Reject |
| Invent an index selection record | contradicts M4.15/M4.16 zero-singleton evidence | Reject |
| Add alternative digest keys without a format bump | makes format 2 ambiguous and silently changes its schema | Reject |
| Uniform tagged promotion rows plus format evolution | truthful, exact, and extensible to both evidence kinds | Select |
| Promote index and counted iteration together | destroys the dependency boundary and widens implementation scope | Reject |

## RED and Mutation Plan

[DECIDED] First change only promotion/profile tests to require policy format 3,
profile M4.18, the tagged five-record promotion list, exact index validation,
index-family removal, receipt/summary format 6, explicit prerequisite evidence,
and the measured post-promotion result. Run those tests against sealed M4.17
and capture failure at the old format/profile before implementation changes.

[DECIDED] Mutation coverage rejects old policy format, old profile identity,
missing/reordered/duplicate promotions, changed provenance kind or digest,
selection/prerequisite family mismatch, reintroduced index candidate overlap,
malformed index structure, optional index, and unprofiled future base kinds.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-contract implementation agreement |
| `coverage-policy.json` | modify | tagged promotion and exact M4.18 base |
| `coverage-profile.mjs` | modify | exact M4.18 base and index local profile |
| `coverage-implementation.mjs` | modify | policy 3 plus typed promotion authentication |
| `coverage-composition.mjs` | modify | load exact prerequisite evidence beside selection history |
| `coverage-summary.mjs` | modify | summary 6 and explicit prerequisite evidence |
| promotion/coverage/handoff/prerequisite tests | modify | RED, mutation, frozen-history, and live-result contracts |
| coverage check command | modify | exact M4.18 CLI evidence and status text |
| live summaries | regenerate | authenticated post-promotion facts |
| release train | modify | durable M4.18 evidence |

## Acceptance Criteria

- [x] Fresh branch starts from exact published M4.17 `origin/main`.
- [x] Existing promotion validator and M4.16 evidence boundary are grounded in
      current source.
- [x] RED fails against sealed M4.17 at the intended old policy/profile
      contract.
- [x] Policy 3 authenticates four selection promotions and one prerequisite
      promotion without evidence-kind ambiguity.
- [x] Index base validation matches the exact implemented non-optional subset
      and is mutation-killed.
- [x] Selection history and M4.16 prerequisite bytes remain unchanged.
- [x] Index is absent from active candidates and present in the exact sorted
      base expression catalog.
- [x] Authenticated measurement establishes 21/104, 81 parameter blockers,
      and a null ordinary winner.
- [x] Live prerequisite measurement establishes singleton counted iteration at
      six functions, three tools, 14 parameter rows, and 468 occurrences.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster role-lens `agon review` has no unresolved material
      finding.
- [ ] Signed commits are fetched/rebased before one `--no-verify` push to the
      feature ref and explicitly authorized `main`.

## Stop Conditions

- Promoting index requires changing KERN canonicalizer bytes, structural KIR,
  parser behavior, runtime ABI, corpus membership, or family registry facts.
- The exact M4.16 prerequisite digest cannot authenticate as prerequisite
  evidence without modifying its canonical bytes.
- Index promotion changes the ordinary base-complete count or makes an
  ordinary single-family winner positive.
- Counted iteration does not become the exact singleton prerequisite expected
  from the published two-family closure.
- Any historical selection or prerequisite provenance record drifts.

## Out of Scope

- Counted-iteration canonicalizer implementation or promotion.
- Migrating any KERN function signature from legacy `fn.params`.
- Optional index/member/call chains.
- Fixture-helper refactoring from the M4.17 review.
- KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting claims.

## Deploy Order

[DECIDED] Ship policy/schema evolution, exact promotion, regenerated evidence,
tests, spec, and release documentation atomically after focused/full gates and
independent review. Immediately before the only push, fetch and rebase onto
`origin/main`. After publication, fetch again and start the next slice from a
new `feat/*` branch based on `origin/main`; never reuse this branch.

## Current Evidence

[VERIFIED] RED failed first at policy format 2 versus required format 3, then
at the old untyped evidence shape and unpromoted index completion. After the
implementation, all 77 structural/authentication tests pass, including exact
typed promotion mutations, recursive index profile mutations, immutable
selection history, and immutable M4.16 prerequisite validation.

[VERIFIED] The complete focused Node 22 canonicalizer gate passes 77
structural/authentication tests, 32 exact golden/KIR/idempotence fixtures,
eight measured witnesses, three profile-limit fixtures, and 166 hostile
mutations.

[VERIFIED] The regenerated coverage policy has SHA-256
`d317f1368761e24b64025ef9cfccb1571acf387cf0021a6e5721d245f3f5ba17`.
The canonical format-6 coverage summary has SHA-256
`6e75ecfe710b9e4ba5ca8df2b5bb0080260a786f37674f5c938db8a5373db1a9`,
and the live prerequisite-summary-1 has SHA-256
`0759e372fa2c10e61bc341518be2b67121772757835107f0bbedc3399a3b3ded`.
Both bind coverage implementation digest
`cf0d320c8a99d4c03ca975ab9363af42d05c8522f8ab656f86256e8cc7d3ed83`.

[VERIFIED] The exact M4.17 executable remains byte-identical at SHA-256
`37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308`.
The exact M4.16 prerequisite record remains byte-identical at SHA-256
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`.
Live base completion is 21/104 with 81 `fn.params` blockers and a null ordinary
winner. The live counterfactual prerequisite is now counted iteration alone:
six functions, three tools, 14 migrated parameter rows, and 468 occurrences.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the exact
integrated tree, including repository consistency, lint, builds, every
workspace and infrastructure suite, 432/432 cross-target fixtures, 109/109
class fixtures, native KERN at 100% coverage, KIR/runtime/ownership/convergence
guards, and the terminal canonicalizer replay of 77 structural/authentication
tests, 32 golden/KIR/idempotence fixtures, eight measured witnesses, three
profile-limit fixtures, and 166 hostile fixtures.

## Terminal Review

[VERIFIED] High-risk role-lens review
`review-1784604232493-2zm0ma` completed all six usable engines: AGY overall,
Minimax security, Claude correctness, GLM DRYness, Kimi performance, and Codex
overall. Consensus was zero verified, zero needs-check, zero speculative, and
nine nit findings, with no unresolved material issue.

[VERIFIED] The nine nits were checked against current source. The claimed
standalone-versus-embedded prerequisite gap is already closed by exact live
loader equality and checked-in-summary equality. Explicit tagged promotion
validation makes the dispatch fail closed; ordered promotions intentionally
define the current implementation pointer; both implementation provenance
fields preserve distinct documented histories; recursive structural index
validation is the exact admitted profile; and the remaining helper, comment,
line-limit, and naming suggestions are nonblocking refactor debt outside this
slice.
