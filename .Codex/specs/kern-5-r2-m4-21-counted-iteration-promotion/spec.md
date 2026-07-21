# KERN 5 R2 M4.21 — Counted-Iteration Promotion and Parameter-Ready Remeasurement

**Status:** REVIEWED — READY FOR PUBLICATION
**Date:** 2026-07-21
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published `origin/main` commit
`686798cd2184612ea6f257181793568fc1ab1a9d` contains the reviewed M4.20
default-step counted-iteration canonicalizer. The authenticated executable is
36,410 bytes at SHA-256
`55c1b597a8912af545c348c57329d9aef0174590dbe4ba64310484806a8c1307`
and passes exact golden/KIR/idempotence and fail-closed hostile coverage.

[VERIFIED] Immutable M4.19 prerequisite provenance
`af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`
selects counted iteration as the exact singleton causal input: six functions,
three tools, 14 counterfactual structured-parameter rows, and 468 occurrences.

[DECIDED] Promote the exact M4.20 default-step `for` family into the cumulative
coverage base through that prerequisite record. Remeasure parameter readiness
separately from residual structural prerequisites: functions completed by the
promoted base after counterfactual parameter migration must not be credited to
an unrelated active family.

## Current State and Root Cause

[VERIFIED] Policy 3 currently identifies profile
`kern.kir-canonicalizer.profile.m4.18`, promotes index as its latest capability,
and keeps counted iteration active as exactly node kind `for` plus required
properties `for.from`, `for.name`, and `for.to`. Explicit `for.step` is outside
the authenticated family and remains unsupported.

[VERIFIED] The M4.20 KERN implementation validates exactly those three
properties, a cross-target loop identifier, recursively supported bounds, and
recursively supported body statements. It deliberately accepts parser-valid
empty bodies and rejects explicit step, future properties, malformed names,
unsupported expressions, and unsupported children.

[VERIFIED] The prerequisite selector currently starts its family search at
cardinality one. After counted iteration becomes base, the six M4.19 witnesses
complete under the base alone once their legacy parameters are migrated. If
they remain in every candidate-family closure, the algorithm will falsely
attribute those six completions to whichever unrelated singleton happens to
rank first.

[DECIDED] M4.21 therefore separates two facts:

1. `parameterMigration` records functions that complete with the promoted base
   alone after exact in-memory legacy-parameter migration.
2. Residual structural ranking operates only on migrated functions that do not
   already complete with the base.

This preserves the immediate next action—migrate the frozen six functions and
14 parameter rows—while still measuring the following structural prerequisite
without causal contamination.

## Promotion Contract

| Behavior | Contract | Tag |
|---|---|---|
| Policy format | remain `kern.kir-canonicalizer.coverage-policy.3` | VERIFIED |
| Base identity | advance to `kern.kir-canonicalizer.profile.m4.21` | DECIDED |
| Promotion row | append counted iteration with M4.19 digest and kind `prerequisite` | DECIDED |
| Base nodes | add sorted `for`; preserve all prior node kinds | DECIDED |
| Base properties | add only `for.from`, `for.name`, and `for.to`; exclude `for.step` | DECIDED |
| Base expressions | unchanged; bounds recurse through the promoted expression base | DECIDED |
| Active families | remove counted iteration; preserve binding, do, exception, unary, and while | DECIDED |
| KERN executable | remain byte-identical to published M4.20 | DECIDED |
| Provenance history | preserve four selection and two prerequisite records byte-for-byte | DECIDED |
| Implementation pointer | become the counted-iteration prerequisite promotion | DECIDED |

## Exact Counted-Iteration Base Profile

[DECIDED] A base `for` node must contain exactly `from`, `name`, and `to`.
`name` must be a cross-target identifier matching
`[A-Za-z_][A-Za-z0-9_]*`. `from` and `to` must project successfully, and their
nested expression kinds must belong to the recursive base through the existing
structural expression-family gate. `step`, missing properties, extra
non-excluded properties, and invalid identifiers remain local profile blockers;
unsupported bounds and nested statements remain structural coverage blockers.

[VERIFIED] Empty loop bodies are parser-valid and M4.20 proves exact reparse
and KIR idempotence, so the base profile must accept them. Statement sequencing
continues to enforce the existing orphan-`else` and trailing-return rules.

## Prerequisite Summary Evolution

[DECIDED] Advance the live prerequisite summary to
`kern.kir-canonicalizer.prerequisite-summary.2` and add an exact
`parameterMigration` record:

- `completeFunctions`;
- `completeTools`;
- `migratedParameterRows`;
- exact sorted witness rows `{ id, parameterRows, profileRows, tool }`.

