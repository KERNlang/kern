# KERN 5 Frontend F2B Document Expression Batch Contract

**Status:** ACCEPTED

**Date:** 2026-08-20

**Parent contracts:**

- `.Codex/specs/kern-5-frontend-surface-closure/spec.md`
- `.Codex/specs/kern-5-f1-production-scanner/spec.md`
- `.Codex/specs/kern-5-f2-expression-parser/spec.md`
- `.Codex/specs/kern-5-post-m4-171-completion/spec.md`

**Tribunal receipt:**
`/Users/nicolascukas/.agon/runs/tribunal-1787216939789-gnemuz`

**Repair tribunal receipt:**
`/Users/nicolascukas/.agon/runs/tribunal-1787219788448-9ejwe0`

**Independent review receipts:**

- `/Users/nicolascukas/.agon/runs/review-1787219384708-6gnlzk`
- `/Users/nicolascukas/.agon/runs/review-1787220540704-2fqtb1-f2b-repair`

**Confidence:** 0.96

## Decision

F3 cannot consume a document-level F2 tape because the current F2 contract
accepts exactly one expression body, excludes its outer `{{` and `}}`, and
returns body-relative spans. Before F3 implementation, add a non-terminal F2B
document batch protocol that mechanically discovers expression segments from
an authenticated F1 record tape and transports them into one KERN batch-handler
invocation. Inside that invocation, KERN dispatches the existing F2 parser in
document order, rebases its spans into document coordinates, applies aggregate
limits and failure precedence, and seals one immutable batch result.

F2B is a transport and coordinate-ownership amendment. It must not classify
expression syntax, inspect expression node kinds or payloads, change the F1 or
F2 semantic contracts, emit line/tree data, or promote `test:kern-frontend`.

## Claims

- **[F2B-C1 VERIFIED]** Current F2 has no document mode. Its production entry
  accepts one body and its F1 seam test reconstructs only predetermined receipt
  ordinals.
- **[F2B-C2 VERIFIED]** F2B discovers segments only from authenticated F1
  `expr` records and their opener/closer/continuation flags. No source-text
  search or TypeScript parser may discover a segment. Before dispatch, KERN
  independently proves that each supplied body equals the declared source
  slice, closing same-length body substitution.
- **[F2B-C3 VERIFIED]** Each segment binds its first and last F1 ordinals, outer
  document span, body document span, source digest, ordered record digest, and
  exact F2 result digest.
- **[F2B-C4 VERIFIED]** Every F2 node span is rebased to an absolute
  Unicode-scalar half-open document span by adding the segment body start. F2B
  does not retain a second mutable copy of the node tape.
- **[F2B-C5 VERIFIED]** Batch failure is atomic. A malformed batch request,
  aggregate-limit failure, or any failed F2 segment produces
  no successful segment section and exactly one deterministic failure record.
- **[F2B-C6 DECIDED]** The first failure is selected by document position, then
  phase rank, then rule rank, then code rank. Implementations must emit in this
  order; a post-hoc diagnostic sort is forbidden.
- **[F2B-C7 VERIFIED]** Aggregate limits are policy-owned and charged across the
  whole document. Per-expression F2 limits cannot be multiplied without a
  document cap.
- **[F2B-C8 DECIDED]** F2B remains `internal-oracle`. F3 consumes the exact
  sealed protocol; F5 alone selects canonical KIR fields and F7 alone promotes
  the terminal frontend gate.

## Protocol

### Inputs

The batch worker authenticates:

1. one well-formed source document;
2. one independently decoded F1 success receipt produced for that exact source;
3. the authenticated F1/F2 policies and production source compositions; and
4. optional test-only downward limit overrides from a closed key set.

The worker rejects before the batch invocation when F1 fails, its
source identity differs, its record ordinals are not contiguous, its spans do
not partition the source, or its policy/source digests drift.

### Segment discovery

- **[F2B-D1 DECIDED]** An expression segment starts only at an F1 `expr` record
  with `opener` set and ends only at the matching ordered F1 `expr` record with
  `closer` set. Intermediate records are restricted to F1 `expr` and `newline`
  records, plus the F1-admitted exact lone-CR `unknown` continuation, carrying
  the already authenticated open-expression state.
