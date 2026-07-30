# KERN 5 R2 M4.140 — Exception-Flow Implementation Handoff

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-28
**Base commit:** `e3090ad1ac18d49ff1c0eb7d2de167a23e9b70a8`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.138 freezes the exact pre-implementation
`exception-flow` prerequisite as the eighth unique
`kern.kir-canonicalizer.prerequisite-provenance.1` record, SHA-256
`2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4`
(`scripts/kern-canonicalizer/coverage-prerequisite-provenance.mjs:54`,
`scripts/kern-canonicalizer/coverage-prerequisite-provenance.mjs:365`).

[VERIFIED] Published M4.139 adds bounded KERN-owned validation and canonical
emission for valued leaf `throw` statements. It does not promote the family,
migrate parameters, or change the M4.137 cumulative base
(`scripts/kern-canonicalizer/coverage-m4-139-central.mjs:27`,
`scripts/kern-canonicalizer/coverage-m4-139-central.mjs:50`,
`scripts/kern-canonicalizer/coverage-status-m4-139.mjs:20`).

[DECIDED] M4.140 freezes one distinct post-implementation handoff record
outside `prerequisiteProvenances`. The record binds the published M4.139
commit, exact M4.139 coverage/prerequisite receipts, canonicalizer and policy
digests, the existing M4.138 prerequisite digest by reference, and the exact
`validstatement`/`emitstatement` implementation targets.

[DECIDED] M4.140 does not append a duplicate `exception-flow` prerequisite
record, add a new active family, promote exception flow, migrate parameters,
change any limit or runtime contract, or claim KERN 5 completion.

## Immutable Published Input

[VERIFIED] M4.140 consumes:

- source commit `e3090ad1ac18d49ff1c0eb7d2de167a23e9b70a8`;
- coverage summary format
  `kern.kir-canonicalizer.coverage-summary.6`, file SHA-256
  `551d55389b8cfd5bcd93ec9552a78876711b79c8eb03dd026f648cd5342268b2`;
- prerequisite summary format
  `kern.kir-canonicalizer.prerequisite-summary.3`, file SHA-256
  `5b09615e2a0216689429e803291281b01ae678a9a79ca7d6a5fa56279445257d`;
- coverage implementation digest
  `5864acd99c1c1c3bd7d82776e0898082933d9970dafe5eba7fd753840741e9e4`;
- coverage policy SHA-256
  `5a909a0b0d17ab3fafdeb8223bd2b9acd8c491f68284c338ac0a80f3075636c3`;
- composed canonicalizer SHA-256
  `d96dee80f12236a3d9089bf44aeee699e6a3c35856e71f79a0743691248ea16e`;
- exact M4.138 prerequisite digest
  `2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4`;
- live M4.137 base at 109/112, three legacy `fn.params` blockers, sole
  unpromoted `exception-flow` family, one `canonicalize` function, and 15
  parameter rows
  (`scripts/kern-canonicalizer/coverage-policy.json:5`,
  `scripts/kern-canonicalizer/coverage-policy.json:134`,
  `scripts/kern-canonicalizer/coverage-summary.json:126`,
  `scripts/kern-canonicalizer/coverage-prerequisite-summary.json:3`,
  `scripts/kern-canonicalizer/coverage-prerequisite-summary.json:14`,
  `scripts/kern-canonicalizer/coverage-prerequisite-summary.json:25`).

[DECIDED] The handoff's `source.coverageImplementationDigest` remains the
published M4.139 graph above. The regenerated live M4.140 summaries carry the
new M4.140 graph digest instead; this successor receipt does not rewrite the
historical source pin.

## Root Cause

[VERIFIED] The prerequisite evidence map is keyed by unique family identity.
The current eight-record chain already owns `exception-flow`; appending a
second prerequisite record for the same family would violate promotion
evidence uniqueness
(`scripts/kern-canonicalizer/coverage-prerequisite-provenance.mjs:365`).

[VERIFIED] M4.138 binds selection causality but predates the KERN-owned throw
implementation. M4.139 status and live receipts prove the implementation in
the current tree, but no immutable artifact presently binds that reviewed
implementation as the input to a later promotion.

[DECIDED] Selection causality and implementation causality therefore remain
separate:

- M4.138 remains the sole `exception-flow` prerequisite evidence;
- M4.140 becomes the exact post-implementation evidence;
- M4.141 must consume both before any promotion.

