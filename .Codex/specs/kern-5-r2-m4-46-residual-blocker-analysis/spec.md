# KERN 5 R2 M4.46 Current Residual Blocker Analysis

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-22
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.45 commit
`517d7d26baa461e9a4204d6ba2059c99b8fa0d65` consumed the complete
M4.44-authenticated 388-row parameter queue. The live canonicalizer boundary
is now 60/104 base-complete functions, 43 legacy-parameter residual functions,
an exactly empty parameter queue, and bounded exhaustion over exception-flow
and while-iteration.

[DECIDED] M4.46 is analysis-only. It publishes one authenticated current
residual analysis under the unchanged M4.36 base profile and 16/30/388 limits.
It changes no KERN source, generated consumer, profile limit, active family,
parser, runtime, KIR, ABI, package version, or public API. KERN 5 remains
incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at published M4.45 commit
`517d7d26baa461e9a4204d6ba2059c99b8fa0d65`; both local HEAD and
`origin/main` resolve to that exact object.

[VERIFIED] The exact M4.45 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.36`;
- limits 16 node rows, 30 property rows, and 388 value rows;
- 104 functions across nine handwritten members and four tools;
- 60 base-complete functions and 43 legacy-parameter residual functions;
- zero parameter-ready functions, tools, rows, and witnesses;
- active exception-flow and while-iteration families;
- three evaluated non-empty family closures and zero completing closures;
- exact residual reason-assignment digest
  `f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c`;
- coverage-summary SHA-256
  `f6d511f31f15afe38b24fa0bed20a9632ac1795e04d94271c22b1d05fb8cac47`;
- prerequisite-summary SHA-256
  `28e31cb5cba0859d79b08aae181c86ed95340b44669c2c6dc0428c21cf8f2470`;
- implementation, policy, and function-fact digests
  `830fe8696f192ca61715e312f7f536291d71d15e490c73c473b0d67091a769e5`,
  `f326deb064b3e787cd24d1adfb12066db2c6206b93ac3bdebbcfbeb196e93096`,
  and `b6adf472db5ae14b3ad4735d20a3ed3c4b6d5425295af2904c4136d441399d50`.

## Root Problem

[VERIFIED] M4.43 measured 45 residual functions under 16/30/154 and selected a
two-function value-row cohort. M4.44 promoted the 388-row profile, and M4.45
migrated that entire cohort. M4.43 is therefore consumed historical evidence
and cannot select the next release slice.

[VERIFIED] The live prerequisite result deliberately stops at “residual blocker
analysis.” Its overlapping raw blocker counts cannot prove which exact limit
or limit combination completes a current residual function.

[DECIDED] M4.46 recomputes exact function-to-reason assignments and bounded
observed-limit counterfactuals from the authenticated M4.45 population before
any new profile or migration slice is authorized.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | reuse `kern.kir-canonicalizer.residual-analysis.3`; the schema is unchanged | DECIDED |
| Scope | exact 43 current residual functions | VERIFIED |
| History | preserve M4.31, M4.38, M4.42, and M4.43 receipts, digests, modules, and tests byte-identically | DECIDED |
| Assignment | bind id, tool, parameter rows, profile rows, and sorted reasons | DECIDED |
| Assignment digest | reproduce the live M4.45 exhaustion digest exactly | DECIDED |
| Candidate limits | derive only from observed residual profile rows and live policy | DECIDED |
| Completion | reuse `canonicalizerFunctionCompletes` under unchanged base and no added family | DECIDED |
| Ranking | fewer axes, more tools, smaller delta, more functions, canonical signature | DECIDED |
| Selection | first completing ranked candidate or explicit null frontier exhaustion | DECIDED |
| Authority | recommendation only; no profile promotion or source migration | DECIDED |

## Candidate Construction

[DECIDED] Counterfactually migrate only the 43 authenticated legacy
`fn.params` facts into direct-parameter facts, then require the live
parameter-ready partition to remain empty. For each residual function with
measured profile rows, raise each current limit only as far as that function
requires. Deduplicate settings, discard unchanged settings, evaluate every
setting against every residual function, and retain exact witnesses for
settings completing at least one function.

[DECIDED] Sort actionable candidates by changed-axis count ascending, complete
tools descending, total delta ascending, complete functions descending, then
canonical nodes/properties/values signature. No release threshold, favored
axis, preferred tool, or fixed future ceiling is hardcoded.

## Read-Only Measured Frontier

[VERIFIED] Running the proven M4.42 analyzer algorithm against published M4.45
produces:

- exactly 43 residual assignments;
- exactly 27 functions with measured profile rows;
- 26 distinct observed settings and 26 positive actionable candidates;
- zero parameter-ready functions after counterfactual migration;
- assignment digest
  `f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c`,
  byte-identical to the live prerequisite exhaustion digest.

[VERIFIED] The first ranked action changes only `maxNodeRows` from 16 to 19.
Its total delta is 3 and it completes four functions across checker,
canonicalizer, and validator:

| Function | Parameter rows | Profile rows N/P/V |
|---|---:|---:|
| `checker.kern#12:isIndexRebound` | 6 | 17/26/152 |
| `checker.kern#9:isUserCallable` | 4 | 19/26/185 |
| `canonicalizer-expression-helpers.kern#4:validinteger` | 1 | 19/28/290 |
| `validator.kern#3:isportable` | 1 | 18/24/217 |