- **[F2B-D2 DECIDED]** Nested raw `{{`/`}}` remains inside the F1 segment. F2B
  never rescans it and never derives nesting from source bytes.
- **[F2B-D3 DECIDED]** The outer span is the first record start through the
  last record end. The body span excludes exactly two opening and two closing
  Unicode scalars. The concatenated authenticated record raw values must equal
  that exact source slice before the body is dispatched.
- **[F2B-D4 DECIDED]** Segment ordinals and document spans are strictly
  increasing and non-overlapping. Ordinary records between segments remain F1
  evidence but do not appear in the F2B segment section.

### Success receipt

The KERN success result has ten closed ordered fields and four framed sections:

1. identity/count fields: format, source scalar count, segment count, and
   aggregate node count;
2. `segments`: one ten-field KERN transport row per expression containing
   segment ordinal, first/last F1 ordinals, outer/body absolute spans,
   host-attested body and record digests, and node count;
3. `absoluteSpans`: one fixed-shape row per F2 node containing segment ordinal,
   node id, absolute start, and absolute end; and
4. `expressionReceipts` plus `seal`: the exact nine-field F2 receipts in
   document order and a KERN structural seal over section counts and lengths.

The strict host decoder recomputes cryptographic source, policy, module,
section, exact-field, and terminal digests without making a semantic decision.
Changing any same-length F2 payload changes the exact-field terminal digest
even when the KERN structural length seal is unchanged.

After independently decoding the exact F2 receipt, the strict decoder enriches
the transport row with the proven F2 status, root node id, and exact receipt
digest. Host-attested body/record digest fields are not represented as KERN
cryptographic claims; the KERN authority instead proves body-to-source-slice
equality before dispatch, while the host binds the digests to authenticated F1
evidence and revalidates their echoed values.

The F2 node tape itself remains owned and authenticated by its F2 receipt. F2B
retains its exact byte-identical receipt as a sidecar section and stores only
its digest in the decoded segment manifest. This keeps the manifest itself
payload-free while allowing F3-F5 to reuse authenticated F2 results without a
second parse.

### Failure receipt

The canonical failure result contains empty segment, absolute-span, and receipt
sections plus one exact code, document span, and optional segment ordinal. F1
failure is a prerequisite failure before a batch request exists. The closed
batch codes are:

- `BATCH_INVALID_REQUEST`
- `BATCH_INVALID_F2_RECEIPT`
- `BATCH_LIMIT`
- `BATCH_EXPRESSION_REJECTED`
- `FORCED_LATE_FAILURE` (test entry only)

The F2 diagnostic's relative span is projected by KERN to the batch failure's
absolute document span. No previously parsed sibling segment or exact receipt
may escape after failure.

## Resource Contract

Policy owns positive safe-integer ceilings for F1 records, segments, aggregate
body scalars, aggregate F2 nodes, absolute-span rows, work steps, encoded bytes,
peak RSS, and elapsed time. F1 and F2 retain their own source-scalar ceilings;
the runtime envelope separately owns collection and string bounds. Test-only
profile overrides are downward-only. Charging is monotone:

- F1 separately owns its record/source bounds before F2B;
- one unit per segment boundary admitted;
- body scalar units before F2 dispatch;
- two units per admitted F2 node plus one result unit after each dispatch; and
- one unit per emitted segment or absolute-span row.

Host transport performs one forward F1-record pass with one open-segment
accumulator. Lookahead beyond the current record and one pending record is a
contract failure. The output geometry must scale linearly at 1x/2x/4x/8x
documents containing many individually small expressions. The terminal density
wall contains exactly 10,000 expressions and requires one F2 runtime invocation.

## Precedence

1. source well-formedness and source cap;
2. F1 identity/authentication;
3. F1 record visit and request construction;
4. segment topology and body/source equality;
5. pre-dispatch aggregate body cap;
6. existing F2 result and diagnostic;
7. post-dispatch aggregate node/span/work caps;
8. KERN structural result seal and host cryptographic exact-field digest; and
9. test-only forced late failure.

At equal source position, the earlier phase above wins. The implementation
stops on the first failure and never sorts diagnostics afterward.

## Binary Acceptance

