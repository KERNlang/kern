# M0 — Scalar-Helper History Closure for Text.utf8Length

**Status:** READY TO BUILD
**Date:** 2026-08-21
**Confidence:** 0.97

## Executive Summary

**[M0-SH1 VERIFIED]** The cold canonicalizer wall fails because the live
compiled 4.6 bytes no longer replay to the frozen M4.145 core identity. The
repair is an atomic, path-disjoint composition across the post-format
`91f794dc` to `8a453a44` edge: preserve the already-pinned five-row scalar
4.6 transition data byte-for-byte, add a new five-row host/compiler companion, and apply
all ten substitutions before the single 305-path terminal digest. Evidence:
the two-stage tribunal `tribunal-1787283386416-0eql9e/agy-output.txt:3-5,54-72`
and the pinned endpoint measurement in M0-SH5b.

**[M0-SH2 VERIFIED]** This is byte-provenance repair only: no `Text.utf8Length`
runtime, generated-lowering, public API, F4 policy, or receipt behavior changes.
The existing `7efa4c3a -> 8a453a44` scalar-helper *data identity* and M4.145
receipt stay byte-identical; validator and test implementation may be hardened
without changing those pinned data fields. Evidence: `scalar-helper-history-transition.mjs:45-60`,
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

**[M0-SH5 VERIFIED]** A read-only post-build probe of the *eight-row old scalar
edge* found exactly five mismatches and three matching rows. That result proves
the scalar stage's scope only; it is not a complete 4.6 historical closure.
The probe was:

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

**[M0-SH5b VERIFIED]** The pinned `8a453a44` core compilation was validated by
matching all eight frozen scalar-stage successor hashes, then compared with the
current built core. Five additional, previously unowned compiled-byte deltas
are required. Each row is current `91f794dc`/HEAD bytes followed by its exact
`8a453a44` bytes:

| Compiled path | current SHA-256 | current blob SHA-1 | 8a SHA-256 | 8a blob SHA-1 |
|---|---|---|---|---|
| `codegen-expression.js` | `56af9d434d88043b31b125bb301d1f5abfb0d987c0e34a6ce5c8196a505b9b78` | `22e865bddb7cf1539a00533eac17492e49505f74` | `150054725ff4bdaf3cddcc61d24862be7878e14bec239ffdaf12e94e7ce82ae5` | `41dadce3c8121de457f5e28640de83c3de183a7e` |
| `codegen/host-namespace-ir.js` | `4af8ce4e7470666550cb87f5694f0ba24a09492dc9f24f30ed0e06f2aaac3b9b` | `775c6a44191b32ae418814dd0968717a36b3c263` | `2e8979f84018466b86d9779af741fdb9bb10df71ba72c4cfa6eb6bd75a0df9e0` | `6146087f56a7984bb31408c5e047acb2a711c809` |
| `codegen/host-namespace.js` | `74ac078b291cc52180f9d7d771aca595c6eaff94f0287e2c3a27971e524dca48` | `2e6a77f997f54817de75aa90412167e6b14efe6e` | `266f9f9af2cc01eaf8d3fdd789b9a4d0cfc3b05e40fbd00565bcfeae3dad2fa1` | `9eb266b0db994275876f84fc8205434212837dec` |
| `index.js` | `0635fed286667cfd20545c63f0e7c556885176cf5a54dd42bdbda498f98b05f2` | `31fdc2dcc63b305b05182f47c0070e26878af9eb` | `e1b337b34ead99e499247cd972c4787347805090b2afbe722689c885b11bf37b` | `0c0c522a74d49892dbc8ac7b8559a8b49d8b3962` |
| `spec.js` | `42c96c1da248f1257d403ebfcc424dd75de0b32e14373da7fd4eb86b197d5f5f` | `7d26f0b1b3103639e6fd0aecd2e0e7ffeeb0cb34` | `bd8f84c3e89a2a62284e687e35aafa86d367aa472bd2529eb0adf5d4d6176e2a` | `131899c581c2741807ff10d92cfd8417c7028aa9` |