[VERIFIED] Each selected function has no structural exclusion after
counterfactual parameter migration and is blocked only by
`profile.rows.nodes`. The recommendation therefore exposes a coherent
four-function, three-tool, 12-parameter-row future cohort, but M4.46 does not
promote or migrate it.

## Integrity Contract

[DECIDED] Validation fails closed on format or field drift, malformed or
duplicate ids, unsorted assignments, invented tools, stale baseline digests,
assignment digest drift, reason omission or invention, below-current or
unobserved settings, incorrect axes or deltas, fabricated witnesses, ranking
drift, decorated data, and selection drift.

[DECIDED] Writer/check mode uses canonical JSON, a regular non-symlink target,
and exact fresh-process reproduction under UTC and C locale. The live analyzer
remains executable until the selected frontier is independently headroom-
tested and consumed; a later milestone freezes its exact published bytes.

## RED and Implementation Plan

1. Add the M4.46 tests first and capture failure for the missing current
   analyzer/receipt.
2. Reuse the proven data-derived residual algorithm with M4.46-specific empty
   queue, 43-residual, and published-baseline guards.
3. Generate the canonical receipt only after the implementation module
   settles; regenerate live coverage receipts if the authenticated
   implementation closure changes.
4. Add schema, mutation, decorated-data, historical-preservation, writer, and
   fresh-process determinism checks.
5. Pin the exact 19/30/388 recommendation and terminal guidance without
   implementing it.
6. Run focused validation and the complete Node 22.22 `fitness:kern-5` wall.
7. Run required independent review based on the actual diff risk, resolve every
   material finding, and rerun affected gates.
8. Create one Agon-signed commit, fetch/rebase onto fresh `origin/main`, push
   once with `--no-verify` to the fresh feature ref and authorized `main`, and
   verify both remote hashes.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add and seal | claim-tagged analysis contract and evidence |
| M4.46 residual-analysis module | add | derive and validate current analysis |
| M4.46 residual-analysis receipt | generate | durable exact frontier |
| M4.46 residual-analysis tests | add | RED, mutations, history, and determinism |
| terminal coverage checker | modify | authenticate current analysis and status |
| coverage status formatter/tests | modify | distinguish M4.46 from consumed history |
| coverage/prerequisite receipts | regenerate if implementation digest changes | preserve authenticated live baseline |
| release train | modify after gates | durable M4.46 evidence and next action |

## Acceptance Criteria

