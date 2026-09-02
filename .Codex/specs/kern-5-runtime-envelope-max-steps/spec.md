# KERN 5: `maxSteps` — a dedicated iteration budget for the runtime envelope

**Status:** SPEC — RED ORACLE LANDED
**Date:** 2026-09-02
**Base:** `1a88c705` (`origin/main`, CI census sweep merged)
**Confidence:** 0.89

## Executive Summary

The runtime envelope has no iteration budget of its own. All four execute sites pass
`limits.maxCollectionLength` — a value ceiling meant to bound how many items one list or
record may carry — into the effect machine as `iterationBudget`. One number therefore
answers two unrelated questions, and the answers pull in opposite directions: a caller
that wants a long-running loop must also permit a 33.5-million-element list, and a caller
that wants a tight value ceiling must accept a short loop.

This slice splits the knob. `maxSteps` becomes a seventh, **required** key on the envelope
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
  — the exact shape this slice adopts. The envelope is the outlier, the key name is not an
  invention, and the emitters already fix its canonical alphabetical position.
- **VERIFIED (measured):** with the shipped policy the overload is load-bearing, not
  theoretical. `.Codex/specs/kern-5-f5-iteration-budget/spec.md` records 32/32 investigated
  `projection-fatal` census files traced to iteration-budget exhaustion on the `1a88c705`
  policy, citing `.worktrees/kern-5-rt9/.agon-goals/f5-fatal/SUMMARY.json`.

Root cause: one field with two meanings.

### The F5 measurement, and what it actually proves

Raw JSON at `/Users/nicolascukas/KERN/.worktrees/kern-5-f5-iteration-budget/.agon-goals/f5-measure/`
(`summary.json`, `results.json` 32 rows, `results-budget.json`, `run.log`, `run-budget.log`).
Cited, not copied.

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

> Verified against the files and commands cited, in
> `/Users/nicolascukas/KERN/.worktrees/kern-5-envelope-max-steps` at base `1a88c705`
> with `packages/core` built, on 2026-09-02.

| Field / Behavior | Shape | Evidence | Tag |
|---|---|---|---|
| `InternalRuntimeEnvelopeLimits.maxSteps` | required positive safe integer | `runtime-envelope/types.ts:6-13` (absent today) | VERIFIED |
| `KernRuntimeHandlerLimits.maxSteps` | required positive safe integer | `runtime-handler.ts:56-63` (absent today) | VERIFIED |
| envelope exact-key set | `maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes` → gains `maxSteps` | `runtime-envelope/value.ts:30`; probe below | VERIFIED |
| handler `LIMIT_KEYS` | same six → gains `maxSteps` | `runtime-handler.ts:164-171` | VERIFIED |
| handler `acceptedLimits` | explicit per-key copy, **not** a spread | `runtime-handler.ts:293-300` | VERIFIED |
| `iterationBudget` source | `limits.maxSteps` at all four sites | `execute.ts:44,73`; `execute-compat.ts:49,80` | VERIFIED |
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
validateInternalRuntimeLimits({…6 keys…, maxSteps: 1000})
  -> InternalRuntimeEnvelopeError/invalid-limits:
     "limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes"
validateInternalRuntimeLimits({…6 keys…})            -> ACCEPTED     (must become a refusal)
executeKernRuntimeHandlerSync(…, {limits: {…6 keys…, maxSteps: 1000}})
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

## [MS-R2 DECIDED] `maxSteps` is REQUIRED

Blast radius measured, not estimated. Discriminator: an envelope/handler limits record is
any record carrying `maxDiagnostics`; a KIR record additionally carries `maxSteps` already.

```
grep -rln maxDiagnostics scripts packages/*/src packages/*/tests tests generated assets examples \
  --include='*.mjs' --include='*.ts' --include='*.json' --include='*.js' \
  | grep -v node_modules | grep -v '/dist/'
```

Two numbers, with their rules, because they measure different things.

