# KERN 5 R2 M4.143 — Post-M4.142 Residual Frontier

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-30
**Base commit:** `91a2fda256cc16b62bd2faf1f2fdfb8cf0581f90`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.142 is published on `main` at
`91a2fda256cc16b62bd2faf1f2fdfb8cf0581f90`. It consumes the exact
`canonicalize` parameter queue, advances current canonicalizer coverage to
110/112, leaves exactly two legacy-parameter blockers, and publishes an empty
parameter-ready queue.

[VERIFIED] The two residual functions are `quotesource` with two parameter
rows and `expressionsources` with six. `quotesource` projects to profile
54/82/932, below the active 202/308/4493 limits, but retains six exact
canonical text-character blockers. `expressionsources` now reaches the
structural projector and fails specifically at `projection.limit-nodes`; its
profile remains unavailable.

[DECIDED] M4.143 publishes a current-state residual-analysis receipt. It
changes no KERN source, limit, runtime behavior, ABI, coverage base, or
parameter representation. Because the only available profile is below all
active limits, the exact profile-widening result is zero evaluated settings,
zero actionable candidates, and a null selected action.

[DECIDED] M4.144 owns structural projection analysis for
`expressionsources`, while preserving the separate `quotesource`
canonical-surface blocker.

## Inputs

- [VERIFIED] Input commit:
  `91a2fda256cc16b62bd2faf1f2fdfb8cf0581f90`.
- [VERIFIED] Current cumulative base: 110/112.
- [VERIFIED] Structural base:
  `kern.kir-canonicalizer.profile.m4.141`.
- [VERIFIED] Coverage implementation SHA-256:
  `7f7d25c5dc4ff389789ab72af5a7831ff180bacb354d1f648db19d189a295e24`.
- [VERIFIED] Archived M4.142 coverage-summary SHA-256:
  `c7d7d31a693df43302368fd1dc19e8f0488bdceea74d76da3037e3e54aa735cc`.
- [VERIFIED] Archived M4.142 prerequisite-summary SHA-256:
  `98aaa464c5b4da345664949dd865a006b8ac8580775695b74705ae31b25c3ef3`.
- [VERIFIED] Coverage policy SHA-256:
  `3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877`.
- [VERIFIED] Function-facts SHA-256:
  `72c677544b56de4b6e714d0f124f88f7f3db811b6442aeb6c8cb405ad7b9998f`.
- [VERIFIED] Current profile limits: 202 node rows, 308 property rows, 4493
  value rows.
- [VERIFIED] Current legacy-parameter blockers: two.
- [VERIFIED] Exact reason-assignment SHA-256:
  `1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106`.

## Contract

| Claim | Tag |
|---|---|
| Analyze exact live post-M4.142 policy and source | DECIDED |
| Freeze exactly two residual legacy functions | DECIDED |
| Preserve each id, tool, parameter-row count, profile, and reason set | DECIDED |
| Record `quotesource` profile rows as 54/82/932 | DECIDED |
| Preserve its six exact canonical text-character blockers | DECIDED |
| Record `expressionsources` profile rows as null | DECIDED |
| Record its reason as exactly `projection.limit-nodes` | DECIDED |
| Evaluate no profile setting equal to current limits | DECIDED |
| Publish zero actionable profile candidates and a null action | DECIDED |
| Preserve current source, coverage, KIR, profile, runtime, and ABI | DECIDED |
| Preserve all earlier receipts byte-identically | DECIDED |
| Route M4.144 to structural projection analysis | DECIDED |

## Exact Assignments

1. `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource`
   - Parameter rows: 2
   - Profile rows: 54/82/932
   - Reasons:
     - `if.properties.cond.expression.text.character-u007f`
     - `if.properties.cond.expression.text.character-u0080`
     - `if.properties.cond.expression.text.character-u009f`
     - `if.properties.cond.expression.text.character-u2028`
     - `if.properties.cond.expression.text.character-u2029`
     - `if.properties.cond.expression.text.character-ufeff`
2. `examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`
   - Parameter rows: 6
   - Profile rows: null
   - Reasons:
     - `projection.limit-nodes`

## Design

### Receipt owner

Add an M4.143 residual-analysis owner following the immutable format-3 receipt
contract. The owner measures the live policy and source, authenticates the
exact post-M4.142 semantic baseline, migrates the two legacy signatures only
in memory, partitions the empty ready queue from the exact residual set, and
derives all receipt rows from measured facts.

