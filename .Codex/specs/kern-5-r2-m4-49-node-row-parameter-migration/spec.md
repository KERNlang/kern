# KERN 5 R2 M4.49 Node-Row Parameter Migration

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.48 raises only the canonicalizer node-row ceiling to
19 and exposes an exact parameter-migration queue of four functions, three
tools, and 12 rows. M4.49 consumes exactly that queue as a representation-only
source migration.

[DECIDED] Remove each target's legacy `fn.params` property, prepend equivalent
ordered direct `param` children, regenerate only the real generated consumers,
and authenticate the resulting live receipts. Do not change policy, function
bodies, calls, runtime, KIR, ABI, public API, package version, or browser policy.
KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at published M4.48 commit
`c16ab453b49d850d58022160a577c23eb70a2142`.

[VERIFIED] The canonical M4.48 prerequisite receipt has SHA-256
`fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a`.
It binds profile 19/30/388, 60/104 base-complete functions, 43 legacy
`fn.params` blockers, four ready functions, three tools, 12 parameter rows,
and 39 residual functions.

## Frozen Migration Contract

| Function | Ordered direct parameters | Rows N/P/V | Semantic body SHA-256 |
|---|---|---:|---|
| `checker.kern#12:isIndexRebound` | `fnName:string`, `binding:string`, `stmtKind:string[]`, `stmtFn:string[]`, `stmtName:string[]`, `stmtTarget:string[]` | 17/26/152 | `39c146c913925457ec457895f4c52e8a7c3138ccbc26aa4fc281018f77080bfa` |
| `checker.kern#9:isUserCallable` | `name:string`, `stmtKind:string[]`, `stmtName:string[]`, `stmtTarget:string[]` | 19/26/185 | `f7881f6af604243aa53372ad92012fece7eada5ff720715036a0008145523fef` |
| `canonicalizer-expression-helpers.kern#4:validinteger` | `value:string` | 19/28/290 | `5b9f89a40af34a1e9100162ccfe2ccffb95f460a5ce5b22c0b840cbea9e04e8b` |
| `validator.kern#3:isportable` | `name:string` | 18/24/217 | `dc76caed49b207b6d6369ac259b51a05837b41ffa73cfb5beb83e11e634bb6f2` |

For every target:

- [DECIDED] Remove only the legacy `params` property.
- [DECIDED] Insert exact ordered direct `param` children immediately before
  the unchanged handler.
- [DECIDED] Preserve identity, root ordinal, returns, export status, body,
  calls, and every sibling function.
- [DECIDED] Reject mixed, missing, duplicated, reordered, mistyped, or
  post-handler parameters; reject body, identity, or profile-row drift.

## Historical Receipt Contract

[DECIDED] Before regenerating live evidence, copy the exact canonical M4.48
prerequisite bytes to a milestone-specific immutable handoff. Its loader binds
the published digest, source commit, format, canonical JSON, plain data,
dense arrays, and regular non-symlink storage.

## Expected Live Transition

[VERIFIED] Consuming every ready witness at unchanged profile 19/30/388 implies:

- base completion advances from 60/104 to 64/104;
- legacy blockers fall from 43 to 39;
- the parameter queue becomes exactly empty;
- bounded-exhaustion residual remains exactly 39 functions.

[DECIDED] These are fail-closed predictions. Any measured mismatch stops the
slice for root-cause analysis.

## Generated-Consumer Boundary

[VERIFIED] The checker fixture generator embeds both changed checker and
validator sources, so `examples/capstone-checker-subset/main.kern` must change.
Its unrelated `numeric-main.kern` must remain byte-identical.

[VERIFIED] The expression helper is an ordered canonicalizer composition
member, so the composite and composition record must change. The canonicalizer
and statement-helper members must remain byte-identical. The standalone
self-host validator fixture is not source-embedded and must remain exact.

## Implementation Plan

1. Freeze and validate the exact M4.48 prerequisite receipt.
2. Add M4.49 target contracts and mutation guards; capture RED on unchanged
   published source at the intended legacy-parameter boundary.
3. Migrate exactly four function headers and 12 direct parameter rows.
4. Regenerate checker and canonicalizer consumers with repository writers.
5. Update exactly three corpus digests and regenerate live receipts only after
   implementation scripts reach final bytes.
6. Run focused tests, canonicalizer gates, and full KERN 5 fitness.
7. Run independent high-risk role-lens Agon review, fix verified findings,
   create one signed commit, fetch/rebase, push once with `--no-verify`, and
   verify the feature and authorized `main` remote hashes.

## Acceptance Criteria

