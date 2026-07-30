# KERN 5 R2 M4.145 — Structural KIR and Runtime-Envelope Headroom

**Status:** IMPLEMENTED — READY TO SHIP
**Date:** 2026-07-30
**Base commit:** `7273d51ee0c61785251aaf13106f6b6556720990`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.144 freezes exactly one actionable candidate:
`examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`, six
parameter rows, KIR limits 367368/122/7136, and profile limits 205/332/6304
(`scripts/kern-canonicalizer/projection-analysis-m4-144.json:2-31`).

[VERIFIED] A current-source runtime probe at base commit `7273d51e` proves
43,053 iterations fail with `unsupported-runtime-input` and 43,054 iterations
succeed with a return value. The successful run executes exactly 42,666 `for`
iterations plus 388 `while` iterations. The exact floor is therefore 43,054,
leaving 6,098 iterations below the 49,152 promotion budget and 22,482 below
the 65,536 production ceiling (`node /tmp/kern-m4-145-probe.mjs 43053 43054`,
2026-07-30).

[DECIDED] M4.145 publishes immutable structural/runtime evidence only. It does
not change source, KIR/profile/runtime policy, ABI, cumulative coverage, or
parameter representation. M4.146 owns the combined KIR/profile promotion,
the exact factor-derived runtime-byte promotion, and publication of the
`expressionsources` migration queue.

## Current State / Root Cause

- [VERIFIED] Active KIR limits are 273051 bytes, depth 98, and 5313 nodes;
  active profile limits are 202/308/4493
  (`scripts/kern-canonicalizer/policy.json:6-16,26-30`).
- [VERIFIED] Runtime collection length is 65,536, making the established
  three-quarter promotion budget 49,152
  (`scripts/kern-canonicalizer/policy.json:18-24`;
  `scripts/kern-canonicalizer/combined-headroom-m4-127-measure.mjs:256-257`).
- [VERIFIED] M4.144 records exact rejection witnesses one below each required
  KIR axis: bytes 367367/`limit-bytes`, depth 121/`limit-depth`, and nodes
  7135/`limit-nodes`
  (`scripts/kern-canonicalizer/projection-analysis-m4-144.json:76-102`).
- [VERIFIED] The candidate encodes to exactly 367,368 bytes and flattens to
  205 node, 332 property, and 6,304 value rows
  (`node /tmp/kern-m4-145-probe.mjs 43053 43054`, 2026-07-30).
- [VERIFIED] The current combined-headroom pattern authenticates structural
  boundaries, exact-floor/below-floor execution, public/internal handler
  parity, source roundtrip, source identities, immutable receipt bytes, and
  promotion disposition without changing live policy
  (`scripts/kern-canonicalizer/combined-headroom-m4-127.mjs:211-300`;
  `scripts/kern-canonicalizer/combined-headroom-m4-127-measure.mjs:175-317`).

The candidate is not blocked by runtime cost: its exact floor is 6,098
iterations below the promotion budget. The remaining obligation is to freeze
that fact against the exact M4.144 selection and current executable inputs
before any policy promotion.

## What Already Works

- M4.144 binds its input commit and minimum KIR rejection witnesses inside the
  receipt digest.
- The current structural KIR codec supports the complete migrated
  `expressionsources` root and roundtrips it at the selected limits.
- The existing internal and public runtime-handler paths execute the unchanged
  KERN canonicalizer with explicit limits.
- The policy already defines immutable 4x KIR-to-source and 2x
  runtime-envelope expansion factors. M4.146 can derive runtime string/byte
  ceilings 1,469,472/2,938,944 from the selected 367,368-byte KIR limit;
  M4.145 records but does not promote them.

## Contract

> Verified against `origin/main` at
> `7273d51ee0c61785251aaf13106f6b6556720990` on 2026-07-30.

| Field / Behavior | Exact value | Evidence | Tag |
|---|---:|---|---|
| M4.144 receipt digest | `0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086` | `shasum -a 256 projection-analysis-m4-144.json` | VERIFIED |
| Published input commit | `7273d51ee0c61785251aaf13106f6b6556720990` | `git rev-parse HEAD` | VERIFIED |
| Witness | `canonicalizer.kern#3:expressionsources` | M4.144 receipt | VERIFIED |
| Candidate KIR | 367368/122/7136 | M4.144 receipt | VERIFIED |
| Candidate profile | 205/332/6304 | M4.144 receipt | VERIFIED |
| Parameter rows | 6 | M4.144 receipt | VERIFIED |
| Exact floor | 43054 | direct exact/below probe | VERIFIED |
| Below-floor result | 43053 / failure / `unsupported-runtime-input` | direct probe | VERIFIED |
| Exact-floor loop census | `for=42666`, `while=388` | observer probe | VERIFIED |
| Promotion budget/headroom | 49152 / 6098 | current policy + exact floor | VERIFIED |
| Production budget/headroom | 65536 / 22482 | current policy + exact floor | VERIFIED |
| Promotion disposition | GO | exact floor is below both budgets | VERIFIED |
| Runtime byte ceilings for M4.146 | 1469472/2938944 | 367368 × 4 × 2 | VERIFIED |
| Source, policy, ABI, coverage | unchanged | evidence-only boundary | DECIDED |

## Implementation Options

### A. Exact current-source combined-headroom receipt — selected

