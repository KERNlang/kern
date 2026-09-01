# KERN 5 RT-7: The first real repository file runs on the owned pipeline

**Status:** IMPLEMENTED
**Date:** 2026-09-01
**Base:** `55e92de8` (RT-6 merged; contains RT-2 boolean `if`, RT-3 binary expressions,
RT-4 same-module user calls, RT-6 void fall-through)
**Implemented at** (rebased onto `06d82f84`, RT-5 merged): `a9ec617f` (census runner),
`5a485119` (the one repository `.kern` edit), `8ced1ad6` (ratchet, pinned rejection sample,
fast test, root script), `b41e50c9` (concurrent sweep), `00883c46` (census record),
`eaa03304` (legacy-oracle amendment and its tests), `257abc41` (canonicalizer transition),
`9892dc46` (receipts repinned onto the RT-5 base)
**Confidence:** 0.93

## Executive Summary

Every KERN 5 runtime slice so far was proved on a synthetic fixture the slice
wrote itself. RT-7 spends no runtime code at all and instead asks the question
those slices were built to answer: *does a file that already lives in this
repository run on the pipeline KERN owns?* One repository `.kern` file now
projects, links, compiles to both targets, and executes on RT-1, the emitted
JavaScript ESM and the emitted Python with byte-identical envelopes. A monotone
admission census is born at **1 of 240**, so the next slice cannot claim progress
it did not make and cannot lose the ground this one took.

## The dual-consumer constraint, and the amendment that resolves it

`ui.kern` has **two** consumers, and RT-7 first discovered them disagreeing.

- The **KIR pipeline** selects entries only from `module.exports`, so the file is
  unreachable without `export=true`.
- The **native source runner** (`executeKernEntrySource`), which backs
  `scripts/check-kern-5-preview-app.mjs` inside the `pnpm test:runner-smoke` CI
  gate, refused the same file *because of* that export:

```
link error: exported function 'renderHome' in '<entry>' is unsupported by the native runner
```

Measured both ways, nothing else changed:

| `ui.kern` line 1 | `check-kern-5-preview-app.mjs` (before the amendment) |
| --- | --- |
| `fn name=renderHome returns=void` | `kern 5 preview app smoke passed` |
| `fn name=renderHome export=true returns=void` | link error, UI route 500 |

The two halves of the contradiction:

- `packages/core/src/runner-runtime-scope.ts`, `runnerFunctionBinding` excludes
  every `returns=void` function from the binding map — a void `fn` has no
  callable form, which is correct and is **not** changed.
- `packages/core/src/runner.ts`, `collectExplicitRunnerExports` treated *any*
  exported `fn` with no binding as a **fatal** link error.

The second is the defect. A sync void `fn` with one KERN handler is precisely the
shape the same file already supports as a *descriptor-selected entry*
(`resolveNamedVoidKernHandler` **requires** `returns=void`). So the native runner
simultaneously blessed that shape as an entry and treated it as fatal as an
export.

### The amendment (ratified, `kern5-rt7-unblock` 4/4)

`collectExplicitRunnerExports` now `continue`s past a missing binding **only**
when the node is explicitly `returns === 'void'`, not `async`, not `stream`,
**declares no parameters in either spelling** (`params=` or `param` children), and
carries exactly one KERN handler. The parameter guard mirrors
`assertVoidRunnerEntry`: a descriptor entry may not take parameters, so a
parameterized void export is not the entry-only shape the skip exists for. Every other unbound export keeps the existing
fatal diagnostic, byte-for-byte. Absent and empty `returns` are deliberately
**not** skippable — treating them as void would conceal a malformed export.

This is a **legacy-oracle compatibility amendment**, not a widening of the KERN 5
runtime. `packages/core/src/runner.ts` is the native source runner and sits
**outside** the F0-F5 / KIR / emitter freeze this slice declared; no projection,
linker, emitter, ledger or census digest is touched by it.

Process followed under the *forced oracle* rule: the focused RED test landed
first and failed for the right reason (2 of 7 new tests red — the descriptor-entry
smoke path and the import fail-closed proof — with the other 5 green as
regression fences), the amendment followed, and the exception is recorded here.

