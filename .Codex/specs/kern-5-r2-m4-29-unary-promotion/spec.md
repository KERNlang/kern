# KERN 5 R2 M4.29 — Unary Promotion and Parameter-Ready Remeasurement

**Status:** READY TO PUBLISH — FULL LOCAL WALL AND REVIEW PASSED
**Date:** 2026-07-21
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published origin/main commit
0fe62bed0ab3a37b634da48361137adba378ec5a contains the reviewed M4.28
unary-expression canonicalizer. Its authenticated composite is 40,414 bytes
at SHA-256
178f9ad3e90cae8de9aa3ee5963dfc6a1acd5c70853ac7904c6228548a1e251a,
and its 23,666-byte handwritten main member is
5472494a26004621d1ac76b0571432462c74da88563e4e3fca9ca7a2394a42e2.

[VERIFIED] Immutable M4.27 prerequisite provenance
e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5
authenticates unary expression as the exact singleton causal input: one
function, one tool, two counterfactual structured-parameter rows, one catalog
fact, and 48 occurrences in the sealed prerequisite snapshot. M4.28 live
remeasurement reports 49 occurrences because the implementation member now
contains one unary-family fact, without changing the frozen promotion input.

[DECIDED] Promote the exact M4.28 unary family into cumulative coverage profile
M4.29 through the immutable M4.27 prerequisite record. Remeasure base-only
parameter readiness and represent the measured absence of a residual
structural prerequisite, but do not migrate any function signature in this
slice.

## Current State and Root Cause

[VERIFIED] The published M4.28 baseline remains profile M4.25. It promotes
binary, conditional, call, member, index, counted iteration, and binding.
Unary remains the third active family and binding remains the implementation
provenance pointer.

[VERIFIED] M4.28 proves exactly four parser-portable unary operators: !, -, ~,
and typeof. Unary values contain exactly argument and op fields, recursively
canonicalize the argument, reject negative zero and every unsupported
operator, and emit universally grouped source.

[DECIDED] Promotion must encode those exact local rules in the cumulative
profile. Merely adding unary to base expression kinds would incorrectly admit
the structural catalog's additional + and void operators and would lack an
explicit local-profile proof.

## Promotion Contract

| Behavior | Contract | Tag |
|---|---|---|
| Policy format | remain kern.kir-canonicalizer.coverage-policy.3 | VERIFIED |
| Base identity | advance to kern.kir-canonicalizer.profile.m4.29 | DECIDED |
| Promotion row | append unary-expression with M4.27 digest and prerequisite kind | DECIDED |
| Base expressions | add unary after text; preserve every prior kind | DECIDED |
| Unary shape | exact argument and op fields; recursive argument | DECIDED |
| Unary operators | admit only !, -, ~, and typeof | DECIDED |
| Negative zero | remain rejected by structural validation and local profile | DECIDED |
| Active families | remove unary; preserve do, exception, and while order | DECIDED |
| KERN executable | remain byte-identical to published M4.28 | DECIDED |
| Provenance history | preserve all selection and prerequisite records byte-for-byte | DECIDED |
| Implementation pointer | become the unary prerequisite promotion | DECIDED |
| Parameter migration | remeasure only; no source signature edits | DECIDED |

## Exact Unary Base Profile

[DECIDED] A base unary expression is a canonical two-field structural record
with argument and op. The argument must validate and complete recursively under
the cumulative promoted expression base. The op must be a text value equal to
!, -, ~, or typeof. Missing, duplicate, extra, malformed, +, void, and unknown
operators remain blockers.

[VERIFIED] Structural KIR validation already rejects canonical negative zero
when op is - and argument is integer zero. The cumulative profile must retain
that rejection before reporting the unary expression complete.

[DECIDED] The local profile should use structural validation for exact shape
and negative-zero rejection, then apply the narrower four-operator portable
allowlist. This keeps the policy aligned with the M4.28 executable rather than
with the broader structural parser catalog.

## Remeasurement Contract

[DECIDED] Preserve the existing prerequisite partitioning while advancing the
live summary to `kern.kir-canonicalizer.prerequisite-summary.3`:

1. counterfactually migrate exact legacy parameter pairs;
2. record functions that complete under the M4.29 base alone in
   parameterMigration;
3. exclude those witnesses from residual active-family closure ranking;
4. require the ready and residual partitions to remain disjoint and exhaustive;
5. evaluate all non-empty active-family closures before reporting bounded
   exhaustion.

[DECIDED] Format 3 is discriminated by `outcome`. A selected result retains a
positive `minimumFamilyCount`, non-null `selectedPrerequisite`, non-empty
rankings, and null `exhaustion`. The measured M4.29 result uses
`outcome: bounded-exhaustion`, `minimumFamilyCount: null`, null selection,
empty rankings, and a non-null exhaustion record. Zero must not encode the
minimum family count because the empty closure did not win.