The command was an out-of-tree `8a453a44` TypeScript build followed by direct
SHA-256/Git-blob hashes of those five files and `packages/core/dist`; its scalar
row cross-check was `8/8` before these five values were accepted. Applying the
five scalar substitutions plus these five companion substitutions to the real
305-path M4.145 reconstruction yielded exactly
`29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`.

**[M0-SH6 VERIFIED]** The original five-row failure is fail-closed before the
M4.145 digest:
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
| Edge provenance | Both path-disjoint 4.6 stages bind `predecessorCommit=8a453a44...`, `successorCommit=91f794dc...`; reverse replay is successor bytes to predecessor bytes. | M0-SH4–5b; `historical-transition-chain.mjs:69-87` | **VERIFIED** |
| Preserved scalar stage | `kern.runtime.scalar-helper-history-4-6.r0` retains exactly its claim, endpoint commits, five-path row order, manifest/row/endpoint digests, blob identities, and replacement bytes. Its validator implementation may be structurally hardened without changing that data identity. It maps the M0-SH5 paths to the old scalar stage's successor bytes. | `scalar-helper-history-4-6-transition-module.mjs:9-37,115-133`; tribunal `agy-output.txt:54-55,68-72` | **VERIFIED** |
| New companion stage | `kern.compiler.host-companion-history-4-6.r0` owns only the five M0-SH5b paths in their table order and maps each current byte string directly to its exact 8a byte string. It has independent manifest, row, endpoint, and blob identities. | M0-SH5b; tribunal `agy-output.txt:54-56,68-72` | **DECIDED** |
| Existing owners | `internal-effect-machine-helper-runtime.js` and `portable-reference-evaluator.js` remain runner-call-cache reconstructions; `internal-text-code-point-cache.js` remains runtime-text-cache/inventory history; `runner-call-cache.js` remains a removal transition; diagnostics, types, semantic-env ownership, and semantic-env are excluded because compiled bytes are unchanged. | `runner-call-cache-historical-transition.mjs:23,35-49`; `runtime-text-cache-historical-transition.mjs:12-22`; pinned 8a/current byte probe in M0-SH5b | **VERIFIED** |
| Stage acceptance | Each stage accepts only exact successor bytes, applies only unique literal replacement text, and yields its exact predecessor digest. No regex, normalization, fuzzy match, or fallback is legal. | `historical-transition-chain.mjs:69-87`; `historical-source.mjs:19-44` | **VERIFIED** |
| Composition and terminal | The scalar and companion path sets are disjoint, so their application order is observationally commutative; the only historical acceptance point is the composed 305-path M4.145 digest. A companion path bypasses the old scalar stage unchanged. | tribunal `agy-output.txt:22-29,43-45`; `scalar-helper-history-transition.mjs:106-116`; M0-SH5b | **DECIDED** |
| Old edge | The original eight-row scalar transition's data identity is immutable. The five-row scalar 4.6 transition is specified/pinned by b425988d and generated in the current uncommitted coherent patch; companion repair must not alter either stage's claim, endpoints, rows, digests, or replacement bytes. Validator/test hardening is permitted. | `scalar-helper-history-transition.mjs:62-92`; `scalar-helper-history-4-6-transition-module.mjs:115-133`; tribunal `agy-output.txt:9-16,68-72` | **VERIFIED** |
| Historical receipt | M4.145 compiled-core digest remains `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`; `combined-headroom-m4-145.json` remains byte-identical. | `coverage-integrity.test.mjs:358-400`; `combined-headroom-m4-145.json:50`; `combined-headroom-m4-145.test.mjs:29-38` | **VERIFIED** |
| Current summaries | Current compiled identity is regenerated from the rebuilt 4.6 core; it is not backdated to M4.145. The present stale pin is `ddd0992e...`; the live probe is `0d1c4eaa6dbe30baafaed48c9561c194e045dc1ee46af7910394a10eb671fff4`. | `coverage-summary.json:138`; `coverage-prerequisite-summary.json:7`; `coverage-dependencies.mjs:871-903`; M0-SH5 probe | **VERIFIED** |

