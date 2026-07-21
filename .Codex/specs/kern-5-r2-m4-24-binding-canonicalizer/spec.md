# KERN 5 R2 M4.24 — Binding Canonicalizer Tranche

**Status:** REVIEWED — PUBLICATION READY
**Date:** 2026-07-21
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published `origin/main` commit
`3cdb4d829b51f165a54ceaa6814991773752831f` contains the sealed M4.23
binding prerequisite. Its prerequisite-provenance SHA-256 is
`00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`.
That record freezes one exact singleton closure: five functions across two
tools, nine migrated parameter rows, six catalog facts, and 801 binding
occurrences.

[DECIDED] Implement the complete authenticated direct-binding family in the
KERN-authored canonicalizer: `let` with exact `name` and `value`, and direct
`assign` with exact `target` and `value`. Preserve structural KIR, canonical
source, byte idempotence, fail-closed rejection, authenticated composition,
and all prerequisite records. Do not admit optional declaration metadata or
assignment operators, promote binding, migrate parameters, or re-rank the
closure.

## Current State and Root Cause

[VERIFIED] The active family registry defines binding as exactly node kinds
`assign` and `let`, plus property identities `assign.target`, `assign.value`,
`let.name`, and `let.value`
(`scripts/kern-canonicalizer/coverage-family-registry.json`).

[VERIFIED] The structural catalog represents `let.name` as an included
identifier and lowers `let.value`, `assign.target`, and `assign.value` as
expressions. The catalog also exposes optional `let.kind`, comments, type/raw
expression forms, and `assign.op`; none belongs to the authenticated family.

[VERIFIED] The core runtime accepts an assignment target only when its root
expression is an identifier, member, or index. Direct assignment rejects any
explicit operator except `=`. The existing KERN `exprsource`,
`valididentifier`, `structuralname`, `validstatementlist`, and
`emitstatementlist` functions already own the required recursive expression,
identifier, statement-order, and canonical-indentation behavior.

[VERIFIED] The KERN statement member currently validates and emits `return`,
`if`, `else`, and default-step `for`, but rejects both `let` and `assign`.
That missing exact statement ownership is the implementation gap.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| `let` shape | exactly `name` and `value`; no children | DECIDED |
| `let` name | structural identifier accepted by `structuralname`; `$` names are quoted canonically | DECIDED |
| `let` value | required and recursively canonicalized through `exprsource` | DECIDED |
| `let` metadata | reject `kind`, `type`, `expr`, comments, and future properties | DECIDED |
| `assign` shape | exactly `target` and `value`; no children | DECIDED |
| assignment target | recursively supported expression whose root kind is identifier, member, or index | DECIDED |
| assignment value | required and recursively canonicalized through `exprsource` | DECIDED |
| assignment operator | reject `op`, including explicit `=` and compound/update operators | DECIDED |
| emission | emit quoted canonical expressions; emit `let name=<structural-name> value=<quoted>` and `assign target=<quoted> value=<quoted>` | DECIDED |
| sequencing | admit bindings wherever the existing statement-list contract admits statements, including inside conditionals and loops | DECIDED |
| unsupported form | reject the whole document through the existing empty-source path, without events or partial result | DECIDED |
| profile | keep `kern.kir-canonicalizer.profile.m4.21` and its family set unchanged; refresh only changed implementation/corpus digests | DECIDED |
| provenance | preserve all three prerequisite records byte-for-byte and keep counted iteration as the promotion pointer | DECIDED |
| live remeasurement | immutable M4.23 stays at 801 occurrences; implementation-authored binding nodes may increase the live occurrence total without changing closure membership | DECIDED |

## Options

