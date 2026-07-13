# KERN 5 R2 M3.12 Private Effect-Machine Architecture Boundary

**Status:** IN REVIEW
**Date:** 2026-07-13
**Confidence:** 0.94

## Executive Summary

Split the 464-line private effect machine into an acyclic internal family with
separate type/contract, structural-preflight, sequence-execution, and driver
owners. Preserve every current runtime result and public internal import, keep
`try: 'legacy'`, add executable architecture/routing guards, and check in a
live manifest for the complete M3.13 portable try/catch/finally acceptance
surface. Do not add linking, value, or partial unwind behavior.

The full-roster tribunal rejected a split finally/legacy-catch bridge and a
combined extraction-plus-unwind slice:
`/Users/nicolascukas/.agon/runs/tribunal-1783928293827-2te0ja-kern5-m3-12-try-unwind-boundary`.
The required confidence-threshold brainstorm converted that verdict into this
green, independently releasable architecture slice:
`/Users/nicolascukas/.agon/runs/brainstorm-1783928530713-cxxter-kern5-m3-12-shippable-extraction`.

## Current State / Root Cause

- **VERIFIED:** `internal-effect-machine.ts` is 464 lines, leaving only 36
  lines under the repository's 500-line handwritten-source limit.
- **VERIFIED:** one file currently owns the disposition and public types
  (lines 29-86), root eligibility (88-135), complete-tree structural preflight
  (197-258), every sequence frame (137-195,260-416), and both drivers
  (418-464).
- **VERIFIED:** `try` remains exactly `legacy` in the closed disposition
  (`internal-effect-machine.ts:31-50`).
- **VERIFIED:** the envelope guard forbids `referenceRun`,
  `referenceRunSequence`, `asyncReferenceRun`, and
  `asyncReferenceRunSequence` calls from the effect machine
  (`scripts/check-runtime-envelope.mjs:56-58`).
- **VERIFIED:** runtime-envelope production consumers import only the current
  `internal-effect-machine.js` entry: `internal-engine.ts` imports format,
  eligibility, and both drivers; `normalize.ts` imports the error class.
- **VERIFIED:** the existing portable `try` contract includes catch-all
  canonical throws, caught-name save/restore, cleanup-only finally, and
  completion preservation, while typed/multi-catch, implicit host errors, and
  abrupt finally are deferred (`try.ts:1-32,45-136`).

The blocker is architectural headroom, not missing semantics. Implementing any
unwind frame before extraction would either exceed the file-size policy or
create a forbidden continuation bridge into a legacy runner.

## Contract

| Behavior | M3.12 contract | Evidence | Tag |
|---|---|---|---|
| Runtime behavior | byte-identical for every currently machine-owned node | existing runtime-envelope suite | VERIFIED |
| `try` ownership | remains exactly `legacy` | disposition line 48 | VERIFIED |
| Root routing | root `try` selects legacy | `internal-engine.ts:17-24` plus disposition | VERIFIED |
| Nested routing | nested `try` rejects during complete-tree preflight before effects | branch/while/for/each containment tests | VERIFIED |
| Legacy bridge | absent from every machine-family file | current envelope guard | VERIFIED |
| Entry stability | existing imports from `internal-effect-machine.js` remain valid | two production consumers and five test consumers | VERIFIED |
| File size | every handwritten source remains below 500 lines; driver target below 300 | repository rule and current 464-line pressure | VERIFIED |
| Dependency direction | driver -> sequence/structure/types; sequence -> types/semantic leaves; structure -> types/shape leaves; types -> leaf types only | tribunal + brainstorm design | VERIFIED |
| Future unwind | M3.13 manifest is live, unique, complete, and records either root legacy routing or nested machine-preflight rejection | M3.12 acceptance below | PLANNED |

## Selected Design

### `internal-effect-machine-types.ts`

Own the exact format, closed disposition, public option interfaces, capability
effect request/state types, error class, unified-node predicate, and body-shape
predicate. It imports only runner capability types, `IRNode`, prepared
capability type, and trace/value types required by those declarations.

### `internal-effect-machine-structure.ts`

Own root bounded-environment eligibility and complete-tree structural
preflight, including branch, if/else, loop depth, and partial array-each shape
checks. It imports only types/contracts, `SemanticEnv`, and shape-only semantic
helpers. It does not import sequence execution, drivers, runtime envelope, or
legacy runners.

### `internal-effect-machine-sequence.ts`

Own registered flat-node dispatch, capability preparation/yield, trace append,
iteration-budget consumption, and the if/branch/while/for/each frame runners.
Export one `runInternalEffectMachineSequence` generator for the driver. It may
import semantic leaf helpers and machine types, but never the driver, runtime
envelope, or legacy runners.

### `internal-effect-machine.ts`

Remain the stable internal entry. Own only `runMachine`, sync/async capability
drivers, interceptor calls, and re-exports of the existing format,
disposition, option interfaces, error class, and eligibility function. Target
under 300 lines.

