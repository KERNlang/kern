# KERN 5 F1 Physical Document Scanner

**Status:** P0 VERIFIED — PRODUCTION F1 CONTRACT EXTRACTION NEXT

**Date:** 2026-08-14

**Baseline:** `1868480434adb54186b4077144748dd1afa7d07d`

**Brainstorm:** `brainstorm-1786676172211-dqryop` (`claude,codex,agy`, 3/3)

**Tribunal:** `tribunal-1786676397757-b7evk6` (`claude,codex,agy`, 3/3)

**Corrective tribunals:** `tribunal-1786677274697-dya5us` and
`tribunal-1786677485000-0gsmer` are non-authoritative because the Claude seat
returned an OAuth authentication failure rather than a substantive verdict.

**Contract-closure tribunal:** `tribunal-1786689512944-qd9vtu-kern5-f1-p0-contract-closure`
(`claude,codex,agy`, 3/3 substantive) returned conditional GO. Its five exact
contract deltas are incorporated below before implementation.

**Confidence:** 0.98 after the promoted root gate passed every full-cap,
scaling, failure, encoder, and mutation obligation. Production F1 remains
blocked only on the source-backed lexical contract in **F1-D5/F1-O2**.

## Executive Summary

F1 is the first implementation slice after the non-promoting F0 frontend
closure. It must scan raw KERN source in one KERN execution and return an exact,
bounded physical token/trivia tape without using TypeScript classification or
any `kern.frontend.*-shadow.*` receipt. The original two-level nested-list return
is not admitted by the exported runtime-handler ABI. The corrective candidate
keeps every mutable KERN list bounded to 256 items, seals chunks into one tape
string using a balanced eight-level concatenation, and returns a fixed nine-item
`string[]`. It is a proposal, not an implementation authorization, until a
substantive `claude,codex,agy` tribunal accepts the numerical proof obligations.

The all-roster contract-closure tribunal accepted the numerical obligations,
and the resulting transport-only P0 implementation now verifies through the
real runtime envelope that the evaluator, result normalization, string
construction, and JSON serialization carry 65,536 worst-case records.

## Current State / Root Cause

- **[F1-C1 VERIFIED]** F0 fixes the delivery order as F1 document scan, F2
  expressions, and F3 lines/tree in
  `scripts/kern-frontend-closure/closure-ledger.json:217-220`.
- **[F1-C2 VERIFIED]** F0 assigns physical framing to scalar lines with original
  terminators and trivia/comments/quotes to a modeful scalar scan in
  `scripts/kern-frontend-closure/closure-ledger.json:133-153`.
- **[F1-C3 VERIFIED]** The terminal `kern-frontend` row remains planned and
  points to `pnpm test:kern-frontend` in
  `scripts/kern-5-remaining-gates-v1.json:41-43`; the support matrix remains
  `not-shipped` in `docs/kern-5-support-matrix.md:159`.
- **[F1-C4 VERIFIED]** `rg -n
  '"test:kern-frontend":|"test:kern-frontend-f1":' package.json` returned zero
  hits on 2026-08-14. Neither the terminal nor scoped F1 root script exists at
  this baseline.
- **[F1-C5 VERIFIED]** The current runtime accepts nested portable lists up to
  `maxCollectionLength`, validates every string against `maxStringBytes`, and
  rejects shared references in
  `packages/core/src/runtime-envelope/value.ts:41-101`. The encoded envelope is
  separately bounded by `maxBytes` in
  `packages/core/src/runtime-envelope/normalize.ts:151-169`.
- **[F1-C6 VERIFIED]** Existing formatter policy permits 32,768 records but its
  performance wall exercises only 256/512/1,024 records plus a 2,048-wide
  record in `scripts/kern-formatter/policy.json:8` and
  `scripts/kern-formatter/performance.test.mjs:18-28`. It is precedent, not the
  missing 65,536-record proof.
