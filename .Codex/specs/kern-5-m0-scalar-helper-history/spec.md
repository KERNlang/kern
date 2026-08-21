# M0 — Scalar-Helper History Closure for Text.utf8Length

**Status:** READY TO BUILD
**Date:** 2026-08-21
**Confidence:** 0.97

## Executive Summary

**[M0-SH1 VERIFIED]** The cold canonicalizer wall fails because the live
compiled 4.6 `Text.utf8Length` bytes no longer match the successor endpoint of
the immutable scalar-helper history edge. The repair adds one exact aggregate
reverse-reconstruction stage from the post-format `91f794dc` compiled endpoint
to the existing `8a453a44` endpoint, for exactly five affected compiled files.
Evidence: `scalar-helper-history-transition.mjs:9-16,106-116` and the
2026-08-21 live compiled-byte probe recorded in M0-SH5.

**[M0-SH2 VERIFIED]** This is byte-provenance repair only: no `Text.utf8Length`
runtime, generated-lowering, public API, F4 policy, or receipt behavior changes.
The existing `7efa4c3a -> 8a453a44` scalar-helper edge and M4.145 receipt stay
byte-identical. Evidence: `scalar-helper-history-transition.mjs:45-60`,
`coverage-integrity.test.mjs:358-400`, and `combined-headroom-m4-145.json:50`.

## Current State / Root Cause

**[M0-SH3 VERIFIED]** `0a4d41c6` is not the cause: it changes only F4B KERN
composition, F4 policy, and an F4B source-validity test. Evidence: `git show
--name-status 0a4d41c6` on 2026-08-21 lists only
`examples/kern-frontend/f4-module-set-{graph,main,output}.kern`,
`scripts/kern-frontend-f4-declarations/{f4b-source-validity.test.mjs,policy.json}`.

**[M0-SH4 VERIFIED]** The relevant ancestry is immutable scalar-history
successor `8a453a4447572194a314df57e717396169b9accf`, followed by the public
`Text.utf8Length` commit `f125ea61cca75c859bf5179437d9bf1a53805022`, then
formatting commit `91f794dc31ebe11a9d29a8b25479f03900141950`. Evidence:
`scalar-helper-history-transition.mjs:9-16`; `git show --name-status f125ea61`
and `git show --name-status 91f794dc` on 2026-08-21.

**[M0-SH5 VERIFIED]** A read-only post-build probe of `packages/core/dist`
found exactly five mismatches against the old scalar edge; the other three of
its eight rows still match. The probe was:

```text
node --input-type=module -e "... sha256(packages/core/dist/<row.path>) ..."
```

| Compiled path | live 91f/HEAD SHA-256 | live blob SHA-1 | existing 8a successor SHA-256 | existing 8a blob SHA-1 |
|---|---|---|---|---|
| `codegen/kern-stdlib.js` | `27d4291f35a0f900db4379dbd8460e2d339a48d7a5a1b69103babfd6e1e7caa6` | `02e7e6b45529d9053027d0e3eea0622056ae26fc` | `269f7c2d5c08c01465054a6b289604c09f5fe52e355a99c7a0a32d039d745cb7` | `2c53adac5c3944b5b393d4b49f6ecbfb5cfcf5f9` |
| `codegen/stdlib-preamble.js` | `14546a5935ff65ec72f83d74b5a77864a8ff55f03509132c111119893bde5409` | `740b0f53e59f19eee124fec4cfc09605cc49e671` | `1c8d1c885a2558c6d7e97db5e219e315fc01f4b4cd21058cbb02f0d591a789ef` | `26aa4e1546aa968ac488ae4b8efbc8b3bd0ba12c` |
| `codegen/text-contract.js` | `1bb2627c84586d6731c5f7555f99f83f9826efeab977a0757c64d7dc31dde148` | `ed63e3d4b1c585807ab8e19babf1a79bd4e4ff6d` | `d58afba0ed745dd78325c55ba5ceaece465bd59e146f2aabb5e808c09ebdc516` | `84fb51c9f7d067020174eb11a7a77f7b3f2c5f46` |
| `ir/semantics/portable-machine-shape.js` | `c6411ab25f326941796c4a53d059357a0fecacb5f6741431e1f068f4d971a3f4` | `2be299ff05b84d9926c3d1fd032432a2e9008c8f` | `50b1e2fbcc23f6eff1bbe33485ca48160af11a180297896b2347ae7689391dc2` | `e409228be23a3488fbe047276c86c36e9531637b` |
| `ir/semantics/portable-string.js` | `cb07234c90aca9e810cf0f1a9f6338da4d74d54ffbc7f36b6e5ecee8ac479c13` | `8cec79728f70144fe33bf5bdff19c68a0dc3e413` | `111aeaae14c8544723334994d6c2faaed6a7acde85da19edad150a857320ec57` | `d7b33e942702a6d9d3209321a435aace94c1942d` |

