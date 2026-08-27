# KERN 5 RT-2: Boolean `if` and early return

**Status:** READY TO BUILD
**Date:** 2026-08-27
**Base:** `fcf16612599b5624fd065d2fc8a88cb61c5d273a`
**Confidence:** 0.97

## Executive Summary

RT-2 adds the smallest executable control-flow contract missing from the
accepted F5-to-target stack: a structural `if` with an existing boolean
condition and a finite then-block that may return early. F5 already projects
this source shape, but the common linked-program admission layer currently
rejects it before RT-1, JavaScript ESM, or Python lowering can run. The slice
extends that one shared semantic representation and requires exact direct/JS/
Python behavior without introducing a parser, host-language fallback, loops,
calls, imports, or a generic KIR dispatcher.

## Current State / Root Cause

- **VERIFIED:** An F5 request containing `if cond="true"` projects to a
  structural node with `kind: "if"`, a canonical boolean `cond`, and a nested
  `return`. The direct projection probe on this base emitted that artifact on
  2026-08-27.
- **VERIFIED:** `LinkedKernKirStatement` has only `let`, `capability`,
  `print`, and `return` variants at
  `packages/core/src/kir-runtime/linked-kir-program/contracts.ts:29-39`.
- **VERIFIED:** The linker calls `assertLeaf` before statement discrimination,
  accepts only those four kinds, and requires exactly one top-level final
  return at `linked-kir-program/link.ts:116-161,196-207`. Therefore structural
  `if` is rejected as `handler-entry-unsupported` before an effect can run.
- **VERIFIED:** RT-1 runs a linear statement sequence and returns directly
  only from the current `return` arm at `kir-runtime/execute.ts:109-191`.
- **VERIFIED:** Both compilers invoke the same linker and map its exact
  `handler-entry-unsupported` code to their closed failure result at
  `compiler/kir-js-esm/index.ts:17-50` and
  `compiler/kir-python/index.ts:17-50`.

The root cause is one intentionally closed shared admission model, not a
frontend or target-code defect. Implementing target-specific `if` before the
linker would create divergent semantic selectors and violate the established
linker boundary.

## What Already Works

- **VERIFIED:** F5 authenticates and projects the needed structural `if`;
  RT-2 does not change source syntax or KIR schema.
- **VERIFIED:** RT-1 already owns tagged values, request validation, limits,
  cancellation, ordered events, return-envelope construction, and failure
  envelopes (`kir-runtime/execute.ts:76-196`).
- **VERIFIED:** JavaScript and Python targets already specialize the shared
  linked statement sequence and own their target kernels:
  `compiler/kir-js-esm/emitter.ts:139-205` and
  `compiler/kir-python/emitter.ts:135-224`.
- **VERIFIED:** The optional CLI shadow already consumes the projection, RT-1,
  and both compiler package exports, then compares all three normalized
  outcomes (`packages/cli/src/kir-shadow/run-report.ts:30-52`). It needs no
  RT-2 code change for a capability-free, zero-parameter boolean-literal
  fixture.

## Contract (Verified)

> Verified against the listed source files at `fcf16612599b5624fd065d2fc8a88cb61c5d273a` on 2026-08-27.

| Client / boundary | RT-2 behavior | Evidence | Tag |
| --- | --- | --- | --- |
| F5 projection producer | Emit the existing structural `if` node; RT-2 consumes it and does not reparse source. | Projection probe above; `frontend-projection` export map at `packages/core/package.json:65-68` | VERIFIED |
| Linked program | Add one closed `if` variant containing a boolean condition and finite linked then-statements; linker remains the sole authenticated admission edge. | `linked-kir-program/contracts.ts:29-64`; `link.ts:116-208` | VERIFIED |
| RT-1 | Select the then-block only for tagged boolean true; propagate early return; do not evaluate or effect the unselected block. | Existing linear execution and return construction at `kir-runtime/execute.ts:109-191` | VERIFIED |
| JavaScript ESM compiler | Emit the admitted linked conditional into self-contained specialized ESM; no imported runtime/interpreter or host semantic delegation. | `compiler/kir-js-esm/emitter.ts:61-95,139-205`; public subpath at `packages/core/package.json:49-52` | VERIFIED |
| Python compiler | Emit the same linked conditional into self-contained Python; no Core/repository import or JavaScript-target dependency. | `compiler/kir-python/emitter.ts:56-85,135-224`; public subpath at `packages/core/package.json:53-55` | VERIFIED |
| CLI shadow | Remains an opt-in comparison client only. Its existing profile rejects parameters, imports, and capability nodes; it may exercise literal capability-free RT-2 programs once target artifacts admit them. | `packages/cli/src/kir-shadow/projection-input.ts:69-87`; `run-report.ts:30-52` | VERIFIED |

### RT-2 admission profile

- **DECIDED:** Accept only a structural `if` with exact `cond` property and a
  non-empty child block.
- **DECIDED:** The condition is an already admitted expression whose evaluated
  tagged value must be `boolean`; RT-2 adds no binary, unary, call, truthiness,
  coercion, or host predicate semantics.
