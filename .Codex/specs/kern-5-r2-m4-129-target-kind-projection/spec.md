# KERN 5 R2 M4.129 — Assignment-Target Kind Projection

**Status:** IMPLEMENTED AND VERIFIED — READY TO SHIP
**Date:** 2026-07-29
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.128 commit
`01f3a8156bdc8136b0f3a13ba5a0a968be7ec308` attributes 8,986 retained
iterations at the 54,894 exact floor to two complete `recordfield` scans over
the 4,493-row value table during assignment-target validation.

[VERIFIED] Removing those scans without adding another table-wide pass measures
an exact floor of 45,908 and 3,244 iterations of headroom below the 49,152
promotion budget.

[DECIDED] M4.129 will reuse the existing memoizable `typefields` projection for
assignment-target kind authentication. It will preserve canonical output,
hostile-input rejection, exported helper behavior, runtime/handler ABI,
KIR/profile/runtime limits, signatures, corpus topology, and cumulative
coverage.

## Current Boundary

[VERIFIED] M4.128 receipt SHA-256 is
`55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac`.

[VERIFIED] The exact witness is
`examples/selfhost-validator/validator.kern#20:validate` under combined KIR
limits 273051/98/5313 and table profile 202/308/4493.

[VERIFIED] The promotion-budget failure enters `recordfield` for the second
assignment target and emission has not started. The exact-floor success enters
`recordfield` twice, so successful validation performs exactly
`2 * 4,493 = 8,986` attributable iterations.

[VERIFIED] M4.117 already introduced `typefieldtablefacts`, which authenticates
and memoizes every `record:kind` id in a single table-wide pass. `typefields`
provides the fixed-width view for one record without another value-table scan.

[VERIFIED] `validstatement` separately calls `recordfield(targetId, "kind",
...)`, reads the text kind, restricts it to `identifier`, `member`, or `index`,
and only then calls `exprsource` for the target and assigned value.

## Contract

| Behavior | Tag |
|---|---|
| Bind the exact M4.128 receipt and published input commit | DECIDED |
| Preserve exported `exprsource` signature and return behavior | DECIDED |
| Preserve exported `expressionsources` signature and ordered output | DECIDED |
| Preserve `expressionsources == []` for malformed table topology | DECIDED |
| Preserve assignable roots: identifier, member, and index only | DECIDED |
| Preserve rejection of non-assignable and malformed expression roots | DECIDED |
| Reuse the existing `typefieldtablefacts` result without adding a table-wide pass | DECIDED |
| Remove both assignment-validation `recordfield` executions | DECIDED |
| Preserve observer-on/off envelope parity and exact roundtrip | DECIDED |
| Publish measured floor and promotion headroom, not a projected estimate | DECIDED |

## Design

### Existing authenticated projection

`typefieldtablefacts` remains the sole table-wide owner. It authenticates each
type record and publishes the `kind`, `name`, and `data` field ids in
fixed-width slots. `typefields` reads the three slots for one record.

M4.129 adds no helper, function, or loop. The assignment branch calls
`typefields(targetId, valueParent, valueRole)` and reads the authenticated kind
id from slot 1. Existing pure-helper memoization reuses the projection already
needed by canonicalization.

### Statement validation

The assignment branch replaces only the standalone `recordfield` kind lookup
with `typefields` plus the fixed kind slot. The existing kind text/allowlist and
the target/value `exprsource` calls remain unchanged.

## Alternatives

### Pair kind with expression source

Rejected after implementation evidence: adding private projection helpers
changed function count and ordinals, invalidating frozen corpus/coverage
identities despite preserving semantics. The existing type-field projection
already owns the authenticated fact needed here.

### Change `expressionsources` to return paired facts

Rejected: it would break an exported helper contract and hostile-table
semantics merely to optimize an internal consumer.

### Parse assignability from canonical source text

Rejected: source syntax is not the authenticated structural kind and could
conflate nested member/index forms with non-assignable roots.

### Add a second target-kind table projection

Rejected: it replaces two scans with another full scan instead of reusing the
already authenticated type-field projection.

### Add runtime caching or an intrinsic

Rejected: existing pure-helper memoization is sufficient; runtime and ABI
changes are unnecessary.

## Implementation Plan

1. Add a source-contract RED test proving assignment validation still calls
   `recordfield`.
2. Replace the lookup with `typefields` slot 1 while retaining the existing
   allowlist and recursive expression validation.
3. Regenerate the composed canonicalizer and composition record; preserve
   historical executable identities through explicit source reconstruction.
4. Convert M4.127/M4.128 live pre-optimization evidence to authenticated
   archival evidence where required.
5. Measure adjacent failure/success boundaries, observer parity, exact loop
   attribution, and canonical roundtrip.
6. Freeze the M4.129 receipt and central status, converge derived summaries
   twice, run full fitness and high-risk review, then fetch/rebase and push
   once.

## Acceptance Criteria

- [x] RED proves assignment validation still performs a standalone
      `recordfield` scan.
- [x] `validstatement` calls `typefields` and reads its authenticated kind id
      from slot 1.
- [x] No new helper, function, table-wide loop, or corpus ordinal is introduced.
- [x] Exported `typefields`, `exprsource`, and `expressionsources` behavior is
      unchanged.
- [x] Assignable identifier/member/index roots remain accepted.
- [x] Non-assignable and malformed roots remain rejected.
- [x] The exact witness executes `typefieldtablefacts` once and `recordfield`
      zero times during the measured canonical path.
- [x] Observer-on/off envelopes are deeply equal at failure and success.
- [x] Exact success structurally roundtrips at or below 49,152 iterations.
- [x] M4.127 and M4.128 receipts remain byte-identical archival evidence.
- [x] No runtime, ABI, policy, KIR/profile limit, signature, corpus, generated
      tool, or cumulative-coverage behavior changes.
- [x] Focused and complete canonicalizer gates pass (587/587 tests plus 55
      golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
      fixtures, and 235 hostile fixtures).
- [x] Full KERN 5 fitness gate passes.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Review Triage

[VERIFIED] The six-engine role-lens review completed 6/6 at
`review-1785335655502-fp39c6-m4-129-terminal` with no blocking finding.

[DECIDED] The cold standalone `validstatement` path's one additional table pass
is an accepted bounded tradeoff: the production canonical path reuses the
already-warm authenticated projection and removes 8,986 retained iterations.
Adding a second validation variant would violate this slice's frozen
function-topology contract.

[DECIDED] The exact-boundary replay remains in the default evidence suite. Its
four executions are the oracle that binds failure, success, observer parity,
and roundtrip to the published receipt; moving it outside full fitness would
weaken the release gate.

[DECIDED] Historical reconstruction remains milestone-explicit in this slice.
The suggested DRY refactors alter evidence infrastructure without changing the
M4.129 result and are deferred outside this narrowly scoped optimization.

## Stop Conditions

- The type-field reuse changes exported helper output.
- Malformed expression topology no longer returns the historical sentinel.
- Any accepted/rejected assignment-target oracle changes unexpectedly.
- The canonical path executes a new table-wide loop or changes function
  topology.
- `recordfield` remains reachable from assignment validation.
- The measured exact floor exceeds the 49,152 promotion budget.
- The optimization requires runtime, ABI, policy, profile, or KIR-limit changes.

## Out of Scope

- Promoting the combined KIR/profile candidate or migrating `validate`.
- Removing `recordfield` from typefield out-of-range compatibility behavior.
- Raising any runtime, KIR, or profile limit.
- Canonical text-character or unknown-expression-kind implementation.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or a KERN 5 completion claim.