**[M0-SH6 VERIFIED]** The failure is fail-closed before the M4.145 digest:
`scalar helper history predecessor compiled codegen/kern-stdlib.js ... broken
or misordered successor edge`. `historical-transition-chain.mjs:69-87` checks
each incoming SHA-256 before replacement; `historical-source.mjs:19-44` accepts
only nonempty, exact, uniquely occurring literal replacements and checks the
post-reconstruction SHA-256.

## What Already Works

**[M0-SH7 VERIFIED]** The 4.6 feature is already implemented across the three
production legs: core stdlib lowering, emitted TS helper detection, portable
machine execution, and Python helper lowering. Evidence:
`packages/core/src/codegen/kern-stdlib.ts:79-85`,
`packages/core/src/codegen/stdlib-preamble.ts:144-155`,
`packages/core/src/ir/semantics/portable-string.ts:76-140`, and
`packages/python/tests/text-utf8-length-python.test.ts:75-107`.

**[M0-SH8 VERIFIED]** Existing runtime and generated-code tests already cover
mixed-width RFC 3629 values, malformed UTF-16 fail-close, exact arity,
namespace shadowing, and TS/Python helper injection. Evidence:
`packages/core/tests/text-utf8-length.test.ts:64-134` and
`packages/python/tests/text-utf8-length-python.test.ts:62-107`.

## Contract (Verified)

> Verified against the source and Git endpoints cited above on 2026-08-21.

| Field / behavior | Frozen contract | Evidence | Tag |
|---|---|---|---|
| Aggregate provenance endpoint | Chronological metadata is `predecessorCommit=8a453a44...`, `successorCommit=91f794dc...`; reverse replay is live successor to predecessor. | `scalar-helper-history-transition.mjs:9-16,45-55`; `historical-transition-chain.mjs:69-87` | **VERIFIED** |
| Aggregate manifest | Exactly the five M0-SH5 paths, in one frozen deterministic order, with exact current/expected SHA-256, Git blob SHA-1, and exact UTF-8 replacement bytes generated from pinned compiled endpoints. | M0-SH5; `scalar-helper-history-transition.test.mjs:78-119` | **VERIFIED** |
| Stage acceptance | A stage accepts only its exact successor bytes, applies only unique literal replacement text, and produces its exact predecessor digest. No regex, normalization, fuzzy match, or fallback is legal. | `historical-transition-chain.mjs:69-87`; `historical-source.mjs:19-44` | **VERIFIED** |
| Composition | New aggregate stage runs first; its output is then passed unchanged to immutable scalar-helper stage `kern.runtime.scalar-helper-history.r0`. | `scalar-helper-history-coverage-adapter.mjs:10-19`; `scalar-helper-history-transition.mjs:106-116` | **VERIFIED** |
| Old edge | Existing eight rows, claim, commits, inventory/manifest/endpoints/rows digests, and replacement bytes are immutable. | `scalar-helper-history-transition.mjs:62-92`; `scalar-helper-history-transition.test.mjs:121-161` | **VERIFIED** |
| Historical receipt | M4.145 compiled-core digest remains `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`; `combined-headroom-m4-145.json` remains byte-identical. | `coverage-integrity.test.mjs:358-400`; `combined-headroom-m4-145.json:50`; `combined-headroom-m4-145.test.mjs:29-38` | **VERIFIED** |
| Current summaries | Current compiled identity is regenerated from the rebuilt 4.6 core; it is not backdated to M4.145. The present stale pin is `ddd0992e...`; the live probe is `0d1c4eaa6dbe30baafaed48c9561c194e045dc1ee46af7910394a10eb671fff4`. | `coverage-summary.json:138`; `coverage-prerequisite-summary.json:7`; `coverage-dependencies.mjs:871-903`; M0-SH5 probe | **VERIFIED** |

