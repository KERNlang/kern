# KERN 5 R2 M4.19 — Counted-Iteration Prerequisite Handoff

**Status:** REVIEWED — PUBLICATION PENDING
**Date:** 2026-07-21
**Confidence:** 0.94

## Executive Summary

[VERIFIED] Published `origin/main` commit
`8e6cc3a5b721923647a9b1564337d1fd7910edaa` contains reviewed M4.18. Its
authenticated prerequisite receipt selects `counted-iteration` as the only
remaining member of the minimum completing closure: six functions, three
tools, 14 migrated parameter rows, and 468 occurrences
(`scripts/kern-canonicalizer/coverage-prerequisite-summary.json:1-117`).

[DECIDED] M4.19 is an evidence-only handoff. Freeze the exact published M4.18
commit, coverage summary, prerequisite summary, baseline, selected family,
closure, and witnesses in a second canonical prerequisite-provenance record.
Extend the existing prerequisite evidence API into an exact ordered two-record
chain while retaining the index-specific loader. Do not change KERN source,
the composition, the coverage policy, or live semantic results.

## Current State / Root Cause

[VERIFIED] The prerequisite validator already defines the required canonical
record shape and causal invariants, but its source-format guard accepts only
coverage-summary format 5 and its exact pin/loader is index-specific
(`scripts/kern-canonicalizer/coverage-prerequisite-provenance.mjs:4-10,64-213`).

[VERIFIED] Coverage composition currently wraps only the M4.16 index handoff
in `prerequisiteProvenances`
(`scripts/kern-canonicalizer/coverage-composition.mjs:7-28`). The live receipt
therefore authenticates prerequisite history as a collection, but has no
published counted-iteration record for the next implementation slice.

[VERIFIED] The exact M4.18 source artifacts are:

- commit `8e6cc3a5b721923647a9b1564337d1fd7910edaa` (`git rev-parse HEAD`);
- coverage-summary format 6, SHA-256
  `6e75ecfe710b9e4ba5ca8df2b5bb0080260a786f37674f5c938db8a5373db1a9`;
- prerequisite-summary format 1, SHA-256
  `0759e372fa2c10e61bc341518be2b67121772757835107f0bbedc3399a3b3ded`;
- unchanged KERN composition SHA-256
  `37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308`.

The hashes were verified with `shasum -a 256` on 2026-07-21.

## What Already Works

[VERIFIED] The generic validator rejects unknown fields, malformed counts,
unsorted or duplicate closure data, witness-count mismatch, impossible tool or
baseline counts, malformed commits, and malformed digests
(`scripts/kern-canonicalizer/coverage-prerequisite-provenance.mjs:16-192`).

