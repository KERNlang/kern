# KERN 5 R2 M4.97 — Resumable Helper-Frame Optimization

**Status:** IMPLEMENTED — COMPLETE FITNESS AND REVIEW GATES PASSED
**Date:** 2026-07-27
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.96 commit
`c01b42f151be03da47fffc942b43f9a157f4d53e` attributes the residual
canonicalizer wall to nested pure-helper misses closing and restarting the
active parent helper generator.

[VERIFIED] Across only 500 additional retained iterations, the exact
`comparisonOperandsOk` witness caused 78,379 rolled-back loop entries, 91
additional `expressionsources` executions, and 38,788,004 additional cache-key
input code units.

[DECIDED] M4.97 replaces whole-parent replay with an internal resumable
helper-dependency yield. The active sequence generator remains open, the
dependency is evaluated and cached by the existing trampoline, and execution
retries only the current admitted pure node.

[DECIDED] This slice does not promote the 74/95/832 profile, migrate
`comparisonOperandsOk`, raise any runtime/KIR/ABI limit, or claim KERN 5
completion.

[VERIFIED] The optimized exact witness fails at 53,085 and succeeds at 53,086
with public/internal parity. This leaves 12,450 iterations of production
headroom but exceeds the 49,152 promotion budget by 3,934, so M4.97 remains an
explicit profile-promotion NO-GO.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`c01b42f151be03da47fffc942b43f9a157f4d53e`.

