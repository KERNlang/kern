# KERN 5 R2 M4.128 — `validate` Runtime Bottleneck Investigation

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-29
**Confidence:** 0.94

## Executive Summary

[VERIFIED] Published M4.127 commit
`e874d1adf4371ebc76e87fbf564e6fa516305aff` authenticates the combined
273051-byte / depth-98 / 5313-node KIR boundary and 202/308/4493 profile for
`examples/selfhost-validator/validator.kern#20:validate`.

[VERIFIED] The exact runtime floor is 54894 retained iterations. It has 10642
iterations of production headroom but exceeds the 49152 promotion budget by
5742, so combined promotion remains a NO-GO.

[DECIDED] M4.128 attributes that promotion deficit using the existing
default-off internal runtime observer. It publishes diagnosis only: no KERN
source, runtime, ABI, KIR/profile/runtime policy, corpus, signature, generated
tool, or cumulative-coverage behavior may change.

## Current Boundary

[VERIFIED] M4.127 receipt SHA-256 is
`604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce`.

[VERIFIED] The immutable measurement inputs include:

- M4.126 projection digest
  `25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369`;
- composed canonicalizer SHA-256
  `f40d056b2aac947350f297196cbe71d5acdb5b82d245963adee910620c7b7180`;
- compiled core JavaScript SHA-256
  `502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec`;
  and
- M4.127 measurement harness SHA-256
  `9ef514c5d482c2b4735c3591f1c08bfb65b11a51480fde1c427451beb0db9318`.

[VERIFIED] The composed canonicalizer validates table integrity, function and
parameter structure, handler statements, and only then emits canonical source.

[EXPECTED] The 41-parameter `validate` witness may make repeated parameter
property/type access or later statement validation dominant. This expectation
is not an oracle; deterministic observer counters select the actual mechanism.

## Diagnostic Contract

| Behavior | Tag |
|---|---|
| Bind the exact M4.127 receipt and executable inputs | DECIDED |
| Observe the 49152 promotion failure | DECIDED |
| Observe the 54894 exact-floor success and roundtrip | DECIDED |
| Prove observer-on/off envelopes are deeply equal | DECIDED |
| Freeze attempted, retained, and rolled-back loop iterations | DECIDED |
| Freeze helper preparation, entry, cache, suspension, and restart counters | DECIDED |
| Attribute only evidence exposed by current observer semantics | DECIDED |
| Select one bounded M4.129 optimization target | DECIDED |
| Keep elapsed time diagnostic-only and out of the receipt | DECIDED |

`helper-execute` is an entry event, not proof that a helper body completed.
The diagnosis may use phase boundaries and exact counter deltas, but must not
invent per-helper loop ownership absent direct evidence.

## Implementation

1. Add a RED test importing the absent M4.128 diagnosis owner.
2. Build an isolated observer-on/off measurement owner from the exact M4.127
   witness preparation and candidate KIR/profile inputs.
3. Measure promotion and exact-floor boundaries, then identify the last
   reached validation/emission phase and the dominant deterministic delta.
4. Freeze exact observations, input identities, mechanism, and M4.129 target
   in canonical JSON with mutation and fresh-process tests.
5. Wire an isolated central assertion and status owner, converge derived
   summaries twice, then run full fitness and high-risk independent review
   before one fetched/rebased signed push.

## Acceptance Criteria

- [x] RED proves the M4.128 owner is absent before implementation.
- [x] Exact M4.127 receipt, witness, limits, budgets, and inputs remain
      immutable.
- [x] Promotion fails and the exact floor succeeds with structural roundtrip.
- [x] Observer-on/off envelopes are deeply equal at both boundaries.
- [x] Receipt freezes loop, helper, cache, suspension, and restart evidence.
- [x] Diagnosis names one evidence-supported mechanism and one bounded M4.129
      optimization target without overclaiming completion events.
- [x] Receipt rejects mutation, decoration, sharing, cycles, symlinks, and
      executable-input drift.
- [x] No source, runtime, ABI, policy, profile, signature, corpus,
      generated-tool, or cumulative-coverage behavior changes.
- [x] Focused, canonicalizer, and full KERN 5 gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- Any M4.127 receipt, witness, source, policy, or runtime identity drifts.
- Observer-on and observer-off envelopes differ.
- A bounded observation does not terminate.
- The exact-floor result does not structurally roundtrip.
- Existing observer events cannot separate the leading mechanisms.
- Diagnosis requires a runtime/source/policy/ABI/profile change.

## Out of Scope

- Implementing the M4.129 optimization.
- Promoting the combined KIR/profile candidate or migrating `validate`.
- Raising runtime, KIR, or profile limits.
- Adding or changing public observer/runtime APIs.
- Canonical text-character or unknown-expression-kind implementation.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The promotion and 52023 observations have identical helper,
preparation, cache, and suspension counters while retained `for` iterations
increase by 2871. Their final observer events are
`validstatement -> recordfield -> execute:recordfield`.

[VERIFIED] Exact-floor success completes two `recordfield` entries. The
fail-closed helper scans all 4493 value rows unless it finds a duplicate; the
successful witness therefore completes 8986 attributable iterations, 3244
more than the 5742 promotion deficit.

[VERIFIED] At 53500, all 159 validation entries have completed and emission
has entered 40 statements. The remaining successful tail is only 1394
iterations and completes the other 119 emission entries.

[DECIDED] M4.129 folds assignment-target kind authentication into the existing
expression projection so it can remove both standalone full-table scans
without paying for a replacement table-wide pass.

[VERIFIED] Canonical receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-128.json` has SHA-256
`55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac`.
The focused 5-test suite and complete 581-test canonicalizer gate pass.

[VERIFIED] Derived coverage summary SHA-256 is
`0ff52c8a3549c2feecb3236ce7f3fe3f3d1857ce1d7b1c6f710dfc57963dca78`;
prerequisite summary SHA-256 is
`d0cb292d1c35b351fcc46d65c37eaad0934e1546b9fd4ebd09f6cfe46e699736`.
Both regenerate byte-identically.

[VERIFIED] `pnpm fitness:kern-5` passes the complete current KERN 5 fitness
wall, including both 581-test canonicalizer runs, 434/434 cross-target
conformance fixtures, 109/109 class-conformance fixtures, 233/233 native KERN
tests at 100% coverage, 48/48 checker-subset fixtures, 39/39 self-host
validator verdicts, and the runtime/KIR ownership and containment gates.

[VERIFIED] High-risk automatic role-lens review completed with all 6 usable
independent seats: 0 verified findings, 1 needs-check claim, and 14 nits. The
needs-check claim about a symlinked ancestor was rejected by importing and
loading the receipt through a deliberately symlinked repository path; Node
canonicalized the module URL and the exact receipt loaded successfully. The
nits are non-material diagnostic-code simplifications and do not change the
published diagnosis or acceptance contract.
