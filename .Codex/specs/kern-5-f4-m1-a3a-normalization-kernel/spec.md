# KERN 5 F4-A3a Neutral Source-Form Normalization Kernel

**Status:** IMPLEMENTED AND LOCALLY VERIFIED — EXTRACTION/PARITY SLICE ONLY
**Date:** 2026-08-22
**Baseline:** `origin/main` `cf761495662d2aa2889dc36d8c9d94e299939cf9`
**Confidence:** 0.93

## Executive Summary

Extract the existing KERN-owned keyword/source-form normalization decisions
from the M4.170 shadow receipt wrapper into one receipt-neutral private KERN
kernel. The existing shadow wrapper must remain byte-for-byte compatible for
its authored corpus. F4 does not consume the new kernel in this slice.

This is A3a, the dependency slice for F4-A3. A3 remains `PROPOSED` until A3b
adapts the neutral result into the authenticated F4 occurrence/presence path
and proves the public F4 matrix. Splitting the work prevents unresolved
collection encodings and occurrence-range decisions from being hidden inside
a broad parser refactor.

## Current State and Root Cause

- **[VERIFIED]** F4 authenticates the 26-row keyword catalog and common
  `parser-normalized-logical-line-v1` profile but uses those fields only in
  authority equality checks.
- **[VERIFIED]** Public F4 rejects all 26 independently authored positive
  keyword fixtures because the current semantic scan treats positional syntax
  after the first word as invalid properties.
- **[VERIFIED]** The executable source-form decisions live in
  `keyword-handlers-simple.kern` plus the structured scanner/handler sources;
  the authority table does not encode fallback, cursor, slot, or range rules.
- **[VERIFIED]** The authored normalization corpus is 52 cases: 26 catalog,
  eight fallback, eleven edge, and seven numeric fixtures, before envelope,
  masking, duplicate, limit, and mutation tests.
- **[DECIDED]** Reimplementing those rules in F4 would create a second grammar
  authority. Consuming a prior shadow receipt would violate the F4 authority
  boundary. The shared receipt-neutral kernel is the smallest sound dependency.

## Tribunal and Plan Challenge

- The required adversarial tribunal at
  `~/.agon/runs/tribunal-1787365963565-b8iyp7-kern5-f4-a3-source-forms`
  rejected an F4-specific reimplementation because the authenticated policy
  lacks executable normalization semantics.
- The required grounded brainstorm at
  `~/.agon/runs/brainstorm-1787366263463-hruu0d-kern5-f4-a3-bounded-plan`
  corrected the tribunal's 26-case premise to 52 authored cases and split A3
  into extraction/parity (A3a) and F4 projection (A3b).
- **[DECIDED]** A3a changes no F4 production source, F4 policy, receipt,
  authority, ABI, or acceptance status.

## Contract

### A3a-C1 — Neutral kernel

Add one private KERN handler named `normalizekeywordhandlerwrites`. It receives
only scalar content, upstream type/cursor, decoded token kind/value/start/end
arrays, and `maxWrites`. It returns no shadow format, seal, byte count, field
count, retained-token envelope, or host object.

The success result is a flat scalar array:

1. resolved type;
2. initial token cursor;
3. final token cursor;
4. write count;
5. for each write, exactly name, internal kind, value, start scalar, end scalar.

An invalid token shape or exceeded write cap returns the existing empty-array
failure sentinel. This private shape is not a public receipt or ABI.

### A3a-C2 — Exact semantic ownership

The kernel owns the existing bare, raw-tail, doc, route, error/respond, expect,
message, island, middleware, structured `fn`/`let`/`import`/`params`, and
fallback cursor decisions. It calls only receipt-neutral KERN helpers and the
existing structured scanner/handler functions.

The kernel must not call:

- `observeretainedtokenstream` or any `observe*` shadow handler;
- a bootstrap, host, TypeScript, parser-core, or runtime handler;
- shadow envelope/seal/format validation;
- F4, F2, F2B, or F3.

### A3a-C3 — Shadow adapter compatibility

`observekeywordhandlers` remains the only local shadow adapter. It continues
to call `observeretainedtokenstream` exactly once, validate/decode the same
token envelope, invoke the neutral kernel exactly once, and serialize the
same decision/write/seal fields in the same order.

For every existing input and limit, its returned array must be byte-for-byte
identical to the pre-extraction behavior. No format or cache identity is
changed outside the keyword-handler composition source hashes.

### A3a-C4 — Stable structured dependencies

`keyword-handlers-structured-scanner.kern` and
`keyword-handlers-structured.kern` remain behaviorally unchanged. Their
receipt-neutral functions are dependencies of the new kernel. The new source
and every touched handwritten source remain below 500 lines.

### A3a-C5 — A3b boundary

A3b must separately decide and prove:

- projection of `bindings-v1`, `params-items-v1`, and `middleware-list` into
  the F4 scalar occurrence model;
- whether structured whole-tail ranges are the permanent F4 occurrence range;
- a shared occurrence-admission helper for normalized and explicit writes;
- F4-local prospective work, occurrence, fact, diagnostic, and byte limits;
- public F1 -> F3 -> one-root-F4 evidence for all 26 positive forms and the
  representative malformed/fallback/multiline/quoted/astral/trailing classes.

M3 retains exhaustive cross-products, large-input scaling, mutation campaigns,
and linearity/adversarial work. It does not defer the semantic A3b matrix.

## Implementation Plan

1. Add a RED structural/behavioral oracle that requires the neutral handler,
   forbids shadow dependencies in its bounded source, and calls it directly on
   representative simple/structured/fallback inputs.