- **Mechanical fence (what leg L5 enforces): 77 files.** Rule: the file contains all six
  current key names and does not contain `maxSteps`. 96 files contain all six; 19 already
  carry `maxSteps`. This rule is exactly what `envelopeShapedFiles()` in the oracle computes,
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

1. **The fallback *is* the bug.** `maxSteps ?? maxCollectionLength` keeps one number
   answering two questions for all 77 existing callers and makes the coupling permanent and
   invisible. Nothing would be fixed except the F5 call site.
2. **The amendment cost is identical.** `maxSteps?: number` changes the frozen public
   declaration text just as `maxSteps: number` does (MS-R3), so OPTIONAL does not avoid the
   constitution work — it only avoids the sweep.
3. **Exact-key validation is a deliberate KERN 5 invariant.** `value.ts:30-40` and
   `runtime-handler.ts` reject unknown *and* missing keys so that no limits shape can drift
   silently. An optional key is a hole in the one mechanism that would otherwise catch this
   class of bug next time.
4. **The sweep is 1 decision, not 77.** For all 76 non-F5 sites,
   `maxSteps := <that record's current maxCollectionLength>` is behavior-preserving *by
   construction* — it is literally the value the effect machine receives today. Only F5
   chooses a genuinely new number. So the sweep is mechanical transcription plus one ruling,
   and byte-identity across it is provable rather than hoped for.
5. **There is no external caller to break.** `validateRuntimeContractV1` returns
   `runtimeAbiFrozen: false` (`validate-runtime-contract-v1.mjs:337-344`) and the lineage
   holds exactly one version. This is the window in which the shape may still change.

Accepted cost: 77 files by the fence, one integer each, and the RC-v1 amendment below.

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
  other, so a `maxSteps` row must be added to **all** of them or the set fails closed.
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

Consequence for the implementation phase: the four digests must be recomputed and
re-pinned, and doing that by hand is what RT-8 ruled out. **OPEN (see below):** whether this
slice extends the amendment gate to RC-v1 or is granted a one-time recompute.

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

## [MS-R5 DECIDED] F5 policy: `maxSteps` = `maxWorkSteps`, ceiling untouched

- `runtimeLimits.maxSteps = 33554432`, exactly `profileLimits.maxWorkSteps`. Smallest value
  that stops the envelope contradicting F5's own declared ceiling; no unexplained headroom.
- `runtimeLimits.maxCollectionLength` **stays `1048576`**. This is the point of the slice.
  The 32× widening the measurement worktree needed is reverted by construction — it never
  lands.
- `RUNTIME_KEYS` (`policy-validation.mjs:41-43`) gains `maxSteps`, so `positiveLimits`
  enforces it as a positive safe integer.