### Deferral ledger

| Item | Finding | Disposition |
| --- | --- | --- |
| `main` | `fn name=main export=true returns=void` is unbound because `collectRunnerFunctions` excludes the **name**, not because of the return type. The literal four-condition rule would have flipped it from fatal to skipped. | A fifth guard, `name !== 'main'`, keeps its existing fatal. This narrows the amendment; it never widens it. Pinned by test. |
| malformed export names | `fn name=9bad export=true returns=void` is **not** fatal today and was not before: `isPortableBindingName` skips it *before* the binding lookup. The brief expected a fatal. | Pre-existing behaviour, unchanged by the amendment. Pinned as fail-closed — never exported, never fatal — rather than mis-pinned as fatal. |
| `returns=void` as a callable | Still has no binding and still cannot be called or imported. | Unchanged and deliberate; the skip only removes a link abort, it never creates a symbol. |

## Second blocker (resolved) — `runner.js` is inside the canonicalizer's frozen measurement closure

*Historical record — what the first canonicalizer run found, kept because the
constraint it documents is permanent. The **Resolution** below is the current
state.*

The amendment was correct and fully proved, but at that point it **could not land
on this branch**.

`pnpm test:kern-canonicalizer` goes from **872/872 pass** at base to **810 pass /
62 fail** with the ten-line amendment, and the documented receipts recipe cannot
repair it: `check-kern-canonicalizer-coverage.mjs --write` throws during
*validation*, before it writes anything:

```
TypeError: coverage M4.106 runtime-cost rejection:
  compiled core JavaScript executed by the measurement must remain exact
```

Why, precisely:

- `compiledCoreJavaScriptPaths()` walks **every** `.js` under `packages/core/dist`
  and content-hashes it.
- `digestPreM4135CompiledCoreJavaScript()` and `digestM4145CompiledCoreJavaScript()`
  compare that hash against **frozen historical identities** pinned in
  `runtime-cost-m4-106.mjs`, `combined-headroom-m4-127.mjs` and
  `combined-headroom-m4-145.mjs`.
- A core file may change only if a canonicalizer milestone has authored a
  **historical transition** that reconstructs its pre-milestone bytes. The
  `kir-runtime/*` subtree has one (`r1-runtime-owner-historical-transition.mjs`),
  which is why RT-2 through RT-6 could change KIR runtime and emitter sources and
  keep the canonicalizer at 872/872 with only the `compiledCoreDigest` literal
  moving.
- `runner.js` appears in `SCALAR_HELPER_HISTORY_INVENTORY` and has **no**
  transition and **no** reconstruction override. Its exact compiled bytes are
  frozen.

Measured, with nothing else changed:

| `packages/core/src/runner.ts` | `check-kern-canonicalizer-coverage.mjs` | `pnpm test:kern-canonicalizer` |
| --- | --- | --- |
| base | exit 0, 112/112 base-complete | 872/872 |
| +10-line amendment | throws at M4.106 validation | 810 pass / 62 fail |

Landing this amendment therefore requires a **canonicalizer historical transition
for `dist/runner.js`**, in the shape of the existing
`r1-runtime-owner-historical-transition.mjs` /
`trace-retention-ownership-historical-transition.mjs` modules, with its own
structural and runtime-headroom authentication. That is an authenticated
canonicalizer milestone, not a receipts refresh, and it is not RT-7's to invent.

The paragraph above is kept as the record of what was found. The conclusion it
drew — that this needed an authenticated milestone of its own — was **wrong in one
respect**, and the scoping pass that followed established why.

### Resolution — a content-reconstruction transition, no measurement re-run

`r1-runtime-owner-historical-transition.mjs` and the C-PY-1 layer reconstruct
**added** paths: they restore a predecessor *inventory* by filtering added files
out. `runner.js` is not an added file, it is a **changed** one, so that shape does
not apply. The right precedent is the content-reconstruction chain inside
`m4145CompiledCoreJavaScriptPaths()`: a frozen
`{path, expectedDigest, replacements[]}` array fed through
`reconstructHistoricalSource`, which rewrites current compiled bytes back to their
archived form and refuses unless the result hashes to the archived digest.

