# KERN 5: `maxIterations` — a dedicated iteration budget for the runtime envelope

**Status:** IMPLEMENTED
**Date:** 2026-09-02 (evidence remeasured 2026-09-03)
**Base:** `1a88c705` (`origin/main`, CI census sweep merged)
**Confidence:** 0.93 (was 0.89; the RC-v1 re-pin OPEN that capped it is resolved as MS-R7)

## Executive Summary

The runtime envelope has no iteration budget of its own. All four execute sites pass
`limits.maxCollectionLength` — a value ceiling meant to bound how many items one list or
record may carry — into the effect machine as `iterationBudget`. One number therefore
answers two unrelated questions, and the answers pull in opposite directions: a caller
that wants a long-running loop must also permit a 33.5-million-element list, and a caller
that wants a tight value ceiling must accept a short loop.

This slice splits the knob. `maxIterations` becomes a seventh, **required** key on the envelope
and handler limits records and is the only source of `iterationBudget`;
`maxCollectionLength` returns to meaning collection length and nothing else. No envelope
byte changes for any program that does not exhaust a budget.

It is the runtime slice that `.Codex/specs/kern-5-f5-iteration-budget/spec.md` deferred as
its Option C ("Add a dedicated runtime iteration-budget field … belongs in a separately
authorized runtime slice", confidence 0.78). It is now authorized.

## Current State / Root Cause

- **VERIFIED:** `InternalRuntimeEnvelopeLimits` carries six keys and no step budget —
  `packages/core/src/runtime-envelope/types.ts:6-13`.
- **VERIFIED:** all four execute sites feed the collection ceiling to the effect machine as
  the iteration budget: `runtime-envelope/execute.ts:44` (sync, positional argument 3) and
  `:73` (`iterationBudget: accepted.limits.maxCollectionLength`), and identically in
  `runtime-envelope/execute-compat.ts:49` and `:80`.
- **VERIFIED:** the effect machine decrements that budget once per loop-frame iteration and
  throws at zero — `ir/semantics/internal-effect-machine-sequence.ts:55-61`,
  `throw new InternalEffectMachineError('effect machine iteration budget exhausted', node)`.
- **VERIFIED:** `normalize.ts:147` collapses every `InternalEffectMachineError` to the
  diagnostic code `unsupported-runtime-input`. A program that merely ran too long is
  reported as an unsupported *input* — a misclassification, not just a coarse message.
- **VERIFIED:** the same `maxCollectionLength` is a genuine collection ceiling at
  `runtime-envelope/value.ts:89` (`$… exceeds maxCollectionLength`, array branch) and `:111`
  (record branch), `runtime-envelope/handler-entry.ts:45` (`inspectArray`) and `:93-94`
  (parameters and arguments), `kir-runtime/inspect.ts:60`,
  `compiler/kir-js-esm/target-base.ts:90`, `compiler/kir-python/target-base.ts:143`, and
  `canonical-value/validate.ts:174`.
- **VERIFIED:** `validateInternalRuntimeLimits` is the single choke point and is called from
  eight sites — `runtime-handler.ts:262`, `runtime-envelope/execute.ts:26`,
  `execute-compat.ts:30`, `source-handler.ts:54`, `handler-entry.ts:91`, `kir-handler.ts:68`,
  and `normalize.ts:121` and `:158`. Widening its key list is therefore one edit that changes
  every entry point at once, which is what makes the required key affordable.
- **VERIFIED:** the KIR runtime contract already models the two limits separately —
  `KernKirLimits` in `packages/core/src/kir-runtime/contracts.ts:20-28` carries **both**
  `maxCollectionLength` and `maxSteps`, and `kir-runtime/inspect.ts:45-48` enforces
  `maxSteps` as a step ceiling (`runtime step limit exceeded`) while `:58-63` enforces
  `maxCollectionLength` (`exceeds collection limit`). `compiler/kir-js-esm/target-base.ts:204`
  and `compiler/kir-python/target-base.ts:13,218` both emit the seven-key list
  `['maxBytes','maxCollectionLength','maxDepth','maxDiagnostics','maxEvents','maxSteps','maxStringBytes']`
  — a seven-key record that is **shape-compatible but semantically different** from the one
  this slice adds. That near-miss is the hazard MS-R0 rules on.
- **VERIFIED:** `KernKirLimits.maxSteps` counts **every step**. `kir-runtime/inspect.ts:41-49`
  increments `this.steps` in a `check()` called from `text()`, `collection()` and every
  expression node, so a step-free loop still consumes it. The envelope budget counts only
  **loop frames**: `consumeIterationBudget` is reached solely from `each`/`for`/`while`/`lambda`
  nodes (`internal-effect-machine-sequence.ts:55-75`), and the machine names its own state
  field `remainingIterations` (`internal-effect-machine.ts:122,151`) fed by an option called
  `iterationBudget` (`internal-effect-machine-types.ts:41,48`). Two different quantities.
- **VERIFIED (measured):** with the shipped policy the overload is load-bearing, not
  theoretical. `.Codex/specs/kern-5-f5-iteration-budget/spec.md` records 32/32 investigated
  `projection-fatal` census files traced to iteration-budget exhaustion on the `1a88c705`
  policy, citing `.worktrees/kern-5-rt9/.agon-goals/f5-fatal/SUMMARY.json`.

Root cause: one field with two meanings.

### The F5 measurement, and what it actually proves

The lane-2 measurement artifacts (gitignored: `summary.json`, `results.json` 32 rows,
`results-budget.json`, `run.log`, `run-budget.log`) live under the F5 iteration-budget
worktree's `.agon-goals/f5-measure/`; the numbers are reproduced in
`.Codex/specs/kern-5-f5-iteration-budget/spec.md`. Cited, not copied.

- **VERIFIED:** the measurement was only possible after raising the overloaded field.
  `git diff` in that worktree is a single hunk: `runtimeLimits.maxCollectionLength`
  `1048576` → `33554432`. **This is the whole argument for the slice.** To learn how many
  steps the compositions need, the harness had to widen an OOM-class value ceiling 32×,
  because there was no other way to widen the budget.
- **VERIFIED:** with the ceiling raised, 19 of 32 files project cleanly and 13 stop at
  `F5_LIMIT`; `summary.json` `outcomeHistogram` is exactly `{"fatal:F5_LIMIT": 13,
  "projected": 19}` and `diagnosticCodes` is `{"F5_LIMIT": 13}` — **zero**
  `unsupported-runtime-input`. Clean runs reach 14.5M–32.5M `workSteps`, so the former
  1,048,576 budget was indeed the first wall.
- **VERIFIED:** `F5_LIMIT` is emitted by the KERN composition itself against its own
  `profileLimits.maxWorkSteps` ledger — `examples/kern-frontend/f5-projection-main.kern:129,198`.
  It is a legible, in-language refusal. The 13 rows first cross at 34.8M–77.2M steps.
- **VERIFIED (in progress):** the 4× budget sweep (`results-budget.json`,
  `raisedCap: 134217728`) has 3 of 13 rows so far; all three now project
  (`terminalSeal: "projection:closed"`, `artifactPresent: true`) at 47.5M / 50.9M / 35.1M
  steps — 1.41× / 1.52× / 1.05× the current `maxWorkSteps`.

**[MS-R1 DECIDED] This slice does not, by itself, admit any census file.** Raising
`profileLimits.maxWorkSteps` is a *separate* F5 policy decision that the sweep above is
still measuring. What this slice delivers for F5 is that the ceiling stops lying: the 13
over-budget files fail at `F5_LIMIT` — their own declared contract — instead of at a
generic `unsupported-runtime-input`, and the 19 clean files no longer need a 32× value
ceiling to run. Any claim that this slice unblocks 32 files is false, and the oracle
asserts nothing of the kind.

The **timeout wall is a separate, deferred milestone: "F5 composition performance."**
`summary.json` `wallMs` is min 91,427 / p50 221,992 / p95 526,356 / max 786,794 ms
sequential, against `scheduler.timeoutMs` of 120,000 (`policy.json:61`); only 2 of 32 finish
under 120 s. Nothing here changes that, and this slice must not touch `scheduler.timeoutMs`.

## What Already Works

- The envelope output contract. `InternalRuntimeEnvelope` (`types.ts:64-71`) has no limits
  field. Limits are request-side inputs, so no envelope byte moves for a program that does
  not exhaust a budget. This is the byte-identity claim and leg 3 pins it.
- `KernKirLimits` (`kir-runtime/contracts.ts:20-28`) is already correct and is not touched.
- Every genuine `maxCollectionLength` enforcement site listed above keeps its current
  meaning and its current message. None is edited.
- The F5 asset pipeline needs no hand-written digest: `build-kern-frontend-projection-assets.mjs`
  hashes `policy.json` into the generated bundle and the loader authenticates the generated
  bytes, so a normal core build propagates a policy edit
  (`.Codex/specs/kern-5-f5-iteration-budget/spec.md`, "What Already Works").
- `loadPinned()` (`policy-validation.mjs:92-100`) pins the F4 policy, mapping authorities and
  composition `.kern` sources. This slice edits none of them, so **no RT-8 amendment record
  is required** and `scripts/kern-frontend-closure/amend.mjs` is not invoked.

## Contract (Verified)

> Verified against the files and commands cited, on the
> `feat/kern-5-runtime-envelope-max-steps` worktree at base `1a88c705`
> with `packages/core` built, on 2026-09-02. All paths in this document are repo-relative.

| Field / Behavior | Shape | Evidence | Tag |
|---|---|---|---|
| `InternalRuntimeEnvelopeLimits.maxIterations` | required positive safe integer | `runtime-envelope/types.ts:6-13` (absent today) | VERIFIED |
| `KernRuntimeHandlerLimits.maxIterations` | required positive safe integer | `runtime-handler.ts:56-63` (absent today) | VERIFIED |
| envelope exact-key set | `maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes` → gains `maxIterations` | `runtime-envelope/value.ts:30`; probe below | VERIFIED |
| handler `LIMIT_KEYS` | same six → gains `maxIterations` | `runtime-handler.ts:164-171` | VERIFIED |
| shared key declaration | `INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS` in `runtime-envelope/types.ts`, consumed by `value.ts` and `runtime-handler.ts` | added by this slice; L1 reads it | VERIFIED |
| handler `acceptedLimits` | explicit per-key copy, **not** a spread | `runtime-handler.ts:293-300` | VERIFIED |
| `iterationBudget` source | `limits.maxIterations` at all four sites | `execute.ts:44,73`; `execute-compat.ts:49,80` | VERIFIED |
| budget-exhaustion diagnostic | `unsupported-runtime-input`, `phase:"execution"` | `normalize.ts:147`; probe below | VERIFIED |
| collection-ceiling diagnostic (arguments) | `invalid-handler-arguments`, `phase:"execution"` | `handler-entry.ts:93-94`; probe below | VERIFIED |
| F5 `profileLimits.maxWorkSteps` | `33554432` | `kern-frontend-f5-projection/policy.json:35` | VERIFIED |
| F5 `runtimeLimits.maxCollectionLength` | `1048576`, **unchanged** by this slice | `policy.json:56` | VERIFIED |
| F5 `RUNTIME_KEYS` | six keys, exact-set checked | `policy-validation.mjs:41-43,55,64` | VERIFIED |
| F5 relationship failure message | `F5 projection policy: limit relationship` | `policy-validation.mjs:22,86-88` | VERIFIED |
| `INTERNAL_RUNTIME_ENVELOPE_FORMAT` | `kern.runtime.internal.r0`, **not bumped** | `types.ts:4`; see MS-R4 | VERIFIED |

### RED-at-base probes (exact strings, recorded)

Run against the built `packages/core/dist` at `1a88c705`:

```
validateInternalRuntimeLimits({…6 keys…, maxIterations: 1000})
  -> InternalRuntimeEnvelopeError/invalid-limits:
     "limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes"
validateInternalRuntimeLimits({…6 keys…})            -> ACCEPTED     (must become a refusal)
executeKernRuntimeHandlerSync(…, {limits: {…6 keys…, maxIterations: 1000}})
  -> KernRuntimeHandlerError/invalid-limits: "runtime handler limits are invalid"
```

The public handler wraps the envelope message; it does **not** leak the key list. An oracle
matching the envelope string on the handler path would never pass.

Budget vs ceiling, one limits record, `maxCollectionLength: 16`, `while` loop over `n`:

```
n=10   -> outcome success,  result {"tag":"integer","value":"10"}
n=100  -> outcome failure,  diagnostics [{"category":"runtime","code":"unsupported-runtime-input","phase":"execution"}]
```

Argument list against the same record, handler `param name=rows type="number[]"` returning `rows`:

```
3 items  -> success
16 items -> success
17 items -> failure, diagnostics [{"category":"runtime","code":"invalid-handler-arguments","phase":"execution"}]
```

Two different codes for the two limits. That difference is what makes the decoupling leg
discriminating rather than merely green.

## [MS-R0 DECIDED] The key is `maxIterations`, never `maxSteps`

Reversed after adversarial review. The first draft reused KERN's existing `maxSteps` on the
grounds that the name was already taken for "this exact quantity". It is not the same
quantity, and reusing the name plants a time bomb.

- `KernKirLimits.maxSteps` counts every step (`kir-runtime/inspect.ts:41-49`); the envelope
  budget counts loop frames only (`internal-effect-machine-sequence.ts:55-75`). A program with
  one loop and a million expression nodes exhausts the KIR limit and not the envelope's; a
  program with a million empty iterations does the reverse.
- Under a shared name the two records become **shape-identical**: seven keys, same spellings.
  `{...kirLimits}` would then pass the envelope's exact-key check and silently install a
  step budget where an iteration budget was meant — a defect that type-checks, validates, and
  runs. Exact-key validation, the one mechanism designed to catch limits-shape drift, would be
  blind to it precisely because the shapes match.
- With distinct names the same spread **fails closed** at `validateInternalRuntimeLimits`,
  which is why L1 carries the KIR-spread fixture as a recorded refusal rather than a comment.
- `maxIterations` is also the name the codebase already uses for this quantity everywhere
  except the limits record: the machine's option is `iterationBudget`, its state field is
  `remainingIterations`, the source runner's option is `iterationBudget`, and the CLI flag is
  `--iteration-budget` (`packages/cli/src/commands/run.ts:589,666-669`). The limits record was
  the only place that called it anything else.

Cost of the reversal: none beyond this document and the oracle. No implementation had begun.
The slice directory keeps its original `…-max-steps` slug because two commits and the root
script already reference it; the *key* is `maxIterations` and nothing in the contract carries
the old spelling.

## [MS-R2 DECIDED] `maxIterations` is REQUIRED

Blast radius measured, not estimated. Discriminator: an envelope/handler limits record is
any record carrying `maxDiagnostics`; a KIR record additionally carries `maxSteps` already.

```
grep -rln maxDiagnostics scripts packages/*/src packages/*/tests tests generated assets examples \
  --include='*.mjs' --include='*.ts' --include='*.json' --include='*.js' \
  | grep -v node_modules | grep -v '/dist/'
```

Two numbers, with their rules, because they measure different things.

- **Mechanical fence (what leg L5 enforces): 77 files.** Rule: the file contains all six
  current key names and does not contain `maxIterations`. 96 files contain all six; 19 already
  carry `maxIterations`. This rule is exactly what `envelopeShapedFiles()` in the oracle computes,
  so the fence and this count cannot drift apart. It excludes pure *consumers* —
  `runtime-envelope/normalize.ts` and `cli/src/kir-shadow/normalize.ts` read
  `limits.maxDiagnostics`/`maxEvents` but construct no record — correctly, since they need no
  edit.
- **Audited construction and validation sites: 46 non-test + 43 test = 89 files.** Hand-read,
  after discarding two classes of false positive: the frontend/checker/canonicalizer
  `policy.json` files each carry an *unrelated* `profileLimits.maxDiagnostics` alongside the
  real `runtimeLimits` record, and ten files construct seven-key `KernKirLimits` records that
  already have `maxSteps`. Breakdown: 22 construction sites (9 source/script + 13 JSON
  policies), 21 key-set validators, 3 RC-v1 goldens.

Neither number is the other's superset — the fence is textual and conservative; the audit is
semantic. Implementation must satisfy the fence and consult the audit for *which* value each
record gets.

Three sites deserve naming because they are not simple literals:

- `scripts/kern-5-r0-contracts/r0-abi-template-esm.mjs:44` and `r0-abi-template-python.mjs:19`
  embed `LIMIT_KEYS` **inside code-generation template strings** — the generated child
  handler's own validator. Editing the template changes generated ESM and Python source.
- `scripts/kern-5-r0-contracts/schema/runtime-request.json:86-98` is a JSON Schema whose
  `properties` and `required` arrays both enumerate the six keys.
- `examples/kern-5-preview-app/server.mjs:25-31` holds `RUNTIME_HANDLER_LIMIT_KEYS` and
  exact-key-checks a user-supplied config at `:81-88`, so its config file
  (`runtime-handler-config.json:5-11`) and its key array must move together.

- **VERIFIED:** `packages/core/tests/runtime-contract-v1-parity.test.ts` asserts
  `Assert<Equal<KernRuntimeHandlerLimits, InternalRuntimeEnvelopeLimits>>` at compile time.
  The public and internal records **cannot** diverge; adding the key to one without the other
  fails `tsc`. This is a gift — it makes "public and internal agree" a type-level invariant
  rather than a review item.
- **VERIFIED:** `scripts/runtime-handler-public-declaration.mjs:144` diffs the *built* `.d.ts`
  interface properties against `constitution.json.limits`, so it adapts automatically once
  both sides gain the key — and fails loudly if only one does.
- **VERIFIED:** `runtime-handler.ts:293-300` builds `acceptedLimits` by explicit per-key copy,
  so no site picks the new key up for free. Pass-through sites exist —
  `scripts/kern-frontend-f3-line-tree/worker.mjs:182-184` and `f2-batch/worker.mjs:205-208`
  spread `...runtimeLimits`, and the 18 `scripts/check-kern-frontend-*.mjs` scripts forward
  `policy.runtimeLimits` whole — but each still sits downstream of a hardcoded validator that
  rejects a seven-key object until updated. There is no free ride.

REQUIRED is chosen over OPTIONAL-with-fallback because:

1. **The fallback *is* the bug.** `maxIterations ?? maxCollectionLength` keeps one number
   answering two questions for all 77 existing callers and makes the coupling permanent and
   invisible. Nothing would be fixed except the F5 call site.
2. **The amendment cost is identical.** `maxIterations?: number` changes the frozen public
   declaration text just as `maxIterations: number` does (MS-R3), so OPTIONAL does not avoid the
   constitution work — it only avoids the sweep.
3. **Exact-key validation is a deliberate KERN 5 invariant.** `value.ts:30-40` and
   `runtime-handler.ts` reject unknown *and* missing keys so that no limits shape can drift
   silently. An optional key is a hole in the one mechanism that would otherwise catch this
   class of bug next time.
4. **The sweep is 1 decision, not 77.** For all 76 non-F5 sites,
   `maxIterations := <that record's current maxCollectionLength>` is behavior-preserving *by
   construction* — it is literally the value the effect machine receives today. Only F5
   chooses a genuinely new number. So the sweep is mechanical transcription plus one ruling,
   and byte-identity across it is provable rather than hoped for.
5. **There is no external caller to break.** `validateRuntimeContractV1` returns
   `runtimeAbiFrozen: false` (`validate-runtime-contract-v1.mjs:337-344`) and the lineage
   holds exactly one version. This is the window in which the shape may still change.

**The forcing function is the consumer, not a repo test.** An earlier draft leaned on
`runtime-contract-v1-parity.test.ts` (the `Assert<Equal<…>>`) as the reason the public type
must move. That is backwards — a repo test is a consequence, and could be deleted. The real
reason is that **the F5 worker sets limits through the public handler API**:

```
executeKernRuntimeHandlerSync({ … }, { enabled: true, limits: state.policy.runtimeLimits, … })
```

`scripts/kern-frontend-f5-projection/worker.mjs:79-84`, passing `runtimeLimits` verbatim. F5
is the caller that needs a budget it can set, and the only channel it has is
`KernRuntimeHandlerLimits`. So the public type must carry `maxIterations` for the use case to
exist at all, and the RC-v1 amendment is **forced by the consumer**. The parity assertion is
then a welcome guard that keeps the internal record in step — not the argument.

**Wrong-value risk at the 76 transcription sites is nil, and no collection semantics move.**
The transcribed value *is* the number the effect machine receives today, so each site's
behaviour is unchanged by construction, and a wrong value cannot hide: it would either
loosen a budget below today's (caught by that site's own tests) or tighten it (caught
immediately). Separately, `maxCollectionLength` keeps **exactly** its base semantics at every
site — this slice removes a *second* reader of the field and touches no enforcement:
`runtime-envelope/value.ts:89` (array) and `:111` (record),
`runtime-envelope/handler-entry.ts:45` (`inspectArray`) and `:93-94` (parameters, arguments),
`kir-runtime/inspect.ts:58-63`, `compiler/kir-js-esm/target-base.ts:90` and
`compiler/kir-python/target-base.ts:143` (both emitted list checks), and
`canonical-value/validate.ts:174` — all VERIFIED unchanged. Collections were fully capped at
base and remain fully capped after; only the budget's *source* changes, to an equal value.
That disposes of the review's "collections were uncapped" premise.