- **DECIDED:** The then-block may contain current RT-1 statements and may end
  in an early return. Nested `if`, else, loops, assignment, calls other than
  existing `Json` intrinsics, and imports remain rejected.
- **DECIDED:** Link/preflight validates the complete selected-handler tree
  before RT-1 or target capability effects. Execution meters and cancellation
  checks each entered statement at the existing statement boundaries.
- **DECIDED:** An early return uses the existing return type, envelope-size,
  cancellation, and committed-event behavior identically on RT-1 and both
  targets. A false condition leaves the then-block completely unobserved.

## Implementation Approach

One shared linked `if` representation is the only viable approach. It keeps
the existing authenticated semantic selector in the linker, lets RT-1 execute
the same tree it already owns, and gives both emitters a target-specific
specialization of identical admitted semantics.

Adding separate target admission is rejected because current compiler entry
points deliberately delegate admission to the linker. Reusing a
ReferenceRunner, parser, source expression, or generic target interpreter is
rejected because those paths violate the R2 target-closure rules.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | Modify later | Closed linked `if` and finite child-statement representation. |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | Modify later | Exact structural validation, scope, and complete preflight. |
| `packages/core/src/kir-runtime/execute.ts` | Modify later | Branch selection and early-return propagation under existing meters/envelopes. |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | Modify later | Self-contained JavaScript conditional lowering. |
| `packages/core/src/compiler/kir-python/emitter.ts` | Modify later | Self-contained Python conditional lowering. |
| `scripts/kern-5-rt2-boolean-if/behavior.test.mjs` | Add now | F5-backed RED ownership and future behavior oracle. |

## Acceptance Criteria

- [ ] A real F5 projection containing an `if` is authenticated, contains the
  expected structural node, and is admitted by RT-1 plus both package compiler
  exports; no source or parser input is accepted at runtime/compiler ingress.
- [ ] Boolean true returns the then-block value, and boolean false reaches the
  outer final return, with equal normalized envelopes on RT-1, emitted ESM,
  and emitted Python.
- [ ] An early then-return prevents all following top-level statements; a false
  condition prevents every nested capability call and event.
- [ ] Pre-cancel after successful link/preflight yields
  `execution-cancelled` with zero provider calls and zero events on all three
  execution paths.
- [ ] Invalid/non-boolean conditions, malformed child shape, nested `if`,
  `else`, loops, and all out-of-profile expressions fail before provider calls
  or artifact output with the existing closed failure behavior.
- [ ] Emitted targets remain self-contained and retain current
  no-parser/no-ReferenceRunner/no-host-JSON/no-generic-dispatch closure gates.
- [ ] Existing RT-1, JavaScript-lowering, Python-lowering, and CLI-shadow
  profiles remain unchanged outside their new capability-free RT-2 witness.

## RED Oracle

`scripts/kern-5-rt2-boolean-if/behavior.test.mjs` uses only the current built
F5 projection and package exports. It verifies the structural `if` before
asking direct RT-1 and each compiler to admit it. At the declared base, all
three report `handler-entry-unsupported`; the test expects admission and is
therefore RED for the missing shared semantic owner rather than for a missing
module, package export, or Python executable. The same test declares the
post-implementation true/false, early-return, unselected-effect, and
pre-cancel requirements.

## Out of Scope

- `else`, nested branches, truthiness/coercion, binary/unary expressions,
  assignment, loops, recursion, arbitrary calls, exceptions, classes, or
  KERN-to-KERN imports.
- External npm/PyPI imports, package adapters, service wire/lifecycle,
  frontend production routing, CLI grammar expansion, default CLI cutover,
  release-gate promotion, push, merge, or deployment.
- Any KIR schema/version change or compatibility path through TypeScript,
  ReferenceRunner, parser, legacy source transpilation, or R0 fixture ABI.

## Open Questions

None. The bounded RT-2 admission profile is a deliberate contract decision;
later control-flow expansion requires a new claim-tagged slice.

## Deploy Order

1. Land the shared linked-program and RT-1 behavior with its complete
   preflight/atomicity oracle.
2. Land JavaScript and Python emitter support in the same compatible change,
   because neither target may accept a linked semantic shape that RT-1 rejects.
3. Run the existing optional CLI shadow only after all three paths are green;
   its default routing and restrictive profile remain unchanged.

There is no public ABI version change and no allowed mixed-version behavior:
the internal linked-program representation is consumed only by the three
stacked owners. During an incomplete deployment, an `if` continues to fail
closed as unsupported; it must never fall back to source or host semantics.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| F5 lacked control-flow input, so frontend work had to precede RT-2. | A real F5 projection already emits structural `if`. | RT-2 is a runtime/compiler admission slice, not a frontend/KIR-schema slice. |
| Each target could add `if` independently. | Both targets delegate admission to one shared linker. | RT-2 extends the linker first and preserves one semantic selector. |
| CLI shadow needed new parameter/capability transport first. | Its existing zero-argument, capability-free profile can consume a literal-boolean witness. | CLI is a live verification client, not an RT-2 implementation dependency. |
