# KERN 5 R2 M3.26 Same-Root State-Only Class Ownership

**Status:** COMPLETE
**Date:** 2026-07-15
**Confidence:** 0.93
**Design challenge:** `tribunal-1784145734073-rml02a-kern-5-r2-m3-26-sequencing`
(3/3 requested engines completed)

## Executive Summary

M3.26 introduces the first machine-owned runner-class state without widening
into inheritance, methods, getters, imported module scopes, helper receiver
identity, or non-root environment transactions. The accepted class shape is a
same-root state container: declared own fields, an optional synchronous KERN
constructor whose body only assigns portable scalar expressions to those own
fields, direct `new Class(...)`, and direct scalar field reads/writes.

The source selector validates the complete accepted class graph and every
constructor before machine selection. Unsupported class shapes remain on
compatibility before execution. Selected machine failures never retry legacy.
`runner-classes-state` remains a deferred convergence row until the later
method/inheritance slice closes the full class contract.

## Current State / Root Cause

- **VERIFIED:** the linker emits `RunnerClassBinding` with distinct `fields`,
  optional `constructor`, `methods`, `getters`, `extendsName`, and defining
  `module` identity (`packages/core/src/ir/semantics/semantic-env.ts:145-165`;
  `packages/core/src/runner.ts:590-632`).
- **VERIFIED:** the compatibility value is an explicit tagged instance with
  `className`, null-prototype `fields`, and optional defining module
  (`semantic-env.ts:168-173`;
  `portable-reference-evaluator.ts:143-179`).
- **VERIFIED:** compatibility construction initializes field expressions,
  invokes constructors, supports inheritance/super, and delegates bodies to
  `runPortableReferenceBody` (`portable-reference-body.ts:50-135`). That owner
  may not enter the browser-safe machine import graph.
- **VERIFIED:** direct machine admission rejects every non-empty
  `runnerClasses` map and every active class receiver
  (`internal-effect-machine-admission.ts:107-121,133-147`).
- **VERIFIED:** helper graph admission independently rejects non-empty class
  state (`internal-effect-machine-helper-graph.ts:148-157`).
- **VERIFIED:** the machine let path accepts only empty `new Map()` and rejects
  all other `new` expressions (`internal-effect-machine-leaf.ts:324-338`).
- **VERIFIED:** the machine portable evaluator returns not-handled for class
  member and method leaves (`portable-machine-evaluator.ts:4-9`).
- **VERIFIED:** the canonical machine sequence and one state-owned child body
  runner already execute helper bodies with shared iteration state
  (`internal-effect-machine-types.ts:47-59`;
  `internal-effect-machine.ts:58-76`).
- **VERIFIED:** source selection completes structure/helper preflight before
  choosing machine, and execution contains no catch-and-retry path
  (`runtime-envelope/source-runner-engine.ts:73-126`).
- **VERIFIED:** only `runner-classes-state` and `non-root-environment` remain
  deferred after merged M3.25
  (`scripts/source-runner-convergence-manifest.json`, milestone
  `KERN-5-R2-M3.25`).
- **VERIFIED:** `internal-effect-machine-leaf.ts` is 491 lines and
  `internal-effect-machine-structure.ts` is 494 lines (`wc -l`, 2026-07-15),
  so class logic must be extracted.

The root cause is an ownership gap, not missing parser/linker semantics. Class
metadata and the canonical statement runner exist, but the machine has no
validated class registry, allocation owner, receiver-aware scalar host, or
own-field assignment path.

## What Already Works

- Parser, semantic validation, linker class identity, duplicate detection, and
  acyclic inheritance validation remain unchanged.
- The compatibility runner remains the oracle for every excluded class shape.
- Machine state binding is already scoped to generator advancement and survives
  async capability suspension without sharing per-run helper state.
- Portable scalar evaluation, root preflight, trace ordering, and caller-owned
  iteration budgets remain canonical owners.

## Contract (Verified and Frozen)

