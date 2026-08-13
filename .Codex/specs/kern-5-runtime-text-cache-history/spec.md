# KERN 5 Runtime Text Cache Canonicalizer History Closure

**Status:** IMPLEMENTED — FULL WALL PENDING

**Date:** 2026-08-13

**Baseline:** `4330f42866d8e3d1534e471881d17b870c067106`

**Tribunal:** `tribunal-1786633247008-cdxl9t` (`claude,codex,agy`, 3/3)

**Confidence:** 0.91 before challenge; 0.96 after the tribunal fixed the
transition ordering and commit-binding requirements; 0.99 after clean builds
proved one of five changed TypeScript owners is byte-identical after emission.

## Root Cause

- **[RTH-C1 VERIFIED]** The cache slice adds exactly one compiled JavaScript
  owner, `ir/semantics/internal-text-code-point-cache.js`, changing the
  compiled-core inventory from the authenticated 316 paths to 317 paths with
  digest `34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67`.
- **[RTH-C2 VERIFIED]** The slice changes five retained TypeScript owners, but
  clean forced builds prove `internal-effect-machine-types.ts` is type-erased
  and emits byte-identical JavaScript. Exactly four retained compiled owners
  differ: `internal-effect-machine.js`, `portable-string.js`,
  `runtime-envelope/execute.js`, and `runtime-envelope/internal-engine.js`.
- **[RTH-C3 VERIFIED]** The current canonicalizer rejects the new inventory
  before successor removal. Excluding only the new path would still hash a
  synthetic mixture of historical membership and current retained bytes.
- **[RTH-C4 VERIFIED]** M4.97 independently pins the TypeScript source
  identities of `internal-effect-machine.ts` and
  `internal-effect-machine-types.ts`; M4.116 and M4.128 also pin the effect
  machine identity. These cache changes must reconstruct to their exact
  baseline digests before every affected archival measurement.

## Decision

- **[RTH-D1 DECIDED]** Create a dedicated runtime-text-cache successor
  transition. It binds the exact cache implementation commit, the 316-to-317
  inventories, and the single added compiled path.
- **[RTH-D2 DECIDED]** Reverse-reconstruct all four changed retained compiled owners
  from exact current bytes to exact clean baseline bytes before invoking the
  existing Text.splice and older reconstruction stages.
- **[RTH-D3 DECIDED]** Keep the Text.splice transition constants, published
  M4.145 compiled digest, pre-M4.135 compiled digest, and every archival
  receipt byte unchanged.
- **[RTH-D4 DECIDED]** Bind reconstruction to clean detached builds of the
  baseline and cache implementation commits. Every current-byte mismatch,
  replacement mismatch, inventory drift, or ordering drift fails closed.
- **[RTH-D5 DECIDED]** Reuse the same transition owner for the two exact
  M4.97 source reconstructions; do not rewrite the M4.97 receipt or its pinned
  source digests.

## Binary Acceptance

- **[RTH-A1 ACCEPT]** RED reproduces the 317-path rejection and proves that
  adding, removing, renaming, duplicating, or escaping a path rejects.
- **[RTH-A2 ACCEPT]** Removing the one cache owner from the exact 317-path
  inventory reproduces the frozen 316-path count and digest exactly.
- **[RTH-A3 ACCEPT]** Each changed retained compiled owner reconstructs from
  its exact cache-commit digest to its exact `4330f428` digest; current-source
  and replacement drift reject independently. The changed type-only owner must
  remain byte-identical across both forced builds.
- **[RTH-A4 ACCEPT]** Reconstruction order is cache epoch, Text.splice epoch,
  M4.171 and later structural epochs, then frozen historical hashing.
- **[RTH-A5 ACCEPT]** `digestM4145CompiledCoreJavaScript()` remains exactly
  `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`.
- **[RTH-A6 ACCEPT]** `digestPreM4135CompiledCoreJavaScript()` remains exactly
  `502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec`.
- **[RTH-A7 ACCEPT]** Focused transition/integrity tests, the canonicalizer
  gate, full KERN 5 fitness, and independent Agon review pass.
- **[RTH-A8 ACCEPT]** M4.97 measures from exact reconstructed pre-cache source
  bytes and retains its published receipt digest byte-for-byte.

## Hard Stops

- Any frozen digest, receipt, or Text.splice transition constant changes.
- Any successor path is inferred instead of listed and authenticated exactly.
- Any retained compiled file is omitted or accepted without exact current and
  predecessor byte authentication.
- Any historical build artifact is copied into the product or runtime path.
- Any cache behavior, public API, KIR surface, or frontend ownership claim is
  added during this history-only repair.

## Verification Plan

1. Commit the cache implementation locally to establish its immutable identity.
2. Produce clean detached builds of `4330f428` and the cache commit.
3. Add RED transition, drift, ordering, and frozen-digest tests.
4. Implement the dedicated successor transition and reverse reconstructions.
5. Run focused history tests, canonicalizer, full fitness, independent review,
   signed history commit, and the single authorized feature push.

## Verification

- **[RTH-V1 VERIFIED]** Clean forced builds authenticate the exact 317-to-316
  inventory delta, four changed retained JavaScript owners, one byte-identical
  type-only emitted owner, and both changed M4.97 TypeScript source owners.
- **[RTH-V2 VERIFIED]** The dedicated transition and coverage-integrity tests
  pass with path drift, source drift, replacement drift, type-only identity,
  ordering, and frozen-digest guards.
- **[RTH-V3 VERIFIED]** A complete Node 22 canonicalizer gate passes 750/750
  tests plus CLI fixed points, hostile/tamper checks, packed-tarball smoke, and
  terminal current-coverage validation.
- **[RTH-V4 VERIFIED]** The published M4.145 and pre-M4.135 compiled digests,
  M4.97/M4.116/M4.128 receipts, and Text.splice transition constants remain
  unchanged.
- **[RTH-V5 PENDING]** Complete KERN 5 fitness, independent Agon review,
  signed history commit, and the single authorized publication push.
