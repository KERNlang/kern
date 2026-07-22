# KERN 5 R2 M4.53 Property-Row Parameter Migration

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-23
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published M4.52 raises only the canonicalizer property-row ceiling
to 31 and exposes an exact parameter-migration queue of one validator function
and six rows. M4.53 consumes exactly that queue as a representation-only source
migration.

[DECIDED] Remove `classcyclefrom`'s legacy `fn.params` property, prepend the
six equivalent ordered direct `param` children, regenerate only the real
generated checker consumer, and authenticate the resulting live receipts. Do
not change policy, function body, calls, runtime, parser, KIR, ABI, public API,
package version, or browser policy. KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at published M4.52 commit
`99905b044c3d981998a3beef846da283dac4a94c`.

[VERIFIED] The canonical M4.52 prerequisite receipt has SHA-256
`220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76`.
It binds profile 19/31/388, 64/104 base-complete functions, 39 legacy
`fn.params` blockers, one ready validator function, six parameter rows, and 38
residual functions.

## Frozen Migration Contract

| Function | Ordered direct parameters | Rows N/P/V after migration | Semantic body SHA-256 |
|---|---|---:|---|
| `validator.kern#17:classcyclefrom` | `module:number`, `name:string`, `classModule:number[]`, `className:string[]`, `classExtends:string[]`, `path:number[]` | 19/31/202 | `888c6809b7e88542783352ed8001d8617b72af76d3f692ad87789b3a327dec3b` |

For the target:

- [DECIDED] Remove only the quoted legacy `params` property.
- [DECIDED] Insert exact ordered direct `param` children immediately before
  the unchanged KERN handler.
- [DECIDED] Preserve identity, root ordinal 17, boolean return, export status,
  body, recursive call, external call sites, and every sibling function.
- [DECIDED] Reject mixed, missing, duplicated, reordered, mistyped, or
  post-handler parameters; reject body, identity, export, return, or profile
  drift.

## Historical Receipt Contract

[DECIDED] Before regenerating live evidence, copy the exact canonical M4.52
prerequisite bytes to a milestone-specific immutable handoff. Its loader binds
the published digest, source commit, format, canonical JSON, plain data, dense
arrays, and regular non-symlink storage.

## Expected Live Transition

[VERIFIED] Consuming the only ready witness at unchanged profile 19/31/388
implies:

- base completion advances from 64/104 to 65/104;
- legacy blockers fall from 39 to 38;
- the parameter queue becomes exactly empty;
- bounded-exhaustion residual remains exactly 38 functions;
- the M4.52 reason-assignment digest may remain unchanged because the migrated
  function already left bounded exhaustion when it entered the ready queue.

[DECIDED] These are fail-closed predictions. Any measured mismatch stops the
slice for root-cause analysis.

## Generated-Consumer Boundary

[VERIFIED] `examples/selfhost-validator/main.kern` imports the validator and
does not embed its source, so it must remain byte-identical. The checker fixture
generator embeds `validator.kern`, so
`examples/capstone-checker-subset/main.kern` must be regenerated. Its unrelated
`numeric-main.kern` must remain byte-identical. Canonicalizer composition
members and metadata must remain byte-identical.

## Implementation Plan

1. Freeze and validate the exact M4.52 prerequisite receipt.
2. Add M4.53 exact-target and mutation guards; capture RED on unchanged source
   at the intended legacy-parameter boundary.
3. Migrate only `classcyclefrom` and its six direct parameter rows.
4. Regenerate only checker `main.kern` through its repository writer.
5. Update exactly the validator corpus digest and regenerate live coverage and
   prerequisite receipts after implementation scripts reach final bytes.
6. Run focused tests, the canonicalizer wall, self-host/checker gates, and full
   KERN 5 fitness.
7. Run independent high-risk role-lens Agon review, fix verified findings,
   create one signed commit, fetch/rebase, atomically push once with
   `--no-verify`, and verify the feature and authorized `main` remote hashes.

## Implementation Evidence

[VERIFIED] The regression test was first run against the unchanged M4.52
source. It failed at the intended representation boundary: the validator still
had 495 source lines instead of 501 and the exact legacy `params` property was
present instead of absent.

