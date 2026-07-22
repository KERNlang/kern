# KERN 5 R2 M4.45 Frozen 388-Row Parameter Migration

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-22
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.44 raises only the canonicalizer value-row admission
ceiling from 154 to 388 and exposes an exact parameter-migration queue of two
functions, two tools, and two rows. M4.45 consumes exactly that queue as a
representation-only source migration: remove each target's legacy `fn.params`
property, prepend one equivalent direct `param` child, regenerate the two real
generated-consumer paths, and authenticate the resulting live receipts.

[DECIDED] M4.45 does not widen policy, select a structural family, change a
function body or call site, or alter runtime, KIR, ABI, public API, package
version, or browser policy. KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at published M4.44 commit
`dd977ff493250127e2e416ffb4e3ab68985a61dc`; both `origin/main` and
`feat/kern-5-r2-m4-44-value-row-promotion` resolved to that exact object.

[VERIFIED] The canonical M4.44 prerequisite receipt has SHA-256
`9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01`.
It binds:

- active profile 16/30/388;
- 58/104 base-complete functions;
- 45 legacy `fn.params` blockers;
- two parameter-ready functions across two tools and two parameter rows;
- 43 residual functions under bounded exhaustion;
- exact queue order `checkerSafeIntText`, then `validbinaryop`;
- exact migrated rows 14/20/161 and 12/15/388.

[VERIFIED] The live coverage receipt has SHA-256
`c11de38b5370eecbe48292ca8d15136d017205a7278321d57fe577236016f98a`.
The immutable M4.43 promotion frontier remains SHA-256
`823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8`.

## Root Cause

[VERIFIED] Both queued functions are blocked only by the excluded legacy
`fn.params` representation. M4.44 already executed their counterfactually
migrated forms through the production canonicalizer at the admitted profile.
No semantic, runtime, or policy capability is missing.

[VERIFIED] The two current handwritten sources are:

| Source | Lines | SHA-256 | Legacy functions |
|---|---:|---|---:|
| `checker-while.kern` | 271 | `6d42fe55e330523cf734fbe6476a3020f95271f68bdf2c9c14a2ed580d2b343f` | 8 |
| `canonicalizer.kern` | 442 | `394ebcf582c289d13f877b9546430991ea89cdea0ecd1a22b02bef64083d678d` | 5 |

## Frozen Migration Contract

| Function | Ordered direct parameter | Rows N/P/V | Semantic body SHA-256 | Tag |
|---|---|---:|---|---|
| `checker-while.kern#2:checkerSafeIntText` | `raw:string` | 14/20/161 | `6bb07b0387477b389d1d65d8e7e9a11669ea7574be3a5e2f4a49b547188fe026` | VERIFIED |
| `canonicalizer.kern#1:validbinaryop` | `op:string` | 12/15/388 | `f89118ca7fbca49d8abe04fb187f1cdca5484e7c9c49eaddd82a86ee079d748d` | VERIFIED |

For each target:

- [DECIDED] Remove only the legacy `params` property.
- [DECIDED] Remove any obsolete `params` entry from parser quote metadata.
- [DECIDED] Insert the exact direct `param` as the first child, immediately
  before the unchanged KERN handler.
- [DECIDED] Preserve name, return type, export status, body, calls, root
  ordinal, and every sibling function.
- [DECIDED] Reject mixed representation, missing/duplicated/reordered/mistyped
  parameters, a parameter after the handler, body drift, identity drift, or
  profile-row drift.

## Historical Receipt Contract

[DECIDED] Before live receipts are regenerated, the exact 120-line M4.44
prerequisite summary becomes a milestone-specific immutable handoff. Its
loader must bind canonical bytes, published SHA-256, source commit, format,
plain JSON data, dense arrays, regular non-symlink storage, exact 2/2/2 queue,
and the 58/45/43 transition boundary.

[DECIDED] After migration, historical tests read that frozen handoff rather
than asking changed live source to recreate a pre-migration queue. Current
post-migration tests remain live and deterministic.

## Expected Live Transition

[VERIFIED] Exact queue consumption implies these postconditions:

- base completion advances from 58/104 to 60/104;
- legacy blockers fall from 45 to 43;
- the parameter queue becomes exactly zero functions, zero tools, zero rows,
  and an empty witness list;
- the residual partition remains exactly 43 functions;
- bounded exhaustion remains over exception-flow and while-iteration;
- already-direct `sortStrings` remains complete and disjoint;
- active profile remains exactly 16/30/388.

[DECIDED] These are fail-closed predictions. Writers may record only the live
measured result. Any different count, identity, profile row, residual digest,
or next action stops implementation for root-cause analysis.

