# KERN 5 Text Splice Canonicalizer History Closure

**Status:** IMPLEMENTED — FULL WALL PENDING

**Date:** 2026-08-13

**Baseline:** `fa11d52d841508ed0ad0d5c2b9a62a00c6eb4970`

**Tribunal:** `tribunal-1786607629533-a6todt-kern5-m4145-successor-inventory`
(`claude,codex,agy`, 3/3)

**Confidence:** 0.91 before challenge; 0.88 after the tribunal exposed the
retained-byte dependency; target 0.96 after exact reconstruction and the full
fitness wall.

## Root Cause

- **[TCH-C1 VERIFIED]** `2c030fef` added exactly two compiled JavaScript paths:
  `internal-effect-machine-deferred-binding.js` and
  `internal-effect-machine-text-splice.js`. The current inventory is 316 paths
  with digest `ac340824eaa0a587dfe41d9bd8ffdfaf835e47c8cafab146f8031967e9d41345`.
- **[TCH-C2 VERIFIED]** Removing exactly those two paths reproduces the frozen
  314-path successor inventory digest
  `0c00e26bc2201f037b1cae907bee6af7e952ae17e396ed4c0ea9250b5f68d27f`.
- **[TCH-C3 VERIFIED]** The same commit modified the retained compiled files
  `internal-effect-machine-do.js` and `internal-effect-machine-leaf.js`.
  Path exclusion alone therefore cannot authenticate the pre-transition
  historical bytes.
- **[TCH-C4 VERIFIED]** A clean detached build of parent `41c877cf` yields
  exact predecessor SHA-256 digests `9b46fbdd...e5db0c` for `do.js` and
  `856999a3...0bb7c` for `leaf.js`; the current clean build differs.

## Decision

- **[TCH-D1 DECIDED]** Treat the two new files as explicitly provenance-bound
  post-M4.145 successor additions and update the authenticated current
  inventory count/digest.
- **[TCH-D2 DECIDED]** Reconstruct the two modified retained compiled files
  from their exact current bytes to their exact `41c877cf` predecessor bytes
  before applying older M4.171/M4.153 historical reconstructions.
- **[TCH-D3 DECIDED]** Preserve the published M4.145 and pre-M4.135 compiled
  digests byte-for-byte. Do not revise archival receipts or create a synthetic
  historical milestone.
- **[TCH-D4 DECIDED]** Keep transition data in a dedicated bounded module and
  add a dedicated regression test rather than extending the already oversized
  `coverage-integrity.test.mjs`.

## Binary Acceptance

- **[TCH-A1 ACCEPT]** RED proves the current 316-path inventory cannot be
  reconstructed by the old 314-path contract.
- **[TCH-A2 ACCEPT]** The exact current inventory authenticates, and removing
  the exact two provenance-bound additions reproduces the old path inventory.
- **[TCH-A3 ACCEPT]** The exact current compiled `do.js` and `leaf.js` bytes
  reconstruct to the clean `41c877cf` digests; current-byte drift, replacement
  drift, missing additions, extra additions, renames, duplicates, and path
  traversal all reject.
- **[TCH-A4 ACCEPT]** `digestM4145CompiledCoreJavaScript()` remains exactly
  `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`
  and `digestPreM4135CompiledCoreJavaScript()` remains exactly
  `502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec`.
- **[TCH-A5 ACCEPT]** A clean Node 22 core build, focused canonicalizer tests,
  complete `fitness:kern-5`, and independent Agon review pass.

## Hard Stops

- Any historical digest or published receipt changes.
- Any reconstruction accepts unpinned current bytes or produces bytes other
  than the clean `41c877cf` predecessor build.
- Any third compiled inventory delta is silently classified as post-M4.145.
- Any runtime behavior, public ABI, KIR format, or F0 frontend contract changes.

## Verification

- **[TCH-V1 VERIFIED]** A detached clean build of parent `41c877cf` produced
  the pinned predecessor hashes; a forced clean build of the current tree
  produced exactly 316 JavaScript files and the pinned current `do.js` and
  `leaf.js` hashes.
- **[TCH-V2 VERIFIED]** The transition plus coverage-integrity suite passes
  27/27 after the forced clean build, including bidirectional inventory,
  retained-byte reconstruction, tamper sensitivity, and exact archival digest
  assertions.
- **[TCH-V3 VERIFIED]** Both stale current canonicalizer summaries were
  regenerated through the canonical `--write` owner; the focused current
  coverage/prerequisite suite passes 24/24.
- **[TCH-V4 PENDING]** Complete Node 22 `pnpm fitness:kern-5` and independent
  live-roster Agon review on the exact final tree.