## Handoff Contract

The canonical record format is
`kern.kir-canonicalizer.implementation-handoff.1`.

| Field | Exact contract | Tag |
|---|---|---|
| `family` | `exception-flow` | DECIDED |
| `milestone` | `M4.140` | DECIDED |
| `source.commit` | exact published M4.139 commit | DECIDED |
| `source.coverageSummaryFormat` | exact format 6 | DECIDED |
| `source.coverageSummarySha256` | exact published file bytes | DECIDED |
| `source.prerequisiteSummaryFormat` | exact format 3 | DECIDED |
| `source.prerequisiteSummarySha256` | exact published file bytes | DECIDED |
| `source.coverageImplementationDigest` | exact authenticated M4.139 implementation graph | DECIDED |
| `source.coveragePolicySha256` | exact M4.139 coverage policy bytes | DECIDED |
| `source.canonicalizerSha256` | exact M4.139 composed KERN bytes | DECIDED |
| `prerequisite.family` | `exception-flow` | DECIDED |
| `prerequisite.digest` | exact M4.138 digest by reference | DECIDED |
| `targets` | exactly two sorted unique implementation identities | DECIDED |
| target fields | `bodyDigest`, `functionOrdinal`, `id`, `name`, `path`, `sourceSha256` | DECIDED |
| canonical bytes | strict pretty JSON plus one trailing LF | DECIDED |
| record digest | externally pinned SHA-256 in the loader | DECIDED |

The target identities are:

- `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement`,
  ordinal 2, body digest
  `6913100a2edb7e81f74cc178d24cb116f554ce258e2b883ebdfd2d8c9e94611f`;
- `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement`,
  ordinal 4, body digest
  `81b93004de7013b6e27d500afdb5d3bec6ba8bff01268974249ed7e5010e1659`.

Both targets bind statement-member SHA-256
`604c0e05b3b3d08560df7738ce2d80bc50a0fa38901a2f2eb415767ac1ec4e5b`
(`scripts/kern-canonicalizer/validstatement-target.mjs:45`,
`scripts/kern-canonicalizer/emitstatement-target.mjs:21`).

## Alternatives

### A — Distinct minimal implementation handoff (selected)

This creates the missing M4.139-to-M4.141 causal edge without corrupting the
unique prerequisite chain. One canonical record and one strict loader own
the evidence.

### B — Status and central tests only (rejected)

Tests can pin the current tree but do not give M4.141 a stable artifact to
consume as implementation evidence.

### C — Append another exception-flow prerequisite (rejected)

This duplicates family evidence, collapses selection and implementation
causality, and violates the unique-family prerequisite map.

### D — General multi-family handoff framework (rejected)

No second consumer exists. Generated schemas, package APIs, fitness-policy
digests, or a new active family would widen M4.140 beyond its evidence-only
purpose.

## Implementation Plan

1. Add RED loader/status/central tests for the missing handoff.
2. Add the canonical M4.140 JSON record.
3. Add one strict validator/loader with an externally pinned record digest.
4. Bind current M4.139 semantics and exact target identities through M4.140
   central/status owners.
5. Wire the current frontier and standalone coverage checker without growing
   the already-oversized checker source.
6. Regenerate only authenticated live receipts affected by new local
   implementation modules.
7. Run focused tests, complete canonicalizer, full KERN 5 fitness wall,
   independent high-risk role review, fetch/rebase, one push, and remote SHA
   verification.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-slice claim/evidence boundary |
| implementation handoff JSON | add | immutable M4.139 post-implementation evidence |
| implementation handoff loader | add | strict schema, canonical bytes, pinned digest |
| handoff/central/status tests | add | RED, mutation, current-target, and status proof |
| `.gitattributes` | modify | force LF checkout bytes for the canonical JSON artifact |
| current frontier/checker | modify | make M4.140 release-blocking |
| live coverage receipts/pins | regenerate | authenticate final local implementation graph |
| prerequisite chain | unchanged | preserve eight unique records byte-for-byte |
| KERN source/composition | unchanged | M4.139 implementation is already published |
| base/family policy | unchanged | no promotion in M4.140 |
| reader/runtime/ABI/limits | unchanged | evidence-only slice |

## Acceptance Criteria

- [x] Focused tests fail closed if the M4.140 artifact or loader is absent.
- [x] Record uses exact canonical JSON and a pinned SHA-256.
- [x] Strict validation rejects missing, extra, malformed, decorated, shared,
      or mutated data.