> Baseline evidence was verified against the cited source on 2026-07-15. Rows
> tagged FROZEN are M3.26 acceptance contracts derived from that baseline.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Registry | exact linker-owned same-root class map, copied into one machine state | `semantic-env.ts:133-173`; acceptance | FROZEN |
| Class shape | no `extendsName`, methods, getters, static/imported state, or host descriptors | `RunnerClassBinding`; acceptance | FROZEN |
| Fields | unique linker-declared own fields; missing initializer starts as `undefined` exactly as compatibility | `runner.ts:590-632`; `portable-reference-body.ts:64-75` | FROZEN |
| Initializers | absent or portable scalar expression evaluated in the root environment | compatibility initializer path at `portable-reference-body.ts:64-75` | FROZEN |
| Constructor | absent or synchronous KERN handler; unique portable params; body contains only direct own-field `assign =` leaves | acceptance | FROZEN |
| Allocation | only root-sequence `let name=x value="new LocalClass(args...)"`; args are portable scalars and arity is exact | acceptance | FROZEN |
| Receiver | instance identity is local to one machine run and one root environment | `RunnerClassInstanceValue`; acceptance | FROZEN |
| Read | `instance.declaredField` yields a portable scalar; missing/uninitialized fields fail deterministically | shared portable host contract | FROZEN |
| Write | direct root-sequence `assign target="instance.declaredField" op="="`; no branch/loop mutation, new fields, aliases, `+=`, index, or nested receiver | acceptance | FROZEN |
| Preflight | complete class metadata, constructor shapes, root construction, reads, and writes validate before first capability provider | existing selector rule at `source-runner-engine.ts:73-93` | FROZEN |
| Async parity | class state survives a later root capability suspension; constructors cannot suspend or emit effects | existing machine generator at `internal-effect-machine.ts:101-134` | FROZEN |
| Helpers | any reachable helper/class interaction remains compatibility; class instances cannot be helper args/returns | M3.25 correction log; acceptance | FROZEN |
| Fallback | unsupported graph selects compatibility before execution; selected failures never retry | `source-runner-engine.ts:73-126` | VERIFIED |

## Implementation Options

### Option A - State-only same-root classes (selected)

Add an extracted class graph/preflight module and an extracted class runtime
module. Store the admitted registry in `InternalEffectMachineState`. Reuse the
canonical machine sequence for the restricted constructor body and the shared
portable evaluator for scalar initializer/argument/RHS evaluation. Add only
small delegates to the two near-limit machine files.

This creates allocation, receiver identity, mutation, and suspension-safe state
without importing or duplicating the compatibility class interpreter.

### Option B - Transactional non-root environments first

Rejected for M3.26 by the tribunal. It crosses parent lookup, caller mutation,
rollback, aliasing, helper re-entry, and async suspension before the class
receiver contract is proven.

### Option C - Full classes in one slice

