# KERN 5 R2 M4.15 — Multi-Family Dependency Prerequisite

**Status:** SEALED — READY TO PUBLISH
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.14 commit
`070d8eb15331363872e3782ff3969aa08cc5b548` records 21 of 104 corpus
functions base-complete, 81 functions blocked by legacy `fn.params`, and no
remaining single-family candidate that completes a function.

[VERIFIED] Exact read-only AST migration of every remaining legacy signature,
followed by exact structural-KIR row measurement, proves that no one-family
closure exists. The minimum closure size is two. Of the two completing pairs,
`counted-iteration` plus `index-expression` completes six functions across
three tools, while `binding` plus `counted-iteration` completes one function
in one tool.

[DECIDED] M4.15 freezes the deterministic multi-family dependency ranking and
selects `index-expression` as the prerequisite inside the winning pair. Index
has one catalog fact; counted iteration has one node kind plus three required
properties. This slice records order evidence only: it does not merge the two
families, migrate a source signature, freeze ordinary selection provenance,
implement index canonicalization, or promote either family.

## Root Cause

[VERIFIED] The ordinary selector is intentionally complete-function based. A
family receives no credit when another unsupported family remains in the same
function. After member promotion, every admissible counterfactual witness
needs at least two active families, so occurrence ranking cannot break the
deadlock.

[VERIFIED] The six winning-pair witnesses are exact:

| Function | Tool | Params | Migrated rows |
|---|---|---:|---:|
| `checker-while.kern#4:hasDirectChild` | checker | 2 | 8/13/53 |
| `checker-while.kern#6:subtreeEnd` | checker | 2 | 9/14/70 |
| `canonicalizer-expression-helpers.kern#8:stringat` | canonicalizer | 2 | 8/14/62 |
| `validator.kern#13:containsid` | validator | 2 | 8/14/54 |
| `validator.kern#6:rootpath` | validator | 3 | 9/16/66 |
| `validator.kern#7:statusof` | validator | 3 | 9/16/66 |

[VERIFIED] The only other minimum-size closure is `binding` plus
`counted-iteration`, witnessed by `canonicalizer-statement-helpers.kern#0:indentation`
after one direct parameter at 7/14/42.

## Selection Contract

[DECIDED] Measure only current hash-bound handwritten corpus functions that
have legacy `fn.params`. Convert each signature independently, in memory, to
ordered direct `param` children while preserving its body and all other facts.
No source file changes during measurement.

[DECIDED] Enumerate non-empty subsets of active registry families. A closure
completes a counterfactual function only through the existing exact profile
predicate, frozen row limits, local expression validation, required property
checks, recursive statement closure, and zero remaining excluded properties.

[DECIDED] Select the smallest family count with any complete function. Rank
closures of that size by completed functions, completed tools, total observed
occurrences of their disjoint registry facts, then code-point family identity.

[DECIDED] Within the winning closure, rank the prerequisite by fewest registry
facts, then greater observed occurrences, then code-point id. This minimizes
the first implementation boundary without pretending the prerequisite alone
completes a corpus function.

[DECIDED] The authenticated receipt must bind the live coverage policy,
function facts, canonicalizer, profile, and family registry digests. It must
record the full minimum-size ranking, exact witnesses, migrated parameter-row
counts, profile rows, and selected prerequisite.

## Implementation Plan

1. Add a pure dependency-closure measurer that reuses the existing parser,
   KIR row encoder, profile blocker analysis, and completion predicate.
2. Add RED tests for zero singleton closure, the two exact pair rows, six
   winning witnesses, the one-function alternative, deterministic ordering,
   prerequisite selection, and fail-closed malformed legacy signatures.
3. Check in canonical receipt bytes and wire their assertion into the existing
   standalone canonicalizer coverage gate.
4. Regenerate the ordinary authenticated coverage summary because the local
   measurement implementation digest changes; its semantic M4.14 result must
   remain 21/104, 81 blockers, and null ordinary winner.