| Fact | Value |
| --- | --- |
| Predecessor (archived) `dist/runner.js` | `4ca61336834ca11a719b53add12211081392fe3dfa440098247b9faf7633ae95` |
| Successor (amended) `dist/runner.js` | `db648ccf76dda1d353118cdc2d40f2fd710849f34f267d3e035a064b69491fda` |
| Replacements | 2, each verified to occur **exactly once** |
| Hand-authored size | 45 lines (33-line data module + 12-line wiring) |

The amendment's entire compiled footprint is two contiguous insertions — the
`isEntryOnlyVoidFunction` predicate and its two-line guard — so the predecessor is
recovered by deleting both.

**No measurement is re-run, and no floor moves.** Because the reconstruction
reproduces the pre-amendment core *exactly*, `digestPreM4135CompiledCoreJavaScript()`
and `digestM4145CompiledCoreJavaScript()` return their unchanged frozen values, so
the M4.106, M4.127 and M4.145 runtime identities validate untouched. This binds
history; it does not authenticate new headroom. That is what makes it a bounded
transition layer rather than a milestone.

Placement and blast radius: the layer runs **first** in the chain, ahead of
runner-call-cache, because it is the most recent change. No other reconstruction
targets `runner.js`, and `SCALAR_HELPER_HISTORY_INVENTORY` is a path inventory
that a content change does not disturb, so nothing downstream is affected. The
closest precedent, `branch-path-structural-target.mjs`, carries no dedicated test,
and this layer matches it.

The rebase onto RT-5 confirmed the scoping: the transition needed **no** change,
because RT-5's `kir-runtime` work lands in paths the R1 runtime-owner transition
already excludes from the historical inventories. Only the current-state
`compiledCoreDigest` moved. `pnpm test:kern-canonicalizer` is **872/872** with the
amendment in place, both before and after the rebase.

## Current State / Root Cause

`examples/kern-5-preview-app/ui.kern` declares `fn name=renderHome returns=void`
with a handler whose body is twenty-three ordered `print` statements and nothing
else. RT-6 made that *shape* expressible. The file still could not run.

- **VERIFIED (RED at `55e92de8`, before the edit):** the file projects. F1-F5
  returns `status: 'projected'` and `verifyKernProjection` accepts it. The module
  comes back with `exports: []` and one `fn` root whose properties are exactly
  `name={"tag":"text","value":"renderHome"}` and
  `returns={"tag":"record","value":[{"key":"kind","value":{"tag":"text","value":"void"}}]}`.
- **VERIFIED (RED):** every consumer of that projection then rejects it with the
  same closed code:

  | Leg | Verdict before the edit |
  | --- | --- |
  | F1-F5 projection | `projected` |
  | `linkVerifiedKernKirProgram` | `failure` / `handler-entry-not-found` |
  | `compileKernKirToJavaScriptEsm` | `failure` / `handler-entry-not-found` |
  | `compileKernKirToPython` | `failure` / `handler-entry-not-found` |
  | `executeKernKir` (RT-1) | `failure`, diagnostic `{category:'runtime', code:'handler-entry-not-found', phase:'link'}` |

Root cause: `selectHandler` in `linked-kir-program/link.ts` picks the entry only
from `module.exports`, and `compileHandler` requires `export=true`. An unexported
`fn` contributes no export row, so the entry is not found — the projection was
never the wall.

## Contract

> Binding tribunal verdict for slice `rt7-first-real-admission`.

### The single repository edit

`examples/kern-5-preview-app/ui.kern` line 1 changes from

```
fn name=renderHome returns=void
```

to

```
fn name=renderHome export=true returns=void
```

One property is added. No statement, expression, print value, handler shape or
whitespace elsewhere in the file changes, and no other `.kern` file in the
repository is touched. **Zero `packages/core/src` files are modified**; the
runtime, the linker, both emitters, F0-F5 and the closure ledger are frozen for
this slice.

### Admission is the whole owned pipeline

