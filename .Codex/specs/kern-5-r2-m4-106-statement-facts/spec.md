# KERN 5 R2 M4.106 — Consolidated Statement Facts

**Status:** VERIFIED FOR PUBLICATION
**Date:** 2026-07-27
**Confidence:** 0.98

## Objective

[VERIFIED] Published M4.105 records a 13,678-iteration deficit above the
49,152 promotion budget. At that boundary, validation has started 76
`propid`, 49 `propcount`, 51 `childcount`, and 50 `childat` executions while
statement emission has not started.

[DECIDED] M4.106 will replace repeated statement-only property and child-count
lookups with one memoizable KERN helper. It will not change the runtime,
handler ABI, runtime limits, active profile, or candidate-profile limits.

## Published Input

[VERIFIED] This slice starts from published M4.105 commit
`80c67172d02cc4983855874aa29098a770820953`.

[VERIFIED] M4.105 receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-105.json` has SHA-256
`06538ef420d2374ecf39f5b12d775189c73cfa11a66a3ef460cf795c273db7e0`.

[VERIFIED] The exact M4.105 witness is
`examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement`
with 14 parameter rows and a 89/125/2100 structural profile.

## Safety Contract

[VERIFIED] `tablesok` authenticates equal table lengths, property-node order,
property ownership, parent-before-child order, unique sibling order, and value
ownership before statement validation begins.

[VERIFIED] `statementtablefacts` builds the authenticated flattened table, and
`statementfacts` returns the fixed positional `number[]` view:

1. direct child count;
2. property count;
3. `value` property id;
4. `name` property id;
5. `target` property id;
6. `cond` property id;
7. `from` property id;
8. `to` property id.

[VERIFIED] A duplicate recognized property stores `-1`, preserving `propid`'s
duplicate rejection. Unknown properties still increase the property count, so
every existing exact-count check continues to reject extras.

[VERIFIED] `statementtablefacts` makes one bounded node-table initialization
pass and one bounded property-table collection pass. Validation and emission
use identical helper arguments, so the runtime can reuse the complete
authenticated projection without rescanning either table.

[VERIFIED] Generic function/parameter/handler validation retains `propid`,
`propcount`, and `childcount`; this slice changes statement access only.

## Implementation Plan

1. Add RED source-contract tests for the single-pass fact layout, duplicate
   sentinels, and exclusive statement validation/emission use.
2. Implement `statementtablefacts` and its fixed-width `statementfacts` view
   in the expression-helper member.
3. Replace statement validation and emission property/count calls with indexed
   facts, preserving every semantic branch and expression check.
4. Regenerate and authenticate the composed KERN source.
5. Measure the exact adjacent runtime boundary and freeze an immutable M4.106
   receipt.
6. Update derived coverage/status artifacts without promoting the profile.
7. Run the full Node 22 fitness wall and mandatory high-risk role review, then
   fetch, rebase, and push the signed slice once to `main`.

## Acceptance Criteria

- [x] RED source-contract test fails before implementation.
- [x] `statementtablefacts` owns exactly two KERN `for` loops.
- [x] Duplicate known keys preserve the `-1` rejection sentinel.
- [x] Unknown properties remain counted and rejected by exact-count checks.
- [x] `validstatementlist`, `validstatement`, `emitstatementlist`, and
      `emitstatement` use the consolidated facts.
- [x] Statement helpers contain no `propid`, `propcount`, or `childcount`
      call.
- [x] The exact witness still fits within 89/125/2100 candidate limits.
- [x] Canonical golden, hostile, idempotence, and byte round-trip results stay
      unchanged.
- [x] The adjacent successful runtime floor is at or below 49,152.
- [x] Runtime/KIR/ABI limits and active profile remain unchanged.
- [x] Independent review passes without an unresolved blocker.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Verified Result

[VERIFIED] The exact candidate fails at 39,015 and byte-roundtrips at 39,016.
That reduces the M4.105 floor of 62,830 by 23,814 iterations and leaves 10,136
iterations of headroom under the 49,152 promotion budget.

[VERIFIED] The successful run executes `statementtablefacts` once, with zero
rollback and zero parent restart. The frozen M4.106 receipt digest is
`827525373e1716137b53e322c913ec7dcb4f8ea0cd12dc1d8d77605c692a886a`.

[VERIFIED] The composed canonicalizer is 59,417 bytes with SHA-256
`c68131992b98a4c2a78b9404f537180e1959e88a3116d5513d989ea7a1418f47`.
Coverage is 91/111 base-complete with the same 16 `fn.params` blockers.

[VERIFIED] The complete canonicalizer suite passes 458/458 Node tests, 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` repository wall passes.

[VERIFIED] High-risk role review routed across all 6 usable Agon engines. The
only reported blocker incorrectly claimed the dedicated M4.106 test file was
absent; that file pins the receipt digest and reproduces both adjacent runtime
observations. Valid maintenance findings were resolved by separating historical
and live migration targets and restoring exact 91/111 frontier assertions.
The 48-test review-fix set and complete 458-test canonicalizer wall pass.

## Stop Conditions

- The exact witness exceeds any candidate-profile row limit.
- A duplicate or unknown property changes acceptance behavior.
- Any golden, hostile, idempotence, or byte-roundtrip result changes.
- The optimization requires a runtime intrinsic, limit, or ABI change.
- The measured floor remains above the promotion budget.

## Out of Scope

- Candidate-profile promotion or parameter migration.
- Replacing generic document/function property access.
- Runtime cache, collection-limit, or handler changes.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.
