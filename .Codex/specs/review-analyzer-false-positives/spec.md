# Review Analyzer False-Positive Regressions

**Status:** IMPLEMENTED
**Date:** 2026-08-27
**Confidence:** 0.95

## Executive Summary

The delivered analyzer changes preserve positive detections while making taint
argument positions, promise-observer handling, assertion narrowing, collection
reads, and canonical TypeScript diagnostics precise. The source-grounded RED
regressions remain as the implementation oracle.

## Implemented Behavior

- **[VERIFIED]** Command sink options are structural object-literal arguments;
  direct `options.input` is exempt — unless the executable literal is a
  stdin-program interpreter (`sh`, `bash`, `node`, `python*`, …) whose argv is
  absent, empty, or flags-only, because that process executes stdin — while
  executable, argv, and execution
  options remain sinks (`packages/review/src/taint-sink-arguments.ts`;
  `packages/review/tests/taint.test.ts`). Callback function bodies are not
  traversed as sink arguments. Object property names do not create internal
  taint while computed names, shorthand values, and property values do
  (`packages/review/src/taint-ast.ts`; `packages/review/tests/taint-ast.test.ts`).
- **[VERIFIED]** `floating-promise` recognizes a two-arm `.then` only when both
  callbacks are synchronous observers (`packages/review/src/rules/then-observer.ts`).
  A normal ignored chain remains a positive control
  (`packages/review/tests/false-positives.test.ts:190-210`).
- **[VERIFIED]** An earlier exact `assert.ok(identifier)` is a `.find()` guard;
  unrelated and post-dereference assertions remain findings
  (`packages/review/src/rules/null-safety.ts`; `packages/review/tests/rules-null-safety.test.ts`).
- **[VERIFIED]** Returned `sort()` and `reverse()` values count as collection
  reads, while discarded operations remain findings
  (`packages/review/src/rules/collection-operations.ts`; `packages/review/tests/rules-dead-logic.test.ts`).
- **[VERIFIED]** TS1470 comparison uses a read-only, non-incremental canonical
  compiler check. It filters only suspected diagnostics, scopes the trigger to
  the reviewed file, and reuses both successful and failed results only for a
  directory request (`packages/review/src/external-tools.ts`;
  `packages/review/src/index.ts`; `packages/review/tests/tsc-canonical-packaged-runtime.test.ts`).
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
- **[VERIFIED]** Canonical diagnostic filtering rejects suspected ts-morph-only
  errors absent from a read-only `tsc -p` check while retaining unrelated
  diagnostics (`packages/review/src/external-tools.ts`;
  `packages/review/tests/tsc-canonical-packaged-runtime.test.ts:8-38`).

## Implementation

1. Defined structural command-options handling and callback boundaries.
2. Added synchronous two-arm observer handling while preserving floating
   promise positives.
3. Added exact assertion narrowing with negative controls.
4. Counted consumed collection ordering operations as reads.
5. Added read-only canonical TypeScript diagnostics with request-scoped caching.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/review/src/taint-ast.ts` | modified | internal command-sink taint traversal |
| `packages/review/src/taint-sink-arguments.ts` | modified | structural command-options semantics |
| `packages/review/src/rules/then-observer.ts` | modified | synchronous CLI observer classification |
| `packages/review/src/rules/null-safety.ts` | modified | exact assertion narrowing |
| `packages/review/src/rules/collection-operations.ts` | modified | collection read operation handling |
| `packages/review/src/external-tools.ts` | modified | canonical TS1470/noise decision |
| `packages/review/src/index.ts` | modified | request-scoped canonical diagnostics |
| `packages/review/src/mappers/ts-concepts/extractors/state-mutation.ts` | future inspect/modify only if needed | preserve boundary read/assignment distinction |
| `packages/review/tests/false-positives.test.ts` | modified RED | CLI positive/negative fixtures |
| `packages/review/tests/taint.test.ts` | modified RED | command options and executable/argv fixtures |
| `packages/review/tests/taint-ast.test.ts` | modified RED | object property-name taint boundary |
| `packages/review/tests/rules-null-safety.test.ts` | modified RED | assertion narrowing fixtures |
| `packages/review/tests/rules-dead-logic.test.ts` | modified RED | sort/reverse read/discard fixtures |
| `packages/review/tests/concepts/concept-rules.test.ts` | modified guardrails | boundary-mutation read/assignment fixtures |
| `packages/review/tests/tsc-canonical-packaged-runtime.test.ts` | modified RED | canonical ESM TS1470 fixture |

## Acceptance Criteria

- [x] `spawn`, `spawnSync`, and `execFile` with tainted `options.input` do not
  emit `taint-command`.
- [x] Tainted command executable and argv still each emit `taint-command`.
- [x] Object property names do not create internal taint, while computed,
  shorthand, and property values still do.
- [x] Top-level CLI `.then(success, failure)` with synchronous logging and
  `process.exitCode` handling emits no `floating-promise`.
- [x] Ordinary ignored promise chains still emit `floating-promise`.
- [x] An earlier exact `assert.ok(identifier)` suppresses the corresponding
  `.find()` unchecked finding.
- [x] Unrelated and post-dereference assertions do not suppress
  `unchecked-find`.
- [x] A populated collection returned via `sort()` or `reverse()` emits no
  `unused-collection`.
- [x] A populated collection whose `sort()` or `reverse()` result is discarded
  still emits `unused-collection`.
- [x] Canonical-clean ESM `.mjs` `import.meta.url` emits no TS1470 from review.
- [x] Read-only canonical diagnostics retain real errors, write no build
  artifacts, and cache a failed directory-request build.
- [x] `filter`/`includes` reads emit no boundary-mutation finding, while shared
  and global property assignments retain `boundary-mutation-shared` and
  `boundary-mutation-global`.

## Out of Scope

- Further broad rule redesign, unrelated rule families, KERN PR mutation,
  commits, pushes, publishing, deployment, and CI.
- Suppressing any TypeScript diagnostic that the canonical check reports.
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
| `runTSCDiagnosticsFromPaths` alone would reproduce the TS1470 false positive. | Its canonical comparison already drops the ts-morph-only TS1470; `reviewFile` emits the unfiltered diagnostic. | The regression asserts both canonical cleanliness and `reviewFile` suppression. |

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
