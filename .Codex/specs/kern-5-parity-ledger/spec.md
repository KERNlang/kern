# KERN 5 — Parity ledger + Python compile-entry deferral pass

**Status:** SPEC — ORACLE LANDED RED
**Date:** 2026-09-07
**Confidence:** 0.91

## Executive Summary

The compiler lane is JS-first from here on (owner ruling, not adjudicated in this document). The
Python emitter is frozen at its current node coverage; when a later slice admits a node kind into
`LinkedKernKirStatement` or `LinkedKernKirExpression` and lowers it on the RT-1 and JavaScript legs
only, the Python leg must **refuse that program at compile time** rather than emit an artifact whose
behaviour it cannot honour. This slice builds that mechanism and nothing else: a parity ledger
checked in **outside** `packages/core/src`, a union-exhaustive `'lowered' | 'deferred'` mapping in an
existing `compiler/kir-python` file, and a deterministic admission pass at the Python compile entry
that runs over the linked program **before** `emitPython`/`blockSource` and returns a fail-closed
compile failure carrying no artifact.

The ledger ships **empty**. Today the Python emitter lowers every node kind the linker admits
(PL-C4), so there is nothing to defer, and every gate is either a live GREEN pin or a RED that names
one missing production symbol. The first row belongs to the next slice (`while`, JS + RT-1 only).

`link.ts` stays target-neutral: the same program links to the same `linkedProgramSha256` whichever
target asked (PL-C10). The deferral is a *target* decision taken after linking, never a linker
decision, because RT-1 and the JavaScript leg share that linker.

## Current State / Root Cause

### The Python compile entry already has exactly one refusal shape, and it has no room for a message

**[PL-C1 VERIFIED]** `compileKernKirToPython` surfaces every refusal through one three-key frozen
record — `packages/core/src/compiler/kir-python/index.ts:25-27`:

```ts
function failure(code: KernKirPythonCompileFailureCode): KernKirPythonCompileResult {
  return Object.freeze({ format: KERN_KIR_PYTHON_COMPILER_FORMAT, outcome: 'failure', code });
}
```

The failure variant of the result union carries `format`, `outcome` and `code` and nothing else
(`contracts.ts:27-38`), and C-PY-1's own oracle pins that key set exactly —
`scripts/kern-5-c-py-1-contract/support.mjs:107-112`:

```js
export function failureCode(result) {
  assert.equal(result.format, COMPILER_FORMAT);
  assert.equal(result.outcome, 'failure');
  assert.deepEqual(Object.keys(result).sort(), ['code', 'format', 'outcome']);
  return result.code;
}
```

Measured live on 2026-09-07: a program that projects but does not link (`!(1 < 2)` in a `let`)
returns exactly `{code: 'handler-entry-unsupported', format: 'kern.compiler.kir-python.v1',
outcome: 'failure'}` — three keys, no `artifact`, no `manifest`.

**Consequence, and it decides the whole design.** There is no `label` field and no `message` field to
put `KIR_PYTHON_LEG_DEFERRED` in, and adding one would break `failureCode` for every existing
failure. So the deferral **label and the deferral code are one string**: the tribunal's label
`KIR_PYTHON_LEG_DEFERRED` becomes a member of the closed failure-code union, and the ledger's `label`
column is asserted equal to it. One string, two places, one gate — which is the anti-drift shape the
tribunal asked for, rather than two strings that can disagree.

### The failure-code union is closed, additive, and unpinned by any exhaustiveness test

**[PL-C2 VERIFIED]** `contracts.ts:16-19`:

```ts
export type KernKirPythonCompileFailureCode =
  | KernKirLinkCode
  | 'invalid-compiler-request'
  | 'artifact-emission-failure';
```

`grep -rn 'KernKirPythonCompileFailureCode\|CompileFailureCode' scripts packages/core/tests` →
**zero hits**, 2026-09-07. Nothing in the repository asserts the union's exhaustive member list, so
adding one member cannot break a consuming assertion. `invalid-compiler-request` and
`artifact-emission-failure` are asserted only as *values* returned in specific situations
(`scripts/kern-5-c-py-1-contract/behavior.test.mjs:42-86`,
`scripts/kern-5-r2-js-lowering/behavior.test.mjs:41-53`) — none of those situations changes here.

**Reusing an existing code is rejected**, for the reason the tribunal rejected mechanism (B):
`handler-entry-unsupported` means *the linker refused this program*, and after a deferral the linker
has admitted it. Overloading it would make the rt2/rt4 admission taxonomy lie, and the RT-1 and
JavaScript legs would keep reporting `admitted` for the same program.

### The Python emitter lowers everything the linker admits, so the ledger starts empty

**[PL-C4 VERIFIED]** The linked unions carry 7 statement kinds and 9 expression kinds:

| Surface | Kinds | Evidence |
| --- | --- | --- |
| `LinkedKernKirStatement` | `assign, capability, for, if, let, print, return` | `kir-runtime/linked-kir-program/contracts.ts:250-275` |
| `LinkedKernKirExpression` | `binary, identifier, json-call, list, literal, member, record, unary, user-call` | `contracts.ts:174-204` |

Every one of the sixteen is lowered by the Python emitter today: `blockSource`
(`compiler/kir-python/emitter.ts:289-317`) dispatches `return`, `assign`, `for` and `if` and hands
the rest to `leafSource` (`emitter.ts:217`, covering `capability`, `let`, `print`); `expressionSource`
(`emitter.ts:68-119`) has an arm for each of the nine expression kinds. Measured: all eighteen
fixtures of this slice's position matrix compile to a real `entry.py` on this base.

So the mechanism slice's ledger has **zero rows**, and the mapping is all `'lowered'`. That is the
point: the mechanism is proven with an empty ledger by injection (see *The injectable seam*), so the
`while` slice adds a row rather than debugging a mechanism.

### The two unions have no exported kind alias

**[PL-C5 VERIFIED]** Neither `LinkedStatementKind` nor `LinkedExpressionKind` exists — the discriminants
are only reachable as `LinkedKernKirStatement['kind']`. `grep -rn "LinkedStatementKind\|LinkedExpressionKind"
packages/core/src` → zero hits, 2026-09-07. The tribunal forbade touching
`kir-runtime/linked-kir-program/contracts.ts`, so the mapping derives its key type **locally**, with
`satisfies Record<LinkedKernKirStatement['kind'], KirPythonLoweringState>`. That is the type-level
half of the exhaustiveness gate: adding a union member without touching the mapping is a `tsc`
error, which is the tripwire doing its job.