- **[F1-C7 VERIFIED]** The earlier frontend probe measured approximately
  quadratic guest list growth at 500/1,000/2,000/4,000 entries and forbids
  unbounded document lists in
  `.Codex/specs/kern-5-frontend-falsification/spec.md:23-31`.
- **[F1-C8 VERIFIED]** The runtime prerequisite now proves cached scalar walks
  through 65,536 scalars across ASCII, astral, CRLF, and mixed inputs in
  `.Codex/specs/kern-5-runtime-text-cache-prerequisite/spec.md:88-97`.
- **[F1-C9 VERIFIED]** Exported handler parameters and returns admit only
  `boolean`, `number`, `string`, homogeneous scalar lists, or `void` in
  `packages/core/src/portable-handler-type.ts:1-32`. The probe's original
  `returns=object` entry therefore fails closed at link time with
  `handler-entry-unsupported`; no evaluator work occurs.
- **[F1-C10 VERIFIED]** `encodeInternalRuntimeEnvelope` replaces an oversized
  success envelope with an `encoded-limit` failure in
  `packages/core/src/runtime-envelope/normalize.ts:153-169`. A post-hoc
  `JSON.stringify` byte count cannot prove that boundary.

The root blocker is therefore result transport, not scalar access or the choice
of lexical architecture.

## What Already Works

- F0 already freezes the full source/KIR dispositions, phase boundary,
  diagnostic catalog, and static goldens. F1 must consume that authority, not
  create another node/property catalog.
- The reference runtime already has bounded `Text.splice` and execution-local
  sparse scalar indexing. F1 adds no public Text or typed-array API.
- The formatter already demonstrates authenticated KERN composition, immutable
  packaged assets, silent list results, and strict host decoding. F1 follows
  that trust shape without importing formatter classification.
- Existing frontend shadow gates remain independent test oracles. They cannot
  be linked into the production F1 composition or used as receipts.

## Contract

> Verified against the artifacts cited below on 2026-08-14. Fields marked OPEN
> belong to the production scanner and cannot feed final fixtures until the
> transport probe and lexical-authority extraction resolve them.

### Verified P0 result envelope

The exported handler returns exactly nine text items. Positional fields are
required because the runtime handler admits `string[]` but not records or mixed
lists. The strict host decoder rejects any other length or field order.

| Position / Field | Type | Evidence | Tag |
| --- | --- | --- | --- |
| 0 `format` | exact text `kern.frontend.f1-transport-probe.2` | P0 is a versioned transport proof, not the production F1 scanner | VERIFIED |
| 1 `status` | `scanned` or `failure` | current silent-list product precedent: `packages/cli/src/kern-formatter-runtime.ts:55-91` | VERIFIED |
| 2 `code` | empty on success; closed failure code otherwise | fused fail-closed rule | DECIDED |
| 3 `sourceScalars` | canonical integer text, 0..65,536 | cache wall: `.Codex/specs/kern-5-runtime-text-cache-prerequisite/spec.md:88-97` | VERIFIED |
| 4 `recordCount` | canonical integer text, 0..65,536 | 256 x 256 tribunal geometry: `tribunal-1786676397757-b7evk6` | VERIFIED |
| 5 `chunkCount` | canonical integer text, 0..256 | original tribunal verdict | VERIFIED |
| 6 `maxGuestListLength` | canonical integer text, 0..256 | bounded-list instrumentation | DECIDED |
| 7 `tape` | one sealed concatenation of 0..256 framed chunks | admitted `string[]` return plus balanced concatenation | PROPOSED |
| 8 `seal` | exact terminal lexical state plus repeated counts | original tribunal verdict; EOF is not a record | VERIFIED |
| failure atomicity | counts are zero and tape is empty | F0 fused fail-closed rule: `.Codex/specs/kern-5-frontend-surface-closure/spec.md:108-116` | VERIFIED |

### Numerical transport preflight