| Approach | Result | Decision |
|---|---|---|
| Add exact binding branches to KERN `validstatement` and `emitstatement` | implements the authenticated family through existing recursive owners | Select |
| Format binding nodes in JavaScript | violates KERN semantic ownership | Reject |
| Accept every expression as an assignment target | produces canonical source rejected by runtime/codegen assignment semantics | Reject |
| Add a dedicated assignment-target helper | changes the frozen 104-function coverage denominator for one inline root-kind check | Reject |
| Admit `let.kind` or `assign.op` | widens beyond the six authenticated facts | Reject |
| Promote binding in this tranche | conflates executable capability with cumulative-profile authentication | Reject |

## RED and Mutation Plan

[DECIDED] Valid fixtures cover direct `let` plus identifier assignment,
member/index assignment targets, `$` structural declaration names, promoted
expressions in binding values, and bindings nested in admitted conditionals
and loops. Exact golden output must preserve structural KIR and be byte
identical after a second pass.

[DECIDED] Hostile mutations cover missing and duplicate required properties;
non-text and malformed declaration names; optional/future properties;
unsupported value expressions; non-assignable assignment target roots;
unsupported target expressions; and children under either binding node. Every
hostile table must reject with no events or partial result.

[DECIDED] RED is established by registering the binding fixture module plus a
KERN-ownership assertion and proving the sealed M4.23 canonicalizer rejects a
valid binding fixture before production KERN source changes.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-session shared-contract decision |
| `scripts/kern-canonicalizer/binding-fixtures.mjs` | add | isolated valid and hostile binding corpus |
| `scripts/kern-canonicalizer/fixtures.mjs` | modify | register binding fixtures while remaining below 500 lines |
| `scripts/kern-canonicalizer/canonicalizer.test.mjs` | modify | assert exact KERN binding ownership |
| `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern` | modify | KERN-owned validation and emission |
| composition source/record | regenerate | authenticate changed KERN bytes |
| `scripts/kern-canonicalizer/coverage-policy.json` | modify | refresh only the changed handwritten statement-member digest |
| coverage/prerequisite summaries and literal pins | regenerate | bind changed implementation and corpus while preserving semantics |
| `docs/kern-5-release-train.md` | modify | durable tranche evidence |

## Acceptance Criteria

- [x] Fresh feature branch starts from published M4.23 `origin/main`.
- [x] Structural catalog, runtime target semantics, family registry, and
      existing recursive owners are grounded in current source.
- [x] RED proves M4.23 cannot canonicalize a valid binding fixture.
- [x] KERN owns exact recursive `let` and direct `assign` validation/emission.
- [x] Optional metadata, operators, malformed shapes, non-assignable targets,
      unsupported expressions, and binding children fail closed.
- [x] Valid fixtures pass exact golden output, structural KIR equality, and
      second-pass byte idempotence.
- [x] Binding remains unpromoted; closure identity, profile ID, family
      registry, promotion pointer, and all prerequisite records stay exact.
