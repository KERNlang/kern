# KERN 5 R2 M4.67 — Node-Row Structural Runtime Headroom

**Status:** IMPLEMENTED — VERIFIED — REVIEWED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.66 commit
`3bcd5e7361be59a076968addc531d8ae77e07b97` freezes the exact current
26-function residual frontier and recommends candidate profile 30/50/388.
The selected cohort is exactly one legacy-parameter checker function with one
parameter row.

[DECIDED] M4.67 is evidence-only. It authenticates the exact structural runtime
floor for that counterfactually migrated function through the public
`kern.runtime.handler.v1` boundary. It does not change the active 28/50/388
profile, KERN source, generated consumers, parser, runtime, KIR, ABI, package
versions, or public APIs. It cannot authorize a profile promotion or a KERN 5
completion claim.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`3bcd5e7361be59a076968addc531d8ae77e07b97`.

[VERIFIED] The immutable M4.66 handoff is:

- receipt SHA-256
  `7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736`;
- input commit `e81c1b9543ad53625f81c9bd9a513e55bfb18083`;
- assignment digest
  `68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6`;
- selected limits 30 node rows, 50 property rows, and 388 value rows;
- one function in tool `checker` and one total parameter row;
- unchanged production collection ceiling 65,536 and KIR depth 64; and
- active profile remains 28/50/388 before any later promotion.

## Witness Contract

| Witness | Params | Structural rows | Required reason |
|---|---:|---:|---|
| `checker.kern#3:isSurfaceKind` | 1 | 30/32/219 | `profile.rows.nodes` |

[DECIDED] The witness is parsed from its authenticated handwritten source and
counterfactually migrated with `migrateLegacyFunctionForPrerequisite`. The
migrated function is structurally encoded and decoded, flattened, and executed
through the public runtime handler with exact candidate limits 30/50/388.

[VERIFIED] Bound source SHA-256 values before implementation are:

- checker source
  `a2aa6ade4a9eb216b8264435bec7b2d63d556e4b980ddc0f8130f87b946d0d16`;
- canonicalizer composite
  `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
- canonicalizer policy JSON
  `589de16d30335145b89dfe50f57721ae2424f580b659749d7b5de8f4f771257c`;
- composition JSON
  `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`;
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Headroom Contract

[DECIDED] The promotion budget remains policy-derived as three quarters of the
65,536 production ceiling: 49,152 steps, preserving 16,384 reserved production
headroom. The witness floor must be found by monotonic runtime execution rather
than estimated or selected to fit the budget.

[DECIDED] M4.67 must prove:

1. exact M4.66 receipt, selection, assignment, source, and active-profile
   identity;
2. exact counterfactual migration to one direct parameter and 30/32/219 rows;
3. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
4. execution at `exactFloor` succeeds with no diagnostics or events;
5. returned source reparses and structurally encodes byte-identically;
6. the exact floor is no greater than 49,152;
7. promotion and production headroom are exact arithmetic; and
8. module-envelope admission remains explicitly outside this structural claim.

[VERIFIED] Repository measurement found the exact runtime floor at 17,552:
17,551 fails with the canonical `unsupported-runtime-input` envelope and
17,552 succeeds. This leaves 31,600 steps below the 49,152 promotion budget and
47,984 steps below the 65,536 production ceiling. The successful result
reparses and structurally encodes byte-identically. Module-envelope admission
remains explicitly unclaimed.

[VERIFIED] The canonical M4.67 receipt SHA-256 is
`61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca`.
After final source generation, the coverage summary SHA-256 is
`9e264416ba5035cc1357debc17bed1c0cc0c7a8994d2333c954c2cdba7c8071c`,
the prerequisite summary SHA-256 is
`1a47da2b8cc333d437b44f74d02abf8c2c777ca1d276ec2325aea23dec800b2e`,
and the coverage implementation digest is
`e75ef274cb788c70d1e0520df144de951205f0b510f41aea09165b2d4c80833a`.

## Implementation Plan

1. Add a focused test importing the absent M4.67 receipt module and capture RED.
2. Measure the one witness through the public handler with bounded monotonic
   search, then freeze the exact floor only after floor-minus-one/floor proof.
3. Implement the canonical receipt writer/loader/validator using M4.63's live
   evidence schema, with plain tree-only data validation and writer integrity.
4. Add mutation, decorated/shared-data, M4.66-history, fresh-process, status,
   terminal-checker, and exact runtime-boundary tests.
5. Regenerate authenticated current summaries after all `.mjs` edits and run
   focused, standalone canonicalizer, and complete Node 22 fitness gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make one
   signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Review Evidence

[VERIFIED] Agon review `review-1784820101791-w9nwbt` routed all 6 usable
independent engines at high risk with automatic roles. All 6 completed; the
consensus contained 0 verified findings, 4 needs-check DRYness proposals, and
16 nits. Correctness and security returned no findings.

[DECIDED] The initial implementation kept each milestone receipt, proof, and
status string independently frozen. The DRYness challenger proposed extracting
shared receipt validation, runtime-floor scaffolding, status formatting, and
terminal-checker assertions. No code delta was accepted: retrofitting shared
helpers would couple published historical proofs, widen this evidence-only
slice, and change source digests without changing M4.67 behavior. The proposals
are suitable for a separately specified future cleanup after the release chain,
not for this immutable milestone. The remaining nits either preserve deliberate
strictness, exact ordinal witness identity, current-versus-published receipt
asymmetry, or established build ordering. No unresolved material dependency
remains. Post-review confidence is 0.99.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.66 commit `3bcd5e73`.
- [x] Exact M4.66 selection and witness assignment are grounded.
- [x] RED fails at the intended missing M4.67 receipt boundary with
      `ERR_MODULE_NOT_FOUND`.
- [x] The exact floor is verified at 17,551 failure and 17,552 success.
- [x] Output round-trips to byte-identical structural KIR.
- [x] Exact floor is below the 49,152 promotion budget by 31,600 steps.
- [x] Receipt is canonical, source-bound, regular-file-only, and tree-only.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product or profile surface is authorized to change.
- [x] Focused gates, 249/249 canonicalizer tests, the terminal checker, and the
      complete Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk 6/6 review has no verified or unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.66 digest, input commit, selection, assignment, or source bytes drift.
- The selected function no longer counterfactually migrates to exactly
  30/32/219 rows with one parameter.
- Runtime success is not monotonic at the measured collection boundary.
- The exact floor exceeds 49,152 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, ABI, or any
  historical receipt.

## Out of Scope

- Promoting `maxNodeRows` from 28 to 30.
- Migrating the selected parameter row.
- Claiming module-envelope admission, release readiness, stable KIR, semantic
  self-hosting, or KERN 5 completion.
