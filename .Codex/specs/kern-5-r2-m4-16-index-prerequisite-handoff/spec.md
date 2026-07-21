# KERN 5 R2 M4.16 — Index-Expression Prerequisite Handoff

**Status:** READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published `origin/main` commit
`003f3222b23d7543b529186957a67feeb72009b0` is the sealed M4.15 causal
prerequisite tree. Its canonical format-5 coverage summary has SHA-256
`12b26731a6f686f55e8e80736bbb6bdd7bbcb5e7ed514be9628885ddd8ef627c`,
and its canonical prerequisite-summary-1 receipt has SHA-256
`54146de715b207e507d56e303937d0531d8832a5ced3e162b0288be83865f49f`.

[VERIFIED] That immutable snapshot proves zero singleton closures and a
minimum closure size of two. The winning pair is `counted-iteration` plus
`index-expression`, completing six functions across three tools after 14
direct parameter rows. Inside that pair, index expression is the deterministic
prerequisite because it owns one catalog fact versus counted iteration's four.

[DECIDED] M4.16 freezes that exact published result in a new prerequisite
provenance record. It does not append index expression to the ordinary
selection-provenance chain because index alone completes zero functions and
cannot truthfully satisfy the existing selection schema. It does not implement
or promote index expression, migrate a KERN signature, change the ordinary
winner, or claim a KIR/runtime/self-hosting milestone.

## Existing Contract and Root Cause

[VERIFIED] `kern.kir-canonicalizer.selection-provenance.1` requires a positive
complete-function count, a positive complete-tool count, and at least one
witness. M4.15 proves `index-expression` has no singleton completion witness.
Encoding it as an ordinary selection would therefore require weakening or
lying about the historical schema.

[VERIFIED] The ordinary append-only chain currently authenticates binary,
conditional, call, and member expression in that order. Its implementation
selection pointer remains the member record consumed by M4.13/M4.14. Those
historical facts must remain byte-identical while the new dependency-order
boundary is frozen independently.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| New record | canonical `kern.kir-canonicalizer.prerequisite-provenance.1` JSON | DECIDED |
| Source commit | exact published M4.15 `003f3222b23d7543b529186957a67feeb72009b0` | VERIFIED |
| Source coverage | format 5 and SHA-256 `12b26731…` | VERIFIED |
| Source prerequisite | format 1 and SHA-256 `54146de…` | VERIFIED |
| Baseline | profile M4.14, 9 corpus members, 104 functions, 4 tools, 21 complete, 81 parameter blockers | VERIFIED |
| Minimum closure | exactly 2 | VERIFIED |
| Winning closure | counted iteration plus index, 6 functions / 3 tools / 14 parameter rows / 962 occurrences | VERIFIED |
| Witnesses | exact six sorted M4.15 function ids | VERIFIED |
| Prerequisite | index expression, 1 catalog fact, 494 occurrences | VERIFIED |
| History | existing four selection records and member pointer remain exact | DECIDED |
| Live formats | coverage receipt/summary remain format 5; prerequisite summary remains format 1 | DECIDED |
| Ownership | no KERN source, implementation, promotion, export, or cutover change | DECIDED |

## Options

| Approach | Result | Decision |
|---|---|---|
| Add a distinct prerequisite-provenance record | truthfully freezes dependency ordering without changing selection semantics | Select |
| Encode index as ordinary selection provenance | invents positive completion/witness facts that M4.15 disproves | Reject |
| Weaken selection provenance to allow zero completion | rewrites the meaning of four immutable historical records | Reject |
| Freeze and implement index in one slice | loses the pre-implementation causal boundary | Reject |
| Put Git-history reads in the gate | breaks hermetic and shallow-clone execution | Reject |

## Implementation Plan

1. Add RED tests for the missing index handoff, exact published source hashes,
   canonical bytes, prerequisite snapshot, and mutation rejection.
2. Add a strict validator/canonicalizer and one digest-pinned JSON record for
   the exact M4.15 prerequisite result.
3. Assert the record from the standalone coverage gate while preserving the
   four-record ordinary selection chain and member implementation pointer.
4. Regenerate live coverage and prerequisite summaries only because the local
   authenticated measurement implementation digest changes; preserve all
   semantic M4.15 counts and rankings.
