# KERN 5 R2 M3.27 Direct Same-Root Class Methods

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.99
**Design challenge:** `tribunal-1784158180420-k09frr-kern-5-r2-m3-27-class-behavior`
(3/3 requested engines completed)

## Executive Summary

M3.27 adds explicit pure instance-method behavior to the same-root,
machine-owned class state shipped in M3.26. The accepted method contains exactly
one scalar `return` and cannot mutate state or emit effects. Calls are explicit
whole-leaf scalar expressions on an owned instance. Getters, inheritance,
`super`, nested method calls, helper mixing, deferred method inputs, and non-root
environments remain on compatibility.

This slice does not promote `runner-classes-state` to unified. It proves the
first behavior owner while leaving hidden getter execution and inheritance
dispatch for a later post-M3.28 class slice.

## Current State / Root Cause

- **VERIFIED:** the linker already creates same-root `RunnerClassMemberBinding`
  records for methods, with portable parameter names, exactly one KERN handler,
  body nodes, and owner-class identity (`packages/core/src/runner.ts:594-663`).
- **VERIFIED:** compatibility resolves direct method calls from a tagged class
  receiver and invokes the member with `runnerThis`; it also owns `super` and
  inherited lookup, which remain excluded here
  (`packages/core/src/ir/semantics/portable-reference-evaluator.ts:214-290`).
- **VERIFIED:** compatibility snapshots fields and rejects every scalar-returning
  method that mutates an instance field
  (`packages/core/src/ir/semantics/portable-reference-body.ts:281-310`).
- **VERIFIED:** M3.26 snapshots fields and constructors but deliberately erases
  methods and rejects every class with behavior
  (`packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts:23-42,74-99`).
- **VERIFIED:** the machine portable evaluator owns field reads but returns
  not-handled for every class call
  (`packages/core/src/ir/semantics/portable-machine-evaluator.ts:8-17`).
- **VERIFIED:** machine-owned instances carry a private per-run owner and field
  access rejects receivers outside that owner
  (`packages/core/src/ir/semantics/internal-effect-machine-class-runtime.ts:182-220`).
- **VERIFIED:** the linker metadata fact currently skips method/getter maps and
  therefore does not prove their entries or bodies immutable
  (`packages/core/src/ir/semantics/runner-machine-scope.ts:21-50`).
- **VERIFIED:** generic scalar call shape admits functions and fixed namespaces,
  but rejects arbitrary member calls
  (`packages/core/src/ir/semantics/portable-machine-shape.ts:37-90`).

The root cause is a missing explicit method boundary across four existing
owners: linker metadata integrity, class-graph admission/snapshotting, whole-leaf
call shape, and owned receiver dispatch. Parser and compatibility semantics
already exist and do not need replacement.

## What Already Works

- M3.26 construction, declared-field initialization, restricted constructors,
  reads/writes, deferred construction, async suspension identity, and no-retry
  selection remain unchanged.
- The shared portable evaluator already provides scalar arithmetic, comparisons,
  text/decimal namespace calls, and deterministic scalar validation.
- The root structure preflight already clones bindings and simulates leaves
  before the first provider.
- Compatibility remains the oracle and fallback for every excluded class shape.

## Contract (Verified and Frozen)

> Verified against the cited source on 2026-07-16. Every oracle below rests on
> a VERIFIED repository seam and the completed tribunal; no ASSUMED or OPEN
> claim is promoted into the build.

