# KERN 5 R2 M4.73 — Dual-Row Parameter Migration

**Status:** IMPLEMENTED — VERIFIED — REVIEW GREEN — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.72 commit
`8d8326ed3071db4968e65bac29c067e1426c220b` promotes the active
canonicalizer profile to 31/53/388 and exposes one exact parameter-migration
queue: one function, one tool, and 14 rows for
`examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist`.

[DECIDED] M4.73 freezes the exact published M4.72 prerequisite summary and
migrates only `validstatementlist` from its legacy `params=` signature to 14
ordered direct structured `param` children. Function identity, export and
return contracts, semantic body, callers, active profile, coverage families,
runtime, KIR, ABI, package versions, and every historical receipt remain
unchanged. KERN 5 remains incomplete.

## Published Input

[VERIFIED] The fresh branch
`feat/kern-5-r2-m4-73-dual-row-parameter-migration` starts from exact
`origin/main` commit `8d8326ed3071db4968e65bac29c067e1426c220b` with a clean worktree.

[VERIFIED] Published M4.72 binds:

- prerequisite summary SHA-256
  `617e5e0dc200d8f931d94ab9d6b09e6c7080f6216d40918927d340b339c27461`;
- coverage summary SHA-256
  `885af96ee3e9279fbf2ca8f1d1bf87f633fc1f8c86fe0aceb413f18dccbb428a`;
- canonicalizer policy SHA-256
  `a4b53907df9507d12606fafb1bbf42fd5e129589e389e5ac349c154a8e3ab964`;
- active profile 31/53/388, 78/104 base-complete functions, 25 legacy
  `fn.params` blockers, and 24 residual functions outside the sealed queue;
- exact queue cardinality 1 function / 1 tool / 14 rows; and
- exact residual assignment digest
  `bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831`.

## Exact Target Contract

| Field | Required value |
|---|---|
| path | `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern` |
| function ordinal | 1 zero-based |
| coverage id | `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist` |
| name | `validstatementlist` |
| export | `true` |
| returns | `boolean`, unquoted |
| parameter rows | 14 |
| pre/post profile rows | 31/53/370 |
| semantic body SHA-256 | `477cf24c525529da58576d47f0fc00a7d4439ff5653193460f65efea57929b53` |

[DECIDED] The exact ordered parameters are:

1. `parent:number`
2. `returnType:string`
3. `nodeKind:string[]`
4. `nodeParent:number[]`
5. `nodeOrder:number[]`
6. `propNode:number[]`
7. `propKey:string[]`
8. `propValue:number[]`
9. `valueTag:string[]`
10. `valueParent:number[]`
11. `valueRole:string[]`
12. `valueOrder:number[]`
13. `valueText:string[]`
14. `valueBool:number[]`

[DECIDED] The root loses only the quoted legacy `params` property and gains
those 14 direct children before the existing KERN handler. No caller or body
expression changes.

## Source and Generated-Artifact Contract

[VERIFIED] Before migration, the target source is 182 lines, has five function
roots, SHA-256
`adfa0c49cee230106ba7cff2249a0306f98aefc009d7e2581a3ffc622f6e9ff7`,
and has exactly three legacy roots in authored order:
`validstatementlist`, `validstatement`, and `emitstatement`.

[DECIDED] After migration, it must be exactly 196 lines with the same five
function roots and exactly two remaining legacy roots: `validstatement` and
`emitstatement`. No other handwritten KERN source may change.

[VERIFIED] Pre-migration generated artifact SHA-256 values are:

