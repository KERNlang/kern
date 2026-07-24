# KERN 5 R2 M4.75 — Node+Value Structural Runtime Headroom

**Status:** IMPLEMENTED — REVIEWED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.74 commit
`b867c5d5b67917f7abc7cdc3da5c76b867c69cf5` freezes the exact current
24-function residual frontier and selects candidate profile 38/53/461. The
selected cohort is exactly one legacy-parameter canonicalizer function with
six parameter rows.

[DECIDED] M4.75 is evidence-only. It authenticates the exact structural runtime
floor for that counterfactually migrated function through the public
`kern.runtime.handler.v1` boundary. It does not change the active 31/53/388
profile, KERN source, generated consumers, parser, runtime, KIR, ABI, package
versions, or public APIs. It cannot authorize a profile promotion or a KERN 5
completion claim.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`b867c5d5b67917f7abc7cdc3da5c76b867c69cf5`.

[VERIFIED] The immutable M4.74 handoff is:

- receipt SHA-256
  `dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0`;
- residual-analysis input commit
  `1fe7851101cf2a25e1aebfd561655bb458aec66b`;
- assignment digest
  `bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831`;
- selected limits 38 node rows, 53 property rows, and 461 value rows;
- one function in tool `canonicalizer` and six total parameter rows;
- unchanged production collection ceiling 65,536 and KIR depth 64; and
- active profile remains 31/53/388 before any later promotion.

[VERIFIED] The exact published M4.74 live evidence is additionally bound by:

- coverage implementation digest
  `025fbf7ea33aecf8e1ee36fc6ef2334fbb2a71641777660473953e9da38a36ee`;
- coverage-summary SHA-256
  `728cf911c27bd81ccbd466d9dbb2c3a7ef08fd7131eda446168cd05a8d8b3e2d`;
  and
- prerequisite-summary SHA-256
  `57f140620f1d8b604b709708e7a2480d2e08311ab045f5c02a77b6d754f8b4be`.

## Witness Contract

| Witness | Params | Structural rows | Required reasons |
|---|---:|---:|---|
| `examples/kern-canonicalizer/canonicalizer.kern#0:typesource` | 6 | 38/51/461 | `profile.rows.nodes`, `profile.rows.values` |

[DECIDED] The witness is parsed from its authenticated handwritten source and
counterfactually migrated with `migrateLegacyFunctionForPrerequisite`. The
migrated function is structurally encoded and decoded, flattened, and executed
through the public runtime handler with exact candidate limits 38/53/461.

[VERIFIED] Bound source SHA-256 values before implementation are:

- canonicalizer source
  `a04ae8f9af4f61c1560889277247963572de6a1c32c2f2cf63e4c341525b7019`;
- canonicalizer composite
  `c1b42e6183731a757cdad7150339ec38090c11aeaa6404095ae16f34412a3b89`;
- canonicalizer policy JSON
  `a4b53907df9507d12606fafb1bbf42fd5e129589e389e5ac349c154a8e3ab964`;
- composition JSON
  `25303c8fc07467fe5eb20dd0ba4b0e2aa074e4e133ace9919d4a82e8c6c87289`;
  and
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Headroom Contract

[DECIDED] The promotion budget remains policy-derived as three quarters of the
65,536 production ceiling: 49,152 steps, preserving 16,384 reserved production
headroom. The witness floor must be found by monotonic runtime execution rather
than estimated or selected to fit the budget.

[DECIDED] M4.75 must prove:

1. exact M4.74 receipt, selection, assignment, source, and active-profile
   identity;
2. exact counterfactual migration to six direct parameters and 38/51/461 rows;
3. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
4. execution at `exactFloor` succeeds with no diagnostics or events;
5. returned source reparses and structurally encodes byte-identically;
6. the exact floor is no greater than 49,152;
7. promotion and production headroom are exact arithmetic; and
8. module-envelope admission remains explicitly outside this structural claim.

