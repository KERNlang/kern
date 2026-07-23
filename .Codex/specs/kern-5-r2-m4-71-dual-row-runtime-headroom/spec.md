# KERN 5 R2 M4.71 — Dual-Row Structural Runtime Headroom

**Status:** IMPLEMENTED — REVIEW GREEN, PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.70 commit
`5e4607de408043c90846698ae8a19a4591a6cdb0` freezes the exact current
25-function residual frontier and recommends candidate profile 31/53/388.
The selected cohort is exactly one legacy-parameter canonicalizer function
with 14 parameter rows.

[DECIDED] M4.71 is evidence-only. It authenticates the exact structural runtime
floor for that counterfactually migrated function through the public
`kern.runtime.handler.v1` boundary. It does not change the active 30/50/388
profile, KERN source, generated consumers, parser, runtime, KIR, ABI, package
versions, or public APIs. It cannot authorize a profile promotion or a KERN 5
completion claim.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`5e4607de408043c90846698ae8a19a4591a6cdb0`.

[VERIFIED] The immutable M4.70 handoff is:

- receipt SHA-256
  `2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401`;
- input commit `e5069dc45a9d849ce02dbdc047cdfb78d0c55270`;
- assignment digest
  `42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685`;
- selected limits 31 node rows, 53 property rows, and 388 value rows;
- one function in tool `canonicalizer` and 14 total parameter rows;
- unchanged production collection ceiling 65,536 and KIR depth 64; and
- active profile remains 30/50/388 before any later promotion.

## Witness Contract

| Witness | Params | Structural rows | Required reasons |
|---|---:|---:|---|
| `canonicalizer-statement-helpers.kern#1:validstatementlist` | 14 | 31/53/370 | `profile.rows.nodes`, `profile.rows.properties` |

[DECIDED] The witness is parsed from its authenticated handwritten source and
counterfactually migrated with `migrateLegacyFunctionForPrerequisite`. The
migrated function is structurally encoded and decoded, flattened, and executed
through the public runtime handler with exact candidate limits 31/53/388.

[VERIFIED] Bound source SHA-256 values before implementation are:

- statement-helper source
  `adfa0c49cee230106ba7cff2249a0306f98aefc009d7e2581a3ffc622f6e9ff7`;
- canonicalizer composite
  `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
- canonicalizer policy JSON
  `63f5cfdbf980ed1300bbe3a4d6be1e8409dc20ed9c51b13b1873ebafcd186826`;
- composition JSON
  `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`;
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`;
  and
- M4.70 published baseline implementation digest
  `fd676b3f50986582e76ee96ea93df91d02f36772234770359f35a2bcf5546251`.

## Headroom Contract

[DECIDED] The promotion budget remains policy-derived as three quarters of the
65,536 production ceiling: 49,152 steps, preserving 16,384 reserved production
headroom. The witness floor must be found by monotonic runtime execution rather
than estimated or selected to fit the budget.

[DECIDED] M4.71 must prove:

1. exact M4.70 receipt, selection, assignment, source, and active-profile
   identity;
2. exact counterfactual migration to 14 direct parameters and 31/53/370 rows;
3. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
4. execution at `exactFloor` succeeds with no diagnostics or events;
5. returned source reparses and structurally encodes byte-identically;
6. the exact floor is no greater than 49,152;
7. promotion and production headroom are exact arithmetic; and
8. module-envelope admission remains explicitly outside this structural claim.

[VERIFIED] Repository measurement found the exact runtime floor at 36,193:
36,192 fails with the canonical `unsupported-runtime-input` envelope and
36,193 succeeds. This leaves 12,959 steps below the 49,152 promotion budget and
29,343 steps below the 65,536 production ceiling. The successful result
reparses and structurally encodes byte-identically. Module-envelope admission
remains explicitly unclaimed.

## Implementation Plan

1. Add a focused test importing the absent M4.71 receipt module and capture RED.
2. Freeze the one witness and exact measured floor only after the direct
   floor-minus-one/floor proof above.
3. Implement canonical format `kern.kir-canonicalizer.dual-row-headroom.2`
   using M4.67's live evidence writer/loader/validator contract, including
   plain tree-only data and regular-file/non-symlink enforcement.