[DECIDED] Compute this record with the base-only profile. Remove those witness
functions before enumerating active-family combinations. Preserve the existing
`minimumFamilyCount`, `prerequisiteRanking`, `ranking`, and
`selectedPrerequisite` fields for the residual structural result.

[VERIFIED] Base-only completion is independently observable through
`canonicalizerFunctionCompletes(baseProfile, migratedFact, profileLimits)`;
it does not depend on membership in an active family. Partitioning is repeated
from current authenticated facts on every measurement, so later functions are
classified from their current structure rather than excluded by a permanent
identifier list.

[VERIFIED] M4.19 authenticates the parameter-ready tranche as six functions,
three tools, and 14 rows, and M4.21 live measurement reproduces it exactly.
After excluding those six, binding is the next residual singleton at five
functions, two tools, nine parameter rows, and 801 occurrences. Unary is the
only other completing singleton at one function, one tool, two parameter rows,
and 48 occurrences. These are measured outputs, not forecasts.

## Options

| Approach | Result | Decision |
|---|---|---|
| Reuse the current selector unchanged | falsely credits base-ready functions to an unrelated family | Reject |
| Filter base-ready functions but omit them from the receipt | fixes ranking but hides the immediate migration tranche | Reject |
| Treat parameter migration as a synthetic family | pollutes the frozen structural family registry | Reject |
| Add parameter readiness and rank only residual functions | truthful causal accounting with explicit next work | Select |
| Migrate the 14 rows in the promotion slice | conflates capability promotion with a six-function source migration | Reject |

## RED and Mutation Plan

[DECIDED] First add tests requiring profile M4.21, the exact counted promotion,
`for` base validation, counted-family removal, prerequisite-summary format 2,
the six-function/14-row parameter-ready tranche, and residual binding ranking.
Run them against sealed M4.20 and capture failure at the old profile and
summary format before changing implementation code.

[DECIDED] Mutation coverage rejects missing/reordered/duplicated counted
promotion, wrong provenance kind or digest, reintroduced counted-family
overlap, `for.step`, missing/extra loop properties, invalid loop identifiers,
unsupported bounds, malformed nesting, and leakage of base-ready witnesses
into residual family closures.

[DECIDED] Exact partition tests assert that parameter-ready and residual
ranking witness IDs are disjoint, while the implementation fail-closes unless
the base-ready and residual counts exhaust the migrated input. Live format-2
consumers pin format 2, while the immutable provenance loader continues
accepting the exact historical format-1 summaries embedded in M4.16/M4.19
source records.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | claim-tagged promotion and remeasurement contract |
| `coverage-policy.json` | modify | M4.21 base, counted promotion, active-family removal |
| `coverage-profile.mjs` | modify | exact default-step `for` base profile |
| `coverage-prerequisite.mjs` | modify | base-only parameter readiness and residual ranking |
| promotion/prerequisite/coverage/handoff tests | modify | RED, exact promotion, mutations, and live facts |
| coverage check command | modify | exact M4.21 and next-action evidence |
| coverage and prerequisite summaries | regenerate | authenticated post-promotion facts |
| release train | modify | durable M4.21 evidence |

## Acceptance Criteria

- [x] Fresh feature branch starts from exact published M4.20 `origin/main`.
- [x] M4.20 executable, M4.19 provenance, policy 3, profile, and prerequisite
      selector are grounded in current source.
- [x] Adversarial plan challenge resolves the parameter-ready/residual ranking
      contract and raises implementation confidence to at least 0.85.
- [x] RED fails first at the sealed M4.20 profile/summary contract.
- [x] Counted promotion cites exact M4.19 prerequisite evidence and becomes the
      current implementation pointer.
- [x] Exact default-step `for` profile is mutation-killed while explicit step
      remains unpromoted.
- [x] The six M4.19 witnesses become exact base-only parameter-ready evidence
      at three tools and 14 rows.
- [x] No base-ready witness contributes completion credit to a residual family.
- [x] Residual structural ranking is measured and pinned from live facts.
- [x] KERN composition and all six historical provenance records remain
      byte-identical.