| Field / Behavior | Contract                                                                                                                                                              | Evidence                                              | Tag      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| Source member    | linker-created non-static, non-async, non-stream method with exactly one KERN handler                                                                                 | `runner.ts:639-663`                                   | VERIFIED |
| Class scope      | exact linker-owned class in the selected root module; no imports/aliases                                                                                              | M3.26 graph owner                                     | FROZEN   |
| Metadata         | exact method-map entries, member records, params, handler, and body descriptors remain linker-owned and unchanged                                                     | `runner-machine-scope.ts:21-86`; acceptance           | FROZEN   |
| Pure body        | exactly one `return value="<portable scalar>"` leaf                                                                                                                   | acceptance                                            | FROZEN   |
| Purity           | method body contains no mutation, capability, effect, throw, control flow, or nested body                                                                             | `portable-reference-body.ts:281-310`; acceptance      | FROZEN   |
| Receiver         | direct owned identifier receiver only; no `new C().m()`, alias transport, optional call, `super`, or cross-module lookup                                              | `portable-reference-evaluator.ts:214-290`; acceptance | FROZEN   |
| Arguments        | exact arity; each argument is an already-admitted portable scalar expression and cannot contain another class/helper call                                             | shared scalar shape; acceptance                       | FROZEN   |
| Call position    | the complete value of a root `let`, `print`, or `return` leaf; no nesting in arithmetic, conditions, capability input, constructor/method expressions, or collections | acceptance                                            | FROZEN   |
| Method calls     | no method-to-method calls, recursion, helpers, capabilities, effects, mutation, throw/control flow, or nested bodies                                                  | acceptance                                            | FROZEN   |
| Dispatch         | machine snapshot resolves the method; private receiver owner must match preflight or the active run                                                                   | M3.26 owner; acceptance                               | FROZEN   |
| Fallback         | any excluded metadata/body/call shape selects compatibility before provider dispatch; selected machine failures never retry                                           | source selector contract                              | VERIFIED |
| Manifest         | `runner-classes-state` remains legacy and advances to `M3.29-class-getter-inheritance-ownership`; non-root remains M3.28                                              | tribunal verdict; acceptance                          | FROZEN   |

## Implementation Options

### Option A - Pure direct methods (selected)

Snapshot and admit the restricted method map, prove method bodies pure, admit
only whole-leaf direct calls, and dispatch them through the existing machine
portable host. This matches compatibility behavior without hidden getter
execution or non-root transactions.

### Option B - Methods plus getters

Rejected. Compatibility may execute a getter when an ordinary field read misses
(`portable-reference-evaluator.ts:225-239`), introducing hidden execution into
syntax M3.26 currently proves as a state read.

### Option C - Methods plus inheritance and `super`

Rejected. It crosses defining-module identity, inherited member resolution,
constructor ordering, `super` activation, and non-root transaction boundaries.

## Blast Radius

| File                                                        | Action           | Reason                                                               |
| ----------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `.Codex/specs/kern-5-r2-m3-27-direct-class-methods/spec.md` | add              | frozen cross-owner contract                                          |
| `runner-machine-scope.ts`                                   | edit             | bind method-map entries and member bodies to the private linker fact |
| `internal-effect-machine-class-graph.ts`                    | edit             | validate/snapshot pure methods and resolve direct calls              |
| `internal-effect-machine-class-instance.ts`                 | add              | centralize private receiver ownership and exact receiver lookup      |
| `internal-effect-machine-class-runtime.ts`                  | edit             | preflight method expressions and execute owned direct dispatch       |
| `portable-machine-evaluator.ts`                             | edit             | delegate class-method leaves to the machine owner                    |
| `portable-machine-shape.ts`                                 | edit             | admit a class method only as a complete let/return shape             |
| `internal-effect-machine-leaf.ts`                           | edit             | admit whole-value print method calls without widening scalar nesting |
| `internal-effect-machine-leaf-result.ts`                    | add              | keep print/return result handling below the source-size ceiling      |
| class preflight/helper modules                              | format-only edit | restore repository lint compliance without changing behavior         |
| focused method tests                                        | add              | RED/GREEN dispatch, purity fallback, tamper, and async identity      |
| convergence manifest/checker/tests                          | edit             | record M3.27 evidence while keeping class state deferred             |
| KERN 5 fitness policy/package script                        | edit             | bind the aggregate wall to the M3.27 convergence target              |
| release train                                               | edit after gates | completion evidence and next boundary                                |

## Acceptance Criteria

- [x] A linked same-root class with a pure direct method selects and executes on
      the machine through public sync and real-async source APIs.
- [x] A parameterized pure method returns the same portable scalar as
      compatibility without mutating receiver state.
- [x] Direct method calls work only as the complete value of root `let`, `print`,
      or `return`; nested calls select compatibility before provider dispatch.
- [x] Wrong arity, missing method/field, optional receiver/call, class aliases,
      helper calls, deferred arguments, method-to-method calls, effects, control
      flow, any assignment, and missing/non-scalar returns select
      compatibility before provider dispatch.
