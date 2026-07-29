# KERN 5 R2 M4.122 — Structural KIR and Runtime-Envelope Headroom

**Status:** VERIFIED; PUBLICATION PENDING
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.121 commit
`7161086c0c2c03b3b12e05d3656138d61f374ab0` selects one
analysis-only candidate: raise structural KIR `maxDepth` from 76 to 77,
leaving every other KIR limit unchanged, to make `rejectLine` and its five
direct parameter rows complete.

[DECIDED] M4.122 authenticates that exact one-function candidate across both
boundaries that matter: byte-exact structural KIR encode/decode/source
round-trip at depth 77 and canonicalizer execution inside the unchanged
runtime envelope. It publishes a deterministic GO/NO-GO receipt but changes
no policy and migrates no parameters.

[VERIFIED] Live measurement produced GO. Exact runtime floor 1,007 succeeds,
floor 1,006 fails, public/internal runtime results agree, and KIR round-trip is
byte-exact. The floor leaves 48,145 promotion-budget steps and 64,529
production-budget steps of headroom.

[DECIDED] A GO hands depth-77 policy promotion to M4.123. M4.122 is evidence
only and is not KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts from exact `origin/main`
`7161086c0c2c03b3b12e05d3656138d61f374ab0`.

[VERIFIED] The immutable M4.121 receipt SHA-256 is
`2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1`.
It authenticates:

- active structural KIR limits `262144/76/4096`;
- candidate structural KIR limits `262144/77/4096`;
- one changed axis with total delta one;
- one checker witness, `checker.kern#2:rejectLine`;
- five direct parameter rows; and
- exact projected rows `8/15/106`.

[VERIFIED] The runtime envelope remains `maxDepth: 64` and
`maxCollectionLength: 65536`; the established promotion budget is 49,152 and
reserved production headroom is 16,384.

## Contract

[DECIDED] M4.122 consumes the exact M4.121 selected witness and requirement;
it does not rediscover or rerank the frontier.

[DECIDED] The in-memory migrated `rejectLine` root must:

1. reject structural encoding at depth 76 with `limit-depth`;
2. encode and decode at depth 77;
3. flatten through the canonical table adapter to exact `8/15/106` rows;
4. execute through the internal canonicalizer runtime envelope;
5. return source that parses without errors;
6. re-encode to byte-identical structural KIR; and
7. reproduce the internal result through the public runtime-handler ABI.

[DECIDED] Exact floor measurement uses bounded binary search. The exact floor
must succeed and round-trip, floor minus one must fail, and the decision is
derived from the floor rather than wall-clock timing.

[DECIDED] The receipt freezes exact source identities, active/candidate
limits, artifact and row metrics, runtime floors, headroom, structural
boundary, parity, round-trip, and successor disposition.

## Implementation

1. Add a RED test importing the absent M4.122 owners.
2. Measure the exact M4.121 witness through the M4.111 structural/runtime
   evidence path.
3. Freeze the exact GO evidence in canonical JSON with a pinned digest.
4. Keep terminal status and central assertions in dedicated modules so the
   already-oversized wall driver and 498-line status module do not grow.
5. Regenerate both authenticated summaries twice.
6. Run focused, complete canonicalizer, full Node 22 KERN 5, and mandatory
   high-risk role-lens review gates.
7. Sign, fetch/rebase, push once to `main`, and verify remote identity.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-122-structural-kir-runtime-envelope/spec.md` | add | Claim/evidence boundary |
| `kir-depth-headroom-m4-122-measure.mjs` | add | Live structural/runtime measurement |
| `kir-depth-headroom-m4-122.{mjs,json,test.mjs}` | add | Immutable receipt owner and guards |
| `coverage-m4-122-central.mjs` | add | Exact release-blocking assertions |
| `coverage-status-m4-122.{mjs,test.mjs}` | add | Terminal handoff without growing the 498-line status owner |
| `coverage-m4-121-central.mjs` | modify | Append the successor assertion/status without growing the wall driver |
| generated coverage summaries | modify | Refresh authenticated implementation identity |

## Acceptance Criteria

- [x] RED fails because the M4.122 owners are absent.
- [x] Exact M4.121 digest, selected action, witness, and requirement
      authenticate.
- [x] Candidate KIR changes only `maxDepth` from 76 to 77.
- [x] Depth 76 fails and depth 77 succeeds for the exact migrated witness.
- [x] Encode/decode/flatten/runtime/parse/re-encode completes byte-identically.
- [x] Exact floor 1,007 succeeds and floor 1,006 fails.
- [x] Public and internal runtime envelopes match at the exact floor.
- [x] GO leaves 48,145 promotion and 64,529 production steps of headroom.
- [x] Policy, KERN source, runtime ABI, generated tools, parameter signatures,
      and cumulative coverage remain unchanged.
- [x] Receipt mutation, decoration, cycles, sharing, history drift, and
      fresh-process loading fail closed.
- [x] Derived summaries converge byte-identically on a second write.
- [x] Complete canonicalizer gate passes.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Full-roster role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote `main`
      verifies identically.

## Verification Evidence

[VERIFIED] The RED test failed with `ERR_MODULE_NOT_FOUND` before the M4.122
measurement owner existed.

[VERIFIED] The exact witness encodes to 7,725 bytes, fails structural KIR at
depth 76, succeeds at depth 77, and flattens to 8 nodes, 15 properties, and
106 values.

[VERIFIED] The canonical M4.122 receipt SHA-256 is
`e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e`.
Focused M4.121/M4.122 tests pass 10/10.

[VERIFIED] Coverage summary SHA-256 is
`07d277b778ba97a31951b2a5b87494b34e121e8791a64bf7e612cb4fa577d340`;
prerequisite summary SHA-256 is
`db33626a0e7c8f9980fe7110e9b2bd62fd7716dbcaf0e3810854961a2001162e`.
Both remain identical after a second repository-writer pass.

[VERIFIED] The complete canonicalizer gate passes 551/551 Node tests, 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes, including
all 22 workspace package tests, 168 release-policy checks, 40 semantic
ownership checks, 28 KIR eligibility checks, 434 cross-target fixtures, 109
class fixtures, 233 native-KERN fixtures at 100% coverage, runner/browser/app
smokes, and the repeated 551-test canonicalizer gate. The terminal result is
`KERN 5 current fitness wall passed.`

[VERIFIED] The six-engine high-risk role-lens review found one material
provenance gap: the first receipt pinned TypeScript sources but not the
compiled core JavaScript executed by the measurement. The receipt now pins
and validates compiled-core digest
`502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec`,
rejects its mutation, and omits two misleading summary hashes that could not
be authenticated without a generated-output cycle.

[VERIFIED] After the review fix, focused tests pass 9/9, the complete
canonicalizer gate again passes 551/551 plus all fixture lanes, and a targeted
two-reviewer confirmation reports no verified blocker.

## Stop Conditions

- M4.121 receipt, witness, candidate limits, or requirement differs.
- Depth 76 does not fail or depth 77 does not produce exact `8/15/106` rows.
- Runtime execution cannot reproduce byte-identical structural KIR.
- Exact-floor success, immediate-below failure, or public parity cannot be
  reproduced.
- Implementation requires a policy, KERN source, generated tool, runtime ABI,
  or cumulative-coverage change.

## Out of Scope

- Promoting KIR depth 77.
- Changing runtime depth or iteration budgets.
- Migrating `rejectLine`.
- Resolving `quotesource`, unsupported expressions, or validator limits.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or a KERN 5
  completion claim.

## Open Questions

None.
