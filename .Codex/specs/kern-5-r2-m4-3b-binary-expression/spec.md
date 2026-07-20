# KERN 5 R2 M4.3b — Binary-Expression Canonicalizer Tranche

**Status:** SEALED — COMPLETE WALL PASSED
**Date:** 2026-07-18
**Confidence:** 0.95

## Executive Summary

[VERIFIED] The sealed M4.3a receipt measures 98 handwritten functions across
four tools and selects `binary-expression` as the next deterministic tranche:
three newly complete assertion-engine functions, one tool, 941 binary
occurrences, and witnesses `reasonTypeMismatch`, `reasonValueMismatch`, and
`reasonKeyMismatch` (`scripts/kern-canonicalizer/coverage-summary.json`).

[VERIFIED] `examples/kern-canonicalizer/canonicalizer.kern` is exactly 438
lines. The sealed M4.2 contract requires a helper split before production
expansion because every handwritten source file must remain below 500 lines
(`.Codex/specs/kern-5-r2-m4-2-next-toolchain-slice/spec.md`).

[VERIFIED] Agon tribunal
`tribunal-1784406753512-n6wkbf-kern-5-r2-m4-3b-binary-design` completed all four
seats and both rounds after recovering Kimi's round-two timeout. It rejected
both dynamic host concatenation and a public runtime-handler ABI change. The
selected design is a checked-in, digest-pinned composite of two authored KERN
members, executed unchanged through the existing one-source runtime ABI.

[PROPOSED] M4.3b splits the existing KERN helpers, adds only canonical binary
expression validation/emission, preserves every non-binary golden byte, binds
composition into the coverage receipt, and stops. It does not select or
implement a second family.

[VERIFIED] During receipt regeneration, live measurement reported 99 functions
and 1,002 binary occurrences. The original 98/941 freeze was internally
contradictory: it described the pre-slice selection receipt while also requiring
the newly authored `validbinaryop` function and binary implementation to enter
the measured corpus. Synthesis tribunal
`tribunal-1784459844249-vw92xw-kern-5-r2-m4-3b-receipt-contradi` reached a
3/4-engine verdict (Agon, Claude, and MiniMax; Codex failed its dispatch) to
separate frozen selection provenance from honest live measurement. M4.3b now
pins the M4.3a 98/941 receipt and reports the current 99/1,002 values without
excluding code or manufacturing counts.

## Current State and Root Cause

[VERIFIED] The structural expression catalog represents binary expressions as
an exact record with ordered fields `left`, `op`, and `right`. `left` and
`right` recursively contain canonical expressions; `op` is one of exactly 24
spellings owned by `packages/core/src/kir-structural/expression.ts`.

[VERIFIED] The tribunal repeatedly called this a 25-entry set, but the exact
set it quoted and the authoritative catalog both contain 24 entries. M4.3b
records the verified count and does not invent a missing operator to preserve
the tribunal's arithmetic error.

[VERIFIED] The KERN-owned `exprsource` currently admits only null, identifier,
boolean, integer, text, and list expressions. Any other kind returns the empty
failure sentinel, so the three measured binary witnesses fail before source
escapes (`examples/kern-canonicalizer/canonicalizer.kern:200-252`).

[VERIFIED] `executeKernRuntimeHandlerSync` accepts one inspected `source`
string and resolves a handler inside a single parsed module. Adding public
module transport would change a quarantined ABI and its import-closure proof
for a local formatter tranche (`packages/core/src/runtime-handler.ts:65-75`,
`packages/core/src/runtime-envelope/source-handler.ts:80-110`).

[VERIFIED] The generic host currently reads one checked-in KERN source and
passes those bytes directly to the runtime. It owns table adaptation, limits,
execution, and differential checking; it does not own expression spelling
(`scripts/check-kern-canonicalizer.mjs:17-95`).

## Tribunal Decision

### Selected: checked-in authenticated composite

[PROPOSED] The executable source is a generated, checked-in
`canonicalizer.composed.kern` whose bytes are exactly:

1. `canonicalizer-expression-helpers.kern`, ending in exactly one LF;
2. `canonicalizer.kern`, ending in exactly one LF;
3. no inserted separator, header, footer, or rewritten byte.

[PROPOSED] A canonical composition record owns the ordered paths, byte lengths,
SHA-256 digests, recipe version, and composite digest. A small checker verifies
contained regular files, forbids symlinks, recomposes in memory, and compares
the checked-in composite byte-for-byte before the host reads it.

