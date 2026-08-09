# KERN 5 Phase-2 Authenticated Evolved Hints

**Status:** VERIFIED — PUBLICATION PENDING
**Date:** 2026-08-08
**Confidence:** 0.99

## Executive Summary

M4.169 will make the bootstrap parser's complete evolved-hint phase an
independently authenticated KERN-owned shadow. It will bind the effective
runtime hint definitions into the existing fused runtime-instance/parse-epoch
evidence, replay runtime-versus-built-in selection plus positional and bare-word
consumption in handwritten KERN, then compose the resulting cursor and property
writes with the reviewed M4.168 generic property/style/theme/diagnostic result.
Keyword handlers, ParsedLine construction, public API cutover, and canonical
frontend promotion remain explicit later seams.

## Current State / Root Cause

- **VERIFIED:** The bootstrap phase selects `runtime.parserHints.get(type) ??
  BUILTIN_PARSER_HINTS.get(type)`, consumes every configured positional name via
  `consumeAnyValue()`, then performs `skipWS()`, `!isKeyValue()`, and one
  `tryIdent()` for `bareWord` before keyword handlers run
  (`packages/core/src/parser-core.ts:337-361`).
- **VERIFIED:** The only immutable fallback is `class -> { bareWord: "name" }`
  (`packages/core/src/parser-core.ts:24-27`). An empty runtime entry is present
  and therefore suppresses that fallback under nullish selection.
- **VERIFIED:** `consumeAnyValue()` skips whitespace and consumes exactly one
  token of any non-whitespace kind; it does not stop at a key/value head
  (`packages/core/src/parser-token-stream.ts:79-85`). After its caller skips
  leading whitespace, `isKeyValue()` requires an identifier immediately
  followed by equals; whitespace between them makes the guard false
  (`packages/core/src/parser-token-stream.ts:48-54`).
- **VERIFIED:** The current fused snapshot validates `parserHints` as a native
  map of plain bounded-shape data but emits only `evolvedTypes`,
  `multilineTypes`, and `templateTypes`; it does not retain hint values
  (`packages/core/src/mutable-node-type-registry-snapshot.ts:46-53,172-210,285-314`).
  Consequently two runtimes with equal registry membership and contradictory
  hint payloads cannot be distinguished by current snapshot evidence.
- **VERIFIED:** Fused evidence is privately bound to the source and runtime,
  checked against the current instance/epoch, and consumed once
  (`packages/core/src/mutable-node-type-registry-snapshot.ts:69-74,321-331,482-498`).
- **VERIFIED:** The wrapper is already 498 lines, so new hint capture logic
  cannot be added in place without violating the handwritten-source limit
  (`wc -l packages/core/src/mutable-node-type-registry-snapshot.ts` on
  2026-08-08 -> `498`). Hint canonicalization must be extracted.
- **VERIFIED:** M4.168 owns generic properties, style/theme replay, recoverable
  unexpected-token diagnostics, and exact diagnostic interleaving, but excludes
  hints and handlers (`docs/kern-5-support-matrix.md:372-383`).

## What Already Works

The runtime-instance/parse-epoch identity, private one-shot binding, native
collection checks, source-profile guards, retained-token stream, node admission,
known-node warning, and M4.168 replay remain unchanged. M4.169 extends their
evidence and composes above them; it does not replace the bootstrap parser or
weaken earlier source profiles.

## Contract (Verified)

