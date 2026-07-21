# KERN 5 R2 M4.20 — Counted-Iteration Canonicalizer Tranche

**Status:** REVIEWED — PUBLICATION READY
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published `origin/main` commit
`085e1a40258dd35e6df606c12eee3a316afae85c` contains the sealed M4.19
prerequisite handoff. Its counted-iteration prerequisite-provenance SHA-256 is
`af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.
That record freezes one exact singleton closure: six functions across three
tools, 14 migrated parameter rows, and 468 counted-iteration occurrences.

[DECIDED] Implement the complete authenticated default-step structural `for`
family in the KERN-authored canonicalizer. Preserve exact structural KIR,
canonical source, byte idempotence, fail-closed rejection, authenticated
composition, and all M4.19 prerequisite facts. Do not admit `step`, promote
counted iteration, migrate parameters, re-rank the closure, or claim completion
of the six counterfactual functions.

## Current State and Root Cause

[VERIFIED] The canonical coverage family is exactly node kind `for` plus
required properties `for.from`, `for.name`, and `for.to`
(`scripts/kern-canonicalizer/coverage-policy.json:100`). The structural catalog
also knows an optional `step` property, but it is outside the authenticated
M4.19 family and therefore outside this tranche.

[VERIFIED] Parser validation requires a cross-target loop identifier matching
`[A-Za-z_][A-Za-z0-9_]*`, admits integer-compatible `from` and `to`
expressions, and treats an explicit step as a separate non-zero integer-literal
contract (`packages/core/src/parser-validate-body-statements.ts:129-156`).

[VERIFIED] The KERN statement owner recursively validates and emits `return`,
`if`, and `else`, but has no `for` branch
(`examples/kern-canonicalizer/canonicalizer-statement-helpers.kern:25-80`).
The existing `exprsource`, `valididentifier`, `validstatementlist`, and
`emitstatementlist` functions already provide the required expression,
identifier, recursion, and canonical-indentation ownership. The missing exact
statement branch is the implementation gap.

[VERIFIED] The M4.18 cumulative base already includes index expressions, but
not counted iteration. M4.19 authenticates counted iteration as the sole next
prerequisite. Implementation evidence must therefore use ordinary fixture,
KIR-equality, idempotence, and hostile-mutation coverage while leaving
promotion and coverage remeasurement to M4.21.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| Shape | exactly three properties: `from`, `name`, and `to` | VERIFIED |
| Step | reject any explicit `step`, including otherwise valid integer literals | DECIDED |
| Name | require parser-portable `[A-Za-z_][A-Za-z0-9_]*`; reject structural-only `$` names | DECIDED |
| Bounds | recursively canonicalize `from` and `to` through `exprsource` | DECIDED |
| Emission | emit `for name=<name> from=<quoted-source> to=<quoted-source>` | DECIDED |
| Body | recursively validate and emit the existing admitted statement subset | DECIDED |
| Nesting | support valid `for` inside `for` and admitted conditionals inside loops | DECIDED |
| Unsupported child | reject the whole document through the existing empty-source path | DECIDED |
| Profile | keep `kern.kir-canonicalizer.profile.m4.18` and its family set unchanged; refresh only the changed corpus-member digest | DECIDED |
| Provenance | preserve both prerequisite records byte-for-byte and keep index as the current promotion pointer | DECIDED |

## Options

| Approach | Result | Decision |
|---|---|---|
| Add exact `for` branches to KERN `validstatement` and `emitstatement` | implements the authenticated family through existing recursive owners | Select |
| Add generic structural statement formatting in JavaScript | violates KERN semantic ownership and weakens self-hosting evidence | Reject |
| Admit optional `step` | widens beyond the authenticated family and requires direction/range semantics | Reject |
| Implement only the six named witnesses | couples formatting to current evidence instead of implementing the family | Reject |
| Promote counted iteration in this slice | conflates executable capability with cumulative-profile authentication | Reject |

## RED and Mutation Plan

[DECIDED] Valid fixtures cover a direct counted loop with an admitted nested
conditional and trailing return, recursive nested loops, and promoted
binary/call/member/index expressions in `from` and `to`. Exact golden output
must preserve structural KIR and be byte-identical after a second pass.

[DECIDED] Hostile mutations cover missing and duplicate required properties;
explicit `step`; extra future properties; `$` loop names; unsupported bound
expression kinds; unsupported body statements; and an invalid recursively
nested loop. Every hostile table must reject the entire input with no events
or partial result.

[DECIDED] RED is established by registering the valid/hostile counted fixture
module plus its KERN-ownership assertion and proving the sealed M4.19
canonicalizer rejects the first valid counted fixture before any production
KERN source is changed.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-session implementation contract |
| `scripts/kern-canonicalizer/counted-iteration-fixtures.mjs` | add | isolated valid and hostile counted-loop corpus |
| `scripts/kern-canonicalizer/fixtures.mjs` | modify | register the family while reducing the oversized file below 500 lines |
| `scripts/kern-canonicalizer/canonicalizer.test.mjs` | modify | exact KERN ownership and fail-closed contract |
| `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern` | modify | KERN-owned validation and canonical emission |
| composition source/record | regenerate | authenticate changed KERN bytes |
| `scripts/kern-canonicalizer/coverage-policy.json` | modify | refresh only the changed handwritten statement-member digest |
| coverage and prerequisite summaries | regenerate | bind changed implementation/corpus digests while preserving semantics |
| `docs/kern-5-release-train.md` | modify | durable tranche evidence |

## Acceptance Criteria

- [x] Fresh feature branch starts from exact published M4.19 `origin/main`.
- [x] Structural catalog, parser constraints, M4.19 prerequisite, and existing
      recursive statement/expression owners are grounded in current source.
- [x] RED proves sealed M4.19 cannot canonicalize a valid counted loop.
- [x] KERN owns exact recursive default-step `for` validation and emission.
- [x] Explicit step, malformed properties, invalid names, unsupported bounds,
      and unsupported nested statements fail closed with no partial output.
- [x] Valid fixtures pass exact golden output, structural KIR equality, and
      second-pass byte idempotence.
- [x] Counted iteration remains unpromoted; both prerequisite-provenance
      records and semantic closure identity remain unchanged.
- [x] Authenticated composition and live summaries are regenerated.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster role-lens `agon review` has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`.