Accepted cost: 77 files by the fence, one integer each, and the RC-v1 amendment below.

## [MS-R6 DECIDED] Every consumer of the iteration budget, enumerated

`grep -rn "iterationBudget\|runInternalRuntimeEngineSync\|runInternalRuntimeEngineAsync"`
over `scripts packages/*/src examples`, excluding `dist` and `node_modules`, 2026-09-02.
There are **two** budget paths, and only one is defective.

| Consumer | Budget source | Touched? |
|---|---|---|
| `runtime-envelope/execute.ts:44,73` | `limits.maxCollectionLength` → `limits.maxIterations` | **YES** |
| `runtime-envelope/execute-compat.ts:49,80` | same | **YES** |
| `runtime-envelope/internal-engine.ts:46-63` | positional/option pass-through | no (plumbing) |
| `runtime-envelope/source-runner-engine.ts:29,51,76,88` | **explicit `iterationBudget` option** | no — already correct |
| `runner.ts:112,824,879,999,1030` | forwards `options.iterationBudget` | no |
| `runner-capability-plan.ts:68,156,430` · `runner-class-frame-capability-admission.ts:31,62` | forwards for admission | no |
| `cli/src/commands/run.ts:589,666-669,724,733` + `run-options.ts:23,43` | `--iteration-budget` CLI flag | no |
| `ir/semantics/source-runner-admission.ts:44-47` | requires a budget to admit the machine | no |
| `scripts/check-source-runner-convergence.mjs:328-431` | AST gate: budget must be forwarded exactly once | no — but see below |
| `scripts/semantic-ownership/validate.mjs:57,67` | ownership edges for the engine entry points | no |
| ~30 `scripts/kern-canonicalizer/*measure*.mjs` | `{...policy.runtimeLimits, maxCollectionLength: iterationBudget}` | **YES — see below** |
| `scripts/check-runner-browser-budget.mjs` | **unrelated** | no |

