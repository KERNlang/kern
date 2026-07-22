# KERN 5 R2 M4.36 — Do-Statement Profile Promotion

**Status:** READY TO PUBLISH
**Date:** 2026-07-22
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published `origin/main` commit
`97992fe2acb65379ef3e946a99b8b732d3c98191` contains the reviewed M4.35
do-statement canonicalizer. Its KERN-owned validator admits exactly one
required expression-valued `value` property and no children; its emitter owns
the matching canonical `do value=` line. The executable composite remains
41,190 bytes at SHA-256
`40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`.

[VERIFIED] Immutable M4.34 prerequisite provenance
`3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72`
authenticates `do-statement` as the exact singleton causal input: one function,
one tool, two counterfactual structured-parameter rows, two catalog facts, and
176 occurrences in the sealed snapshot. M4.35 live measurement reports 178
occurrences because the KERN implementation adds validation and emission facts.

[DECIDED] Promote the exact do family into cumulative coverage profile M4.36
through the immutable M4.34 prerequisite record. Remeasure base-only parameter
readiness and residual prerequisite exhaustion, but do not migrate `appendid`
or modify any KERN source in this slice.

## Published Input

[VERIFIED] The exact M4.35 boundary is:

- commit `97992fe2acb65379ef3e946a99b8b732d3c98191`;
- profile `kern.kir-canonicalizer.profile.m4.29`;
- 45/104 base-complete functions and 57 legacy `fn.params` blockers;
- policy SHA-256
  `fa5cedd2be8cac69bf4798826848ccf445e6788738685e015be149f5d3df67a4`;
- coverage-summary SHA-256
  `3be607f15bcd762a24ece0dacf2816fded0dd9b57b082780fe2f6590bf27632a`;
- prerequisite-summary SHA-256
  `e932f7f4c85f9aedc02b76ba13ea1e91033be0998303fc997ce067a7f617f832`;
- implementation digest
  `5f25fd30c54b55a770b1bcce0828316d147f283e40ff68c67452ca7a6a1d457b`;
- function-facts digest
  `d22ac32bf2803f1f33b8ce6fad2f2c4ced0da4ef22a3bd6565beb98e97fee20c`;
- one exact do closure witness,
  `examples/selfhost-validator/validator.kern#14:appendid`, with ordered two
  parameter rows and profile rows 9 nodes, 16 properties, and 80 values.

## Current State and Root Cause

[VERIFIED] The cumulative base does not yet include node kind `do` or property
identity `do.value`. `do-statement` therefore remains an active family even
though M4.35 proved its executable ownership and hostile boundary.

[VERIFIED] `coverage-profile.mjs` already rejects children on non-container
statements and already projects every catalog-marked lowered expression through
the recursive base expression profile. Promotion needs only an exact local
node/property profile: leaf kind `do`, exactly one required `value`, and the
existing recursive expression contract.

[DECIDED] A plain node-kind append is insufficient because it would not bind
the required property or immutable prerequisite provenance. Promotion must
advance the profile identity, append the exact provenance row, add the exact
base node/property contract, remove do from active families, and preserve every
prior promotion in order.

## Promotion Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| policy format | remain `kern.kir-canonicalizer.coverage-policy.3` | VERIFIED |
| base identity | advance to `kern.kir-canonicalizer.profile.m4.36` | DECIDED |
| promotion row | append `do-statement` with M4.34 digest and `prerequisite` kind | DECIDED |
| base node | insert `do` in canonical node-kind order | DECIDED |
| base property | add exactly required `do.value`; no optional properties | DECIDED |
| children | do remains a leaf through existing statement-child validation | DECIDED |
| value | reuse the recursively admitted base expression profile | DECIDED |
| active families | remove do; preserve exception then while order | DECIDED |
| implementation pointer | advance from unary to the do prerequisite promotion | DECIDED |
| KERN executable | remain byte-identical to published M4.35 | DECIDED |
| parameter migration | remeasure only; do not edit `appendid` | DECIDED |
| historical evidence | preserve four selection and five prerequisite records byte-for-byte | DECIDED |

## Remeasurement Contract

[DECIDED] The existing format-3 partition remains authoritative:

1. counterfactually migrate exact legacy parameter pairs;
2. record functions that complete under the M4.36 base alone in
   `parameterMigration`;
3. exclude those witnesses from residual active-family closure ranking;
4. evaluate every non-empty closure of the remaining exception and while
   families;
5. publish either an exact positive selection or bounded exhaustion from live
   authenticated facts.

[EXPECTED] The sealed do closure proves `appendid` should become the next
base-only parameter-ready witness with two rows. This is a discriminating
expectation, not a checked-in constant until the post-promotion executable
measurement reproduces it.

[DECIDED] Residual function counts, reason census, assignment digest, and
closure-exhaustion facts are measured outputs. They must not be copied from
M4.29 or predicted in the policy.

## RED and Mutation Plan

[DECIDED] Add a promotion-specific test before policy/profile edits. RED must
fail against sealed M4.35 at the old profile identity and absent promotion.

[DECIDED] Mutation coverage rejects missing, duplicated, reordered, mistyped,
or wrong-digest do provenance; reintroduced active-family overlap; missing,
extra, or wrong do properties; child-bearing do nodes; and unsupported or
malformed recursive values.