## Stop Conditions

- Correct emission requires changing the parser, structural schema, runtime
  ABI, canonical value format, or public exports.
- The selected default-step family requires an unpromoted expression or
  statement kind.
- M4.19 prerequisite bytes, singleton identity, closure membership, cumulative
  base, or promotion pointer must change.
- Any valid fixture changes structural KIR after canonicalization.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Out of Scope

- Counted-iteration promotion or next-family selection.
- Explicit positive or negative `step` semantics.
- Structured-parameter migration or special-casing the six witness functions.
- Additional statement families such as `let`, `assign`, `do`, `each`, or
  `while`.
- KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting claims.

## Deploy Order

[DECIDED] Commit fixtures, KERN implementation, authenticated composition,
regenerated receipts, spec, and release evidence atomically after local gates
and independent review. Immediately before the only push, fetch and rebase on
`origin/main`. Publish the feature ref and explicitly authorized `main`
atomically with `--no-verify`, verify both remote refs, then fetch and start
M4.21 from a new `feat/*` branch based on `origin/main`; never reuse this
branch.

## Current Evidence

[VERIFIED] Baseline KERN composition SHA-256 is
`37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308`.
Coverage-summary and prerequisite-summary SHA-256 values are
`aaa9fa135565294eeb84269875242b5fde28ceafb9deb26e21a80eedf9a178d2`
and
`d53293f4fd5ab96efe5f4eeda74523e30961316be23ef07628521325f7536123`.
The coverage-policy SHA-256 is
`d317f1368761e24b64025ef9cfccb1571acf387cf0021a6e5721d245f3f5ba17`.

[VERIFIED] The current baseline passes 32 exact golden/KIR/idempotence
fixtures, eight measured witnesses, three profile-limit fixtures, 166 hostile
mutations, and the complete KERN 5 fitness wall. Ordinary selection remains
null at 21/104 base-complete functions with 81 legacy parameter blockers; the
authenticated next prerequisite is counted iteration alone.

[VERIFIED] After fixture registration and before any production KERN edit,
`counted-iteration-conditional-body` rejected with `uncaught-throw`. This is
the required RED proof that the sealed M4.19 executable does not already own
the selected statement family.