For the probe's closed longest labels (`trivia`, `probe-trivia`), one-scalar
records, 65,536 records, 256 records per chunk, and the framing below, exhaustive
ordinal-width summation gives these exact maxima:

| Quantity | Exact maximum | 20% reserve floor |
| --- | ---: | ---: |
| tape Unicode scalars | 2,725,281 | 3,270,338 |
| tape UTF-8 bytes (every raw scalar four bytes) | 2,921,889 | 3,506,267 |
| encoded JSON tape content (every raw scalar uses a six-byte JSON escape) | 3,052,961 | 3,663,554 |
| complete encoded runtime envelope | 3,053,458 | 3,664,150 |
| largest chunk, Unicode scalars | 10,777 | 12,933 |
| retained generated transport text, UTF-8 bytes | 26,297,001 | 31,556,402 |

The scaling oracle also authenticates exact intermediate tape geometry, not
only elapsed ratios:

| Records | Chunks | Tape scalars | Worst tape UTF-8 bytes | Worst JSON-content bytes |
| ---: | ---: | ---: | ---: | ---: |
| 16,384 | 64 | 656,169 | 705,321 | 738,089 |
| 32,768 | 128 | 1,345,825 | 1,444,129 | 1,509,665 |
| 65,536 | 256 | 2,725,281 | 2,921,889 | 3,052,961 |

The complete-envelope figure was independently exercised against the built
`encodeInternalRuntimeEnvelope` with a fixed nine-text-item runtime value. The
astral case encoded to 2,922,386 bytes; the all-control case, which dominates
JSON escaping, encoded to 3,053,458 bytes. The P0 policy must expose separate
limits no lower than the reserve floors and must fail before final tape
concatenation when conservative guest counters exceed them.

Define `digits(0) = 1` and, for positive safe integer `n`,
`digits(n) = Text.length(String(n))`. For record ordinal `i` in this fixed probe,
the exact scalar width is `27 + 2*digits(i) + digits(i+1)`. Its conservative
UTF-8 width is `30 + 2*digits(i) + digits(i+1)`, and its conservative JSON
content width is `32 + 2*digits(i) + digits(i+1)`. For chunk `c`, payload scalar
width `p`, first record ordinal `f`, and count `k`, the exact framing width
excluding payload is
`6 + 2*digits(c) + digits(f) + digits(k) + digits(p)`. Summing these formulas
over all 65,536 records and 256 chunks produces the table above and explicitly
covers every decimal transition such as 9-to-10 and 99-to-100.

The guest can therefore conservatively charge four UTF-8 bytes and six
JSON-content bytes per raw scalar without needing a guest UTF-8 primitive. Its
balanced tape concatenation retains no list above 256 entries. “Retained
generated transport text” is evaluated at two explicit source-level
reachability checkpoints and excludes the caller-owned input source and
host/runtime envelope copies, which the separate peak-RSS wall measures. At the
per-chunk checkpoint immediately after the eighth record-pairing level, count all
prior sealed chunks plus the original record strings and all eight still-bound
pairing levels for the current payload. Its exact full-cap maximum is 3,014,024
UTF-8 bytes. At the top-level checkpoint immediately after the eighth
chunk-pairing level, count the original chunks plus all eight still-bound pairing
levels, exactly nine tape-equivalents. Its exact maximum is
`9 * 2,921,889 = 26,297,001` bytes and its authenticated 20% reserve floor is
31,556,402 bytes. The second checkpoint dominates. Strings from returned
per-chunk helper frames are no longer source-reachable at the top checkpoint;
any evaluator retention beyond source reachability is covered by peak RSS. The
guest must reject before final concatenation when conservative preflight would
exceed the authenticated dominant wall.

“Zero events” means `envelope.events` is exactly `[]` for both scanned and
expected atomic-failure results. Host-only elapsed/RSS/encoded-byte measurements
are permitted outside the envelope. An unexpected guest panic is not hidden by
this rule: it produces a failure outcome/diagnostic and cannot satisfy the
expected nine-string result contract.