- [x] Fresh branch starts at published M4.45 commit `517d7d26`.
- [x] Read-only measurement reproduces the live exhaustion digest.
- [x] RED fails at the missing M4.46 analyzer/receipt boundary.
- [x] Every current residual function has one exact canonical assignment.
- [x] Candidate settings derive only from live policy and observed rows.
- [x] Selection is exact 19/30/388 with four functions across three tools.
- [x] M4.31/M4.38/M4.42/M4.43 history remains byte-identical.
- [x] No KERN source, generated consumer, profile, family, parser, KIR,
      runtime, ABI, package version, or public API changes.
- [x] Focused gates and complete Node 22.22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      feature ref and authorized `main`; both remote hashes verify.

## Stop Conditions

- Residual count is not 43 or the parameter-ready partition is non-empty.
- Assignment digest differs from the published M4.45 exhaustion digest.
- Candidate construction needs a number not supplied by current policy or
  authenticated observed facts.
- The selected setting is not exact 19/30/388 with the four measured witnesses.
- Any historical receipt, KERN source, generated consumer, runtime, KIR, ABI,
  package, or public surface changes.

## Out of Scope

- Runtime-headroom proof for 19-row nodes.
- Promoting `maxNodeRows`, migrating the selected 12 parameter rows, or adding
  exception-flow or while-iteration support.
- Version bump, release candidate, stable release, or KERN 5 completion claim.

## Open Questions

[VERIFIED] None within this analysis-only slice. If the authenticated result
matches the read-only measurement, M4.47 must independently prove runtime
headroom for the four exact witnesses before any 19-row profile promotion.

## Measured Implementation Evidence

[VERIFIED] The RED test failed before implementation at the intended missing
`coverage-residual-analysis-m4-46.mjs` module boundary. After implementation,
the isolated Node 22.22 analysis/status suite passes 8/8. It validates all 43
assignments, 26 observed settings and candidates, the exact 19/30/388
selection, 15 named drift mutations, decorated objects, every historical
receipt digest, canonical checked-in bytes, and fresh-process determinism.

[VERIFIED] The generated M4.46 receipt has SHA-256
`67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`.
Its analyzer source has SHA-256
`20f85ccfd19b75cfc4357d6b726ce02207312d0812358c46fb4155de8e74b194`.
Regenerated coverage and prerequisite summaries authenticate at
`f92de8285ead020203aa7a4d299e89ab62c13f67c904598abfdfc01c049ea62b`
and `f18ad9a00b41d15f94a7eb7de047efb6257c5b1b606f3099b3bcc596f6d9cd4e`.
The implementation digest is
`9ba952686c10c0210810f428fbbfabdd4d8612825e0047a8add9d2425466021e`;
policy and function-fact digests remain byte-identical to M4.45.

[VERIFIED] The complete Node 22.22 `fitness:kern-5` wall passes with exit 0,
including every workspace build/test, 434/434 cross-target fixtures, 109/109
class fixtures, 233/233 native assertions at 100% coverage, 48/48 checker
fixtures, 39/39 validator verdicts, 40 app fixtures across three legs,
whole-app Express/FastAPI boot, runtime/KIR/ownership/convergence gates, and
the repeated canonicalizer wall. The complete canonicalizer gate passes
140/140 tests plus 51 golden/idempotence/KIR fixtures, eight measured
witnesses, three profile-limit fixtures, and 226 hostile fixtures. The
required browser-budget receipt remains 157 modules, 1,553,103 raw bytes,
333,617 gzip bytes, 56 ms cold import/execute, and a 91 ms browser median
(88/91/113 ms samples).

[VERIFIED] Automatic medium-risk role-lens review
`review-1784737826705-aha15a-kern-5-r2-m4-46-final` completed 2/2. The overall
reviewer reported no finding. The security reviewer found no attack surface or
receipt discrepancy and raised one non-blocking lifecycle question plus four
nits. The lifecycle question was rejected after source/history verification:
`--write` must fail once the exact 43-function M4.45 population changes, or it
could silently rewrite the M4.46 evidence that future promotion slices must
freeze before moving policy. The explicit null-status test gap was genuine and
fixed. Re-measurement is bounded offline work; signature comparison and the
per-function observed-setting lattice are explicit deterministic contracts,
not completeness claims over an invented cross-product. No material finding
remains unresolved.
