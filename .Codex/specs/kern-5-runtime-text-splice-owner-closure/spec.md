# KERN 5 Runtime Text Splice Owner Closure

**Status:** COMPLETE

**Date:** 2026-08-13

**Baseline:** `fa11d52d841508ed0ad0d5c2b9a62a00c6eb4970`

**Tribunals:** `tribunal-1786604698231-lhr6z9-kern5-text-splice-runtime-owner`
and corrective `tribunal-1786605061784-nxjic4-kern5-text-splice-owner-closure-`
(`claude,codex,agy`, 3/3 each)

**Confidence:** 0.84 before challenge; 0.96 after tribunal.

## Root Cause

- **[TSO-C1 VERIFIED]** `Text.splice` was introduced by `2c030fef` and its
  sources were normalized by `f4fdd742`; `fa11d52d` is the published main tip
  for the completed prerequisite slice, not the introducing commit.
- **[TSO-C2 VERIFIED]** The public runtime graph reaches
  `ir/semantics/internal-effect-machine-text-splice.ts` through the approved
  effect-machine leaf/do modules.
- **[TSO-C3 VERIFIED]** The exact runtime machine-owner manifest omits that
  reachable module and the same-commit
  `internal-effect-machine-deferred-binding.ts` helper, so
  `pnpm test:kern-runtime-contract-v1` fails with `unapproved machine owner`.
- **[TSO-C4 VERIFIED]** The five frozen runtime-contract authority artifacts do
  not hash or enumerate the separate machine-owner allowlist. Regenerating
  them would create unrelated historical contract drift.

## Decision

- **[TSO-D1 DECIDED]** Add exactly
  `ir/semantics/internal-effect-machine-deferred-binding.ts` and
  `ir/semantics/internal-effect-machine-text-splice.ts` to the sorted
  `machine-owner-allowlist.json` source-module set. A guard-free enumeration
  proves these are the complete source and built deltas; any third delta stops
  the repair.
- **[TSO-D2 DECIDED]** Add one discriminating test that proves the splice owner
  is present and reachable in both source and built closures, and that both
  unapproved-reachable and approved-unreachable mutations reject.
- **[TSO-D3 DECIDED]** Do not inline the primitive into the 494-line leaf
  module, add another owner, change the runtime ABI, expose the primitive, or
  regenerate any frozen runtime receipt/authority.

## Binary Acceptance

- **[TSO-A1 ACCEPT]** RED is the current runtime-contract graph failure naming
  the unapproved splice module, plus the new focused exact-owner regression.
- **[TSO-A2 ACCEPT]** The source and built public runtime closures contain the
  exact two same-commit additions and no additional member.
- **[TSO-A3 ACCEPT]** Removing the approved splice owner from a visited closure
  rejects as unreachable; adding an unapproved owner rejects as unapproved for
  both `.ts` and `.js` graphs.
- **[TSO-A4 ACCEPT]** Existing Text.splice bounds, Unicode scalar, atomicity,
  namespace-shadow, and preflight regressions remain green.
- **[TSO-A5 ACCEPT]** `pnpm test:kern-runtime-contract-v1` and the complete
  Node 22 KERN 5 fitness wall pass with the frontend F0 diff unchanged.

## Hard Stops

- Any frozen runtime authority, receipt, lineage, public declaration, export,
  handler ABI, diagnostic, or runtime behavior changes.
- Any third unapproved owner becomes reachable or any existing owner becomes
  unreachable.
- Any hand-written source reaches 500 lines.

## Verification

- **[TSO-V1 VERIFIED]** RED named both omitted same-commit owner modules in
  sequence; a guard-free enumeration proved those two were the complete source
  and built deltas.
- **[TSO-V2 VERIFIED]** The exact-owner graph passes 10/10, including specific
  source/built reachability and extra/missing mutations for both additions.
- **[TSO-V3 VERIFIED]** `pnpm test:kern-runtime-contract-v1` passes 81/81 and
  reports exactly 132 source plus 132 built modules with the frozen runtime
  authority unchanged.
- **[TSO-V4 VERIFIED]** Combined high-risk live-roster review
  `review-1786605270805-mkal1n-kern5-f0-runtime-owner-final` found no
  runtime-owner issue; its sole blocker concerned the separate F0 static
  golden binding and was repaired independently.