### The compiled-core inventory forbids a new file, and any content change moves one digest

**[PL-C6 VERIFIED]** `find packages/core/dist -name '*.js' | wc -l` → **354**, 2026-09-07, matching
the attested inventory at `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:11`
(`count: 354`, digest `78ab887d…`). The inventory is produced by a full recursive scan of the compiled
root — `scripts/kern-canonicalizer/coverage-dependencies.mjs:269-278` — and hashed with file *contents*
by `hashFramedFiles` (`coverage-dependencies.mjs:999-1002`). Two distinct consequences:

1. **A new file under `packages/core/src` breaks the count and the path-inventory digest.** That is
   why the ledger lives at `scripts/kern-5-parity-ledger/parity-ledger.json` and why the mapping and
   the pass go into files that already exist.
2. **Any content change to an existing `compiler/kir-python` file moves `compiledCoreDigest`**, pinned
   at `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97`
   (`'8b1bb5352fb070947a0ed0a1d93e5c3514c6771dfeae9e7729720731707c57df'`). The implementation slice
   therefore re-pins that literal and then runs `pnpm write:kern-canonicalizer-coverage`, in that
   order — the re-pin edits a `.mjs` under `scripts/kern-canonicalizer`, which moves
   `coverageImplementationDigest` as a side effect. **This oracle-only slice touches nothing under
   `packages/core/src`, so `compiledCoreDigest` does not move here.**

The `TARGET_KERNEL_SHA256` digests are a different matter and do **not** move at all:
`KERNEL_SOURCE` is a module-level constant in each emitter, the deferral adds no kernel byte, and the
refusal emits no artifact. Measured 2026-09-07: JavaScript `b53251fd…`, Python `f79a3963…`, both
unchanged and pinned as consuming assertions by this slice's `frozen-surface.test.mjs`.

### The public contract needs no amendment record

**[PL-C7 VERIFIED]** `scripts/runtime-contract-v1/public-declaration-schema.json` declares exactly the
`KernRuntimeHandler*` surface of `packages/core/src/runtime-handler.ts` — 21 declarations, none of
which mentions `KernKirPythonCompile` or `kern.compiler.kir-python`. And
`scripts/kir-v1/alpha-receipt-policy.json` has 125 bindings, **zero** of which contains
`compiler/kir-python` (measured 2026-09-07). So widening `KernKirPythonCompileFailureCode` is not an
RC-v1 declaration change and needs no amendment record under
`scripts/runtime-contract-v1/amendments/`.

The inverse fact is worth writing down because it is the trap: **every** file under
`scripts/runtime-contract-v1/` *is* receipt-bound (bindings 97-125 of that policy). If any future
slice edits one of them, `scripts/kir-v1/alpha-receipt-policy.json` must bind the change in the same
commit. This slice edits none of them.

### Every cross-leg agreement assertion is made ledger-aware here, not punted

**[PL-C8 VERIFIED]** **Eight** landed assertions say, in effect, *the three legs always agree*, for
**arbitrary** programs rather than a slice's own fixed fixtures. Leaving them alone would have made
the mechanism inert: the first deferred row would break them, so the row could not land until they
were amended, so this slice would have shipped a mechanism nothing could use. All three are now
routed through one shared, generic gate in `scripts/kern-5-parity-ledger/support.mjs`:

> If the linked program's statement or expression kinds intersect the ledger's deferred `nodeKind`s,
> the Python leg must report exactly `{format, outcome: 'failure', code: 'KIR_PYTHON_LEG_DEFERRED'}`
> and no artifact. Otherwise the pre-existing equality holds, with its original wording.

With the empty ledger the predicate never fires, so every assertion behaves exactly as before, and
**every affected admission golden is byte-unchanged** — verified by digest after the change:
rt2 `6d6754e7…`, rt3 `935da814…`, rt9 `c8a7253c…`, rt10-pre `87efee4d…`, rt10-X `6deab8cc…`, and
rt5's `probe-matrix.json` `ab87118b…`.

**No admission golden ever needs a per-leg split.** The rule applied uniformly is that an admission
column records the **linker's** decision, which is target-neutral by PL-C10, while the Python leg's
deferral is asserted live by the gate. `probeAdmission`/`admissionRow` keep returning the linker's
code, and rt5's `python` column is now the gate's return value rather than the raw compile code — the
same value today, and a stable value under a deferred row. That is what resolves PL-O6: the `while`
slice adds a ledger row and touches no golden.

Two shapes of call site, one gate. Four sites call
`assertPythonLegAdmission`/`assertPythonLegCompiled` directly; the four admission goldens go through
one adapter, `pythonLegAdmissionColumn` in `scripts/kern-5-rt4-user-fn-call/k0-support.mjs`, which
owns the re-link and the re-compile each of them would otherwise duplicate. The adapter also asserts
that an `admitted` row actually links — otherwise the predicate would silently have nothing to read
and the gate would be blind.

#### The sweep — every cross-leg site in `scripts/kern-5-rt*/` and `scripts/kern-5-c-py-1-contract/`