**[M0-SH13 VERIFIED]** Two independent clean forced core builds at current HEAD
were byte-deterministic on 2026-08-21. Each ran exactly:

```text
rm -rf packages/core/dist && pnpm --filter @kernlang/core exec tsc -b --force
```

and exited `0`. After each build, `digestCompiledCoreJavaScript()` returned
`0d1c4eaa6dbe30baafaed48c9561c194e045dc1ee46af7910394a10eb671fff4`; the
five authoritative file SHA-256 values were identical to the five live values
in M0-SH5, in that same ordered path list. Measurement uses
`coverage-dependencies.mjs:871-903` plus direct SHA-256 of the five
`packages/core/dist` files; the exact observed hashes are retained in M0-SH5.

## Decided Design

**[M0-SH9 DECIDED]** Add one additive aggregate transition module/data pair and
one focused test. It reconstructs each of the five current compiled files to
the exact `8a453a44` bytes stored as the old scalar stage's current endpoint,
then invokes the old stage without altering it. The aggregate module must
validate its own exact five-path manifest, row order, endpoint digests, blobs,
and rows digest before returning any reconstruction.

**[M0-SH10 DECIDED]** The aggregate transition is a byte-reconstruction
contract, not an AST or semantic-causality contract. It records the two Git
endpoints and may cite `f125ea61` as explanatory provenance, but it does not
create a frozen compiled intermediate endpoint for `f125ea61`.

**[M0-SH11 DECIDED]** The adapter reads each historical compiled path once,
applies aggregate reconstruction when its path is one of the five, then passes
that byte buffer to `atScalarHelperHistoryCompiledPredecessor`. Unaffected paths
must bypass the aggregate unchanged and retain current old-stage behavior.

## Implementation Plan

1. Add generated aggregate transition data holding only the five exact rows and
   base64-encoded current/predecessor bytes; derive decoded byte strings,
   manifest and endpoint digests in the companion module. Generation must use
   pinned builds at `91f794dc` and `8a453a44`, SHA-256, and
   `git hash-object --stdin`; no literal may be guessed from source diffs.
2. Add a transition module that validates exact object keys, five-row order,
   SHA-256 and blob syntax, manifest/endpoint/rows identities, then uses the
   existing literal-reconstruction primitive.
3. Update only the scalar-history coverage adapter to prepend this transition
   before the immutable scalar stage. Do not change the old transition data or
   the generic reconstruction primitive.
4. Add focused aggregate-history tests and extend composition tests only where
   necessary to prove ordering and unchanged old-edge identity.
5. Rebuild core, regenerate the two current coverage summaries, and update the
   single literal current-digest oracle in `coverage-prerequisite.test.mjs` from
   generated measurement—not manual editing.

## Blast Radius