A file is *admitted* only when all of the following hold, in order:

1. F1-F5 projects it and `verifyKernProjection` accepts the artifact.
2. At least one `fn` appears in `module.exports`, which is the only place the
   linker looks.
3. `linkVerifiedKernKirProgram` returns `success` for that entry.
4. Both `compileKernKirToJavaScriptEsm` and `compileKernKirToPython` return
   `success`.
5. RT-1 executes it to `outcome: 'success'`.
6. The emitted JavaScript ESM runs to success in a Node 22 child under
   `--experimental-permission` with its filesystem scoped to a temporary
   directory, and the emitted Python runs to success in an isolated CPython 3.12
   child.
7. The canonical envelope bytes of all three legs are **byte-identical**.

Projection alone is not admission, and neither is a compile. A file that
projects and then fails at link is a rejected file, recorded at the stage that
rejected it.

### The census declares its own execution budget

`KIR_SHADOW_LIMITS` caps stdout at `maxEvents: 10`. No real entry point in this
repository fits inside ten events — `ui.kern` emits twenty-three — so a census
run under that budget would report a budget fact dressed up as a language fact.
`CENSUS_LIMITS` therefore raises the event, step, string and byte ceilings and is
pinned inside `admitted.json`, so moving the budget is a visible ratchet change
rather than an invisible one.

This is a census policy, not a runtime change: the runtime already accepts any
budget the request carries, and the shadow owner's own constants are untouched.

### The ratchet is a whitelist, not a count

`scripts/kern-5-admission-census/admitted.json` holds one row per admitted file
carrying the entry handler name, the F5 projection digest, the linked program
digest, the three-leg envelope digest, the event count and the result presence.
Three properties are gated:

- **Green today.** Every whitelisted file still admits end-to-end on all three
  legs, and every pinned digest still recomputes to the same value.
- **Monotone.** The number of admitted files among the scanned set never falls
  below the whitelist length, and the RT-7 birth file plus the ratchet floor are
  literals in the test source, so deleting a whitelist row cannot lower the bar.
- **Deliberate.** A file that starts admitting while it is not whitelisted turns
  the gate red. Widening is `sweep.mjs --update`, run on purpose, never a silent
  side effect.

### Two gates: a sampled fence and the corpus-wide invariant

These are different guarantees and the spec names them separately, because the
fast one cannot prove what the slow one proves.

**The sampled fence** — `pnpm test:kern-5-admission-census`, wired into
`test:infra:contracts`, the root script CI's *Infrastructure contracts* lane runs.
It resolves the whitelist plus **seven** pinned known-rejected files with their
expected first diagnostic, and exercises the sweep's timeout, progress-log,
incremental-write, atomic-write, `--update` refusal and corpus-invariant logic.
The seven include all three files that clear F5 and stop only at the missing
`export=true` — the nearest thing the corpus has to an accidental admission, and
therefore the fence that matters most. It is a **sample**: it can prove that these
files still fail closed, and it cannot prove that no *other* file started
admitting.

**The corpus-wide invariant** — `pnpm census:sweep`. It walks all 240 tracked
files and asserts the real invariant: the admitted set equals the whitelist
exactly, with no extra admissions and no regressions, exiting non-zero otherwise.
This is the only place the whole admitted set is knowable. Measured: **543 s
(9.1 min) at `--jobs 8`, exit 0, 1/240 admitted**. Serially it is hours — the
first attempt was abandoned at 40/240.

Running the fence costs about 77 seconds, of which roughly 51 are one file —
`examples/kern-frontend/builtin-node-types.generated.kern` is large and slow to
project. That single file is most of the fence's cost and is kept deliberately,
because it is one of the three near-admissions.

A CI lane for the full sweep is a **follow-up, not this slice**: nine minutes of
wall time needs its own budget decision.

### The sweep may not lose or disturb its work

One child process per file, `stdio: ['ignore', 'pipe', 'pipe']` so the child's
stdin is closed, a hard `timeout` that records `timedOut` and the budget it was
killed by, one verdict line per file, and a full report rewritten after **every**
file. The census reads the corpus and writes only its own report; the test pins
that every tracked `.kern` file is byte-identical after a sweep.