[VERIFIED] KERN now validates and emits exact recursive default-step `for`
statements. Four new valid fixtures pass canonical goldens, KIR equality, and
second-pass idempotence, including a parser-admitted empty loop body; 13 new
hostile mutations reject missing, duplicate, extra, stepped, malformed,
non-text, structural-only `$`, unsupported-bound, unsupported-child, and
invalid nested forms with no partial result. The complete runtime corpus is now
36 valid fixtures, eight measured witnesses, three profile-limit fixtures, and
179 hostile fixtures.

[VERIFIED] A targeted runtime trace caught that a combined identifier/`$`
guard was mis-evaluated when its local name came from `stringat`. Splitting the
two fail-closed checks preserves the contract and is directly covered by both
top-level and nested `$` hostile mutations.

[VERIFIED] The authenticated 36,410-byte composite has SHA-256
`55c1b597a8912af545c348c57329d9aef0174590dbe4ba64310484806a8c1307`;
the handwritten statement member has SHA-256
`b30350be41f066109263c9fc8022e963e4aad3298425fbdbfe2480811f8a36bc`.
The corpus-only policy digest refreshes to
`ede4213ce6a909d820545b92e1d48d34e0575bc22ef26c9683d6d16df3ffb05d`.
Coverage and prerequisite summary SHA-256 values are
`927553eb48c7be6107a8fd00938ccf2df35a80dc0bbd9ee369ecc11f13bd9182`
and
`927ef4b4229d9319e8312dafaa8a9ef348f6e9f2e5f7db453fd84389e3e36cc0`.

[VERIFIED] The focused Node 22 gate passes all 81 structural,
authentication, handoff, profile, and adapter tests plus the complete runtime
corpus. Counted iteration remains outside the cumulative base; ordinary
selection remains null at 21/104 with 81 legacy parameter blockers. The live
prerequisite remains the exact six-function, three-tool, 14-parameter-row,
468-occurrence counted-iteration singleton. M4.16 and M4.19 provenance digests
remain byte-identical at
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`
and
`af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed after the
production implementation and initial receipt regeneration. It included repo
consistency, lint, production build, every workspace and infrastructure suite,
release policy, 432/432 cross-target fixtures, 109/109 class fixtures, 233
native assertions at 100% declared coverage, 40 whole-app fixtures across
three legs, browser budget, capstone assertion/checker/validator parity, all
KIR/runtime/ownership and convergence gates, and repeated exact canonicalizer
receipt/corpus checks. The later review delta changes only fixtures, fixture
helpers, tests, summaries, and documentation; its exact affected surface is
covered by the post-review focused gate below.

## Terminal Review

[VERIFIED] Automatic high-risk role-lens review
`review-1784612259232-nltnpu` completed all six usable non-excluded engines:
`agy`, `codex`, `zai-coding-plan-glm-5.2`,
`minimax-coding-plan-minimax-m3`, `kimi-for-coding-k3`, and `claude`. The
consensus reported zero verified or speculative findings, four needs-check
items, and 11 nits.

[VERIFIED] The needs-check items were resolved against current source and
runtime evidence. The apparent two-file semantic duplication is the generated
composite plus its single handwritten member, not two handwritten owners.
Malformed and non-text loop-name coverage was genuinely missing, so both
hostile witnesses were added. The parser accepts an empty counted-loop body;
an exact valid fixture now proves parser, KIR, emission, reparse, and
idempotence behavior. Cosmetic fixture-registry compression was replaced by a
shared helper module, leaving the registry at 477 lines. Hostile expression
mutation now throws if its target property or `record:kind` is absent, the
promoted-bound fixture now uses the typed `limits.length` member. The suggested
literal coverage-implementation digest pin was rejected after a direct test:
that digest intentionally frames every `.mjs` file in this directory,
including the test containing the proposed literal, so the edit changes the
value it attempts to pin. The committed summary pins the exact current digest,
while this test retains its independent shape check and all other literal
baseline pins.

[VERIFIED] After those review fixes, the exact focused Node 22 gate passes all
81 tests plus 36 golden/KIR/idempotence fixtures and 179 hostile fixtures. The
production KERN composition remains byte-identical to the already full-wall
tested 36,410-byte composite, so no second complete wall is required for the
test-only review delta. The blocker-count movement is expected first-blocker
re-attribution after the statement-owner row/depth increase; base completion,
the null winner, the authenticated singleton, and both immutable provenance
records remain unchanged.