[DECIDED] The exhaustion record authenticates scope `current-bounded-profile`,
the exact ordered active-family IDs, all seven non-empty closures evaluated,
zero completing closures, 69 residual functions, a derived reason census, and
a SHA-256 digest over the sorted per-function reason assignments. Historical
format-1/2 provenance remains byte-identical and retains selected-only
semantics.

[VERIFIED] Live M4.29 measurement makes the M4.27 unary witness the next exact
base-only parameter-ready tranche at one function, one tool, and two rows.
The remaining 69 counterfactual functions do not complete under any closure of
the active do, exception, and while families because independent profile-size
or projection blockers remain. Therefore the honest next action is parameter
migration, with no residual structural prerequisite selected. This is only
exhaustion under the current authenticated profile, registry, projection
rules, corpus, and limits; it is not a KERN 5 completion claim.

## Options

| Approach | Result | Decision |
|---|---|---|
| Add unary to the base list only | accepts + and void without a portable executable contract | Reject |
| Cite M4.28 live receipts | replaces immutable causal provenance with implementation drift | Reject |
| Promote through exact M4.27 prerequisite | preserves causal sequencing and byte identity | Select |
| Migrate numberat parameters now | conflates capability promotion with source migration | Reject |
| Predict the next family in source | turns measurement into a hardcoded claim | Reject |
| Encode null selection under format 2 | silently breaks selected-only consumers | Reject |
| Format 3 bounded-exhaustion outcome | preserves old semantics and authenticates terminal search | Select |

## RED and Mutation Plan

[DECIDED] First extend tests to require profile M4.29, the exact unary
promotion, unary-family removal, unary implementation provenance, and the
exact local profile. Run against sealed M4.28 and capture failure at the old
profile and promotion state before policy/profile edits.

[DECIDED] Mutation coverage rejects missing, duplicated, reordered, or
mistyped unary provenance; reintroduced unary overlap; missing and extra
fields; non-text operators; +, void, unknown operators; invalid recursive
arguments; negative zero; and future unary shapes.

[DECIDED] Regenerated coverage and prerequisite summaries must preserve M4.28
KERN bytes, corpus membership, profile limits, family registry, all historical
records, and the 104-function/four-tool denominator.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add and seal | shared promotion and remeasurement contract |
| coverage-policy.json | modify | M4.29 base, unary promotion, family removal |
| coverage-profile.mjs | modify | exact recursive unary base profile |
| coverage-promotion.test.mjs | modify | RED, provenance, overlap, unary mutations |
| coverage-prerequisite.mjs | modify | discriminated format-3 selection or bounded exhaustion |
| prerequisite, coverage, and handoff tests | modify | exact live M4.29 partition, terminal ranking, and pointer |
| coverage check command | modify | pin exact M4.29 release facts |
| coverage and prerequisite summaries | regenerate | authenticated post-promotion measurement |
| release train | modify | durable M4.29 evidence |

## Acceptance Criteria

- [x] Fresh M4.29 branch starts from published M4.28 origin/main commit
      0fe62bed0ab3a37b634da48361137adba378ec5a.
- [x] M4.28 executable, M4.27 provenance, M4.25 profile, and unary family are
      grounded in current source.
- [x] RED fails first on sealed M4.28 profile and promotion state.
- [x] Unary promotion cites exact immutable M4.27 prerequisite provenance and
      becomes the implementation pointer.
- [x] Exact recursive four-operator profile is mutation-killed without
      widening M4.28.
- [x] Unary is removed from active families while remaining families preserve
      relative order.
- [x] Base-only parameter readiness and the absence of a residual structural
      prerequisite are regenerated from live authenticated facts and pinned
      exactly.
- [x] Format-3 exhaustion proves three active families, seven evaluated
      non-empty closures, zero completing closures, and 69 residual functions
      with a derived census and assignment digest.
- [x] KERN composition, corpus, family registry, profile limits, and all
      historical provenance records remain exact.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete pnpm fitness:kern-5 wall passes.
- [x] Full usable-roster review has no unresolved material finding.
- [ ] Signed commit is fetched and rebased before one atomic no-verify push to
      the fresh feature ref and explicitly authorized main; both refs verify.

## Stop Conditions

- Promotion requires changing KERN source, structural KIR, parser behavior,
  runtime ABI, corpus membership, family registry, or historical provenance.
- The exact M4.27 digest cannot authenticate unary promotion.
- The promoted profile accepts a form rejected by M4.28 or rejects an admitted
  M4.28 unary form.
- Parameter-ready and residual witness partitions overlap or fail to exhaust
  migrated live facts.