| File / area | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/scalar-helper-history-4-6-transition-data.mjs` | add | Exact generated five-row aggregate endpoint bytes. |
| `scripts/kern-canonicalizer/scalar-helper-history-4-6-transition-module.mjs` | add | Validate and expose only aggregate reverse reconstruction. |
| `scripts/kern-canonicalizer/scalar-helper-history-4-6-transition.test.mjs` | add | Exact endpoint, ordering, and mutation oracle. |
| `scripts/kern-canonicalizer/scalar-helper-history-coverage-adapter.mjs` | modify | Compose aggregate before immutable old edge. |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | Bind live rebuilt compiled-core digest. |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | regenerate | Bind the same live compiled-core digest. |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | modify | Pin the regenerated current digest. |
| Existing scalar transition/data and M4.145 receipt | no change | Historical identities are the protected terminal target. |

## Acceptance Criteria

- [ ] **[M0-SH-A1]** Before implementation, rebuilt current core fails
  aggregate admission on the exact five M0-SH5 paths and no others; after
  implementation all five reconstruct to their exact listed `8a453a44` SHA-256
  and blob endpoints. The existing three matching scalar rows remain unchanged.
- [ ] **[M0-SH-A2]** Each aggregate row rejects a one-byte mutation of
  successor bytes before replacement, a one-byte mutation of predecessor text
  after replacement, an absent current literal, and a duplicate current literal.
  Expected failures are the existing broken/misordered-edge, unique-occurrence,
  or reconstructed-digest rejection classes. Evidence:
  `historical-transition-chain.mjs:75-86`; `historical-source.mjs:30-42`.
- [ ] **[M0-SH-A3]** Omission, addition, reorder, duplicate path, wrong exact
  key set, non-canonical key serialization, wrong deterministic row order,
  wrong row digest, wrong SHA-256, and wrong blob in the new
  five-row manifest fail closed before coverage hashing; the old eight-row
  immutable transition continues to reject the same mutations.
- [ ] **[M0-SH-A4]** Reversing aggregate and old stages, or passing an
  `8a453a44` endpoint directly into the aggregate stage, fails on successor
  identity. No aggregate stage runs for a non-five path.
- [ ] **[M0-SH-A5]** Full replay yields unchanged M4.145 compiled-core
  digest `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`
  and unchanged `combined-headroom-m4-145.json` receipt SHA-256.
- [ ] **[M0-SH-A6]** Regenerated `coverage-summary.json`,
  `coverage-prerequisite-summary.json`, and `coverage-prerequisite.test.mjs`
  equal the same freshly measured current compiled-core digest; no historical
  receipt or old scalar identity changes.
- [ ] **[M0-SH-A7]** The 4.6 Text contract remains discriminated by
  mixed-width `A¢€🌍 -> 10`, width boundaries, malformed surrogate fail-close,
  unshadowed one-argument admission, and generated TS/Python helper injection.
  Evidence: `text-utf8-length.test.ts:73-134` and
  `text-utf8-length-python.test.ts:75-107`.
- [ ] **[M0-SH-A8]** `pnpm test:kern-canonicalizer` passes from a cold
  build. Its defined order rebuilds core and CLI before composition, semantic
  check, canonicalizer tests, and final check scripts. Evidence: `package.json:64`.

## Deploy / Skew

**[M0-SH12 VERIFIED]** This is an internal local candidate only. The repair is
activated atomically by the repository's build-and-test command; there is no
supported mixed version because the new adapter and generated aggregate data
must ship together. No push, tag, package publication, or release authority is
granted by this spec. Evidence: `package.json:64` and
`.Codex/goals/KERN-5-COMPLETION-GOAL.md:104-125`.

## Out of Scope

- Changing `Text.utf8Length` semantics, codegen templates, Python helper
  generation, public package/API versioning, or F4B byte accounting.
- Adding AST parsing, normalization, regex/fuzzy replacement, or a causal Git
  commit ledger to the byte-reconstruction engine.
- Editing immutable scalar-helper rows, M4.145 receipt bytes, historical
  headroom data, or any F4 production/test source.
- Staging, committing, pushing, tagging, or publishing.

## Corrections Log

| Original claim | Correction | Evidence / impact |
|---|---|---|
| `0a4d41c6` caused the scalar-history failure. | `0a4d41c6` contains only F4B changes; the mismatching core bytes arise from `f125ea61` and `91f794dc`. | M0-SH3–4. |
| The tribunal's initial five-path list named `codegen-expression.js` and host-namespace files. | The live compiled probe identifies the authoritative five M0-SH5 paths; those tribunal paths are not scalar-edge mismatches. | `~/.agon/runs/tribunal-1787281386040-b584yv/agy-output.txt` versus M0-SH5. |
| Two replay stages are necessary because feature and formatter commits differ. | Rejected: the canonicalizer authenticates exact endpoint bytes, and a frozen `f125ea61` compiled intermediate expands the permanent contract without strengthening current-to-8a proof. One exact aggregate stage is minimal and fail-closed. | Tribunal decision `~/.agon/runs/tribunal-1787281386040-b584yv/tribunal_da0cae4e.jsonl`; `historical-transition-chain.mjs:58-87`. |
| Updating the old scalar rows' current digests would fix the wall. | Rejected: it rewrites the immutable `7efa4c3a -> 8a453a44` edge and masks the provenance break. | `scalar-helper-history-transition.test.mjs:121-161`. |