- [x] Exact M4.48 receipt is frozen and mutation-guarded.
- [x] RED fails at the intended legacy representation boundary.
- [x] Exactly four functions lose legacy `params` and gain 12 direct rows.
- [x] Bodies, identities, ordinals, exports, returns, calls, and rows are exact.
- [x] Exactly three handwritten corpus digests change.
- [x] Generated consumers reproduce and unrelated artifacts remain exact.
- [x] Profile stays 19/30/388; base is 64/104; blockers and residual are 39;
      live parameter queue is empty.
- [x] Focused and full gates pass with no unresolved material review finding.
- [ ] Signed commit is rebased before one atomic no-verify push; both remote
      hashes verify.

## Stop Conditions

- Any target semantic digest, identity, ordinal, export, return, call, or row
  triple differs.
- Any fourth handwritten source/corpus digest changes.
- Policy, runtime, KIR, ABI, public surface, or package version changes.
- Generated drift is not reproduced by checked-in writers.
- Live transition differs from exact 64/39/0/39.

## Out of Scope

- Further profile widening or structural-family selection.
- Runtime, KIR, parser, codegen, checker, or validator semantic changes.
- Version bump, release candidate, release, or claiming KERN 5 complete.

## Measured Implementation Evidence

[VERIFIED] The isolated RED guard failed on unchanged published M4.48 at the
intended source-shape boundary because `isIndexRebound` retained its exact
legacy parameter string. The frozen handoff is byte-identical to the published
receipt at SHA-256
`fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a`.

[VERIFIED] Exactly three handwritten sources changed: checker SHA-256
`8183f4448fcc1f59d80f29f163ab1165e7a95105f6b2411f6a8ff7080dbfa8a6`
at 401 lines, expression helpers SHA-256
`ffd3f352a7137d846e23a701672b91f99159d624027abaddb2f1408338544541`
at 192 lines, and validator SHA-256
`b2d274b3eb12d01113583164699fce2a1d5682fb443ab6f31241be3eaa22167f`
at 495 lines.

[VERIFIED] Live coverage is exactly 64/104 with 39 legacy blockers. The
parameter queue is zero functions, zero tools, zero rows, and zero witnesses;
residual bounded exhaustion remains 39 with unchanged assignment digest
`d3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc`.
Coverage and prerequisite receipts authenticate at SHA-256
`998955248fe4a5e8a1d35108bdd0cd23e7132e1ede3693bc2f40838d6290596b`
and `9ffd897ad4e631ea7cb4395fffbdae87a36637d3f5d011eaa377c01f3f2fa403`.
Implementation, policy, function-fact, and corpus digests are respectively
`063caa43723772d3ad44b1662b2c345e24f9e46ab914cfdadd71872836de81d8`,
`3f72981ab56a3b7c6d27b675384349cd93b1a36b5d554dfcead57648794ad00e`,
`8b2c88aac92ede8551155c55b870bc2245db042e7cc246946ee60eaa1285c35e`,
and `a918c5e489e4fa8046ad790a4502844b5b9fb0ed703d8c728e6ea4434d392092`.

[VERIFIED] Repository writers reproduce checker `main.kern` at SHA-256
`a63b6b0371206b6ed7c93668a04a6786931460e55fd75ca514c0951473410976`
and the 49,418-byte canonicalizer composite at SHA-256
`9ef2e9f787f91efec3deb06ff07b11bf2093a07aa1301d59fda3551dc80d4bb5`.
Composition metadata authenticates at SHA-256
`708ea2c648dd2f8cf76aa5ac7fb89c609f54406a8da5b5ce4c33d92233c1e441`;
numeric checker, standalone validator, and unrelated composition members remain
byte-identical.

[VERIFIED] Focused M4.49, prerequisite, coverage, exact-floor, and full
canonicalizer gates pass. The canonicalizer wall is 156/156 tests plus 51
golden/idempotence/KIR, eight measured-witness, three profile-limit, and 226
hostile fixtures. The complete Node 22 `fitness:kern-5` wall passes, including
workspace, infrastructure, conformance, native, runner, browser-budget, and
final canonicalizer checks.

## Independent Review Evidence

[VERIFIED] High-risk automatic Agon routing completed 6/6 usable independent
review seats with security, correctness, dryness, performance, and overall
lenses. Consensus reported zero verified findings and zero blockers.

[VERIFIED] Four `needs-check` candidates were traced against the actual diff.
The requested `--no-verify` push is explicitly authorized and follows a green
equivalent full local fitness wall. Repeated source line counts, artifact
digests, and migrated-name sets are intentional independent fail-closed checks
across historical and cumulative milestone contracts; centralizing them would
make correlated drift easier to miss. No review-driven source change is
warranted.