- **[F2B-A1 VERIFIED]** RED at the pre-slice baseline was the missing
  `test:kern-frontend-f2-batch` root script and missing batch protocol assets;
  all existing F1/F2 gates remain green.
- **[F2B-A2 VERIFIED]** Hand-authored documents cover zero, one, adjacent, multiline,
  CRLF, astral, quoted-closer, nested expression delimiter, and 10,000 small
  expression segments. Every segment and absolute node span matches an
  independent source-coordinate oracle.
- **[F2B-A3 VERIFIED]** Direct single-body F2 results and the F2 receipts bound by the
  batch are byte-identical for every valid segment.
- **[F2B-A4 VERIFIED]** Malformed expression in the first, middle, and last segment
  proves atomic failure with the exact rebased first diagnostic and zero
  success sections.
- **[F2B-A5 VERIFIED]** Mutations kill source-text segment search, host/TypeScript parse
  delegation, hardcoded bodies, skipped F1 authentication, ordinal/span drift,
  opener/closer drift, overlap/reorder/duplication, relative-span leakage,
  payload duplication, stale F2 receipts, partial failure, post-hoc sorting,
  and unchecked aggregate limits.
- **[F2B-A6 VERIFIED]** Section-level mutation semantics are exact: scrambling an F2
  semantic payload leaves segment geometry and absolute spans unchanged,
  changes the F2 receipt digest and batch seal, and never produces a claim that
  the complete envelope is byte-identical.
- **[F2B-A7 VERIFIED]** 1x/2x/4x/8x segment-density and body-size walls satisfy absolute
  and adjacent time, process peak-RSS, and envelope-size limits.
- **[F2B-A8 VERIFIED]** Source and built import/call closure excludes TypeScript parser,
  bootstrap projector, shadow receipts, generated target parsers, and host
  semantic classification.
- **[F2B-A9 VERIFIED]** Focused F1, F2, F2B, runtime ABI, source-runner convergence,
  canonicalizer, checker, formatter, lint, and cumulative promoted fitness
  gates pass before promotion.
- **[F2B-A10 VERIFIED]** Independent automatic-risk Agon review has no unresolved
  verified blocker. The F2B gate is current/internal-oracle while
  `test:kern-frontend` and the six terminal gates remain planned.

## Review Resolution

The two complete automatic high-risk review cycles reported six verified
blockers. All are closed by named regressions in the accepted 33-test gate:
document-position failure precedence, diagnostic request/test authority,
absolute-span group order, effective encoded-byte enforcement, downward-only
limit overrides, and exact replay of standalone receipts under the same
effective policy. The repair tribunal additionally found same-length body
substitution; KERN now rejects it by proving body-to-source-slice equality
before F2 dispatch.

## Kill Switches

Stop the slice if any of these becomes necessary:

1. F2B discovers expressions by searching source text rather than F1 records.
2. F2 semantic logic or node payload interpretation moves into host code.
3. F3 prose calls F2B a passive second input while implementation dispatches
   unbound per-body calls.
4. Batch lookahead exceeds one physical record or one open accumulator.
5. Manifest size grows with copied F2 semantic payload rather than segment and
   node counts.
6. A failed segment leaves a successful sibling section reachable.
7. A comment/trivia/pending edge gains tree parent or subtree-size semantics.
8. Diagnostics require a post-hoc sort to satisfy canonical order.
9. TypeScript/Python divergence is patched with a target-specific semantic
   branch.
10. Implementing F2B requires a public KIR/parser API or changes frozen F2
    single-expression bytes.

## Out of Scope

- F3 logical lines, indentation attachment, decorators, raw blocks, tree
  topology, and recoverable attachment diagnostics.
- F4 declarations/modules, F5 KIR projection, F6 terminal adversarial closure,
  and F7 frontend promotion.
- Compiler, fixed point, interpreter, canonical cutover, packed release,
  version injection, tags, and registry publication.

## Delivery Order

1. Land RED contract tests and fixtures against the current F1/F2 baseline.
2. Implement the authenticated batch decoder/worker and minimal protocol
   policy, preserving existing F2 bytes.
3. Close mutations, aggregate limits, and scaling.
4. Run focused/cumulative gates and independent review.
5. Only then write the F3 line/tree implementation spec against the landed F2B
   protocol.
