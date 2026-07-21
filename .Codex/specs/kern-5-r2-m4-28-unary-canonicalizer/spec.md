# KERN 5 R2 M4.28 — Unary-Expression Canonicalizer Tranche

**Status:** READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published `origin/main` commit
`73e618dbc0cb1642dc856ca24143b147262a361c` contains the immutable M4.27
unary-expression prerequisite handoff. Its canonical record has SHA-256
`e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`
and freezes one singleton closure: one canonicalizer function, one tool, two
counterfactual parameter rows, one catalog fact, 48 occurrences, and exact
witness
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#9:numberat`.

[DECIDED] Implement the exact parser-portable structural unary subprofile in
the KERN-authored canonicalizer: prefix `!`, `-`, `~`, and `typeof`, with a
recursively admitted argument, universal canonical grouping, and explicit
negative-zero rejection. Preserve structural KIR, canonical source, byte
idempotence, fail-closed rejection, authenticated composition, the four
prerequisite records, and the binding implementation pointer. Do not admit
parser-inexpressible unary `+` or `void`, promote unary, migrate `numberat`, or
change the cumulative profile.

## Published Input

[VERIFIED] The exact published M4.27 inputs are:

- commit `73e618dbc0cb1642dc856ca24143b147262a361c`;
- unary prerequisite-provenance SHA-256
  `e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`;
- coverage-summary format 6, SHA-256
  `79a0b773b85eb44fac193d7ee50f4f7161dc44b8affc4ce85fb59767eb32ce40`;
- prerequisite-summary format 2, SHA-256
  `a3cc02fedb90c211c3621a06daad7ba0bb3c4323a6747d046a9bdbfdf1913e32`;
- canonicalizer composite 39,430 bytes, SHA-256
  `5337c271465e710261901af18fe55d19a6e69a62f976d0d0fe44df209c4a2974`;
- handwritten main member 22,682 bytes, SHA-256
  `c7bfb896a4905fe8ebfde0dabf821ac0e35da881f30a8d117b31aa90dea03b14`;
- coverage-policy SHA-256
  `9a1175b209c38ee0a56ef2da8ee114170e87455e6a0ccd79a3f838dd8558e653`;
- coverage implementation digest
  `2fd49ffdc1e07c9eda5e7830b411117485b26ae9a95acdf466910749c1d2190a`.

[VERIFIED] Live baseline remains profile
`kern.kir-canonicalizer.profile.m4.25`, 32/104 base-complete functions, 70
legacy `fn.params` blockers, nine corpus members, four tools, a null ordinary
winner, and unary expression as the exact next one-family prerequisite.

## Current State and Root Cause

[VERIFIED] Structural KIR represents unary expressions as exactly
`{ argument, op }`. Its catalog admits `!`, `-`, `+`, `~`, `typeof`, and
`void`, recursively validates `argument`, and rejects unary minus over numeric
zero.

[VERIFIED] The KERN portable parser creates unary IR only for `!`, `-`, `~`,
and `typeof`. Direct probes confirm `+value` and `void value` fail to parse,
while `-0` parses but structural projection rejects it. Therefore emitting
all six structural operators would produce source that cannot round-trip
through the language whose canonical source this tool owns.

[VERIFIED] The KERN `exprsource` owner currently handles null, identifier,
boolean, integer, text, binary, member, index, call, and list expressions. It
has no unary branch, so the sealed M4.27 executable rejects `numberat`'s
negative-one return and every other structurally valid portable unary value.

[VERIFIED] Existing binary, member, index, call, and list branches recursively
consume `exprsource` output. A unary source fragment must therefore carry its
own grouping: `(-a)` is valid as the left operand of power and as a postfix
receiver/callee, while bare `-a` is not valid on the left of `**` and would
change parse association in some consumer positions.

## Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| shape | exactly two fields, `argument` and `op` | VERIFIED |
| argument | required structural expression, recursively canonicalized by `exprsource` | DECIDED |
| operators | admit exactly `!`, `-`, `~`, and `typeof` | DECIDED |
| excluded catalog operators | reject unary `+` and `void` because current KERN source cannot parse them | DECIDED |
| negative zero | reject `op=-` with canonical integer-zero argument | VERIFIED |
| emission | `(!arg)`, `(-arg)`, `(~arg)`, or `(typeof arg)` | DECIDED |
| grouping | every emitted unary expression is parenthesized | DECIDED |
| recursion | nested unary and promoted argument families round-trip exactly | DECIDED |
| consumers | unary may appear under binary, list, member, index, and call through existing recursive owners | DECIDED |
| unsupported form | reject the whole document through the existing empty-source path with no events or partial result | DECIDED |
| helper count | inline the exact four-operator check; add no KERN function and preserve the 104-function denominator | DECIDED |
| profile | keep `kern.kir-canonicalizer.profile.m4.25` and its family set unchanged | DECIDED |
| provenance | preserve all four prerequisite records byte-for-byte and keep binding as implementation provenance | DECIDED |

## Options