- [x] Generic target validation admits zero-based function ordinal `0` and
      rejects negative, fractional, and unsafe ordinals.
- [x] Git checkout policy forces LF bytes for the canonical handoff JSON.
- [x] Source section binds exact published M4.139 commit and receipt hashes.
- [x] Prerequisite section references the exact existing M4.138 digest.
- [x] Targets equal the current authenticated M4.139 `validstatement` and
      `emitstatement` identities.
- [x] Existing eight-record prerequisite chain remains byte-identical.
- [x] KERN source, composition, base, family registry, and all limits remain
      unchanged.
- [x] Live base remains M4.137 at 109/112 with three parameter blockers.
- [x] Exception flow remains unpromoted and solely selected.
- [x] Parameter migration remains zero.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main
      verifies.

## Pre-Implementation Challenge

[VERIFIED] A full six-engine Agon brainstorm completed 6/6 at
`brainstorm-1785378969842-ug9ko3-m4-140-contract`. Every engine
recommended a distinct post-implementation artifact outside the prerequisite
map rather than status-only evidence or a duplicate prerequisite record.

[DECIDED] The challenge added two guards: reference M4.138 rather than copying
its snapshot, and keep one assertion owner so implementation drift has one
root cause. Proposed generated schemas, package APIs, fitness-policy hashes,
new active families, and self-referential record digests were rejected as
unnecessary for the current repository.

## Verification Evidence

[VERIFIED] Direct `git show` reads of published commit
`e3090ad1ac18d49ff1c0eb7d2de167a23e9b70a8` reproduced every immutable
M4.139 source hash listed above. A git-history oracle was intentionally not
added to the release checker because the fitness wall must remain hermetic.

[VERIFIED] The canonical handoff record digest is
`c9f9d4610800ca53cdec00f5d519d6c1ebaa3e76d26734ebcc69cb3c21ff7753`.
After the final implementation, live authenticated receipts are:

- coverage summary SHA-256
  `13ab4ac712135f1b32357b3099422d8b07a8bad4c839db93e614b0971112f7d5`;
- prerequisite summary SHA-256
  `535d9b21eaf07dc219799593ca9dee7abcfa381fc223f9444738300b72e68bc1`;
- coverage implementation digest
  `461f2351cc94811a91f53387fb2bb8fd1bb7b431411029eb63240955d6e8f93d`.

[VERIFIED] The final complete canonicalizer gate passed 644/644 node tests,
58 golden/KIR fixtures, 8 measured fixtures, 3 profile-limit fixtures, and
250 hostile corpus fixtures. The exact-state `pnpm fitness:kern-5` wall then
passed through repository policy, lint, build, workspace, infrastructure,
both canonicalizer passes, and all fixture lanes.

[VERIFIED] The first high-risk role review completed at
`review-1785381523794-wr5n7s` and found one genuine fail-closed blocker:
an untrusted `targets.map` method could spoof the validated target list. RED
coverage reproduced the exploit. The boundary now requires a plain, dense,
undecorated array before reading elements or invoking array behavior; tests
also cover sparse, symbol-decorated, accessor, and spoofed-map inputs.

[VERIFIED] A second high-risk role review completed 6/6 at
`review-1785382437422-1w6m33` with zero verified findings and no unresolved
material blocker.

## Stop Conditions

- Published M4.139 commit or receipt hashes differ from the immutable input.
- Exact target identities cannot reproduce from published M4.139 source.
- The handoff requires a duplicate prerequisite family or a promotion-policy
  schema change.
- Any KERN source, base profile, active family, limit, reader, runtime, or ABI
  change becomes necessary.
- Any focused, full-wall, or independent-review blocker remains unresolved.

## Out of Scope

- Promoting `exception-flow`.
- Migrating `canonicalize`, `expressionsources`, or `quotesource`.
- Changing prerequisite-provenance history.
- Adding bare throw, catch/finally, exception binding, or runtime semantics.
- Quotesource code-point remediation.
- KIR v1 freeze, public reader cutover, RC/stable release, Fable, or KERN 5
  completion.

## Release Boundary

[DECIDED] M4.140 publishes only the immutable post-implementation handoff.
M4.141 may promote `exception-flow` only after validating both the existing
M4.138 prerequisite digest and the exact M4.140 implementation-handoff digest.