The sweep runs a bounded pool of probes because a serial sweep of the corpus
takes over five hours — projection dominates every file, and each probe pays it
alone. Results are stored **by corpus index, not by completion order**, so the
report a concurrent sweep writes is comparable with the report a serial one
writes; the gate pins that property directly.

## Verified Result — the admitted file

```
examples/kern-5-preview-app/ui.kern#renderHome
```

| Fact | Value |
| --- | --- |
| F5 projection artifact SHA-256 | `cb291c30a38ab49179a893cdeeebdbeef3d7cadff00985883deea8f1a56ee6d5` |
| Linked program SHA-256 | `53ddd3c1e543227c632bea2536fb0f285900f512dc0f3a4b9b874428b6e1b486` |
| Three-leg envelope SHA-256 | `30f791df12c1532aabe238c97f7f301b52971314bdf0a0380584d2110540ff7f` |
| Outcome | `success` on RT-1, emitted JavaScript ESM and emitted Python |
| Completion | `{"kind":"return"}` |
| Result | `{"presence":"absent"}` — the RT-6 void fall-through, on a real file |
| Events | 23 ordered `stdout` events, the HTML lines the handler prints |
| Diagnostics | none |

The projection digest is a function of the module id, and the census uses the
repository-relative path as the module id.

### Per-stage timing

Measured in a cold `node` process on the census probe; the projection number
includes the one-time load of the 1.5 MB frontend projection assets.

| Stage | Milliseconds |
| --- | --- |
| F1-F5 projection and verification | 4946.2 |
| link | 6.9 |
| JavaScript ESM compile | 5.8 |
| Python compile | 5.5 |
| RT-1 execution | 9.8 |
| emitted JavaScript child | 78.2 |
| emitted Python child | 110.3 |
| total | 5163.2 |

Projection dominates by three orders of magnitude, which is why the sweep is an
hours-long script and the gate is not.

### The shipped CLI reaches the same file

`packages/cli` needed no change either. Run through the shadow owner:

```
kern run examples/kern-5-preview-app/ui.kern \
  --kir-shadow --kir-shadow-entry 'ui.kern#renderHome'
```

reports `"outcome":"match"` with exit 0 — RT-1, the emitted JavaScript and the
emitted Python agree byte for byte. Two owner facts are worth recording:

- the shadow owner requires the entry module id to equal the input **basename**,
  so its projection digest is `8892e520b51c9769c0d302b986a324fe7227ca7ddf01fe1fc02ef072c3733e61`
  rather than the census's path-keyed digest;
- under `KIR_SHADOW_LIMITS` the run stops after ten events with
  `runtime-limit-exceeded` and `{"presence":"absent"}`. **All three legs agree on
  that truncation too**, which is the stronger statement: the legs match at the
  budget boundary, not only inside it.

## Verified Result — the census

**1 of 240 tracked `.kern` files is admitted.**

One full sweep, `--jobs 8`, `--timeout 300000`: 240 of 240 files completed, zero
timeouts, zero probe crashes. The slowest file took 120.0 s to project
(`examples/kern-frontend/f4-declarations-main.kern`), which is why the timeout is
five minutes and not five seconds.

| Measure | Value |
| --- | --- |
| Tracked `.kern` files (`git ls-files '*.kern'`) | 240 |
| Admitted end-to-end on three legs | 1 |
| Whitelist length | 1 |
| Rejected | 239 |
| Rejected before the runtime could be reached | 239 |

### The walls that remain

