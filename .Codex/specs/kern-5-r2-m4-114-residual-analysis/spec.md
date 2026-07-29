# KERN 5 R2 M4.114 — Residual Frontier Analysis

**Status:** READY TO BUILD
**Date:** 2026-07-29
**Confidence:** 0.95

## Executive Summary

[VERIFIED] M4.113 leaves exactly six legacy-parameter blockers at a
101/111 base-complete frontier
(`scripts/kern-canonicalizer/coverage-current.mjs:6-13`,
`scripts/kern-canonicalizer/coverage-current.mjs:71-91`).

[DECIDED] M4.114 publishes a byte-frozen residual-analysis receipt over that
frontier. The analysis selects only `checkModule`: its direct-parameter
projection requires profile limits `122/193/2411`, completes one checker
function, and covers 58 parameter rows. M4.115 owns structural runtime
headroom for that candidate; M4.114 changes no source function or limit.

## Current State / Root Cause

[VERIFIED] The current structural KIR depth is 76 while the profile remains
`89/125/2100` (`scripts/kern-canonicalizer/coverage-current.mjs:29-33`,
`scripts/kern-canonicalizer/policy.json:6-16`,
`scripts/kern-canonicalizer/policy.json:26-30`).

[VERIFIED] The established projection path removes `fn.params`, inserts an
ordered direct-`param` prefix, measures structural KIR rows, and records
projection failures instead of guessing rows
(`scripts/kern-canonicalizer/coverage-prerequisite.mjs:96-107`,
`scripts/kern-canonicalizer/coverage-prerequisite.mjs:138-175`).

[VERIFIED] A live measurement on 2026-07-29 produced:

- `checkModule`: 58 parameter rows, profile rows `122/193/2411`, and only
  three profile-row blockers.
- `rejectLine`: `projection.limit-depth`.
- `quotesource`: `projection.limit-depth` plus six unsupported control or
  separator characters.
- `expressionsources` and `canonicalize`:
  `projection.unknown-expression-kind` plus their live expression blockers.
- `validate`: `projection.limit-nodes`.

Evidence command:

```text
node --input-type=module <live six-function projection probe>
coverage=101/111; legacy=6
candidate=checkModule; parameterRows=58; rows=122/193/2411
assignmentDigest=7922f23766d95c5492800a9ae2b5f66217027a0214e716a0f6c96efb1c6ebb55
```

The exact six legacy declarations are visible at
`examples/capstone-checker-subset/checker.kern:11`,
`examples/capstone-checker-subset/checker.kern:487`,
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:57`,
`examples/kern-canonicalizer/canonicalizer.kern:67`,
`examples/kern-canonicalizer/canonicalizer.kern:276`, and
`examples/selfhost-validator/validator.kern:386`.

## What Already Works

- [VERIFIED] The generic residual analyzer already derives observed limit
  settings, reevaluates every residual function at each setting, and orders
  candidates deterministically
  (`scripts/kern-canonicalizer/coverage-residual-analysis-m4-109.mjs:213-248`).
- [VERIFIED] Published residual receipts already reject digest drift,
  non-plain data, cycles, shared references, non-canonical JSON, and symlinks
  (`scripts/kern-canonicalizer/coverage-residual-analysis-m4-109.mjs:117-124`,
  `scripts/kern-canonicalizer/coverage-residual-analysis-m4-109.test.mjs:50-100`).
- [VERIFIED] M4.113 already authenticates the exact six-function population
  and empty current migration queue
  (`scripts/kern-canonicalizer/coverage-m4-113-parameter-migration.mjs:143-189`).
- [VERIFIED] No corpus, canonicalizer source, coverage policy, KIR limit,
  runtime limit, or profile limit needs to change for an analysis-only slice.

## Contract (Verified)

> Verified against live source and measurement commands on 2026-07-29.

| Behavior | Evidence | Tag |
|---|---|---|
| Baseline is 101/111 with six legacy blockers | `coverage-current.mjs:71-91` | VERIFIED |
| Current profile is `89/125/2100` | `policy.json:26-30` | VERIFIED |
| Exactly one residual has measurable profile rows | live six-function projection probe above | VERIFIED |
| Selected limits are `122/193/2411` | live candidate probe above | VERIFIED |
| Selected witness is `checker.kern#24:checkModule` | live candidate probe above | VERIFIED |
| Selection covers one tool, one function, 58 rows | declaration at `checker.kern:487`; live probe above | VERIFIED |
| Total profile delta is 412 | `(122-89)+(193-125)+(2411-2100)` | VERIFIED |
| Remaining five functions stay assigned exact authenticated reasons | live six-function projection probe above | VERIFIED |
| M4.114 does not promote the candidate | milestone boundary established by `coverage-status.mjs:254-259` | VERIFIED |

