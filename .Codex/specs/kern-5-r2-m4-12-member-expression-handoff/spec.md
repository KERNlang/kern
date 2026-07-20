# KERN 5 R2 M4.12 — Member-Expression Handoff Evidence

**Status:** SEALED — READY TO PUBLISH
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published `origin/main` commit
`b2c653f6757f8af9996a59b998b3c52b9d033d29` is the sealed M4.11 causal
selection tree. Its canonical format-5 coverage summary has SHA-256
`90af9577a59318c27c60e9209113532e39b14d83c993de07882e24ae434ea846`;
coverage policy SHA-256 is
`be9e50847de262ce4c9cb1d78a12fd410cf304d3cd294a45f7dff544e18a2584`;
and the 32,310-byte canonicalizer composite SHA-256 is
`e2930f10fddfbfc2682d420ec61e494a7171f051801455336f213af2e719e59b`.

[VERIFIED] That immutable snapshot contains nine handwritten corpus members,
104 functions, four tools, 20 base-complete functions, and 81 `fn.params`
blockers. Its unique winner is `member-expression`: one function, one tool,
259 read-only corpus occurrences, and the sole witness
`examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText`.

[DECIDED] M4.12 freezes that exact published selection as the fourth
append-only provenance record and updates the implementation-selection pointer
to its digest. It does not implement or promote member expressions, mutate the
M4.11 measurement, change receipt/summary format 5, or claim any KIR/runtime/
public-reader/self-hosting milestone.

## Existing Contract / Root Cause

[VERIFIED] M4.5a established an ordered append-only provenance chain with
unique family ids and unique digests plus one pointer to the currently
authorized implementation family. The current three records are binary,
conditional, and call expression. M4.5c promotes all three into the base but
does not erase historical selection evidence; the pointer still resolves to
call expression because no later implementation authorization has yet been
frozen.

[VERIFIED] M4.11's live winner cannot safely authorize the next implementation
if later KERN/corpus bytes may alter live counts. The handoff must therefore
bind the exact already-published M4.11 commit and its immutable summary before
member-expression implementation begins.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| New record | canonical `kern.kir-canonicalizer.selection-provenance.1` JSON | DECIDED |
| Record digest | `83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d` | VERIFIED |
| Source commit | exact published M4.11 `b2c653f6757f8af9996a59b998b3c52b9d033d29` | VERIFIED |
| Source summary | exact format-5 SHA `90af9577…` | VERIFIED |
| Source policy | exact SHA `be9e508…` | VERIFIED |
| Source canonicalizer | exact SHA `e2930f10…` | VERIFIED |
| Snapshot | 9 corpus / 104 functions / 4 tools | VERIFIED |
| Selection | member expression, 1 function / 1 tool / 259 occurrences | VERIFIED |
| Witness | exact sole checker witness, sorted and unique | VERIFIED |
| History | binary, conditional, call, member in that exact order | DECIDED |
| Pointer | resolves exactly once to the member record | DECIDED |
| Format | coverage receipt and summary remain format 5 | VERIFIED |
| Live result | 20/104, 81 blockers, exact member winner unchanged | VERIFIED |
| Ownership | no implementation, promotion, export, cutover, or self-hosting claim | DECIDED |

## Options

| Approach | Result | Decision |
|---|---|---|
| Append record and move digest pointer | preserves causal history and authorizes exactly one next family | Select |
| Overwrite call record | destroys immutable implementation evidence | Reject |
| Use live winner without a record | future implementation can contaminate its own authorization | Reject |
| Add a new schema field or format 6 | duplicates the existing extensible chain contract | Reject |
| Freeze and implement together | loses the pre-implementation causal boundary | Reject |

## Implementation Plan

1. Add RED assertions for the fourth loader, exact member snapshot, exact
   four-record order, digest uniqueness, pointer movement, mutation rejection,
   and unchanged live M4.11 result.
2. Capture RED against the published three-record chain before production
   evidence exists.
3. Add the canonical record, pin its digest in the loader, append it to the
   chain, and move only the implementation pointer.
4. Regenerate the authenticated format-5 summary and run focused plus complete
   Node 22 gates.