- [ ] Focused Node 22 canonicalizer gate passes after review fixes.
- [ ] Complete `pnpm fitness:kern-5` wall passes after review fixes.
- [ ] Full usable-roster high-risk role-lens review has no unresolved material
      finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`.

## Stop Conditions

- Promotion requires changing KERN source, structural KIR, parser behavior,
  runtime ABI, corpus membership, family registry, or historical provenance.
- The exact M4.19 digest cannot authenticate the counted promotion.
- A published M4.19 witness does not complete under the M4.21 base after exact
  parameter migration.
- Parameter-ready filtering changes historical source facts instead of only
  reclassifying the live prerequisite result.
- The residual result has no honest completing closure under the active family
  registry.

## Out of Scope

- Editing any KERN function signature or migrating the 14 ready parameter rows.
- Implementing or promoting binding, do, exception, unary, or while families.
- Explicit non-default counted-loop step semantics.
- Changing canonicalizer KERN bytes, runtime behavior, schema, registry, or
  profile limits.
- KIR v1 freeze, public reader export, runtime cutover, or 5.0 completion claim.

## Deploy Order

[DECIDED] Ship promotion policy, exact profile, parameter-ready accounting,
regenerated receipts, tests, spec, and release evidence atomically after local
gates and independent review. Immediately before the only push, fetch and
rebase onto `origin/main`; publish the feature ref and explicitly authorized
`main` atomically with `--no-verify`. Verify both remote refs, fetch again, and
start the parameter-migration slice from a new branch based on `origin/main`.

## Current Evidence

[VERIFIED] Implemented coverage-policy SHA-256 is
`bb4a60b56bf42ea4a75465d84c1b35a7dd9a9ee9599ce418dfb440803c1d7f15`.
Coverage and prerequisite summary SHA-256 values are
`23f7fc2ebea695a4d0182590171da4e871eb5172fe842309a9297ef994ce3df3`
and
`cf00b028374005140d0aa4add87496684d08439a9e7711a2986b80ffdcff41e8`.
The authenticated live coverage implementation digest is
`6dffd8b4ef3a70f3d948eba758d8c8d515e7127537235d8054e436036a7b0c1f`.

[VERIFIED] Post-promotion measurement remains 21/104 base-complete with 81
legacy parameter blockers and a null ordinary winner. Format-2 prerequisite
evidence separately records six base-only parameter-ready functions across
three tools and 14 rows. Residual singleton ranking selects binding at five
functions, two tools, nine rows, and 801 occurrences; unary is second at one
function, one tool, two rows, and 48 occurrences. The focused Node 22
canonicalizer gate passes all 82 tests, the exact 36-fixture runtime corpus,
and 179 hostile mutations. The complete Node 22 `pnpm fitness:kern-5` wall
passed all workspace/infrastructure suites, 432/432 cross-target fixtures,
109/109 class fixtures, 233 native assertions at 100% declared coverage, 40
whole-app fixtures, browser budgets, and every KIR/runtime/ownership/convergence
gate before exposing a test-only transient-directory race in its repeated
canonicalizer stage. Moving repository-contained corpus fixtures outside the
authenticated implementation tree removed that race; the concurrent
fresh-process reproducer passed twice and the complete canonicalizer gate then
passed. All four selection records and both prerequisite records remain
immutable inputs to M4.21.

## Adversarial Plan Delta

[VERIFIED] Nero run `nero-1784613822599-s6u11b` challenged the plan at initial
confidence 0.88. The challenger could not read the spec and proposed five
failure modes. Current source resolves four directly:

- `selectClosures` starts at family size one
  (`coverage-prerequisite.mjs:212`), confirming the false-credit path.
- `canonicalizerFunctionCompletes` accepts an explicit base profile, so
  base-only completion is independently measurable.
- immutable M4.16/M4.19 provenance records retain historical
  prerequisite-summary format 1 through their dedicated validator; the live
  summary reader is separately version-pinned.
- partitioning is recomputed from every current migrated fact, so later facts
  cannot disappear behind a frozen witness list.

[DECIDED] The valid challenge was enforcement clarity. The implementation now
requires exact disjointness/partition assertions and explicit live-format vs
historical-format compatibility tests. No dependency remains unresolved, and
implementation confidence is 0.96 after the focused green gate.

## Terminal Review

[VERIFIED] High-risk role-lens review
`review-1784616172647-5cd21c` completed all six usable non-excluded engines.
It returned zero verified findings, three needs-check items, and ten nits. The
substantive shared-owner concern was valid: completion-profile assembly existed
in selection, implementation, and prerequisite paths. One exported builder now
owns all three. The documented `--no-verify` publish step remains an explicit
user instruction backed by manual gates, and source tracing plus exact
disjointness tests disproved the suggested residual-partition leak. The review
also led to single-evaluation parameter accounting, explicit empty-residual
failure, and fail-closed missing `for.name` handling.

[VERIFIED] Targeted medium-risk review
`review-1784618742992-n5ktt4` then completed both automatically routed
independent identities with zero verified, needs-check, or speculative
findings. Its two nits were inspected and rejected as non-improvements: the
fallback object is a negligible fail-closed property check, while optional
deletion would weaken the invariant already established by exact legacy
parameter validation. No unresolved review dependency remains.
