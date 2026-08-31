# KERN 5 RT-2: Boolean `if` and early return

**Status:** IMPLEMENTED
**Date:** 2026-08-27, implementation recorded 2026-08-31
**Base:** `fcf16612599b5624fd065d2fc8a88cb61c5d273a`
**Implemented at:** `41cf8507` (K0 golden), `c9b4ceea` (link and execute)
**Confidence:** 0.97

## Executive Summary

RT-2 adds the smallest executable control-flow contract missing from the
accepted F5-to-target stack: a structural `if` with an existing boolean
condition, a finite then-block that may return early, and an optional paired
`else` block. F5 already projects this source shape, but the common
linked-program admission layer rejected it before RT-1, JavaScript ESM, or
Python lowering could run. The slice extends that one shared semantic
representation and requires exact direct/JS/Python behavior without introducing
a parser, host-language fallback, loops, calls, imports, or a generic KIR
dispatcher.

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
| Linked program | One closed `if` variant carrying a boolean condition, a non-empty then-block, and an optional else-block; the linker remains the sole authenticated admission edge. | `linked-kir-program/contracts.ts`; `link.ts` | IMPLEMENTED |
| RT-1 | Select the then-block only for tagged boolean true; propagate early return; do not evaluate or effect the unselected block. | Existing linear execution and return construction at `kir-runtime/execute.ts:109-191` | VERIFIED |
| JavaScript ESM compiler | Emit the admitted linked conditional into self-contained specialized ESM; no imported runtime/interpreter or host semantic delegation. | `compiler/kir-js-esm/emitter.ts:61-95,139-205`; public subpath at `packages/core/package.json:49-52` | VERIFIED |
| Python compiler | Emit the same linked conditional into self-contained Python; no Core/repository import or JavaScript-target dependency. | `compiler/kir-python/emitter.ts:56-85,135-224`; public subpath at `packages/core/package.json:53-55` | VERIFIED |
| CLI shadow | Remains an opt-in comparison client only. Its existing profile rejects parameters, imports, and capability nodes; it may exercise literal capability-free RT-2 programs once target artifacts admit them. | `packages/cli/src/kir-shadow/projection-input.ts:69-87`; `run-report.ts:30-52` | VERIFIED |

### RT-2 admission profile

- **IMPLEMENTED:** Accept a structural `if` with exact `cond` property and a
  non-empty child block. An empty branch block fails closed.
- **IMPLEMENTED:** `else` is admitted. F5 projects `else` as a *sibling* node of
  `if` (`kind: "else"`, no properties, its own children), not as a child, so the
  linker pairs an `if` with an immediately-following `else` sibling while walking
  a block. An `else` that is not immediately preceded by an `if` — a dangling
  `else`, or one separated by another statement — is never paired and fails
  closed as `handler-entry-unsupported` on all three legs. An empty `else` block
  fails closed.
- **IMPLEMENTED:** Nested `if` is admitted. Branch blocks are linked by the same
  block walker, so an `if`/`else` may appear at any branch depth.
- **IMPLEMENTED:** Branch bodies link in a *copied* scope. A binding introduced
  inside a branch is invisible to the enclosing block and to sibling branches;
  referencing it outside fails closed. Because the copy still carries the
  enclosing names, a branch cannot shadow an outer binding either — a duplicate
  name inside a branch fails closed.
- **IMPLEMENTED:** The condition must be *statically* a KIR boolean expression:
  a boolean literal, a parameter declared `boolean`, or a `let` bound to an
  expression that is itself statically boolean. Capability-bound names, member
  reads, `Json` intrinsic results, text, and list values are all rejected at
  link. RT-2 adds no binary, unary, call, truthiness, coercion, or host
  predicate semantics.
- **DECIDED:** The fail-closed code for a non-boolean condition is the existing
  closed link code `handler-entry-unsupported`, carrying the message label
  `KIR_IF_COND_NOT_BOOLEAN`. `KernKirLinkCode` and `KernKirDiagnosticCode` are
  closed kebab-case unions re-exported into both compilers' public
  `…CompileFailureCode` contracts, and `failureEnvelope` drops fault messages,
  so a new wire code would have broken three public contracts *and* still not
  been observable on any leg. The label lives in the fault message and in the
  negative-control assertion.
- **IMPLEMENTED:** Loops, assignment, calls other than existing `Json`
  intrinsics, and imports remain rejected. `while` and `assign` are additionally
  rejected upstream by F5 today; the K0 golden pins that fact so the drift test
  fires if F5 starts projecting them.
- **IMPLEMENTED:** Link/preflight validates the complete selected-handler tree
  before RT-1 or target capability effects. Execution meters and cancellation
  checks each entered statement at the existing statement boundaries; entering a
  branch consumes exactly one meter step and one cancellation checkpoint, the
  same as any other statement, on all three legs.