2. Move the current normalization helpers and decision body, without semantic
   edits, into `keyword-handler-normalization.kern`.
3. Reduce `keyword-handlers-simple.kern` to token-envelope decode, one kernel
   call, and the existing serializer/limit checks.
4. Add the neutral source to the keyword-handler member composition before the
   simple wrapper. Do not add it to F4 composition yet.
5. Run focused neutral-kernel tests, the complete keyword-handler suite, source
   containment, full workspace gate appropriate to the touched lower frontend
   source, lint, build, repository consistency, and diff checks.
6. Run automatic-risk independent Agon review with the actual primary engine,
   adjudicate findings, then commit and push the whole A3a slice once.

## Blast Radius

| Path | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-f4-m1-a3a-normalization-kernel/spec.md` | Add | Freeze bounded A3a contract and A3b boundary. |
| `examples/kern-frontend/keyword-handler-normalization.kern` | Add | Receipt-neutral normalization kernel. |
| `examples/kern-frontend/keyword-handlers-simple.kern` | Refactor | Retained-token decoder and byte-identical shadow adapter only. |
| `scripts/kern-frontend-keyword-handlers/source.mjs` | Update | Compose and contain the neutral source. |
| `scripts/kern-frontend-keyword-handlers/*.test.mjs` | Update/add | RED, direct kernel, parity, mutation, and source guards. |
| Parent F4 spec and completion goal | Final status update | Record A3a landed while A3/A3b remain open. |

No F4 KERN source, F4 worker, F4 policy, generated F4 authority, decoder,
document format, policy format, ABI, F0-F3 contract, or terminal gate changes.

## Acceptance Criteria

- **[A3a-A1]** The new kernel has the exact private flat result above and one
  definition/call from the shadow adapter.
- **[A3a-A2]** Direct kernel evidence covers at least one simple positional,
  raw-tail, structured commit, structured rewind, collection encoding, quoted,
  multiline, astral, trailing-property, and max-write failure case.
- **[A3a-A3]** The complete 52 authored fixtures retain their existing decoded
  decisions/writes/ranges, and existing keyword-handler receipt/envelope tests
  retain exact output bytes.
- **[A3a-A4]** Structural guards prove the kernel has no shadow format,
  observer, bootstrap, host-parser, or F4 dependency and the wrapper invokes
  retained tokenization once and the kernel once.
- **[A3a-A5]** Mutation controls that bypass the kernel, change a cursor
  decision, change a write field/range, or introduce a shadow dependency fail
  the focused oracle.
- **[A3a-A6]** All touched handwritten files are below 500 lines; generated
  files are unchanged.
- **[A3a-A7]** Focused and complete keyword-handler gates, relevant build/lint,
  repository consistency, and `git diff --check` pass.
- **[A3a-A8]** Automatic-risk independent Agon review has no unresolved
  verified blocker.
- **[A3a-A9]** Parent status records A3a as a landed dependency only; F4-A3,
  F4 overall, terminal rows, and completion percentage are not promoted.

## Kill Switches

Stop and respec if A3a requires:

1. any F4 production/policy/receipt/ABI change;
2. consuming or validating a shadow receipt inside the neutral kernel;
3. changing any authored fixture expectation or public shadow format;
4. inventing a new operational policy flag or rollout percentage;
5. a handwritten touched source at or above 500 lines;
6. host parsing, bootstrap delegation, or a second source-form grammar;
7. accepting semantic rather than byte-identical shadow compatibility; or
8. claiming F4-A3 accepted before A3b public-path evidence exists.

## Deploy Order

The RED/spec and extraction may be separate granular local commits, but A3a is
pushed once as one feature. The new neutral source, wrapper refactor, member
composition update, and tests must land atomically. A3b starts from fresh
`origin/main` only after A3a is merged.

## Verification Evidence

- The direct neutral-kernel and structural mutation matrix passed `4/4` on the
  final reviewed bytes.
- All 52 ordered authored local receipts match the exact pre-extraction
  SHA-256 `e9e0bb42cbd47fe3563421fcb0a7e89a3e0b98edcc7f758d9e6ddd73859c5eb0`.
- The complete keyword-handler package gate built core, passed `23/23` Node
  tests, and passed the 52-case cross-frontend regression wall.
- Lint checked 1,377 files; repository consistency and `git diff --check`
  passed.
- Automatic medium-risk review at
  `~/.agon/runs/review-1787369472022-nfj353-kern5-f4-a3a-normalization-kerne`
  routed two non-primary reviewers and found zero verified, needs-check, or
  speculative findings. Two useful containment/provenance nits were applied
  and their focused gates rerun.
- The new neutral kernel is 384 lines and the shadow adapter is 85 lines. No
  F4 production, policy, receipt, decoder, ABI, authority, or generated file
  changed.

## Corrections Log

| Rejected claim | Decided correction |
| --- | --- |
| The authenticated 26-row table is an executable grammar. | It authenticates form names/profile labels only; executable decisions remain in KERN source. |
| F4 should independently reimplement the 26 rules. | Share one receipt-neutral KERN kernel to avoid a second grammar authority. |
| The authored corpus contains only 26 cases. | It contains 52 behavior fixtures before envelope/mutation coverage. |
| A3 is one bounded refactor. | A3a extraction/parity and A3b F4 projection have different contracts and gates. |
| A3a closes F4-A3. | A3a is a dependency only; F4-A3 remains proposed. |
| An inherited dead `islandResolved` assignment should be cleaned up during extraction. | Preserve the decision body mechanically for byte parity; reconsider cleanup only in A3b with an explicit semantic oracle. |
