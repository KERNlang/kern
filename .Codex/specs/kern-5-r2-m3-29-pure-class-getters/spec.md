# KERN 5 R2 M3.29 Pure Same-Root Class Getters

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.96
**Design challenge:** `tribunal-1784169646311-2b2mx5-kern-5-r2-m3-29-class-getter-inh`
(3/3 requested engines completed; AGAINST one-shot class-row promotion)

## Executive Summary

M3.29 adds pure same-root instance getters to the private source-runner class
owner shipped in M3.26 and M3.27. A getter has no parameters, contains exactly
one scalar `return`, reads only declared direct fields through `this`, and is
used only as the complete value of a root `let`, `print`, or `return` leaf.
Field presence wins over getter lookup, matching compatibility semantics.

This slice deliberately does not promote the broad `runner-classes-state` row.
Inheritance, overrides, `super`, imported/re-exported class scopes, effectful
class frames, getter composition, and helper/class mixing remain an exact
M3.30 follow-up. The convergence manifest gains a truthful unified getter row
while retaining one deferred full-class row.

## Current State / Root Cause

- **VERIFIED:** linker-created `RunnerClassBinding` records already carry
  getter maps and the private metadata owner snapshots getter entries and
  descriptor graphs without invoking accessors (`runner-machine-scope.ts`).
- **VERIFIED:** class graph admission snapshots methods but currently replaces
  getters with an empty map and rejects every non-empty getter map
  (`internal-effect-machine-class-graph.ts`).
- **VERIFIED:** compatibility checks declared instance fields first and invokes
  a class getter only when the field is absent
  (`portable-reference-evaluator.ts:214-239`).
- **VERIFIED:** the machine already owns exact class-instance identity,
  constructor/field state, pure direct method environments, metadata snapshots,
  and async registry isolation (`internal-effect-machine-class-runtime.ts`).
- **VERIFIED:** the convergence manifest has one deferred row,
  `runner-classes-state`, with M3.29 as its current follow-up.

The missing behavior is not host property access. It is an explicit private
getter lookup and evaluation path using the already-owned class registry and
receiver. Treating a getter as a JavaScript descriptor or ordinary object
property would violate the no-hidden-host-execution boundary.

## Frozen Contract

| Surface | M3.29 contract | Tag |
| --- | --- | --- |
| Metadata | exact linker-owned same-root getter map; snapshotted with class graph | FROZEN |
| Getter shape | zero params, exactly one childless scalar `return` | FROZEN |
| Body domain | literals, getter-local scalar operators/templates, and direct declared `this.field` reads only | FROZEN |
| Lookup | exact owned identifier receiver; declared field presence wins; missing field then exact getter | FROZEN |
| Use site | complete value of a root `let`, `print`, or `return` only | FROZEN |
| State | getter cannot assign, allocate, call helpers/methods/getters, emit effects, or mutate receiver | FROZEN |
| Preflight | invalid getter metadata/body/use rejects before any earlier provider dispatch | FROZEN |
| Suspension | selected run uses the snapshotted getter/member body across async suspension | FROZEN |
| Isolation | no host getter, proxy, or caller-replaced metadata executes during admission or evaluation | FROZEN |
| Manifest | add `runner-class-pure-getters` unified; keep `runner-classes-state` deferred to M3.30 | FROZEN |

## Selected Design

1. Snapshot admitted getter members alongside methods in the existing private
   class graph.
2. Validate each getter with the same descriptor-owned member rules plus a
   zero-parameter, single-return contract.
3. Resolve getter reads only through the private class registry and exact
   machine-owned instance receiver. Never consult a host property descriptor.
4. Evaluate the getter return inside a private class member environment with
   `runnerThis` bound to the same receiver and the current machine state bound
   only for the evaluation.
5. Add a direct-getter shape predicate so nested expressions, capability inputs,
   nested control bodies, and aliases remain compatibility paths.

## Rejected Designs

### Full getter/inheritance/super/import promotion

Rejected by tribunal. Exact base-constructor ordering, override dispatch,
`super` receiver identity, imported scope ownership, and active effectful class
frames are separate lifecycle contracts and are not implemented by the current
same-root class owner.

### JavaScript property descriptors

Rejected. KERN getters are linker metadata and KERN bodies. Installing or
reading host getters would add hidden host execution and proxy/accessor risk.

### Arbitrary getter expressions at any depth

