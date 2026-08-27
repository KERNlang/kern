# Review Analyzer False-Positive Regressions

**Status:** SPEC
**Date:** 2026-08-27
**Confidence:** 0.95

## Executive Summary

Add RED, source-grounded regressions for the analyzer false positives blocking
the review-quality work associated with KERN PR #558. The eventual production
fix must preserve positive detections while making taint argument positions,
promise-observer handling, assertion narrowing, collection reads, and canonical
TypeScript diagnostics precise. This slice contains only the claim-tagged spec
and failing tests; production implementation, commit, push, and deployment are
out of scope.

## Current State / Root Cause

- **[VERIFIED]** The AST taint pass scans every argument of a resolved command
  sink and records the first tainted argument, with no command API/options
  argument-position policy (`packages/review/src/taint-ast.ts:339-383`). The
  RED fixture covers `spawn`, `spawnSync`, and `execFile` options `{ input }`
  while retaining tainted executable/argv controls
  (`packages/review/tests/taint.test.ts:199-219`).
- **[VERIFIED]** `floating-promise` recognizes a two-arm `.then` only when both
  callbacks pass `isInlineSynchronousHandler`; property-based logging and an
  exit-code assignment are rejected by `hasOnlySafeObserverCalls`
  (`packages/review/src/rules/base.ts:114-145, packages/review/src/rules/base.ts:222-269`).
  A normal ignored chain remains a positive control
  (`packages/review/tests/false-positives.test.ts:190-210`).
- **[VERIFIED]** Assigned `.find()` results are scanned only for regex-like
  null guards or an early-exit `if`; `assert.ok(identifier)` is not recognized
  (`packages/review/src/rules/null-safety.ts:64-136`). The RED fixture also
  proves unrelated and post-dereference assertions must continue to fire
  (`packages/review/tests/rules-null-safety.test.ts:32-67`).
- **[VERIFIED]** `unused-collection` treats `sort()` and `reverse()` as neither
  writes nor reads, so a populated array returned through either operation is
  reported as unused (`packages/review/src/rules/dead-logic.ts:324-404`). The
  discarded-operation controls remain positive
  (`packages/review/tests/rules-dead-logic.test.ts:237-263`).
- **[VERIFIED]** TypeScript diagnostics are emitted from the ts-morph project
  and only filtered for known review-mode noise; TS1470 is not in that filter
  (`packages/review/src/external-tools.ts:177-204, 268-284, 368-381`). For an
  actual `package.json {"type":"module"}`, NodeNext `allowJs/checkJs`
  project and `src/tool.mjs` containing `import.meta.url`, the canonical helper
  returns no TS1470 while `reviewFile` currently emits it
  (`packages/review/tests/tsc-canonical-packaged-runtime.test.ts:40-72`).
- **[VERIFIED]** Boundary mutation extraction is assignment-based and scopes
  `global*` roots as global and `state/store/cache/registry` roots as shared
  (`packages/review/src/mappers/ts-concepts/extractors/state-mutation.ts:6-33`).
  Filter/includes reads must not create boundary findings, while shared/global
  assignments must retain their specific positive rule IDs
  (`packages/review/tests/concepts/concept-rules.test.ts:11-34`).

## What Already Works

- **[VERIFIED]** Existing tests cover ordinary floating chains, awaited and
  returned promises, and synchronous observer shapes
  (`packages/review/tests/false-positives.test.ts:28-188`).
- **[VERIFIED]** Existing null-safety tests cover truthy guards, compound
  early-exit guards, optional chaining, and direct unchecked `.find()` access
  (`packages/review/tests/rules-null-safety.test.ts:6-30, 69-85, 177-190`).
- **[VERIFIED]** Existing collection tests prove returned arrays and genuinely
  discarded populated arrays (`packages/review/tests/rules-dead-logic.test.ts:212-235`).
- **[VERIFIED]** Existing boundary concept tests prove the native rule matches
  a global/shared concept and rejects local scope
  (`packages/review/tests/native-concept-rules.test.ts:238-268`).
- **[VERIFIED]** Canonical diagnostic filtering already rejects ts-morph-only
  errors absent from `tsc -b` (`packages/review/src/external-tools.ts:926-1078`;
  `packages/review/tests/tsc-canonical-packaged-runtime.test.ts:8-38`).

## Implementation Plan

One production plan is sufficient: make each classifier semantic at its live
entry point, preserve the existing positive controls, then run the targeted
regressions and the package gate. Alternative broad text/regex carve-outs are
strawmen because they would admit the unrelated/post-dereference and ignored
chain cases explicitly pinned by this spec.

1. Define command-specific taint argument positions so `options.input` is not a
   command sink, while executable and argv remain sink arguments.
2. Permit only synchronous two-arm observer callbacks whose operations are
   synchronous logging/exit-code handling; retain ordinary ignored chains as
   findings.