> Verified against `parser-core.ts`, `parser-token-stream.ts`,
> `runtime-state.ts`, `mutable-node-type-registry-snapshot.ts`, and all direct
> `parseWithMutableNodeTypeRegistrySnapshot` / `consumeMutableNodeTypeRegistryParseEvidence`
> clients found by `rg` on 2026-08-08.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| `snapshot.parserHints` | frozen canonical array of frozen entries | new additive field on `MutableNodeTypeRegistrySnapshotEvidence`; current missing field at `mutable-node-type-registry-snapshot.ts:46-53` | VERIFIED |
| entry `type` | non-empty bounded string, unique and sorted | runtime map key validation/capture at `mutable-node-type-registry-snapshot.ts:199-210,285-314` | VERIFIED |
| entry `positionalArgs` | frozen ordered string array | bootstrap iteration preserves configured order at `parser-core.ts:344-348` | VERIFIED |
| entry `bareWord` | optional bounded string | bootstrap write target at `parser-core.ts:350-355` | VERIFIED |
| runtime precedence | present runtime entry wins, including `{}` | nullish lookup at `parser-core.ts:342` | VERIFIED |
| built-in fallback | `class` only, `bareWord=name` | `parser-core.ts:24-27` | VERIFIED |
| positional transition | skip whitespace, consume one arbitrary token per name, write only when present | `parser-token-stream.ts:79-85`; `parser-core.ts:344-348` | VERIFIED |
| bare-word transition | skip whitespace, reject key/value head, consume at most one identifier | `parser-core.ts:350-355`; `parser-token-stream.ts:28-37,48-54` | VERIFIED |
| phase exit | cursor and ordered property writes entering keyword handlers | `parser-core.ts:330-361` | VERIFIED |
| old consumers | internal checkers/tests; no package-root export found | `rg -n "mutable-node-type-registry-snapshot" packages/core/package.json packages/core/src/index.ts packages/core/src/*.ts package.json` on 2026-08-08 | VERIFIED |

Hint names use the existing configured `maxNameCodePoints` and `maxNameBytes`.
The existing `maxRegistryEntries` bounds the hint-map entry count, each
positional list, and the aggregate positional-name count. This avoids new
hardcoded policy and keeps every capture finite.

## Implementation Options

### Recommended: corrected complete phase

1. Extract native parser-hint validation/canonicalization into a focused core
   module and add the immutable value-bearing field to fused snapshot evidence.
2. Add independent host oracle, bounded policy, fixtures, and a handwritten
   KERN successor that authenticates hint selection/consumption and composes the
   exact resulting cursor/property writes with M4.168.
3. Keep the evidence prerequisite and semantic successor in separate granular
   commits inside the one M4.169 feature, then push the finished feature once.

This is the only non-strawman boundary after tribunal
`tribunal-1786164934810-zid95j-m4-169-next-frontend-seam`: immutable-class-only
ownership is occurrence-only; resolution-only ownership is adapter-only; node
construction would falsely depend on unowned keyword handlers.

## Blast Radius

| File / Area | Action | Reason |
|---|---|---|
| `packages/core/src/parser-hint-snapshot.ts` | add | Keep native validation/canonicalization isolated and every handwritten file below 500 lines. |
| `packages/core/src/mutable-node-type-registry-snapshot.ts` | edit | Emit deep-frozen bounded hint evidence in the fused snapshot. |
| `packages/core/tests/mutable-node-type-registry-snapshot.test.ts` | edit | Prove value capture, deep copy/freeze, bounds, and runtime isolation. |
| `examples/kern-frontend/evolved-hints*.kern` | add | Own the complete phase and compact failure/authentication in native KERN. |
| `scripts/kern-frontend-evolved-hints/*` and checker | add | Independent oracle, policy, fixtures, envelope parser, mutations, and cumulative receipt. |
| `package.json` / fitness policy | edit | Add the focused gate to the promoted cumulative wall. |
| goal, release train, support matrix | edit | Record exact internal-oracle claim and remaining seams without promotion inflation. |

## Acceptance Criteria

- [x] **Evidence RED:** on the M4.168 base, contradictory runtimes with identical
  membership cannot produce distinguishable authenticated hint payloads; the
  new focused test fails semantically for that reason before implementation.
- [x] Snapshot evidence records every effective runtime map entry, including an
  empty `class` entry, with canonical type ordering and original positional
  ordering; entries and nested arrays are copied and frozen.
- [x] Invalid, proxied, accessor-bearing, oversized, duplicate, malformed UTF-16,
  or mid-capture-mutated hint data fails before parsing.