Logical UTF-8 retained-byte accounting at the two checkpoints is the normative
retention pass/fail oracle. Peak RSS is recorded as non-normative diagnostic
evidence only because it also contains engine, input, normalization, and host
copies and varies with allocator state.

### Chunk and record framing

The tape is the ordered concatenation of scalar-length-framed chunks. Each chunk
carries its chunk ordinal,
first record ordinal, record count from 1 through 256, its exact payload length,
and a terminal chunk seal. Chunk boundaries have no lexical or language
meaning.

All integer fields use canonical unsigned decimal text matching
`0|[1-9][0-9]*`; leading signs, whitespace, leading zeroes, or unsafe host
integers are rejected. Concatenation below is literal and introduces no hidden
separator:

```text
record = "r" + ordinal + "," + class + "," + kind + "," + startScalar
       + "," + endScalar + "," + rawScalarLength + ":" + raw

chunk  = "c" + chunkOrdinal + "," + firstRecordOrdinal + "," + recordCount
       + "," + payloadScalarLength + ":" + recordPayload
       + "s" + chunkOrdinal

tape   = chunk[0] + chunk[1] + ... + chunk[chunkCount - 1]
```

`rawScalarLength` and `payloadScalarLength` count Unicode scalars, never UTF-16
code units or UTF-8 bytes. The decoder consumes exactly those scalar lengths.
After a payload it matches the literal `s` plus the already-parsed canonical
chunk ordinal; the following scalar must be `c` or end-of-tape. This makes chunk
boundaries deterministic even when raw text contains framing characters.

The balanced pairing topology is stable adjacent pairing. At every level,
`next[k] = current[2*k] + current[2*k+1]` when the right item exists, otherwise
`next[k] = current[2*k]`. Starting from at most 256 ordered items, exactly eight
levels are evaluated; a nonempty input must end with exactly one item. Split-half
pairing, reordering, omission, or an extra separator is forbidden.

The chunk seal is the repeated canonical chunk ordinal in the `s<ordinal>`
suffix above. It is an ordering/integrity sentinel, not a cryptographic digest.
The successful top-level seal is exactly
`eof:<sourceScalars>:<recordCount>:<chunkCount>:closed`, using canonical decimal
counts. The host recomputes it from the admitted source and decoded tape and
requires exact equality. A failure result uses seal `failure`, an empty tape,
and zero `recordCount`, `chunkCount`, and `maxGuestListLength`; its `code` is a
closed expected failure code. Constant, stale, or count-drifted seals fail.

Every record contains exactly six fields:

1. zero-based global `ordinal`;
2. `class`, either `token` or `trivia`;
3. a closed F1 lexical `kind`;
4. zero-based `startScalar`;
5. exclusive `endScalar`; and
6. exact nonempty `raw` source text.

- **[F1-D1 DECIDED]** Records are absolute half-open Unicode-scalar spans.
  UTF-16 or relative offsets are forbidden.
- **[F1-D2 DECIDED]** Records partition the source exactly once: ordinal order,
  no gaps/overlap/zero width, `raw == source[startScalar:endScalar]`, and ordered
  raw concatenation equals the input.
- **[F1-D3 DECIDED]** EOF exists only in the top-level seal. The worst case is
  therefore 65,536 one-scalar records, not 65,537 records.
- **[F1-D4 DECIDED]** Byte offsets, CRC fields, line/column fields, and source
  hashes are excluded unless a later verified consumer contract requires them.
- **[F1-D5 OPEN]** The exact closed production lexical-kind enum and EOF
  diagnostic precedence must be extracted from the live parser/tokenizer/raw
  contracts before production scanner fixtures are written. The transport
  probe uses a deliberately non-semantic fixed kind and cannot close this item.

### F1 / F3 boundary