- **VERIFIED (the second path is already right):** `SourceRunnerEngineOptions.iterationBudget`
  is an explicit optional integer validated by `validateIterationBudget`
  (`source-runner-engine.ts:39-44`) and passed straight to the engine at `:76` and `:88`. It
  is **not** limits-derived. The source runner therefore already has what this slice gives the
  envelope, which is independent evidence that the envelope is the outlier and that
  `maxIterations` is the codebase's own name for the quantity (MS-R0).
- **VERIFIED (convergence is measurable):** at base, for the same 20-iteration program,
  `executeSourceRunnerSync(..., { iterationBudget: 5 })` throws `InternalEffectMachineError`
  `effect machine iteration budget exhausted` — the identical error the envelope normalizes to
  `unsupported-runtime-input`. Both runners abort iff the budget is below the loop count, so a
  convergence fixture is possible and is leg **L6**: for budgets `[1, 5, 19, 20, 21, 10000]`
  the two runners must agree at every point, and the shared threshold must be the loop count.
  This is **not** recorded OPEN; it is tested.
- **VERIFIED (the measurement scripts are a real caller class):** ~30 canonicalizer scripts
  build `{...policy.runtimeLimits, maxCollectionLength: iterationBudget}` — e.g.
  `runtime-bottleneck-m4-103-measure.mjs:144`, `runtime-cost-m4-104-measure.mjs:130`,
  `triple-row-headroom-m4-102-measure.mjs:108`, `combined-headroom-m4-145-measure.mjs:219`.
  They exploit the overload *deliberately*, to sweep the budget. Each must become
  `{...policy.runtimeLimits, maxIterations: iterationBudget}`, which is also the clearest
  possible demonstration that the two fields were conflated: these scripts were setting a
  collection ceiling in order to move a budget. Their pinned observation numbers (e.g.
  `runtime-cost-m4-129.mjs:157` expects `iterationBudget !== 54_894`) are budget values, not
  collection values, so they stay valid.
- **VERIFIED (dismissed with evidence):** `scripts/check-runner-browser-budget.mjs` is a
  *performance* gate — cold import/execute milliseconds, raw and gzip byte ceilings, read from
  `scripts/runner-browser-budget-policy.json` (`:18,106,128-141`). It contains no
  `iterationBudget` and no envelope limits record. Out of scope.
- **OPEN (narrow):** `check-source-runner-convergence.mjs` asserts by AST that each function
  forwards `options.iterationBudget` exactly once to a named callee. It gates the *source
  runner*, which this slice does not modify, so it should stay green — but it is an AST
  matcher over the same subsystem and must be re-run. Not blocking, and not a contract claim.

## [MS-R3 DECIDED] This is a public runtime-contract (RC-v1) amendment

Headline finding, and the item the brief did not have. `KernRuntimeHandlerLimits` is not an
ordinary exported type — it is **frozen by name and by exact declaration text** in the
runtime constitution, and the four artefacts are digest-pinned to each other.

- **VERIFIED:** `scripts/runtime-contract-v1/constitution.json:30-37` holds the public
  `limits` key list — the same six names — and `:5` holds
  `"internalFormat": "kern.runtime.internal.r0"`.
- **VERIFIED:** `scripts/runtime-contract-v1/public-declaration-schema.json:12` pins the
  literal `.d.ts` text
  `"export interface KernRuntimeHandlerLimits {\n    readonly maxBytes: number;\n … readonly maxStringBytes: number;\n}"`.
  Adding a key changes this string, required or optional.
- **VERIFIED:** `scripts/runtime-contract-v1/goldens.json:3-10` embeds a six-key `limits`
  record and `:558-562` a per-key boundary case list; `proof-inventory.json:171-177` holds
  the matching per-key boundary proof rows. `validateDeclarationSchema(schema, constitution)`
  and `validateGoldens(goldens, proofInventory)`
  (`validate-runtime-contract-v1.mjs:285-302,327-335`) cross-check the three against each
  other, so a `maxIterations` row must be added to **all** of them or the set fails closed.
- **VERIFIED:** `scripts/runtime-contract-v1/lineage.json` pins all four by SHA-256
  (`constitutionSha256 f626dfe8…`, `proofInventorySha256 993f490d…`,
  `declarationSchemaSha256 f611dbdd…`, `goldensSha256 1ab12a79…`) and
  `validateLineage` (`:304-322`) recomputes every one; `versions.length !== 1` is a hard
  failure, so there is no multi-version amendment path — the digests are re-pinned in place.