| Wall | Stage | First diagnostic | Files |
| --- | --- | --- | --- |
| source the projection lexer rejects | projection | `UNEXPECTED_TOKEN` | 101 |
| a module root that is not an `fn` | projection | `FRONTEND_UNSUPPORTED_MODULE_ROOT` | 76 |
| a node or property outside the projected authority | projection | `F4_AUTHORITY_DRIFT` | 19 |
| unquoted property values | projection | `F4_F2B_DRIFT` | 11 |
| host expressions the frontend excludes | projection | `FRONTEND_EXCLUDED_HOST_EXPRESSION` | 11 |
| a fatal projection | projection | `projection-fatal` | 8 |
| an expression the frontend rejects | projection | `FRONTEND_INVALID_EXPRESSION` | 4 |
| the projection request itself is refused | projection | `projection-request-invalid` | 3 |
| no `export=true`, so no export row | entry selection | `no-exported-entry` | 3 |
| a rejected projection | projection | `projection-rejected` | 2 |
| host types the frontend excludes | projection | `FRONTEND_EXCLUDED_HOST_TYPE` | 1 |

`for` not projecting and integer parameters, both named in the earlier admission
probe, are inside `UNEXPECTED_TOKEN` and `F4_AUTHORITY_DRIFT` rather than being
walls of their own.

**236 of the 239 rejections are projection; three are entry selection; not one is
link, either emitter, RT-1 or the three-leg envelope.** The frontier is F0-F5,
not the runtime. That is the most useful number this slice produces: RT-2 through
RT-6 have run ahead of the projection, and the next admission is bought by
projecting more source, not by executing more of it.

The three files that reach entry selection —
`examples/agon-engine-islands.kern`,
`examples/kern-frontend/builtin-node-types.generated.kern` and
`examples/kern-frontend/f1-scan-catalog.kern` — project cleanly and are blocked
only by a missing `export=true`. They are the cheapest candidates for the next
ratchet turn, and deliberately **not** taken here: this slice admits one file, and
each of those would need its own three-leg verification.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `examples/kern-5-preview-app/ui.kern` | Modified | `export=true` on the one entry. One property. |
| `scripts/kern-5-admission-census/support.mjs` | Added | Census budget, the admission ladder, per-stage timing. |
| `scripts/kern-5-admission-census/probe-file.mjs` | Added | One file per child process. |
| `scripts/kern-5-admission-census/sweep.mjs` | Added | The hours-long sweep, its timeout, its progress log, `--update`. |
| `scripts/kern-5-admission-census/admitted.json` | Added | The ratchet. |
| `scripts/kern-5-admission-census/rejected-sample.json` | Added | Five pinned rejections with their first diagnostic. |
| `scripts/kern-5-admission-census/census.test.mjs` | Added | The fast gate. |
| `scripts/kern-5-admission-census/admission.json` | Added | The 240-file sweep record. Evidence, not a golden: no test reads it. |
| `package.json` | Modified | `test:kern-5-admission-census` (also wired into `test:infra:contracts`), `census:sweep`, `sweep:kern-5-admission-census`. |
| `packages/core/src/runner.ts` | Modified | The legacy-oracle amendment: one predicate plus one `continue`. 10 lines, native source runner only. |
| `packages/core/tests/runner-source-executor.test.ts` | Modified | Eight tests: the descriptor-entry smoke path, the import fail-closed proof, the export-map absence probe, and five regression fences. |
| `scripts/kern-canonicalizer/runner-export-amendment-target.mjs` | Added | The `runner.js` content-reconstruction transition. 33 lines. |
| `scripts/kern-canonicalizer/coverage-dependencies.mjs` | Modified | Wires that layer in first, ahead of runner-call-cache. 12 lines. |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | Modified | The `compiledCoreDigest` literal, repinned. |
| `scripts/kern-canonicalizer/coverage-{summary,prerequisite-summary}.json` | Modified | Receipts, regenerated last. |

**One production file**, `packages/core/src/runner.ts`, +10 lines, confined to the
native source runner. No `packages/core/src` file is added or removed. The
compiled-core digest does move, which the receipts recipe repins, **and** the
changed bytes require the content-reconstruction transition above — the receipts
recipe alone cannot repair a changed file that sits in the frozen closure. `runner-runtime-scope.ts`, every
F0-F5 / KIR / emitter file, `scripts/check-kern-5-preview-app.mjs`, `ci.yml` and
every census digest are untouched.

## Acceptance Criteria

- [x] The exact pre-edit rejection is recorded from the real pipeline:
  projected, then `handler-entry-not-found` on link, both compilers and RT-1.