- [x] Authenticated composition and live summaries are regenerated.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster `agon review` has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`.

## Stop Conditions

- Correct emission requires changing parser, catalog, runtime ABI, public
  exports, or cumulative coverage profile.
- The authenticated family requires an unpromoted expression or statement
  kind.
- Any prerequisite record, singleton identity, closure membership, cumulative
  base, active family order, or promotion pointer must change.
- Any valid fixture changes structural KIR after canonicalization.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Out of Scope

- Binding promotion, next-family selection, or parameter migration.
- Mutable `let kind=let`, explicit `kind=const`, declaration type/raw/comment
  metadata, assignment operators, destructuring, or optional assignment.
- New expression families or statement families such as `do`, `throw`,
  `while`, or `each`.
- KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting claims.

## Deploy Order

[DECIDED] Commit fixtures, KERN implementation, authenticated composition,
regenerated receipts, spec, and release evidence atomically after local gates
and independent review. Immediately before the only push, fetch and rebase on
`origin/main`. Publish the feature ref and explicitly authorized `main`
atomically with `--no-verify`, verify both remote refs, then fetch and start
M4.25 from a new `feat/*` branch based on `origin/main`; never reuse this
branch.

## Baseline Evidence

[VERIFIED] M4.23 passes 86 focused structural/authentication tests, 36 exact
runtime fixtures, eight measured witnesses, three profile-limit fixtures, and
179 hostile fixtures. Live coverage remains 27/104 with 75 legacy parameter
blockers, no ordinary winner, and the exact binding prerequisite described
above.

[VERIFIED] Baseline authenticated composition SHA-256 is
`0eb8771b873f1b44f7dbe8754b27f159268da5115dcf288e59a627d62f366064`.
Coverage-summary and prerequisite-summary SHA-256 values are
`7544fee6ffe3239b7f9851b364b72244f54f36585c8b946474aa2cbfcd5626e5`
and
`b118993d69f35b40a632dec123e49d9ea1628e400bc64d18ebea1d269063aa2e`.

## Current Evidence

[VERIFIED] Sealed M4.23 rejects the first registered valid binding fixture and
the ownership test fails on the absent KERN `let` branch before production
source changes.

[VERIFIED] KERN now validates and emits exact direct bindings. Four valid
fixtures cover identifier/member/index targets, structural `$` names,
promoted expressions, and nested bindings. Twenty-three hostile mutations
cover both binding shapes, optional and future metadata, invalid declaration
names, invalid/non-assignable targets, unsupported expressions, and forbidden
children. The complete runtime corpus passes 40 exact golden/KIR/idempotence
fixtures, eight measured witnesses, three profile-limit fixtures, and 202
hostile fixtures.

[VERIFIED] The authenticated composite is 39,340 bytes at SHA-256
`fbc7cd4a38910b7fb4f97ce6b4ebb843da0ebc4543d069958652e40932e54fa8`;
the handwritten statement member is 10,274 bytes at SHA-256
`b951d517b9b9373e15ed5c1d0969ee2baf17f594aa1c007d7413091f88965e6b`.
Coverage-policy, coverage-summary, and prerequisite-summary SHA-256 values are
`29b5cae01b6e8573b2cbb632d2e968398c002c5b948a6855f2983fc47ba316e4`,
`d0dcae5a55cb5984bcca6d8c698000a8137302bba4fd3e1cb34027d8c73cab54`,
and
`20c82af0928a6c16755bfa1c81a527b2d1da4f03665f895c4ee9893a14390893`.

[VERIFIED] Live coverage stays 27/104 with 75 legacy parameter blockers, a
null ordinary winner, and no parameter-ready rows. Binding remains the exact
five-function/two-tool/nine-row singleton; its live occurrence total rises
from the immutable 801 to 852 solely because the implementation member now
contains binding nodes. Profile M4.21, the active family registry, counted
iteration promotion pointer, and all three prerequisite records remain exact.

[VERIFIED] The focused Node 22 gate passes composition and semantic checks,
all 87 structural/authentication/profile tests, the complete runtime corpus,
and the final exact coverage check on the current receipts.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the final
implementation tree. It exercises every workspace and release-policy gate,
432/432 cross-target fixtures, 109/109 class fixtures, 233/233 native fixtures,
40 whole-app fixtures across three legs, the checker/validator/KIR/runtime
contracts, and the repeated canonicalizer gate with 40 runtime fixtures,
eight witnesses, three profile-limit fixtures, 202 hostile fixtures, and the
exact 27/104 coverage receipt.

[VERIFIED] High-risk role-lens review `review-1784628519839-yy1k63`
completed all six usable non-excluded identities with no routing shortfall and
no unresolved material finding. One reviewer claimed the non-assignable-target
hostile mutation swapped two identifier expressions; direct inspection of the
decoded fixture proves the pre-mutation roots are `target=identifier` and
`value=binary`, while the post-mutation roots are `target=binary` and
`value=identifier`. The 202-case hostile runtime gate therefore exercises and
rejects the intended supported-but-nonassignable binary target. A low-confidence
generic fixture-helper extraction and the remaining documentation/test nits are
deliberately deferred because they do not affect correctness and would widen
this authenticated tranche.