[VERIFIED] Repository measurement found the exact runtime floor at 46,255:
46,254 fails with the canonical `unsupported-runtime-input` envelope and
46,255 succeeds. This leaves 2,897 steps below the 49,152 promotion budget and
19,281 steps below the 65,536 production ceiling. Module-envelope admission
remains explicitly unclaimed; the implementation gate must separately prove
the successful result reparses and structurally encodes byte-identically.

## Implementation Plan

1. Add a focused test importing the absent M4.75 receipt module and capture RED.
2. Freeze the one witness and exact measured floor only after the direct
   floor-minus-one/floor proof above.
3. Implement canonical format `kern.kir-canonicalizer.dual-row-headroom.3`
   using the live evidence writer/loader/validator contract, including plain
   tree-only data and regular-file/non-symlink enforcement.
4. Add mutation, decorated/shared-data, exact live-measurement equality,
   M4.74-history, fresh-process, status, terminal-checker, and exact
   runtime-boundary tests.
5. Regenerate authenticated current summaries after all `.mjs` edits and run
   focused, standalone canonicalizer, and complete Node 22 fitness gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.74 commit `b867c5d5`.
- [x] Exact M4.74 selection and witness assignment are grounded.
- [x] RED fails at the intended missing M4.75 receipt boundary with
      `ERR_MODULE_NOT_FOUND`.
- [x] The exact floor is measured at 46,254 failure and 46,255 success.
- [x] Output round-trips to byte-identical structural KIR.
- [x] Exact floor is below the 49,152 promotion budget by 2,897 steps.
- [x] Receipt is canonical, source-bound, regular-file-only, and tree-only.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product or profile surface is authorized to change.
- [x] Focused gates, complete canonicalizer, terminal checker, and complete
      Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.74 digest, input commit, selection, assignment, or source bytes drift.
- The selected function no longer counterfactually migrates to exactly
  38/51/461 rows with six parameters.
- Runtime success is not monotonic at the measured collection boundary.
- The exact floor exceeds 49,152 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, ABI, or any
  historical receipt.

## Verification Evidence

[VERIFIED] The repository writer produced canonical M4.75 receipt SHA-256
`c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6`.
After all `.mjs` bytes settled, the current coverage implementation digest is
`76858d2155b359169567db03929a2888790d0b32c64361af6375108a5105eebe`.
The coverage-summary and prerequisite-summary SHA-256 values are
`34f35e56be7ba09f97f3b7d4fe5b5783cc1047dc477ec1967ac60873fbf9f588`
and `8fa0f96eb0e01ce3403793be4fbe9c53541e52ce11aaecf3ce08d0719be08f73`.

[VERIFIED] Receipt/status tests passed 23/23. Direct execution at 46,254
returned the canonical `unsupported-runtime-input` envelope; execution at
46,255 returned success with no diagnostics or events and byte-identical
structural KIR after reparse.

[VERIFIED] The complete canonicalizer gate passed 288/288 Node tests plus 55
golden/idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 235 hostile fixtures. Its terminal coverage evidence includes
the exact M4.75 one-witness floor and M4.76 node+value promotion handoff.

[VERIFIED] The complete Node 22 release wall exited zero with terminal marker
`KERN 5 current fitness wall passed.` Its final dedicated canonicalizer rerun
again passed 288/288 Node tests plus the same fixture aggregates.

[VERIFIED] Automatic high-risk role-lens review completed 6/6 usable independent
engines successfully with zero verified findings. The two consensus
`needs-check` items were resolved against repository evidence: the published
M4.74 commit literal is exactly 40 hexadecimal characters and resolves as a
commit, while milestone-local validation helpers match the established
immutable receipt pattern and introduce no material correctness risk.

## Out of Scope

- Promoting `maxNodeRows` from 31 to 38 or `maxValueRows` from 388 to 461.
- Migrating the selected six parameter rows.
- Claiming module-envelope admission, release readiness, stable KIR, semantic
  self-hosting, or KERN 5 completion.