**[M0-SH13 VERIFIED]** Two independent clean forced core builds at current HEAD
were byte-deterministic on 2026-08-21. Each ran exactly:

```text
rm -rf packages/core/dist && pnpm --filter @kernlang/core exec tsc -b --force
```

and exited `0`. After each build, `digestCompiledCoreJavaScript()` returned
`0d1c4eaa6dbe30baafaed48c9561c194e045dc1ee46af7910394a10eb671fff4`; the
five scalar authoritative SHA-256 values were identical to M0-SH5. The full
ten-substitution closure is instead bound by M0-SH5 plus M0-SH5b and the
305-path terminal digest; a five-row-only focused green is insufficient.

## Decided Design

**[M0-SH9 DECIDED]** Preserve the b425988d-pinned scalar 4.6 *transition data
identity* generated in the current uncommitted coherent patch: claim, endpoint
commits, path order, row and endpoint digests, blob identities, and replacement
bytes are immutable. Validator and test sources may be hardened. Add one
companion module/data/test pair for the five M0-SH5b
paths, with claim `kern.compiler.host-companion-history-4-6.r0`. It
reconstructs those current compiled files to their exact `8a453a44` bytes and
does not invoke, absorb, or mutate the scalar 4.6 manifest. Both stages must
validate their own exact path order, endpoint digests, blobs, and row digests
before returning any reconstruction.

**[M0-SH10 DECIDED]** The two-stage composition is a byte-reconstruction
contract, not an AST or semantic-causality contract. It records the two Git
endpoints and may cite `04c0bbe5`, `f125ea61`, and `91f794dc` as explanatory
provenance, but it creates no frozen intermediate receipt between 91f and 8a.

**[M0-SH11 DECIDED]** The adapter reads each historical compiled path once,
applies the scalar 4.6 stage only to its five paths and the companion only to
its five paths, then invokes the immutable old scalar stage only where that
stage owns the path. All other paths retain their existing transition owners or
unchanged-byte behavior. The stages must compose atomically before M4.145
hashing; no partial five-row success is a terminal result.

**[M0-SH14 DECIDED]** “Immutable transition identity” means the frozen data,
not a frozen validator implementation. For scalar 4.6, companion, and old
scalar records, validation must accept only plain objects with the exact own
string-key **set** required by that record; key insertion order is not data.
Every expected field must be an own enumerable data property (never an
accessor), and any extra key—including a `toJSON` method, custom prototype,
symbol, or non-enumerable property—fails closed. Nested manifest, endpoint,
row, and replacement records obey the same rule. The validator then compares
the pinned scalar values, row order, decoded replacement bytes, SHA-256, and
Git blob identities directly; `JSON.stringify` is not an authority check.

**[M0-SH15 DECIDED]** The adapter creates one immutable ordered transition
registry before its historical-path loop. Registry construction validates each
stage exactly once and returns a closure over that stage's private pinned rows;
the same registry order is used for validation and application. Each closure
first checks its immutable ownership set and only then peels a matching path.
There is no mutable validation cache. Public direct `at…Predecessor` APIs
continue to validate fail-closed on every independent invocation; only the
adapter uses the already-validated closures.

**[M0-SH16 DECIDED]** Live-dist and old-edge coverage are intentionally split.
The scalar 4.6 test proves live `91f`/current bytes replay to their pinned
`8a` predecessors. The old scalar-edge test supplies its immutable pinned `8a`
row bytes directly, proving only the historical `8a -> 7efa` edge and its
mutation failures. A live runtime-text-cache owner that is also scalar-owned
must first pass through the scalar-4.6 peeler before old-edge replay. The
companion peeler is disjoint from that retained-owner set and must not be added
as a meaningless no-op.