- **[F1-D6 DECIDED]** F1 may emit original newline records, raw leading space
  and tab trivia, quote/comment/fence boundaries, lexical token spans, and
  terminal lexical state.
- **[F1-D7 DECIDED]** F1 may not emit indent/dedent, indentation validity or
  depth, continuation, logical-line, parent, attachment, node, property,
  expression-kind, or KIR fields. Those are F2/F3 or later.
- **[F1-D8 DECIDED]** F3 will consume ordered records across chunk boundaries
  as one stream; chunks are transport only and never parser input semantics.

### Ownership and host boundary

- **[F1-D9 DECIDED]** Production F1 is an authenticated ordered composition of
  regular KERN source modules. Each handwritten module remains below 500 lines.
- **[F1-D10 DECIDED]** TypeScript may authenticate exact assets and policy,
  invoke the KERN handler, validate length framing/counts/spans/source
  reconstruction, and compare test results to independent oracles. It may not
  trim, tokenize, classify, parse, construct kinds/spans/diagnostics, or repair
  KERN output.
- **[F1-D11 DECIDED]** The production composition rejects imports of
  `parseInternal`, `parseDocument`, `tokenizeLineInternal`, bootstrap KIR
  projection, frontend shadow sources/receipts, capabilities, and host handlers.

### P0 transport corpus vectors

Each exact-cap corpus contains the first 65,536 Unicode scalars of its repeated
pattern and must return `scanned`, 65,536 one-scalar records, 256 chunks,
`maxGuestListLength = 256`, exact reconstruction, the successful seal, and zero
events. These labels and patterns are transport-only fixtures, not production
lexical claims:

| Shape | Repeated scalar pattern | Probe class/kind rule |
| --- | --- | --- |
| `token` | `a` | every record `token` / `probe-token` |
| `trivia` | space | every record `trivia` / `probe-trivia` |
| `alternating` | `a` then space | even record token; odd record trivia |
| `astral` | `😀` | every record token; exercises four-byte UTF-8 scalars |
| `escape` | backslash then `"` | every record token; exercises JSON escaping |
| `comment` | `# note` then LF | every record token; comment-shaped only |
| `fence` | `<<<raw>>>` then LF | every record token; fence-shaped only |

The `comment` and `fence` sources are infinite repetition of their stated
patterns truncated to exactly 65,536 Unicode scalars. Every table row marked
token uses kind exactly `probe-token`; `trivia` uses exactly `probe-trivia`;
`alternating` selects those exact class/kind pairs by record-ordinal parity.

Any source containing a non-scalar UTF-16 code unit, including a lone surrogate,
is outside the admitted runtime-handler argument domain. The worker calls the
shared `isWellFormedText` admission predicate, reports P0 code
`ILL_FORMED_SOURCE`, and does not invoke the guest because runtime argument
normalization would reject the same value. This host preflight performs no
token/trivia/lexical classification and makes no production F1 diagnostic claim.

Empty source is a successful tenth fixture. It evaluates eight empty pairing
levels and returns an empty tape, zero source/record/chunk/list counts, seal
`eof:0:0:0:closed`, and zero events.

Cap-plus-one is the `token` pattern at 65,537 scalars and must return atomic
`SOURCE_LIMIT` failure. Forced late failure uses the full-cap `alternating`
corpus and must return atomic `FORCED_LATE_FAILURE` after scanning but before
final tape concatenation.

## Implementation Options

### Option A1 — Single execution, internally chunked sealed tape (corrective candidate)

One KERN invocation scans the entire admitted source. Per-chunk record scratch
and the top-level chunk list are each capped at 256. The chunks are joined with
eight bounded pairing levels and returned inside a fixed nine-item `string[]`.
The strict host decoder accepts the result only after complete reconstruction
and seal validation.

Pros: one runtime epoch; atomic result; no replay/state protocol; ordinary F3
streaming; no new public ABI; admitted handler return. Cons: transport,
serialization, and transient string retention remain unproven at the full
65,536-record cap.