## Dependency Invariant

```text
internal-effect-machine.ts
  -> internal-effect-machine-sequence.ts
  -> internal-effect-machine-structure.ts
  -> internal-effect-machine-types.ts

internal-effect-machine-sequence.ts
  -> internal-effect-machine-types.ts + semantic leaves

internal-effect-machine-structure.ts
  -> internal-effect-machine-types.ts + shape leaves

internal-effect-machine-types.ts
  -> type/trace leaves only
```

No machine-family file imports `internal-effect-machine.ts` except external
consumers. No structure/types file imports sequence. The sequence file does not
need structure at runtime.

## Test-First Plan

The first RED test imports the new structure and sequence modules and asserts
the stable symbols exist, the driver source is below 300 lines, and `try`
remains legacy. It fails at compile time until the architecture exists.

Green characterization added in M3.12:

1. Root `try` remains legacy-selected.
2. A nested `try` after a capability remains rejected before dispatch.
3. Every machine-family source is under 500 lines and follows the import DAG.
4. No machine-family source contains a legacy runner call or runtime-envelope
   import.
5. The stable entry re-exports every pre-extraction consumer symbol.
6. A live JSON M3.13 contract manifest has unique categorized cases, contains
   no skip/todo/only/disabled flags, and every case records its truthful current
   legacy or machine-preflight-reject disposition.

The manifest records future semantic acceptance without committing skipped or
failing tests. M3.13 will turn one manifest case at a time RED and then green.

## M3.13 Manifest Categories

- preflight before capability dispatch in body, catch, and finally;
- caught binding value, replacement completion, and restoration;
- finally preservation for normal, return, throw, caught throw, loop break,
  and loop continue;
- abrupt finally rejection for return, throw, break, and continue;
- resumable capability parity in body, catch, and finally;
- try nested inside while, counted for, and array each;
- loops nested inside try body, catch, and finally.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `internal-effect-machine-types.ts` | add | exact shared contract and leaf predicates |
| `internal-effect-machine-structure.ts` | add | pure eligibility and structural preflight owner |
| `internal-effect-machine-sequence.ts` | add | resumable sequence/frame execution owner |
| `internal-effect-machine.ts` | reduce | stable driver and re-export facade |
| `runtime-envelope-effect-machine-architecture.test.ts` | add | source/import/entry/routing characterization |
| `fixtures/runtime-envelope-try-m3-13-contract.json` | add | live future unwind acceptance catalog |
| `runtime-envelope-try-m3-13-contract.test.ts` | add | manifest integrity and current legacy routing |
| `runtime-envelope-effect-machine.test.ts` | modify | explicit root try legacy selection |
| `check-runtime-envelope.mjs` | modify | scan the full machine family and dependency boundary |
| fitness policy/support matrix/release train | modify | publish M3.12 internal architecture oracle after gates |

## Acceptance Criteria

- [x] The first architecture test is observed RED before extraction.
- [x] Existing imports from `internal-effect-machine.js` compile unchanged.
- [x] Sync and async traces remain byte-identical for the current corpus.
- [x] `try: 'legacy'` and root-try legacy routing remain exact.
- [x] Nested try remains preflight-rejected before effects.
- [x] No machine-family file imports a legacy runner or runtime envelope.
- [x] The machine-family import graph follows the documented direction and is
  cycle-free.
- [x] The stable driver is under 300 lines and all handwritten files are under
  500 lines.
- [x] The M3.13 manifest is live, categorized, unique, skip-free, and all cases
  match their current legacy or machine-preflight-reject disposition.
- [ ] Focused architecture/runtime-envelope tests and `pnpm fitness:kern-5`
  pass.
- [ ] Terminal `agon review` with `claude,codex,agy` passes.

## Out of Scope

Any change to try/catch/finally execution, partial finally ownership, a
machine-to-legacy bridge, linking, module resolution, value-format changes,
public runtime/handler ABI, legacy-runner removal, pair/entry each ownership,
or skipped/failing tests in the committed tree.

## Deploy / Rollback

Ship extraction, guards, manifest, policy, and receipt in one signed branch
push. Rollback is one commit restoring the monolithic private machine; no
runtime format, disposition, public export, or semantic result changes.

## Corrections Log

| Original proposal | Reality | Resolution |
|---|---|---|
| Own finally-only first. | A single try node cannot cross between machine and legacy runners without a forbidden continuation bridge. | Keep all try shapes legacy until full ownership. |
| Extract and implement full try in one milestone. | The extraction is mandatory and independently risky; combining it with unwind weakens the rollback boundary. | M3.12 extracts; M3.13 owns the full existing portable contract. |
| Ship failing RED tests or unrelated linking/value work. | Release branches require green gates, and unrelated behavior dilutes the architecture slice. | Use green architecture/routing tests plus a live future-contract manifest. |