Rejected. Methods, getters, helper instance transport, inheritance, `super`,
recursive dispatch, and rollback are separate semantic contracts and would
force large edits around both near-500-line files.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m3-26-class-state/spec.md` | add/update | frozen contract and evidence |
| `internal-effect-machine-class-graph.ts` | add | exact class-map validation, constructor shape, selector preflight |
| `internal-effect-machine-class-runtime.ts` | add | allocation, synthetic preflight values, field read/write |
| `internal-effect-machine-types.ts` | edit | per-run admitted class registry |
| `internal-effect-machine.ts` | edit | install class registry before root preflight/runtime |
| `internal-effect-machine-admission.ts` | edit | admit only an owned class map for the source path |
| `internal-effect-machine-helper-graph.ts` | edit | reject reachable helper/class mixing, not every state-only class root |
| `internal-effect-machine-leaf.ts` | minimal edit | delegate class let and dotted assignment |
| `portable-machine-evaluator.ts` | edit | delegate class field reads; methods remain not-handled |
| `portable-machine-shape.ts` | minimal edit | recognize only admitted class construction shape |
| `source-runner-engine.ts` | edit | class preflight before machine selection |
| focused machine/source-runner tests | add | RED/GREEN ownership, rejection, isolation, suspension |
| convergence guard/tests | edit | keep class row deferred but require exact M3.26 evidence |
| release train/spec | edit after gates | measured completion evidence |

## Acceptance Criteria

- [x] A local state-only class with scalar fields and a direct-assignment
  constructor selects machine in sync and immediate-async source APIs.
- [x] Construction arity, portable scalar arguments, field initializers, direct
  field reads, and direct `=` writes match compatibility stdout and completion.
- [x] The admitted registry belongs to one machine state; two overlapping async
  runs with identical class shapes in separate owned root environments cannot
  share instances or field mutations.
- [x] A capability after class construction observes the pre-suspension scalar
  field value and later reads the same receiver state.
- [x] Missing fields, undeclared writes, uninitialized reads, aliases, instance
  returns, helper instance transport, and class values in composites or
  capability inputs remain outside admission.
- [x] Any constructor capability/print/throw/control-flow/non-assign statement,
  method, getter, inheritance, `super`, imported class, async handler, or host
  metadata selects compatibility before a provider or stdout event.
- [x] Class allocation and field mutation nested under branch/loop structure
  select compatibility before execution; scalar field reads may remain nested.
- [x] Direct machine calls reject hostile/unowned class maps and class bindings
  without invoking getters, proxies, constructors, or host functions.
- [x] Preflight uses synthetic state and never mutates the runtime root class
  registry or caller bindings.
- [x] Runtime imports no portable reference evaluator/body, async reference
  runner, Node-only module, or compatibility registry.
- [x] Existing helper, budget, lambda, each, expression, and no-retry contracts
  remain green.
- [x] Every touched handwritten source/test file remains under 500 lines.
- [x] Focused tests, complete core tests, source convergence/import closure,
  browser wall, and `pnpm fitness:kern-5` pass.
- [x] Terminal `agon review -e claude,codex,agy` returns with every verified
  finding fixed or explicitly adjudicated against current source.

## RED Oracles

1. A state-only `Box` program currently selects `legacy` because the class map
   is non-empty.
2. Direct canonical execution rejects the same owned class map.
3. The machine let path rejects `new Box(...)`.
4. The machine evaluator cannot read `box.value`, and dotted assign is rejected
   as a non-portable identifier.
5. No oracle proves pre-effect rejection, async suspension identity, or
   overlapping-run isolation for class state.
6. A mutation of the class preflight/admission boundary must make at least one
   convergence test fail.

The RED suite may not turn green through `portable-reference-evaluator`,
`portable-reference-body`, catch-and-retry, a global/WeakMap registry, class
instance serialization, a hardcoded budget, or weakening compatibility tests.

## Out of Scope

- Methods, getters, setters, static members, inheritance, `super`, `this`
  outside the restricted constructor, or recursive dispatch.
- Class instances crossing helper, return, collection, record, capability, or
  module boundaries.
- Imported/re-exported classes or defining-module switches.
- Non-root `SemanticEnv` ownership or caller mutation transactions.
- Promoting `runner-classes-state` to unified or deleting compatibility.

## Open Questions

None. The selected acceptance boundary contains no ASSUMED or OPEN claim.

## Deploy Order

M3.26 starts from merged M3.25 PR #532 (`origin/main` `370bc79d`) on
`feat/kern-5-r2-m3-26-class-state`. During version skew, old and excluded class
shapes remain on compatibility; the new source package selects machine only
for the frozen state-only graph. Rollback restores the non-empty class-map
admission guard and removes the class evaluator delegates. There is no public
ABI, persistent state, or feature flag.

The full class blocker may follow only after M3.26 proves receiver identity,
constructor preflight, per-run isolation, async suspension, import closure, and
no retry. Non-root environment ownership remains the final transaction slice.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Class state should follow helpers immediately as M3.25. | The merged M3.25 tribunal selected explicit iteration-budget transport first. | M3.26 begins from a caller-configurable bounded machine. |
| Non-root environment ownership must precede any class state. | The M3.26 tribunal found the state-only same-root subset does not require parent-chain transactions. | Prove local receiver identity first; leave cross-root transactions deferred. |
| Constructor plus fields implies method dispatch. | Root expressions can construct, read, and write declared own fields without methods/getters. | Freeze a useful state-only subset and keep the manifest blocker visible. |
| The admitted registry could remain the root map reference. | A suspension oracle proved that caller replacement could change later construction in the selected run. | Snapshot class metadata into machine state and resolve runtime shapes from that snapshot. |
| Generic deferred-leaf preflight covered `new Class(deferred)`. | It evaluated deferred constructor arguments before capability completion. | Install a synthetic owned instance during shape-only preflight and defer the output without evaluating its constructor or field RHS. |
| Owned map identity was sufficient for hostile class metadata. | Map ownership does not prove that its binding records are linker-created. | Add a private linker class-binding fact and reject unowned records before any property read. |

## Completion Evidence

- `pnpm fitness:kern-5` passed on 2026-07-15: 432/432 cross-target
  conformance, 109/109 class conformance, 233 native core assertions, 48/48
  checker fixtures, 39/39 self-host validator verdicts, and the full workspace,
  ABI, import-closure, convergence, browser, and app-behavior walls.
- The required browser wall passed at 131 modules, 1,402,747 raw bytes,
  309,088 gzip bytes, 48 ms cold execution, and 79 ms median browser execution.
- The terminal `claude,codex,agy` review completed 3/3
  (`review-1784148530820-cgm3zg-kern-5-r2-m3-26-class-state`). Verified
  deferred-preflight and hostile-metadata findings were fixed and covered by
  focused regressions; the claimed void-`main` helper-registry blocker was
  rejected against the linker source.