5. Run automatically routed terminal review, seal evidence, fetch/rebase, and
   publish once. Stop before member-expression implementation or promotion.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/coverage-member-expression-selection-provenance.json` | add | immutable M4.11 selection record |
| `scripts/kern-canonicalizer/coverage-selection-provenance.mjs` | modify | exact pin, loader, fourth chain entry, pointer |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | modify | exact source/snapshot and mutation proof |
| `scripts/kern-canonicalizer/coverage-promotion.test.mjs` | modify | base promotions remain three while history becomes four |
| `scripts/kern-canonicalizer/coverage.test.mjs` | modify | exact live receipt history and pointer |
| `scripts/check-kern-canonicalizer-coverage.mjs` | modify | standalone handoff assertion |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | authenticated current evidence |
| `docs/kern-5-release-train.md` | modify | durable release evidence |
| this spec | seal | cross-session contract |

## Acceptance Criteria

- [x] RED fails against published M4.11 because no fourth member provenance or
      member implementation pointer exists.
- [x] New JSON bytes are canonical and SHA-256 exactly `83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d`.
- [x] Record source binds exact published commit, summary, policy, format, and
      canonicalizer digest; no post-M4.11 measurement is substituted.
- [x] Chain contains exactly binary, conditional, call, member expression in
      that order with unique family ids and unique digests.
- [x] Implementation pointer equals the member record digest and resolves
      exactly once; every prior record remains byte-identical.
- [x] Base promotions remain exactly binary, conditional, and call; member
      expression remains an active candidate and unimplemented.
- [x] Receipt/summary remain format 5 and live M4.11 counts remain exactly
      20/104, 81 `fn.params` blockers, and member 1/1/259 with one witness.
- [x] Canonicalizer/composition, policy, corpus, profile, schema, family
      registry, function facts, checker/validator fixtures, and runtime/public
      contracts remain unchanged.
- [x] Mutation tests reject record/chain order, length, digest, format, commit,
      summary, family, count, witness, duplication, and pointer drift.
- [x] Focused gates and the complete Node 22 fitness wall pass.
- [x] Automatically routed terminal review has no unresolved material finding.

## Measured Result

[VERIFIED] RED against published M4.11 failed at the intended missing-boundary
contract: the production module exported no member-selection loader, the chain
contained only three records, and the implementation pointer still resolved to
the call-expression record.

[VERIFIED] The new canonical provenance file hashes exactly to
`83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d`.
It binds published commit `b2c653f6757f8af9996a59b998b3c52b9d033d29`
and the exact M4.11 summary, policy, canonicalizer, corpus/tool/function counts,
member-expression winner, and sole witness. The append-only chain now contains
binary, conditional, call, and member records; only the implementation pointer
moves to the fourth digest. Base promotions remain binary, conditional, and
call.

[VERIFIED] Repository-owned summary regeneration remains format 5 and produces
SHA-256 `cf01966cc48992ed638049f12e11b695935815a986784388b547a7b756443ee4`.
Live coverage remains exactly 20/104 with 81 `fn.params` blockers and the
member-expression winner at 1 function / 1 tool / 259 occurrences. The focused
Node 22 canonicalizer gate passes all 68 structural tests, 21 golden/
idempotence/KIR fixtures, seven measured witnesses, three profile-limit
fixtures, and 140 hostile fixtures.

[VERIFIED] The exact implementation tree passes the complete Node 22
`pnpm fitness:kern-5` wall: repository consistency, lint, production build,
all workspace and infrastructure suites, 432/432 cross-target fixtures,
109/109 class fixtures, 233 native assertions at 100% coverage, 48/48 checker
fixtures plus 36 hostile rejections, 39/39 validator verdicts, 40 whole-app
fixtures across three legs, drift and browser budgets, KIR/runtime/ownership/
convergence guards, and repeated 68-test canonicalizer evidence all pass.

## Terminal Review

[VERIFIED] Full-roster Agon review
`review-1784585011550-5ggags-kern-5-r2-m4-12-terminal-boundar` completed all
six usable engines. Consensus reports zero verified findings, zero needs-check
findings, two speculative findings, and ten non-blocking nits.

[VERIFIED] Direct audit resolves every observation. `M411_SELECTION` is defined
before the new test and the focused/full gates execute it successfully. Local
SHA-256 recomputation confirms both the provenance digest `83e045d8…` and the
regenerated summary digest `cf01966c…`. The M4.5c promotion-test title
intentionally names the unchanged three-family promotion contract while its
current receipt assertions prove the four-record M4.12 handoff. M4.11 labels
and standalone messages intentionally identify the immutable source
measurement; the M4.12 constant identifies the slice that freezes it. The call
record retains its two-witness ordering mutation, while the single-witness
member record uses duplication because reversing one element is a no-op. No
material finding remains unresolved. This post-review sealing metadata was not
input to its own review.

[VERIFIED] The M4.10 post-seal amendment and M4.11 superseding terminal-review
receipt carried into this slice are documentation-only results from completed
review `review-1784582618011-rl1t8z-kern-5-r2-m4-11-terminal-boundar`. They do
not alter M4.12 product scope, authenticated source bytes, measurements, or
promotion state.

## Stop Conditions

- Any KERN source, corpus, profile, promotion, schema, family registry, parser,
  runtime, or public export must change.
- Live selection differs from published M4.11, or the record cannot be derived
  solely from the immutable M4.11 summary.
- Receipt/summary requires a new format or historical records must be rewritten.
- Pointer does not resolve exactly once to the appended member record.
- Any focused, complete-wall, or terminal-review gate fails.

## Out of Scope

- Implementing, testing, or promoting member-expression canonicalization.
- Migrating another structured parameter or changing the candidate ranking.
- Changing the frozen 16/30/72 profile ceilings.
- KIR v1 freeze, public reader export, runtime cutover, or semantic self-hosting.

## Deploy Order

[VERIFIED] Record, loader pin, chain/pointer contract, regenerated summary,
tests, spec, and release evidence ship atomically after fetch/rebase and one
push. The next fresh slice consumes this published fourth record before any
member-expression implementation bytes are authored.
