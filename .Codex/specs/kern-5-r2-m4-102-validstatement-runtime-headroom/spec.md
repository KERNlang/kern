# KERN 5 R2 M4.102 — `validstatement` Structural Runtime Headroom

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published M4.101 commit
`713d82ea1c9cf6f87d8f5793a6276c4caf62feb6` freezes the exact residual
analysis receipt
`9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0`.
It selects one structurally complete witness:

`examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement`

with 14 parameter rows and structural rows 89/125/2100.

[DECIDED] M4.102 authenticates the witness's exact structural runtime floor at
the unchanged production maximum collection length 65,536 and promotion budget
49,152. The evidence must publish either authenticated promotion headroom or a
bounded rejection. The outcome is determined by measurement, not assumed.

[DECIDED] M4.102 changes no KERN source, generated tool, coverage policy,
runtime/KIR limit, runtime ABI, active profile, parameter signature, or
cumulative base coverage.

[DECIDED] M4.102 is not KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main`
`713d82ea1c9cf6f87d8f5793a6276c4caf62feb6`.

[VERIFIED] The input identities are:

- M4.101 residual-analysis SHA-256
  `9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0`;
- canonicalizer composite SHA-256
  `983eed5c8841b0cdf41a0b678734f2457c97545a88607969acc9fd4dcc1fc807`;
- statement-helper source SHA-256
  `158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667`;
- runtime policy SHA-256
  `687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09`;
- coverage policy SHA-256
  `e5fdb18d2de95a15429e51364fb817b3f99342d272105db6c53091e3baf00b8c`;
- coverage summary SHA-256
  `be6b6ee977befdfbc9f36b2cdcf23892c20d390bca9fcd0014a665245784b72f`;
  and
- prerequisite summary SHA-256
  `970d8f9eed9deb6dc021ecabb16758cf64eb41b9cfa0fb794a248513a67f3dec`.

## Measurement Contract

[DECIDED] The measurement owner must:

1. parse the exact checked-in statement-helper source and select child 2 by
   both position and function name;
2. apply the established legacy-parameter prerequisite migration in memory;
3. structural-KIR encode/decode the single function under the unchanged KIR
   limits and authenticate exact rows 89/125/2100;
4. call the composed KERN canonicalizer through the internal runtime handler
   with candidate profile limits 89/125/2100;
5. locate the smallest positive collection budget whose result round-trips the
   migrated structural function;
6. prove failure at floor minus one and success at the exact floor;
7. verify public runtime-handler parity at the exact floor; and
8. publish a canonical closed receipt bound to all input identities.

[DECIDED] If the exact floor is at most 49,152, the receipt may authenticate
promotion headroom and hand off to M4.103 for profile promotion. If it exceeds
49,152, the receipt must reject promotion and identify the exact deficit and
next optimization/investigation milestone. M4.102 itself never edits policy.

## Implementation Plan

1. Add a RED test importing the absent M4.102 measurement boundary.
2. Add a side-effect-free live measurement harness and determine the exact
   floor by bounded search.
3. Add a closed receipt owner, checker, canonical JSON receipt, mutation and
   fresh-process guards, and exact floor-minus-one/floor runtime tests.
4. Integrate the verified disposition into central coverage status without
   changing active coverage facts or policy.
5. Run focused and complete canonicalizer gates, full Node 22 KERN 5 fitness,
   mandatory high-risk role-lens review, then signed fetch/rebase-first atomic
   publication.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.101 commit `713d82ea`.
- [x] M4.101 selection, source identities, and unchanged budgets are grounded.
- [x] RED fails at the absent M4.102 measurement boundary.
- [x] The migrated witness authenticates exact structural rows 89/125/2100.
- [x] Floor minus one fails and the exact floor succeeds with round-trip.
- [x] Public and internal runtime handlers agree at the exact floor.
- [x] Receipt disposition exactly follows the 49,152 promotion budget.
- [x] M4.102 changes no source, generated tool, policy, runtime/KIR limit, ABI,
      active profile, signature, or cumulative base coverage.
- [x] Focused canonicalizer and central coverage gates pass.
- [x] Complete canonicalizer gate passes.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved verified blocker.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- Live source or M4.101 identities differ from the published inputs.
- The selected source child is not exact `validstatement`.
- Structural rows differ from 89/125/2100 after in-memory migration.
- The measured envelope succeeds without an exact structural round-trip.
- Public/internal runtime-handler parity differs.
- The slice requires policy, runtime/KIR, ABI, source, generated-tool, or base
  coverage changes.

## Out of Scope

- Promoting 89/125/2100 or migrating `validstatement`.
- Optimizing runtime cost if the exact floor misses the promotion budget.
- Implementing projection-depth/node, unknown-expression, text-character, or
  exception-flow support.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The RED oracle failed at the absent
`triple-row-headroom-m4-102.mjs` boundary before implementation.

[VERIFIED] The migrated `validstatement` witness has 14 direct prerequisite
parameters and exact structural rows 89/125/2100.

[VERIFIED] Bounded live search proves:

- 49,152 promotion budget: failure;
- 65,536 production ceiling: failure;
- 72,194: failure; and
- exact floor 72,195: success with structural round-trip and public/internal
  runtime-handler parity.

[VERIFIED] The canonical M4.102 receipt SHA-256 is
`8bed0a4709de4ba79dfffba68e4f9304bdf599e04d771520637bb935865b5e58`.
It rejects profile promotion because the exact floor exceeds production by
6,659 and the promotion budget by 23,043 steps, then hands runtime-bottleneck
investigation to M4.103.

[VERIFIED] M4.102 changes no KERN source, generated tool, policy, runtime/KIR
limit, ABI, active profile, signature, or cumulative base coverage. Current
coverage remains 90/109 with 16 legacy parameter blockers and no ready queue.

[VERIFIED] Post-review focused M4.102 tests pass 6/6, and the complete
canonicalizer corpus passes 432/432. Derived summaries converge and the
central coverage checker passes with:

- coverage implementation digest
  `10bda4ef6ec83451982d6992b5f29e0532f19653d4e26226b41184e9c70c0432`;
- coverage summary SHA-256
  `70315869645be491aee5f0b10987c021c695458670d25a0295f77c10aa9f7905`;
  and
- prerequisite summary SHA-256
  `e0433e9561e470021416cd4f23ba619b0e10045f2c043aaa6731d0a7bcd91d3c`.

[VERIFIED] The complete canonicalizer gate passes 432/432 Node tests plus 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] Mandatory high-risk role-lens review run
`review-1785145542031-kycqxx` completed with 6/6 independent reviewers and
zero verified blockers. Two valid needs-check findings were fixed: the live
measurement owner now has an exact main-module guard, and the runtime test
explicitly remeasures both the 49,152 promotion budget and 65,536 production
ceiling. One speculative finding and five nits required no correctness change.

[VERIFIED] After those review fixes, the complete Node 22
`pnpm fitness:kern-5` wall passes, including repo consistency, lint,
production build, all workspace and infrastructure tests,
conformance/showcase/browser-budget lanes, KIR gates, both 432/432
canonicalizer invocations, and the final `KERN 5 current fitness wall passed`
oracle.