## Generated-Consumer Boundary

[VERIFIED] `checkerSafeIntText` flows into the generated checker fixture through
`scripts/capstone-checker-subset/fixtures.mjs` and
`gen-fixtures-kern.mjs`. The current `main.kern` is 150,780 lines at SHA-256
`d6a47919ef06a6cb6674d5ba94fbb706184ed7244c8d7d9015bb5d2e87b8301c`.
The unrelated numeric fixture must remain byte-identical at SHA-256
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`.

[VERIFIED] `validbinaryop` is an ordered canonicalizer composition member. The
current 49,400-byte composite is SHA-256
`1114de23dc9f6bb036eb4734ed8e7aadef5c1d79d54b1d0395967065fc4e904d`;
its composition record is SHA-256
`3fa5131b62fcdcea4325b22ab56b81e5dba368c7accfa670d090bcfcd7f29dc5`.
Only the canonicalizer member, composite, and composition record may change;
the expression-helper and statement-helper members must remain byte-identical.

## Blast Radius

| Surface | Required action |
|---|---|
| this spec | add, then seal with measured evidence |
| M4.44 prerequisite receipt | freeze exact canonical bytes and loader |
| `checker-while.kern` | migrate `checkerSafeIntText` only |
| `canonicalizer.kern` | migrate `validbinaryop` only |
| checker `main.kern` | regenerate with repository writer |
| checker `numeric-main.kern` | verify byte-identical |
| canonicalizer composite and composition record | regenerate with repository writer |
| coverage policy | replace exactly two corpus digests |
| live coverage/prerequisite receipts | regenerate from authenticated source |
| milestone tests and release train | bind transition and evidence |

## RED and Implementation Plan

1. Add M4.45 target contracts and mutation guards for exact identities,
   ordinals, direct parameters, body digests, profile rows, siblings, policy,
   and generated-output boundaries.
2. Freeze and validate the exact M4.44 prerequisite receipt before overwriting
   the live path. Convert M4.44 assertions from live pre-migration assumptions
   to immutable historical evidence.
3. Run the isolated M4.45 guard on published M4.44 and capture failure at the
   intended legacy-signature boundary.
4. Rewrite exactly two function headers and insert exactly two parameter rows.
5. Run the checker fixture writer and canonicalizer composition writer; prove
   unrelated generated files and members remain exact.
6. Update exactly two corpus digests, regenerate live receipts, and replace
   predictions only with measured facts.
7. Run focused gates and the complete Node 22.22 KERN 5 fitness wall.
8. Run required high-risk role-lens independent review because KERN source,
   generated consumers, and shared admission evidence change together.
9. Create one Agon-signed commit, fetch/rebase onto fresh `origin/main`, push
   once with `--no-verify` to the fresh feature ref and authorized `main`, and
   verify both remote hashes.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.44 commit `dd977ff4`.
- [x] Exact M4.44 prerequisite receipt is frozen and mutation-guarded.
- [x] RED fails on unchanged M4.44 at the intended legacy-signature boundary.
- [x] Exactly two targets lose `fn.params` and gain two ordered direct params.
- [x] Target bodies, calls, properties, ordinals, siblings, and profile rows
      remain exact; mixed or post-handler representation is rejected.
- [x] Exactly two handwritten corpus digests change.
- [x] Checker fixture and canonicalizer composition reproduce through their
      repository writers; unrelated generated outputs remain byte-identical.
- [x] Active policy remains exactly 16/30/388.
- [x] Live base completion is 60/104, blockers are 43, the queue is exact zero,
      and residual bounded exhaustion remains 43.
- [x] Historical M4.43/M4.44 evidence remains byte-identical and loadable.
- [x] Focused gates and complete Node 22.22 fitness wall pass.
- [x] Required independent high-risk role-lens review has no unresolved
      material finding.
- [x] Signed commit is fetched/rebased before one atomic no-verify push to the
      feature ref and authorized `main`; both remote hashes verify.

## Stop Conditions

- Either target body digest, identity, ordinal, export, return, call site, or
  measured row triple changes.
- Any third handwritten source or corpus digest changes.
- Policy differs from exact 16/30/388 or any runtime/KIR/ABI limit changes.
- Generated changes cannot be reproduced by the checked-in writers.
- The post-migration queue is non-empty, base is not 60/104, blockers are not
  43, or residual bounded exhaustion differs from 43.
- Historical receipt freezing requires editing old canonical bytes.

## Out of Scope

- Profile widening, structural-family selection, canonicalizer optimization,
  runtime or KIR work, public reader export, version bump, RC, or release.
- Function body, call-site, parser, codegen, handler, checker, or validator
  semantic changes.
- Claiming KERN 5 is complete.

## Measured Implementation Evidence

[VERIFIED] The isolated RED guard failed on unchanged published M4.44 at the
intended source-shape boundary: `checker-while.kern` measured 271 lines while
the exact direct-parameter result requires 272. The frozen M4.44 prerequisite
copy is byte-identical to the published live receipt at SHA-256
`9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01`.

[VERIFIED] Exactly two handwritten sources changed:

- `checker-while.kern`: 272 lines, SHA-256
  `906b1190e1a5abceb5a7620182b8c11417d1da60b963956d3363466167a04a45`;
- `canonicalizer.kern`: 443 lines, SHA-256
  `a04ae8f9af4f61c1560889277247963572de6a1c32c2f2cf63e4c341525b7019`.

[VERIFIED] Live coverage is exactly 60/104 with 43 `fn.params` blockers. The
parameter queue is exactly zero functions, zero tools, zero rows, and zero
witnesses; residual bounded exhaustion remains exactly 43 with unchanged
reason-assignment digest
`f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c`.
Coverage and prerequisite receipts authenticate at SHA-256
`f6d511f31f15afe38b24fa0bed20a9632ac1795e04d94271c22b1d05fb8cac47`
and `28e31cb5cba0859d79b08aae181c86ed95340b44669c2c6dc0428c21cf8f2470`.
Implementation, policy, function-fact, and corpus digests are respectively
`830fe8696f192ca61715e312f7f536291d71d15e490c73c473b0d67091a769e5`,
`f326deb064b3e787cd24d1adfb12066db2c6206b93ac3bdebbcfbeb196e93096`,
`b6adf472db5ae14b3ad4735d20a3ed3c4b6d5425295af2904c4136d441399d50`,
and `c3569edd5f178a08877f0fce3498b510f6e43209d2915a266af4a74e571c6c8d`.

[VERIFIED] The repository writers reproduce checker `main.kern` at SHA-256
`7adbe8a62c597fb42b6602d728e2c1aefb1dfc972bccafde3de6f50914363776`
and the 49,409-byte canonicalizer composite at SHA-256
`a81f3a28cae9b96bfe7fac0f3a38e7f6830590d11ab5e7214293297f103b1872`.
Composition metadata authenticates at
`7f97b53c34ef4fab067f45ccd75f1817dc1fd4628e2febd43b361036adc74e14`.
The numeric checker fixture and both unrelated canonicalizer members remain
byte-identical to their published M4.44 hashes.

[VERIFIED] Focused validation passes the generated checker 48/48 fixture gate,
five exact runtime-floor/performance tests, and the complete canonicalizer gate:
135/135 tests plus 51 golden/KIR fixtures, eight measured witnesses, three
profile-limit fixtures, and 226 hostile fixtures.

[VERIFIED] The complete Node 22.22 `fitness:kern-5` wall exits zero on the
M4.45 tree. It passes repository consistency, lint, every workspace build and
test, release and infrastructure policy, 434/434 cross-target fixtures,
109/109 class fixtures, 233/233 native assertions at 100% coverage, 48/48
checker fixtures with 36 rejected accept-but-abstain attempts, 39/39 validator
verdicts, 40 app-behavior fixtures across three legs with Express/FastAPI boot,
the complete runtime/KIR/ownership/convergence wall, diff hygiene, and a second
complete 135/135 canonicalizer run with all 51/8/3/226 replay fixtures. The
required browser receipt is 157 modules, 1,553,103 raw bytes, and 333,617 gzip
bytes at 57 ms cold and a 93 ms median (87/93/111 ms samples).

[VERIFIED] Required high-risk role-lens review
`review-1784734117538-be83sb-kern-5-r2-m4-45-final` completed with all 6/6
usable non-excluded engines. No candidate was consensus-verified. Direct code
inspection disproved the body-digest concern: `semanticBodyDigest` excludes
only legacy `params`, direct `param` children, and locations while retaining
all other function properties. Historical milestone guards and published
handoff loaders remain deliberately independent and cumulative; consolidating
them would broaden this representation-only slice and rewrite old evidence.
The genuine generated-artifact authentication gap was fixed: M4.45 now pins
both handwritten sources, generated checker `main.kern`, the composite and
composition record, unchanged generated members, and the explicit return
types. Post-fix lint, 10/10 focused review tests, and the complete 135/135 plus
51/8/3/226 canonicalizer gate pass. No material finding remains unresolved.

## Open Questions

[DECIDED] None blocks implementation. Post-migration artifact hashes and
generated line counts are deliberately measured by repository writers rather
than predicted.