Load and authenticate M4.144, migrate only `expressionsources` in memory,
reproduce the exact structural boundaries, execute at 43,053 and 43,054,
verify observer parity, public/internal handler parity, source roundtrip, and
freeze the GO disposition plus source identities in canonical JSON.

This matches the established release-proof chain and leaves policy mutation in
the next slice.

### B. Promote the candidate in M4.145 — rejected

This would conflate evidence generation with policy mutation and queue
publication. It would remove the immutable pre-promotion boundary used by every
earlier combined promotion.

### C. Reuse M4.127 headroom evidence — rejected

M4.127 authenticates a different source root, KIR/profile candidate, composite,
and exact floor. Its algorithm is reusable; its receipt is not.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-145-structural-runtime-headroom/spec.md` | add | Frozen claims and evidence |
| `scripts/kern-canonicalizer/combined-headroom-m4-145-measure.mjs` | add | Current-source structural/runtime measurement |
| `scripts/kern-canonicalizer/combined-headroom-m4-145.{mjs,json}` | add | Immutable evidence owner and receipt |
| `scripts/kern-canonicalizer/combined-headroom-m4-145.test.mjs` | add | Exact/below, parity, mutation, and fresh-process oracles |
| `scripts/kern-canonicalizer/coverage-m4-145-central.mjs` | add | Release-blocking exact receipt assertion |
| `scripts/kern-canonicalizer/coverage-status-m4-145.{mjs,test.mjs}` | add | Exact M4.146 handoff |
| `scripts/check-kern-canonicalizer-coverage.mjs` | update | Integrate M4.145 assertion/status |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | Updated implementation provenance |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | regenerate | Updated implementation provenance |

No KERN source, policy JSON, runtime implementation, public package, ABI,
coverage base, or parameter signature is in scope.

## Acceptance Criteria

- [x] RED tests fail because the M4.145 measurement/receipt/status owners do
      not exist.
- [x] The exact M4.144 receipt digest, embedded input commit, and published
      commit bind.
- [x] The sole candidate remains `expressionsources`, one tool, one function,
      and six parameter rows.
- [x] Candidate KIR encodes and roundtrips at exactly 367368/122/7136.
- [x] Each KIR axis fails one unit below with its exact structural code.
- [x] Flattened profile rows are exactly 205/332/6304.
- [x] Runtime arguments use exactly the candidate profile limits.
- [x] Budget 43053 fails with `unsupported-runtime-input`.
- [x] Budget 43054 succeeds with empty diagnostics/events and a return value.
- [x] The exact-floor observer census is `for=42666`, `while=388`, total 43054.
- [x] Observed and unobserved internal envelopes are byte-equivalent.
- [x] Exact-floor public/internal handler envelopes are equivalent.
- [x] Emitted source reparses and reproduces the exact structural KIR bytes.
- [x] Promotion headroom is 6098 and production headroom is 22482.
- [x] Receipt disposition is promotion GO and names only M4.146 next.
- [x] Receipt mutation, decoration, accessors, prototypes, sharing, cycles,
      symlinks, noncanonical bytes, stdin import, and direct-invocation drift
      fail closed.
- [x] Live policy, KERN source, runtime, ABI, coverage, and parameter signatures
      remain unchanged.
- [x] Derived summaries converge byte-identically.
- [x] Focused and complete canonicalizer gates pass.
- [x] The complete current KERN 5 fitness wall passes.
- [x] `agon review -e claude,codex,agy` has no unresolved material finding.
- [ ] Agon-signed commit is fetched/rebased before one push and remote main
      verifies.

## Out of Scope

- Promoting KIR/profile or derived runtime-byte limits.
- Publishing or consuming the `expressionsources` parameter queue.
- Editing `canonicalizer.kern`, `expressionsources`, or `quotesource`.
- Resolving the six `quotesource` character blockers.
- KIR v1 freeze, frontend/compiler ownership, fixed point, interpreter cutover,
  RC/stable release, Fable, or a KERN 5 completion claim.

## Deploy Order

M4.145 lands as additive evidence over M4.144. M4.146 may then consume only
the exact M4.144 candidate and M4.145 GO receipt to promote the six KIR/profile
limits, derive the two runtime byte ceilings, and publish the six-row migration
queue. No mixed-version public contract exists because M4.145 changes no
public surface.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.145 disposition was unknown before measurement | The candidate succeeds at the 49,152 promotion boundary | M4.145 is a GO evidence slice, not a bottleneck investigation |
| Binary search was required to find the exact floor | A successful observer run reports exactly 43,054 attempted loop iterations; direct 43,053/43,054 probes prove adjacency | The committed oracle can use exact adjacent witnesses and record the loop census |
| Authenticating only runtime depth and collection length was sufficient | Runtime byte, string, diagnostic, and event limits also affect the executed envelope | The measurement harness now binds the complete active runtime-limit object |
| Status field checks could independently authenticate the handoff | Exact receipt validation already authenticates every field before formatting | The formatter now has one fail-closed validation owner without unreachable duplicate checks |
| Generic loader branches were covered by receipt mutation tests | Symlink, invalid-JSON, and noncanonical-byte rejection require direct loader fixtures | Dedicated temporary receipt fixtures now exercise all three branches |
| The exact-floor parity oracle should move out of the canonicalizer gate | The four executions independently prove adjacency, observer transparency, public parity, and roundtrip against current source | The live proof remains release-blocking despite its deliberate runtime cost |