3. Recognize an exact `assert.ok(identifier)` assertion only when it precedes
   the dereference in the same flow region; do not treat unrelated or late
   assertions as guards.
4. Count returned `sort()`/`reverse()` values as collection reads and retain
   discarded collection findings.
5. Align review diagnostics with the canonical `tsc -b` result for this ESM
   `.mjs` case without suppressing genuine canonical diagnostics.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/review/src/taint-ast.ts` | future modify | command argument-position semantics |
| `packages/review/src/rules/base.ts` | future modify | synchronous CLI observer classification |
| `packages/review/src/rules/null-safety.ts` | future modify | exact assertion narrowing |
| `packages/review/src/rules/dead-logic.ts` | future modify | collection read operation set |
| `packages/review/src/external-tools.ts` | future modify | canonical TS1470/noise decision |
| `packages/review/src/mappers/ts-concepts/extractors/state-mutation.ts` | future inspect/modify only if needed | preserve boundary read/assignment distinction |
| `packages/review/tests/false-positives.test.ts` | modified RED | CLI positive/negative fixtures |
| `packages/review/tests/taint.test.ts` | modified RED | command options and executable/argv fixtures |
| `packages/review/tests/rules-null-safety.test.ts` | modified RED | assertion narrowing fixtures |
| `packages/review/tests/rules-dead-logic.test.ts` | modified RED | sort/reverse read/discard fixtures |
| `packages/review/tests/concepts/concept-rules.test.ts` | modified guardrails | boundary-mutation read/assignment fixtures |
| `packages/review/tests/tsc-canonical-packaged-runtime.test.ts` | modified RED | canonical ESM TS1470 fixture |

## Acceptance Criteria

- [ ] `spawn`, `spawnSync`, and `execFile` with tainted `options.input` do not
  emit `taint-command`.
- [ ] Tainted command executable and argv still each emit `taint-command`.
- [ ] Top-level CLI `.then(success, failure)` with synchronous logging and
  `process.exitCode` handling emits no `floating-promise`.
- [ ] Ordinary ignored promise chains still emit `floating-promise`.
- [ ] An earlier exact `assert.ok(identifier)` suppresses the corresponding
  `.find()` unchecked finding.
- [ ] Unrelated and post-dereference assertions do not suppress
  `unchecked-find`.
- [ ] A populated collection returned via `sort()` or `reverse()` emits no
  `unused-collection`.
- [ ] A populated collection whose `sort()` or `reverse()` result is discarded
  still emits `unused-collection`.
- [ ] Canonical-clean ESM `.mjs` `import.meta.url` emits no TS1470 from review.
- [ ] `filter`/`includes` reads emit no boundary-mutation finding, while shared
  and global property assignments retain `boundary-mutation-shared` and
  `boundary-mutation-global`.

## Out of Scope

- Production analyzer changes, broad rule redesign, unrelated rule families,
  KERN PR mutation, commits, pushes, publishing, deployment, and CI.
- Suppressing any TypeScript diagnostic that canonical `tsc -b` reports.
- Treating arbitrary callback calls, arbitrary assertions, or discarded
  collection operations as handled/read.

## Open Questions

None for this RED slice. The implementation must preserve the explicit negative
controls; any broader policy discovered during implementation should be split
into a new spec.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| A single `spawn(executable, argv, { input })` call would expose all three taint arguments in review output. | The AST scan stops at the first tainted argument per call, and root-cause grouping collapses repeated `input` sinks. | The RED fixture uses separate executable, argv, and options calls so the expected two retained findings are discriminating. |
| `runTSCDiagnosticsFromPaths` alone would reproduce the TS1470 false positive. | Its canonical `tsc -b` comparison already drops the ts-morph-only TS1470; `reviewFile` emits the unfiltered diagnostic. | The regression asserts both canonical cleanliness and `reviewFile` suppression. |

## RED Evidence

Ran from the isolated worktree with Node v22.22.0 after the package build:

```text
pnpm --filter @kernlang/review build                         # passed
node scripts/run-node-tests.mjs "packages/review/tests/false-positives.test.ts"
  FAIL: top-level CLI ... expected undefined, received floating-promise
node scripts/run-node-tests.mjs "packages/review/tests/taint.test.ts"
  FAIL: expected 2 taint-command findings, received 3
node scripts/run-node-tests.mjs "packages/review/tests/rules-null-safety.test.ts"
  FAIL: assert.ok(identifier) expected 0 unchecked-findings, received 1
node scripts/run-node-tests.mjs "packages/review/tests/rules-dead-logic.test.ts"
  FAIL: sort/reverse return expected 0 unused-collection findings, received 1
node scripts/run-node-tests.mjs "packages/review/tests/concepts/concept-rules.test.ts"
  PASS (boundary negative and positive guardrails)
node scripts/run-node-tests.mjs "packages/review/tests/tsc-canonical-packaged-runtime.test.ts"
  FAIL: reviewFile emitted TS1470; canonical helper assertion passed
```