## Implementation Plan

1. Preserve the current b425988d-pinned scalar 4.6 transition data exactly;
   structurally harden its validator/test implementation as M0-SH14 requires.
   Generate a new companion data file from pinned `91f794dc` and `8a453a44` builds, holding
   only M0-SH5b's five base64-encoded current/predecessor rows; derive decoded
   byte strings, manifest and endpoint digests in its module. Use SHA-256 and
   `git hash-object --stdin`; no literal may be guessed from a source diff.
2. Add the companion transition module with exact key sets, five-row path order,
   SHA-256/blob syntax, manifest/endpoint/row identities, and the existing
   literal-reconstruction primitive. Its claim is distinct from the scalar
   stage's claim.
3. Update only the scalar-history coverage adapter to create and validate the
   ordered immutable registry once, then compose both disjoint 4.6 stages and
   prior history through its ownership-filtered closures. Do not change old
   scalar data, current pinned scalar 4.6 data, or the generic reconstruction
   primitive.
4. Correct the first focused five-row false green into a full terminal oracle;
   add companion and composed 305-path tests, including leave-one-out of every
   one of the ten substitutions.
5. Rebuild core, regenerate the two current coverage summaries, and update the
   single literal current-digest oracle in `coverage-prerequisite.test.mjs` from
   generated measurement—not manual editing.

## Blast Radius

| File / area | Action | Reason |
|---|---|---|
| `scalar-helper-history-4-6-transition-{data,module,test}.mjs` | add; preserve current generated data bytes | The b425988d-pinned five-row scalar 4.6 data contract is immutable during companion repair; its validator/test source may harden. |
| New host-companion 4.6 data/module/test | add | Exact five-row M0-SH5b endpoint bytes, independent validation, and mutation oracle. |
| `scripts/kern-canonicalizer/text-utf8-length-history-bridge.test.mjs` | modify | Replace the scalar-only false-green target with ten-substitution/305-path closure. |
| `scripts/kern-canonicalizer/scalar-helper-history-coverage-adapter.mjs` | modify | Compose companion and immutable scalar stage before prior history. |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | Bind live rebuilt compiled-core digest. |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | regenerate | Bind the same live compiled-core digest. |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | modify | Pin the regenerated current digest. |
| Existing scalar transition/data and M4.145 receipt | no change | Historical identities are the protected terminal target. |

## Acceptance Criteria

- [ ] **[M0-SH-A1]** The scalar 4.6 live-dist test independently matches its
  five current `91f` bytes and exact pinned `8a` predecessor bytes to the
  frozen SHA-256/blob rows. The companion independently does the same for its
  five M0-SH5b paths in table order. Together they perform exactly ten
  substitutions; the three matching old scalar rows remain byte-identical.
- [ ] **[M0-SH-A2]** Each scalar or companion row rejects a one-byte mutation of
  successor bytes before replacement, a one-byte mutation of predecessor text
  after replacement, an absent current literal, and a duplicate current literal.
  Expected failures are the existing broken/misordered-edge, unique-occurrence,
  or reconstructed-digest rejection classes. Evidence:
  `historical-transition-chain.mjs:75-86`; `historical-source.mjs:30-42`.
- [ ] **[M0-SH-A3]** Omission, addition, duplicate path, wrong key set,
  `toJSON` spoof, custom prototype, symbol, non-enumerable property, accessor,
  wrong deterministic row order, wrong row digest, wrong SHA-256, and wrong
  blob in every stage's transition/row/nested record fail closed before coverage
  hashing. Reordering otherwise valid object keys remains accepted; row-path
  order does not. Both scalar identities and the companion reject the same
  structural mutations.
- [ ] **[M0-SH-A4]** The path-disjoint scalar and companion stages compose in
  either order to the same byte map; passing `8a453a44` bytes into either stage
  fails successor identity. Neither stage runs for a path it does not own.