## Implementation Option

Add one analysis owner, one immutable JSON receipt, and one test following the
M4.101/M4.109 receipt pattern. Integrate the published result into status and
the central coverage gate. A generic analyzer refactor would modify many
historical receipt-owner sources and refresh authenticated implementation
digests without changing the M4.114 contract; extracting the helpers only for
M4.114 would instead create a one-consumer abstraction. That cleanup is not
part of this slice.

1. Add a RED test that imports the absent M4.114 owner and asserts the exact
   baseline, six assignments, digest, candidate, canonical bytes, and
   independent-process reproduction.
2. Measure the current live frontier and write the canonical M4.114 receipt.
3. Freeze its SHA-256 digest and input commit in the owner.
4. Add the M4.114 status handoff to M4.115 and include it in the central
   coverage wall.
5. Run targeted tests, the full KERN 5 fitness wall, and automatic high-risk
   role-lens review.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-114-residual-analysis/spec.md` | add | Claim/evidence boundary |
| `coverage-residual-analysis-m4-114.mjs` | add | Deterministic live measurement and immutable loader |
| `coverage-residual-analysis-m4-114.json` | add | Canonical published handoff |
| `coverage-residual-analysis-m4-114.test.mjs` | add | Exact receipt, drift, history, and fresh-process oracle |
| `coverage-m4-114-central.mjs` | add | Keep new exact central assertions out of the oversized wall driver |
| `coverage-status.{mjs,test.mjs}` | modify | Publish the M4.115 continuation |
| `check-kern-canonicalizer-coverage.mjs` | modify | Make the receipt release-blocking |

## Acceptance Criteria

- [ ] RED fails because `coverage-residual-analysis-m4-114.mjs` is absent.
- [ ] The baseline is exactly 101/111 with six legacy-parameter blockers.
- [ ] All six assignments reproduce digest
      `7922f23766d95c5492800a9ae2b5f66217027a0214e716a0f6c96efb1c6ebb55`.
- [ ] Exactly one function exposes profile rows and exactly one observed
      setting is evaluated.
- [ ] The exact selected action is one checker function and 58 rows at
      `122/193/2411`, total delta 412, with witness `checkModule`.
- [ ] Five non-selected functions retain exact projection or canonical-surface
      blockers; no synthetic profile rows are invented.
- [ ] The receipt is canonical JSON, byte-frozen by SHA-256, rejects semantic
      and decorated drift, and reproduces in a locale-independent process.
- [ ] M4.109 history remains byte-exact.
- [ ] Current source, coverage policy, KIR/runtime/profile limits, and semantic
      summary fields remain unchanged; both summary implementation digests are
      refreshed by the repository writer.
- [ ] Status says M4.115 authenticates structural runtime headroom.
- [ ] Targeted tests, full KERN 5 fitness wall, and automatic high-risk
      role-lens review pass without unresolved material findings.
- [ ] One signed commit is fetched/rebased before one push and remote `main`
      verifies identically.

## Out of Scope

- Promoting profile limits to `122/193/2411`.
- Measuring or changing runtime cost.
- Migrating `checkModule` or any of the other five signatures.
- Widening KIR depth/nodes or adding expression/character support.
- KIR v1 freeze, runtime cutover, RC, stable 5.0, or Fable.

## Open Questions

None.

## Deploy Order

Publish the analyzer, exact JSON receipt, tests, central gate, and status in
one commit. This is additive evidence: no runtime or source-version skew is
introduced. M4.115 starts from the resulting `origin/main`.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Exploratory assignment digest was `fad8…e61f` | The probe used locale collation; the receipt contract uses code-point ordering, which places `#24` before `#2` and reproduces `7922…b55` | Corrected the spec and RED oracle before publishing any receipt |