The checked-in receipt must contain canonical JSON-only data, be bound to an
independent SHA-256 constant, reject mutation, decoration, sharing, cycles,
symlinks, and byte drift, and reproduce in a fresh locale-independent process.
The exact rolling coverage and prerequisite summaries from the M4.142 input
commit must be archived byte-identically and independently pinned before the
rolling summaries advance. The release checker must deep-compare a live M4.143
remeasurement with the published receipt.

### Candidate enumeration

Candidate profile settings may be created only when an observed projected
profile requires at least one active profile limit to increase. `quotesource`
is below all three limits, so it must not create a redundant setting.
`expressionsources` has no projected profile because it exceeds a structural
KIR node limit. Therefore:

- profile rows available: one function;
- evaluated changed profile settings: zero;
- actionable profile candidates: zero; and
- selected next action: null.

### Status and handoff

The exact status reports no actionable profile widening across the
two-function residual frontier and directs M4.144 to investigate structural
projection and canonical-surface blockers. It makes no KERN 5 completion,
self-hosting cutover, RC/stable release, or Fable claim.

## Implementation Plan

1. Add RED M4.143 owner, mutation, fresh-process, central, and status tests.
2. Implement the live residual measurement and write the canonical receipt.
3. Wire M4.143 into the current coverage checker without rewriting M4.132
   history.
4. Regenerate coverage summaries and prove semantic frontier stability.
5. Run focused, complete canonicalizer, full KERN 5, and independent high-risk
   review gates before publication.

## Acceptance Criteria

- [ ] RED tests fail before the M4.143 owner/status modules exist.
- [x] The exact M4.142 baseline and implementation/policy/fact digests bind.
- [x] Exact M4.142 rolling coverage/prerequisite bytes are archived and pinned.
- [x] The central release checker reproduces the published receipt live.
- [x] The parameter-ready queue is empty.
- [x] Exactly two residual functions remain.
- [x] Assignments and reason digest match this specification.
- [x] `quotesource` reports exactly 54/82/932 profile rows.
- [x] Its six canonical-surface blockers remain exact.
- [x] `expressionsources` reports null profile rows and only
      `projection.limit-nodes`.
- [x] Exactly one residual function has available profile rows.
- [x] No changed profile setting is evaluated.
- [x] No actionable profile candidate is published.
- [x] Selected action is null.
- [x] Receipt mutation, decoration, sharing, cycles, symlinks, and byte drift
      fail closed.
- [x] M4.132 and all later M4.133-M4.142 evidence remain exact.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- Live input differs from commit `91a2fda2`.
- Coverage differs from 110/112 or the legacy population differs from two.
- Any residual id, row count, tool, profile, or reason differs.
- Any earlier checked-in receipt changes.
- A profile widening appears actionable.
- Implementation requires changing KERN source or active limits.

## Out of Scope

- Migrating or rewriting `quotesource` or `expressionsources`.
- Changing canonical character or expression grammar.
- Promoting KIR, profile, runtime, or ABI limits.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or declaring KERN 5 complete.

## Release Boundary

[DECIDED] M4.143 ends with an immutable exact analysis of the post-M4.142
two-function residual frontier. It does not widen limits or modify KERN source.
M4.144 may investigate `expressionsources` structural projection and the
separate `quotesource` canonical-surface blocker.

## Verification Evidence

[VERIFIED] The M4.143 receipt digest is
`22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e`.
It binds the published M4.142 coverage implementation digest
`7f7d25c5dc4ff389789ab72af5a7831ff180bacb354d1f648db19d189a295e24`,
policy digest
`3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877`,
function-facts digest
`72c677544b56de4b6e714d0f124f88f7f3db811b6442aeb6c8cb405ad7b9998f`,
and exact reason-assignment digest
`1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106`.

[VERIFIED] Focused M4.142/M4.143 regressions, the complete 672-test
canonicalizer matrix, 58 golden/idempotence/KIR fixtures, 8 measured
witnesses, 3 profile-limit fixtures, 250 hostile fixtures, the full workspace
test and infrastructure gates, rule coverage, and the KERN 5 fitness wall
pass.

[VERIFIED] Independent high-risk Agon review used the full six-engine usable
roster. No completed reviewer reported a blocker, and every needs-check item
was audited against the current files with no unresolved material finding.