- **New relationship clause** in the existing block at `policy-validation.mjs:86-88`:
  `policy.profileLimits.maxWorkSteps > policy.runtimeLimits.maxSteps` → `fail('limit relationship')`.
  Message deliberately unchanged from the three sibling clauses; the oracle matches
  `F5 projection policy: limit relationship`.
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

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-runtime-envelope-max-steps/spec.md` | Add | This document |
| `scripts/kern-5-runtime-envelope-max-steps/**` | Add | RED oracle (5 legs) |
| `package.json` | Modify | Root script `test:kern-5-runtime-envelope-max-steps` |
| `packages/core/src/runtime-envelope/types.ts` | Modify | `maxSteps` on `InternalRuntimeEnvelopeLimits` |
| `packages/core/src/runtime-envelope/value.ts` | Modify | `maxSteps` in the exact-key list at `:30` |
| `packages/core/src/runtime-envelope/execute.ts` | Modify | `iterationBudget` from `maxSteps` at `:44`, `:73` |
| `packages/core/src/runtime-envelope/execute-compat.ts` | Modify | Same at `:49`, `:80` |
| `packages/core/src/runtime-handler.ts` | Modify | Type `:56-63`, `LIMIT_KEYS` `:164`, `acceptedLimits` `:293` |
| `scripts/runtime-contract-v1/constitution.json` | Modify | `limits` list gains `maxSteps` (MS-R3) |
| `scripts/runtime-contract-v1/public-declaration-schema.json` | Modify | Frozen `.d.ts` text (MS-R3) |
| `scripts/runtime-contract-v1/goldens.json` | Modify | Golden limits record + boundary case (MS-R3) |
| `scripts/runtime-contract-v1/proof-inventory.json` | Modify | `maxSteps` boundary proof rows (MS-R3) |
| `scripts/runtime-contract-v1/lineage.json` | Re-pin | All four SHA-256 digests (MS-R3; no writer) |
| `scripts/kern-frontend-f5-projection/policy.json` | Modify | `runtimeLimits.maxSteps = 33554432` |
| `scripts/kern-frontend-f5-projection/policy-validation.mjs` | Modify | `RUNTIME_KEYS` + relationship clause |
| 62 further non-test limits records and validators | Modify | `maxSteps := current maxCollectionLength` (MS-R2) |
| 43 test files | Modify | Same mechanical transcription |
| `scripts/kern-5-r0-contracts/r0-abi-template-{esm,python}.mjs` | Modify | `LIMIT_KEYS` inside generated-source templates |
| `scripts/kern-5-r0-contracts/schema/runtime-request.json` | Modify | JSON-Schema `properties` and `required` |
| `examples/kern-5-preview-app/{server.mjs,runtime-handler-config.json}` | Modify | `RUNTIME_HANDLER_LIMIT_KEYS` and its config |
| `packages/core/dist/**`, generated projection assets | Rebuild | Never hand-edited |

## Acceptance Criteria

Each row is one oracle leg. Every claim behind them is VERIFIED above; no ASSUMED or OPEN
claim feeds a fixture.

- [ ] **L1 contract.** `validateInternalRuntimeLimits` accepts a seven-key record including
      `maxSteps` and refuses a six-key record without it; `executeKernRuntimeHandlerSync`
      and `…Async` accept the seven-key record and throw `KernRuntimeHandlerError`
      `invalid-limits` for the six-key record. Non-integer, zero and negative `maxSteps` are
      refused as positive-safe-integer violations.
- [ ] **L2 decoupling.** With one limits record, `maxCollectionLength: 16` and a large
      `maxSteps`, a 100-iteration `while` handler SUCCEEDS, while a 17-element list argument
      still fails with `invalid-handler-arguments`; with a small `maxSteps` the same loop
      fails with `unsupported-runtime-input` at exactly the expected iteration count. Holds
      on the sync handler path, the async handler path, and the compat envelope path
      (`execute-compat.js`, reachable from `dist` by deep import).
- [ ] **L3 byte identity.** For a non-exhausting program the envelope is byte-identical to a
      golden captured at base `1a88c705`, on every path, for every `maxSteps` value.
- [ ] **L4 F5 policy.** `validatePolicy` accepts the seven-key `runtimeLimits`, refuses the
      six-key one with `F5 projection policy: runtime limits keys`, and refuses
      `maxWorkSteps > maxSteps` with `F5 projection policy: limit relationship`.
      `maxCollectionLength` is asserted to still be `1048576`. **No F5 projection is run**
      (p50 222 s).
- [ ] **L5 caller sweep guard.** Every envelope-shaped limits record in the repo carries
      `maxSteps`. Mechanical fence over the 77 files that fail it today, plus named checks
      on the four RC-v1 artefacts; fails loudly on any record that is missed.
- [ ] `pnpm test:kern-runtime-envelope`, `pnpm test:kern-runtime-contract-v1`,
      `pnpm test:kern-frontend-f5-projection` and `pnpm test:kern-frontend-closure` pass.
- [ ] `scripts/kern-5-admission-census` is byte-identical: this slice admits nothing (MS-R1).

## Oracle

`scripts/kern-5-runtime-envelope-max-steps/`, root script
`test:kern-5-runtime-envelope-max-steps` (`package.json:117`), modelled on
`test:kern-5-rt8-integer-signatures` minus the asset-rebuild and `amend.mjs` steps this slice
does not need — it moves no composition `.kern` and no pinned digest that the closure
protocol governs. Builds `@kernlang/core` first, then runs the five legs in order.

**31 tests: 24 RED, 7 GREEN at base `1a88c705`.**

| Leg | File | Tests | RED | GREEN |
|---|---|---|---|---|
| L1 contract | `contract.test.mjs` | 7 | 5 | 2 |
| L2 decoupling | `budget-decoupling.test.mjs` | 6 | 6 | 0 |
| L3 byte identity | `byte-identity.test.mjs` | 4 | 3 | 1 |
| L4 F5 policy | `f5-policy.test.mjs` | 8 | 6 | 2 |
| L5 caller sweep | `caller-sweep.test.mjs` | 6 | 4 | 2 |

The 7 already-green tests are deliberate: each pins something that must **not** move. L1's
unknown-key refusal and its `maxSteps`-is-the-only-new-key check; L3's golden integrity; L4's
`maxCollectionLength` stays `1048576` and the three pre-existing limit relationships; L5's
sweep coverage (21 named files, `shaped.length >= 96`) and the RC-v1 lineage digest
consistency. That last one is the fence for MS-R3: it is green now, and it stays green only
if the implementer re-pins all four digests after editing the artefacts.

### RED-at-base strings, verbatim

```
L1 admits maxSteps
  error: 'limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes'
L1 refuses a record without maxSteps
  error: 'Missing expected exception.'
L1 maxSteps is a positive safe integer
  expected: 'maxSteps must be a positive safe integer'
  actual:   'limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes'
L1 / L2 / L3 public handler paths
  error: 'runtime handler limits are invalid'
L2 compat path
  error: 'limits must contain exactly maxBytes,maxCollectionLength,maxDepth,maxDiagnostics,maxEvents,maxStringBytes'
L4 refuses runtimeLimits without maxSteps
  error: 'Missing expected exception.'   expected message: 'F5 projection policy: runtime limits keys'
L4 non-positive maxSteps
  expected: 'F5 projection policy: runtime limits maxSteps'
  actual:   'F5 projection policy: runtime limits keys'
L4 maxWorkSteps > maxSteps
  expected: 'F5 projection policy: limit relationship'
  actual:   'F5 projection policy: runtime limits keys'
```

Every RED is the *absence of the key*, on the path that will carry it. None is an incidental
failure, a missing file, or an unrelated assertion.

### Red-teaming the oracle

- **L2 is the discriminating leg.** Recorded at base, the coupling is directly visible:
  identical `while` loop of 100 iterations, `maxCollectionLength: 16` → `unsupported-runtime-input`,
  `maxCollectionLength: 1024` → success returning `100`. So today the value ceiling *is* the
  budget. L2 asserts the inverse post-change: with `maxSteps` fixed, three different
  `maxCollectionLength` values (16, 64, 1048576) must yield **byte-identical** envelopes,
  while `maxSteps: 8` fails even at `maxCollectionLength: 1048576`. A patch that widened the
  ceiling instead of splitting the knob passes nothing here.
- **The two limits are separated by different diagnostic codes, not by degree.** Budget
  exhaustion is `unsupported-runtime-input`; the collection ceiling on arguments is
  `invalid-handler-arguments`. L2 asserts both, and asserts the codes are not equal.
- **Off-by-one is pinned.** `maxSteps: 100` admits a 100-iteration loop and `maxSteps: 99`
  refuses it, so a fencepost slip in the budget wiring fails.
- **L3 cannot be satisfied by regenerating it.** `byte-identity.golden.json` was captured at
  base through the *legacy six-key* record and is checked in; the test drives the *seven-key*
  record. An implementation that changed envelope bytes cannot make L3 pass without editing a
  committed golden, which a reviewer sees.
- **L4 runs no projection.** p50 is 222 s; L4 only exercises `validatePolicy` on in-memory
  policy objects, so the lane stays fast and the timeout milestone stays out of scope.
- **What the oracle deliberately does not claim:** no leg asserts that any census file becomes
  admitted, or that any F5 projection completes (MS-R1). Both would be false.

### Implementation obligations the oracle does not cover

- Wire the lane into `test:kern-5-script-family` (`package.json:118`) and the CI tier list
  enforced by `scripts/ci/test-tier-contract.test.mjs`. Verified that suite still passes 9/9
  with the lane unwired, so deferring this to the implementation phase breaks nothing now.
- Re-pin the four RC-v1 digests (MS-R3). L5 fences it; the OPEN question is *how*.

## Out of Scope

- Raising `profileLimits.maxWorkSteps`. Separate F5 policy slice; sweep still measuring.
- `scheduler.timeoutMs` and F5 composition performance — the deferred
  "F5 composition performance" milestone (p50 222 s vs a 120 s wall).
- Any change to `KernKirLimits`, to a `maxCollectionLength` enforcement site, or to F0-F5
  KERN source, ledger, goldens or composition `.kern` files.
- Bumping `kern.runtime.internal.r0` or `kern.runtime.handler.v1` (MS-R4).
- Admitting any census file.

## Open Questions

- **OPEN:** MS-R3 requires re-pinning four RC-v1 digests that have **no writer**. Does this
  slice extend the RT-8 amendment gate (`scripts/kern-frontend-closure/amend.mjs`) to the
  RC-v1 surface — the follow-up `[RT8-R3]` item 3 anticipated — or is a one-time recompute
  authorized? A hand-written digest is what RT-8 forbade. **This caps confidence at 0.89 and
  routes to the lane owner: it is a protocol decision, not a technical unknown.**
- **OPEN:** the 4× budget sweep has 3 of 13 rows. Nothing in this slice depends on its
  outcome (MS-R1), but the follow-up `maxWorkSteps` slice does.
- **OPEN:** should `maxSteps` also gate non-loop step consumption, as `KernKirLimits.maxSteps`
  does in `kir-runtime/inspect.ts:45-48`? Today the effect machine only decrements on loop
  frames, so envelope `maxSteps` is an *iteration* budget wearing a *step* name. Keeping the
  KIR name is right for consistency; widening what it counts is a semantic change and is out
  of scope here. Flagged so the divergence is deliberate and recorded.

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
| `maxSteps` is an internal envelope field, so the change is internal. | `KernRuntimeHandlerLimits` is frozen by name in `constitution.json:30-37` and by exact `.d.ts` text in `public-declaration-schema.json:12`, with four cross-checked digests in `lineage.json` and no writer. | MS-R3 added; the slice is a public runtime-contract amendment and carries the one OPEN item that caps confidence. |
| `maxCollectionLength` is the F5 profile/canonical collection ceiling being widened. | Those are `262144` (`policy.json:33,44`); `1048576` is `runtimeLimits.maxCollectionLength` alone. | The unsafe-widening argument is about the *runtime* record, which is the one the envelope validates. |
| Blast radius is "at least the eight named scripts". | 77 files fail the textual fence; 46 non-test + 43 test files were audited as real construction or validation sites. `acceptedLimits` copies keys explicitly, so none inherits the new key. | MS-R2 rests on measured numbers with their rules stated, and the sweep is framed as 1 ruling + 76 transcriptions. |
| A first pass counted 90 non-test files by grepping `maxDiagnostics`. | Frontend/checker/canonicalizer policies carry an unrelated `profileLimits.maxDiagnostics`, and ten files construct seven-key `KernKirLimits`. Two more files (`runtime-contract-v1-parity.test.ts`, `runtime-contract-v1/declaration.test.mjs`) carry no `maxDiagnostics` at all and were missed by that grep. | The fence uses the all-six-keys rule and the audit was hand-read; `runtime-contract-v1-parity.test.ts` turned out to be the type-level invariant that keeps the public and internal records equal. |
| A 17-element list at `maxCollectionLength: 16` is a clean second failure mode in any handler. | Only via *arguments*, which yield `invalid-handler-arguments`. In-KERN list growth (`assign op="+=" target=out value="[i]"`) and `len(rows)` both fail as `unsupported-runtime-input` at base and would have made the leg non-discriminating. | L2 uses an argument list and asserts the two distinct codes. |