### Option A0 — Nested chunk-list return (rejected after implementation trace)

The original draft returned a record containing `chunks: string[]`. The public
runtime handler does not admit `returns=object`, so the handler is rejected at
link time. Widening the runtime ABI is outside F1 P0 and would increase the
public/shared-contract blast radius.

### Option B — Resumable pages (rejected)

Multiple KERN invocations return cursor and lexical state. This adds source,
state, epoch, replay, reorder, and continuation authentication before F1 owns a
single scanner. The tribunal found no current need for this complexity.

### Option C — Validate then print records (rejected)

A second scan emits each record as stdout. This creates up to 65,536 observable
events and a large trace, conflicts with atomic silent-result precedent, and
does not avoid host/runtime accumulation.

## Blast Radius

### Transport probe only

| File | Action | Reason |
| --- | --- | --- |
| `examples/kern-frontend/f1-output-transport-probe.kern` | add | Construct worst-case bounded chunks without lexical claims. |
| `scripts/kern-frontend-f1/transport-worker.mjs` | add | Invoke the real runtime and report time/memory/result geometry. |
| `scripts/kern-frontend-f1/transport.test.mjs` | add | RED/GREEN exact-cap, plus-one, late-failure, and scaling wall. |
| `scripts/kern-frontend-f1/transport-policy.json` | add | Configurable probe limits and absolute walls. |

### Production F1 after the probe

Exact files remain blocked by **[F1-D5 OPEN]**. Expected owners are small KERN
scanner/framing modules, an ordered composition record, a strict private host
decoder/runner, independent oracle/fixtures/mutations, an F1-only root script,
and F0/release evidence updates. No public parser export is planned.

## Acceptance Criteria

### P0 — Transport falsification gate

- [x] **[F1-P1]** RED proves the F1 transport asset and scoped gate are absent
  at baseline for the expected reason.
- [x] **[F1-P2]** The real runtime returns 16,384, 32,768, and 65,536 complete
  one-scalar records through 64, 128, and 256 internally sealed chunks without a list,
  string, event trace, normalization, or encoded-envelope limit failure.
- [x] **[F1-P3]** All-token, all-trivia, alternating, astral, maximal-escape,
  comment-shaped, and fence-shaped raw corpora preserve exact absolute scalar
  spans and source reconstruction. These are transport shapes, not lexical
  parity claims.
- [x] **[F1-P4]** 65,537 scalars fail before output; a forced late failure at
  scalar 65,536 returns zero chunks, zero records, and zero events.
- [x] **[F1-P5]** Instrumentation proves every guest list is at most 256 and no
  trace contains record-proportional events. Guest preflight rejects before
  final concatenation when the conservative UTF-8, JSON-content, or retained
  text budget is exceeded. Direct encoded-envelope bytes, absolute time, and
  the separate 16k-to-32k and 32k-to-65k ratios stay within authenticated
  policy walls. Peak RSS is recorded only as non-normative diagnostic evidence.
- [x] **[F1-P6]** Constant output, dropped/duplicated/reordered chunks or
  records, field permutations, truncation/injection, noncanonical length
  digits, seal/count drift, scalar-boundary corruption, span shifts, zero-width
  records, framing corruption, source substitution, EOF-as-record, and an
  encoded-limit substitution are rejected.
- [x] **[F1-P7]** The test invokes `encodeInternalRuntimeEnvelope` directly with
  the configured runtime limits and proves the decoded envelope remains the
  original success result rather than an `encoded-limit` substitute.

### F1 — Production scanner gate (blocked until P0 and F1-D5 resolve)

- [ ] Raw source is scanned only by the authenticated KERN composition and
  returns the six-field tape with exact partition/reconstruction.
- [ ] Valid and malformed fixtures cover every frozen F1 lexical family,
  Unicode scalar spans, original terminators, quotes, comments, fences, exact
  limits, and deterministic first-failure precedence.