| Approach | Consequence | Decision |
|---|---|---|
| Add one exact unary branch to KERN `exprsource` | implements the authenticated family through the existing recursive owner | Select |
| Add a new `validunaryop` KERN helper | changes the frozen 104-function measurement denominator for a four-value check | Reject |
| Emit unary `+` and `void` | creates canonical source rejected by the current KERN parser | Reject |
| Emit bare prefix source | breaks or changes parsing in power and postfix consumer positions | Reject |
| Special-case only `numberat` / `-1` | implements a witness rather than the portable unary subprofile | Reject |
| Promote unary in this slice | conflates executable implementation with cumulative-profile authentication | Reject |

## RED and Mutation Plan

[DECIDED] Register a dedicated unary fixture module and a static ownership
assertion before production KERN edits. RED must prove both that sealed M4.27
lacks a KERN `unary` branch and that the first valid unary fixture is rejected
by the executable canonicalizer.

[DECIDED] Valid fixtures cover:

- each parser-portable operator with exact whitespace and grouping;
- negative integer and the published `numberat`-shaped `-1` case;
- recursive unary nesting;
- promoted binary, member, index, call, list, text, boolean, and integer
  arguments;
- unary as a binary/power operand and as a member, index, and call receiver;
- exact golden output, structural KIR equality, and second-pass byte
  idempotence.

[DECIDED] Hostile mutations cover missing, duplicate, and extra fields;
dangling argument identity; non-text and empty operators; unknown operator;
parser-inexpressible `+` and `void`; negative zero; unsupported argument kind;
invalid recursively nested unary; and malformed field/value shapes. Every
hostile table must reject completely without partial output.

## Implementation Plan

1. Seal this contract and add unary fixtures plus the missing-ownership test.
2. Run the focused static and executable checks to capture exact RED evidence.
3. Add one inline `unary` branch to the handwritten KERN main member.
4. Regenerate composition, its record, the changed main-member policy digest,
   and both authenticated coverage receipts after the final local `.mjs` edit.
5. Run the complete focused Node 22 canonicalizer gate and exact terminal
   coverage check; verify unary stays unpromoted and all provenance is exact.
6. Run the complete KERN 5 fitness wall and automatic high-risk role-lens
   review, resolve verified material findings, and publish once after
   fetch/rebase.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared M4.28 implementation contract and evidence |
| `scripts/kern-canonicalizer/unary-fixtures.mjs` | add | isolated valid and hostile unary corpus |
| `scripts/kern-canonicalizer/fixtures.mjs` | modify | register unary fixtures below the 500-line ceiling |
| `scripts/kern-canonicalizer/canonicalizer.test.mjs` | modify | exact KERN ownership and portable-operator contract |
| `examples/kern-canonicalizer/canonicalizer.kern` | modify | KERN-owned unary validation and canonical emission |
| composite and composition record | regenerate | authenticate changed KERN bytes |
| `coverage-policy.json` | modify | refresh only the handwritten main-member digest |
| coverage/prerequisite summaries | regenerate | bind final implementation and corpus digests |
| terminal summary pins if required | modify | keep generated receipts exact |
| release train | modify | restore the verified M4.26 sentence and record M4.28 evidence |

## Acceptance Criteria

- [x] Fresh M4.28 branch starts from published M4.27 `origin/main` commit
      `73e618dbc0cb1642dc856ca24143b147262a361c`.
- [x] Structural schema, parser behavior, M4.27 provenance, and recursive
      expression consumers are grounded in current source and executable
      probes.
- [x] RED proves M4.27 lacks unary ownership and rejects a valid unary fixture.
- [x] KERN owns exact recursive unary validation and universally grouped
      emission for `!`, `-`, `~`, and `typeof`.
- [x] Unary `+`, `void`, negative zero, malformed shapes, unknown operators,
      unsupported arguments, and invalid nested unary fail closed.
- [x] Valid fixtures pass exact golden output, structural KIR equality, and
      second-pass byte idempotence in every consumer position.
- [x] Unary remains unpromoted; profile, family registry, closure identity,
      implementation pointer, and all four prerequisite records stay exact.