[VERIFIED] The immutable M4.52 receipt and loader have SHA-256 values
`220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76`
and `357e848651a9347a4c96c269686253dc0e5e49407456fe5cb0767b4cef400639`.
Mutation tests bind canonical bytes, source commit, schema, plain data, dense
arrays, and regular non-symlink storage.

[VERIFIED] Only `validator.kern#17:classcyclefrom` moved from the legacy
parameter string to the exact six direct children. Its body digest remains
`888c6809b7e88542783352ed8001d8617b72af76d3f692ad87789b3a327dec3b`
and its measured row triple is 19/31/202. The validator and regenerated checker
sources authenticate at
`d648518028d33df00a3a2c49d9c93c398076b529bd33d01d5d0fe71fbb09b17f`
and `ff961e9e6c3796f8b21ae0622f8fe8c779f4734603e3a31db2b02b2f155aaea2`.

[VERIFIED] The live policy remains 19/31/388. Coverage is 65/104 base-complete,
38 functions are blocked by legacy `fn.params`, the ready queue is exactly
0/0/0, and bounded-exhaustion residual is exactly 38. The reason-assignment
digest remains
`158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8`.
The current coverage and prerequisite receipts have SHA-256 values
`ae82ad725240338fb5cb37e3847e8b06e8a1940f771a7e2d75a4f0a6c10f779c`
and `c53e760123fc4f48c37a905d76d291f8bb4eacb12dbb792461fdd84358062416`.
Their live implementation digest is
`6bb9375f22dd1bee7dd371c43f725d68a79dc2e83e94b2cecc3c1c3c5c15dd93`;
the policy, corpus, function-facts, and combined policy digests are
`213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c`,
`da83239e2f10cf3a14350fc935c43ca44fcaf461e6513e14cc25ff984ec3c9de`,
`7f42974aba8157c6f20fae3cf0c7632317e36e2e7c0d6e5869c32aa31970dc78`,
and `c6838abc0d5dd2db23f1050b7acc3e0411f5d8e4ffbe90abd47bcdcf2ada95ac`.

[VERIFIED] Focused gates pass 4/4, 54/54, and 32/32. The standalone
canonicalizer wall passes 175/175 tests plus 51 golden/idempotence/KIR, eight
measured, three profile-limit, and 226 hostile fixtures. The complete Node
22.22 `pnpm fitness:kern-5` wall passes, including 48/48 checker fixtures,
39/39 self-host validator verdicts, 434/434 cross-target fixtures, 109/109
class fixtures, and 233/233 native KERN assertions at 100% coverage.

[VERIFIED] Required high-risk role-lens review
`review-1784762426236-sq8uae-kern-5-r2-m4-53` completed all 6/6 usable
independent reviewers with zero verified findings and zero blockers. Two
needs-check DRY observations proposed centralizing repeated generated-artifact
digests and validator line counts. Source inspection rejects both changes:
these are deliberately independent milestone and cumulative proof boundaries,
and sharing one mutable constant would allow a single edit to bless drift in
multiple guards. Eleven remaining observations were nits.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.52 commit `99905b04`.
- [x] Exact 1/1/6 queue and M4.52 receipt digest are recorded.
- [x] Exact M4.52 receipt is frozen and mutation-guarded.
- [x] RED fails at the intended legacy representation boundary.
- [x] Exactly one function loses legacy `params` and gains six direct rows.
- [x] Body, identity, ordinal, export, return, calls, and 19/31/202 rows remain
      exact.
- [x] Exactly one handwritten corpus digest changes.
- [x] Checker `main.kern` reproduces; unrelated generated artifacts remain
      exact.
- [x] Profile stays 19/31/388; base becomes 65/104; blockers and residual are
      38; live parameter queue is empty.
- [x] Independent review has no unresolved material finding; focused and full
      gates pass.
- [ ] Signed commit is rebased before one atomic no-verify push; both remote
      hashes verify.

## Stop Conditions

- Target semantic digest, identity, ordinal, export, return, recursive call, or
  row triple differs.
- Any second handwritten source/corpus digest changes.
- Policy, runtime, parser, KIR, ABI, public surface, or package version changes.
- Generated drift is not reproduced by the checked-in writer.
- Live transition differs from exact 65/38/0/38.

## Out of Scope

- Further profile widening or structural-family selection.
- Runtime, KIR, parser, codegen, checker, or validator semantic changes.
- Version bump, release candidate, release, or claiming KERN 5 complete.