[DECIDED] The tests must also prove published M4.35 KERN bytes, corpus members,
profile limits, family registry, historical records, and the 104-function/four-
tool denominator remain exact.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared promotion and evidence contract |
| `coverage-policy.json` | modify | M4.36 base, do promotion, family removal |
| `coverage-profile.mjs` | modify | exact required do property profile |
| `coverage-promotion.test.mjs` | modify | profile/provenance/overlap RED and pins |
| `coverage-do-promotion.test.mjs` | add | leaf/value/recursive mutation proof |
| coverage/prerequisite/handoff tests | modify | exact live M4.36 partition and pointer |
| `check-kern-canonicalizer-coverage.mjs` | modify | exact M4.36 release facts |
| coverage/prerequisite summaries | regenerate | authenticated post-promotion measurement |
| release train | modify | durable M4.36 evidence and next slice |

## Acceptance Criteria

- [x] Fresh branch starts from published M4.35 `origin/main` commit
      `97992fe2acb65379ef3e946a99b8b732d3c98191`.
- [x] M4.35 executable, M4.34 provenance, M4.29 profile, and do family are
      grounded in current source and receipts.
- [x] RED fails first on the sealed M4.35 profile/promotion boundary.
- [x] Do promotion cites exact immutable M4.34 prerequisite provenance and
      becomes the implementation pointer.
- [x] Exact leaf/one-value/recursive-expression profile is mutation-killed.
- [x] Do is removed from active families while exception and while preserve
      relative order.
- [x] `appendid` becomes the exact measured parameter-ready witness without a
      source migration in this slice.
- [x] Residual selection or bounded exhaustion is regenerated and pinned from
      live authenticated facts.
- [x] KERN composition, corpus, family registry, limits, and every historical
      provenance record remain exact.
- [x] Focused Node 22 canonicalizer gate and complete KERN 5 fitness wall pass.
- [x] Automatic high-risk role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      feature and explicitly authorized `main`; both refs are verified.

## Out of Scope

- Migrating `appendid` parameters or editing any handwritten KERN source.
- Exception/while implementation, promotion, or handoff work.
- Parser, structural KIR, runtime, ABI, evaluator, public-export, package-
  version, family-registry, profile-limit, or corpus-membership changes.
- Refactoring the existing format-3 prerequisite/exhaustion mechanism.

## Stop Conditions

- Promotion requires changing KERN source, parser behavior, runtime, ABI,
  public contracts, profile limits, or family registry.
- The immutable M4.34 provenance does not reproduce the exact do family.
- `appendid` does not become base-ready after the exact promotion.
- A historical selection/prerequisite record or published M4.35 KERN byte
  changes.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Current Evidence

[VERIFIED] RED first failed at exact profile identity `m4.29` versus required
`m4.36`. The local mutation oracle also proved sealed M4.35 did not reject a
missing do value through the base profile.

[VERIFIED] M4.36 appends the exact M4.34 do prerequisite promotion, adds only
base node `do` and required property `do.value`, removes do from the active
family list, and advances implementation provenance to do. The published
M4.35 KERN composite remains byte-identical at
`40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`.

[VERIFIED] The base-profile contract was extracted from a 511-line source into
431-line `coverage-profile.mjs` and 96-line `coverage-base-profile.mjs` without
changing prior profile behavior. The new do oracle proves exact required value,
no extra property, no children, and recursive optional-member rejection.

[VERIFIED] Live format-3 measurement reports one parameter-ready function and
two rows: `examples/selfhost-validator/validator.kern#14:appendid` at profile
rows 9/16/80. The remaining exception/while registry evaluates all three non-
empty closures, finds zero completing closures, and authenticates 56 residual
functions with assignment digest
`8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`.

[VERIFIED] Policy, coverage-summary, and prerequisite-summary SHA-256 values are
`5e806bf8f4078bf07a2190df6b1be11a8a2fc3e4e77cad668e6030ac1ca1cb0b`,
`d334c6843c9730a25cca07ca26c389563609cc8deb39ea6de214f41d8e9caf21`,
and `20055d5b554a116776d8bda54b832703fca85eddb6f5f7bbf7f7957b4d0f751f`.
Implementation, function-facts, and profile digests are
`c6940a950795d304a2b6bbd88dfc16e96e5a355babec135f882cf484b7603aa5`,
`1a7dc9964714306d2e57f98c73b5af2cfe605cae9f46910b6c0c7eefa46a6a35`,
and `382fc8ca3efb672c72eeb0e33ead337e05d7beab08dcdf67e2e9849b3ad9f24b`.

[VERIFIED] The complete focused Node 22 canonicalizer gate passes 104/104 tests,
51 exact golden/KIR/idempotence fixtures, eight measured witnesses, three
profile-limit fixtures, and 226 hostile mutations. The exact integrated tree
also passes the complete Node 22 `pnpm fitness:kern-5` wall on 2026-07-22,
including repository consistency, lint, build, every workspace and
infrastructure suite, 432/432 cross-target fixtures, 109/109 class fixtures,
233 native KERN assertions at 100% coverage, self-host smoke, and the terminal
canonicalizer gate.

[VERIFIED] Automatic high-risk role-lens review
`review-1784683098662-uov4yq` completed all 6/6 live usable seats with zero
verified, needs-check, or speculative findings. Four nits were checked against
the exact source: `coverage.mjs` does export `loadCoveragePolicy`; the documented
431-line evaluator and 96-line base contract are exact measured lengths; adding
those post-refactor lengths is not evidence that extraction had to preserve the
old 511-line total; and serializing the frozen nine-entry promotion list at two
bounded validation call sites is not a material performance concern. No review
change is required and no material finding remains.