- [x] After the single `export=true`, the file is admitted end-to-end and the
  three legs produce byte-identical envelopes with an absent result and its 23
  ordered stdout events.
- [x] The F5 projection digest, the linked program digest and the three-leg
  envelope digest are pinned as goldens and recompute on every gate run.
- [x] The census walks all 240 tracked `.kern` files, one child per file, with a
  hard timeout, closed stdin, a progress line per file and a report rewritten
  after every file. One full sweep completed 240 of 240 with zero timeouts.
- [x] The whitelist is exactly `["examples/kern-5-preview-app/ui.kern"]`.
- [x] A whitelisted file that stops admitting is red; a file that starts
  admitting without being whitelisted is red; the ratchet floor cannot be lowered
  by editing the whitelist alone.
- [x] `--update` rewrites the whitelist only when invoked, and only from a
  complete tracked sweep.
- [x] The census does not modify any repository file it measures.
- [x] No runtime, linker, emitter, F0-F5 or ledger source changed.
- [x] RT-6 (52/52), RT-4 (50/50), RT-3 (142/142), RT-2 (35/35), the merged RT-5
  (86/86) and the r1/r2/c-py-1/cli-shadow neighborhood (83/83) stay green.
- [x] `pnpm test:kern-canonicalizer` stays at 872/872, before and after the rebase
  onto RT-5, with the `runner.js` transition carrying the changed compiled bytes
  and no runtime measurement re-run.
- [x] `pnpm test:runner-smoke` stays green on the **unmodified** smoke gate.
- [x] A skipped void export stays unimportable and fails closed before any stdout.
- [x] Every other unbound export keeps its existing fatal diagnostic.

## RED Oracle

`scripts/kern-5-admission-census/census.test.mjs`, ten tests, run entirely on
the real projection, the real linker, the real emitters and real target children.

| Test | Failing at base |
| --- | --- |
| the committed ratchet is the RT-7 birth value and never sinks below its floor | yes — the ratchet did not exist |
| the whitelist and the pinned rejection sample are disjoint | yes |
| every whitelisted file is admitted end-to-end on all three legs today | **yes — `handler-entry-not-found`** |
| no file outside the whitelist is admitted | no (regression fence) |
| the pinned rejection sample keeps its first diagnostic | yes — the sample did not exist |
| the admitted count never falls below the whitelist length | **yes — the count was 0** |
| the sweep records a hard per-file timeout, logs progress, and writes after every file | yes |
| the sweep leaves every tracked `.kern` file untouched | yes |
| a concurrent sweep still reports its results in corpus order | yes |
| `--update` rewrites the ratchet only from a complete tracked sweep | yes |

The RED gate is *every whitelisted file is admitted* together with *the admitted
count never falls below the whitelist length*: both are unsatisfiable at base
because the corpus admitted nothing at all.

## Mutation Pass

Twelve mutants, each applied to a per-file backup copy and never through
`git checkout`, each run against the whole census gate.

| # | Mutant | Result | Killed by |
| --- | --- | --- | --- |
| 1 | the ui.kern row is deleted from the whitelist | KILLED | ratchet floor and birth-file literals |
| 2 | `export=true` reverted on `ui.kern` | KILLED | whitelist admission, at link |
| 3a | the recorded envelope digest is altered by one hex character | KILLED | whitelist admission |
| 3b | the emitted-JavaScript envelope loses its last event | KILLED | whitelist admission, at envelope agreement |
| 3c | the emitted-Python envelope loses its last event | KILLED | whitelist admission, at envelope agreement |
| 4 | `ui.kern` is added to the rejection sample as a synthetic non-whitelisted admission | KILLED | disjointness, *no file outside the whitelist is admitted*, and the monotone count |
| 5 | the sweep stops recording `timedOut` and `timeoutMs` | KILLED | sweep timeout test |
| 6 | the sweep stops logging a line per file | KILLED | sweep progress test |
| 7 | admission always fails at envelope agreement | KILLED | whitelist admission **and** the monotone count |
| 8 | a pinned rejection's expected diagnostic is changed | KILLED | rejection-sample drift test |
| A1 | the explicit-void skip is removed (re-fatalized) | KILLED | the **unmodified** preview-app smoke gate |
| A2 | every unbound export is skipped | KILLED | non-void fail-closed, absent/empty returns |
| A3 | absent or empty `returns` admitted as void | KILLED | absent/empty returns test |
| A4 | the skipped symbol is exported with a fabricated binding | KILLED | export-map absence probe (see below) |
| 9 | the report is written once at the end instead of after every file | KILLED | sweep incremental-write test |
| 10 | concurrent results are stored by completion order | KILLED | corpus-order test |