Rejected for this slice. Hidden dispatch inside capability records, helper
arguments, control bodies, or composed expressions would widen preflight and
effect-order guarantees beyond M3.29. Direct complete leaves are auditable and
match the M3.27 method boundary.

## Blast Radius

| File | Action |
| --- | --- |
| `internal-effect-machine-class-graph.ts` | admit/snapshot pure getter metadata and direct lookup |
| `internal-effect-machine-class-runtime.ts` | preflight and evaluate pure getters |
| `portable-machine-evaluator.ts` | pass evaluator recursion to getter host leaf |
| `portable-machine-shape.ts` | admit only complete direct getter reads |
| `internal-effect-machine-leaf-result.ts` | direct print/return getter shape |
| focused getter test | RED/GREEN source parity, safety, suspension, negatives |
| convergence manifest/checker/tests | add getter evidence; advance remaining blocker |
| KERN 5 policy/package script | bind M3.29 convergence evidence |
| release train/spec | completion evidence after gates |

## Acceptance Criteria

- [x] Linked public source with a pure scalar getter selects the machine and
      matches compatibility output through sync and real-async source APIs.
- [x] A getter can return literals or scalar expressions over declared direct
      fields; field presence takes precedence over a same-named getter.
- [x] Direct getter reads work only as complete root `let`, `print`, or `return`
      values and preserve exact receiver identity without mutation.
- [x] Parameters, multiple/empty bodies, effects, assignments, control flow,
      allocation, helper/method/getter calls, free bindings, missing fields,
      nested use, aliases, optional access, and capability inputs reject before
      provider dispatch.
- [x] Host accessors/proxies and post-link getter map/member/body mutation are
      rejected without invocation; a selected run uses its snapshot across
      async suspension.
- [x] Inheritance, overrides, `super`, imported/re-exported classes, and active
      effectful class frames remain compatibility paths.
- [x] `runner-class-pure-getters` becomes unified while
      `runner-classes-state` remains deferred to exact M3.30 follow-up.
- [x] Every touched handwritten source/test file stays below 500 lines.
- [x] Focused suites, convergence/import closure, browser wall, and exact
      `pnpm fitness:kern-5` pass.
- [x] Final `agon review -e claude,codex,agy` completes with every verified
      finding fixed or explicitly adjudicated.

## Completion Evidence

- Focused class state/method/getter suite: 57/57 passed.
- Source-runner convergence: 253/253 focused tests, 11/11 mutation guards,
  and the 499-line convergence checker passed.
- Exact `pnpm fitness:kern-5`: passed on 2026-07-16 with 432/432
  cross-target fixtures, 109/109 class fixtures, 233 native cases, 48/48
  checker fixtures with 36 accept-but-abstain attempts rejected, 39/39
  validator verdicts, and 40 application fixtures on three legs plus
  whole-app boot.
- Browser wall: 135 modules, 1,436,090 raw bytes, 314,151 gzip bytes, 49 ms
  cold import/execute, and 81 ms median browser import/execute.
- Terminal Agon review: 3/3 engines completed with zero verified,
  needs-check, or speculative findings and three nits
  (`review-1784171484079-3dpyff-kern-5-r2-m3-29-pure-class-gette`).

## Out of Scope

- Inheritance, base/derived constructor order, overrides, and all `super` forms.
- Imported, re-exported, aliased, or cross-module class lookup.
- Getter-to-getter, getter-to-method, method-to-getter, helper/class, recursion,
  effects, async getters, mutation, allocation, or composite returns.
- Nested getter use inside structured expressions, capability inputs, loop or
  branch bodies, constructor arguments, field initializers, or method bodies.
- Promotion or deletion of the full `runner-classes-state` blocker.

## Deploy Order

M3.29 stacks on the pushed M3.28 head until the prerequisites appear on
`origin/main`. Immediately before push, fetch and inspect `origin/main`; create
a fresh M3.29 branch only when the stack is present there, otherwise rebase and
push the current stacked branch once.

## Corrections Log

| Initial idea | Verified reality | Decision |
| --- | --- | --- |
| M3.29 can close the last class row in one slice. | Current code intentionally excludes several independent class lifecycles. | Add a getter sub-row and retain a truthful M3.30 full-class blocker. |
| Descriptor snapshots already own getter behavior. | They own metadata inspection only, not execution semantics. | Add an explicit private registry lookup and KERN-body evaluator. |
| Pure getters are harmless anywhere a member is parsed. | Hidden dispatch at arbitrary depth widens preflight/effect ordering. | Restrict M3.29 to complete root leaves. |