[PROPOSED] The generated composite is executable evidence only. Coverage
measures the two authored members and must reject adding the composite as a
third corpus member, preventing double-counted functions.

### Rejected: dynamic host concatenation

[REJECTED] Reading two sources and concatenating them only at runtime makes the
generic host an unauthenticated composition owner. Reviewers cannot inspect
the exact executed bytes, and ordering/seam drift is not a checked-in diff.

### Rejected: module-aware public runtime ABI

[REJECTED] Extending the public runtime-handler request with modules, loaders,
or resolution policy is disproportionate, changes a defended perimeter, and
mixes later frontend/module work into one expression-family slice.

### Rejected: minimal parentheses or generated operator infrastructure

[REJECTED] Minimal parentheses require precedence and associativity logic in
implementation and verification. Generating a 24-entry KERN operator table
adds machinery larger than the fixed catalog. The KERN owner instead emits an
AST-isomorphic fully parenthesized form and a mechanical checker locks all 24
spellings.

## Exact Split and Ownership

[PROPOSED] Move the current lines 1-166 into
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern`. This member owns:

- identifier validation;
- source quoting;
- structural-name spelling;
- node/property/value row lookup;
- record-field access.

[PROPOSED] Keep `typesource`, `exprsource`, `tablesok`, and `canonicalize` in
`canonicalizer.kern`. Add `validbinaryop` beside `exprsource`; the helper member
must contain neither the text `binary` nor any binary-operator allow-list.

[PROPOSED] Both authored files must remain below 500 lines. The composite is a
generated artifact and is exempt from the handwritten-source ceiling.

## Binary Expression Contract

| Concern | Contract | Tag |
|---|---|---|
| Shape | `kind` is exactly `binary`; `fields` has exactly `left`, `op`, `right` | PROPOSED |
| Operands | Both ids exist and recursively produce non-empty `exprsource` output | PROPOSED |
| Operator | Text tag and exact membership in the 24 structural-catalog spellings | PROPOSED |
| Output | Always `(<left> <op> <right>)` with one ASCII space around `op` | PROPOSED |
| Nesting | Parentheses preserve the exact recursive tree; no precedence table | PROPOSED |
| Failure | Malformed shape/operator/operand returns the existing empty sentinel; caller rejects before output | PROPOSED |
| Ownership | Operator validation, whitespace, parentheses, and recursion stay in KERN | PROPOSED |

[VERIFIED] The exact operator set is `+`, `-`, `*`, `/`, `%`, `**`, `==`,
`!=`, `===`, `!==`, `<`, `<=`, `>`, `>=`, `instanceof`, `&&`, `||`, `??`,
`&`, `|`, `^`, `<<`, `>>`, and `>>>`.

## Receipt and Coverage Contract

[PROPOSED] The coverage receipt binds:

- the ordered composition record;
- each authored member digest and length;
- the composite digest;
- both authored corpus members;
- the existing structural catalog, policy, implementation, and compiled-core
  digests.

[VERIFIED] The M4.3a selection remains an exact, digest-pinned historical
provenance invariant: `binary-expression`, three functions, one tool, 941
occurrences, the same three witnesses, 98 functions, and seven corpus members.
The live M4.3b receipt separately measures `binary-expression`, the same three
functions, one tool, the same witnesses, 1,002 occurrences, 99 functions, and
eight authored corpus members.

[PROPOSED] A deterministic non-binary golden digest covers every pre-M4.3b
valid fixture. Adding binary fixtures must not change that digest. This makes
"no scope creep" executable rather than descriptive.

[VERIFIED] The helper split preserves the original functions and adds the
KERN-owned `validbinaryop`, so live coverage measures 99 total functions and
four tools. Corpus member count increases from seven to eight without
double-counting the generated composite. The prior 98-function surface remains
authenticated in the frozen selection-provenance record.

## Required RED Oracles

- [PROPOSED] The three measured assertion-engine witnesses fail
  canonicalization before the binary implementation.
- [PROPOSED] A golden binary fixture proves exact fully parenthesized output,
  KIR preservation, and second-pass byte idempotence.
- [PROPOSED] All 24 operators have a mechanical catalog-parity oracle that does
  not rely on corpus occurrence coverage.
- [PROPOSED] Removing, changing, duplicating, or reordering `left`, `op`, or
  `right` fails before source/events/result escape.
- [PROPOSED] Non-text operators, empty operators, whitespace variants,
  Unicode confusables, and near-neighbor tokens fail.
- [PROPOSED] Token-neighbor groups are explicit: `*`/`**`, `>`/`>>`/`>>>`,
  and `==`/`===` cannot prefix-match.
- [PROPOSED] `a - (b - c)` differs from `(a - b) - c`, and both exponentiation
  nest directions round-trip without precedence knowledge.
- [PROPOSED] Reversed/omitted/duplicated members, stale length/digest,
  appended bytes, a missing trailing LF, seam token merge, symlinks, and
  non-regular paths fail composition.
- [PROPOSED] The generated composite cannot enter the handwritten coverage
  corpus and cannot add function/tool credit.
- [PROPOSED] Helper pollution with binary semantics or operator literals fails.
- [PROPOSED] Existing non-binary fixture bytes and their aggregate digest stay
  unchanged.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern` | add | authored reusable pre-expression helpers |
