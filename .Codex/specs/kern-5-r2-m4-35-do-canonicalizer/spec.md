# KERN 5 R2 M4.35 — Do-Statement Canonicalizer Tranche

**Status:** READY TO PUBLISH — REVIEW REMEDIATION GREEN
**Date:** 2026-07-21
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published `origin/main` commit
`f58a6d14d850b873d750fae2225e145d58cc2597` contains the immutable M4.34
`do-statement` prerequisite handoff. Its canonical record has SHA-256
`3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72`
and freezes one singleton closure: one canonicalizer function, one tool, two
counterfactual parameter rows, two catalog facts, 176 occurrences, and exact
witness `examples/selfhost-validator/validator.kern#14:appendid`.

[DECIDED] Implement the exact structural `do` statement in the KERN-authored
canonicalizer. A `do` node owns exactly one required `value` expression, owns
no child statements, recursively consumes the already admitted expression
profile, and emits one canonical `do value=` line. Preserve structural KIR,
canonical source, byte idempotence, fail-closed rejection, authenticated
composition, the five prerequisite records, and the unary implementation
pointer. Do not promote `do`, migrate `appendid`, or change the cumulative
profile in this slice.

## Published Input

[VERIFIED] The exact M4.34 inputs are:

- commit `f58a6d14d850b873d750fae2225e145d58cc2597`;
- do prerequisite-provenance SHA-256
  `3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72`;
- coverage-summary SHA-256
  `017ba566b0648fe9a7eb9d10b4646bda267273abeb0223831040d59a1cfad9fe`;
- prerequisite-summary SHA-256
  `8f95372d6bd48f309a01efc045a2a2698bb38346169313d78b87b6e9c22a2a92`;
- coverage-policy SHA-256
  `cc4b84c8655a458890edb6c7b79a07a5c1af7997db172a559c7cdeec47ff33b6`;
- canonicalizer composite 40,459 bytes, SHA-256
  `e58663c3bdc552faa094b8318650f8791f30056ceea81a4888293fc64f348101`;
- statement member 10,283 bytes, SHA-256
  `cc4e9aaafc55269e1278d354776c67924737d32e1824413708cb01a6ac2f4f62`;
- coverage implementation digest
  `283ab5664e670b1efbeb32809aeae7a35ed17febfc4c3e7762e30253b760dd20`.

[VERIFIED] Live baseline is profile
`kern.kir-canonicalizer.profile.m4.29`, 45/104 base-complete functions, 57
legacy `fn.params` blockers, nine corpus members, four tools, a null ordinary
winner, and `do-statement` as the exact next one-family prerequisite.

## Current State and Root Cause

[VERIFIED] The family registry defines `do-statement` as exactly node kind
`do` and property `do.value`. The parser projects `value` into structural
expression KIR. The schema admits no child contract needed by this family.

[VERIFIED] `validstatement` currently handles `return`, `let`, `assign`, `if`,
`else`, and `for`, then rejects every other kind. `emitstatement` has the same
ownership gap. Therefore the published executable rejects the authenticated
`appendid` witness even though its body already uses otherwise promoted
structure.

[VERIFIED] The existing expression owner already canonicalizes the expression
families needed by the witness and valid corpus. The missing capability is
statement validation and emission, not parser, runtime, KIR, ABI, or expression
support.

## Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| node kind | exactly `do` | VERIFIED |
| properties | exactly one required `value` property | VERIFIED |
| children | exactly zero | DECIDED |
| value | recursively admitted structural expression via `exprsource` | DECIDED |
| emission | one line: `prefix + "do value=" + quotesource(expression)` | DECIDED |
| recursion | admitted call, member, index, unary, binary, list, and scalar forms inherit existing ownership | DECIDED |
| malformed form | reject the whole document with no events or partial result | DECIDED |
| helper count | inline validation/emission; add no KERN function and preserve 104-function denominator | DECIDED |
| profile | keep `kern.kir-canonicalizer.profile.m4.29` unchanged | DECIDED |
| provenance | preserve all five prerequisite records and unary implementation provenance byte-for-byte | DECIDED |

## RED and Mutation Plan

[DECIDED] Register a dedicated do fixture module and a static ownership test
before production KERN edits. RED must prove sealed M4.34 lacks both KERN do
validation and emission, and that the first valid do fixture is rejected by
the executable canonicalizer.

[DECIDED] Valid fixtures cover direct side-effect calls, canonical argument
spacing, and do nested under already promoted `for` and `if` statements.
Every fixture must preserve exact golden source, structural KIR equality, and
second-pass byte idempotence.

[DECIDED] Hostile mutations cover missing, duplicate, excluded, and future
properties; non-expression and unsupported expression payloads; and child
statements. Every hostile table must reject completely.

## Implementation Plan

1. Add the claim-tagged contract, do fixtures, and missing-ownership test.
2. Capture focused static and executable RED evidence on sealed M4.34.
3. Add one exact `do` branch to `validstatement` and one to `emitstatement`.
4. Regenerate composition, the changed statement-member policy digest, and
   authenticated coverage/prerequisite summaries.
5. Update exact live pins while preserving the immutable M4.34 record and
   keeping do unpromoted.
