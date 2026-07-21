# KERN 5 R2 M4.34 — Do-Statement Prerequisite Handoff

**Status:** REVIEWED — PUBLISH PENDING
**Date:** 2026-07-21
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published `origin/main` commit
`f91c92aa63524c65c261d1f34f2187c55455ea6b` contains reviewed M4.33. Its
authenticated prerequisite receipt selects `do-statement` as the exact next
minimum one-family closure: validator function `appendid` after two
counterfactual direct parameter rows, with two catalog facts and 176
occurrences.

[DECIDED] M4.34 is evidence-only. Freeze the exact published M4.33 commit,
coverage summary, prerequisite summary, baseline, selected family, closure,
and witness as the fifth immutable prerequisite-provenance record. Extend the
ordered chain from four records to five while keeping the implementation
pointer on unary expression at chain index 3. Do not migrate `appendid`, add do
canonicalization, promote do, or change KERN source, composition, profile,
policy, registry, runtime, KIR, or ABI.

## Published Input

[VERIFIED] Exact M4.33 artifacts are:

- commit `f91c92aa63524c65c261d1f34f2187c55455ea6b`;
- coverage summary format 6, SHA-256
  `8550b80e0a98da57f26a9c78ac762b0049cc02146202b278e817bf07051d774a`;
- prerequisite summary format 3, SHA-256
  `d8c2fdd07c96ce6548edd1121ae0eea1596c14a52f25d4caab15cf259edf1e1c`;
- canonicalizer composite 40,459 bytes, SHA-256
  `e58663c3bdc552faa094b8318650f8791f30056ceea81a4888293fc64f348101`;
- coverage policy SHA-256
  `cc4b84c8655a458890edb6c7b79a07a5c1af7997db172a559c7cdeec47ff33b6`;
- coverage implementation digest
  `3e47fea76a74d98bf742777d486a6b2f898d569bee01c1526942b87f6f1271c4`.

[VERIFIED] Existing prerequisite record digests remain:

1. index expression:
   `3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`;
2. counted iteration:
   `af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`;
3. binding:
   `00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`;
4. unary expression:
   `e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`.

## Exact Snapshot Contract

| Field | Exact value | Tag |
|---|---|---|
| record format | `kern.kir-canonicalizer.prerequisite-provenance.1` | VERIFIED |
| source commit | full published M4.33 object id | VERIFIED |
| source coverage | format 6 and exact published SHA-256 | VERIFIED |
| source prerequisite | format 3 and exact published SHA-256 | VERIFIED |
| baseline profile | `kern.kir-canonicalizer.profile.m4.29` | VERIFIED |
| baseline counts | 45 complete / 104 functions / 57 legacy blockers / 9 corpus members / 4 tools | VERIFIED |
| minimum family count | 1 | VERIFIED |
| selected prerequisite | do statement / 2 catalog facts / 176 occurrences | VERIFIED |
| winning closure | singleton do / 1 function / 1 tool / 2 rows / 176 occurrences | VERIFIED |
| witness | `examples/selfhost-validator/validator.kern#14:appendid` | VERIFIED |
| chain | exact `[index, counted, binding, unary, do]` | DECIDED |
| implementation pointer | unary record at chain index 3 | DECIDED |

## Ownership Boundary

[DECIDED] M4.34 owns only durable causal evidence for the already-published
prerequisite result. M4.35 may consume the immutable record to implement do
canonicalization, but it may not reconstruct the causal input from mutable live
summaries.

[DECIDED] Appending an unpromoted do prerequisite must not add do to the base
promotion list or change `implementationProvenance`. The current implementation
remains unary-expression through exact M4.27 provenance.

[VERIFIED] No KERN or policy byte needs to change. The new record and its
loader/tests change the authenticated implementation graph, so coverage and
prerequisite summaries must be regenerated after the final `.mjs` edit.

## RED and Mutation Contract

1. Add a dedicated do-handoff test importing the absent exact loader and
   validator; sealed M4.33 must fail at module instantiation.
2. Pin exact source commit, summary formats/hashes, baseline, selected family,
   closure, witness, canonical JSON bytes, and record digest.
3. Prove the chain is exactly five records and preserves the first four bytes.
4. Reject reversal, omission, duplication, every claimed digest mutation,
   record/source drift, baseline drift, occurrence drift, row drift, and
   witness substitution.
5. Prove coverage receipts contain the five-record chain while live
   implementation provenance remains unary at index 3.

## Implementation Plan

1. Prove RED through the missing do handoff loader.
2. Add canonical do prerequisite JSON from the published M4.33 facts.
3. Add the exact do pin, validator, loader, and fifth positional chain member.
4. Update terminal/coverage/handoff assertions for five-record history and the
   unchanged unary implementation pointer.
5. Regenerate authenticated summaries, record exact digests, and run focused
   gates followed by the complete Node 22 fitness wall.
