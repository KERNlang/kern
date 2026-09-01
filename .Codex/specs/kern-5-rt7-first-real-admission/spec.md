# KERN 5 RT-7: The first real repository file runs on the owned pipeline

**Status:** IMPLEMENTED
**Date:** 2026-09-01
**Base:** `55e92de8` (RT-6 merged; contains RT-2 boolean `if`, RT-3 binary expressions,
RT-4 same-module user calls, RT-6 void fall-through)
**Implemented at:** `92883a84` (census runner), `f0105d47` (the one repository `.kern` edit),
`9a6ac9c1` (ratchet, pinned rejection sample, fast test, root script),
`3b886e42` (concurrent sweep)
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

### The fast test never sweeps

The full sweep is measured in hours, so it is a separate documented script
(`pnpm sweep:kern-5-admission-census`). The default gate
(`pnpm test:kern-5-admission-census`) resolves the whitelist plus five pinned
known-rejected files with their expected first diagnostic, and exercises the
sweep's timeout, progress-log and incremental-write behaviour against a
one-millisecond budget. It runs in about nineteen seconds.

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
| `package.json` | Modified | `test:kern-5-admission-census`, `sweep:kern-5-admission-census`. |

**Zero production files.** No `packages/core/src` and no `packages/cli/src` file
is added, removed or modified, so the canonicalizer historical-transition gate
does not apply and its receipts do not move.

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
- [x] RT-6 (52/52), RT-4 (50/50), RT-3 (142/142), RT-2 (35/35) and the
  r1/r2/c-py-1/cli-shadow neighborhood (83/83) stay green.

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
| 9 | the report is written once at the end instead of after every file | KILLED | sweep incremental-write test |
| 10 | concurrent results are stored by completion order | KILLED | corpus-order test |

Twelve mutants, no survivors and no equivalent mutants. Every mutant's full
failure list was captured, so the assertion the contract names is confirmed to
fire rather than only an incidental neighbour — mutant 4, for example, fails
disjointness, *no file outside the whitelist is admitted*, the pinned-diagnostic
test and the monotone count together.

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