[VERIFIED] M4.96 receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-96.json` has SHA-256
`3a80e118c7621923401596d7ab16fd013067363daa88b819817c0208e2afe391`.

[VERIFIED] The dominant authenticated replay edges are:

- `expressionsources -> stringat`: 83;
- `expressionsources -> validexpressionidentifier`: 6; and
- `expressionsources -> validbinaryop`: 2.

## Root Cause

[VERIFIED] `evalInternalMachineHelperValue` throws
`InternalEffectMachineHelperPending` when a nested helper cache miss occurs
while `helperEvaluationDepth` is nonzero.

[VERIFIED] That exception escapes `runInternalEffectMachineSequence`, closing
the helper body generator. `drivePreparedHelper` restores the pre-attempt
iteration budget, evaluates the dependency, and invokes the parent body again
from its first node.

[VERIFIED] The current accounting preserves the public iteration-budget
contract, but it cannot preserve CPU work, cache-key serialization, local
environment setup, or already completed sequence/loop progress.

[VERIFIED] A narrower reuse of the existing class-resumable value evaluator is
insufficient: the exact witness invokes nested helpers from `if` conditions and
ordinary assignments, which remain owned by synchronous portable evaluators.

## Runtime Contract

[DECIDED] Add one internal-only helper-dependency request to the effect-machine
generator yield union. It is not a public runtime handler option, capability,
trace event, KIR node, or serialized envelope.

[DECIDED] `runInternalEffectMachineSequence` catches
`InternalEffectMachineHelperPending` at the nearest active sequence node,
yields the dependency request, and retries that same node after the request is
resolved.

[VERIFIED] Pure-helper admission excludes capability, print, try, and lambda
nodes. Admitted leaf evaluation computes values before mutating bindings or
trace state. Retrying the current node after a nested pure-helper miss therefore
does not duplicate observable effects.

[DECIDED] `drivePreparedHelper` owns a stack of open helper generators. A
helper-dependency yield pushes the missing dependency without restoring the
iteration budget. When the dependency completes and is cached, the parent
generator resumes and the current node observes the cache hit.

[DECIDED] A capability request yielded from a pure-helper frame remains a
fail-closed side-effect error. A helper-dependency request escaping to the
top-level sync/async provider drivers is an internal invariant violation.

[DECIDED] Default-off diagnostics remain allocation-free. M4.97 may add a
guarded `helper-frame-suspend` event, but it must not construct diagnostic
metadata when no observer exists.

## Implementation Plan

1. Add a RED regression proving a nested helper miss currently executes the
   parent more than once and rolls back completed loop work.
2. Add the private helper-dependency yield type and nearest-sequence retry
   boundary.
3. Replace restart-based prepared-helper execution with a stack of open helper
   generators and shared call-environment construction.
4. Remeasure the exact M4.96 witness under bounded budgets and publish immutable
   M4.97 optimization evidence without changing the active profile.
5. Run focused helper/runtime/canonicalizer tests, complete Node 22 KERN 5
   fitness, and mandatory high-risk independent review.

## Implemented Evidence

[VERIFIED] The RED regression failed because `sumTwo` executed three times
across two nested `identity` misses. After the resumable frame implementation,
the parent executes once, consumes exactly two iterations, emits two guarded
frame-suspension diagnostics, and reports no parent restart.

[VERIFIED] The exact candidate at budget 34,500 now records 34,500 attempted and
retained loop iterations with zero rollbacks. Relative to M4.96 at the same
budget, it removes 78,645 loop attempts, 91 `expressionsources` executions, and
40,175,005 cache-key input code units.

[VERIFIED] At exact floor 53,086, `expressionsources` executes once and the
runtime resolves 1,817 internal helper-frame suspensions without any whole
parent restart. Budget 53,085 fails; budget 53,086 succeeds with byte-identical
public/internal envelopes.

[VERIFIED] Immutable receipt
`scripts/kern-canonicalizer/runtime-cost-m4-97.json` has SHA-256
`9b0d7ce9b03c1b8f54e701172c66cb3b834fa9476e346d8ba25e82bf21549e71`.
It preserves M4.96 as exact pre-optimization history and publishes
`production-headroom-authenticated-promotion-budget-no-go` for M4.98.

[VERIFIED] Focused helper, diagnostics, class-helper, M4.96 history, M4.97 live
reproduction, hostile receipt, fresh-process, and coverage-status tests pass.

[VERIFIED] Complete Node 22 `pnpm fitness:kern-5` passes, including workspace,
release, ownership, runtime, canonicalizer, conformance, native, capstone,
self-host validator, application-fixture, and browser-budget gates.

[VERIFIED] The mandatory high-risk role-lens review completed with all six
usable independent engines. It produced no verified finding, eight
needs-check findings, one speculative finding, and nine nits.

[VERIFIED] Manual verification converted two needs-check findings into real
correctness defects: `expression-v1` fail-close paths swallowed internal helper
suspension, and exceptional helper-frame cleanup walked outer-first. The first
now has a RED-to-green regression covering ordinary and native-regex trials;
the runtime rethrows only the private suspension signal. Cleanup now unwinds
inner-first. Nearby wrappers defensively preserve the same private signal.

[VERIFIED] The remaining credible review concerns are runtime cost, not M4.97
correctness: retrying a pure node may recompute its argument/cache key after
each dependency, and deep helper chains can therefore remain quadratic. These
are the explicit M4.98 optimization target.

[VERIFIED] After those correctness fixes, the complete Node 22 KERN 5 fitness
wall passed again. A targeted independent Claude follow-up then completed with
zero verified, needs-check, or speculative findings and four non-blocking nits.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.96 commit `c01b42f1`.
- [x] M4.96 receipt and dominant replay edges are grounded.
- [x] RED proves whole-parent replay on a nested helper miss.
- [x] Parent helper execution remains one frame across nested cache misses.
- [x] Completed loop iterations are never restored or repeated.
- [x] Exact candidate output remains byte-identical.
- [x] Exact bounded counters prove zero whole-parent restarts.
- [x] Public runtime handler ABI and capability dispatch remain unchanged.
- [x] Active profile and runtime/KIR/policy limits remain unchanged.
- [x] Focused, complete, and full Node 22 KERN 5 gates pass.
- [x] Independent high-risk review has no unresolved verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- Retrying a current node can duplicate an admitted observable mutation.
- A helper-dependency request can escape into public capability dispatch.
- Resumption changes helper cache identity, recursion depth, iteration
  accounting, trace bytes, or error normalization.
- The exact candidate requires a profile or runtime-limit change.
- Evidence cannot distinguish preserved frames from replay hidden elsewhere.

## Out of Scope

- Profile promotion or parameter migration.
- Replacing JSON cache-key serialization.
- New language syntax, public runtime hooks, KIR v1 freeze, runtime cutover,
  semantic self-hosting, RC/stable release, Fable work, or a KERN 5 completion
  claim.