| Site | What it compares | Handling |
| --- | --- | --- |
| `kern-5-rt2-boolean-if/k0-golden.test.mjs` `probeAdmission` | JS compile code vs Python compile code, arbitrary probe programs | **ledger-aware** — `assertPythonLegAdmission` |
| `kern-5-rt3-binary-expression/k0-golden.test.mjs` `admissionCode` | same, over every binary expression probe | **ledger-aware** — `assertPythonLegAdmission` |
| `kern-5-rt9-linked-assign/k0-golden.test.mjs` `admissionRow` | `rt1 === javascript` **and** `javascript === python`, per probe row | **ledger-aware** — `assertAdmissionRowAgreement`; the rt1/JS half stays exact |
| `kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs` `admissionRow` | same | **ledger-aware** — `assertAdmissionRowAgreement` |
| `kern-5-rt10-cross-call-integer/k0-golden.test.mjs` `admissionRow` | same | **ledger-aware** — `assertAdmissionRowAgreement` |
| `kern-5-rt5-async-user-fn-call/probe-matrix.test.mjs` | records `python` per position, then asserts `python === rt1` over the golden | **ledger-aware** — the column is now `pythonLegAdmissionColumn(row, name)`, so the recorded value is the linker's decision and the golden-row equality stays exact |
| `kern-5-rt4-user-fn-call/k0-support.mjs` `assertLinkRejected` | all three legs `handler-entry-unsupported`, arbitrary programs | **ledger-aware** — via `pythonLegAdmissionColumn` |
| `kern-5-rt2-boolean-if/k0-support.mjs` `threeLegs` | the Python compile succeeded, before any three-leg run, arbitrary programs | **ledger-aware** — `assertPythonLegCompiled`, which names the deferred kind instead of reporting a generic compile failure |
| `kern-5-rt4-user-fn-call/k0-support.mjs` `threeLegBytes` | Python envelope bytes vs RT-1 | covered — unreachable once `threeLegs` refuses; it is the sole path in |
| `kern-5-rt5-async-user-fn-call/k0-support.mjs` `assertLegParity` | Python envelope bytes vs RT-1 | covered — same choke point |
| every `k0-divergence.test.mjs` (rt2, rt3, rt5) and every slice's `behavior.test.mjs` | three-leg envelope bytes | covered — all reach the legs through `threeLegs` |
| `kern-5-rt4-user-fn-call/probe-matrix.test.mjs` negative rows | three-leg equality over committed golden rows | **left alone, and that is correct**: the block is filtered to `row.rt1 !== 'admitted'`, i.e. link refusals only, and a program the linker refused has no linked program for the predicate to read. Pinned by `frozen-surface.test.mjs` so it cannot quietly grow an admitted row. Its `recompute()` path reaches the gate through `admission()` unchanged |
| `kern-5-rt3-binary-expression/short-circuit-meter.test.mjs` `control.python === control.javascript` | request-inspection codes | left alone — request inspection precedes linking, so a deferral can never reach it |
| `kern-5-rt8-integer-signatures/alias-equivalence.test.mjs` | one spelling's emitted Python vs another's | left alone — it compares Python to Python; both sides move together under a deferral |
| `kern-5-rt10-for/tick-discipline.test.mjs` checkpoint census | emitted-source checkpoint counts, JS vs Python | left alone — fixed fixtures, and it compares emitted source shape rather than admission |
| the ~15 bare `python.outcome === 'success'` preconditions in per-slice emission, tick and behavior probes | nothing — they gate on a compile succeeding | left alone: not a leg comparison. The one that gates a byte-identity claim, `threeLegs`, is the one that was covered |
| `kern-5-admission-census/support.mjs` | returns `rejection('python-compile', code)` and an envelope-agreement rejection | left alone — it reports rather than asserts (PL-C9) |
| `kern-5-c-py-1-contract/differential.test.mjs` | RT-1 vs native CPython over C-PY-1's single fixed witness | left alone — fixed fixture whose kinds are lowered by definition |

The gate recomputes the program's node kinds with its **own** walk rather than importing the
compiler's answer, so a production walk that missed a nesting level cannot agree with itself. The
walk is proven against the two hardest shapes: a loop inside a *helper* handler, and a binary buried
two levels under a record that a `member` reads.

### Link is target-neutral today, and the oracle pins it

**[PL-C10 VERIFIED]** Measured 2026-09-07: for the same verified projection, the `linkedProgramSha256`
in the JavaScript manifest, the `linkedProgramSha256` in the Python manifest, and the `sha256` of a
direct `linkVerifiedKernKirProgramOrThrow(...)` call are the same value. `link.ts` receives no target
argument and gains none.

## What Already Works

- **The refusal channel.** `failure()` (`index.ts:25-27`) already returns a frozen artifact-free
  result. The deferral adds a code, not a mechanism, and not a new result variant.
- **The compile-entry ordering.** `index.ts` already runs request inspection → link → manifest base →
  `emitPython` (`index.ts:31-71`). The pass slots in between the link and `emitPython`; nothing is
  reordered.
- **The linker.** No `link.ts` edit, no `contracts.ts` edit under `kir-runtime`, no walker edit. The
  pass reads a linked program that already exists.
- **The Python emitter.** Byte-frozen at `c37b5c0092dd712e30f49b07ae7bc0ba1bb26343bcc219e29c750457756518d8`,
  pinned as a consuming assertion. The deferral never reaches `blockSource`.
- **Both target kernels, every emitted-artifact digest, every manifest digest.** PL-C6.
- **The frontend.** No `.kern`, catalog, constitution, census or closure-ledger change. Every fixture
  this slice uses projects at base.
- **The evidence wiring pattern.** A new leaf goes in `package.json` as `test:kern-5-<slice>`, is
  appended to `test:kern-5-script-family`, and is appended to `kern5EvidenceCommands` in
  `scripts/ci/test-tier-contract.test.mjs` — which `deepEqual`s the two lists
  (`test-tier-contract.test.mjs:151-157`). No `.github/workflows/ci.yml` change: the `kern-5-evidence`
  job runs the aggregate once.

## Contract (Verified)

> Verified against `packages/core/src/compiler/kir-python/**`,
> `packages/core/src/kir-runtime/linked-kir-program/contracts.ts`, `scripts/kern-5-c-py-1-contract/**`,
> `scripts/kern-canonicalizer/coverage-dependencies.mjs`, `scripts/runtime-contract-v1/**`,
> `scripts/kir-v1/alpha-receipt-policy.json`, and live measurement on 2026-09-07.

### The ledger — `scripts/kern-5-parity-ledger/parity-ledger.json`

| Field | Shape | Rule | Tag |
| --- | --- | --- | --- |
| `format` | `'kern.compiler.kir-python.parity-ledger.v1'` | exact | VERIFIED (this slice) |
| `label` | `'KIR_PYTHON_LEG_DEFERRED'` | exact, and equal to the compile failure code (PL-C1/PL-C3) | VERIFIED |
| `rows` | array | sorted by `nodeKind`, unique | VERIFIED |
| `rows[].nodeKind` | `LinkedKernKirStatement['kind'] \| LinkedKernKirExpression['kind']` | the stable ID; never a source path | VERIFIED (PL-C5) |
| `rows[].surface` | `'statement' \| 'expression'` | disambiguator; the two kind sets are disjoint today so `nodeKind` alone stays unique | VERIFIED |
| `rows[].blockedBy` | `nodeKind[]` | ordering; every entry names another row, never itself | VERIFIED |
| `rows[].label` | `= ledger.label` | redundant on purpose: the redundancy is the drift gate | VERIFIED |
| `rows[].since` | `/^kern-5-[a-z0-9]+(-[a-z0-9]+)*$/` | the slice that took the debt | VERIFIED |
| `rows[].spec` | `.Codex/specs/kern-5-<slice>/spec.md` | the catch-up design source; validated as that shape **and asserted to exist on disk** | VERIFIED |