- [x] Authenticated composition, policy corpus digest, and live summaries are
      regenerated from the final implementation tree.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster high-risk role-lens review has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`; both refs are verified.

## Out of Scope

- Unary promotion, next-family selection, or parameter migration.
- Unary `+` or `void` until the KERN parser has an explicit portable syntax
  contract for them.
- Await, new, spread, propagation, type assertion, or non-null expressions.
- Implementing do, exception, while, lambda, record, decimal, or conditional
  expression families.
- Changing parser, structural KIR, runtime ABI, evaluator, public exports,
  package versions, profile limits, family registry, or selection semantics.
- Refactoring historical provenance loaders or fixture frameworks.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Deploy Order

[DECIDED] Ship fixture evidence, the KERN unary implementation, authenticated
composition, regenerated receipts, spec, and release evidence atomically after
all local gates and independent review. Immediately before the only push,
fetch and rebase onto `origin/main`; publish the fresh feature ref and
explicitly authorized `main` with `--no-verify`, verify both hashes, fetch
again, and start the next slice from a new branch based on `origin/main`.

## Stop Conditions

- The published M4.27 commit or unary provenance differs from the exact input.
- Correct portable unary emission requires changing parser, structural KIR,
  runtime ABI, public exports, cumulative profile, or family selection.
- The four-operator implementation cannot preserve structural KIR through a
  second parse or cannot reject negative zero.
- Any prerequisite record, closure membership, baseline, family order, or
  binding implementation pointer changes.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Baseline Evidence

[VERIFIED] Published M4.27 passes 91 focused structural/authentication/profile
tests, 40 exact golden/KIR/idempotence fixtures, eight measured witnesses,
three profile-limit fixtures, 202 hostile fixtures, and the complete KERN 5
fitness wall. Live coverage is exactly 32/104 with 70 legacy blockers and unary
still next.

[VERIFIED] The automatic high-risk role-lens review
`review-1784637764020-rit9ty` subsequently routed all six usable non-excluded
identities with no exclusions or shortfall. All six returned, none found a
blocker, and the only verified cleanup is restoration of one M4.26 release-note
sentence; DRY and micro-performance suggestions are intentionally deferred
because exact independent pins are a design property of immutable evidence.

## Current Evidence

[VERIFIED] Focused Node 22 `pnpm test:kern-canonicalizer` passes all 92
structural/authentication/profile tests, 48 exact golden/KIR/idempotence
fixtures, eight measured witnesses, three profile-limit fixtures, 218 hostile
fixtures, semantic checking, authenticated composition, and the terminal
coverage check.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the exact
integrated tree after test-only review hardening, including repository
consistency, lint, build, all workspace and release-policy suites, 432/432
cross-target fixtures, 109/109 class fixtures, 233/233 native contracts at
100%, 40 whole-app fixtures across three legs, runner/browser budgets, checker,
validator, KIR, runtime, ownership, and convergence gates. Its terminal
canonicalizer rerun passes 92/92 tests, 48 exact golden/idempotence/KIR
fixtures, eight measured witnesses, three profile-limit fixtures, 218 hostile
fixtures, and exact 32/104 coverage with unary still next.

[VERIFIED] Terminal review found that the helper ownership guard searched for
plain quotes instead of the literal escaped KERN representation. The guard now
matches the established sibling assertion. A separate symbolic-minus concern
is disproved by the integer emitter's fail-closed rejection of every negative
integer KIR value and is pinned by a direct `-1` hostile-table mutation.

[VERIFIED] Required automatic high-risk role-lens review
`review-1784641872553-abfibk` routed all six usable non-excluded identities
with no exclusions or shortfall. All six returned successfully with zero
verified, needs-check, or speculative findings. Its single DRY nit recommends
only a future cross-family fixture-helper extraction and explicitly says to
defer it so this tranche remains byte-stable.

[VERIFIED] Exact-final targeted review
`review-1784644332568-66l4h5-kern-5-r2-m4-28-unary-canonicali` completed 3/3
with zero blocking, correctness, or security findings. Its only nit notes that
negative-zero rejection depends on the current invariant that only integer KIR
can emit bare `0`; structuralizing that check is deferred until another family
can emit the same source spelling.

[VERIFIED] The authenticated composite is 40,414 bytes at SHA-256
`178f9ad3e90cae8de9aa3ee5963dfc6a1acd5c70853ac7904c6228548a1e251a`;
the 23,666-byte handwritten main member is
`5472494a26004621d1ac76b0571432462c74da88563e4e3fca9ca7a2394a42e2`.
Coverage policy, coverage summary, and prerequisite summary file SHA-256 values
are `33680d7f1aefebb4efa3bc8c40102f2669436042677779627807ed0274357cb6`,
`d1e3f21ca3efab4f28aff136e83e1fedd3f52e8e7c7d374d4a1f4fa40043e9c4`,
and `fabfd3b802db25c0788e6f46582f471a8860bf54a02c8c4d23dc67e4b5aa2ac7`.
The final coverage implementation digest is
`f2799971b9cb44932b5ca874740f59a860635bef31c2de4dc34ce6b39c6a2775`.

[VERIFIED] Live coverage remains 32/104 with 70 legacy parameter blockers, a
null ordinary winner, and unary still unpromoted. The immutable M4.27 record
remains byte-exact at 48 occurrences; the live corpus now observes 49 because
the implemented KERN branch itself contains one unary-family fact.

[VERIFIED] Before any production KERN edit, the focused static test fails only
the new ownership assertion with `missing KERN-owned unary branch`. The
executable checker then rejects `unary-source-operators` with
`uncaught-throw`. That fixture is independently within the admitted table
profile at exactly 16 node rows, 24 property rows, and 60 value rows versus
limits 16/30/72, and structural projection contains four unary values.
Therefore RED reaches the missing unary owner rather than a profile ceiling.

## Open Questions

None. Operator scope and grouping were resolved with executable parser and
structural-projection probes before implementation.