- **IMPLEMENTED:** An early return uses the existing return type, envelope-size,
  cancellation, and committed-event behavior identically on RT-1 and both
  targets. An unselected branch is completely unobserved: no expression is
  evaluated, no capability is invoked, and no event is committed.

### Capability provisioning is deliberately conservative

- **DECIDED:** A handler containing a capability statement *anywhere* in its
  linked tree — including inside a branch that the request will not select —
  requires a capability provider. Calling without one fails `capability-error`
  before execution, even when the selected path would never have invoked it.
- **Rationale:** the check is a static property of the linked program, not of the
  run. Both emitters bake it in as a compile-time constant (`hasCapability` in
  the specialized source), so it cannot depend on runtime branch selection
  without the targets re-deriving semantics at run time. Making RT-1 defer the
  check until a capability is actually reached would make RT-1 accept programs
  that the emitted targets reject, which is exactly the divergence this slice
  exists to prevent. The recursive `linkedStatementsInvokeCapability` predicate
  in `linked-kir-program/contracts.ts` is the single shared definition all three
  legs consume.

### Direct-runtime tick discipline

- **DECIDED:** Entering a branch must not introduce an `await` point that the
  emitted targets do not have. RT-1 walks branches with an explicit frame stack
  in the existing statement loop, not by awaiting a recursive call.
- **Rationale:** a capability-free handler runs to completion inside a single
  microtask on every leg. An `await` at branch entry yields the microtask queue,
  so a cancellation queued as a microtask could be observed by RT-1 but not by
  the emitted JavaScript — reproduced during review: RT-1 returned
  `failure`/`execution-cancelled` after committing both branch events while the
  emitted ESM returned `success` on the identical program, request, and abort
  schedule. `scripts/kern-5-rt2-boolean-if/tick-discipline.test.mjs` pins this
  across queued-abort microtask depths 0-4 at one and two branch levels.

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
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | Modified | Closed linked `if` variant, optional else-block, and the shared recursive capability predicate. |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | Modified | Block walker with if/else sibling pairing, copied branch scopes, the static boolean-condition gate, and complete preflight. |
| `packages/core/src/kir-runtime/execute.ts` | Modified | Branch selection and early-return propagation over an explicit frame stack, under existing meters/envelopes and without an added await point. |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | Modified | Self-contained JavaScript conditional lowering with counter-allocated locals and scoped branch bindings. |
| `packages/core/src/compiler/kir-python/emitter.ts` | Modified | Self-contained Python conditional lowering with block re-indentation and an explicit `is True` test. |
| `packages/core/src/kir-runtime/linked-kir-program/index.ts` | Modified | Re-export the shared capability predicate. |
| `scripts/kern-5-rt2-boolean-if/behavior.test.mjs` | Added, then made tmpdir-portable | F5-backed RED ownership and behavior oracle. Its permission-model child now realpaths its temp directory, because macOS `os.tmpdir()` is a symlink into `/private/var` and the child could not realpath its own main module under `--allow-fs-read`. |
| `scripts/kern-5-rt2-boolean-if/k0-golden.json`, `k0-golden.test.mjs` | Added | Committed golden pinning the linker-admitted statement kinds and the structural `if`/`else` schema, recomputed from the real contracts and catalog on every run. |
| `scripts/kern-5-rt2-boolean-if/k0-divergence.test.mjs`, `k0-support.mjs` | Added | Boolean-edge three-leg byte-parity fixtures and the shared harness. |
| `scripts/kern-5-rt2-boolean-if/branch-behavior.test.mjs` | Added | Branch selection, else pairing, nesting, early return, scope isolation, and non-boolean negative controls. |
| `scripts/kern-5-rt2-boolean-if/tick-discipline.test.mjs` | Added | Queued-abort checkpoint parity between RT-1 and emitted JavaScript. |
| `package.json` | Modified | Root `test:kern-5-rt2-boolean-if` script. No CI lane is added: `test:kern-5-r1-runtime-owner` and `test:kern-5-r2-js-lowering` are root scripts that no `.github/workflows` file references, so a root script alone matches the established kern-5 precedent. |

## Acceptance Criteria

- [x] A real F5 projection containing an `if` is authenticated, contains the
  expected structural node, and is admitted by RT-1 plus both package compiler
  exports; no source or parser input is accepted at runtime/compiler ingress.
- [x] Boolean true returns the then-block value, and boolean false reaches the
  outer final return, with equal normalized envelopes on RT-1, emitted ESM,
  and emitted Python.
- [x] An early then-return prevents all following top-level statements; a false
  condition prevents every nested capability call and event.
- [x] Pre-cancel after successful link/preflight yields
  `execution-cancelled` with zero provider calls and zero events on all three
  execution paths.