- [ ] Independent current-source oracles agree on all admitted fixtures without
  sharing production helpers or feeding shadow receipts to production.
- [ ] Mutations kill host classification/delegation, constants, stale assets,
  reordered modules, kind changes with unchanged raw text, span drift, partial
  output on failure, and accidental F2/F3 fields.
- [ ] `pnpm test:kern-frontend-f1` is current in the internal KERN 5 wall while
  `pnpm test:kern-frontend` remains absent/planned until F7.

## Out of Scope

- Expression parsing, logical continuation, indentation diagnostics or tree
  attachment, declarations/modules, KIR projection, terminal promotion, public
  parser APIs, compiler, fixed point, interpreter, cutover, and release.
- Generated TypeScript/Python scanner parity; F7 owns final cross-target
  promotion evidence.
- New typed-array, streaming capability, checksum, or public KIR contracts.

## Open Questions

- **[F1-O1 VERIFIED]** The real evaluator, balanced string construction,
  normalizer, and encoder pass P0 at 65,536 records within both adjacent scaling
  walls and every normative logical/encoded budget; RSS remains diagnostic.
- **[F1-O2 OPEN]** What exact closed lexical kind and EOF diagnostic ordering is
  required by the current parser/raw/comment contracts? Resolve from source
  before production fixtures.

Neither open item is a product decision. P0 resolves F1-O1; a source-backed
contract extraction and another required tribunal resolves F1-O2.

## Deploy Order

1. Land the non-promoting P0 transport proof only if all P0 criteria pass.
2. Implement and land F1 scanner/decoder/oracles after both open items resolve.
3. F2 and F3 consume the private sealed tape in later independently reviewed
   slices.
4. F7 alone promotes the terminal `test:kern-frontend` and canonical ownership.

There is no live version-skew consumer during P0 or F1. Every boundary remains
private/internal-oracle until the later consumer lands against the exact format.

## Corrections Log

- The runtime requires positive `maxEvents`; P0 configures runtime capacity 1
  while separately requiring exactly zero observed events.
- The initial probe failed because list rebinding and direct list-valued helper
  returns are outside the current effect-machine corpus. The verified guest uses
  nested chunk loops and binds helper failure results before returning them.
- Full-cap execution exposed proportional accumulation of internal events before
  normalization. The separately specified trace-compaction prerequisite retains
  only externally observable events on envelope paths while preserving full
  direct-machine traces.
- The runtime architecture checker rejected a runtime-specific selector name in
  generic semantics. The final private mode is semantics-neutral
  `observable-only`; only runtime-envelope callers select it.

| Original Claim | Reality | Impact |
| --- | --- | --- |
| A 256 x 256 chunk geometry proves F1 scalability. | It proves guest list cardinality only; evaluator, string, normalization, and serialization costs remain unmeasured. | Product F1 is blocked on P0. |
| Paging may be required to stream F1. | One sealed chunked result can stream into F3 without cross-invocation state. | Option B rejected. |
| EOF should be a tape record. | A worst-case source can consume all 65,536 record slots. | EOF moved exclusively to the top-level seal. |
| Existing formatter scaling closes F1 transport. | Formatter performance tops out at 1,024 many-record cases and 2,048 record width. | P0 must exercise the real 65,536-record boundary. |
| The probe can return a record containing `chunks: string[]`. | The exported handler ABI rejects `returns=object` during linking. | Use the proposed fixed nine-item `string[]` and one sealed tape, subject to a valid corrective tribunal. |
| Measuring `JSON.stringify(envelope)` proves the runtime byte wall. | The real encoder may silently replace success with `encoded-limit`. | Invoke and decode `encodeInternalRuntimeEnvelope` directly. |
| A single 16k-to-65k ratio catches nonlinear growth. | It can hide a late cliff between 32k and 65k. | Enforce both adjacent ratios independently. |
