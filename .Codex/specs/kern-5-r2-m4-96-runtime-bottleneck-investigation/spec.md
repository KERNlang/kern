# KERN 5 R2 M4.96 — Runtime Bottleneck Investigation

**Status:** IMPLEMENTED — COMPLETE FITNESS AND INDEPENDENT REVIEW PASSED
**Date:** 2026-07-27
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.95 commit
`f3f2f8ccfd37746e5c06bbd25623887326845f4e` freezes the exact residual
frontier at 89/109 base-complete functions, 17 legacy `fn.params` blockers, and
no parameter-ready queue.

[VERIFIED] Deterministic structural ranking still selects exactly
`examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk`
at candidate profile 74/95/832. The witness has 53 nodes, 95 properties, 832
values, and 24 parameter rows.

[VERIFIED] M4.93 removed repeated complete table validation and proved the
`tablesok` owner succeeds at exact iteration floor 1,075. The full public
`canonicalize` handler nevertheless did not reach a terminal envelope during a
bounded 840-second observation at the unchanged 65,536 production ceiling.

[DECIDED] M4.96 attributes that remaining delay with bounded deterministic
diagnostics. It does not repeat an unbounded observation, raise limits, promote
74/95/832, migrate `comparisonOperandsOk`, or claim KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`f3f2f8ccfd37746e5c06bbd25623887326845f4e`.

[VERIFIED] Immutable input receipt identities are:

- M4.95 residual analysis
  `f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928`;
- current coverage summary
  `134be0baa2805e64259c77fd919042dd9c7599541604196ab9aba5baec69a204`;
  and
- current prerequisite summary
  `a1fc571e661be453c7e1a490e65712e8b8cc5318f1941cf2ba80972302b40383`.

[VERIFIED] Pre-slice implementation identities are:

- helper trampoline
  `2fa466ec281ec166c837c8d0e2598377cbb660dcbbc1b60f0fae0a4e3d2b97e8`;
- effect-machine sequence
  `83c3143a549878aa238c12ba33ed71fff64afcdf63be858a40da1cdb7c5abbac`;
- public runtime handler
  `f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1`;
- canonicalizer main source
  `8c4266b646738c7a07dcc252bd8426adee299bff62542b5b484d5fb1c7a92ae1`;
  and
- statement helper source
  `158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667`.

## Diagnostic Contract

[DECIDED] The diagnostic must execute the exact migrated witness through the
public `canonicalize` identity and unchanged composition. Synthetic helper-only
measurements may supplement, but cannot replace, that entry path.

[DECIDED] Every observation must terminate through a fixed iteration budget or
an external process deadline short enough for the test wall. Wall-clock time
may identify a hotspot but cannot be the authenticated result because machine
load is nondeterministic.

[DECIDED] Deterministic evidence must separate at least:

1. committed loop iterations;
2. helper preparations;
3. helper cache hits and misses;
4. parent-frame restarts caused by nested helper misses; and
5. cache-key serialization input volume.

[EXPECTED] The remaining bottleneck is outside ordinary committed loop
consumption. The leading candidate is the synchronous scalar-helper trampoline:
a nested cache miss throws `InternalEffectMachineHelperPending`, restores the
iteration budget, evaluates the dependency, and restarts the parent helper from
its first node. Large table arguments are also serialized for cache lookup on
each preparation.

[DECIDED] Instrumentation must be internal, additive, default-off, and unable to
change public runtime envelopes, iteration accounting, cache keys, helper
results, or accepted input. Production callers must pay no diagnostic callback
or allocation cost when it is absent.

## Implementation Plan

1. Add a RED bounded diagnostic test at the absent internal observer boundary.
2. Thread a default-off observer through the internal handler/effect-machine
   path without exposing it in the public runtime-handler ABI.
3. Measure the exact candidate at bounded budgets and freeze deterministic
   attribution plus source/receipt identities.
4. Add hostile/default-off parity tests proving instrumentation cannot alter
   envelopes or helper semantics.
5. Integrate the immutable M4.96 receipt and status handoff, run focused and
   complete Node 22 gates, then mandatory high-risk independent review.

## Implemented Evidence

[VERIFIED] The observer test failed RED before the internal observer boundary
was implemented, then passed after the observer was threaded through the
internal runtime-envelope and effect-machine paths.

[VERIFIED] The exact public `canonicalize` entry terminates deterministically at
both authenticated diagnostic budgets. At 34,000 retained iterations it records
34,266 attempted loop entries and 266 rolled-back entries. At 34,500 retained
iterations it records 113,145 attempted loop entries and 78,645 rolled-back
entries.

[VERIFIED] The 500-retained-iteration delta causes 78,379 additional rolled-back
loop entries, 91 additional `expressionsources` executions, and 38,788,004
additional cache-key input code units. The 91 parent restarts comprise 83
`stringat`, six `validexpressionidentifier`, and two `validbinaryop` nested
helper misses.

[VERIFIED] The default-off observer receives frozen scalar metadata, swallows
observer exceptions, and preserves exact observed/unobserved envelope parity.
It is absent from the public `KernRuntimeHandlerOptions` contract.

[VERIFIED] Receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-96.json` authenticates the
exact source and M4.93/M4.95 inputs. Its SHA-256 is
`3a80e118c7621923401596d7ab16fd013067363daa88b819817c0208e2afe391`.

[VERIFIED] Focused observer, receipt, status, reproduction, coverage-writer, and
coverage-checker gates passed. The complete Node 22
`pnpm fitness:kern-5` wall passed after regenerating the coverage summaries for
the changed compiled-core identity.

[VERIFIED] The mandatory high-risk six-engine role review at
`review-1785116207430-3gmdy2` caught one verified blocker: diagnostic event
objects and loop metadata were allocated even when the observer was absent.
The fix guards every event construction site, adds the missing resumable
helper-frame `helper-execute` event, and prevents caller async options from
overriding the authoritative internal observer.

[VERIFIED] After those review-driven fixes, focused diagnostic and receipt tests
passed without changing the authenticated counters, and the complete Node 22
`pnpm fitness:kern-5` wall passed again. Targeted security-lens confirmation at
`review-1785119070483-lzwyi1` returned 1/1 reviewer successful with no verified,
needs-check, or speculative findings. Its sole non-blocking nit suggested
deduplicating helper environment setup; that behavior-preserving refactor is
deferred to avoid expanding this diagnostic slice.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.95 commit `f3f2f8cc`.
- [x] Exact witness, structural profile, prior non-terminal observation, and
      receipt identities are grounded.
- [x] RED fails at the absent bounded diagnostic observer.
- [x] Exact public-entry execution terminates under every diagnostic budget.
- [x] Deterministic counters identify the dominant remaining mechanism.
- [x] Instrumented and uninstrumented runs return byte-identical envelopes.
- [x] Public ABI, profile, runtime, KIR, and policy limits remain exact.
- [x] M4.93 and M4.95 receipt bytes remain exact.
- [x] Focused, complete, and full Node 22 KERN 5 gates pass.
- [x] Independent high-risk review has no unresolved verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- The exact candidate cannot be bounded without changing production semantics.
- Instrumentation changes iteration accounting, cache behavior, helper results,
  public envelopes, or public ABI.
- Evidence cannot distinguish helper replay from ordinary loop work.
- Any proposed optimization depends only on wall-clock timing.
- The slice requires raising profile, runtime, KIR, or ABI limits.

## Out of Scope

- Implementing the resulting runtime optimization.
- Promoting property/value rows or migrating `comparisonOperandsOk`.
- Projection-depth/node, unknown-expression, or exception-flow support.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.