[VERIFIED] M4.16 index provenance is canonical and pinned at SHA-256
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`;
its exact loader and mutation coverage must remain compatible
(`scripts/kern-canonicalizer/coverage-handoff.test.mjs:26-163`).

[VERIFIED] The live M4.18 prerequisite result and fresh-process parity are
already executable tests (`scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:11-104`).
M4.19 freezes those facts; it does not reimplement their measurement.

## Contract (Verified)

> Verified against the published M4.18 source, summary files, loader clients,
> and tests on 2026-07-21.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| record format | `kern.kir-canonicalizer.prerequisite-provenance.1` | `coverage-prerequisite-provenance.mjs:4,64-66` | VERIFIED |
| source commit | exact full M4.18 object id | `git rev-parse HEAD` | VERIFIED |
| source coverage | format 6 plus exact published SHA-256 | `coverage-summary.json`; `shasum -a 256` | VERIFIED |
| source prerequisite | format 1 plus exact published SHA-256 | `coverage-prerequisite-summary.json`; `shasum -a 256` | VERIFIED |
| baseline | M4.18 profile, 21/104, 81 parameter blockers, 9 corpus members, 4 tools | `coverage-prerequisite-summary.json:2-18` | VERIFIED |
| selected prerequisite | counted iteration, 4 catalog facts, 468 occurrences | `coverage-prerequisite-summary.json:111-115` | VERIFIED |
| winning closure | singleton counted iteration; 6 functions, 3 tools, 14 parameter rows, 468 occurrences | `coverage-prerequisite-summary.json:26-109` | VERIFIED |
| witnesses | exact six sorted function ids | `coverage-prerequisite-summary.json:37-107` | VERIFIED |
| prerequisite history | exact ordered `[index, counted-iteration]` chain | M4.16 pin plus published M4.18 result | DECIDED |
| compatibility loader | retain `loadCanonicalizerIndexPrerequisiteProvenance` unchanged | repository client search | DECIDED |
| current implementation pointer | remains the promoted index provenance | `coverage-implementation.mjs:433-458` | VERIFIED |

## Implementation Options

| Option | Result | Decision |
|---|---|---|
| Implement counted iteration immediately | changes KERN bytes before freezing the published causal input | Reject |
| Replace the M4.16 index record | destroys immutable prerequisite history and breaks M4.18 promotion authentication | Reject |
| Create a second standalone record without a chain API | freezes bytes but leaves consumer ordering/cardinality ad hoc | Reject |
| Add the exact record plus an ordered, pinned two-record chain | preserves history and gives M4.20 one authenticated input | Select |

The selected option is the only one that preserves the already-consumed index
record while exposing the next causal input without widening implementation
scope.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-slice contract and evidence |
| `coverage-counted-iteration-prerequisite-provenance.json` | add | immutable M4.18 handoff bytes |
| `coverage-prerequisite-provenance.mjs` | modify | format-5/6 structural support, exact counted pin, ordered chain API |
| `coverage-composition.mjs` | modify | authenticate the exact prerequisite chain |
| `coverage-handoff.test.mjs` | modify | RED, exact bytes, mutation, chain/order compatibility |
| `check-kern-canonicalizer-coverage.mjs` | modify | assert both immutable handoffs and current pointer |
| `coverage-summary.json` | regenerate | bind the two-record prerequisite history and implementation digest |
| `coverage-prerequisite-summary.json` | regenerate | bind the changed local implementation digest only |
| release train | modify | durable M4.19 evidence |

## Acceptance Criteria

- [x] Fresh branch starts from exact published M4.18 `origin/main`.
- [x] All clients of the prerequisite provenance module are enumerated by
      repository search.
- [x] RED fails because M4.18 has no immutable counted-iteration handoff or
      exact two-record prerequisite chain.
- [x] New canonical bytes bind the exact M4.18 commit and both published
      summary hashes.
- [x] Snapshot binds the exact M4.18 baseline, singleton closure, selected
      counted-iteration family, and six witnesses.
- [x] Generic validation supports only historical coverage formats 5 and 6;
      both exact handoff validators still reject structurally valid drift.
- [x] The chain is exactly ordered index then counted iteration, rejects
      omission/reordering/duplication/digest drift, and retains the
      index-specific compatibility loader.
- [x] Coverage receipt/summary authenticate both prerequisite records while
      `implementationProvenance` continues to identify promoted index.
- [x] KERN source, composition digest, policy digest, live counts, ranking,
      and selected counted-iteration prerequisite remain semantically exact.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster high-risk role-lens review has no unresolved material
      finding.
- [ ] KERN-signed commits are fetched/rebased before one atomic
      `--no-verify` push to the feature ref and explicitly authorized `main`.

## Out of Scope

- Counted-iteration canonicalizer implementation or promotion.
- Migrating any real KERN function signature from legacy `fn.params`.
- Changing the prerequisite-ranking algorithm or format-1 summary semantics.
- Changing KERN source, composition, structural KIR, parser, runtime ABI,
  corpus membership, family registry, or coverage policy.
- Refactoring historical selection provenance or M4.18 review nits.

## Open Questions

None. The selected path has no ASSUMED or OPEN claim feeding acceptance tests.

## Deploy Order

[DECIDED] Add the immutable record, exact validator/loader, ordered chain,
mutations, regenerated live receipts, spec, and release evidence in one slice.
Run focused and full gates, then high-risk independent review. Immediately
before the only push, fetch and rebase onto `origin/main`; atomically publish
the feature ref and authorized `main`. Fetch again and start M4.20 from a new
branch. The next slice may consume the counted handoff; this slice never
changes KERN behavior, so there is no runtime skew window.

## Stop Conditions

- Published M4.18 summary bytes or live causal facts differ from the hashes and
  snapshot above.
- Freezing the handoff requires changing KERN source, policy, corpus, registry,
  parser, runtime, or measurement semantics.
- The old index handoff or M4.18 promotion authentication drifts.
- A chain cannot preserve exact historical bytes while rejecting order,
  omission, duplication, and digest drift.

## Current Evidence

[VERIFIED] RED first failed at module instantiation because published M4.18 had
no `loadCanonicalizerCountedIterationPrerequisiteProvenance` export. After the
implementation, all 80 structural/authentication/profile tests pass. Exact
mutations kill prerequisite-chain reversal, omission, duplication, claimed
digest drift, record drift, historical source-format invention, and
structurally valid drift in either pinned handoff.

[VERIFIED] Canonical counted-iteration prerequisite bytes have SHA-256
`af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.
The historical index record remains byte-identical at SHA-256
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`.

[VERIFIED] Regenerated format-6 coverage and format-1 prerequisite summaries
have SHA-256
`aaa9fa135565294eeb84269875242b5fde28ceafb9deb26e21a80eedf9a178d2`
and
`d53293f4fd5ab96efe5f4eeda74523e30961316be23ef07628521325f7536123`.
The coverage implementation digest is
`06e56d6d099acfba01303d404843b056862a9fb690e3b09b040e99204ad1c2c9`.

[VERIFIED] The complete focused Node 22 `pnpm test:kern-canonicalizer` gate
passes 80 structural/authentication/profile tests, 32 exact
golden/KIR/idempotence fixtures, eight measured witnesses, three profile-limit
fixtures, and 166 hostile fixtures. Live coverage remains 21/104 with 81
`fn.params` blockers and a null ordinary winner; the next prerequisite remains
singleton counted iteration at six functions, three tools, 14 parameter rows,
and 468 occurrences. KERN composition remains 34,547 bytes at SHA-256
`37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308`,
and coverage policy remains SHA-256
`d317f1368761e24b64025ef9cfccb1571acf387cf0021a6e5721d245f3f5ba17`.

[VERIFIED] After regenerating both summaries following the final `.mjs` test
mutation, the complete Node 22 `pnpm fitness:kern-5` retry passed with exit 0
on the exact integrated tree. It includes repository consistency, lint,
build, every workspace and infrastructure suite, 432/432 cross-target
fixtures, 109/109 class fixtures, native KERN at 100% declared coverage, the
80-test canonicalizer suite twice, both exact canonicalizer checkers, and the
terminal verdict `KERN 5 current fitness wall passed.`

## Terminal Review

[VERIFIED] Initial high-risk role-lens review
`review-1784607983468-z4t569` completed five of six usable engines; the
performance seat timed out, so that run was treated as an incomplete routing
gate. Automatic full-roster retry `review-1784608629541-khr40o` completed all
six usable engines with zero verified findings, two needs-check findings, five
nits, and no speculative findings.

[VERIFIED] Both needs-check findings are non-material:

- Repeated validation of two tiny static records occurs only at bounded
  composition/check call sites. Caching would retain mutable validated objects
  and weaken repeated byte/pin authentication for negligible runtime savings.
- Exact cardinality two and positional validators are deliberate M4.19
  fail-closed invariants. Each position is family-bound by its exact digest,
  and reversal, omission, duplication, and claimed-digest drift are killed by
  executable mutations. A future third handoff must deliberately revise the
  versioned chain contract.

[VERIFIED] The earlier needs-check suggestion to pin the current
`coverageImplementationDigest` inside a test is inapplicable: every local
canonicalizer `.mjs`, including tests, participates in that digest, so such a
literal would be self-referential. The checker instead recomputes the digest
and byte-compares both checked-in summaries; unrecorded drift fails closed.
All review nits concern diagnostics, deliberate validation redundancy, test
factoring, explicit fixed-chain maintenance, or the user-authorized
`--no-verify` publication procedure. None changes correctness or release risk.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The post-M4.18 slice could begin counted-iteration implementation directly | The repository's M4.16/M4.17 boundary freezes prerequisite evidence before implementation, and M4.18 now provides a new published causal receipt | M4.19 is a separate evidence-only handoff; implementation moves to M4.20 |
| Regenerating receipts before the final test-only `.mjs` mutation was sufficient | The coverage implementation digest deliberately path-frames every local `.mjs`, including tests, so the final source-format mutations changed it from `11b967…` to `06e56d…` | Regenerated both summaries after the last `.mjs` edit and reran the focused gate before restarting the complete wall |