- canonicalizer composite:
  `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
- composition record:
  `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`;
- checker main:
  `c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e`;
- numeric checker main:
  `4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`;
- assertion main:
  `a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03`;
- validator main:
  `9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7`.

[DECIDED] Regenerate the canonicalizer composite and composition record only
through `composition.mjs --write`. The four unrelated aggregate artifacts must
remain byte-identical.

[VERIFIED] Post-migration source and generated artifact SHA-256 values are:

- statement-helper source:
  `158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667`;
- canonicalizer composite:
  `c1b42e6183731a757cdad7150339ec38090c11aeaa6404095ae16f34412a3b89`;
- composition record:
  `25303c8fc07467fe5eb20dd0ba4b0e2aa074e4e133ace9919d4a82e8c6c87289`.

[VERIFIED] The source is exactly 196 lines with the same five function roots
and only `validstatement` and `emitstatement` retaining legacy `params`.
Checker main, numeric checker main, assertion main, and validator main retain
their published byte identities.

## Post-Migration Contract

[VERIFIED] Consuming the sealed queue produces exactly 79/104 base-complete
functions and 24 legacy blockers under unchanged active 31/53/388 policy. The
parameter queue is empty, while bounded exhaustion remains 24 functions with
the same reason-assignment digest
`bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831`.

[VERIFIED] Final live receipt SHA-256 and internal bindings are:

- coverage summary:
  `68df5ada4f4da0e81d2c0840851871f52347dc210305d69e121c79e989095d31`;
- prerequisite summary:
  `5212bf7447ff9264ace9450191311a93ef02a900b0da816275936293c0348c73`;
- coverage policy:
  `60c907324d92462afdd16fb6d43b6f4ff837231cdf561caece4ad064053ab2f9`;
- canonicalizer policy:
  `a4b53907df9507d12606fafb1bbf42fd5e129589e389e5ac349c154a8e3ab964`;
- corpus digest:
  `47165ce1ef23445d3e66f268b3785f400453113a2ceef3c96139ccef083015d5`;
- function-facts digest:
  `5bd2779a0abc83fcb9bd0f5bcfe74e162e3d45fd0c6dda4a37c9caef573fba03`;
- coverage implementation digest:
  `7a378888f6dad20dc2b56660658068b02d169e312d25385e0de76f9ec9b63b49`.

[DECIDED] Freeze the current prerequisite summary byte-identically as
`coverage-prerequisite-m4-72.json` with a loader bound to the published digest,
source commit, canonical JSON bytes, plain data, and a regular non-symlink
path before regenerating live summaries.

[VERIFIED] The frozen M4.72 copy is byte-identical at SHA-256
`617e5e0dc200d8f931d94ab9d6b09e6c7080f6216d40918927d340b339c27461`,
and its loader binds exact source commit
`8d8326ed3071db4968e65bac29c067e1426c220b`.

## Verification Evidence

[VERIFIED] RED failed for both intended reasons: the published target retained
its legacy `params` property, and the immutable M4.72 loader did not yet exist.

[VERIFIED] The 16-file transition cluster passed 88/88 tests. The complete
canonicalizer gate passed 278/278 tests plus 55 golden/idempotence/KIR
fixtures, 8 measured witnesses, 3 profile-limit fixtures, and 235 hostile
fixtures. The terminal coverage checker reports 79/104 base-complete, 24
legacy blockers, an empty parameter queue, and bounded active-family
exhaustion.

[VERIFIED] The full Node 22.22.0 aggregate completed with exact marker
`KERN 5 current fitness wall passed.` This includes repo consistency, lint,
build, all workspace tests, release and infrastructure gates, conformance,
runtime/ABI containment, KIR evidence, runner/browser budgets, capstone and
self-host smoke, application behavior, drift controls, and repeated complete
canonicalizer walls.

[VERIFIED] High-risk role-lens Agon review run
`review-1784842815018-fe5sm6` completed 6/6 usable reviewers with zero verified
findings. Its sole needs-check suggestion was to share milestone receipt-loader
logic; direct comparison confirmed the duplication is intentional so every
published milestone remains independently verifiable and cannot drift through
a future shared-helper edit. Remaining observations were non-defect nits.

## RED and Implementation Plan

1. Add an M4.73 target/migration oracle that imports the absent immutable
   M4.72 handoff loader and requires the direct 14-parameter prefix.
2. Capture RED against the published legacy target and missing loader.
3. Add the immutable M4.72 receipt copy/loader, then replace only the target
   signature with the exact ordered direct parameter children.
4. Regenerate the canonicalizer composition through its repository writer.
5. Pin target identity, body digest, signature, profile rows, source shape,
   generated artifacts, queue consumption, previous migrations, and immutable
   receipt bytes.
6. After all MJS bytes settle, regenerate active coverage/prerequisite
   summaries and run their checker.
7. Run focused tests, the complete canonicalizer gate, full Node 22 KERN 5
   fitness, and independent high-risk role-lens review; resolve every verified
   material finding.
8. Create one Agon-signed commit, fetch and immediately rebase onto current
   `origin/main`, atomically push the fresh feature and authorized `main` refs
   once with `--no-verify`, then verify identical remote hashes.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.72 commit `8d8326ed`.
- [x] Published digests, queue, target, body, source, profile, and artifacts are
      grounded.
- [x] RED proves the published source still has legacy `params` and the M4.72
      loader is absent.
- [x] M4.72 prerequisite summary is frozen byte-identically and source-bound.
- [x] Exactly one function gains exactly 14 ordered direct parameter children.
- [x] Target identity, body, callers, handler, returns, export, and profile stay.
- [x] Target source is 196 lines with exactly the two expected legacy roots.
- [x] Only canonicalizer composite/record regenerate; unrelated artifacts stay.
- [x] Coverage becomes 79/104 with 24 legacy blockers and an empty queue under
      unchanged 31/53/388 policy.
- [x] Residual bounded exhaustion remains exactly 24 with unchanged digest.
- [x] Prior migrations and every historical receipt remain exact.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote refs verify identically.

## Stop Conditions

- Published M4.72 receipt bytes, digest, queue order, or source commit differs.
- Target ordinal, identity, parameter order, body digest, or profile rows differ.
- Any second handwritten function changes or migration needs profile/family,
  parser, runtime, KIR, or ABI work.
- Any generated artifact outside the canonicalizer composite/record drifts.
- Post-state differs from 79/104, 24 legacy blockers, an empty queue, or the
  exact 24-function bounded exhaustion.
- Any required gate or verified review finding remains unresolved.

## Out of Scope

- Any migration outside the exact M4.72 queue.
- Any profile, family, parser, runtime, KIR, ABI, public API, package, version,
  RC, stable-release, or Fable change.
- Residual analysis or a KERN 5 completion claim.