The ledger's own digest is pinned **independently**, in `ledger-support.mjs`
(`LEDGER_SHA256 = '2b372e6ee575231ebf6cf1e845353197a4c55aafc49bf4db7e0a0b40f0cb35fa'`), and is folded
into **no** other digest — not `compiledCoreDigest`, not `TARGET_KERNEL_SHA256`, not any manifest.
Codex's point in the tribunal stands: those pins must not move without `KERNEL_SOURCE`.

**Provenance is `since` + `spec`, not a digest.** An earlier draft carried a
`jsLoweringBlameDigest` — the `kir-js-esm/emitter.ts` digest at the moment the debt was taken —
validated only as lowercase hex and deliberately never compared against anything. That is the
illusion of provenance: a field that looks like evidence and proves nothing, and whose only honest
reading was an accepted risk. It is gone. `since` names the slice that took the debt and `spec`
points at that slice's spec, whose Python-lowering claim is the catch-up design source; the schema
gate asserts the spec file **exists**, which is a real check a mistyped value fails.

**No TTL and no debt ceiling.** The owner ruling *is* batched catch-up; `blockedBy` plus per-row
ordering already bounds catch-up PR size.

### The core side — `packages/core/src/compiler/kir-python/`

| Symbol | File | Shape | Tag |
| --- | --- | --- | --- |
| `KirPythonLoweringState` | `request.ts` | `'lowered' \| 'deferred'` | VERIFIED (this slice) |
| `KIR_PYTHON_STATEMENT_LOWERING` | `request.ts` | `… satisfies Record<LinkedKernKirStatement['kind'], KirPythonLoweringState>`, all seven `'lowered'` today | VERIFIED (PL-C4/PL-C5) |
| `KIR_PYTHON_EXPRESSION_LOWERING` | `request.ts` | `… satisfies Record<LinkedKernKirExpression['kind'], KirPythonLoweringState>`, all nine `'lowered'` today | VERIFIED |
| `KIR_PYTHON_LOWERING` | `request.ts` | frozen `{ expression, statement }` — the injectable table | VERIFIED |
| `pythonLoweringDeferral(linked, lowering = KIR_PYTHON_LOWERING)` | `request.ts` | returns the first deferred `nodeKind` in a deterministic pre-order walk of the entry statements then each helper's statements, else `undefined` | VERIFIED |
| `KIR_PYTHON_LEG_DEFERRED_CODE` | `contracts.ts` | `'KIR_PYTHON_LEG_DEFERRED' as const` | VERIFIED (PL-C3) |
| `KernKirPythonCompileFailureCode` | `contracts.ts` | gains exactly one member: `typeof KIR_PYTHON_LEG_DEFERRED_CODE` | VERIFIED (PL-C2) |
| `compileKernKirToPythonWithLowering(projection, request, lowering = KIR_PYTHON_LOWERING)` | `index.ts` | the injectable seam. The table is a **default argument**, so called with two arguments the seam *is* the production path; `compileKernKirToPython` is the thin wrapper over it. The oracle asserts the two return deep-equal results for every fixture in the position matrix, so the seam can never become a parallel branch | VERIFIED |
| `packages/core/src/compiler-kir-python.ts` | — | **no edit.** The seam is internal; the public subpath surface is byte-pinned at `eade928a…` | VERIFIED |

### The refusal

| Field | Value | Tag |
| --- | --- | --- |
| shape | `Object.freeze({ format, outcome, code })` — exactly three keys, no `artifact`, no `manifest` | VERIFIED (PL-C1) |
| `format` | `'kern.compiler.kir-python.v1'` | VERIFIED |
| `outcome` | `'failure'` | VERIFIED |
| `code` | `'KIR_PYTHON_LEG_DEFERRED'` | VERIFIED (PL-C3) |
| ordering | after `linkVerifiedKernKirProgramOrThrow` succeeds, before `emitPython` (`index.ts:70`) | VERIFIED |
| determinism | pure function of the linked program and the mapping; no I/O, no clock, no ledger read at run time | VERIFIED |

**Invariant: production never reads `parity-ledger.json` — at build time or at run time.**
`KIR_PYTHON_STATEMENT_LOWERING`/`KIR_PYTHON_EXPRESSION_LOWERING` in `request.ts` are the single
runtime source of truth, and the JSON file is a gate mirror the oracle reads to prove the two agree;
the bidirectional staleness gate is what keeps them identical, and nothing in `packages/core`
resolves, opens, or embeds that path. It could not, even if it wanted to: C-PY-1's closure oracle
forbids `process` and any repository-relative import inside the compiled core
(`scripts/kern-5-c-py-1-contract/closure.test.mjs:11-16`), and the same oracle's emitted-source gate
forbids the file-system surface in the artifact. The oracle-side gate in
`scripts/kern-5-parity-ledger/support.mjs` is the only reader, and it lives outside the package.

### The injectable seam — why it exists

With an empty ledger there is no deferred row, so a refusal golden that only iterates rows would pass
vacuously and prove nothing. `compileKernKirToPythonWithLowering` lets the oracle drive **production
code** with a synthetic mapping that defers one real kind, and assert the refusal end to end — the
exact code, the exact key set, no artifact, in every parent position — without a single production
row. Once the `while` slice adds a real row the same harness iterates it with the production table,
and the synthetic rows stay as the mechanism's own regression.

## Blast Radius