- The receipt invents a residual family despite the measured empty closure or
  reports exhaustion without evaluating every non-empty active-family closure.
- Any release text broadens bounded-profile exhaustion into KERN 5 completion.

## Out of Scope

- Editing any KERN function signature or migrating numberat parameter rows.
- Implementing or promoting do, exception, or while families.
- Unary +, void, await, new, spread, assertion, or non-null expressions.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Deploy Order

[DECIDED] Ship promotion policy, exact profile, regenerated receipts, tests,
spec, and release evidence atomically after focused and full gates plus
independent review. Immediately before the only push, fetch and rebase onto
origin/main; publish the fresh feature ref and explicitly authorized main with
no-verify, verify both hashes, then start the next slice from a fresh branch
based on origin/main.

## Current Evidence

[VERIFIED] Published M4.28 passes the focused 92-test gate, 48 exact
golden/KIR/idempotence fixtures, eight measured witnesses, three profile-limit
fixtures, 218 hostile fixtures, exact 32/104 coverage with 70 legacy blockers,
and the complete KERN 5 fitness wall.

[VERIFIED] Published M4.28 policy, coverage-summary, and prerequisite-summary
SHA-256 values are
33680d7f1aefebb4efa3bc8c40102f2669436042677779627807ed0274357cb6,
d1e3f21ca3efab4f28aff136e83e1fedd3f52e8e7c7d374d4a1f4fa40043e9c4,
and fabfd3b802db25c0788e6f46582f471a8860bf54a02c8c4d23dc67e4b5aa2ac7.

[VERIFIED] RED reports the old M4.25 profile, missing eighth promotion row, and
missing narrow unary-operator ownership. After policy/profile implementation,
all ten targeted promotion tests pass.

[VERIFIED] Exhaustion trace counterfactually migrates all 70 legacy-parameter
functions: `numberat` alone completes the base; none of the other 69 completes
with do, exception, and while together. Residual reasons include 53 value-row,
27 node-row, 23 property-row, and 14 projection-depth blockers plus isolated
authenticated exclusions; counts overlap by function.

[VERIFIED] Mandatory confidence-gate brainstorm
`brainstorm-1784645342548-1oulrm-kern-5-m4-29-prerequisite-exhaus` completed
6/6. The initial format-2/null plan changed to an explicit format-3
bounded-exhaustion discriminator with null rather than zero closure count and
authenticated terminal-search evidence.

[VERIFIED] Final policy, coverage-summary, and prerequisite-summary SHA-256
values are
`d2bee244fce9cfeae7c3fe327bcdbc694bac1b631c910d7a459dd3a79a4de636`,
`8c31aeb81b5523899eb66ac771e783fadb28f8a2102c5a6d0eb4632008b5c082`,
and `d1d44548a3d332489ce17ac55ca69bd89e196d48373f03f58416ca7617948821`.
The authenticated coverage implementation digest is
`b8d6102c904311628111720d5383c2f75989cbf22e76dd4106acad7f14635cba`.
The focused Node 22 gate passes 95/95 tests, 48 exact runtime fixtures, eight
measured witnesses, three profile-limit fixtures, 218 hostile fixtures, and
the exact canonical receipt check.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the exact
M4.29 tree. It covers repository consistency, lint, all workspace builds and
tests, release policy, cross-target conformance, 233 native contracts at 100%
coverage, whole-app Express/FastAPI behavior, drift showcase, browser budgets,
capstone checker and validator parity, KIR/runtime/ownership/convergence
contracts, diff hygiene, and the repeated terminal canonicalizer gate at
95/95 plus 48/8/3/218 with the exact bounded-exhaustion receipt.

[VERIFIED] Initial high-risk role-lens review
`review-1784648104213-k92ywc-kern-5-r2-m4-29-unary-promotion` completed 6/6.
It found two material contract-hardening gaps: format-3 authentication did not
yet bind every baseline, witness, and policy field exactly, and the generic
provenance consumer had not admitted format 3. Both were fixed and covered by
mutation and handoff tests before the final wall. Exact-final high-risk
role-lens review
`review-1784651102229-a55dcn-kern-5-r2-m4-29-exact-final` then completed 6/6
with zero verified, needs-check, or speculative findings. Fourteen nits were
limited to diagnostics, naming, comments, tracking, or already-covered test
clarity and require no production change.

[VERIFIED] After the final authentication hardening regenerated implementation
and receipt digests, the complete Node 22 fitness wall passed again on the
exact published candidate. Targeted security/correctness/overall confirmation
`review-1784653499792-znrm3j-kern-5-r2-m4-29-unary-promotion-` completed 3/3
with no findings.

## Open Questions

None. The next action is the digest-bound `numberat` parameter migration, not
another structural-family prerequisite and not a KERN 5 completion claim.