4. Add mutation, decorated/shared-data, M4.70-history, fresh-process, status,
   terminal-checker, and exact runtime-boundary tests.
5. Regenerate authenticated current summaries after all `.mjs` edits and run
   focused, standalone canonicalizer, and complete Node 22 fitness gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.70 commit `5e4607de`.
- [x] Exact M4.70 selection and witness assignment are grounded.
- [x] RED fails at the intended missing M4.71 receipt boundary with
      `ERR_MODULE_NOT_FOUND`.
- [x] The exact floor is verified at 36,192 failure and 36,193 success.
- [x] Output round-trips to byte-identical structural KIR.
- [x] Exact floor is below the 49,152 promotion budget by 12,959 steps.
- [x] Receipt is canonical, source-bound, regular-file-only, and tree-only.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product or profile surface is authorized to change.
- [x] Focused gates, complete canonicalizer, terminal checker, and complete
      Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Verification Evidence

[VERIFIED] The repository writer produced canonical M4.71 receipt SHA-256
`8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12`.
After all first-pass `.mjs` bytes settled, the current coverage implementation
digest is
`5991165c547f3f181ea96d28e5436e5784f0a2fa60b8292620ff8c734b68ed99`.
The coverage-summary and prerequisite-summary SHA-256 values are
`52401e96560dc7a8a16dde32e831e9c759108a9215a8458fc013fded38a6e30a`
and `df249f6d580dacf82373fb804d6f29a3303fb476cfa9a357310712fc38073ee9`.

[VERIFIED] Receipt/status tests passed 21/21, the exact terminal checker passed,
and the direct runtime proof passed both tests. Runtime execution at 36,192
returned the canonical `unsupported-runtime-input` envelope; 36,193 returned
success with no diagnostics or events and byte-identical structural KIR.

[VERIFIED] The complete canonicalizer gate passed 268/268 Node tests plus 55
golden/idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 235 hostile fixtures. Its terminal coverage evidence includes
the exact M4.71 one-witness floor and M4.72 dual-row promotion handoff.

[VERIFIED] The complete Node 22 release wall exited zero with terminal marker
`KERN 5 current fitness wall passed.` Its outer final canonicalizer rerun again
passed 268/268 Node tests plus the same 55 golden/idempotence/KIR, eight
measured-witness, three profile-limit, and 235 hostile fixtures.

## Review Evidence

[VERIFIED] Agon review `review-1784835392101-8g7emr` routed all 6/6 usable
reviewers at high risk with automatic roles. Consensus contained zero verified
findings, four needs-check items, one speculative item, and nine nits. Security
and one overall reviewer returned no findings.

[DECIDED] No review-driven code change is warranted. Caching the loader would
weaken same-process integrity by hiding receipt or source drift after the first
load; the synchronous evidence reads are bounded build/test work. Extracting
shared receipt or formatter machinery would couple historical milestone proofs
and widen this evidence-only slice. The singular status text is exact because
the immutable M4.71 receipt fixes `witnessCount` at one. The suggested compiled
codec mismatch is factually inapplicable: M4.55 and M4.67 use the same
`packages/core/src/kir-structural/canonical.ts` source anchor and exact
`04ec8bde...` digest. Remaining nits preserve intentional ordinal witness
identity, canonical key order, strict plain prototypes, independent terminal
cross-pins, tracked specification history, and writer-generated summary bytes.
No material dependency remains unresolved.

## Stop Conditions

- M4.70 digest, input commit, selection, assignment, or source bytes drift.
- The selected function no longer counterfactually migrates to exactly
  31/53/370 rows with 14 parameters.
- Runtime success is not monotonic at the measured collection boundary.
- The exact floor exceeds 49,152 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, ABI, or any
  historical receipt.

## Out of Scope

- Promoting `maxNodeRows` from 30 to 31 or `maxPropertyRows` from 50 to 53.
- Migrating the selected 14 parameter rows.
- Claiming module-envelope admission, release readiness, stable KIR, semantic
  self-hosting, or KERN 5 completion.