- [ ] **[M0-SH-A5]** Full replay over the exact 305-path historical inventory
  yields unchanged M4.145 compiled-core
  digest `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`
  and unchanged `combined-headroom-m4-145.json` receipt SHA-256.
- [ ] **[M0-SH-A6]** Leave-one-out of each of the ten substitutions, including
  `index.js` and `spec.js`, yields a digest other than `29daa6ca...`; the
  existing scalar five alone remains the known nonterminal
  `2bcf1a6cb9d97a07cccd9e157d4d8dcda6696c7b3f6b960e38fc660b18040bd8`.
- [ ] **[M0-SH-A7]** Regenerated `coverage-summary.json`,
  `coverage-prerequisite-summary.json`, and `coverage-prerequisite.test.mjs`
  equal the same freshly measured current compiled-core digest; no historical
  receipt, old scalar identity, or current pinned scalar 4.6 identity changes.
- [ ] **[M0-SH-A8]** The 4.6 Text contract remains discriminated by
  mixed-width `A¢€🌍 -> 10`, width boundaries, malformed surrogate fail-close,
  unshadowed one-argument admission, and generated TS/Python helper injection.
  Evidence: `text-utf8-length.test.ts:73-134` and
  `text-utf8-length-python.test.ts:75-107`.
- [ ] **[M0-SH-A9]** The old scalar fixture test uses only each row's pinned
  `8a` successor bytes and retains its one-byte/reverse-edge mutation tests;
  it does not assert that live 4.6 bytes equal old-edge data. The dedicated
  scalar-4.6 test proves live-to-8a composition, and the runtime-text-cache
  retained-owner test proves that precise two-stage order.
- [ ] **[M0-SH-A10]** A deterministic structural call-count oracle extracts the
  adapter's anchored function block and proves one ordered registry creation
  before the path loop, zero direct `at…Predecessor` calls in that loop, and
  registry iteration for application. Its in-memory mutation control moves a
  factory call into the loop and must fail the guard. This is an acceptance
  oracle for once-only validation, not a fragile wall-clock threshold.
- [ ] **[M0-SH-A11]** `pnpm test:kern-canonicalizer` passes from a cold
  build. Its defined order rebuilds core and CLI before composition, semantic
  check, canonicalizer tests, and final check scripts. Evidence: `package.json:64`.

## Deploy / Skew

**[M0-SH12 VERIFIED]** This is an internal local candidate only. The repair is
activated atomically by the repository's build-and-test command; there is no
supported mixed version because the new adapter and generated companion data
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
| The first focused five-row reconstruction green established full history closure. | False: it exercised only the current b425988d-pinned scalar 4.6 stage and did not hash the full 305-path M4.145 inventory; scalar-only replay is `2bcf1a6...`, not the frozen terminal. | M0-SH5b; tribunal `tribunal-1787283386416-0eql9e/kimi-for-coding-k3-output.txt:19-27`. |
| The five M0-SH5b paths may be merged into the current scalar 4.6 manifest. | Rejected: the b425988d-pinned five-row scalar stage has pinned data: claim, path list, rows digest, endpoint digests, and replacement bytes; expanding it violates its immutable data contract. A disjoint companion owns the unowned bytes. | `scalar-helper-history-4-6-transition-module.mjs:9-37,115-133`; tribunal `agy-output.txt:9-16,54-72`. |
| Two stages fabricate an intermediate historical receipt. | Rejected: the stages are path-disjoint, share one 91f-to-8a edge, and compose atomically. The only historical acceptance receipt is the 305-path terminal digest. | tribunal `kimi-for-coding-k3-output.txt:11-15,23-27`. |
| Updating the old scalar rows' current digests would fix the wall. | Rejected: it rewrites the immutable `7efa4c3a -> 8a453a44` edge and masks the provenance break. | `scalar-helper-history-transition.test.mjs:121-161`. |