- **VERIFIED (negative):** `grep -rn "writeFileSync\|--write" scripts/runtime-contract-v1/*.mjs
  scripts/check-runtime-contract-v1.mjs` on 2026-09-02 matches only
  `runtime-dynamic-loader-safe-patterns.test.mjs` (a test's own scratch writes). **The RC-v1
  pins have no writer.** This is the RT-8 `[RT8-R2]` missing-writer finding again, on a
  second surface, exactly as `[RT8-R3]` follow-up 3 predicted.

Consequence for the implementation phase: see MS-R7. A bare recompute is forbidden.

## [MS-R7 DECIDED] RC-v1 gets an amendment protocol; recomputing the pins is forbidden

Ruled after review. Recomputing `lineage.json` because the artefacts changed turns the pin
into decoration: it would pass every gate while proving nothing, since the "authority" would
be whatever the last writer happened to produce. The build must instead generalize the RT-8
protocol to the RC-v1 surface — the follow-up `[RT8-R3]` item 3 predicted exactly this.

Shape, mirroring `scripts/kern-frontend-closure/amend.mjs` and its chain tests:

- **Amendment record** at `scripts/runtime-contract-v1/amendments/<slice>.json`, carrying
  `format: "kern.runtime.contract.amendment.v1"`, `slice`, `disposition: "additive"`,
  `rowsChanged` (here exactly `["limits.maxIterations"]`), and `parentDigests` /
  `resultDigests` for all four pinned artefacts.
- **Writer/verifier** at `scripts/runtime-contract-v1/amend.mjs`, exporting
  `verifyRuntimeContractAmendmentChain()`. It walks the genesis-anchored predecessor/successor
  chain rather than checking one parent edge — the defect the RT-8 review found and fixed
  (`.Codex/specs/kern-5-rt8-integer-signatures/spec.md`, `[RT8-R3]`). It refuses, non-zero and
  without writing, when an artefact drifted with no amendment naming it, when two amendments
  claim the same artefact, when `parentDigests` is not what is currently pinned, or when the
  disposition is not additive. Substitute digests in the raw text after proving each occurs
  once; never re-serialize.
- **Sidecar, not a new version.** The record lives beside `lineage.json`, which keeps
  `versions.length === 1` — `validateLineage` hard-fails otherwise
  (`validate-runtime-contract-v1.mjs:308`), and that check is not being relaxed.
- **Root override** (`--root` / env) so the chain tests run against a scratch copy, per the
  RT-8 correction that a crashed test must not leave a drifted pin poisoning every gate.

**The writer sits outside its own pin — verified, no relocation needed.**
`scripts/runtime-contract-v1/authority.json` lists exactly five artefacts, all `.json`
(`constitution`, `proof-inventory`, `public-declaration-schema`, `goldens`, `lineage`), and
`RUNTIME_CONTRACT_PATHS` (`validate-runtime-contract-v1.mjs:4-10`) covers the same five.
`grep -n "\.mjs" scripts/runtime-contract-v1/proof-inventory.json` → zero hits, so no
enforcer digest is pinned anywhere. `check-runtime-contract-v1.mjs` composes the validators at
run time and is itself unpinned. So `amend.mjs` can live in that directory without becoming
self-authorizing. L7 asserts this property directly, so a future slice cannot quietly pull the
writer inside its own pin.

Leg **L7** is RED until the record and the writer exist and the chain verifies. A silent
recompute leaves L7's `amend.mjs must exist` failing, so the shortcut is not available.

## [MS-R4 DECIDED] `kern.runtime.internal.r0` is NOT bumped

The format string identifies the **envelope output**, not the request options.
`InternalRuntimeEnvelope` (`types.ts:64-71`) has no limits field, and `encodeInternalRuntimeEnvelope`
(`normalize.ts:154-161`) encodes only completion, diagnostics, events, format, outcome and
result. Limits are inputs. Bumping `r0` would rewrite the `format` field of every pinned
golden envelope — including `goldens.json` `envelopes`, keyed by that string — for zero
semantic gain, while falsely signalling to consumers that the envelope they parse has
changed. It has not.

The same reasoning leaves `KERN_RUNTIME_HANDLER_ABI` (`kern.runtime.handler.v1`) alone.
`constitution.json:2-3` still identifies the contract, and `constitution.limits` is the
field that records the shape change.

## [MS-R5 DECIDED] F5 policy: `maxIterations` = `maxWorkSteps`, ceiling untouched

- `runtimeLimits.maxIterations = 33554432`, exactly `profileLimits.maxWorkSteps`. Smallest value
  that stops the envelope contradicting F5's own declared ceiling; no unexplained headroom.
- `runtimeLimits.maxCollectionLength` **stays `1048576`**. This is the point of the slice.
  The 32× widening the measurement worktree needed is reverted by construction — it never
  lands.
- `RUNTIME_KEYS` (`policy-validation.mjs:41-43`) gains `maxIterations`, so `positiveLimits`
  enforces it as a positive safe integer.
- **New relationship clause** in the existing block at `policy-validation.mjs:86-88`:
  `policy.profileLimits.maxWorkSteps > policy.runtimeLimits.maxIterations` → `fail('limit relationship')`.
  Message deliberately unchanged from the three sibling clauses; the oracle matches
  `F5 projection policy: limit relationship`. Note the clause enforces
  `maxWorkSteps <= maxIterations`, **not** equality — equality is this policy's chosen value,
  not a constraint, and a future F5 policy may set `maxIterations` above `maxWorkSteps` without
  touching the validator.
- **VERIFIED (negative):** the F5 policy digest is a **build output, not a pin**. It is
  `sha256(raw bytes of policy.json)` computed by
  `scripts/build-kern-frontend-projection-assets.mjs` (`f5PolicyDigest: sha256(f5PolicyBytes)`)
  and written only to `packages/core/dist/frontend-projection-assets/assets.json`, which is
  git-ignored (`.gitignore:3` `packages/*/dist/`; `git ls-files packages/core/dist` → 0
  tracked files). `grep -rn e025392a` over the whole repo excluding `node_modules`, all file
  types, 2026-09-02 → the only hit is that git-ignored build artefact. **There is no golden
  digest string in source to re-pin.** `packages/core/src/frontend-projection.ts:197`
  compares `result.receipt.header.policySha256` to the freshly loaded `state.f5PolicyDigest`,
  so the binding is recomputed every build; CI regenerates it via `build:packages` before
  every shard and compares it to nothing fixed.
- **VERIFIED (negative):** the brief's expectation that rt4/rt6/rt9 compatibility tests pin
  this digest is **not borne out**. `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs:178,191`
  and `scripts/kern-5-rt6-void-fallthrough/compatibility.test.mjs:170,175` pin SHA-256
  goldens of *compiled JS/Python fixtures*, not F5 policy bytes. There is no `rt9` script
  family at all: `grep -n rt9 package.json` → no hits, and `scripts/kern-5-rt9-*` does not
  exist; `rt9-successor` / `rt9-fork` / `rt9-unanchored` appear only as fixture ids inside
  `scripts/kern-5-rt8-integer-signatures/amendment-chain.test.mjs`. See the Corrections Log.
- `policy-integrity.test.mjs` remains the independent recompute of the composition digests,
  which this slice does not move.
- **Ordering constraint.** `worker.mjs` `loadPolicy()` calls `validatePolicy()` on **every**
  invocation and passes `state.policy.runtimeLimits` through **verbatim** as `options.limits`
  (`worker.mjs:87`) with no per-field extraction or defaulting. So the two edits —
  `RUNTIME_KEYS` and `policy.json` — must land together with the core change, or every test
  that touches the F5 worker fails: `projection.test.mjs`, `review-*.test.mjs`,
  `api-isolation.test.mjs`, `scripts/kern-review-kir-preview/*.test.mjs`, and
  `scripts/kern-5-rt8-integer-signatures/admission.test.mjs`. `profileLimits.*` are unpacked
  as positional handler arguments (`worker.mjs:71-77`) and are untouched.

## [MS-R8 DECIDED] `maxIterations` bounds loop-frame iterations, nothing else

Settled once, here, so no later section re-opens it. `maxIterations` is the budget for
**effect-machine loop frames** — `each`, `for`, `lambda` and `while`. `consumeIterationBudget`
(`internal-effect-machine-sequence.ts:55-75`) is the only site that decrements
`state.remainingIterations`, and the only callers are the four loop runners. It does **not**
bound every step, and it does **not** bound capability work: a capability call is bounded by
`capabilityTimeoutMs`, and non-loop expression evaluation is bounded by nothing in this record.

This is deliberately narrower than `KernKirLimits.maxSteps`, which counts every step
(`kir-runtime/inspect.ts:41-49`). MS-R0 already forbids sharing the name; MS-R8 states the
quantity. Widening what the envelope budget counts would be a semantic change to an accepted
program's admission and is out of scope for this slice.

## [MS-R9 DECIDED] Budget exhaustion keeps the `unsupported-runtime-input` code

Reviewers asked for a dedicated diagnostic code for budget exhaustion. Not in this slice.
The diagnostic code is part of the **envelope output contract**: `goldens.json`, the RC-v1
proof inventory and every pinned envelope in the repo carry it, so changing it is a
golden-wide blast radius that this slice's amendment record (`rowsChanged:
["limits.maxIterations"]`, request-side only) does not authorize.

The L2 rows therefore pin the **current** code deliberately: `unsupported-runtime-input`,
`phase: "execution"`, `category: "runtime"` (`normalize.ts:147`). They are a pin, not an
endorsement.

Queued successor: **`runtime-envelope-budget-diagnostic`** — give budget exhaustion its own
code, with its own amendment record and its own golden sweep.

## [MS-R10 VERIFIED RISK] The scheduler deadline is not observed during execution

`maxIterations` raises the synchronous CPU allowance the envelope will accept — F5 declares
`33554432` — while `scheduler.timeoutMs` stays `120000`. Verified: **the deadline is never
polled inside the effect machine.** `throwIfInternalRuntimeSchedulerTerminated` is called at
the two boundaries of `executeInternalRuntimeEnvelopeSync`/`…Async` only (`execute.ts:40,49`
and `:69,79`; identically `execute-compat.ts:44,55,75,87`), and no semantics module calls it.
`createExecutionDeadline` belongs to `kir-runtime/execute.ts`, a different runtime.

Measured (`scheduler-deadline.test.mjs`): a 60,000-iteration counted `for` loop with
`scheduler.timeoutMs: 25` returns `outcome: "success"` with no diagnostics after ~380 ms, on
**both** the sync and the async path. A 2,000,000-iteration loop runs ~13.5 s to success.

Two facts bound the risk:

- **It is pre-existing, not introduced here.** The same run completes identically at the
  pre-amendment budget of `1048576`; that leg is asserted. Raising the accepted ceiling
  raises how long a caller *may* ask for, not whether the deadline works — it never did.
- **The packaged F5 path is bounded out of process.** The projection asset runner is a child
  process; `packages/core/dist/frontend-projection-assets/adapter.cjs` arms a
  `setTimeout(..., limits.ipc.timeoutMs)` (`120000`) and `child.kill('SIGKILL')`s on
  expiry. A runaway synchronous handler there dies at 120 s regardless of the in-process
  scheduler.
- `while` frames additionally carry a hard `WHILE_MAX_ITERATIONS = 100_000` ceiling
  (`while-runtime.ts:6`) independent of the budget; `for` and `each` do not.

Leg L8 **documents** this; it asserts no fix. No scheduler code is touched in this slice.
The fix — polling the deadline per loop frame — is a runtime-behaviour change with its own
blast radius and belongs to the deferred "F5 composition performance" milestone.

## Migration note: what a legacy six-key caller sees

`maxIterations` is REQUIRED and fails closed (MS-R2). That is intended, and
`runtimeAbiFrozen` is `false` with one lineage version, so no published consumer is owed a
compatibility window. An external caller that still passes the six-key record gets, exactly:

- through the public handler — `KernRuntimeHandlerError`, code `invalid-limits`, message
  `runtime handler limits are invalid`, from both `executeKernRuntimeHandlerSync` and
  `…Async`;
- through the internal validator — `InternalRuntimeEnvelopeError`, code `invalid-limits`,
  message `limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxIterations,maxStringBytes`.

One-line fix: add `maxIterations: <n>` to the limits record, where `<n>` is the value that
record previously carried in `maxCollectionLength` when that field was doubling as the
iteration budget. The amendment record carries no notes field and `amend.mjs` writes it by
structural marker, so this note lives here rather than in
`amendments/kern-5-runtime-envelope-max-iterations.json`.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-runtime-envelope-max-steps/spec.md` | Add | This document |
| `packages/cli/src/kern-runtime-limit-keys.ts` | Add | Single CLI declaration, type-bound to `KernRuntimeHandlerLimits` |
| `packages/cli/src/{kern-formatter-assets,kern-checker-assets}.ts` | Modify | Admit `maxIterations`; re-pin the policy trust anchors |
| `scripts/kern-canonicalizer/{historical-source,historical-transition-chain,coverage-dependencies}.mjs` | Modify | Pre-amendment reconstruction of the four bytes the shared declaration moved |
| `scripts/kern-canonicalizer/coverage{,-prerequisite}-summary.json`, `coverage-prerequisite.test.mjs` | Re-pin | Current-state digests, regenerated by `--write` |
| `scripts/kern-5-runtime-envelope-max-steps/**` | Add | RED oracle (5 legs) |
| `package.json` | Modify | Root script `test:kern-5-runtime-envelope-max-steps` |
| `packages/core/src/runtime-envelope/types.ts` | Modify | `maxIterations` on `InternalRuntimeEnvelopeLimits` |
| `packages/core/src/runtime-envelope/value.ts` | Modify | `maxIterations` in the exact-key list at `:30` |
| `packages/core/src/runtime-envelope/execute.ts` | Modify | `iterationBudget` from `maxIterations` at `:44`, `:73` |
| `packages/core/src/runtime-envelope/execute-compat.ts` | Modify | Same at `:49`, `:80` |
| `packages/core/src/runtime-handler.ts` | Modify | Type `:56-63`, `LIMIT_KEYS` `:164`, `acceptedLimits` `:293` |
| `scripts/runtime-contract-v1/constitution.json` | Modify | `limits` list gains `maxIterations` (MS-R3) |
| `scripts/runtime-contract-v1/public-declaration-schema.json` | Modify | Frozen `.d.ts` text (MS-R3) |
| `scripts/runtime-contract-v1/goldens.json` | Modify | Golden limits record + boundary case (MS-R3) |
| `scripts/runtime-contract-v1/proof-inventory.json` | Modify | `maxIterations` boundary proof rows (MS-R3) |
| `scripts/runtime-contract-v1/lineage.json` | Re-pin | All four SHA-256 digests, via the amendment writer only (MS-R7) |
| `scripts/runtime-contract-v1/amend.mjs` | Add | Amendment writer/verifier, chain walk (MS-R7) |
| `scripts/runtime-contract-v1/amendments/kern-5-runtime-envelope-max-iterations.json` | Add | Additive amendment record for `limits.maxIterations` |
| ~30 `scripts/kern-canonicalizer/*measure*.mjs` | Modify | `maxCollectionLength: iterationBudget` → `maxIterations: iterationBudget` (MS-R6) |
| `scripts/kern-frontend-f5-projection/policy.json` | Modify | `runtimeLimits.maxIterations = 33554432` |
| `scripts/kern-frontend-f5-projection/policy-validation.mjs` | Modify | `RUNTIME_KEYS` + relationship clause |
| 62 further non-test limits records and validators | Modify | `maxIterations := current maxCollectionLength` (MS-R2) |
| 43 test files | Modify | Same mechanical transcription |
| `scripts/kern-5-r0-contracts/r0-abi-template-{esm,python}.mjs` | Modify | `LIMIT_KEYS` inside generated-source templates |
| `scripts/kern-5-r0-contracts/schema/runtime-request.json` | Modify | JSON-Schema `properties` and `required` |
| `examples/kern-5-preview-app/{server.mjs,runtime-handler-config.json}` | Modify | `RUNTIME_HANDLER_LIMIT_KEYS` and its config |
| `packages/core/dist/**`, generated projection assets | Rebuild | Never hand-edited |

## Acceptance Criteria

Each row is one oracle leg. Every claim behind them is VERIFIED above; no ASSUMED or OPEN
claim feeds a fixture.

- [ ] **L1 contract.** `validateInternalRuntimeLimits` accepts a seven-key record including
      `maxIterations` and refuses a six-key record without it; `executeKernRuntimeHandlerSync`
      and `…Async` accept the seven-key record and throw `KernRuntimeHandlerError`
      `invalid-limits` for the six-key record. Non-integer, zero and negative `maxIterations` are
      refused as positive-safe-integer violations.
- [ ] **L2 decoupling.** At all six execution sites — envelope sync/async, compat sync/async,
      handler sync/async — over one program: `maxIterations: 2` flips a known-good run to the
      budget diagnostic (accepted-not-consumed trap); `{maxIterations: 5, maxCollectionLength: 10000}`
      aborts on the budget with collections unclamped; `{maxIterations: 10000, maxCollectionLength: 5}`
      fails on the ceiling with a **different** diagnostic code while iterations run; three
      different `maxCollectionLength` values with one `maxIterations` yield byte-identical
      envelopes; and the budget admits exactly its own count and refuses one more. No fixture
      sets the two limits equal.
- [ ] **L3 byte identity.** For a non-exhausting program the envelope is byte-identical to a
      golden captured at base `1a88c705`, on every path, for every `maxIterations` value.
- [ ] **L4 F5 policy.** `validatePolicy` accepts the seven-key `runtimeLimits`, refuses the
      six-key one with `F5 projection policy: runtime limits keys`, and refuses
      `maxWorkSteps > maxIterations` with `F5 projection policy: limit relationship`.
      `maxCollectionLength` is asserted to still be `1048576`. **No F5 projection is run**
      (p50 222 s).
- [ ] **L5 caller sweep guard.** Every envelope-shaped limits record in the repo carries
      `maxIterations`. Mechanical fence over the 77 files that fail it today, plus named checks
      on the four RC-v1 artefacts; fails loudly on any record that is missed.
- [ ] **L6 runner convergence.** For the same program, the envelope and the source runner
      abort at exactly the same budget threshold, at every point of
      `[1, 5, 19, 20, 21, 10000]`; the source runner keeps its own explicit `iterationBudget`
      and its sync and async paths agree.
- [ ] **L8 scheduler deadline (documenting).** A counted `for` loop of 60,000 iterations under
      `scheduler.timeoutMs: 25` completes with `outcome: "success"` and no diagnostics on both
      the sync and the async path, and does so identically at the pre-amendment budget; the
      `while` frame's independent `WHILE_MAX_ITERATIONS` ceiling still fires. Pins MS-R10; asserts
      no fix.
- [ ] **L7 RC-v1 amendment.** `scripts/runtime-contract-v1/amend.mjs` and an additive
      amendment record for this slice exist, the chain verifies with no pending re-pin, the
      record's parents are the base digests and its results are both the live artefacts and
      the live pin, `lineage.json` still holds one version, and the writer is not inside the
      pinned artefact set.
- [ ] `pnpm test:kern-runtime-envelope`, `pnpm test:kern-runtime-contract-v1`,
      `pnpm test:kern-frontend-f5-projection` and `pnpm test:kern-frontend-closure` pass.
- [ ] `scripts/kern-5-admission-census` is byte-identical: this slice admits nothing (MS-R1).

## Oracle

`scripts/kern-5-runtime-envelope-max-steps/`, root script
`test:kern-5-runtime-envelope-max-steps` (`package.json:117`), modelled on
`test:kern-5-rt8-integer-signatures` minus the asset-rebuild and `amend.mjs` steps this slice
does not need — it moves no composition `.kern` and no pinned digest that the closure
protocol governs. Builds `@kernlang/core` first, then runs the five legs in order.

**47 tests: 34 RED, 13 GREEN at base `1a88c705`**, plus the four documenting L8 rows added in
the review-fix pass, which are GREEN at base by construction (55 tests shipped in total).

| Leg | File | Tests | RED | GREEN |
|---|---|---|---|---|
| L1 contract | `contract.test.mjs` | 10 | 6 | 4 |
| L2 decoupling | `budget-decoupling.test.mjs` | 8 | 8 | 0 |
| L3 byte identity | `byte-identity.test.mjs` | 4 | 3 | 1 |
| L4 F5 policy | `f5-policy.test.mjs` | 8 | 6 | 2 |
| L5 caller sweep | `caller-sweep.test.mjs` | 6 | 4 | 2 |
| L6 runner convergence | `runner-convergence.test.mjs` | 5 | 2 | 3 |
| L7 RC-v1 amendment | `rc-v1-amendment.test.mjs` | 6 | 5 | 1 |
| L8 scheduler deadline | `scheduler-deadline.test.mjs` | 4 | 0 | 4 |

The 13 already-green tests each pin something that must **not** move: L1's unknown-key
refusal and the KIR/envelope key-set disjointness; L3's golden integrity; L4's
`maxCollectionLength` stays `1048576` and the three pre-existing relationships; L5's sweep
coverage and lineage self-consistency; L6's three source-runner properties, which are green
because that runner is *already* decoupled and must stay so; L7's `versions.length === 1`
sidecar invariant.

### RED-at-base strings, verbatim

```
L1 admits maxIterations / refuses without it / positive-safe-integer / KIR-spread refusal
  error:    'limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes'
  expected: 'limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxIterations,maxStringBytes'
L1 refuses a record without maxIterations
  error: 'Missing expected exception.'
L1 / L2 / L3 public handler paths
  error: 'runtime handler limits are invalid'
L2 all eight rows, L6 rows 2-3 (envelope side)
  error: 'limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes'
L4 refuses runtimeLimits without maxIterations
  error: 'Missing expected exception.'   expected message: 'F5 projection policy: runtime limits keys'
L4 non-positive maxIterations
  expected: 'F5 projection policy: runtime limits maxIterations'
  actual:   'F5 projection policy: runtime limits keys'
L4 maxWorkSteps > maxIterations
  expected: 'F5 projection policy: limit relationship'
  actual:   'F5 projection policy: runtime limits keys'
L7 writer and record absent
  error: 'scripts/runtime-contract-v1/amend.mjs must exist'
  error: 'scripts/runtime-contract-v1/amendments/ must exist'
  error: ENOENT ... amendments/kern-5-runtime-envelope-max-iterations.json
  error: ERR_MODULE_NOT_FOUND ... scripts/runtime-contract-v1/amend.mjs
```

Every RED is the absent key, or the absent amendment protocol, on the path that will carry it.
None is an incidental failure or an unrelated assertion.

### Red-teaming the oracle

- **L2 is the discriminating leg, and it now runs at all six execution sites** — envelope
  sync/async, compat sync/async, handler sync/async — over one program (loop `n` times, return
  a six-element list), so no site can be fixed while another is missed.
- **The ignored-key trap catches accepted-but-not-consumed.** The most likely bad patch adds
  `maxIterations` to the type and both validators and forgets to rewire `iterationBudget`. Then
  the key validates and does nothing. L2 row 1 sets `maxIterations: 2` on a program that
  succeeds at `10_000` and requires the outcome to **flip** to the budget diagnostic. A
  validation-only patch fails it at every site.
- **Differential pairs, measured at base to produce three distinct results from one program:**
  `{maxIterations: 5, maxCollectionLength: 10000}` → `unsupported-runtime-input` (budget aborts,
  collections unclamped); `{maxIterations: 10000, maxCollectionLength: 5}` → `non-portable-value`
  (ceiling fires, iterations ran); both roomy → success returning `[1,2,3,4,5,6]`. L2 asserts
  the two failure codes are **not** equal, so the limits are told apart by kind, not by degree.
- **No row uses `maxIterations == maxCollectionLength` as its only evidence.** Every fixture
  sets the two to different values; the equal-value case appears nowhere.
- **Off-by-one is pinned** at `maxIterations` 100 admit / 99 refuse, and L6 re-pins the same
  threshold at 20/19 on both runners.
- **L3 cannot be satisfied by regenerating it.** `byte-identity.golden.json` was captured at
  base through the legacy six-key record and is committed; the test drives the seven-key record
  at four different budgets. Changing envelope bytes requires editing a committed golden.
- **L7 blocks the silent shortcut.** A bare recompute of the four digests leaves L7 red.
- **L4 runs no projection** (p50 222 s); it exercises `validatePolicy` on in-memory objects.
- **What the oracle deliberately does not claim:** that any census file becomes admitted, or
  that any F5 projection completes (MS-R1). Both would be false.

### Implementation obligations the oracle does not cover

- Wire the lane into `test:kern-5-script-family` and the CI tier list enforced by
  `scripts/ci/test-tier-contract.test.mjs`. **DONE:** both carry
  `pnpm test:kern-5-runtime-envelope-max-steps` (`package.json` `test:kern-5-script-family`;
  `test-tier-contract.test.mjs` `kern5EvidenceCommands`), and that suite passes 9/9.
- Build `amend.mjs`, its amendment record and its chain tests (MS-R7). L7 fences it.
- Re-run `scripts/check-source-runner-convergence.mjs` (MS-R6 narrow OPEN).

## Implementation Evidence

Re-measured on 2026-09-03 after the review-fix pass (shared limit-key declaration, the CLI
asset repair, leg L8 and the historical reconstructions). Every suite below was run in this
worktree at the review-fix HEAD.

| Gate | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `pnpm test:kern-5-runtime-envelope-max-steps` | 55 | 55 | 0 | 0 |
| `pnpm test:kern-runtime-contract-v1` | 88 | 88 | 0 | 0 |
| `pnpm --filter @kernlang/core test` | 6910 | 6910 | 0 | 0 |
| `pnpm test:kern-canonicalizer` | 872 | 872 | 0 | 0 |
| `pnpm test:kern-5-rt2-boolean-if` | 35 | 35 | 0 | 0 |
| `pnpm test:kern-frontend-f5-projection` | 67 | 67 | 0 | 0 |
| `pnpm test:kern-5-rt3-binary-expression` | 142 | 142 | 0 | 0 |
| `pnpm test:kern-5-rt8-integer-signatures` | 28 | 28 | 0 | 0 |
| `pnpm test:kern-formatter` | 29 | 29 | 0 | 0 |
| `pnpm test:kern-checker` | 29 | 29 | 0 | 0 |
| `node --test scripts/ci/test-tier-contract.test.mjs` | 9 | 9 | 0 | 0 |
| `pnpm --filter @kernlang/cli build` | — | pass | — | — |

`test:kern-formatter` and `test:kern-checker` were **red at the pre-review HEAD** (10/18 and
14/29) and are green here; see the Corrections Log.

**Environment note, not a gate result:** `pnpm test:infra:contracts` stops in
`test:kern-ir-profile` because the shared checkout's `node_modules/tsx` symlink points at
`.pnpm/tsx@4.23.1` while `tsx@4.23.12` is what is installed, so `node --import tsx` cannot
resolve. The same stale-link class breaks `packages/terminal`'s `react`/`ink`/`@types/react`
links, which is why a plain `pnpm --filter @kernlang/cli build` fails in an unrepaired
worktree. Run against the resolved loader, `packages/core/tests/kir-v1.test.ts` is 5/5. No
source in this slice is implicated; the fix is `pnpm install`, not a code change.

The four suites that the MS-R0 correction touched were re-run individually:
`test:kern-5-r1-runtime-owner` 22/22, `test:kern-5-r2-js-lowering` 16/16,
`test:kern-5-c-py-1-contract` 29/29, `test:kern-5-cli-compiler-runtime-shadow` 16/16.
`check-runtime-contract-v1.mjs` reports PASS at anchor `8d2859a6`, 12 literal goldens,
22 public symbols, `frozen=false`.

### Mutant battery (kill table)

Twelve mutants, applied one at a time by byte-copy restore, each with a rebuild of
`@kernlang/core` where the mutated file was TypeScript. Ten died on the first pass; two
survived and were closed by new fixtures, after which both die.

| # | Mutant | Verdict | Killed by |
|---|---|---|---|
| M1 | `execute.ts` sync site maps `iterationBudget` from `maxCollectionLength` | KILLED | L2 `the ignored-key trap — a tiny maxIterations must flip a known-good program` |
| M2 | `execute.ts` async site maps `iterationBudget` from `maxCollectionLength` | KILLED | L2 same, plus `differential pair A` |
| M3 | `execute-compat.ts` sync site maps `iterationBudget` from `maxCollectionLength` | KILLED | L2 same |
| M4 | `execute-compat.ts` async site maps `iterationBudget` from `maxCollectionLength` | KILLED | L2 same |
| M5 | `value.ts` drops `maxIterations` from the exact-key list | KILLED | L1 `the envelope limits record refuses a record without maxIterations` |
| M6 | F5 `policy-validation.mjs` drops the `maxWorkSteps <= maxIterations` clause | KILLED | L4 `validatePolicy refuses maxWorkSteps greater than maxIterations` |
| M7 | `amend.mjs` skips the pending-amendment parent-digest comparison | SURVIVED → KILLED | new `a pending amendment must name the current pin as its parent` |
| M8 | `amend.mjs` recomputes the terminal digest by hand instead of reading the amendment record | KILLED | `a consumed amendment cannot authorize later artifact drift` |
| M9 | KIR runtime exact-key list learns `maxIterations` | SURVIVED → KILLED | new L1 `every shipped KIR limits key list still declares maxSteps and refuses maxIterations` |
| M10 | `KernKirLimits` interface learns `maxIterations` | KILLED | `tsc -b`: TS2741 in `compiler/kir-js-esm/request.ts` |
| M11 | F5 policy sets `maxIterations` below `maxWorkSteps` | KILLED | L4 `the shipped F5 policy carries maxIterations equal to maxWorkSteps` |
| M12 | A pure-KIR limits record keeps `maxIterations` | KILLED | new L5 `no KIR-shaped limits record learns the envelope iteration key` |
| M13 | One key removed from the shared `INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS` declaration | KILLED | six L1 rows, including `one shared declaration per package carries the envelope limit key set` |
| M14 | One key removed from the CLI `DECLARED` list | KILLED | `tsc -b packages/cli`: the exhaustiveness type collapses to `never` and all three importers fail |

M9 mattered: the MS-R0 fixtures asserted the invariant over the test file's own key
literals, so the shipped KIR validator could be widened with the whole slice fence green.
The replacement reads the three shipped KIR `LIMIT_KEYS` declarations and the two envelope
ones out of source and pins each.

## Out of Scope

- Raising `profileLimits.maxWorkSteps`. Separate F5 policy slice; sweep still measuring.
- `scheduler.timeoutMs` and F5 composition performance — the deferred
  "F5 composition performance" milestone (p50 222 s vs a 120 s wall).
- Any change to `KernKirLimits`, to a `maxCollectionLength` enforcement site, or to F0-F5
  KERN source, ledger, goldens or composition `.kern` files.
- Bumping `kern.runtime.internal.r0` or `kern.runtime.handler.v1` (MS-R4).
- Admitting any census file.

## Open Questions

- **RESOLVED (was the confidence cap):** the RC-v1 re-pin question is now MS-R7 — an
  amendment protocol, with recompute forbidden and leg L7 enforcing it. The remaining cost is
  build effort (`amend.mjs` plus its chain tests, ~80 lines by the RT-8 precedent), not an
  unknown.
- **OPEN:** the 4× budget sweep has 3 of 13 rows. Nothing in this slice depends on its
  outcome (MS-R1), but the follow-up `maxWorkSteps` slice does.
- **RESOLVED as MS-R8:** what `maxIterations` counts is DECIDED, not open — loop frames
  (`each`/`for`/`lambda`/`while`) and nothing else. Widening it is a semantic change and is a
  separate slice if anyone wants one.
- **RESOLVED as MS-R9:** the budget-exhaustion diagnostic code is DECIDED to stay
  `unsupported-runtime-input` for this slice; the successor slice is named there.
- **RECORDED as MS-R10:** the scheduler deadline is not polled during execution. Pre-existing,
  bounded out of process on the packaged F5 path, pinned by leg L8, fixed elsewhere.

## Deploy Order

One candidate: core source, the 77 limits records, RC-v1 artefacts and the F5 policy build
and gate together. There is no skew window inside the repo. Externally, `runtimeAbiFrozen`
is `false` and the lineage holds one version, so no published consumer is owed a migration —
which is precisely why the required key is affordable now and would not be later.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| 32 census files die on the envelope budget, so this slice unblocks them. | They die on it at base, but with the budget widened 19 project and 13 stop at the composition's own `F5_LIMIT` (`summary.json` `outcomeHistogram`). The remaining fix is `profileLimits.maxWorkSteps`, a separate slice. | MS-R1 added; the oracle claims a *legible diagnostic*, not an admission. No fixture asserts an admission. |
| The F5 policy digest `e025392a…` is pinned by the rt4/rt6/rt9 compatibility tests. | The digest exists only in the git-ignored build output `packages/core/dist/frontend-projection-assets/assets.json`; rt4/rt6 pin compiled-fixture hashes instead, and no `rt9` family exists. | No F5 digest is re-pinned. The real re-pin obligation is the RC-v1 lineage, which the brief did not mention. |
| The root script should follow `test:kern-5-rt9-linked-assign`. | That script does not exist. The chained precedent is `test:kern-5-rt8-integer-signatures` (`package.json:117`), and any new lane must also join `test:kern-5-script-family` (`:118`) and the CI tier list enforced by `scripts/ci/test-tier-contract.test.mjs`. | The oracle's root script follows the rt8 shape, minus the `amend.mjs` step this slice does not need. |
| `maxIterations` is an internal envelope field, so the change is internal. | `KernRuntimeHandlerLimits` is frozen by name in `constitution.json:30-37` and by exact `.d.ts` text in `public-declaration-schema.json:12`, with four cross-checked digests in `lineage.json` and no writer. | MS-R3 added; the slice is a public runtime-contract amendment and carries the one OPEN item that caps confidence. |
| `maxCollectionLength` is the F5 profile/canonical collection ceiling being widened. | Those are `262144` (`policy.json:33,44`); `1048576` is `runtimeLimits.maxCollectionLength` alone. | The unsafe-widening argument is about the *runtime* record, which is the one the envelope validates. |
| Blast radius is "at least the eight named scripts". | 77 files fail the textual fence; 46 non-test + 43 test files were audited as real construction or validation sites. `acceptedLimits` copies keys explicitly, so none inherits the new key. | MS-R2 rests on measured numbers with their rules stated, and the sweep is framed as 1 ruling + 76 transcriptions. |
| A first pass counted 90 non-test files by grepping `maxDiagnostics`. | Frontend/checker/canonicalizer policies carry an unrelated `profileLimits.maxDiagnostics`, and ten files construct seven-key `KernKirLimits`. Two more files (`runtime-contract-v1-parity.test.ts`, `runtime-contract-v1/declaration.test.mjs`) carry no `maxDiagnostics` at all and were missed by that grep. | The fence uses the all-six-keys rule and the audit was hand-read; `runtime-contract-v1-parity.test.ts` turned out to be the type-level invariant that keeps the public and internal records equal. |
| The envelope key should reuse KERN's existing `maxSteps`, since the name already exists for this quantity. | `KernKirLimits.maxSteps` counts every step (`kir-runtime/inspect.ts:41-49`); the envelope budget counts loop frames only (`internal-effect-machine-sequence.ts:55-75`). A shared name makes the two records shape-identical, so `{...kirLimits}` would pass exact-key validation and silently install the wrong budget. | MS-R0: the key is `maxIterations`. L1 carries the KIR-spread refusal as a fixture. Renamed across spec and oracle before any implementation. |
| The parity assertion (`Assert<Equal<…>>`) is why the public type must change. | A repo test is a consequence and could be deleted. The F5 worker sets limits through the *public* API (`worker.mjs:79-84`), so `KernRuntimeHandlerLimits` must carry the key for the use case to exist. | MS-R2 restated: the RC-v1 amendment is forced by the consumer. The parity assertion is a guard, not the argument. |
| Re-pinning the four RC-v1 digests is an open protocol question for the lane owner. | Recomputing a pin because its artefact changed makes the pin decoration. The RT-8 protocol generalizes; `authority.json` pins only the five JSON artefacts, so `amend.mjs` is not self-pinned and needs no relocation. | MS-R7: recompute forbidden, amendment record + chain-walking writer required, leg L7 RED until it exists. Confidence 0.89 → 0.93. |
| The iteration budget has one consumer family (the envelope). | There are two paths: the envelope (defective) and the source runner, whose `iterationBudget` is already an explicit option (`source-runner-engine.ts:29,51,76,88`). Also ~30 canonicalizer measurement scripts set `maxCollectionLength` *in order to* move the budget. | MS-R6 enumerates 12 consumer classes; leg L6 tests cross-runner convergence rather than recording it OPEN; the measurement scripts join the blast radius. |
| `check-runner-browser-budget.mjs` may be an iteration-budget consumer. | It is a performance gate — milliseconds and gzip bytes from `runner-browser-budget-policy.json` (`:18,106,128-141`), no `iterationBudget`, no limits record. | Dismissed with evidence in MS-R6. |
| A 17-element list at `maxCollectionLength: 16` is a clean second failure mode in any handler. | Only via *arguments*, which yield `invalid-handler-arguments`. In-KERN list growth (`assign op="+=" target=out value="[i]"`) and `len(rows)` both fail as `unsupported-runtime-input` at base and would have made the leg non-discriminating. | L2 uses an argument list and asserts the two distinct codes. |
| The seven initially named KIR-only paths exhausted the L5 false-positive set. | Five more KIR-only census/test records carry the same six shared names plus `maxSteps`; adding `maxIterations` made compiler requests invalid and regressed the admission ratchet. | The path-based L5 semantic exclusion now enumerates all twelve KIR-only files; `KernKirLimits` remains unchanged and the census is 10/10 green. |
| The repo-wide limits sweep would not move F1-F4 policy pins. | Adding the required key changes those policy bytes, so F4's predecessor digests and F5's F4 digest had to move even though no composition source changed. | The transitive policy pins were updated; the frontend closure amendment protocol was not invoked because it governs F5 `composition` rows, not policy-input fields. F5 is 67/67 green. |
| R0 caller records needed only literal key insertion. | Its generated JS/Python artifacts embed the widened exact-key validator, changing the frozen corpus artifact and manifest digests and the R0 bundle inventory. | The frozen corpus was regenerated from the existing generator and `rebind-manifest.mjs --write` updated the bundle inventory; 42/42 tests and the bundle check pass. |
| Existing envelope tests were behavior-preserving after only adding the new base-record key. | Five tests intentionally overrode `maxCollectionLength` to exercise the formerly overloaded iteration budget. | Those budget-intent overrides and direct machine options now use `maxIterations`; genuine collection-ceiling assertions remain on `maxCollectionLength`. |
| The L5 KIR-only path exclusion meant every record in those files was outside the envelope sweep. | Two excluded core tests also define a distinct `InternalRuntimeEnvelopeLimits` record consumed by the KIR handler; the full core suite rejected both records for lacking `maxIterations`. | Added `maxIterations: 64`, matching each record's `maxCollectionLength`, without changing the separate KIR limits; the focused 22 tests pass. |
| The implementation commits were ready for the repository L0 gate. | Two CLI policy interfaces contained malformed mechanically inserted TypeScript, and two changed effect-machine tests were not Biome-formatted. | Corrected the declarations and formatting; forced core/CLI TypeScript builds and repository lint pass. |
| The canonicalizer CLI inherited the runtime policy sweep through its mapped handler limits. | Its exact policy-key list still rejected `maxIterations`, and its handler mapping synthesized the iteration limit from `maxCollectionLength` instead of consuming the new policy field. | Added the required exact key and mapped `maxIterations` directly, restoring the canonicalize command suite and preserving collection-limit independence. |
| The repository-wide caller sweep would leave the canonicalizer's historical proof chain unaffected. | Historical policy, runtime-handler, envelope executor, and exact-key validator digests intentionally describe pre-amendment bytes; live measurement overrides also still used `maxCollectionLength` as an iteration budget. | Added explicit pre-amendment byte reconstruction at the historical boundary, kept current summaries on current digests, and moved budget-intent performance overrides to `maxIterations`. The complete 872-test canonicalizer run then passed its previously failing classes in a focused 70-test replay (70/70). |
| Adding the RC-v1 amendment directory affected only the runtime-contract amendment suites. | The Alpha receipt treats `scripts/runtime-contract-v1` as a mechanically closed authority and rejected any direct directory, so `test:kern-alpha-receipt` failed before collecting its bindings. | Extended receipt discovery to a closed recursive regular-file tree and bound the writer, chain test, anchor, and amendment record in the receipt policy; symlinks and empty directories still fail closed. |
| Every polluted limits record was an envelope record, so the sweep only had to add the key. | Eight records are sent only to a KIR compiler or KIR runtime request, whose exact-key validators carry `maxSteps`; the extra key turned every K0 admission in the RT2 golden into `invalid-compiler-request`, and the C-PY-1 seven-key pin was edited to eight to match. | MS-R0 violation, caught by running `test:kern-5-rt2-boolean-if` rather than by the slice fence. `maxIterations` removed from all eight, the C-PY-1 pin restored, the pure-KIR paths fenced by a new L5 assertion that none of them ever carries the key, and the sweep floor corrected from 84 to the true 78 envelope-shaped files. |
| The historical-chain blast radius was limited to policy bytes. | The canonicalizer's historical proofs hash the live `runtime-handler.ts`, both envelope executors, the exact-key validator and the policy JSON directly, across ~29 measurement, transition-chain and performance files. The spec's blast radius named none of them. | Pre-amendment six-key reconstruction added at each historical boundary; no pinned digest was moved and no performance floor changed — the `*-performance.test.mjs` edits only rename the budget parameter from `maxCollectionLength` to `maxIterations` at unchanged thresholds. |
| Normalizing `canonicalizerPolicyDigest` before comparing to a frozen summary is equivalent to reconstructing it. | Copying the published digest over the measured one makes that field unfailable at M4.141, M4.143 and M4.148 — three assertions silently became tautologies. | The digest is now derived as `sha256` of the live policy minus `maxIterations`, which proves the added key is the only difference from each frozen milestone; the live `coverageImplementationDigest` was regenerated through `check-kern-canonicalizer-coverage.mjs --write`. |
| The two excluded core KIR tests carry only KIR limits records. | Each also builds a distinct `InternalRuntimeEnvelopeLimits` record for the KIR handler, and `packages/core/tsconfig.json` includes only `src`, so no type-checker guards them; the envelope's runtime exact-key validation is what rejects a missing key there. | Both records carry `maxIterations`; the files stay path-excluded from the textual sweep and are listed as mixed, so the new pure-KIR assertion does not fire on them. |
| `packages/cli/src/kir-shadow/limits.ts` needed the new key. | It is a `KernKirLimits` record with `maxSteps`; an earlier pass added `maxIterations: 100` to it. | Reverted before this session and fenced by path instead; `pnpm --filter @kernlang/cli build` type-checks the file clean, and the CLI build has no `react`/`ink` problem in this worktree. |
| The Alpha receipt's closed authority over `scripts/runtime-contract-v1` was flat. | The amendments directory made `readdirSync` return a directory entry, which the receipt rejected outright. | Discovery now walks the tree, admitting regular files only; symlinks and non-regular entries still throw, empty directories still fail closed, and the exact sorted binding list in `alpha-receipt-policy.json` — not flatness — is what keeps the authority closed. |
| The lane still had to be wired into `test:kern-5-script-family` and the CI tier list. | Both already carry `pnpm test:kern-5-runtime-envelope-max-steps` at HEAD — the family script and `kern5EvidenceCommands` in `scripts/ci/test-tier-contract.test.mjs` — and that suite is 9/9. | The review finding is dismissed with the suite as evidence; the obligation is marked DONE rather than re-done. |
| The F5 relationship clause requires `maxIterations` to equal `maxWorkSteps`. | The validator fails only on `profileLimits.maxWorkSteps > runtimeLimits.maxIterations` (`policy-validation.mjs:88`), i.e. it enforces `<=`. Equality is MS-R5's *value* choice for the shipped policy, not a constraint. | The review finding is dismissed. MS-R5 keeps the equal value and states it is a policy choice; L4 keeps asserting both the `>` refusal and the shipped equal value. |
| Raising the budget only widens what the caller may ask for; the scheduler still bounds the run. | The scheduler deadline is never polled inside the effect machine — only at the two execute-site boundaries. A 60,000-iteration `for` loop completes successfully at `timeoutMs: 25` on both paths, and identically at the pre-amendment budget. | MS-R10 records it as a VERIFIED, pre-existing risk; leg L8 pins the behaviour; the packaged F5 path stays bounded by the adapter's 120 s SIGKILL. No scheduler code changed. |
| The seven limit-key names in each consumer were independent literals. | Five copies existed (core `value.ts`, core `runtime-handler.ts`, two CLI asset validators, the preview-app server) and two of the CLI copies had already drifted to six keys. | One declaration per package: `runtime-envelope/limit-keys.ts` in core, `kern-runtime-limit-keys.ts` in the CLI (type-bound to `KernRuntimeHandlerLimits`, so drift is a build error). The CLI cannot import the core one — its only permitted core entry is RC-v1 byte-frozen. L1 reads both declarations and fences every consumer against re-inlining. |
| The repo-wide sweep left every CLI asset validator consistent with the widened policy. | `kern-formatter-assets.ts` and `kern-checker-assets.ts` gained the interface field but kept a six-key `exactKeys` list, and both compiled policy trust anchors still named the pre-amendment byte counts. `test:kern-formatter` was 10/18 red and `test:kern-checker` 14/29 red at HEAD — both inside `test:pr-frontend-tooling`. | Both validators now consume the shared declaration and both policy anchors are re-pinned to the bytes `build:packages` emits. Both suites are 29/29. |
| The spec could cite evidence by absolute filesystem path. | Two absolute `/Users/...` paths pinned the document to one machine, and a third sat in the sibling CI-census-sweep spec. | All three are repo-relative or worktree-agnostic; the gitignored lane-2 measurement artifacts are described rather than located, with the numbers cited from `.Codex/specs/kern-5-f5-iteration-budget/spec.md`. |
| What `maxIterations` counts, and whether the budget diagnostic should change, were open questions. | Both were decidable from the code that already exists. | MS-R8 states the quantity (loop frames only) and MS-R9 keeps `unsupported-runtime-input` for this slice with `runtime-envelope-budget-diagnostic` named as the successor. Neither remains in Open Questions. |
| The required key's fail-closed break needed no written migration path. | It is intended, but the exact strings a legacy caller sees were nowhere in the document. | A migration note records both error identities verbatim and the one-line fix. The amendment record has no notes field and `amend.mjs` rewrites it by structural marker, so the note lives in the spec. |
| The autonomous builder would carry the slice to a green repository gate. | It builder-failed on turn 4 with the work nearly complete: four commits landed and 29 files were left uncommitted mid-replay of the 872-test canonicalizer gate, with the RT2/C-PY-1 MS-R0 regression unnoticed. | The dirty diff was audited rather than committed as found, which is what surfaced the tautological digest normalization and the KIR shape violation. |