Twelve mutants, no survivors and no equivalent mutants. Every mutant's full
failure list was captured, so the assertion the contract names is confirmed to
fire rather than only an incidental neighbour — mutant 4, for example, fails
disjointness, *no file outside the whitelist is admitted*, the pinned-diagnostic
test and the monotone count together.

## Amendment mutation pass

Four mutants on `packages/core/src/runner.ts`, each on a per-file backup, each
rebuilt and run against its oracle. **4 killed, 0 survivors.**

Mutant A4 initially **survived**, and the reason is worth keeping: the import
fail-closed property is enforced **twice**. Fabricating an export entry does not
make the symbol importable, because `buildRunnerModuleScopes` in
`runner-runtime-scope.ts` independently refuses to bind it — proved by stack
trace. The first assertion could therefore not see the mutation. The suite now
also probes the export map directly with a kind-mismatched import: a symbol
present under the wrong kind reports `expected kind ... but found ...`, so
`does not export` proves the skip never fabricated an entry. That kills A4.

The amendment relaxes only the **outer** of those two gates, which is why it
cannot open an import path.

## Out of Scope

- Any runtime, linker, emitter, F0-F5 or ledger change. If a `.kern` file needs
  one to be admitted, that is the next slice, not this one.
- Any second repository `.kern` edit. Adding `export=true` elsewhere would widen
  the census by fiat rather than by capability, and every other candidate is
  blocked earlier than entry selection anyway.
- Raising `KIR_SHADOW_LIMITS` so the shipped CLI can print all 23 events. The
  three legs already agree at the truncation boundary; changing the shipped
  budget is a product decision with its own blast radius.
- The bare `return` early exit, still deferred from RT-6.
- Any KIR schema or version change, release-gate promotion, push, merge or
  deployment.

## Open Questions

None blocking.

## Follow-ups

- **No transition generator is checked into the repository.** Every existing
  `*-historical-transition.mjs` carries the header *"Generated authenticated
  transition data; regenerate only from the two pinned commits"*, but the tool that
  generates it is absent. This layer's data was hand-authored and then verified
  mechanically: both replacement texts were asserted to occur exactly once, and the
  reconstruction was asserted to hash to the archived predecessor digest before the
  module was written. A checked-in generator would make the next such transition
  reproducible rather than artisanal.
- The five pinned rejections are all `projection` or `entry-selection` stage
  because the full sweep found **no** file that projects, exports an `fn`, and
  then fails at link. When one appears, pin it: the sample would then cover the
  whole admission ladder.
- Three files project cleanly and stop only at the missing `export=true`. Each is
  one property away from a ratchet turn, and each needs its own three-leg
  verification before it is whitelisted.
- The corpus's dominant wall is `UNEXPECTED_TOKEN` at 101 files, followed by a
  non-`fn` module root at 76. Together they are three quarters of the corpus, and
  both are projection work.
- `admission.json` carries per-stage timings, so it is a run record rather than a
  reproducible artifact. Nothing gates on it; the goldens live in
  `admitted.json`.

## Deploy Order

1. Land the census runner; it is inert until a ratchet exists.
2. Land the single `export=true`.
3. Land the ratchet, the pinned sample and the gate together; the gate is red
   without the edit and vacuous without the ratchet.

The gate needs Node 22 (`KERN_NODE22`, default `process.execPath`) for the
emitted-ESM leg and CPython 3.12 (`KERN_PYTHON312`, default `python3.12`) for the
emitted-Python leg, matching RT-2 through RT-6.