5. Run focused and complete Node 22 gates, full-roster Agon review,
   fetch/rebase, and publish once. Stop before index implementation.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/coverage-index-prerequisite-provenance.json` | add | immutable M4.15 prerequisite record |
| `scripts/kern-canonicalizer/coverage-prerequisite-provenance.mjs` | add | strict schema, canonical bytes, digest pin, loader |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | modify | exact handoff and mutation proof |
| `scripts/check-kern-canonicalizer-coverage.mjs` | modify | standalone prerequisite assertion |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | bind changed local implementation digest |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | regenerate | bind changed local implementation digest |
| `docs/kern-5-release-train.md` | modify | durable M4.16 evidence |
| this spec | seal | cross-session contract |

## Acceptance Criteria

- [x] RED fails because the published M4.15 tree has no immutable index
      prerequisite handoff.
- [x] New JSON is canonical and its exact SHA-256 is pinned in code and tests.
- [x] Source binds the exact M4.15 commit plus both published summary formats
      and SHA-256 values.
- [x] Snapshot freezes the exact baseline, minimum closure, winning pair,
      counts, six witnesses, and selected index prerequisite.
- [x] Validator rejects extra/missing fields, wrong formats, malformed hashes,
      reordered/duplicate families or witnesses, nonpositive counts, family
      mismatch, and any drift from the pinned canonical bytes.
- [x] Existing four selection records, their order, and the member
      implementation pointer remain byte-identical.
- [x] Coverage receipt/summary remain format 5; live measurement remains
      21/104, 81 `fn.params` blockers, and a null singleton winner.
- [x] Live prerequisite summary remains format 1 with the same two closures,
      exact ranking, and selected index prerequisite.
- [x] No `.kern` source, policy, profile, family registry, parser, runtime, or
      public export changes.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete Node 22 fitness wall passes.
- [x] Full usable-roster Agon review has no unresolved material finding.

## Stop Conditions

- Index requires a false positive completion or witness in ordinary selection
  provenance.
- Existing selection records, member pointer, policy, profile, or KERN source
  must change.
- Live semantic counts, closure ranking, prerequisite identity, or source
  hashes differ from the published M4.15 facts.
- A focused, complete-wall, or terminal-review gate fails.

## Out of Scope

- Implementing or promoting index-expression canonicalization.
- Implementing counted iteration or merging the two families.
- Migrating any remaining legacy function signature.
- Changing format-5 coverage semantics or format-1 prerequisite measurement.
- KIR v1 freeze, public reader export, runtime cutover, or semantic self-hosting.

## Deploy Order

[DECIDED] The pinned prerequisite record, validator/loader, mutation tests,
regenerated live receipts, spec, and release evidence publish atomically after
fetch/rebase and one push. The next fresh slice consumes the published M4.16
record before any index-expression implementation bytes are authored.

## Current Evidence

[VERIFIED] Canonical prerequisite-provenance bytes have SHA-256
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`
and bind published M4.15 commit
`003f3222b23d7543b529186957a67feeb72009b0` plus its two published summary
hashes. The live regenerated format-5 coverage summary SHA-256 is
`baa2567653c16e07bd6d4215540896f95d5adbfe891458ad7804591bd0efb4b5`;
the live regenerated prerequisite summary SHA-256 is
`12f839bc4ef6447423aa7e449049636c6a658d04acc3ea652c7ee895b6ebf725`.
Their semantic counts and ranking remain unchanged.

[VERIFIED] The focused Node 22 canonicalizer gate passes 76
structural/authentication tests, 27 golden/idempotence/KIR fixtures, eight
measured witnesses, three profile-limit fixtures, and 156 hostile fixtures.
The M4.15 follow-up hardening in this same tree now uses KERN's canonical
portable-binding predicate, rejects `$x`, reserved words, `__k*`, and
`_kern*`, and binds the canonicalizer-policy and compiled-core digests into
the prerequisite baseline.

[VERIFIED] The exact implementation tree passes the complete Node 22
`pnpm fitness:kern-5` wall: repository consistency, lint, production build,
all workspace and infrastructure suites, 432/432 cross-target fixtures,
109/109 class fixtures, 233 native assertions at 100% coverage, 48 checker
fixtures plus 36 hostile rejections, 39 validator verdicts, 40 whole-app
fixtures across three legs, browser budget, KIR/runtime/ownership/convergence
guards, and repeated M4.16 canonicalizer evidence all pass.

## Terminal Review

[VERIFIED] Full usable-roster role review
`review-1784595745138-ulwrug-kern-5-r2-m4-16-terminal-boundar` completed all
six engines with no blocker. Its material test-quality finding was genuine:
the first mutation loop mixed structural rejection with exact-digest rejection.
The fix now exercises 16 malformed structural cases directly through
`validateCanonicalizerPrerequisiteProvenance`, keeps six structurally valid
causal mutations behind the exact digest pin, and enforces that completed tools
cannot exceed completed functions. The documentation state and test spacing
items were also resolved. The low-confidence shared-helper extraction request
was deferred because it was not verified against the sibling module and would
widen this causal-boundary slice.

[VERIFIED] Targeted post-fix correctness review
`review-1784597722970-iorlpt-kern-5-r2-m4-16-post-review-hard` completed 1/1
with zero verified, needs-check, speculative, or nit findings.

Confidence: 0.99. The handoff record, fail-closed validator, published-source
causality, live receipt parity, supplemental M4.15 hardening, focused gate,
complete wall, full-roster review, and targeted post-fix confirmation are
executable facts. No material finding remains unresolved.