- [x] Invalid/non-boolean conditions, malformed child shape, empty branch
  blocks, dangling `else`, branch-local bindings referenced from an enclosing
  block, loops, and all out-of-profile expressions fail before provider calls or
  artifact output with the existing closed failure behavior.
- [x] Nested `if` and a paired `else` resolve to the same branch on RT-1,
  emitted ESM, and emitted Python.
- [x] A cancellation queued as a microtask is observed at the same statement
  boundary by RT-1 and by the emitted JavaScript; entering a branch adds no
  direct-runtime-only checkpoint.
- [x] Emitted targets remain self-contained and retain current
  no-parser/no-ReferenceRunner/no-host-JSON/no-generic-dispatch closure gates.
- [x] Existing RT-1, JavaScript-lowering, Python-lowering, and CLI-shadow
  profiles remain unchanged outside their new capability-free RT-2 witness.

## RED Oracle

`scripts/kern-5-rt2-boolean-if/behavior.test.mjs` uses only the current built
F5 projection and package exports. It verifies the structural `if` before
asking direct RT-1 and each compiler to admit it. At the declared base, all
three report `handler-entry-unsupported`; the test expects admission and is
therefore RED for the missing shared semantic owner rather than for a missing
module, package export, or Python executable. The same test declares the
post-implementation true/false, early-return, unselected-effect, and
pre-cancel requirements. It is now GREEN, alongside `branch-behavior.test.mjs`
(else pairing, nesting, scope isolation, non-boolean negative controls),
`tick-discipline.test.mjs` (queued-abort checkpoint parity), and the K0 golden
and divergence fixtures. Discrimination was demonstrated by five reverted
mutants: RT-1 negated condition, emitted-JavaScript swapped branches, emitted-
Python dropped `else`, a removed linker boolean gate, and a reintroduced
branch-entry `await`; each was killed.

## Out of Scope

- Truthiness/coercion, binary/unary expressions, assignment, loops, recursion,
  arbitrary calls, exceptions, classes, or KERN-to-KERN imports.
- `else if` as a distinct construct. F5 has no such node; a chained condition is
  written as an `if` nested inside an `else` block, which this slice admits.
- Runtime-dependent capability provisioning (see the conservative contract
  above).
- External npm/PyPI imports, package adapters, service wire/lifecycle,
  frontend production routing, CLI grammar expansion, default CLI cutover,
  release-gate promotion, push, merge, or deployment.
- Any KIR schema/version change or compatibility path through TypeScript,
  ReferenceRunner, parser, legacy source transpilation, or R0 fixture ABI.

## Open Questions

None blocking. The bounded RT-2 admission profile is a deliberate contract
decision; later control-flow expansion requires a new claim-tagged slice.

- **OBSERVED:** F5 does not project `param … type=integer` (`boolean`, `string`,
  and their list forms do project). Noted while building the non-boolean
  negative controls; a `boolean[]` parameter was used instead. Out of scope here.

## Deploy Order

1. Land the shared linked-program and RT-1 behavior with its complete
   preflight/atomicity oracle.
2. Land JavaScript and Python emitter support in the same compatible change,
   because neither target may accept a linked semantic shape that RT-1 rejects.
3. Run the existing optional CLI shadow only after all three paths are green;
   its default routing and restrictive profile remain unchanged.
4. Run the suite through the root `test:kern-5-rt2-boolean-if` script. It needs
   Node 22 (`KERN_NODE22`) for the emitted-ESM leg and CPython 3.12
   (`KERN_PYTHON312`) for the emitted-Python leg, matching the r2 and c-py-1
   harnesses it reuses.

There is no public ABI version change and no allowed mixed-version behavior:
the internal linked-program representation is consumed only by the three
stacked owners. During an incomplete deployment, an `if` continues to fail
closed as unsupported; it must never fall back to source or host semantics.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| `else` and nested branches remain rejected. | F5 projects `else` as an `if` sibling and the block walker pairs them for free; nesting falls out of the same walker. Both were implemented and are covered by the golden and behavior fixtures. | The admission profile, acceptance criteria, and out-of-scope list above were rewritten to record the implemented contract. |
| RT-1 could execute branches by awaiting a recursive block call. | Awaiting at branch entry adds a microtask boundary the emitted targets do not have, producing a real cancelled/success divergence. | RT-1 walks branches with an explicit frame stack; the divergence is pinned as a committed fixture. |
| F5 lacked control-flow input, so frontend work had to precede RT-2. | A real F5 projection already emits structural `if`. | RT-2 is a runtime/compiler admission slice, not a frontend/KIR-schema slice. |
| Each target could add `if` independently. | Both targets delegate admission to one shared linker. | RT-2 extends the linker first and preserves one semantic selector. |
| CLI shadow needed new parameter/capability transport first. | Its existing zero-argument, capability-free profile can consume a literal-boolean witness. | CLI is a live verification client, not an RT-2 implementation dependency. |