5. Run the focused gate, full Node 22 fitness wall, full-roster Agon review,
   fetch/rebase, and publish once.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/coverage-prerequisite.mjs` | add | deterministic counterfactual closure measurement |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | add | exact and hostile contract |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | add | canonical authenticated receipt |
| `scripts/check-kern-canonicalizer-coverage.mjs` | modify | assert prerequisite receipt in standalone gate |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | bind changed local measurement digest |
| `docs/kern-5-release-train.md` | modify | durable M4.15 result |
| this spec | seal | cross-session contract |

## Acceptance Criteria

- [x] Ordinary M4.14 measurement remains 21/104, 81 `fn.params` blockers, and
      a null one-family winner.
- [x] Exactly zero singleton closures and exactly two completing pairs exist.
- [x] The winning pair is counted iteration plus index expression at six
      functions, three tools, 14 migrated parameter rows, and 962 occurrences.
- [x] All six witness ids and exact 8/13/53, 9/14/70, 8/14/62, 8/14/54,
      9/16/66, and 9/16/66 row triples are frozen.
- [x] The alternative pair is binding plus counted iteration at one function,
      one tool, one parameter row, and 1,218 occurrences.
- [x] Index expression is selected as the one-catalog-fact prerequisite;
      counted iteration remains a distinct four-fact family.
- [x] Malformed, mixed, or unsupported legacy parameter forms cannot gain
      closure credit.
- [x] Fresh process and canonical checked-in receipt bytes agree exactly.
- [x] Focused canonicalizer gate passes 73 structural/authentication tests,
      27 golden/idempotence/KIR fixtures, eight measured witnesses, three
      profile-limit fixtures, and 156 hostile fixtures.
- [x] Complete Node 22 fitness wall passes.
- [x] Full usable-roster Agon review passes with no unresolved material
      finding.

## Stop Conditions

- A singleton closure appears, the minimum closure is not exactly two, or the
  winning pair/counts/witnesses differ.
- Measurement changes source, widens row limits, merges registry families, or
  bypasses the existing completion predicate.
- A non-portable legacy signature is silently treated as a direct parameter.
- Ordinary coverage semantics change, or any focused/full/review gate fails.

## Out of Scope

- Editing any `.kern` source signature.
- Freezing normal family-selection provenance.
- Implementing or promoting index expression or counted iteration.
- Combining independent registry families into one synthetic family.
- Changing KIR, parser, runtime, profile limits, or public APIs.

## Deploy Order

[DECIDED] The measurer, tests, canonical prerequisite receipt, regenerated
ordinary receipt, spec, and release evidence publish atomically after
fetch/rebase. M4.16 must start from the published receipt and freeze the exact
index prerequisite before implementation.

## Current Evidence

[VERIFIED] Canonical prerequisite receipt SHA-256 is
`54146de715b207e507d56e303937d0531d8832a5ced3e162b0288be83865f49f`.
The regenerated ordinary format-5 summary SHA-256 is
`12b26731a6f686f55e8e80736bbb6bdd7bbcb5e7ed514be9628885ddd8ef627c`;
its semantic result remains 21/104, 81 legacy parameter blockers, and a null
ordinary winner.

Confidence: 0.99. The minimum closure, both completing pairs, witness rows,
prerequisite ordering, canonical receipts, fresh-process parity, hostile
parameter forms, focused gate, and complete fitness wall are executable facts.
The independent review completed with no unresolved material finding.

[VERIFIED] The exact implementation tree passes the complete Node 22
`pnpm fitness:kern-5` wall: repository consistency, lint, production build,
all workspace and infrastructure suites, 432/432 cross-target fixtures,
109/109 class fixtures, 233 native assertions at 100% coverage, 48 checker
fixtures plus 36 hostile rejections, 39 validator verdicts, 40 whole-app
fixtures across three legs, browser budget, KIR/runtime/ownership/convergence
guards, and repeated M4.15 canonicalizer evidence all pass.

## Terminal Review

[VERIFIED] Full-roster Agon review
`review-1784593242913-wo6j0u-kern-5-r2-m4-15-terminal-boundar` completed all
six usable engines. Its aggregate reported one verified finding, one
needs-check item, zero speculative findings, and 12 nits.

[VERIFIED] The reported blocker is false against this worktree. Agy reviewed a
stale scratch copy that called `closureRow(base, ...)`; the current source calls
`closureRow(policy.base, ...)` at line 214, has no free `base` reference at the
reported line 231, and the focused gate plus complete fitness wall repeatedly
executed `measureCanonicalizerPrerequisite()` successfully.

[DECIDED] The needs-check request to extract corpus loading and function-id
assignment into a shared helper is deferred. The present duplication is
fail-closed through corpus digests, duplicate-id rejection, exact root-count
parity, and missing-id rejection. Refactoring the authenticated ordinary
coverage core would expand an evidence-only slice without changing its
semantics. The alias, repeated small-corpus parsing, bounded seven-family
combination enumeration, comment, and terminology nits are nonmaterial.

[VERIFIED] No terminal-review finding remains unresolved for publication.

## Supplemental Review Hardening

[VERIFIED] A post-publication independent role review
`review-1784593437144-5awnq5-kern-5-r2-m4-15-independent-term` identified
one real fail-closed gap: the slice-local identifier regex admitted `$x`,
reserved words, `__k*`, and `_kern*` even though KERN's canonical
`isPortableBindingName` rejects them. It also correctly requested explicit
`canonicalizerPolicyDigest` and `compiledCoreDigest` fields in the prerequisite
baseline. The reported null-row dereference was false because
`profileBlockersForFunction` deliberately accepts `null` projection rows.

[VERIFIED] M4.16 closes both real items before freezing the next handoff: the
counterfactual parser now delegates name admission to the canonical KERN
predicate, hostile regressions cover all four classes, both dependency digests
are receipt-bound, both live summaries are regenerated, and the focused gate
passes. The M4.15 semantic result remains unchanged.
