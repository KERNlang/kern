# KERN 5 R2 M4.25 — Binding Promotion and Parameter-Ready Remeasurement

**Status:** REVIEWED — PUBLICATION READY
**Date:** 2026-07-21
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published `origin/main` commit
`e59f9c2d1b8f11bc730a0ea05abaca21a311865c` contains the reviewed M4.24
binding canonicalizer. Its authenticated composite is 39,340 bytes at SHA-256
`fbc7cd4a38910b7fb4f97ce6b4ebb843da0ebc4543d069958652e40932e54fa8`
and the complete KERN 5 fitness wall plus terminal review pass on that exact
implementation tree.

[VERIFIED] Immutable M4.23 prerequisite provenance
`00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`
authenticates binding as the exact singleton causal input: five functions,
two tools, nine counterfactual structured-parameter rows, six catalog facts,
and 801 occurrences in the sealed prerequisite snapshot. M4.24 live
remeasurement reports 852 occurrences because the implementation member now
contains binding nodes, without changing the frozen promotion input.

[DECIDED] Promote the exact M4.24 direct-binding family into cumulative
coverage profile M4.25 through the immutable M4.23 prerequisite record.
Remeasure base-only parameter readiness and residual structural ranking, but
do not migrate any function signatures in this slice.

## Current State and Root Cause

[VERIFIED] The published M4.24 baseline profile M4.21 promotes binary,
conditional, call, member, index, and default-step counted iteration. Binding
is its first active family and counted iteration is its implementation pointer.

[VERIFIED] M4.24 proves exactly two statement shapes: `let` with required
`name` and `value`, and direct `assign` with required `target` and `value`.
Both reject children and optional/future properties. Let names use structural
identifier semantics. Assignment targets recurse through the expression base
but their root kind is restricted to identifier, member, or index.

[DECIDED] Promotion must encode those exact local rules in the cumulative
profile. Merely adding `assign` and `let` to base node kinds would incorrectly
admit call/binary/list assignment roots and optional catalog metadata.

## Promotion Contract

| Behavior | Contract | Tag |
|---|---|---|
| Policy format | remain `kern.kir-canonicalizer.coverage-policy.3` | VERIFIED |
| Base identity | advance to `kern.kir-canonicalizer.profile.m4.25` | DECIDED |
| Promotion row | append binding with M4.23 digest and `prerequisite` kind | DECIDED |
| Base nodes | add sorted `assign` and `let`; preserve every prior node | DECIDED |
| Base properties | add only `assign.target`, `assign.value`, `let.name`, and `let.value` as admitted binding facts | DECIDED |
| Let profile | exact two-property leaf; structural identifier name; recursively promoted value | DECIDED |
| Assign profile | exact two-property leaf; identifier/member/index target root; recursively promoted target and value | DECIDED |
| Active families | remove binding; preserve do, exception, unary, and while in current order | DECIDED |
| KERN executable | remain byte-identical to published M4.24 | DECIDED |
| Provenance history | preserve all selection and prerequisite records byte-for-byte | DECIDED |
| Implementation pointer | become the binding prerequisite promotion | DECIDED |
| Parameter migration | remeasure only; no source signature edits | DECIDED |

## Exact Binding Base Profile

[DECIDED] A base `let` node has no children and contains exactly `name` and
`value`. `name` matches the existing structural identifier grammar
`[A-Za-z_$][A-Za-z0-9_$]*`; `value` must project and complete recursively under
the promoted expression base. `kind`, `trailingComment`, host `type`/`expr`,
missing properties, duplicates, and future properties remain blockers.

[DECIDED] A base `assign` node has no children and contains exactly `target`
and `value`. Both expressions must project and complete recursively, and the
target's canonical root kind must be identifier, member, or index. `op`,
`trailingComment`, missing properties, duplicates, future properties, and
call/binary/list/literal targets remain blockers.

[VERIFIED] Existing statement sequencing already rejects children on
non-container statements and preserves orphan-else/trailing-return rules. The
binding profile adds only binding-local property, identifier, and target-root
validation.

## Remeasurement Contract

[DECIDED] Reuse format-2 prerequisite partitioning unchanged:

1. counterfactually migrate exact legacy parameter pairs;
2. record functions that complete under the M4.25 base alone in
   `parameterMigration`;
3. exclude those witnesses from residual active-family closure ranking;
4. require the parameter-ready and residual witness partitions to remain
   disjoint and exhaustive.

[INFERRED] The five M4.23 binding witnesses should become the next exact
parameter-ready tranche at two tools and nine rows. This is not accepted as a
release fact until regenerated live measurement reproduces it. Residual
ranking and the next prerequisite are likewise measurement outputs, not a
forecast.

## Options

| Approach | Result | Decision |
|---|---|---|
| Promote nodes without local profile rules | over-admits assignment roots and optional metadata | Reject |
| Cite M4.24 live receipts as promotion provenance | replaces the immutable causal handoff with implementation drift | Reject |
| Promote through exact M4.23 prerequisite | preserves causal provenance and executable sequencing | Select |
| Migrate the nine parameter rows now | conflates capability promotion with source migration | Reject |
| Re-rank before base-only partition | falsely credits ready functions to an unrelated residual family | Reject |

## RED and Mutation Plan