- [x] Getters, setters, static/async/stream members, inheritance, and `super`
      remain compatibility paths.
- [x] Caller mutation/replacement of method maps, member records, params,
      handlers, or body nodes after linking cannot alter selected execution and is
      rejected before invoking accessors or providers.
- [x] Two overlapping async runs cannot share receivers or method metadata
      snapshots.
- [x] Runtime imports no portable reference evaluator/body or async reference
      runner and contains no catch-and-retry path.
- [x] `runner-classes-state` remains deferred with exact M3.29 follow-up;
      `non-root-environment` remains exact M3.28.
- [x] Every touched handwritten source/test file remains below 500 lines.
- [x] Focused tests, source convergence/import closure, browser wall, and
      `pnpm fitness:kern-5` pass.
- [x] Final `agon review -e claude,codex,agy` completes with every verified
      finding fixed or explicitly adjudicated against current source.

## Completion Evidence

- The design tribunal completed with all three requested engines:
  `tribunal-1784158180420-k09frr-kern-5-r2-m3-27-class-behavior`.
- The focused suite proved public source parity, synchronous and asynchronous
  dispatch, exact receiver and metadata ownership, body snapshots across
  suspension, and every frozen compatibility boundary in this specification.
- The first review exposed nested direct calls inside `if` and `branch` bodies.
  RED tests reproduced machine selection below root depth; the class graph now
  rejects those calls before provider dispatch, and both regressions pass.
- The exact post-fix `pnpm fitness:kern-5` wall passed: 432/432 conformance
  fixtures, 109/109 class cases, 233 native cases, 48/48 checker fixtures with
  36 abstain attempts rejected, 39/39 validator lines, and 40 application
  fixtures on three legs plus whole-app Express/FastAPI boot.
- The required browser wall passed at 134 modules, 1,420,434 raw bytes, 311,803
  gzip bytes, 48 ms cold execution, and 75 ms median browser execution.
- The post-fix review completed with all three engines at
  `review-1784163854849-9ss1uc-kern-5-r2-m3-27-direct-class-met`. Its verified
  packaging finding is closed by staging the three new implementation/test
  files. The repeated nested-array snapshot claim is rejected against the
  recursive own-descriptor walker and the body-tamper regressions.
- The final staged review completed 3/3 with zero verified, needs-check, or
  speculative findings at
  `review-1784164189010-7qz4nu-kern-5-r2-m3-27-direct-class-met`.

## Out of Scope

- Getters/setters, static members, inheritance, `super`, overridden dispatch,
  imported/re-exported classes, or module switches.
- Any method mutation, method recursion/composition, method values, callbacks,
  or instance escape.
- Class/helper mixing, deferred capability values in method arguments, or
  method calls in capability inputs and structured expressions.
- Non-root `SemanticEnv` transactions or promotion of the full class row.

## Open Questions

None. The selected option has no ASSUMED or OPEN claims.

## Deploy Order

M3.27 was developed against the pushed M3.26 head. The mandatory pre-push
fetch decides delivery ancestry: rebase onto merged `origin/main` and publish a
fresh M3.27 branch when M3.26 is present there; otherwise retain the stacked
ancestry without pushing the old branch after its PR merges. During version
skew, old runtimes continue selecting compatibility for all methods; new
runtimes select machine only for the exact pure direct-method graph. Rollback
removes method admission/dispatch and restores the M3.26 non-empty method-map
guard. No persistent data or public serialized ABI changes.

## Corrections Log

| Original Claim                                                        | Reality                                                                                    | Impact                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Read-only getters are safer than mutating methods.                    | KERN compatibility can invoke getters implicitly on a missing field read.                  | Keep property reads state-only; own explicit calls first.                                  |
| M3.27 can close the entire class blocker.                             | Direct methods do not own getters, inheritance, `super`, or non-root transactions.         | Keep the manifest row deferred and advance its follow-up.                                  |
| A restricted mutating method can be added without M3.28 transactions. | Compatibility rejects and rolls back every instance mutation in a scalar-returning method. | M3.27 admits pure return-only methods; changing method mutation semantics is out of scope. |
