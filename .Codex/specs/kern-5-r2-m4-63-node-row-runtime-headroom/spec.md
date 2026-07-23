# KERN 5 R2 M4.63 Node-Row Structural Runtime Headroom

**Status:** IMPLEMENTED — VERIFIED AND REVIEWED; PUBLISH PENDING
**Date:** 2026-07-23
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.62 commit
`850bcff3127bbbc76c787512efe8e4613e557775` freezes the exact current
30-function residual frontier and recommends candidate profile 28/50/388.
The selected cohort contains four legacy-parameter functions across checker
and validator with 37 total parameter rows.

[DECIDED] M4.63 is evidence-only. It authenticates exact structural runtime
floors for those four counterfactually migrated functions through the public
`kern.runtime.handler.v1` boundary. It does not change the active 25/50/388
profile, KERN source, generated consumers, parser, runtime, KIR, ABI, package
versions, or public APIs. It cannot authorize a profile promotion or a KERN 5
completion claim.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`850bcff3127bbbc76c787512efe8e4613e557775`.

[VERIFIED] The immutable M4.62 handoff is:

- receipt SHA-256
  `5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc`;
- input commit `f36a870843ccdd222e8cf2e7595c0e205ed545bf`;
- selected limits 28 node rows, 50 property rows, and 388 value rows;
- four functions across two tools and 37 total parameter rows;
- unchanged production collection ceiling 65,536 and KIR depth 64;
- active profile remains 25/50/388 before any later promotion.

## Witness Contract

| Witness | Params | Structural rows | Required reason |
|---|---:|---:|---|
| `checker-while.kern#1:isSafeMagnitude` | 2 | 27/39/288 | `profile.rows.nodes` |
| `checker.kern#22:mapCallRejectDetail` | 13 | 28/42/309 | `profile.rows.nodes` |
| `validator.kern#10:fnokat` | 8 | 28/38/270 | `profile.rows.nodes` |
| `validator.kern#12:ownexportkind` | 14 | 28/48/260 | `profile.rows.nodes` |

[DECIDED] Each witness is parsed from its authenticated handwritten source,
counterfactually migrated with the canonical prerequisite migration,
structurally encoded and decoded, flattened, and executed through the public
runtime handler with exact candidate limits 28/50/388.

[VERIFIED] Bound input-source SHA-256 values are:

- checker while
  `424a5a3fc76a149efd6ba4ae8358dc025e06bed6873d466ba42d4fba19e8c46b`;
- checker
  `61453a2f2aec5de05973bf0c6a0c9e84e9f00d7d501a80993ea02f57a518fd2d`;
- validator
  `99717668519d853fa83805189626957c1565a415dbfd135c9fe3b1abccfb46a4`.

## Headroom Contract

[DECIDED] The promotion budget remains policy-derived as three quarters of
the 65,536 production ceiling: 49,152 steps, preserving 16,384 reserved
production headroom. No witness floor may be estimated or selected to fit the
budget; every boundary must come from monotonic runtime execution.

[DECIDED] For every witness, M4.63 must prove:

1. exact M4.62 identity, tool, parameters, profile rows, and sole blocker;
2. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
3. execution at `exactFloor` succeeds with no diagnostics or events;
4. returned source reparses and structurally encodes byte-identically;
5. the exact floor is no greater than 49,152;
6. promotion and production headroom are exact arithmetic; and
7. module-envelope admission remains explicitly outside this structural claim.

[VERIFIED] The public runtime handler established these exact monotonic
boundaries:

| Witness | Exact floor | Promotion headroom | Production headroom |
|---|---:|---:|---:|
| `checker-while.kern#1:isSafeMagnitude` | 21,736 | 27,416 | 43,800 |
| `checker.kern#22:mapCallRejectDetail` | 27,076 | 22,076 | 38,460 |
| `validator.kern#10:fnokat` | 21,825 | 27,327 | 43,711 |
| `validator.kern#12:ownexportkind` | 24,993 | 24,159 | 40,543 |

[VERIFIED] The maximum exact floor is 27,076, leaving at least 22,076 steps
inside the 49,152 promotion budget and 38,460 steps inside the 65,536
production ceiling. Module-envelope admission remains `not-claimed` at the
unchanged maximum depth 64.

## Authenticated Source Surface

[VERIFIED] Current source artifacts are:

- canonicalizer composite
  `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
- canonicalizer policy JSON
  `5aeba11a3c26e7b8025f28cd0c6a8ba1b8de50bf2060ae311744a7527767c67d`;
- composition JSON
  `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`;
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Implementation Plan

1. Add M4.63 receipt/validator and public-handler boundary tests first; capture
   RED at the intentionally missing module/receipt boundary.
2. Measure each exact floor with bounded monotonic search through the public
   runtime handler; freeze only the four verified boundaries.
3. Bind the receipt to M4.62 digest/input commit, exact selection and
   assignments, source files, canonicalizer artifacts, policy, codec, ABI, and
   policy-derived budgets.
4. Add mutation, decorated-data, M4.62-history, fresh-process, status, terminal
   checker, and exact floor-minus-one/floor round-trip guards.
5. Regenerate authenticated live summaries if the coverage implementation
   digest changes, then run focused, canonicalizer, and complete Node 22 gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Verification Receipt

[VERIFIED] RED failed at the intentionally missing
`node-row-headroom-m4-63.mjs` boundary before implementation.

[VERIFIED] The frozen receipt SHA-256 is
`110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3`.
The final milestone module SHA-256 is
`404322efc72d8a90019083fa9d826916a1e86af84938ff91ea5cbd6319ef781f`.
The focused receipt/status suite passed 16/16, the runtime boundary suite
passed 5/5, and the standalone canonicalizer passed 227/227 plus all 55
golden/idempotence/KIR fixtures, 8 historical measured witnesses, 3
profile-limit fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `fitness:kern-5` wall passed before review.
After the review-driven writer-integrity fix, the authenticated live coverage
summary SHA-256 is
`dbd7a3fcb0c2655b76475c62bca936d34872d42b9923679aaf5f11a096d35153`
and its coverage implementation digest is
`671def9cd9967c3e6305b40b55cd842a2980d9fe3e858e6b66fd5c442b1bf8df`.

[VERIFIED] High-risk role-lens review
`review-1784805563870-g1y27i` completed with 6/6 usable engines: zero
consensus-verified findings, five needs-check findings, and ten nits. The
writer-integrity finding was fixed by validating the exact receipt digest
before any write. This status/floor update resolves the stale-spec finding.
The remaining findings were rejected as non-exploitable in the hard-coded
repository call graph, incorrect, deliberate immutable-milestone isolation,
or already covered by the fresh-build gate.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.62 commit `850bcff3`.
- [x] Exact M4.62 selection and four witness assignments are grounded.
- [x] RED fails at the intended missing M4.63 receipt boundary.
- [x] All four exact floors are verified at floor-minus-one and floor.
- [x] All four outputs round-trip to byte-identical structural KIR.
- [x] Maximum exact floor is at or below the 49,152 promotion budget.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product or profile surface is authorized to change.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.62 digest, input commit, selection, assignment, or source bytes drift.
- Any selected function no longer counterfactually migrates to its exact rows.
- Runtime success is not monotonic at the measured collection boundary.
- Any exact floor exceeds 49,152 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, or ABI.

## Out of Scope

- Promoting `maxNodeRows` from 25 to 28.
- Migrating any of the selected 37 parameter rows.
- Claiming module-envelope admission, release readiness, stable KIR, semantic
  self-hosting, or KERN 5 completion.