- [x] Runtime hint entries win over the built-in fallback, including `{}`;
  absent `class` uses `bareWord=name`; absent non-`class` uses no hint.
- [x] Positional arguments consume exactly one arbitrary non-whitespace token in
  configured order, do not write when input ends, and preserve overwrite order.
- [x] Bare-word consumption occurs after positionals, calls the whitespace and
  key/value guards, consumes at most one identifier, and preserves the exit
  cursor.
- [x] M4.169 composes hint writes and cursor effects with M4.168 properties,
  styles, theme refs, duplicate diagnostics, and unexpected-token diagnostics;
  parity is compared to the fused bootstrap parse without deriving expected
  semantics from `parseResult`.
- [x] Payload swaps, structural copies, cross-runtime use, stale epochs, replay,
  double consumption, nested-reference mutation, cursor reset, precedence
  inversion, sorted/reversed positionals, identifier-only positionals,
  bare-word-before-positionals, removed guards, and double bare-word mutants die.
- [x] Every new handwritten source file is below 500 lines and contains no
  parser, TokenStream, tokenizer, adapter, dynamic-loader, crypto, or host-oracle
  delegation.
- [x] Focused tests, touched core tests, cumulative M4.153-M4.169 receipt,
  `git diff --check`, lint, and the complete Node 22 KERN 5 fitness wall pass.
- [x] Automatic high-risk role-lens Agon review with primary `codex` completes
  using the live usable non-excluded roster; all verified blockers are fixed.

## Verification Receipt

- The focused evolved-hints gate passes 7/7 direct tests and the 12-case
  cumulative differential receipt.
- `git diff --check` and the repository lint gate pass; every new handwritten
  source file remains below 500 lines.
- The uninterrupted Node 22 `pnpm fitness:kern-5` wall exits 0 and ends with
  `KERN 5 current fitness wall passed.`
- Automatic high-risk role-lens review
  `review-1786292799625-nfwf5z-kern5-m4-169-final` completed 6/6. Its verified
  compact-failure authentication blocker is fixed RED-first; the affected
  direct 7/7 gate and cumulative `evolvedHints:12` receipt pass afterward.
- Targeted security confirmation
  `review-1786294312814-m162h6-kern5-m4-169-compact-failure-fix` completed 1/1
  with zero findings. Signed publication and remote SHA verification remain.

## Out of Scope

- Keyword-handler dispatch or semantics.
- Multiline input and parenthesized-source expansion beyond M4.168's profile.
- ParsedLine/IRNode construction, indentation/document attachment, AST/KIR.
- Public frontend API, canonical frontend promotion, compiler cutover, release
  tags, or registry publication.

## Open Questions

None. All claims feeding oracle fixtures are source-verified. The exact
record layout is an implementation detail constrained by the binary criteria.

## Deploy Order

This is an internal monorepo contract with no external version-skew window. The
additive core evidence field, its tests, the native successor, focused gate, and
docs ship in one feature push after the complete local wall. Existing consumers
continue to read their original fields; the new checker is the first consumer
that requires `parserHints`.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The new evidence could be added directly to the snapshot wrapper. | The wrapper is already 498 lines. | Extract canonicalization into a new focused core module. |
| A separate mutation-triggered runtime epoch protocol might be needed. | Capture and parse are synchronous and already bound to one private instance/epoch evidence object. | Preserve the current protocol; test payload swap, deep-copy, stale, replay, and cross-runtime attacks instead. |
| The host compact-failure parser could rely on duplicated seal fields alone. | Full-roster review proved that arbitrary identities, codes, and details were accepted. | Bind failures to the current snapshot, the exact seven-code native contract, and the native empty-detail invariant. |
| `isKeyValue()` skips whitespace between an identifier and equals. | Its caller skips leading whitespace, then the method requires the identifier's immediate successor to be equals. | Correct the spec wording and preserve spaced-equals bootstrap/KERN parity in the focused test. |