6. Run the focused Node 22 canonicalizer gate, full KERN 5 fitness wall, and
   automatic high-risk role-lens review before one rebased atomic publish.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared M4.35 implementation contract and evidence |
| `scripts/kern-canonicalizer/do-fixtures.mjs` | add | isolated valid and hostile do corpus |
| `scripts/kern-canonicalizer/fixtures.mjs` | modify | register do fixtures below 500 lines |
| `scripts/kern-canonicalizer/canonicalizer.test.mjs` | modify | exact KERN validation/emission ownership |
| statement helper member | modify | KERN-owned do validation and emission |
| composite and composition record | regenerate | authenticate changed KERN bytes |
| coverage policy | modify | refresh only the statement-member digest |
| coverage/prerequisite summaries and tests | regenerate/update | bind final implementation and corpus digests |
| release train | modify | record M4.35 evidence and next slice |

## Acceptance Criteria

- [x] Branch starts from exact published M4.34 `origin/main`.
- [x] Registry, parser projection, statement ownership, witness, profile, and
      provenance are grounded in current source.
- [x] RED proves M4.34 lacks do validation/emission and rejects valid do input.
- [x] KERN owns exact no-child, one-value validation and canonical emission.
- [x] Missing, duplicate, extra, malformed, unsupported, and child-bearing do
      forms fail closed.
- [x] Valid fixtures pass exact golden output, structural KIR equality, and
      second-pass byte idempotence.
- [x] Do remains unpromoted; profile, family registry, closure identity,
      implementation pointer, and all five prerequisite records stay exact.
- [x] Authenticated composition, policy corpus digest, and live summaries are
      regenerated from the final tree.
- [x] Focused Node 22 canonicalizer gate and complete KERN 5 fitness wall pass.
- [x] Automatic high-risk role-lens review has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`; both refs are verified.

## Out of Scope

- Do promotion, parameter migration, next-family selection, or KERN 5 release.
- Changing parser, structural KIR, runtime ABI, evaluator, public exports,
  package versions, profile limits, family registry, or selection semantics.
- Refactoring historical provenance loaders or fixture frameworks.
- Exception, while, lambda, record, decimal, or conditional-expression work.

## Stop Conditions

- Published M4.34 or immutable do provenance differs from the exact input.
- Correct do emission requires a parser, KIR, runtime, ABI, or public-contract
  change.
- Structural KIR cannot survive canonicalization and a second parse.
- Any prerequisite record, profile, closure member, baseline, or unary
  implementation pointer changes.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Current Evidence

[VERIFIED] RED first failed the new static ownership test at `missing
KERN-owned do validation`. The executable M4.34 composite then rejected the
first valid fixture as `profile rejection: do-direct-call returned
uncaught-throw`.

[VERIFIED] The final KERN statement member is 158 lines and 11,014 bytes at
SHA-256 `475ec6bcaa3bcc3610a1dcb64cfa9175ee8faf00a20d458586b2003fd7009314`.
The authenticated three-member composite is 41,190 bytes at SHA-256
`40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`.

[VERIFIED] Live do occurrence evidence rises from immutable M4.34's 176 to
178 because the implementation adds both a do-kind validation fact and a
do-value emission fact. The profile remains M4.29, base completion remains
45/104, legacy parameter blockers remain 57, `appendid` remains unmigrated,
and unary remains the implementation provenance.

[VERIFIED] Final policy, coverage, and prerequisite receipt SHA-256 values are
`fa5cedd2be8cac69bf4798826848ccf445e6788738685e015be149f5d3df67a4`,
`3be607f15bcd762a24ece0dacf2816fded0dd9b57b082780fe2f6590bf27632a`,
and `e932f7f4c85f9aedc02b76ba13ea1e91033be0998303fc997ce067a7f617f832`.
The authenticated implementation digest is
`5f25fd30c54b55a770b1bcce0828316d147f283e40ff68c67452ca7a6a1d457b`.

[VERIFIED] Focused Node 22 `pnpm test:kern-canonicalizer` passes 103/103
structural, authentication, policy, mutation, and stability tests plus 51
exact golden/KIR/idempotence fixtures, eight measured witnesses, three
profile-limit fixtures, and 226 hostile fixtures.

[VERIFIED] The complete pre-review Node 22 `pnpm fitness:kern-5` wall passes.
It includes repository consistency, lint, production builds, all 22 workspace
packages, infrastructure and conformance suites, native and browser budgets,
self-host validators, runtime/KIR/ABI/ownership/eligibility/convergence gates,
diff hygiene, and the final canonicalizer replay at the exact receipt-bound
45/104 coverage state. The only subsequent change is the review-driven hostile
fixture precision correction, which passes the exact final-tree focused gate.

[VERIFIED] Initial automatic high-risk review
`review-1784678742702-fdb847` completed all six usable non-excluded seats.
Five seats found no blocker. Kimi and Z.AI identified one valid fixture-
precision issue: the non-expression mutation could also fail through a void
return mismatch. The witness now changes the function return type to `number`
while preserving ownership of the displaced expression, so only the malformed
`do.value` remains invalid. The regenerated focused Node 22 canonicalizer gate
passes 103/103 and the full runtime corpus again. MiniMax's alleged value-ID
ordering and unauthenticated-digest blockers were rejected against append-only
ID allocation and live digest regeneration. No material review finding remains.