6. Run automatic high-risk role-lens review, resolve verified findings, sign,
   fetch/rebase, atomically publish feature plus authorized main once with
   `--no-verify`, verify both refs, and start the next slice fresh.

## Acceptance Criteria

- [x] Fresh branch starts from published M4.33 commit
      `f91c92aa63524c65c261d1f34f2187c55455ea6b`.
- [x] Published summaries and exact do closure are grounded from current files.
- [x] RED fails because M4.33 has no do handoff loader or five-record chain.
- [x] Canonical do bytes bind every exact published source and snapshot field.
- [x] Exact validation rejects structurally valid causal drift.
- [x] Chain is exactly index, counted, binding, unary, do and fail-closes on
      order, cardinality, claimed digest, or record drift.
- [x] Existing four record bytes and loaders remain unchanged.
- [x] Coverage receipts authenticate five records while implementation
      provenance remains unary at index 3.
- [x] KERN source, composite, policy, profile, registry, corpus, live 45/104
      result, 57 blockers, and do prerequisite remain exact.
- [x] Focused and complete Node 22 gates pass, including the exact final-tree
      `pnpm fitness:kern-5` wall.
- [x] Full usable-roster high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      feature ref and authorized main; both remote hashes verify.

## Stop Conditions

- Published M4.33 commit or either summary hash differs.
- Live do closure differs from one function, one tool, two rows, two catalog
  facts, 176 occurrences, or the exact `appendid` witness.
- Freezing evidence requires any KERN, policy, profile, registry, parser, KIR,
  runtime, ABI, evaluator, or measurement-semantics change.
- Any existing prerequisite record byte or exact loader changes.
- Appending do moves implementation provenance away from unary.
- Five-record validation cannot reject order, cardinality, claimed digest, or
  structurally valid record drift.

## Out of Scope

- Migrating `appendid` from `fn.params`.
- Implementing or promoting do, exception, or while.
- Changing parameter selection, profile limits, runtime, KIR, ABI, evaluator,
  public exports, dependencies, package versions, or release labels.
- Refactoring the exact historical provenance mechanism.
- Claiming KIR v1 freeze, public reader export, runtime cutover, KERN 5
  completion, or Fable work.

## Open Questions

None. Every implementation input is either an exact published artifact or a
deterministic current-source fact.

## Implementation Evidence

[VERIFIED] RED failed at module instantiation because sealed M4.33 did not
export `loadCanonicalizerDoPrerequisiteProvenance`. After implementation, the
focused Node 22 integration suite passes 38/38 tests, the promotion regression
passes 9/9, and the complete canonicalizer suite passes 102/102 tests,
including the three dedicated M4.34 tests and hostile order, cardinality,
digest, source, baseline, occurrence, row, and witness mutations. Plain check
mode also passes.

[VERIFIED] The canonical do provenance is 1,186 bytes with SHA-256
`3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72`.
Regenerated receipt SHA-256 values are
`017ba566b0648fe9a7eb9d10b4646bda267273abeb0223831040d59a1cfad9fe`
for coverage and
`8f95372d6bd48f309a01efc045a2a2698bb38346169313d78b87b6e9c22a2a92`
for prerequisite selection. The authenticated implementation digest is
`283ab5664e670b1efbeb32809aeae7a35ed17febfc4c3e7762e30253b760dd20`.

[VERIFIED] Coverage remains 45/104 with 57 `fn.params` blockers, no ordinary
winner, and the exact live do prerequisite. Coverage policy remains
byte-identical at
`cc4b84c8655a458890edb6c7b79a07a5c1af7997db172a559c7cdeec47ff33b6`;
the KERN composite remains 40,459 bytes at
`e58663c3bdc552faa094b8318650f8791f30056ceea81a4888293fc64f348101`.
The five-record receipt ends in do, while implementation provenance remains
the unary record
`e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`.
The runtime gate passes 48 golden/idempotence/KIR fixtures, eight measured
witnesses, three profile-limit fixtures, and 218 hostile fixtures.

[VERIFIED] The exact final-tree Node 22 `pnpm fitness:kern-5` aggregate exits
zero with `KERN 5 current fitness wall passed`, including every workspace,
conformance, native, application, KIR, ownership, runtime, convergence, and
repeated canonicalizer gate.

[VERIFIED] Automatic high-risk role-lens review
`review-1784675099637-as8in6` completed 6/6 usable non-excluded engines with
zero verified findings. Two needs-check suggestions proposed consolidating the
explicit positional provenance mechanism and moving exact-chain ownership out
of the newest handoff test. Both are non-blocking refactors and are deliberately
deferred: this evidence-only slice must preserve the historical mechanism, the
five positional validators fail closed, the newest test owns exact whole-chain
identity, and older family tests retain immutable-prefix ownership. The
remaining speculative and nit findings were verified as passing, intentional,
historical wording, or duplication required by independent receipt checks. No
material finding remains.
