# KERN 5 R2 M4.17 — Index-Expression Canonicalizer Tranche

**Status:** REVIEWED — PUBLICATION READY
**Date:** 2026-07-21
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published `origin/main` commit
`0367e1c15639f791cdb047262cf27514fde4ffda` contains the sealed M4.16
prerequisite handoff. Its canonical prerequisite-provenance record has
SHA-256
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`
and selects `index-expression` as the one-catalog-fact prerequisite inside the
minimum completing pair with `counted-iteration`
(`scripts/kern-canonicalizer/coverage-index-prerequisite-provenance.json:1-44`).

[DECIDED] Implement the complete non-optional structural `index` expression
family in the KERN-authored canonicalizer. Preserve exact structural KIR,
canonical source, byte idempotence, fail-closed rejection, authenticated
composition, and all M4.16 prerequisite facts. Do not promote index into the
cumulative coverage base, migrate parameters, implement counted iteration, or
claim completion of the six counterfactual functions.

## Current State and Root Cause

[VERIFIED] Structural KIR already projects `ValueIR.index` to the exact record
`{ index, object, optional }`, with recursive expression values for `index`
and `object` and a boolean `optional`
(`packages/core/src/kir-structural/expression.ts:139-144`). Its validator
requires exactly those sorted fields and recursively validates both operands
(`packages/core/src/kir-structural/expression.ts:279-284`).

[VERIFIED] The portable parser creates non-optional index IR for
`object[index]` and optional index IR for `object?.[index]`
(`packages/core/src/parser-expression.ts:1356-1404`). The canonicalizer's
`exprsource` currently handles binary, member, call, and list expressions but
has no `index` branch
(`examples/kern-canonicalizer/canonicalizer.kern:81-161`). That missing branch
is the implementation gap.

[VERIFIED] The M4.14 cumulative base contains binary, boolean, call,
identifier, integer, list, member, null, and text expressions, but not index
(`scripts/kern-canonicalizer/coverage-profile.mjs:27-30`). M4.16 proves index
has no truthful singleton completion witness: its value is causal only inside
the two-family closure with counted iteration. Therefore implementation
evidence must use ordinary fixture/KIR/idempotence coverage and must not append
ordinary selection provenance.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| Shape | exactly three fields: `index`, `object`, `optional` | VERIFIED |
| Recursion | canonicalize `object` and `index` through `exprsource` | DECIDED |
| Emission | concatenate `object + "[" + index + "]"` | DECIDED |
| Optional index | reject unless `optional` is boolean false | DECIDED |
| Nested index | support recursively in object and index positions | DECIDED |
| Cross-family use | existing member/call branches may consume a valid index receiver/callee | DECIDED |
| Unsupported child | reject the entire document through the existing empty-source path | DECIDED |
| Profile | keep `kern.kir-canonicalizer.profile.m4.14` unchanged | DECIDED |
| Provenance | preserve M4.16 prerequisite bytes and the four ordinary selection records | DECIDED |

## Options

| Approach | Result | Decision |
|---|---|---|
| Add one exact recursive `index` branch to `exprsource` | implements the selected structural family without widening shared contracts | Select |
| Special-case the six M4.15 functions | couples formatting to current witnesses and does not implement the family | Reject |
| Implement index and counted iteration together | destroys the prerequisite boundary and materially widens the slice | Reject |
| Promote index in this slice | conflates implementation with cumulative-profile authentication | Reject |
| Emit optional index syntax now | requires optional-chain semantic and grouping decisions across member/call/index | Reject |

## RED and Mutation Plan

[DECIDED] Valid fixtures cover direct selected shapes (`values[i]` and
`moduleRoot[i2]`), integer and binary indices, recursive `matrix[i][j]`,
promoted binary/list/call/text objects, and index values consumed as member
receivers and call callees. Exact golden output must preserve KIR and be
byte-identical after a second pass.

[DECIDED] Hostile mutations cover missing, duplicate, and extra fields;
dangling object and index rows; non-boolean and true optional values;
unsupported nested object/index kinds; and optional state nested inside a
recursive index chain. Every hostile table must reject the whole input with no
events or partial result.

[DECIDED] RED is established by registering the valid/hostile index fixture
module and proving the current sealed M4.16 canonicalizer rejects the first
valid index fixture before any production KERN source is changed.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-session implementation contract |
| `scripts/kern-canonicalizer/index-fixtures.mjs` | add | valid and hostile index corpus |
| `scripts/kern-canonicalizer/fixtures.mjs` | modify | register the isolated fixture family without growing its line count |
| `examples/kern-canonicalizer/canonicalizer.kern` | modify | KERN-owned validation and emission |
| `scripts/kern-canonicalizer/canonicalizer.test.mjs` | modify | ownership and exact fail-closed contract |
| composition source/record | regenerate | authenticate changed KERN bytes |
| coverage and prerequisite summaries | regenerate | bind changed implementation digest while preserving semantics |
| `docs/kern-5-release-train.md` | modify | durable tranche evidence |

## Acceptance Criteria

- [x] Fresh branch starts from exact published M4.16 `origin/main`.
- [x] Structural schema, parser behavior, M4.16 prerequisite, and cumulative
      base are grounded in current source.
- [x] RED proves sealed M4.16 cannot canonicalize a valid index expression.
- [x] KERN owns exact recursive non-optional index validation and emission.
- [x] Optional index, malformed rows, dangling rows, and unsupported nested
      expressions fail closed with no partial output.
- [x] Valid fixtures pass exact golden output, structural KIR equality, and
      second-pass byte idempotence.
- [x] Existing member and call branches consume valid index receivers/callees.
- [x] Index remains unpromoted; M4.16 prerequisite provenance and semantic
      coverage/closure facts remain unchanged.
- [x] Authenticated composition and live summaries are regenerated.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster role-lens `agon review` has no unresolved material
      finding.
- [x] Signed commit is fetched/rebased before one `--no-verify` push to the
      feature ref and explicitly authorized `main`.

## Stop Conditions

- Correct emission requires changing the parser, structural schema, runtime
  ABI, canonical value format, or public exports.
- Index requires optional-chain semantics or an unpromoted expression family
  for the selected contract.
- M4.16 provenance bytes, closure ranking, prerequisite identity, or cumulative
  base must change.
- Any valid fixture changes structural KIR after canonicalization.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Out of Scope

- Index-expression promotion or next-family selection.
- Counted-iteration implementation and the six-function two-family closure.
- Structured-parameter migration.
- Optional member/call/index chains.
- KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting claims.

## Deploy Order

[DECIDED] Commit fixture, KERN implementation, authenticated composition,
regenerated receipts, spec, and release evidence atomically after local gates
and independent review. Immediately before the only push, fetch and rebase on
`origin/main`. After publication, fetch again and start the next slice from a
new `feat/*` branch based on `origin/main`; never reuse this branch.

## Current Evidence

[VERIFIED] RED rejected `index-selected-shapes` with
`uncaught-throw` on the sealed M4.16 source. The implemented KERN branch
then passed 32 exact golden/KIR/idempotence fixtures, eight measured witnesses,
three profile-limit fixtures, and 166 hostile mutations. The 77-test structural
and authentication wall also passes.

[VERIFIED] The authenticated 34,547-byte composite has SHA-256
`37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308`;
the handwritten main member has SHA-256
`c7bfb896a4905fe8ebfde0dabf821ac0e35da881f30a8d117b31aa90dea03b14`.
The regenerated live coverage and prerequisite summaries have SHA-256
`fb883f3ed1a4820de75213313aa7f44edfb9f119afb0bdb134d70a78543e7cfa`
and
`b7cdd95ad4a023db2f0ce3bbd20c977193bdce08ba78f3e301a1d0a88a080960`.

[VERIFIED] Index remains outside the M4.14 cumulative base; ordinary selection
still has no winner, with 21/104 functions base-complete and 81 legacy
parameter blockers. The winning prerequisite closure remains counted iteration
plus index at six functions, three tools, 14 migrated parameter rows, and 962
occurrences. The alternative binding/counting pair remains second; its live
occurrence count rises from 1,218 to 1,233 because this implementation adds 15
binding-family facts to the canonicalizer corpus. The immutable M4.16
prerequisite-provenance SHA-256 remains
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on this
tree. It includes every workspace and release-infrastructure suite, all 302 KIR
eligibility kinds, 432 cross-target fixtures, 109 class fixtures, 233 native
assertions at 100% coverage, 48 checker fixtures plus 36 hostile rejections, 39
validator verdicts, 40 whole-app fixtures across three legs, and every
KIR/runtime/ownership/convergence guard. Its terminal canonicalizer pass
reconfirmed 32 runtime fixtures, 166 hostile mutations, and the live 21/104
coverage result with index-expression as the next two-family prerequisite.

## Terminal Review

[VERIFIED] High-risk role-lens review
`review-1784601165188-9lbhq4` completed all six usable engines: security,
correctness, performance, dryness, and two overall seats. Consensus reported
zero verified findings, one needs-check maintainability concern, one
speculative concern, and six nits; no material finding remains unresolved.

[VERIFIED] Repository-wide search found no consumer of the renamed pre-index
fixture IDs, so the speculative compatibility concern is false. The
needs-check fixture-helper duplication concern is partially valid but
overstated: several named helpers are not duplicated across all claimed
modules, and extracting a shared mutation framework would widen this exact
capability tranche and invalidate its authenticated evidence. It is deferred
as non-blocking refactor debt before another expression-family fixture module
copies the pattern. The dangling-ID mutations intentionally prove table-layer
fail-closed behavior; exact missing-field and recursive-rejection witnesses
exercise the index branch itself. The remaining findings are non-behavioral
test-style nits.