| `examples/kern-canonicalizer/canonicalizer.kern` | split/modify | retain owners and add binary validation/emission |
| `examples/kern-canonicalizer/canonicalizer.composed.kern` | generate | exact inspected executable bytes |
| `scripts/kern-canonicalizer/composition.json` | add | ordered paths, lengths, digests, recipe, composite digest |
| `scripts/kern-canonicalizer/composition.mjs` | add | fail-closed recomposition/check/write seam |
| composition/canonicalizer tests and fixtures | modify/add | RED hostile, operator, nesting, invariance evidence |
| `scripts/check-kern-canonicalizer.mjs` | modify | authenticate then execute the checked-in composite |
| coverage policy/receipt/tests | modify | bind two authored members and composition provenance |
| package/release/spec docs | modify | add gates and durable evidence |

## Acceptance Criteria

- [x] Tribunal verdict, exact split boundary, binary shape, operator set,
      output spelling, and stop conditions are recorded before code.
- [x] Composition hostile tests reject reversal, omission, duplication, digest
      drift, seam drift, non-regular files, and symlinks.
- [x] Binary witness, golden, and hostile oracles discriminate exact KERN-owned
      binary support from the pre-slice surface.
- [x] Both authored KERN members are under 500 lines and the helper member owns
      no binary/operator semantics.
- [x] The composition checker authenticates exact ordered member bytes and the
      host executes only the verified checked-in composite.
- [x] All 24 operators are catalog-locked and emit fully parenthesized output.
- [x] The three measured witnesses canonicalize; their winner identity,
      completion count, tool count, and names match frozen selection provenance.
- [x] Every existing non-binary golden and aggregate digest is unchanged.
- [x] Coverage authenticates the frozen 98/941 M4.3a selection, honestly reports
      the live 99/1,002 M4.3b surface, measures four tools and eight authored
      members, and excludes the composite from handwritten credit.
- [x] Focused build/typecheck/canonicalizer tests pass.
- [x] Complete Node 22 `pnpm fitness:kern-5` passes on the final receipt-bound
      tree.
- [x] Terminal exact-roster Agon review has no unresolved material finding:
      Claude and Antigravity completed clean; Codex hit its account limit after
      retry, leaving an explicitly recorded 2/3 routing shortfall.

## Explicit Stop Conditions

Stop the slice if implementation requires any of the following:

- public runtime-handler ABI or request-shape change;
- runtime module resolution or a generic host linker;
- host-owned operator, whitespace, parentheses, or precedence decisions;
- minimal-parentheses logic;
- any expression family besides `binary`;
- fewer or more than the authoritative catalog's 24 operators;
- relaxed exact-field or recursive operand validation;
- new or weakened resource limits;
- frozen provenance drift, or live winner identity/completion/tool/witness drift;
- generator infrastructure for the fixed operator list;
- executable bytes that are not inspectable, checked in, and digest-bound;
- a verifier that must understand precedence.

## Deploy Order

[VERIFIED] M4.3b is stacked on the unmerged M4.3a feature branch. It may be
pushed on that same branch while M4.3a remains unmerged. If M4.3a lands first,
start a fresh branch from `origin/main` and cherry-pick only the M4.3b commit.

## Open Questions

None blocks implementation. The tribunal resolved the only architectural
choice; exact digests and measured receipt values are outputs of the RED/build
cycle, not inputs to guess.