### This slice (spec + oracle + wiring only)

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-parity-ledger/spec.md` | add | this document |
| `scripts/kern-5-parity-ledger/parity-ledger.json` | add | the ledger, empty, outside `packages/core/src` (PL-C6) |
| `scripts/kern-5-parity-ledger/ledger-support.mjs` | add | schema validator, kind scrapers, tolerant production accessors, the position matrix |
| `scripts/kern-5-parity-ledger/emission-golden.json` | add | per-position `entry.py` digests, so an emission change cannot hide |
| `scripts/kern-5-parity-ledger/support.mjs` | add | the **shared ledger-aware gate** rt2 and rt4 import: the deferral predicate, its own node-kind walk, and the two assertion forms |
| `scripts/kern-5-parity-ledger/{ledger-schema,frozen-surface,ledger-aware-gates,exhaustiveness,staleness,refusal-golden,parent-positions}.test.mjs` | add | the oracle: 61 tests |
| `scripts/kern-5-rt2-boolean-if/k0-golden.test.mjs` | edit | `probeAdmission`'s bare `javascriptCode === pythonCode` becomes `assertPythonLegAdmission`. **`k0-golden.json` is byte-unchanged** — the golden still stores the linker's admission |
| `scripts/kern-5-rt2-boolean-if/k0-support.mjs` | edit | `threeLegs`' bare Python compile-success assertion becomes `assertPythonLegCompiled`; the choke point for `threeLegBytes`, `assertLegParity` and every divergence suite |
| `scripts/kern-5-rt4-user-fn-call/k0-support.mjs` | edit | gains `pythonLegAdmissionColumn` + `assertAdmissionRowAgreement`, the one adapter every admission golden uses; `assertLinkRejected` routes through it. `admission()`'s **return shape is unchanged** (see the Corrections Log) |
| `scripts/kern-5-rt3-binary-expression/k0-golden.test.mjs` | edit | `admissionCode`'s bare leg equality becomes `assertPythonLegAdmission` |
| `scripts/kern-5-rt9-linked-assign/k0-golden.test.mjs` | edit | `admissionRow` becomes `assertAdmissionRowAgreement` |
| `scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs` | edit | same |
| `scripts/kern-5-rt10-cross-call-integer/k0-golden.test.mjs` | edit | same |
| `scripts/kern-5-rt5-async-user-fn-call/{probe-matrix.test.mjs,k0-support.mjs}` | edit | the probe matrix's `python` column becomes `pythonLegAdmissionColumn(row, name)`; `k0-support` re-exports the adapter |
| every affected `k0-golden.json` and `probe-matrix.json` | **no edit** | verified by digest: the columns record the linker's target-neutral decision |
| `package.json` | edit | `test:kern-5-parity-ledger`; appended to `test:kern-5-script-family` |
| `scripts/ci/test-tier-contract.test.mjs` | edit | `kern5EvidenceCommands` gains one entry; the `deepEqual` is exact and order-sensitive |
| `.github/workflows/ci.yml` | **no edit** | the `kern-5-evidence` job runs the aggregate once |
| anything under `packages/core/src` | **no edit** | so `compiledCoreDigest` does **not** move in this slice |

### The implementation slice (the pins that move when the mapping and the pass land)

| Pin | Moves? | Detail |
| --- | --- | --- |
| `compiledCoreDigest` at `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` | **yes** | PL-C6: any content change under `packages/core/src` moves it. Re-pin, then `pnpm write:kern-canonicalizer-coverage` |
| `scripts/kern-canonicalizer/*.json` coverage receipts | **yes** | regenerated by `pnpm write:kern-canonicalizer-coverage`; `coverageImplementationDigest` moves because the re-pin edits a `.mjs` under `scripts/kern-canonicalizer` |
| the 354-file inventory count and path digest (`c-py-1-lowering-historical-transition.mjs:11`) | **no** | three existing files are edited; none is added or removed |
| `TARGET_KERNEL_SHA256`, both kernels, every emitted-artifact digest, every manifest digest, `linkedProgramSha256`, `projectionArtifactSha256` | **no** | no kernel byte, no emitter byte, and a refusal emits nothing |
| `packages/core/src/compiler/kir-python/emitter.ts` | **no** | byte-frozen, asserted |
| `packages/core/src/compiler-kir-python.ts` | **no** | the seam is internal; digest asserted |
| RC-v1 constitution / declaration schema / amendment chain | **no** | PL-C7. No amendment record required |
| `scripts/kir-v1/alpha-receipt-policy.json` | **no** | PL-C7 — but if a future slice edits any `scripts/runtime-contract-v1/*` file, that policy must bind it in the same commit |
| the six neighbour K0 goldens (rt2, rt3, rt6, rt9, rt10-pre, rt10-X) | **no** | the empty ledger changes no admission value; asserted by digest |
| `scripts/kern-5-rt2-boolean-if/k0-golden.json` and the rt3/rt4 derived digest chain | **no, and not for the first deferred row either** | PL-C8: the gate landed here, and the golden stores the linker's target-neutral admission, so a deferred row adds a row to `parity-ledger.json` and touches no golden |
| the eight cross-leg assertion sites | **no** | already ledger-aware as of this slice; a deferred row changes their behaviour without changing their source |
| `scripts/kern-5-admission-census/**` | **no** | PL-C9: the census records a `python-compile` rejection rather than asserting agreement |
| `packages/core/src/kir-runtime/**` (`link.ts`, `contracts.ts`, `expression.ts`, the walkers) | **no** | PL-C10: link stays target-neutral |
| any frontend file, `.kern`, catalog, constitution, closure ledger | **no** | every fixture projects at base |

## Acceptance Criteria

Each criterion is a test in `scripts/kern-5-parity-ledger/`. None rests on an ASSUMED or OPEN claim.

- [x] The ledger exists at `scripts/kern-5-parity-ledger/parity-ledger.json`, declares the pinned
      format and label, is sorted and unique, and ships with **zero rows**.
- [x] The ledger's digest is pinned independently and folded into no other digest.
- [x] The row schema rejects all nineteen drifts the catch-up procedure could introduce — unknown or
      missing keys, a foreign format or label, a row label disagreeing with the ledger, an unknown
      surface, an uppercase or truncated blame digest, a free-text `since`, a non-kind `nodeKind`, a
      duplicate or unsorted `nodeKind`, a `blockedBy` that dangles, self-references, or is not an
      array, a free-text or out-of-tree `spec`, a `spec` naming a slice with no spec on disk, and a
      resurrected `jsLoweringBlameDigest`.
- [x] The ledger lives outside `packages/core/**` and the compiled inventory stays at 354 files.
- [x] **The cross-leg gates are ledger-aware.** With the checked-in empty ledger the predicate fires
      for none of the 18 position fixtures and every affected suite stays green with a
      byte-unchanged admission golden. With a synthetic row injected into the shared gate the
      predicate fires in all 5 statement and all 13 expression positions, is inert for a program
      without the deferred kind, and can never fire for a link-refused program. The gate then demands
      the exact slice-A refusal and rejects a wrong code, a retained artifact, and a success; the
      three-leg form refuses a deferred fixture by name. All **eight** call sites are asserted wired
      — four directly, four through the one rt4 adapter — and asserted to keep no bare Python
      equality of their own, while the target-neutral RT-1-versus-JavaScript half stays exact.
- [x] The gate's node-kind walk reaches a loop inside a helper handler and a binary two levels under
      a record a `member` reads — it is an independent recomputation, not the compiler's answer.
- [ ] **Exhaustiveness.** `KIR_PYTHON_STATEMENT_LOWERING` covers exactly the 7 statement kinds and
      `KIR_PYTHON_EXPRESSION_LOWERING` exactly the 9 expression kinds scraped from the linked
      contracts source, every value is `'lowered' | 'deferred'`, and `request.ts` carries both
      `satisfies Record<…['kind'], …>` clauses so a union member added without a mapping entry is a
      `tsc` error.
- [x] The two kind sets are disjoint, so `nodeKind` alone is a valid primary key.
- [ ] **Bidirectional staleness.** Every `'deferred'` mapping entry has a ledger row, every ledger row
      is `'deferred'` in the mapping for its surface, and every row's `label` equals
      `KIR_PYTHON_LEG_DEFERRED_CODE` — which is itself a member of the closed
      `KernKirPythonCompileFailureCode` union.
- [ ] **The refusal.** For every ledger row, in every catalog-permitted position of its surface, the
      compile entry returns exactly `{code: 'KIR_PYTHON_LEG_DEFERRED', format, outcome: 'failure'}` —
      three keys, no `artifact`, no `manifest`.
- [ ] **The harness fires.** With a synthetic table deferring `for` (statement) or `binary`
      (expression), production code refuses, and with the production table the same programs compile.
- [ ] **The seam is the production path.** Called with two arguments it defaults to the production
      mapping and returns a result deep-equal to `compileKernKirToPython`'s for every one of the 18
      position fixtures, so it can never become a parallel branch.
- [ ] **Negative probe.** A synthetic deferred statement refuses in all **5** statement positions
      (handler top level, `if` then, `if` else, `for` body, helper body) and a synthetic deferred
      expression in all **13** expression positions — including the three nesting paths a shallow walk
      would miss, `list-item`, `record-value` and `member-source-record`.
- [x] The two positions a probe expression cannot reach today (`unary-argument`, refused at link;
      `capability-input`, not projected) stay unreachable, so the matrix cannot silently shrink.
- [ ] The pass is wired **before** `emitPython` at the compile entry, and reports no deferral for a
      program built only from lowered kinds.
- [x] Link is target-neutral: the JavaScript manifest, the Python manifest and a direct link call
      agree on `linkedProgramSha256`.
- [x] `emitter.ts` is byte-identical, both target kernels are unchanged, the `kir-python` directory
      still holds exactly its seven files, and the public facade digest is unchanged.
- [x] No emitted Python byte moves: all 18 position artifacts match `emission-golden.json`.
- [x] The six neighbour K0 goldens do not move, and the two cross-leg agreement tripwires (PL-C8) are
      still present and still green.
- [x] RC-v1 declares nothing about the Python compiler and the alpha-receipt policy binds no
      `compiler/kir-python` path, so no amendment record is required.
- [x] `pnpm test:ci-contract` passes with the new evidence leaf wired (19/19).

## Catch-up procedure — how a later slice flips a row

The reverse of taking the debt, in this order:

1. Land the Python lowering for the node kind (one arm in `emitter.ts`'s `blockSource` or
   `expressionSource`). `emitter.ts`'s frozen digest in
   `scripts/kern-5-parity-ledger/frozen-surface.test.mjs` is re-pinned in the same commit — that
   re-pin is the licence being exercised, and it must never be a silent edit.
2. Flip the mapping entry from `'deferred'` to `'lowered'` in `request.ts`.
3. Delete the row from `parity-ledger.json`, and delete it from every surviving row's `blockedBy`.
   The row's `spec` field is where the design came from: read that slice's Python-lowering claim
   before writing step 1, rather than re-deriving it.
4. Re-pin `LEDGER_SHA256` in `ledger-support.mjs`. The independent ledger digest is the only digest
   this step moves.
5. Add the Python parity rows to the catch-up slice's own behavior oracle: three-leg byte-identical
   envelopes for the node kind, which is the evidence that the debt is actually repaid rather than
   merely un-recorded.
6. Re-pin `compiledCoreDigest` (`coverage-prerequisite.test.mjs:97`), then run
   `pnpm write:kern-canonicalizer-coverage`.
7. Re-pin `emission-golden.json` if any existing position's emitted `entry.py` changed, and say in
   the commit message why.

Steps 2 and 3 are the load-bearing pair: doing either alone fails the bidirectional staleness gate,
which is the whole reason the gate is bidirectional.

## Oracle — RED/GREEN gate table

Measured on `feat/kern-5-parity-ledger` @ `f96ef335` (origin/main), 2026-09-07, each file run
individually with `node --test scripts/kern-5-parity-ledger/<file>.test.mjs`.

**61 tests: 39 GREEN, 22 RED.**

| File | tests | pass | fail | Base |
| --- | --- | --- | --- | --- |
| `ledger-schema` | 7 | **7** | 0 | all GREEN — the ledger and its schema are this slice's own evidence |
| `frozen-surface` | 10 | **10** | 0 | all GREEN — must stay green |
| `ledger-aware-gates` | 13 | **13** | 0 | all GREEN — the shared gate is oracle-side, so it lands working rather than red |
| `exhaustiveness` | 7 | 2 | **5** | the mapping does not exist |
| `staleness` | 6 | 1 | **5** | the mapping, the code constant and the pass do not exist |
| `refusal-golden` | 11 | 3 | **8** | the injectable seam does not exist and the pass is unwired |
| `parent-positions` | 7 | 3 | **4** | the injectable seam does not exist |

Every RED names exactly one missing production symbol. The eight distinct causes, verbatim:

| Cause | REDs |
| --- | --- |
| `PARITY_LEDGER_MISSING_EXPORT: compiler/kir-python/index.js must export compileKernKirToPythonWithLowering` | 11 |
| `PARITY_LEDGER_MISSING_EXPORT: compiler/kir-python/request.js must export KIR_PYTHON_STATEMENT_LOWERING` | 5 |
| `PARITY_LEDGER_MISSING_EXPORT: compiler/kir-python/request.js must export KIR_PYTHON_EXPRESSION_LOWERING` | 1 |
| `PARITY_LEDGER_MISSING_EXPORT: compiler/kir-python/request.js must export pythonLoweringDeferral` | 1 |
| `PARITY_LEDGER_MISSING_EXPORT: compiler/kir-python/contracts.js must export KIR_PYTHON_LEG_DEFERRED_CODE` | 1 |
| `PARITY_LEDGER_TYPE_GATE: request.ts must constrain its mapping with satisfies Record<LinkedKernKirStatement['kind'], …>` | 1 |
| `PARITY_LEDGER_UNION_GAP: KIR_PYTHON_LEG_DEFERRED must be a member of KernKirPythonCompileFailureCode` | 1 |
| `PARITY_LEDGER_UNWIRED: the compile entry must call pythonLoweringDeferral` | 1 |

No RED comes from a fixture typo: every position fixture's projection **and** link admission is
asserted GREEN at base in `parent-positions.test.mjs`, and every position's Python compile success is
asserted GREEN in `refusal-golden.test.mjs`, precisely so a projection or link regression can never
masquerade as a deferral RED.

The production accessors in `ledger-support.mjs` use a dynamic `import()` plus an explicit
`assert.ok(module[name] !== undefined, …)` rather than a static named import. A static named import of
a missing export is a module-level `SyntaxError` that fails every test in the file with one shared
message, which would make the GREEN pins in `exhaustiveness`, `staleness`, `refusal-golden` and
`parent-positions` unobservable.

### Neighbour gates at base

| Command | Base |
| --- | --- |
| `pnpm test:ci-contract` | **19/19 pass**, with this slice's `kern5EvidenceCommands` entry and the `test:kern-5-script-family` append already applied |
| `pnpm test:kern-5-rt2-boolean-if` | **35/35 pass** after the gate landed, `k0-golden.json` byte-unchanged |
| `pnpm test:kern-5-rt3-binary-expression` | **139/139 pass**, `k0-golden.json` byte-unchanged |
| `pnpm test:kern-5-c-py-1-contract` | **29/29 pass** — the slice whose failure-shape pin decides PL-C1 |
| the rt4, rt5, rt6, rt8, rt9, rt10-pre, rt10-X and rt10-for suites | all pass; every affected admission golden byte-unchanged. **Run the suites in sequence** — each begins with a core build and concurrent builds race on one `dist` tree (Corrections Log) |
| `pnpm lint` | **exit 0**, `Checked 1449 files`, 2 pre-existing infos (`String.raw`), no error. `biome.json` `files.includes` covers `packages/*/src/**`, `packages/*/tests/**` and two named scripts, so `scripts/kern-5-parity-ledger/**` carries no lint gate and is formatted by hand to the 120-column, 2-space style of its neighbours |

## Out of Scope

- **Any production code.** This slice is spec + RED oracle + wiring. The mapping, the pass, the code
  constant and the seam land in the implementation slice.
- **Any deferred row.** The ledger ships empty by design (PL-C4). The first row is the `while` slice's.
- **`while`, `each`, `break`, `continue`, `set`.** All stay outside the linked unions.
- **A TTL, a debt ceiling, or an automatic catch-up trigger.** Rejected by the tribunal: the owner
  ruling is batched catch-up, and a TTL gate that is re-deferred in the open is theatre.
- **Any `link.ts` target parameter**, any `kir-runtime/contracts.ts` change, any walker change.
- **Any `emitter.ts` byte**, any kernel byte, any emitted-artifact re-seal.
- **Any RC-v1 amendment record** (PL-C7) and any `scripts/runtime-contract-v1/*` edit.
- **A per-leg rt2 golden.** Not needed at all: the golden stores the linker's target-neutral
  admission and the Python divergence is asserted by the shared gate (PL-C8).
- **Any push, merge, release-gate promotion or deployment.**

## Notes written now for later slices (free today, expensive during try/catch)

From the tribunal's Q4 consensus, recorded so they are not relitigated:

- Unlabelled `break`/`continue` only, bound to the innermost loop at link time; a link error outside a
  loop, with function boundaries resetting the context.
- `break`/`continue` never cross a `try` boundary.
- Boolean-only loop conditions; no truthiness.
- Native jumps in both emitters — no `__Break`/`__Continue` signal lowering (it pollutes the rt4 fault
  channel and grows the c-py-1 forbidden-pattern surface).
- No loop-`else`. Copied-scope bindings, no closure capture. Walkers recurse through `while`.
- Iteration budget scope: per-loop-instance, reset at entry — the only choice that keeps a `range()`
  based Python `for` lowering and the *`continue` lands on the step* invariant intact. Pin it before
  the first JS counter is written.
- `for`'s existing checkpoint sits at **body entry**, not on the final failed condition probe
  (tribunal Q3, unrefuted). A `while` tick rule must be reconciled against that, and the `while` slice
  owes a `for`/`while` equivalence golden pair asserting equal tick counts under whichever rule wins.

## Open Questions

- **[PL-O1 DECIDED — 2026-09-07]** The deferral label and the deferral code are the same string,
  `'KIR_PYTHON_LEG_DEFERRED'`, because the failure result has no message or label field and C-PY-1's
  oracle pins its key set at exactly three (PL-C1). A second string would be the drift the tribunal's
  "driven by the ledger, not a hand-maintained predicate" instruction exists to prevent.
- **[PL-O2 DECIDED — 2026-09-07]** Production reads the mapping, never the ledger file. The ledger is
  oracle-side evidence; the bidirectional staleness gate binds them. Reading `scripts/**` from inside
  the compiled core would violate C-PY-1's closure oracle.
- **[PL-O3 DECIDED — 2026-09-07]** Two mappings (one per surface) rather than one flat 16-key map, so
  each is `satisfies Record<Union['kind'], …>` exactly. A flat map would work today only because the
  two kind sets happen to be disjoint, which is asserted rather than assumed.
- **[PL-O4 DECIDED — 2026-09-07]** No amendment record. PL-C7.
- **[PL-O5 WITHDRAWN — 2026-09-07]** The `jsLoweringBlameDigest` column is deleted rather than
  documented as an accepted risk. A field validated only as hex and never compared against anything
  is the illusion of provenance. Provenance is `since` + `spec`, and the `spec` file's existence is a
  real check.
- **[PL-O6 DECIDED — 2026-09-07]** No per-leg admission golden is needed anywhere. All eight
  cross-leg assertion sites became ledger-aware in this slice (PL-C8), and every admission column
  records the linker's target-neutral decision. The `while` slice adds a ledger row and touches no
  golden.

## Queued follow-ups

Not this slice, and not blocking it — recorded so they are requested rather than rediscovered:

- **`pythonDeferredKinds(linkedProgram): readonly string[]`** — a pure query export on `request.ts`
  returning every deferred kind in a linked program, in the walk's deterministic order. The compile
  result cannot carry it: the failure shape is exactly three keys and that pin belongs to C-PY-1
  (PL-C1), so a consumer that needs *which* node deferred — a review lens, the future importer's
  diagnostics, a catch-up planner ordering `blockedBy` — should ask this function rather than widen
  the result. Add it when a consumer exists, with its own oracle row; adding it unused would be dead
  public surface.

## Deploy Order

1. **This slice: spec, ledger, shared gate, oracle, wiring.** 22 RED, 39 GREEN. Nothing under
   `packages/core/src` moves, so no digest is re-pinned, and no admission golden moves either.
2. **Implementation slice: `contracts.ts` (code constant + union member), `request.ts` (the two
   mappings, the table, the pass), `index.ts` (the seam + the call site before `emitPython`).** All
   three in one commit — a mapping without a call site is a lie, and a call site without a mapping does
   not compile. Then re-pin `compiledCoreDigest` and run
   `pnpm write:kern-canonicalizer-coverage`.
3. **`while` slice: the first deferred row.** A ledger row and the mapping flip — nothing else on
   the parity side, because the eight cross-leg gates are already ledger-aware (PL-C8). Plus the
   tick-discipline reconciliation the tribunal named, which is that slice's own work.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| The refusal can carry `KIR_PYTHON_LEG_DEFERRED` as a `label` field beside an existing `code` | `scripts/kern-5-c-py-1-contract/support.mjs:107-112` pins the failure key set at exactly `['code','format','outcome']`; a fourth key breaks every existing failure assertion | The label **is** the code: one new member on the closed union, and the ledger's `label` column asserted equal to it (PL-C1, PL-C3) |
| The mapping can `satisfies Record<LinkedStatementKind, …>` against exported kind aliases | No such aliases exist (`grep` → zero hits) and the tribunal forbade editing `kir-runtime/linked-kir-program/contracts.ts` | The mapping derives its key type locally with `LinkedKernKirStatement['kind']` (PL-C5) |
| A refusal golden that iterates ledger rows proves the mechanism | With an empty ledger it iterates zero rows and passes vacuously | Added the injectable seam `compileKernKirToPythonWithLowering` and four synthetic-mapping tests that drive production code with a deferred kind (PL-O1 rationale, *The injectable seam*) |
| The oracle can statically `import { KIR_PYTHON_LOWERING } from '…/request.js'` | A missing named export is a module-level `SyntaxError` that fails every test in the file with one shared message, hiding the GREEN pins | Every production accessor is a tolerant dynamic `import()` plus a named `assert.ok`, which is what makes each RED single-cause |
| `member-object` is a position a `binary` can occupy | `member.object` must evaluate to a record, so a bare binary cannot sit there; measured, the fixture does not link | Replaced with `member-source-record` — the binary sits inside the record a `member` reads, which is a deeper nesting than `record-value` and a real smuggling path |
| A capability `input` expression is a projectable position | `capability … input="Json.stringify(1 + 1)"` does not project on this base (measured) | Recorded as a fence rather than a position, so a later widening surfaces as a failing fence instead of a silent hole in the negative probe |
| The rt2/rt4 cross-leg tripwires could be left to the `while` slice and merely documented | The mechanism would have been inert: the first row breaks them, so the row cannot land until they are amended, so this slice would ship a mechanism nothing can use | Made all three ledger-aware here, generically, behind one shared gate; PL-O6 resolved rather than deferred (PL-C8) |
| `assertLinkRejected` can read the raw Python result from a new `pythonResult` field on `admission()` | `scripts/kern-5-rt4-user-fn-call/probe-matrix.test.mjs` `deepEqual`s recomputed `admission()` rows against a committed golden. The extra key made the diff two 20 KB `Uint8Array`s wide per position and the test process was **SIGKILLed after 212 s** — a green 4/4 turned into an unexplained kill | Reverted the field; `assertLinkRejected` re-compiles from `row.verified` instead. `admission()`'s return shape is a de-facto public contract of the rt-slice family and must not grow |
| `linkedProgram.helpers` is always an array | It is **absent**, not empty, on a program that declares no helper function — the gate crashed with `helpers is not iterable` on the first rt2 probe | The walk reads `linkedProgram.helpers ?? []`, with the invariant recorded at the line |
| Six oracle suites could be re-verified concurrently to save wall clock | Every `test:kern-5-*` script begins with `pnpm --filter @kernlang/core build`, and eight of those racing on one `dist` tree died with `ENOTEMPTY: rmdir … frontend-projection-assets/…`. Six suites reported `exit=1` with no test output at all | Re-verified with one build followed by the suites' `node --test` invocations in sequence. Recorded because a concurrent re-verification looks like six real failures |
| The rt5 probe matrix could keep recording the raw Python compile code in its `python` column | Under a deferred row the recomputed column would become `KIR_PYTHON_LEG_DEFERRED`, the committed `probe-matrix.json` would drift, and the `while` slice would have to rewrite a golden | The column is now the gate's return value — the linker's target-neutral decision. Byte-identical today (`ab87118b…`), stable under a deferred row, and the golden-row `python === rt1` assertion stays exact |
| A blame digest gives the ledger provenance | Validated only as hex and compared against nothing; its own spec entry conceded it was caught "by review, not by the oracle" | Column deleted; provenance is `since` + `spec`, and the schema asserts the spec file exists (PL-O5 withdrawn) |