[DECIDED] First extend tests to require profile M4.25, the exact binding
promotion, binding-family removal, binding implementation provenance, and the
exact local profile. Run against sealed M4.24 and capture failure at the old
profile/promotion state before production policy/profile edits.

[DECIDED] Mutation coverage rejects missing, duplicated, reordered, or
mistyped binding provenance; reintroduced binding overlap; missing/extra
binding properties; children; malformed let names; optional/future metadata;
unsupported expressions; and non-assignable target roots.

[DECIDED] Regenerated coverage and prerequisite summaries must preserve the
M4.24 executable digest, corpus membership, profile limits, family registry,
all historical records, and the 104-function/four-tool denominator.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared promotion and remeasurement contract |
| `coverage-policy.json` | modify | M4.25 base, binding promotion, active-family removal |
| `coverage-profile.mjs` | modify | exact let/assign base profile |
| `coverage-promotion.test.mjs` | modify | RED, provenance, overlap, and binding mutations |
| prerequisite/coverage/handoff tests | modify | exact live M4.25 partition and pointer |
| coverage check command | modify | pin exact M4.25 release facts |
| coverage/prerequisite summaries | regenerate | authenticated post-promotion measurement |
| release train | modify | durable M4.25 evidence |

## Acceptance Criteria

- [x] Fresh branch starts from exact published M4.24 `origin/main`.
- [x] M4.24 executable, M4.23 provenance, M4.21 profile, and binding family
      are grounded in current source.
- [x] RED fails first on sealed M4.24 profile/promotion state.
- [x] Binding promotion cites the exact immutable M4.23 prerequisite and
      becomes the implementation pointer.
- [x] Exact let/assign profile is mutation-killed without widening M4.24.
- [x] Binding is removed from active families while remaining families keep
      their existing relative order.
- [x] Base-only parameter readiness and residual ranking are regenerated from
      live authenticated facts and pinned exactly.
- [x] KERN composition, corpus membership, family registry, profile limits,
      and every historical provenance record remain exact.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster high-risk terminal review has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the fresh feature ref and explicitly authorized `main`.

## Stop Conditions

- Promotion requires changing KERN source, structural KIR, parser behavior,
  runtime ABI, corpus membership, family registry, or historical provenance.
- The exact M4.23 digest cannot authenticate the binding promotion.
- The promoted profile accepts a form rejected by the M4.24 canonicalizer or
  rejects an admitted M4.24 binding form.
- Parameter-ready and residual witness partitions overlap or fail to exhaust
  the migrated live facts.
- No honest residual completing closure remains after binding promotion.

## Out of Scope

- Editing any KERN function signature or migrating parameter rows.
- Implementing or promoting do, exception, unary, or while families.
- Assignment operators, destructuring, declaration metadata, or host types.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion
  claim.

## Deploy Order

[DECIDED] Ship promotion policy, exact profile, regenerated receipts, tests,
spec, and release evidence atomically after focused/full gates and independent
review. Immediately before the only push, fetch and rebase onto `origin/main`;
publish the fresh feature ref and explicitly authorized `main` with
`--no-verify`, verify both remote hashes, fetch again, and start M4.26 from a
new branch based on `origin/main`.

## Current Evidence

[VERIFIED] The exact binding promotion advances the cumulative base to
`kern.kir-canonicalizer.profile.m4.25`, appends immutable M4.23 prerequisite
digest `00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`,
removes binding from the active families, and makes binding the implementation
pointer. The remaining family order is do, exception, unary, and while.

[VERIFIED] The KERN executable remains byte-identical at 39,340 bytes and
SHA-256
`fbc7cd4a38910b7fb4f97ce6b4ebb843da0ebc4543d069958652e40932e54fa8`.
The policy, coverage-summary, and prerequisite-summary file SHA-256 values are
`4b8888e4e1f64b8356949f1b823f80e5a84c0594b1a864cdd7804d805ac13991`,
`377d43bdf852e7981c0a6ca80927c862700982833df7b14de7d2b1e2f3e6c0df`,
and
`e62f14054d00cf76ca0e362c88b453a9777d415a9c131f16f38602580f530260`.

[VERIFIED] Live remeasurement stays 27/104 base-complete with 75 legacy
`fn.params` blockers and no ordinary winner. The exact M4.23 witness set now
forms the base-only parameter-ready partition: five functions across two tools
and nine rows. Residual ranking selects unary expression as a one-family
prerequisite at 48 occurrences; its one witness is `numberat`, with two
parameter rows. The partitions are disjoint.

[VERIFIED] The focused Node 22 gate passes composition and semantic checks,
all 88 structural/authentication/profile tests, 40 exact
golden/KIR/idempotence fixtures, eight measured witnesses, three profile-limit
fixtures, 202 hostile fixtures, and the final exact coverage check.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the final
implementation tree. It covers every workspace, release-policy, and
infrastructure gate; 432/432 cross-target fixtures; 109/109 class fixtures;
233/233 native fixtures at 100% coverage; 40 whole-app fixtures across three
legs; runner/browser budgets; checker, validator, KIR, runtime, ownership, and
convergence contracts; and the repeated canonicalizer gate with the exact
M4.25 receipts.

[VERIFIED] Terminal Agon review run
`review-1784631411129-sr8uax-kern-5-r2-m4-25-binding-promotio` completed with
the exact `claude,codex,agy` roster: 3/3 engines succeeded and reported zero
verified, needs-check, speculative, or nit findings.
